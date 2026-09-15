-- ============================================================================
-- 014_job_status_published_filled.sql
--
-- pesoadmin_job_posts.status was ENUM('Open','Closed','Draft') -- narrower than
-- the application layer believed. The admin form has offered 'Published' since
-- the job-board work, and the vacancy-management feature auto-flips postings to
-- 'Filled' when their last position is referred. Writing either value raised
-- WARN_DATA_TRUNCATED (errno 1265) and, because the auto-flip runs inside the
-- referral-approval transaction, rolled back the whole approval with a 500.
--
-- New values are APPENDED to the end of the enum -- the only enum alteration
-- TiDB applies as an instant metadata change; existing rows keep their indices.
-- NULL-ability and the 'Open' default are preserved exactly as they were.
-- ============================================================================

ALTER TABLE pesoadmin_job_posts
	MODIFY COLUMN status ENUM('Open','Closed','Draft','Published','Filled') NULL DEFAULT 'Open';
