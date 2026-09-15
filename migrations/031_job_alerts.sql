-- ============================================================================
-- 031_job_alerts.sql  —  Enhancement D: AI-powered job alerts
--
-- WHAT THIS ADDS
-- The tables for proactively emailing job seekers when a newly published vacancy
-- matches their resume above an AI threshold — bounded, deduped, digest-capable:
--   • job_alert_jobs        — outbox: one MATCH task per published job, drained by
--                             services/jobMatchWorker.js (candidate generation →
--                             AI score → threshold → deliver). Same outbox pattern
--                             as referral_jobs / email_outbox (§7.5).
--   • job_alerts_sent       — one row per (seeker, job) ever alerted: the DEDUP
--                             guarantee (never alert twice) and the audit trail.
--                             `delivered = 0` = staged for the daily digest;
--                             `delivered = 1` = emailed (immediate or digested).
--   • job_alert_preferences — per-seeker frequency (immediate | daily | off),
--                             optional personal score floor, and an unsubscribe
--                             token for the one-click opt-out in every alert email.
--
-- The reverse-scoring cost is bounded by cheap SQL candidate generation + a
-- configurable candidate cap + a per-day cap (system settings), never a full AI
-- fan-out. Emails ride the P2C email outbox; the whole feature is gated by
-- JOB_ALERTS_ENABLED (worker dormant unless set), so it ships dark.
--
-- SAFETY: additive only, CREATE TABLE IF NOT EXISTS — instant metadata change on
-- TiDB, no downtime, no touch to existing tables, safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_alert_jobs (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    job_id       INT NOT NULL,
    status       ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
    attempts     INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 4,
    next_run_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at    DATETIME NULL,
    worker_id    VARCHAR(64) NULL,
    last_error   VARCHAR(1000) NULL,
    matched      INT NOT NULL DEFAULT 0,       -- seekers matched (for the monitor)
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_job_alert_job (job_id),
    INDEX idx_job_alert_claim (status, next_run_at)
);

CREATE TABLE IF NOT EXISTS job_alerts_sent (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    job_id      INT NOT NULL,
    match_score INT NULL,
    channel     VARCHAR(20) NOT NULL DEFAULT 'email',   -- email | digest
    delivered   TINYINT(1) NOT NULL DEFAULT 0,           -- 0 staged for digest, 1 emailed
    reason      VARCHAR(500) NULL,                        -- short "why recommended"
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at     DATETIME NULL,
    UNIQUE KEY uq_job_alerts_sent (user_id, job_id),
    INDEX idx_job_alerts_user (user_id, delivered)
);

CREATE TABLE IF NOT EXISTS job_alert_preferences (
    user_id           INT PRIMARY KEY,
    frequency         VARCHAR(20) NOT NULL DEFAULT 'daily',  -- immediate | daily | off
    min_score         INT NULL,                               -- personal floor (else system default)
    unsubscribe_token VARCHAR(64) NULL,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_job_alert_unsub (unsubscribe_token)
);
