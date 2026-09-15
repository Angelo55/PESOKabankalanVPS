-- ============================================================================
-- 034_saved_jobs_snapshot.sql  —  Saved Vacancies lightweight bookmark refactor
--
-- WHAT THIS ADDS
-- Snapshot + tracking columns on `saved_jobs` so the module can be a true
-- bookmark manager instead of a second job-details/AI surface.
--
-- WHY SNAPSHOTS
-- A PESO Administrator "removing" a vacancy is a HARD delete
-- (routes/pesoAdminRoutes.js: DELETE FROM pesoadmin_job_posts). `saved_jobs`
-- has no FK/cascade to the job, and GET /saved-jobs used an INNER JOIN, so a
-- removed job's bookmark simply VANISHED from the user's list. To show an honest
-- "This job posting is no longer available" tombstone (with the job's title and
-- employer), the bookmark must carry a minimal snapshot captured at save time —
-- there is nothing left to read once the job row is gone. GET /saved-jobs moves
-- to a LEFT JOIN and reads pj.* when the job still exists, falling back to these
-- snapshot columns when it does not.
--
--   job_title / job_company / job_location  — shown on the tombstone; also a
--       stable label if the live job row is later edited/removed.
--   last_checked_at — when the bookmark's status was last validated (updated on
--       each list load). Powers the "last checked" UI hint.
--
-- SAFETY: purely additive. IF NOT EXISTS makes it idempotent / re-runnable. The
-- backfill only FILLS snapshots for bookmarks whose job still exists and that do
-- not already have one; it writes nothing destructive and touches no other table.
-- Old rows whose job was already deleted stay NULL (nothing to backfill from) and
-- render a generic "no longer available" tombstone — correct, not a regression.
-- ============================================================================

ALTER TABLE saved_jobs
    ADD COLUMN IF NOT EXISTS job_title VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE saved_jobs
    ADD COLUMN IF NOT EXISTS job_company VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE saved_jobs
    ADD COLUMN IF NOT EXISTS job_location VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE saved_jobs
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP NULL DEFAULT NULL;

-- Backfill the snapshot for existing bookmarks whose vacancy still exists.
-- Idempotent: only fills rows that do not already carry a title snapshot.
UPDATE saved_jobs sj
JOIN pesoadmin_job_posts pj ON sj.job_id = pj.id
SET sj.job_title    = pj.title,
    sj.job_company  = pj.company,
    sj.job_location = pj.location
WHERE sj.job_title IS NULL;
