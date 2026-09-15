-- Migration 046 — Account suspension metadata.
--
-- WHY: Super Admin → User Management can mark an account 'Suspended' (account_status),
-- but until now it stored ONLY the status flag — no reason, no date, no end date. The
-- suspension notice a blocked user sees (and the audit trail) needs that context:
--   suspended_at        — when the suspension took effect (distinct from created_at)
--   suspension_reason   — optional human reason the admin typed (shown to the user)
--   suspension_ends_at  — optional end date for a TEMPORARY suspension (informational;
--                         the platform does NOT auto-reactivate — reactivation stays a
--                         manual admin action, so a passed end date changes nothing on
--                         its own)
--   suspended_by        — the admin who suspended (audit; nullable)
--
-- These are populated when account_status flips to 'Suspended' and CLEARED (set NULL)
-- on reactivation. account_status itself is unchanged (still the VARCHAR flag the app
-- already reads); this only enriches it.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS) — an instant metadata change on
-- TiDB, no downtime, no touch to existing rows (every pre-existing account is Active
-- with all-NULL suspension metadata, which is correct). Safe to re-run.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS suspended_at       DATETIME NULL,
    ADD COLUMN IF NOT EXISTS suspension_reason  VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS suspension_ends_at DATETIME NULL,
    ADD COLUMN IF NOT EXISTS suspended_by       INT NULL;
