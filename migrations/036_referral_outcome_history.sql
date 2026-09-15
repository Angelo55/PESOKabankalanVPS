-- ============================================================================
-- 036_referral_outcome_history.sql — structured, collaborative outcome ledger
--
-- CONTEXT
-- Referral placement outcomes live in `referral_outcomes` (migration 023) as ONE
-- CURRENT row per referral, written ONLY by a PESO Administrator. Two gaps drove
-- this migration (see docs/referral-lifecycle-sync-plan.md, SKILL §7.11):
--   1. There was no STRUCTURED, queryable history of outcome transitions — only
--      free text in referral_activity_log (OUTCOME_RECORDED). The office needs an
--      auditable prev→new / who / when ledger for every change.
--   2. The collaborative model (2026) lets a Job Seeker SUGGEST an outcome they
--      heard from the employer, WITHOUT that suggestion becoming the official
--      placement record. A seeker-reported 'Hired' must NEVER enter
--      `referral_outcomes`, because that table feeds the DOLE placement report and
--      the public "Successful Referrals" tile (invariant 0.14). The suggestion
--      needs a home that is SEPARATE from the official row.
--
-- This table is BOTH: the append-only transition ledger AND the seeker-suggestion
-- inbox. `is_official = 1` rows mirror an administrator's authoritative write to
-- `referral_outcomes`; `is_official = 0` rows are seeker suggestions awaiting an
-- administrator's confirmation (confirming re-runs the normal admin write, which
-- appends a fresh is_official=1 row). referral_activity_log stays the unified
-- human-readable timeline; THIS table is the structured outcome axis the
-- collaborative UI and the audit query read.
--
-- WHY A SEPARATE TABLE despite the 023 comment ("history lives in the activity
-- log"): the collaborative channel needs a store that is (a) structured enough to
-- render "seeker reports Hired on <date>" with a one-click Confirm, and (b)
-- physically separate from `referral_outcomes` so a suggestion can exist without
-- touching official statistics. The activity log satisfies neither.
--
-- SAFETY: additive (CREATE TABLE IF NOT EXISTS); no FK to keep it decoupled from
-- referral_queue's lifecycle (the ledger is a permanent audit record and must
-- survive even a hard delete elsewhere). `outcome`/`previous_outcome` are VARCHAR,
-- not ENUM, so future outcome vocabulary needs no enum-append (§13) and a stray
-- value can never truncate-and-rollback the enclosing write. The backfill is
-- guarded by NOT EXISTS, so re-running this migration inserts nothing twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_outcome_history (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    queue_id         INT NOT NULL,

    -- The outcome asserted by this transition. Same vocabulary as
    -- referral_outcomes.outcome, validated in the service layer (VALID_OUTCOMES).
    outcome          VARCHAR(40) NOT NULL,

    -- The real-world date the event was reported to have happened (employer's
    -- date), distinct from created_at (when the row was written). NULL when not
    -- given. Mirrors referral_outcomes.outcome_at.
    outcome_at       DATETIME NULL DEFAULT NULL,

    -- The value immediately before this transition, for a readable prev→new
    -- audit. NULL for the very first outcome recorded on a referral.
    previous_outcome VARCHAR(40) NULL DEFAULT NULL,

    notes            TEXT NULL,

    -- WHO made the change and in WHAT capacity. changed_by is the acting user
    -- (NULL only for a system/backfill row); changed_by_role is the stored role
    -- value ('peso_administrator' | 'applicant' | 'admin'). Both are recorded so
    -- the collaborative history reads "PESO recorded" vs "Seeker reported".
    changed_by       INT NULL DEFAULT NULL,
    changed_by_role  VARCHAR(30) NOT NULL DEFAULT 'system',

    -- 1 = authoritative (mirrors an administrator's referral_outcomes write and
    -- IS the official record). 0 = a Job Seeker's suggestion, informational only,
    -- never counted in any report until an administrator confirms it (0.14).
    is_official      TINYINT(1) NOT NULL DEFAULT 0,

    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Full trail per referral, newest-first reads, and a fast "latest pending
    -- suggestion" lookup for the administrator's Confirm affordance.
    INDEX idx_roh_queue_created (queue_id, created_at),
    INDEX idx_roh_queue_official (queue_id, is_official)
);

-- Seed one official history row from each EXISTING official outcome, so the
-- ledger is not empty for referrals whose outcome was recorded before this
-- table existed. Guarded by NOT EXISTS → idempotent / re-runnable. previous_outcome
-- is left NULL (there is no earlier structured row to point at). changed_by
-- carries the original recorder; role is left 'system' because the historical
-- row does not record which role that user held at the time.
INSERT INTO referral_outcome_history
    (queue_id, outcome, outcome_at, previous_outcome, notes, changed_by, changed_by_role, is_official, created_at)
SELECT
    ro.queue_id, ro.outcome, ro.outcome_at, NULL, ro.notes, ro.recorded_by, 'system', 1, ro.recorded_at
FROM referral_outcomes ro
WHERE NOT EXISTS (
    SELECT 1 FROM referral_outcome_history h
    WHERE h.queue_id = ro.queue_id AND h.is_official = 1
);
