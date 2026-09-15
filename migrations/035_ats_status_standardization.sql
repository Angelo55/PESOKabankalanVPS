-- ============================================================================
-- 035_ats_status_standardization.sql — couple the ATS status to the referral lifecycle
--
-- CONTEXT
-- `job_applications.status` (VARCHAR(50)) was DECOUPLED from the referral state (which
-- lives in `referral_queue`): every referred application still read 'Applied'. As of
-- 2026-08-04 the ATS is standardized to the PESO office's real workflow —
--   Applied → Under Review → Shortlisted → Referred
-- and `referralService.approveReferral` now sets status='Referred' inside its
-- transaction going forward (voidReferral reverts it to 'Shortlisted'). A REFERRED
-- application is a FINALIZED business record and is excluded from live AI re-scoring
-- (SKILL §18.5); its apply-time `match_score` stays the immutable history.
--
-- WHAT THIS BACKFILLS
--   1. Existing applications with an APPROVED referral → 'Referred' (the current ~34).
--   2. Deprecated active status 'Interview' → 'Shortlisted' (folded into the new set).
-- Terminal legacy values 'Hired'/'Rejected' are LEFT AS-IS — historical rows whose
-- meaning must not be rewritten; they are simply no longer settable and never re-scored.
--
-- SAFETY: DATA-ONLY, no schema change (status is already VARCHAR), idempotent /
-- re-runnable. Statement 1 runs BEFORE statement 2, so an 'Interview' row that is also
-- referred correctly becomes 'Referred', not 'Shortlisted'.
-- ============================================================================

-- 1. Applications with an APPROVED referral are finalized 'Referred' records.
UPDATE job_applications ja
JOIN referral_queue rq ON rq.application_id = ja.id AND rq.status = 'Approved'
SET ja.status = 'Referred'
WHERE ja.status <> 'Referred';

-- 2. Deprecated active status 'Interview' folds into 'Shortlisted'.
UPDATE job_applications SET status = 'Shortlisted' WHERE status = 'Interview';
