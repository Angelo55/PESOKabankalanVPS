-- ============================================================================
-- 019_avatar_thumb_and_verification_id.sql
--
-- Two independent `users` additions, batched into one migration because both
-- are additive columns on the same table.
--
-- ── 1. avatar_thumb ─────────────────────────────────────────────────────────
-- Avatars are stored as base64 data URIs on `users.avatar_url`, averaging
-- 319KB (max 490KB). Any LIST that shows faces therefore paid ~2.2MB per page
-- (measured on a 7-applicant ATS job). `avatar_thumb` holds a small square
-- thumbnail (~96px, typically 10-25KB) so list endpoints can select the thumb
-- and never touch the full-size column.
--
-- Thumbnails are produced CLIENT-SIDE with a canvas at upload time. That avoids
-- adding a native image dependency (sharp/jimp) to a Render deployment, and the
-- browser already holds the decoded image, so it is the cheapest place to do it.
--
-- Reads use COALESCE(avatar_thumb, avatar_url): rows uploaded before this
-- migration have no thumb and gracefully fall back to the full image rather
-- than regressing to a blank/initial avatar.
--
-- ── 2. verification_id_type ─────────────────────────────────────────────────
-- `users.pwd_category` has been carrying the job seeker's GOVERNMENT ID TYPE
-- ("Philippine Passport", "Postal ID", …), not a PWD classification. SKILL.md
-- §11 documented that as a deliberate legacy compromise — labels and API keys
-- were renamed while the physical column stayed. That is semantically wrong and
-- actively confusing next to the genuine PWD fields.
--
-- This is the EXPAND phase of an expand → migrate → contract refactor:
--   expand   (here) add verification_id_type and backfill from pwd_category
--   migrate  (code) read the new column, write BOTH during transition
--   contract (later, separate migration) drop pwd_category once verified
--
-- pwd_category is intentionally NOT dropped here. Dropping a populated column
-- on live TiDB is irreversible, and invariant 0.7 freezes physical names unless
-- a migration explicitly renames them. Keeping both lets the app be verified in
-- production before anything is destroyed.
-- ============================================================================

ALTER TABLE users
	ADD COLUMN avatar_thumb LONGTEXT NULL DEFAULT NULL;

ALTER TABLE users
	ADD COLUMN verification_id_type VARCHAR(120) NULL DEFAULT NULL;

-- Backfill: every existing value in pwd_category IS an ID type, so it moves
-- across verbatim. Idempotent — only fills rows not already set.
UPDATE users
SET verification_id_type = pwd_category
WHERE verification_id_type IS NULL
  AND pwd_category IS NOT NULL
  AND pwd_category <> '';
