-- ============================================================================
-- Migration: 004_referral_pipeline_start_at_notify
--
-- Phase 3 implements ONE pipeline step: 'notify'. The 'generate_pdf' and
-- 'send_email' handlers arrive in Phases 4 and 5.
--
-- Existing outbox rows were enqueued at step = 'generate_pdf', for which no
-- handler exists. The worker would claim them, find no handler, and fail them.
-- Repoint them at the first step that is actually implemented.
--
-- Only 'pending' rows are touched. A completed or failed job is history and is
-- never rewritten.
--
-- NOTE: this is intentionally NOT a schema change. The step ENUM already holds
-- every value the finished pipeline needs. Only the ORDER of steps changes, and
-- that order lives in services/referralPipeline.js -- one file, not the database.
-- ============================================================================

UPDATE referral_jobs
SET step = 'notify', next_run_at = CURRENT_TIMESTAMP
WHERE status = 'pending' AND step = 'generate_pdf';