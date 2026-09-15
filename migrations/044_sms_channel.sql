-- ============================================================================
-- 044_sms_channel.sql  —  Phase 6 (#8): SMS notification channel
--
-- WHAT THIS ADDS
-- The data model behind the SMS delivery channel (docs/sms-notification-proposal.md
-- §4): a per-user phone-verification + opt-in state, a durable `sms_outbox` (the
-- 7th outbox, mirroring email_outbox / referral_jobs), and a `phone_verifications`
-- staging table for the OTP-to-phone flow.
--
-- WHY
-- Walk-in and rural Job Seekers (#7) may have no Gmail and no reliable internet —
-- SMS is the only channel that reaches them for the critical referral events and
-- for the walk-in account-claim link. The in-app row stays the durable deliverable
-- (§0.11); SMS is a best-effort side channel chosen from the recipient's VERIFIED +
-- opted-in phone. Consent + verification are required before any SMS is sent (the
-- "do not implement SMS blindly" guard the office asked for).
--
-- OUTBOX PARITY (deliberate)
-- `sms_outbox` is drained by services/smsWorker.js exactly the way email_outbox is
-- drained by services/emailWorker.js — claim with a conditional atomic UPDATE (TiDB
-- has no SKIP LOCKED, §7.5), exponential backoff persisted in next_run_at,
-- dead-letter after max_attempts, stuck-row reclaim on boot — single step ("send").
-- No new async mechanism (§0.3/§7.5).
--
-- SAFETY
-- Additive only. Column adds use ADD COLUMN IF NOT EXISTS (instant metadata change
-- on TiDB, same as 043); tables use CREATE TABLE IF NOT EXISTS. No existing table is
-- rewritten, no foreign keys, no data touched. Every pre-existing user defaults to
-- sms_opt_in = 0 and phone_verified_at = NULL, so nothing sends until a seeker
-- verifies + opts in. The whole channel ships behind sms_notifications_enabled +
-- SMS_PROVIDER (unset ⇒ the worker is dormant and notificationService's SMS fan-out
-- is a no-op), so this schema can sit empty until the flag is flipped. Safe to re-run.
-- ============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_verified_at  DATETIME NULL,
    ADD COLUMN IF NOT EXISTS sms_opt_in         TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sms_outbox (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    user_id              INT NULL,                  -- recipient (NULL = ad-hoc, e.g. a walk-in claim before login)
    to_number            VARCHAR(20) NOT NULL,      -- E.164 (+63XXXXXXXXXX)
    template_key         VARCHAR(60) NOT NULL DEFAULT 'general',  -- REFERRAL_ISSUED | REFERRAL_ENDORSEMENT | WALKIN_CLAIM | general
    body                 VARCHAR(480) NOT NULL,     -- rendered message (kept short; multi-part billing)
    status               ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
    attempts             INT NOT NULL DEFAULT 0,
    max_attempts         INT NOT NULL DEFAULT 4,
    next_run_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at            DATETIME NULL,
    worker_id            VARCHAR(64) NULL,
    provider             VARCHAR(40) NULL,          -- which provider delivered it (semaphore/twilio)
    provider_message_id  VARCHAR(120) NULL,         -- provider's id, for delivery-status lookups
    last_error           VARCHAR(1000) NULL,
    dedupe_key           VARCHAR(120) NULL,         -- optional idempotency key; NULL never collides
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at              DATETIME NULL,
    INDEX idx_sms_outbox_claim (status, next_run_at),
    UNIQUE KEY uq_sms_outbox_dedupe (dedupe_key)
);

-- Staged phone-ownership proofs (OTP-to-phone). Mirrors email_verifications (§7.9):
-- a peppered SHA-256 of the code, a TTL, and attempt/resend caps. One live row per
-- user (the UNIQUE key upserts a re-request). Consuming a correct code stamps
-- users.phone_verified_at; this table only ever holds pending proofs.
CREATE TABLE IF NOT EXISTS phone_verifications (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    phone         VARCHAR(20) NOT NULL,     -- E.164 the code was sent to
    otp_hash      CHAR(64) NOT NULL,
    expires_at    DATETIME NOT NULL,
    attempts      INT NOT NULL DEFAULT 0,
    resend_count  INT NOT NULL DEFAULT 0,
    last_sent_at  DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_phone_verifications_user (user_id)
);
