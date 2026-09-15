-- ============================================================================
-- 018_soft_delete_trash.sql
--
-- Adds a 7-day recoverable Trash to the two Job Seeker collections:
--   saved_jobs      -> Saved Vacancies
--   usertrackedjobs -> My Applications (Kanban)
--
-- MODEL: soft delete via `deleted_at`.
--   deleted_at IS NULL      -> live, shows on its page
--   deleted_at IS NOT NULL  -> in Trash, restorable until deleted_at + 7 days
--   older than 7 days       -> purged permanently
--
-- WHY THE DELETE IS COMMITTED IMMEDIATELY (rather than deferred until the
-- undo-toast expires): a client-side hold would lose the operation entirely if
-- the tab closed or the user navigated mid-countdown, leaving the two sides
-- disagreeing about whether the item was deleted. Writing `deleted_at` up front
-- makes Trash the durable end state, and "Undo" simply clears the column. The
-- user-visible behaviour is identical, but it survives a closed tab.
--
-- INDEXES: (user_id, deleted_at) serves BOTH access paths — the live list
-- (deleted_at IS NULL) and the Trash list (IS NOT NULL) — so neither degrades
-- into a full scan as these tables grow.
--
-- UNIQUE (user_id, job_id) on saved_jobs is a LATENT BUG FIX. The save endpoint
-- has always used `INSERT IGNORE ... ` whose comment claims it "prevents
-- crashes on double-clicks", but no unique constraint existed, so it silently
-- inserted duplicates instead. Verified safe to add: 58 rows / 58 distinct
-- pairs at time of writing, i.e. no existing duplicates to reconcile. It also
-- gives the save endpoint a real upsert target so re-saving a trashed vacancy
-- revives that row rather than creating a second one alongside it.
-- ============================================================================

ALTER TABLE saved_jobs
	ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE saved_jobs
	ADD INDEX idx_saved_jobs_user_deleted (user_id, deleted_at);

ALTER TABLE saved_jobs
	ADD UNIQUE INDEX uq_saved_jobs_user_job (user_id, job_id);

ALTER TABLE usertrackedjobs
	ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE usertrackedjobs
	ADD INDEX idx_tracked_user_deleted (user_id, deleted_at);
