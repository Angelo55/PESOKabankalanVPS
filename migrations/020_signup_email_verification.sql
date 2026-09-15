-- ============================================================================
-- 020_signup_email_verification.sql
--
-- Email (OTP) ownership verification for NEW registrations only.
--
-- ── Design: the pending signup does NOT live in `users` ─────────────────────
-- The requirement is "prevent account creation until successful verification".
-- The obvious shortcut — INSERT the user with a `verified = 0` flag and block
-- login — actually DOES create the account: it burns the email address, shows
-- up in every COUNT(*) on the landing page and admin metrics, and leaves a
-- password hash for an address nobody has proven they own.
--
-- So the pending signup is staged in its own table and the `users` row is
-- INSERTed only after the correct OTP is presented. An abandoned signup simply
-- expires; nothing in the rest of the system ever sees it.
--
-- ── Backward compatibility (explicit requirement) ───────────────────────────
-- `users.email_verified_at` is added as NULL-by-default and is INFORMATIONAL
-- ONLY. Nothing in the login path reads it. Existing rows keep NULL forever and
-- are never asked to re-verify. Accounts created through the new OTP flow (and
-- Google OAuth accounts, whose address Google already verified) stamp it at
-- creation, which is what makes it a useful audit signal rather than a gate.
-- If a future change ever wants to gate on this column, it MUST grandfather
-- `email_verified_at IS NULL` as "legacy, trusted".
--
-- ── Security notes ──────────────────────────────────────────────────────────
-- * `otp_hash` stores SHA-256(pepper + code), never the 6 digits. A dump of
--   this table does not let anyone complete a pending signup.
-- * `password_hash` is already bcrypt at this point — the plaintext password
--   never reaches this table.
-- * `attempts` caps guessing (6 digits = 1e6 space; 5 tries is not brute-force
--   territory). `resend_count` + `last_sent_at` cap outbound mail so the form
--   cannot be used to spray a third party's inbox.
-- * UNIQUE(email) means one live pending signup per address; a re-submit
--   overwrites it rather than accumulating rows.
--
-- Table name is new, so the "CREATE TABLE IF NOT EXISTS silently skips a
-- mismatched existing table" trap (SKILL §13) does not apply here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_verifications (
	id BIGINT AUTO_INCREMENT PRIMARY KEY,
	email VARCHAR(255) NOT NULL,
	name VARCHAR(255) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	role VARCHAR(50) NOT NULL,
	otp_hash CHAR(64) NOT NULL,
	expires_at DATETIME NOT NULL,
	attempts INT NOT NULL DEFAULT 0,
	resend_count INT NOT NULL DEFAULT 0,
	last_sent_at DATETIME NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY uniq_email_verifications_email (email),
	KEY idx_email_verifications_expires (expires_at)
);

-- Informational only. See the header — this is NOT a login gate.
ALTER TABLE users
	ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL;
