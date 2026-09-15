-- ============================================================================
-- 028_notification_preferences.sql  —  Phase 2: Notification Center per-type mute
--
-- WHAT THIS ADDS
-- A per-user, per-type notification preference. One row exists only when a user
-- has SET a preference for a type; absence means "deliver" (the default). A row
-- with muted = TRUE means notificationService SUPPRESSES that (user, type) — it
-- writes no notifications row, so a muted type never badges, toasts, or appears
-- in history. muted = FALSE is an explicit "deliver" (e.g. after un-muting).
--
-- WHY A TABLE (not a JSON blob on users)
-- The set of types is open-ended and the mute check runs on the hot notification
-- write path (and inside the notifyAllJobSeekers bulk INSERT…SELECT as a
-- NOT EXISTS). A narrow indexed table keeps that check a keyed lookup, and keeps
-- preference writes independent of the (large, base64-bearing) users row.
--
-- SAFETY
-- Additive only, CREATE TABLE IF NOT EXISTS — instant metadata change on TiDB, no
-- downtime, no touch to existing tables, no foreign keys. Safe to re-run. The mute
-- integration is fail-OPEN: if this table is somehow missing, notifications still
-- deliver (a notification is a secondary concern, invariant 0.1 — never suppress
-- one because a preference lookup failed).
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    type        VARCHAR(60) NOT NULL,
    muted       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_notif_pref (user_id, type),
    INDEX idx_notif_pref_user (user_id)
);
