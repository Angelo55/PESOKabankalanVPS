-- 037_application_preferences.sql
-- Per-user PIN + COLOUR LABEL for the centralized My Applications module (§28 follow-up).
--
-- WHY A SEPARATE TABLE (not columns on job_applications): the unified applications feed
-- (GET /api/applications/unified) COMPOSES two stores — job_applications (PESO, referral-
-- bound) and usertrackedjobs (imported). Pin/colour are PERSONAL organisational markers
-- that must work on EVERY card without touching the referral-bound job_applications table
-- or duplicating state per source. So they live in ONE store keyed by the unified row id
-- (`app_uid` = 'peso-<application_id>' | 'ext-<usertrackedjob_id>'). No FK: the key spans
-- two tables (same no-FK convention as proactive_referral_candidates); an orphaned pref row
-- is harmless and simply never joins to a live application.
--
-- Additive + idempotent. Owner-scoped by user_id. Colour stores the palette KEY (validated
-- against the allow-list server-side), never a hex — mirrors migration 015.

CREATE TABLE IF NOT EXISTS application_preferences (
    user_id     INT          NOT NULL,
    app_uid     VARCHAR(40)  NOT NULL,
    is_pinned   BOOLEAN      NOT NULL DEFAULT FALSE,
    color_label VARCHAR(20)  NULL DEFAULT NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, app_uid)
);
