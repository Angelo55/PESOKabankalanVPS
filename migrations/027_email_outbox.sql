-- ============================================================================
-- 027_email_outbox.sql  —  Phase 2C: generic transactional email outbox
--
-- WHAT THIS ADDS
-- A single durable queue for ALL attachment-less transactional email (password
-- reset, contact-inquiry notification, OTP signup code, misc sends). Drained by
-- services/emailWorker.js exactly the way referral_jobs is drained by
-- services/referralWorker.js — claim with a conditional atomic UPDATE (TiDB has
-- no SKIP LOCKED, skill §7.5), exponential backoff persisted in next_run_at,
-- dead-letter after max_attempts, stuck-row reclaim on boot — but SINGLE-STEP
-- ("send") instead of a multi-step state machine.
--
-- WHY
-- Before this, only referral letters had durable delivery. Every other email was
-- sent inline, best-effort: a provider hiccup at that instant meant the email was
-- LOST — no retry, no record, no resend. This table gives every transactional
-- email the same retry / backoff / dead-letter / admin-resend / monitoring the
-- referral outbox already proves (see docs/phase-2c-email-outbox-plan.md).
--
-- BOUNDARY (deliberate)
-- Referral letters STAY on their own referral_jobs outbox: they carry a PDF
-- attachment and ride a generate_pdf → send_email → notify → dispatch_n8n state
-- machine. This table has NO attachments column in v1 and models only a single
-- send. Do not move referral letters here.
--
-- SAFETY
-- Additive only, CREATE TABLE IF NOT EXISTS — an instant metadata change on TiDB,
-- no downtime, no touch to any existing table, no foreign keys. Independent of
-- migrations 023–026; it only needs the database to exist. Safe to re-run.
-- The whole feature ships behind EMAIL_OUTBOX_ENABLED (unset/false = senders send
-- inline exactly as before and the worker stays dormant), so this table can be
-- created and sit empty until the flag is flipped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_outbox (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    to_email      VARCHAR(255) NOT NULL,
    subject       VARCHAR(500) NOT NULL,
    body_html     LONGTEXT NULL,
    body_text     LONGTEXT NULL,
    category      VARCHAR(60) NOT NULL DEFAULT 'general',   -- otp | password_reset | contact_inquiry | security_alert | welcome | general
    status        ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
    attempts      INT NOT NULL DEFAULT 0,
    max_attempts  INT NOT NULL DEFAULT 5,
    next_run_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at     DATETIME NULL,
    worker_id     VARCHAR(64) NULL,
    provider      VARCHAR(40) NULL,          -- which provider delivered it (primary/fallback)
    last_error    VARCHAR(1000) NULL,
    dedupe_key    VARCHAR(120) NULL,         -- optional idempotency key; NULL never collides
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at       DATETIME NULL,
    INDEX idx_email_outbox_claim (status, next_run_at),
    UNIQUE KEY uq_email_outbox_dedupe (dedupe_key)
);
