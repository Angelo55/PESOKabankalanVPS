-- ============================================================================
-- 032_proactive_referrals.sql  —  Proactive AI Referral Workflow (Phase 1)
--
-- WHAT THIS ADDS
-- The PESO-Administrator-initiated ("proactive") referral path: instead of waiting
-- for a job seeker to apply, the system continuously scores EXISTING applicants
-- (seekers who have already submitted >=1 application) against Open/Published
-- vacancies and surfaces the strongest as a review queue an administrator promotes
-- into a real referral. This migration is Phase 1 — the schema + the matcher's
-- storage. Promotion (materialize a job_applications row + reuse approveReferral)
-- is Phase 2 and needs no further schema.
--
--   • proactive_match_jobs         — outbox: one MATCH task per Open/Published job,
--                                    drained by services/proactiveReferralWorker.js
--                                    (candidate generation → AI score → threshold →
--                                    upsert candidates). Same outbox pattern as
--                                    job_alert_jobs / referral_jobs (§7.5).
--   • proactive_referral_candidates — the Smart Referral Queue rows: one per
--                                    (job, applicant) the AI suggests. UNIQUE(job,
--                                    applicant) is the dedup guarantee. status:
--                                    Suggested → Dismissed | Promoted (Promoted =
--                                    an admin approved it and a referral was created).
--   • job_applications.origin       — distinguishes a seeker-submitted application
--                                    ('seeker', the default for every existing row)
--                                    from an admin-initiated proactive referral
--                                    ('admin_referral'), plus who/when. This is what
--                                    lets the seeker dashboard and the letter tell the
--                                    two apart, and blocks a duplicate application.
--
-- The reverse-scoring cost is bounded by cheap SQL candidate generation + a
-- configurable candidate cap (system setting proactive_candidate_cap), never a full
-- AI fan-out. The whole feature is gated by PROACTIVE_REFERRALS_ENABLED (the worker
-- is dormant unless set), so it ships dark.
--
-- SAFETY: additive only — ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- Instant metadata change on TiDB, no downtime, no rewrite of existing rows, safe to
-- re-run. The enum on job_applications.origin is created with both values up front;
-- future values would be APPEND-only (§13).
-- ============================================================================

-- 1. Provenance on the application row. Every existing application is a seeker's own
--    ('seeker'), so the default backfills the whole table with the correct value and
--    nothing needs updating.
ALTER TABLE job_applications
    ADD COLUMN IF NOT EXISTS origin ENUM('seeker','admin_referral') NOT NULL DEFAULT 'seeker',
    ADD COLUMN IF NOT EXISTS referred_by INT NULL,
    ADD COLUMN IF NOT EXISTS referred_at DATETIME NULL;

-- 2. The match outbox (one task per published job).
CREATE TABLE IF NOT EXISTS proactive_match_jobs (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    job_id       INT NOT NULL,
    status       ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
    attempts     INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 4,
    next_run_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at    DATETIME NULL,
    worker_id    VARCHAR(64) NULL,
    last_error   VARCHAR(1000) NULL,
    matched      INT NOT NULL DEFAULT 0,        -- candidates surfaced (for the monitor)
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proactive_match_job (job_id),
    INDEX idx_proactive_match_claim (status, next_run_at)
);

-- 3. The Smart Referral Queue candidates.
CREATE TABLE IF NOT EXISTS proactive_referral_candidates (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    job_id           INT NOT NULL,
    applicant_id     INT NOT NULL,                 -- users.id of the job seeker
    match_score      INT NULL,                     -- AI overall at suggestion time
    ai_analysis      LONGTEXT NULL,                -- full AI result JSON (for the drawer)
    reason           VARCHAR(500) NULL,            -- short "why recommended"
    status           ENUM('Suggested','Dismissed','Promoted') NOT NULL DEFAULT 'Suggested',
    reviewed_by      INT NULL,                     -- admin who dismissed/promoted
    dismissed_reason VARCHAR(500) NULL,
    promoted_application_id INT NULL,              -- the job_applications row created on promote
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proactive_candidate (job_id, applicant_id),
    INDEX idx_proactive_status (status),
    INDEX idx_proactive_rank (job_id, status, match_score)
);
