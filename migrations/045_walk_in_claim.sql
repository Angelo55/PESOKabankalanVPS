-- ============================================================================
-- 045_walk_in_claim.sql  —  Walk-In account CLAIM lifecycle (#7, deferred half)
--
-- WHAT THIS ADDS
-- The remaining columns for the CLAIM half of walk-in registration (migration 043
-- added the encode half). A staff-encoded walk-in row is claimed later by the real
-- person: they present the claim code PESO gave them, prove ownership, and set their
-- own email + password on the SAME existing users row — no second account.
--   claim_token_expires_at — the code expires (default 30 days); an expired code is
--                            refused and staff reissue a fresh one.
--   claim_reissued_at / claim_reissue_count — audit trail for reissues.
--
-- SECURITY CHANGE (code, not schema): from this migration on, users.claim_token
-- stores a PEPPERED SHA-256 HASH of the claim code, never the raw code — the OTP
-- pattern (§7.9). The raw code is shown to staff / texted to the seeker exactly once
-- at creation; a database dump alone can no longer be used to hijack a walk-in
-- account. The existing VARCHAR(64) column already fits a 64-char hex hash.
--
-- SAFETY
-- Additive only, ADD COLUMN IF NOT EXISTS (instant metadata change on TiDB, same as
-- 043/044). No existing table rewritten, no data touched, no foreign keys. Feature
-- stays behind walk_in_registration_enabled. Safe to re-run.
-- ============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS claim_token_expires_at DATETIME NULL,
    ADD COLUMN IF NOT EXISTS claim_reissued_at      DATETIME NULL,
    ADD COLUMN IF NOT EXISTS claim_reissue_count    INT NOT NULL DEFAULT 0;
