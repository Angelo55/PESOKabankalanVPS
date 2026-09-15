-- ============================================================================
-- 029_application_scoring.sql  —  Enhancement B: AI applicant ranking + dynamic
-- re-scoring
--
-- WHAT THIS ADDS
-- 1. A separate LIVE compatibility score on job_applications, distinct from the
--    apply-time score. The apply-time `match_score` / `ai_analysis` stay IMMUTABLE
--    — they are the referral decision's source of truth (§7.4) and the apply-time
--    referral-staging trigger. `current_match_score` / `current_ai_analysis` /
--    `scored_at` are the LIVE score the pipeline ranks by; they update in the
--    background when an applicant changes their resume or profile. Re-scoring
--    NEVER auto-stages a referral (invariant 0.4 — a named admin approves each one).
-- 2. A transactional-outbox table draining a re-score worker, exactly like
--    referral_jobs / email_outbox (§7.5). Deduped per application (UNIQUE) so a
--    burst of profile edits collapses into one pending re-score.
--
-- SAFETY: additive only. `ADD COLUMN IF NOT EXISTS` (TiDB extension, already used
-- in this codebase) + `CREATE TABLE IF NOT EXISTS` — instant metadata change, no
-- downtime, no touch to existing data, safe to re-run. The whole feature ships
-- behind `APPLICATION_SCORING_ENABLED` (worker dormant unless set), so this table
-- can sit empty until the flag is flipped.
-- ============================================================================

ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS current_match_score INT NULL;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS current_ai_analysis LONGTEXT NULL;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS scored_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS application_scoring_jobs (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    status         ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
    attempts       INT NOT NULL DEFAULT 0,
    max_attempts   INT NOT NULL DEFAULT 4,
    next_run_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at      DATETIME NULL,
    worker_id      VARCHAR(64) NULL,
    last_error     VARCHAR(1000) NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_app_scoring (application_id),        -- one live re-score per application
    INDEX idx_app_scoring_claim (status, next_run_at)
);
