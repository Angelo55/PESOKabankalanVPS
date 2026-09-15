-- ============================================================================
-- 024_referral_void.sql
--
-- Adds a 'Voided' state so a referral issued in error can be cancelled.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
-- Once approved, a referral could only be retried. There was no way to cancel
-- one issued to the wrong applicant, or one where the employer withdrew the
-- vacancy. The reference number stayed consumed and — worse — the vacancy slot
-- stayed occupied, so a posting could sit permanently "Filled" against a
-- referral everyone knew was void.
--
-- ── Void, never delete ──────────────────────────────────────────────────────
-- The row stays. A referral letter was generated, emailed, and received by a
-- citizen; deleting the record would erase the fact that it happened, which is
-- exactly what an audit trail exists to prevent. 'Voided' records that it
-- happened AND that it was cancelled, with a mandatory reason.
--
-- ── The vacancy slot is released automatically ──────────────────────────────
-- The cap is count-based (SKILL §7.8, invariant 0.12): capacity is compared
-- against COUNT(*) of referrals with status = 'Approved'. Because 'Voided' is
-- not 'Approved', voiding releases the slot with no separate bookkeeping — the
-- same property that makes the count-based design correct in the first place.
-- referralService.voidReferral additionally reopens a posting that had been
-- flipped to 'Filled', inside the same transaction.
--
-- ── TiDB enum rules ─────────────────────────────────────────────────────────
-- APPENDED at the end of the list. TiDB supports appending enum values as an
-- instant metadata change; reordering or removing rewrites the column and is
-- not safe on a live table. Existing rows keep their values untouched.
-- Migration 014 exists because this rule was violated once already: the app
-- wrote a value the enum did not have, WARN_DATA_TRUNCATED (errno 1265) rolled
-- back the enclosing transaction, and referral approval 500'd.
-- ============================================================================

ALTER TABLE referral_queue
	MODIFY COLUMN status ENUM(
		'Pending AI',
		'Pending Review',
		'Approved',
		'Rejected',
		'Voided'
	) NOT NULL DEFAULT 'Pending AI';

-- Who voided it, when, and why. Kept on referral_queue rather than in a side
-- table because there is exactly one void per referral and the reason has to
-- travel with the row every list already reads.
ALTER TABLE referral_queue
	ADD COLUMN voided_at DATETIME NULL DEFAULT NULL;

ALTER TABLE referral_queue
	ADD COLUMN voided_by INT NULL DEFAULT NULL;

ALTER TABLE referral_queue
	ADD COLUMN void_reason VARCHAR(500) NULL DEFAULT NULL;
