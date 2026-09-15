/**
 * Phone-ownership verification (OTP-to-phone) for the SMS channel (#8).
 *
 * SINGLE WRITER for the `phone_verifications` table and for the
 * `users.phone_verified_at` stamp. Proves a seeker owns the number before any SMS is
 * sent to it — the consent/verification guard the office asked for
 * (docs/sms-notification-proposal.md §5). Reuses the §7.9 OTP discipline exactly:
 * crypto.randomInt, a peppered SHA-256 (not bcrypt — the space is 1e6 and closed by
 * the attempt cap + TTL), constant-time compare, TTL, resend cooldown, attempt caps.
 *
 * SEPARATION OF CONCERNS: verifying the phone proves OWNERSHIP; it does NOT opt the
 * user in to receiving SMS. Opt-in (users.sms_opt_in) is a separate explicit toggle,
 * so a user can verify a number and still choose not to receive texts. The channel
 * router requires BOTH (verified AND opted-in) before it fans out.
 *
 * The verification code is delivered via smsService directly (inline), NOT the outbox
 * — the user is staring at a "enter the code" screen, so it must not wait a poll
 * cycle. sendSms never throws (§0.1); a send failure surfaces as delivered:false and
 * the user resends, exactly like the email OTP's de-fatalised path.
 */

const crypto = require('crypto');
const db = require('../db');
const { sendSms, isSmsConfigured, toE164PH } = require('./smsService');
const { APP_NAME } = require('./smsTemplates');

const readInt = (name, fallback) => {
	const parsed = Number.parseInt(process.env[name], 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TTL_MINUTES = () => readInt('SMS_OTP_TTL_MINUTES', 10);
const RESEND_COOLDOWN_SECONDS = readInt('SMS_OTP_RESEND_COOLDOWN_SECONDS', 60);
const MAX_SENDS = readInt('SMS_OTP_MAX_SENDS', 5);
const MAX_ATTEMPTS = readInt('SMS_OTP_MAX_ATTEMPTS', 5);
const CODE_LENGTH = 6;

class PhoneVerifyError extends Error {
	constructor(status, message, extra = {}) {
		super(message);
		this.name = 'PhoneVerifyError';
		this.status = status;
		Object.assign(this, extra);
	}
}

function generateCode() {
	return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

function hashCode(code) {
	const pepper = process.env.JWT_SECRET || 'fallback_secret_key';
	return crypto.createHash('sha256').update(`${pepper}:phone:${code}`).digest('hex');
}

function hashesMatch(a, b) {
	const bufA = Buffer.from(String(a), 'utf8');
	const bufB = Buffer.from(String(b), 'utf8');
	if (bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}

function cooldownRemaining(lastSentAt) {
	if (!lastSentAt) return 0;
	const elapsed = (Date.now() - new Date(lastSentAt).getTime()) / 1000;
	return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
}

/**
 * Step 1: stage a code for this user's phone and text it. Creates/updates exactly one
 * pending row per user (UNIQUE user_id upsert). Returns { delivered, expiresInMinutes }.
 */
async function startVerification({ userId, phone }) {
	if (!userId) throw new PhoneVerifyError(400, 'Sign in to verify a phone number.');
	if (!isSmsConfigured()) throw new PhoneVerifyError(503, 'SMS verification is temporarily unavailable.');

	const e164 = toE164PH(phone);
	if (!e164) throw new PhoneVerifyError(400, 'Enter a valid Philippine mobile number (e.g. 09XX XXX XXXX).');

	// Pace re-requests the same way resend does — otherwise "start again" is an SMS cannon.
	const [existing] = await db.query(
		'SELECT resend_count, last_sent_at, (expires_at > NOW()) AS live FROM phone_verifications WHERE user_id = ?',
		[userId]
	);
	let resendCount = 0;
	if (existing.length > 0 && Number(existing[0].live) === 1) {
		const wait = cooldownRemaining(existing[0].last_sent_at);
		if (wait > 0) throw new PhoneVerifyError(429, `A code was just sent. Wait ${wait}s before requesting another.`, { retryAfterSeconds: wait });
		if (existing[0].resend_count + 1 >= MAX_SENDS) throw new PhoneVerifyError(429, 'Too many codes requested. Please try again later.');
		resendCount = existing[0].resend_count + 1;
	}

	const code = generateCode();
	const otpHash = hashCode(code);
	const ttl = TTL_MINUTES();

	await db.query(
		`INSERT INTO phone_verifications (user_id, phone, otp_hash, expires_at, attempts, resend_count, last_sent_at)
		 VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, ?, NOW())
		 ON DUPLICATE KEY UPDATE
		   phone = VALUES(phone), otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at),
		   attempts = 0, resend_count = VALUES(resend_count), last_sent_at = NOW()`,
		[userId, e164, otpHash, ttl, resendCount]
	);

	const body = `${APP_NAME}: Your verification code is ${code}. It expires in ${ttl} minutes. Never share this code.`;
	const result = await sendSms(e164, body);

	if (!result.ok) {
		// Back-date last_sent_at so a failed send does not burn the resend cooldown.
		try {
			await db.query('UPDATE phone_verifications SET last_sent_at = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE user_id = ?', [RESEND_COOLDOWN_SECONDS, userId]);
		} catch (_) { /* best effort */ }
	}

	return { delivered: !!result.ok, expiresInMinutes: ttl, phone: e164 };
}

/**
 * Step 2: confirm a code. On success, stamps users.phone_verified_at, persists the
 * verified number to users.phone, and clears the staging row. Does NOT opt the user in.
 */
async function confirmVerification({ userId, code }) {
	if (!userId) throw new PhoneVerifyError(400, 'Sign in to verify a phone number.');
	const normalized = String(code || '').trim();
	if (!/^\d{6}$/.test(normalized)) throw new PhoneVerifyError(400, 'Enter the 6-digit code from the text message.');

	const [rows] = await db.query(
		`SELECT id, phone, otp_hash, attempts, (expires_at < NOW()) AS is_expired
		   FROM phone_verifications WHERE user_id = ?`,
		[userId]
	);
	if (rows.length === 0) throw new PhoneVerifyError(404, 'No pending verification. Start again.');
	const pending = rows[0];

	if (Number(pending.is_expired) === 1) {
		await db.query('DELETE FROM phone_verifications WHERE id = ?', [pending.id]);
		throw new PhoneVerifyError(410, 'This code has expired. Please request a new one.');
	}
	if (pending.attempts >= MAX_ATTEMPTS) {
		await db.query('DELETE FROM phone_verifications WHERE id = ?', [pending.id]);
		throw new PhoneVerifyError(429, 'Too many incorrect attempts. Please start again.');
	}
	if (!hashesMatch(hashCode(normalized), pending.otp_hash)) {
		await db.query('UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?', [pending.id]);
		const remaining = Math.max(0, MAX_ATTEMPTS - (pending.attempts + 1));
		throw new PhoneVerifyError(400, remaining > 0 ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Incorrect code. Request a new one.', { attemptsRemaining: remaining });
	}

	await db.query('UPDATE users SET phone = ?, phone_verified_at = NOW() WHERE id = ?', [pending.phone, userId]);
	try { await db.query('DELETE FROM phone_verifications WHERE id = ?', [pending.id]); }
	catch (error) { console.warn('[PhoneVerify] Could not clear consumed row:', error.message); }

	return { verified: true, phone: pending.phone };
}

/** Explicit opt-in/opt-out toggle. Opt-IN requires a verified phone; opt-out is always allowed. */
async function setOptIn({ userId, optIn }) {
	if (!userId) throw new PhoneVerifyError(400, 'Sign in to change SMS preferences.');
	if (optIn) {
		const [rows] = await db.query('SELECT phone_verified_at FROM users WHERE id = ?', [userId]);
		if (!rows.length || !rows[0].phone_verified_at) {
			throw new PhoneVerifyError(400, 'Verify your mobile number before turning on SMS alerts.');
		}
	}
	await db.query('UPDATE users SET sms_opt_in = ? WHERE id = ?', [optIn ? 1 : 0, userId]);
	return { optIn: !!optIn };
}

module.exports = { PhoneVerifyError, startVerification, confirmVerification, setOptIn };
