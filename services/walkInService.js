/**
 * walkInService — Walk-In Job Seeker registration + account CLAIM (#7).
 *
 * PESO staff encode an applicant who physically visits the office and has no online
 * account into the SAME centralized Job Seeker model: a real `users` row with
 * role='applicant', marked account_origin='walk_in' and claim_status='unclaimed' so
 * the person can later CLAIM it once they have a Gmail / online access. This is NOT
 * the public OTP signup path (§7.9) — no email is required and no code is sent at
 * encode time; the office vouches for the person, records their consent, and can
 * attach applications exactly as an online seeker's.
 *
 * ── THE CLAIM (the deferred half, now built) ────────────────────────────────
 * At encode time a CLAIM CODE is minted. Its peppered SHA-256 HASH is stored in
 * users.claim_token (never the raw code — a DB dump can't hijack the account, §7.9);
 * the RAW code is returned ONCE to staff (to hand over / text). Claiming links the
 * REAL person to the EXISTING row — it never creates a second profile:
 *   startClaim(code)      → validates the code; if a phone is on file and SMS is
 *                           configured, texts a one-time phone OTP as a second factor.
 *   completeClaim(...)    → re-validates the code, verifies the phone OTP when
 *                           required, sets the seeker's own email + password on the
 *                           SAME row, stamps claim_status='claimed'. Duplicate guard:
 *                           the chosen email must not already belong to ANOTHER account.
 * Codes EXPIRE (default 30 days). An expired/exhausted code is refused; staff
 * reissueClaim() a fresh one (audited). Ships behind walk_in_registration_enabled.
 *
 * Duplicate handling at encode time: likely existing seekers (same verified contact)
 * are surfaced so staff can attach to an existing account instead of making a second.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const adminAudit = require('./adminAuditService');
const phoneVerifyService = require('./phoneVerifyService');
const { isSmsConfigured } = require('./smsService');
const smsOutboxService = require('./smsOutboxService');
const smsTemplates = require('./smsTemplates');

const norm = (v) => (v == null ? '' : String(v).trim());
const digits = (v) => norm(v).replace(/\D/g, '');

// A short, human-friendly claim code (no ambiguous chars) — easy to read aloud, type,
// or text. ~50 bits over the 10 chars below; combined with the unclaimed-only lookup
// + expiry + (optional) phone-OTP second factor, strong enough for an office hand-off.
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1
function generateClaimCode() {
	let raw = '';
	for (let i = 0; i < 10; i++) raw += CLAIM_ALPHABET[crypto.randomInt(0, CLAIM_ALPHABET.length)];
	return `${raw.slice(0, 4)}-${raw.slice(4, 7)}-${raw.slice(7, 10)}`; // XXXX-XXX-XXX
}

// Peppered SHA-256 — same discipline as the OTP/claim tokens (§7.9). Normalizes case
// and strips separators so "abcd-efg-hij" and "ABCDEFGHIJ" hash identically.
function hashClaimCode(code) {
	const pepper = process.env.JWT_SECRET || 'fallback_secret_key';
	const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	return crypto.createHash('sha256').update(`${pepper}:claim:${normalized}`).digest('hex');
}

const claimTtlDays = () => {
	const n = Number.parseInt(process.env.WALKIN_CLAIM_TTL_DAYS, 10);
	return Number.isFinite(n) && n > 0 ? n : 30;
};

const maskPhone = (p) => {
	const d = digits(p);
	return d.length > 4 ? `${'•'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : d;
};

/**
 * Likely existing seekers for a would-be walk-in. A shared phone (normalized to
 * digits) or email is a STRONG match; a same normalized name is a WEAK one. Never
 * blocks — it lets staff choose "attach to existing" vs "create new".
 */
async function findPotentialDuplicates({ name, email, phone }) {
	const p = digits(phone);
	const e = norm(email).toLowerCase();
	const n = norm(name).toLowerCase();
	if (!p && !e && !n) return [];

	const [rows] = await db.query(
		`SELECT id, name, email, phone, account_origin, claim_status, created_at
		   FROM users
		  WHERE role = 'applicant'
		    AND (
		      (? <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')','') = ?)
		      OR (? <> '' AND LOWER(email) = ?)
		      OR (? <> '' AND LOWER(name) = ?)
		    )
		  ORDER BY (LOWER(email) = ?) DESC, created_at DESC
		  LIMIT 10`,
		[p, p, e, e, n, n, e]
	);
	// Tag the match strength so the UI can rank "same phone/email" above "same name".
	return rows.map((r) => ({
		...r,
		match: (digits(r.phone) && digits(r.phone) === p) || (norm(r.email).toLowerCase() === e && e)
			? 'strong' : 'weak',
	}));
}

/**
 * Create a walk-in seeker (real users row). `force` skips the duplicate short-circuit
 * once staff have reviewed the matches. Returns { userId, claimCode, expiresAt } on
 * success (claimCode is the RAW code, shown once), or { duplicates } when matches exist
 * and force was not set.
 */
async function createWalkInSeeker({
	staffId, name, email, phone, gender, location, skills, preferred_roles,
	educational_attainment, experience_level, consent, force = false,
}) {
	const cleanName = norm(name);
	if (!cleanName) { const e = new Error('The applicant name is required.'); e.status = 400; throw e; }
	if (!consent) { const e = new Error('Data-privacy consent is required to encode a walk-in applicant.'); e.status = 400; throw e; }

	if (!force) {
		const duplicates = await findPotentialDuplicates({ name: cleanName, email, phone });
		if (duplicates.length > 0) return { duplicates };
	}

	// A real, but unusable-until-claimed, credential set: a random bcrypt hash (no one
	// can log in with it) and a UNIQUE placeholder email when none was provided. The
	// seeker replaces both at claim time. The claim code's HASH is stored; the raw code
	// is returned once for staff to hand over / text.
	const randomPassword = crypto.randomBytes(24).toString('hex');
	const passwordHash = await bcrypt.hash(randomPassword, 10);
	const claimCode = generateClaimCode();
	const claimTokenHash = hashClaimCode(claimCode);
	const ttlDays = claimTtlDays();
	const providedEmail = norm(email).toLowerCase();
	const placeholderEmail = `walkin.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@walk-in.peso-kabankalan.local`;
	const finalEmail = providedEmail || placeholderEmail;

	try {
		const [result] = await db.query(
			`INSERT INTO users
			   (name, email, password, role, phone, gender, location, skills, preferred_roles,
			    educational_attainment, experience_level, account_status, account_origin,
			    claim_status, encoded_by, claim_token, claim_token_expires_at, consent_given_at)
			 VALUES (?, ?, ?, 'applicant', ?, ?, ?, ?, ?, ?, ?, 'Active', 'walk_in', 'unclaimed', ?, ?,
			         DATE_ADD(NOW(), INTERVAL ? DAY), NOW())`,
			[cleanName, finalEmail, passwordHash, norm(phone) || null, norm(gender) || null,
			 norm(location) || null, norm(skills) || null, norm(preferred_roles) || null,
			 norm(educational_attainment) || null, norm(experience_level) || null, staffId,
			 claimTokenHash, ttlDays]
		);
		const userId = result.insertId;

		adminAudit.record({
			adminId: staffId,
			action: adminAudit.AUDIT_ACTIONS.WALKIN_CREATED,
			targetEntity: cleanName,
			targetId: userId,
			details: `Walk-in applicant encoded${providedEmail ? ` (${providedEmail})` : ' (no email — placeholder, claimable)'}. Consent recorded. Claim code expires in ${ttlDays} days.`,
		});

		return { userId, claimCode, email: providedEmail || null, phone: norm(phone) || null, expiresInDays: ttlDays };
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') {
			const e = new Error('An account with that email already exists. Attach the application to it instead, or leave the email blank.');
			e.status = 409; throw e;
		}
		throw error;
	}
}

/**
 * Look up a live, unclaimed walk-in by its raw claim code. Returns the row or null.
 * Scoped to account_origin='walk_in' + claim_status='unclaimed' + not expired, so a
 * claimed or expired code never resolves.
 */
async function findClaimable(claimCode) {
	const hash = hashClaimCode(claimCode);
	if (!norm(claimCode)) return null;
	const [rows] = await db.query(
		`SELECT id, name, email, phone, claim_status, claim_token_expires_at,
		        (claim_token_expires_at IS NOT NULL AND claim_token_expires_at < NOW()) AS is_expired
		   FROM users
		  WHERE account_origin = 'walk_in' AND claim_status = 'unclaimed' AND claim_token = ?
		  LIMIT 1`,
		[hash]
	);
	return rows[0] || null;
}

/**
 * Step 1 of claiming: validate the code and, when a phone is on file AND SMS is
 * configured, text a one-time phone OTP as a SECOND ownership factor. Returns
 * { requiresPhoneOtp, maskedPhone, name, placeholderEmail }.
 */
async function startClaim({ claimCode }) {
	const row = await findClaimable(claimCode);
	if (!row) { const e = new Error('That claim code is invalid, already used, or has expired. Ask PESO to reissue it.'); e.status = 404; throw e; }
	if (Number(row.is_expired) === 1) { const e = new Error('This claim code has expired. Ask PESO to reissue a new one.'); e.status = 410; throw e; }

	const requiresPhoneOtp = !!norm(row.phone) && isSmsConfigured();
	if (requiresPhoneOtp) {
		// Reuse the phone-verification OTP (keyed by this walk-in user's id) as the
		// ownership proof — the same discipline used elsewhere. It texts the on-file
		// number; the claimant must read the code back. Best-effort (never throws hard):
		try {
			await phoneVerifyService.startVerification({ userId: row.id, phone: row.phone });
		} catch (err) {
			// If the SMS could not be sent, fall back to code-only rather than blocking a
			// legitimate claim (the code is still the primary bearer proof).
			console.warn('[WalkIn] claim phone-OTP send failed, falling back to code-only:', err.message);
			return { requiresPhoneOtp: false, name: row.name };
		}
	}

	const usesPlaceholder = String(row.email || '').includes('@walk-in.peso-kabankalan.local');
	return {
		requiresPhoneOtp,
		maskedPhone: requiresPhoneOtp ? maskPhone(row.phone) : null,
		name: row.name,
		hasEmailOnFile: !usesPlaceholder,
	};
}

/**
 * Step 2: complete the claim. Verifies the phone OTP when required, ensures the chosen
 * email is not already ANOTHER account's, then sets the seeker's own email + bcrypt
 * password on the SAME row and marks it claimed. Returns the user for JWT issuance.
 * Never creates a new users row — that is the whole point of claiming.
 */
async function completeClaim({ claimCode, email, password, phoneOtp }) {
	const row = await findClaimable(claimCode);
	if (!row) { const e = new Error('That claim code is invalid, already used, or has expired. Ask PESO to reissue it.'); e.status = 404; throw e; }
	if (Number(row.is_expired) === 1) { const e = new Error('This claim code has expired. Ask PESO to reissue a new one.'); e.status = 410; throw e; }

	const cleanEmail = norm(email).toLowerCase();
	const cleanPassword = String(password || '');
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) { const e = new Error('Enter a valid email address for your account.'); e.status = 400; throw e; }
	if (cleanPassword.length < 8) { const e = new Error('Password must be at least 8 characters.'); e.status = 400; throw e; }

	// Ownership second factor: if a phone is on file and SMS is configured, the OTP must
	// check out. Recomputed from the row (never trusted from the client) so it can't be skipped.
	const requiresPhoneOtp = !!norm(row.phone) && isSmsConfigured();
	if (requiresPhoneOtp) {
		if (!norm(phoneOtp)) { const e = new Error('Enter the code we texted to your mobile number.'); e.status = 400; throw e; }
		// Throws PhoneVerifyError (mapped by the route) on a bad/expired code; also stamps
		// phone_verified_at on success, so the claimed account starts with a verified phone.
		await phoneVerifyService.confirmVerification({ userId: row.id, code: phoneOtp });
	}

	// Duplicate guard: the chosen email must not belong to a DIFFERENT account. This is
	// what stops a claim from colliding with an existing profile — claiming links the
	// existing walk-in row, it never spawns a second one.
	const [taken] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [cleanEmail, row.id]);
	if (taken.length > 0) { const e = new Error('That email is already registered to another account. Sign in with it, or use a different email.'); e.status = 409; throw e; }

	const passwordHash = await bcrypt.hash(cleanPassword, 12);
	try {
		await db.query(
			`UPDATE users
			    SET email = ?, password = ?, claim_status = 'claimed', claimed_at = NOW(),
			        claim_token = NULL, claim_token_expires_at = NULL, email_verified_at = NOW()
			  WHERE id = ? AND account_origin = 'walk_in' AND claim_status = 'unclaimed'`,
			[cleanEmail, passwordHash, row.id]
		);
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') { const e = new Error('That email is already registered to another account.'); e.status = 409; throw e; }
		throw error;
	}

	adminAudit.record({
		adminId: null,
		action: adminAudit.AUDIT_ACTIONS.WALKIN_CLAIMED,
		targetEntity: cleanEmail,
		targetId: row.id,
		details: `Walk-in account claimed and linked (${row.name}). Email + password set by the seeker.`,
	});

	const [users] = await db.query('SELECT id, name, email, role, avatar_url, avatar_thumb FROM users WHERE id = ?', [row.id]);
	return users[0];
}

/**
 * Staff reissue: mint a fresh claim code + expiry for an unclaimed walk-in (the old
 * code stops working). Returns the RAW code once. Audited. For a lost/expired code.
 */
async function reissueClaim({ userId, staffId }) {
	const [rows] = await db.query(
		`SELECT id, name, phone, claim_status FROM users
		  WHERE id = ? AND account_origin = 'walk_in' LIMIT 1`,
		[userId]
	);
	const row = rows[0];
	if (!row) { const e = new Error('No walk-in applicant found.'); e.status = 404; throw e; }
	if (row.claim_status === 'claimed') { const e = new Error('This account has already been claimed.'); e.status = 409; throw e; }

	const claimCode = generateClaimCode();
	const ttlDays = claimTtlDays();
	await db.query(
		`UPDATE users
		    SET claim_token = ?, claim_token_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
		        claim_status = 'unclaimed', claim_reissued_at = NOW(), claim_reissue_count = claim_reissue_count + 1
		  WHERE id = ?`,
		[hashClaimCode(claimCode), ttlDays, row.id]
	);

	adminAudit.record({
		adminId: staffId,
		action: adminAudit.AUDIT_ACTIONS.WALKIN_CLAIM_REISSUED,
		targetEntity: row.name,
		targetId: row.id,
		details: `Reissued walk-in claim code (expires in ${ttlDays} days).`,
	});

	return { userId: row.id, claimCode, phone: row.phone || null, expiresInDays: ttlDays };
}

/** Unclaimed walk-ins for the Manager's reissue list (no codes/hashes exposed). */
async function listUnclaimed(limit = 50) {
	const safe = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
	const [rows] = await db.query(
		`SELECT id, name, phone, claim_status, claim_token_expires_at, claim_reissue_count, created_at,
		        (claim_token_expires_at IS NOT NULL AND claim_token_expires_at < NOW()) AS is_expired
		   FROM users
		  WHERE account_origin = 'walk_in' AND claim_status = 'unclaimed'
		  ORDER BY created_at DESC
		  LIMIT ?`,
		[safe]
	);
	return rows.map((r) => ({ ...r, phone: r.phone ? maskPhone(r.phone) : null, is_expired: Number(r.is_expired) === 1 }));
}

/**
 * Send the claim link/code to the seeker's phone by SMS (best-effort). Used at
 * registration + reissue when a mobile is on file and SMS is configured. Never throws.
 */
async function textClaimLink({ userId, name, phone, claimCode, claimUrl }) {
	if (!norm(phone) || !isSmsConfigured()) return { queued: false };
	const body = smsTemplates.walkInClaim({ name, claimCode, claimUrl });
	return smsOutboxService.enqueue({ userId, to: phone, templateKey: 'WALKIN_CLAIM', body });
}

module.exports = {
	findPotentialDuplicates,
	createWalkInSeeker,
	startClaim,
	completeClaim,
	reissueClaim,
	listUnclaimed,
	textClaimLink,
	// exported for tests
	generateClaimCode,
	hashClaimCode,
};
