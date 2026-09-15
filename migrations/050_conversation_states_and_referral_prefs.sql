-- Migration 050 — per-user conversation state + seeker referral automation.
--
-- Two additive, independent tables for the coordinated refinement pass. Both are
-- CREATE TABLE IF NOT EXISTS (idempotent, §13) and are ALSO created defensively at
-- boot by the app's zero-crash initializers (messageRoutes.js /
-- profileRoutes.js), so a deploy is never ahead of this migration. Running the
-- migration afterwards is a no-op that simply records the canonical schema.

-- ── conversation_states ─────────────────────────────────────────────────────
-- Per-viewer state for a conversation the Messages Hub reads: mute, pin, and a
-- manual "mark as unread" flag. Keyed by (user_id, conversation_id) so each side
-- of a conversation has its OWN state — muting is personal, pinning is personal.
--   is_muted        suppress the unread badge + the NEW_MESSAGE bell for this convo
--   pinned_at       NULL = not pinned; a timestamp both flags the pin and orders
--                   the pinned section (newest pin first). The 5-pin cap is
--                   enforced in application code, not the schema.
--   manually_unread the viewer chose "mark as unread" even though messages are
--                   read; cleared when they open the conversation or mark it read.
CREATE TABLE IF NOT EXISTS conversation_states (
    user_id         INT NOT NULL,
    conversation_id INT NOT NULL,
    is_muted        TINYINT(1) NOT NULL DEFAULT 0,
    pinned_at       DATETIME NULL,
    manually_unread TINYINT(1) NOT NULL DEFAULT 0,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, conversation_id),
    INDEX idx_conv_state_user_pinned (user_id, pinned_at)
);

-- ── referral_preferences ────────────────────────────────────────────────────
-- Per-seeker choice for how incoming personalised referrals are handled once they
-- reach 'Pending Seeker Acceptance' (the flow gated by referral_acceptance_enabled).
--   mode = manual        (DEFAULT) — seeker reviews and accepts/declines. Today's behaviour.
--          auto_accept   — accept immediately on the seeker's behalf.
--          auto_decline  — decline immediately on the seeker's behalf.
-- VARCHAR (not ENUM) matching job_alert_preferences.frequency; values validated in code.
CREATE TABLE IF NOT EXISTS referral_preferences (
    user_id    INT PRIMARY KEY,
    mode       VARCHAR(20) NOT NULL DEFAULT 'manual',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
