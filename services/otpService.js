/**
 * Signup email-ownership verification (OTP).
 *
 * SINGLE WRITER for the `email_verifications` table and for the `users` INSERT
 * that a verified signup produces. Routes parse and respond; every rule about
 * expiry, retries, resend pacing and account creation lives here.
 *
 * ── Email failure is resilient, not fatal (updated) ─────────────────────────
 * Email is still the primary action here — an OTP that was never delivered
 * cannot be entered — but it is no longer a hard single point of failure.
 * mailService fails over across providers, so reaching a send failure means
 * EVERY provider is down. When that happens the staged signup is KEPT (not
 * rolled back) and `issueAndSend` returns `delivered: false`; the user lands on
 * the code screen and can resend once mail recovers, without re-typing the form.
 * Integrity is preserved: a real code still gates account creation, and each
 * resend mints a fresh one. (The previous design deleted the row and threw 502,
 * which made one email outage block ALL new registrations — see P0 resilience.)
 *
 * ── Scope: NEW registrations only ──────────────────────────────────────────
 * Nothing here reads or writes an existing user's verification state. Login is
 * untouched. `users.email_verified_at` is stamped for accounts this module
 * creates purely as an audit signal (migration 020 explains why it is not a
 * gate).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { isMailConfigured } = require('./mailService');
const emailOutboxService = require('./emailOutboxService');
const { normalizeRole, ROLE_KEYS } = require('../middleware/rbac');
const systemSettings = require('./systemSettingsService');

// ---------------------------------------------------------------------------
// Tunables. Defaults sit inside the 5-10 minute window the product asked for.
// ---------------------------------------------------------------------------
const readInt = (name, fallback) => {
	const parsed = Number.parseInt(process.env[name], 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * TTL is read PER CALL, not captured at module load, because it is now a system
 * setting a Super Administrator can change without redeploying. The old
 * module-level constant would have kept serving the boot-time value until the
 * process restarted -- a setting that appears to save and does nothing.
 * Falls back to OTP_TTL_MINUTES and then to 10.
 */
const getOtpTtlMinutes = () => systemSettings.get('otp_ttl_minutes');
const OTP_RESEND_COOLDOWN_SECONDS = readInt('OTP_RESEND_COOLDOWN_SECONDS', 60);
const OTP_MAX_SENDS = readInt('OTP_MAX_SENDS', 5);      // per pending signup
const OTP_MAX_ATTEMPTS = readInt('OTP_MAX_ATTEMPTS', 5); // wrong codes before lockout
const OTP_LENGTH = 6;

/**
 * A ServiceError carries the HTTP status the route should use, so route
 * handlers stay dumb. Mirrors the pattern referralService already uses.
 */
class OtpError extends Error {
	constructor(status, message, extra = {}) {
		super(message);
		this.name = 'OtpError';
		this.status = status;
		Object.assign(this, extra);
	}
}

// ---------------------------------------------------------------------------
// Code generation + hashing
// ---------------------------------------------------------------------------

/**
 * crypto.randomInt, not Math.random: the code is a credential. Zero-padded so
 * every code is exactly 6 characters ("004821" is a valid code, "4821" is not).
 */
function generateCode() {
	return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/**
 * SHA-256 with a server-side pepper rather than bcrypt. bcrypt is deliberately
 * slow, which is right for passwords but wrong here: the search space is only
 * 1e6 and is already closed off by OTP_MAX_ATTEMPTS + a 10-minute TTL, while
 * the verify endpoint is on the hot path of a signup. The pepper means a stolen
 * database dump alone cannot rainbow-table six digits.
 */
function hashCode(code) {
	const pepper = process.env.JWT_SECRET || 'fallback_secret_key';
	return crypto.createHash('sha256').update(`${pepper}:${code}`).digest('hex');
}

/** Constant-time compare so a timing side channel cannot leak the digits. */
function hashesMatch(a, b) {
	const bufA = Buffer.from(String(a), 'utf8');
	const bufB = Buffer.from(String(b), 'utf8');
	if (bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function buildOtpEmail({ name, code, ttlMinutes }) {
	const greeting = name ? `Hello ${name},` : 'Hello,';
	const minutes = ttlMinutes;

	const html = `
		<div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
			<div style="background-color: #003631; padding: 24px; text-align: center; color: #ffffff;">
				<h2 style="margin: 0; font-size: 20px;">PESO Kabankalan Employment System</h2>
				<p style="margin: 6px 0 0; font-size: 13px; opacity: 0.85;">Email Verification</p>
			</div>
			<div style="padding: 28px 24px;">
				<p style="margin: 0 0 14px;">${greeting}</p>
				<p style="margin: 0 0 20px;">Use the verification code below to finish creating your account. The code expires in <strong>${minutes} minutes</strong>.</p>
				<div style="text-align: center; margin: 26px 0;">
					<span style="display: inline-block; font-size: 32px; letter-spacing: 10px; font-weight: bold; color: #003631; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px 24px;">${code}</span>
				</div>
				<p style="margin: 0 0 10px; font-size: 13px; color: #6b7280;">Your account is not created until this code is entered. If you did not request it, you can safely ignore this email — no account will exist for this address.</p>
				<p style="margin: 0; font-size: 13px; color: #6b7280;">Never share this code. PESO staff will never ask you for it.</p>
			</div>
			<div style="background: #f9fafb; padding: 14px 24px; font-size: 12px; color: #9ca3af; text-align: center;">
				Public Employment Service Office &mdash; Kabankalan City
			</div>
		</div>
	`;

	const text = `${greeting}\n\nYour PESO Kabankalan verification code is ${code}.\nIt expires in ${minutes} minutes.\n\nYour account is not created until this code is entered. If you did not request this, ignore this email.\n`;

	return { subject: `${code} is your PESO Kabankalan verification code`, html, text };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * Deliberately permissive. The OTP round-trip is what proves the mailbox is
 * real and active, so a syntax check only needs to reject obvious typos before
 * paying for an SMTP send.
 *
 * ALLOWED_SIGNUP_EMAIL_DOMAINS (comma separated, e.g. "gmail.com") narrows this
 * if the office ever wants Gmail-only signups. Unset = any domain, which is the
 * default because rejecting a valid non-Gmail address is a support ticket, not
 * a security win.
 */
async function assertUsableEmail(email) {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
		throw new OtpError(400, 'Please enter a valid email address.');
	}

	// Now a system setting a Super Administrator can change from the platform
	// settings screen, resolving as database row -> ALLOWED_SIGNUP_EMAIL_DOMAINS
	// -> unrestricted. Read per call so a change takes effect immediately.
	const allowList = String(await systemSettings.get('allowed_signup_domains') || '')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);

	if (allowList.length > 0) {
		const domain = email.split('@')[1];
		if (!allowList.includes(domain)) {
			throw new OtpError(400, `Registration is limited to: ${allowList.join(', ')}.`);
		}
	}
}

/** Housekeeping. Cheap, indexed, and keeps abandoned signups from piling up. */
async function purgeExpired() {
	try {
		await db.query('DELETE FROM email_verifications WHERE expires_at < NOW()');
	} catch (error) {
		// Never let cleanup break a signup.
		console.warn('[OTP] Expired-row purge failed:', error.message);
	}
}

/** How long the client should wait before the resend button re-enables. */
function cooldownRemaining(lastSentAt) {
	if (!lastSentAt) return 0;
	const elapsed = (Date.now() - new Date(lastSentAt).getTime()) / 1000;
	return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
}

/**
 * Issues a code, persists the pending signup, sends the mail.
 *
 * The row is written BEFORE the send and deleted if the send throws. Writing
 * after would mean a delivered code with nothing to verify it against — the one
 * ordering that is unrecoverable for the user.
 */
async function issueAndSend({ email, name, passwordHash, role, resendCount }) {
	const ttlMinutes = await getOtpTtlMinutes();
	const code = generateCode();
	const otpHash = hashCode(code);

	await db.query(
		`INSERT INTO email_verifications
		   (email, name, password_hash, role, otp_hash, expires_at, attempts, resend_count, last_sent_at)
		 VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, ?, NOW())
		 ON DUPLICATE KEY UPDATE
		   name = VALUES(name),
		   password_hash = VALUES(password_hash),
		   role = VALUES(role),
		   otp_hash = VALUES(otp_hash),
		   expires_at = VALUES(expires_at),
		   attempts = 0,
		   resend_count = VALUES(resend_count),
		   last_sent_at = NOW()`,
		[email, name, passwordHash, role, otpHash, ttlMinutes, resendCount]
	);

	// DE-FATALISED (was: delete the row + throw 502). mailService now fails over
	// across providers, so a total send failure means EVERY provider is down — a
	// real outage, not a blip. Discarding the staged signup here made email a
	// hard single point of failure for registration: one outage and nobody could
	// sign up. Instead we KEEP the staged row (it is ephemeral, TTL-bounded, and
	// creates no account) and report delivery as pending, so the user lands on
	// the code screen and can resend the moment mail recovers — no re-typing the
	// form, no burnt address. Verification integrity is untouched: a real code
	// still gates account creation, and each resend mints a fresh one, so no dead
	// secret lingers.
	//
	// PHASE 2C: routed through emailOutboxService.sendImmediate instead of a raw
	// sendMail. With EMAIL_OUTBOX_ENABLED off this is a pure inline send (identical
	// to the P0 path). With it on, the OTP gets a DURABLE queue row AND one
	// immediate inline attempt — so the user still gets the code without waiting a
	// poll cycle (blueprint §7 OTP special handling), and a transient failure now
	// retries in the background too. NO dedupe key: each resend is a fresh code and
	// must be its own email. sendImmediate never throws, so `delivered` alone drives
	// the resilient path below.
	const { subject, html, text } = buildOtpEmail({ name, code, ttlMinutes });
	const { delivered } = await emailOutboxService.sendImmediate({
		to: email, subject, html, text, category: 'otp'
	});

	if (!delivered) {
		console.error(`[OTP] Could not deliver the code to ${email} (all providers down). Staged signup kept; resend enabled.`);
		// A send that never went out must not burn the resend cooldown, so back-
		// date last_sent_at to make a resend immediately available.
		try {
			await db.query(
				'UPDATE email_verifications SET last_sent_at = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE email = ?',
				[OTP_RESEND_COOLDOWN_SECONDS, email]
			);
		} catch (_) { /* best effort */ }
	}

	return {
		email,
		delivered,
		expiresInMinutes: ttlMinutes,
		resendAvailableInSeconds: delivered ? OTP_RESEND_COOLDOWN_SECONDS : 0
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Step 1 of registration. Validates, stages the pending signup, emails a code.
 * Creates NO user row.
 */
async function startVerification({ name, email, password, role }) {
	const normalizedEmail = normalizeEmail(email);
	const normalizedName = String(name || '').trim();
	const normalizedPassword = String(password || '').trim();

	if (!normalizedName) throw new OtpError(400, 'Full name is required.');
	if (!normalizedEmail || !normalizedPassword) {
		throw new OtpError(400, 'Email and password are required.');
	}
	if (normalizedPassword.length < 8) {
		throw new OtpError(400, 'Password must be at least 8 characters.');
	}
	await assertUsableEmail(normalizedEmail);

	// Registration kill switch. Checked BEFORE the duplicate-email lookup and
	// before any bcrypt work, so turning signups off actually stops the work
	// rather than merely refusing at the end of it. Existing accounts are
	// unaffected -- this gates creation only, never sign-in.
	if (!(await systemSettings.get('signup_enabled'))) {
		throw new OtpError(503, 'New registrations are temporarily closed. Please try again later.');
	}

	if (!isMailConfigured()) {
		// Explicit, honest failure. Silently creating an unverified account here
		// would be exactly the bypass this feature exists to close.
		throw new OtpError(503, 'Email verification is temporarily unavailable. Please try again later.');
	}

	// Same message and status as the legacy /register path, so the client's
	// existing duplicate-email handling keeps working unchanged.
	const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
	if (existingUsers.length > 0) {
		throw new OtpError(409, 'Email address is already registered. Please sign in using your existing account or use a different email address.');
	}

	await purgeExpired();

	// A live pending signup for this address paces re-submits the same way the
	// resend endpoint does — otherwise "submit the form again" is an unlimited
	// mail cannon aimed at whatever address was typed in.
	const [pending] = await db.query(
		'SELECT resend_count, last_sent_at FROM email_verifications WHERE email = ? AND expires_at > NOW()',
		[normalizedEmail]
	);

	let resendCount = 0;
	if (pending.length > 0) {
		const wait = cooldownRemaining(pending[0].last_sent_at);
		if (wait > 0) {
			throw new OtpError(429, `A code was just sent. Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another.`, { retryAfterSeconds: wait });
		}
		if (pending[0].resend_count + 1 >= OTP_MAX_SENDS) {
			throw new OtpError(429, 'Too many verification codes requested for this address. Please try again later.');
		}
		resendCount = pending[0].resend_count + 1;
	}

	const assignedRole = normalizeRole(role) === ROLE_KEYS.PESO_ADMINISTRATOR
		? ROLE_KEYS.PESO_ADMINISTRATOR
		: ROLE_KEYS.JOB_SEEKER;

	const salt = await bcrypt.genSalt(12);
	const passwordHash = await bcrypt.hash(normalizedPassword, salt);

	return issueAndSend({
		email: normalizedEmail,
		name: normalizedName,
		passwordHash,
		role: assignedRole,
		resendCount
	});
}

/**
 * Re-sends a code for an already-staged signup. Reuses the stored name /
 * password / role, so the client never has to hold the password to resend.
 */
async function resendVerification({ email }) {
	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail) throw new OtpError(400, 'Email is required.');

	const [rows] = await db.query(
		'SELECT name, password_hash, role, resend_count, last_sent_at FROM email_verifications WHERE email = ?',
		[normalizedEmail]
	);
	if (rows.length === 0) {
		throw new OtpError(404, 'No pending registration found for this address. Please start again.');
	}

	const pending = rows[0];

	const wait = cooldownRemaining(pending.last_sent_at);
	if (wait > 0) {
		throw new OtpError(429, `Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another code.`, { retryAfterSeconds: wait });
	}
	if (pending.resend_count + 1 >= OTP_MAX_SENDS) {
		throw new OtpError(429, 'Too many verification codes requested for this address. Please start the registration again later.');
	}

	// Guard the window between staging and verifying: someone else could have
	// registered this address in the meantime (or an admin created it).
	const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
	if (existingUsers.length > 0) {
		await db.query('DELETE FROM email_verifications WHERE email = ?', [normalizedEmail]);
		throw new OtpError(409, 'Email address is already registered. Please sign in instead.');
	}

	return issueAndSend({
		email: normalizedEmail,
		name: pending.name,
		passwordHash: pending.password_hash,
		role: pending.role,
		resendCount: pending.resend_count + 1
	});
}

/**
 * Step 2. On a correct, unexpired code this is where the account is finally
 * created — and the ONLY place this flow writes to `users`.
 */
async function verifyAndCreateAccount({ email, code }) {
	const normalizedEmail = normalizeEmail(email);
	const normalizedCode = String(code || '').trim();

	if (!normalizedEmail || !normalizedCode) {
		throw new OtpError(400, 'Email and verification code are required.');
	}
	if (!/^\d{6}$/.test(normalizedCode)) {
		throw new OtpError(400, 'Enter the 6-digit code from your email.');
	}

	const [rows] = await db.query(
		`SELECT id, name, password_hash, role, otp_hash, attempts,
		        (expires_at < NOW()) AS is_expired
		   FROM email_verifications WHERE email = ?`,
		[normalizedEmail]
	);
	if (rows.length === 0) {
		throw new OtpError(404, 'No pending registration found for this address. Please start again.');
	}

	const pending = rows[0];

	if (Number(pending.is_expired) === 1) {
		await db.query('DELETE FROM email_verifications WHERE id = ?', [pending.id]);
		throw new OtpError(410, 'This code has expired. Please request a new one.');
	}

	if (pending.attempts >= OTP_MAX_ATTEMPTS) {
		await db.query('DELETE FROM email_verifications WHERE id = ?', [pending.id]);
		throw new OtpError(429, 'Too many incorrect attempts. Please start the registration again.');
	}

	if (!hashesMatch(hashCode(normalizedCode), pending.otp_hash)) {
		// Increment in SQL, not in JS, so two concurrent guesses cannot both read
		// the same count and each write back the same +1.
		await db.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?', [pending.id]);
		const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (pending.attempts + 1));
		throw new OtpError(400,
			remaining > 0
				? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
				: 'Incorrect code. Please request a new one.',
			{ attemptsRemaining: remaining }
		);
	}

	// Correct code. Create the account.
	let insertResult;
	try {
		[insertResult] = await db.query(
			'INSERT INTO users (name, email, password, role, email_verified_at) VALUES (?, ?, ?, ?, NOW())',
			[pending.name, normalizedEmail, pending.password_hash, pending.role]
		);
	} catch (error) {
		if (error.code === 'ER_DUP_ENTRY') {
			await db.query('DELETE FROM email_verifications WHERE id = ?', [pending.id]);
			throw new OtpError(409, 'Email address is already registered. Please sign in instead.');
		}
		throw error;
	}

	// Consume the code. A failure here cannot un-create the user, so it is
	// logged rather than thrown: the row expires on its own, and the ER_DUP_ENTRY
	// branch above already handles a replayed code.
	try {
		await db.query('DELETE FROM email_verifications WHERE id = ?', [pending.id]);
	} catch (error) {
		console.warn('[OTP] Could not clear consumed verification row:', error.message);
	}

	return { id: insertResult.insertId, name: pending.name, email: normalizedEmail, role: pending.role };
}

module.exports = {
	OtpError,
	startVerification,
	resendVerification,
	verifyAndCreateAccount,
	// exported for tests / diagnostics
	getOtpTtlMinutes,
	OTP_RESEND_COOLDOWN_SECONDS,
	OTP_MAX_ATTEMPTS
};
