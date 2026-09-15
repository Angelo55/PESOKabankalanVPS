-- ============================================================================
-- 021_referral_letter_files.sql
--
-- Durable storage for referral letter PDFs.
--
-- ── The problem ─────────────────────────────────────────────────────────────
-- referral_letters.pdf_path points into storage/referrals/ and the download
-- route serves it with fs.createReadStream. Render's filesystem is EPHEMERAL:
-- every deploy wipes it. The database rows survive and keep asserting the
-- letters exist, so the system ends up with N referrals whose signed government
-- document is simply gone. The download route already carries the string "The
-- letter file is missing from storage" -- written by someone who saw this
-- coming.
--
-- This is invariant 0.5 (durable binaries live in the DB as base64), which
-- application_resumes already honours for the per-application resume snapshot.
-- The referral letter -- the one artifact that actually carries a government
-- signature -- was the binary that never got the same treatment.
--
-- Measured before writing this: 42 files on disk against 27 rows in
-- referral_letters. The store has already drifted.
--
-- ── EXPAND phase of expand -> migrate -> contract ───────────────────────────
--   expand   (here)  add the table; the worker begins writing BOTH disk and DB
--   migrate  (code)  every reader prefers the DB row, falls back to disk
--   contract (later) stop writing disk, drop pdf_path -- only once a deploy has
--                    proven the DB path works in production
--
-- pdf_path is deliberately NOT dropped. Existing rows still point at real files
-- and the backfill (scripts/backfill-referral-letters.js) needs them to find
-- what to import. Dropping a populated column on live TiDB is irreversible;
-- invariant 0.7 freezes physical names unless a migration explicitly renames.
--
-- ── Why a separate table and not a LONGTEXT on referral_letters ─────────────
-- referral_letters is read on every list, every ATS render and every referral
-- detail. Hanging a ~200KB base64 column off it means every one of those
-- queries drags the PDF along unless each SELECT is audited for an explicit
-- column list -- exactly the trap that made avatar_thumb necessary in 019.
-- A separate table cannot be pulled in by accident: you only get the bytes if
-- you deliberately JOIN for them.
--
-- ── Retention ───────────────────────────────────────────────────────────────
-- purge_after is nullable and nothing enforces it yet. PESO has not confirmed
-- the statutory retention period, so this migration stores letters indefinitely
-- and leaves a column for the policy once someone establishes it. The RECORD
-- (referral_letters row: name, employer, reference number, dates) is never
-- covered by this -- only the PDF bytes -- so aging out a document can never
-- destroy the reporting history DOLE figures are computed from.
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_letter_files (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,
	reference_number VARCHAR(100) NOT NULL,

	-- The PDF itself, base64-encoded. LONGTEXT holds up to 4GB; a referral
	-- letter is ~40-60KB raw, so ~55-80KB encoded.
	content_base64 LONGTEXT NOT NULL,

	-- Raw byte count before encoding. Cheap to store, and it lets an integrity
	-- check spot a truncated row without decoding the payload.
	byte_size INT NOT NULL,

	-- 'generated' = produced by the worker, 'backfilled' = imported from disk by
	-- scripts/backfill-referral-letters.js. Kept so the backfill is auditable
	-- and re-runnable without guessing which rows it already touched.
	source ENUM('generated', 'backfilled') NOT NULL DEFAULT 'generated',

	-- Reserved for the retention policy. NULL = keep indefinitely (today's
	-- behaviour). Nothing reads this yet.
	purge_after DATETIME NULL DEFAULT NULL,

	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

	-- One letter per referral. Makes the worker's write idempotent: a retry
	-- after a partial failure re-runs the same INSERT ... ON DUPLICATE KEY
	-- UPDATE and cannot produce a second copy.
	CONSTRAINT uq_rlf_queue UNIQUE (queue_id),
	CONSTRAINT fk_rlf_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	INDEX idx_rlf_reference (reference_number)
);
