-- ============================================================================
-- Migration: 006_job_featured_image
--
-- Adds an optional featured image to job postings. The value is a RELATIVE
-- public path (e.g. /uploads/job-featured/job-12-1730000000.jpg) served by the
-- existing express.static mount, NOT base64 -- keeping the public job-board
-- payload lightweight. Idempotent: ADD COLUMN IF NOT EXISTS is a no-op if the
-- column already exists (TiDB v6.6.0+ supports this).
-- ============================================================================

ALTER TABLE pesoadmin_job_posts
	ADD COLUMN IF NOT EXISTS featured_image VARCHAR(512) NULL DEFAULT NULL;