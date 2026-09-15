-- ============================================================================
-- 022_referral_letter_archive.sql
--
-- Versioning for referral letters, so a letter can be regenerated without
-- destroying the document that was actually delivered.
--
-- ── Why this is needed ──────────────────────────────────────────────────────
-- The 27 letters issued before the official letterhead and the address fix
-- are missing both: they carry the text-only fallback header and read
-- "a resident of ______" because findReferralById never selected the address
-- columns. Regenerating them produces the letter those citizens SHOULD have
-- received.
--
-- But the old file is the letter they DID receive, and it is the copy sitting
-- in their inbox. Overwriting it would leave the system unable to answer "what
-- did we actually send this person?" -- which for a government referral is the
-- question that matters in a dispute.
--
-- So regeneration ARCHIVES before it overwrites. Nothing is ever deleted.
--
-- ── Why a separate table rather than versioning in place ────────────────────
-- referral_letter_files has UNIQUE(queue_id) -- exactly one current letter per
-- referral -- and every reader depends on that: findLetterFile() returns "the"
-- letter with no version logic anywhere. Widening that key to (queue_id,
-- version) would mean auditing every read for "which version?" and would make
-- it possible to serve the wrong one.
--
-- Instead the working table keeps its meaning untouched (one row = the current
-- letter) and superseded copies move here. Readers need no changes at all, and
-- there is no way for an archived version to be served by accident.
--
-- ── Date accuracy ───────────────────────────────────────────────────────────
-- Worth recording because it drove the decision to allow this: pdfService dates
-- the letter from `reviewed_at || created_at`, NOT from the clock. A regenerated
-- letter therefore carries its ORIGINAL approval date. Regeneration corrects the
-- letterhead and the address; it does not silently re-date a government
-- document.
--
-- ── What regeneration does NOT do ───────────────────────────────────────────
-- It does not re-send anything. No email, no notification, no outbox job. The
-- citizen keeps the copy they already have; this repairs the system's record.
-- Re-issuing a corrected letter to someone is a decision for PESO, per person,
-- and is deliberately not automated here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_letter_archive (
	id INT AUTO_INCREMENT PRIMARY KEY,
	queue_id INT NOT NULL,
	reference_number VARCHAR(100) NOT NULL,

	-- The superseded PDF, verbatim. This is the copy that was delivered.
	content_base64 LONGTEXT NOT NULL,
	byte_size INT NOT NULL,

	-- What the row's `source` was in referral_letter_files before it moved here.
	-- Plain VARCHAR, not an ENUM: this table records history, and history must
	-- not fail to insert because a future source value has not been appended to
	-- an enum yet.
	original_source VARCHAR(32) NOT NULL,

	-- When the original letter row was first created.
	original_created_at TIMESTAMP NULL DEFAULT NULL,

	archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

	-- Free text. Populated by the regeneration script with what changed, so the
	-- archive explains itself years later.
	archived_reason VARCHAR(255) NULL DEFAULT NULL,

	-- NOT unique on queue_id: a letter may be regenerated more than once and
	-- every superseded version is kept.
	CONSTRAINT fk_rla_queue FOREIGN KEY (queue_id) REFERENCES referral_queue(id) ON DELETE CASCADE,
	INDEX idx_rla_queue (queue_id),
	INDEX idx_rla_reference (reference_number)
);

-- Append-only enum change (TiDB supports appending at the END of the list only;
-- reordering or removing is not safe). 'regenerated' marks a letter produced by
-- scripts/regenerate-referral-letters.js rather than by the worker at approval
-- time, so the two are distinguishable forever.
ALTER TABLE referral_letter_files
	MODIFY COLUMN source ENUM('generated', 'backfilled', 'regenerated') NOT NULL DEFAULT 'generated';
