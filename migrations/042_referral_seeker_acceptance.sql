-- Migration 042 — Job Seeker acceptance states for the referral lifecycle (#6).
--
-- WHY: PESO Kabankalan office (interview) — a personalized referral should not be
-- treated as accepted merely because the admin endorsed it. The seeker now reviews
-- and ACCEPTS or DECLINES before the official letter is issued/sent. This adds the
-- two intermediate states; the endorse→accept→letter flow is gated by the
-- `referral_acceptance_enabled` system setting (ships dark, §7.12).
--
-- APPEND-ONLY enum change (§13): TiDB applies an append at the END of the list as
-- an instant metadata change. The existing members and DEFAULT are preserved
-- EXACTLY — never reorder or remove (that rewrites every row and breaks reads).
-- Idempotent: re-running MODIFY to the same definition is a no-op.
ALTER TABLE referral_queue
    MODIFY COLUMN status ENUM(
        'Pending AI',
        'Pending Review',
        'Approved',
        'Rejected',
        'Voided',
        'Pending Seeker Acceptance',
        'Declined'
    ) NOT NULL DEFAULT 'Pending AI';
