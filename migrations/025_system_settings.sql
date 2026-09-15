-- ============================================================================
-- 025_system_settings.sql
--
-- Platform configuration a Super Administrator can change without a redeploy.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
-- Every tunable in the system lived in environment variables: the AI referral
-- threshold, the signup email domain allow-list, and so on. Changing any of
-- them meant editing Render's environment and restarting the service — which
-- puts routine policy decisions ("stop accepting signups for the weekend",
-- "lower the AI threshold") behind a deployment.
--
-- The Super Admin "System Settings" page meanwhile showed the administrator
-- their own name and nothing else.
--
-- ── Key/value, not columns ──────────────────────────────────────────────────
-- A settings TABLE with one column per setting needs a migration every time a
-- setting is added, which defeats the point. Key/value costs a small amount of
-- type discipline in the service layer and nothing in schema churn.
--
-- ── Environment variables remain the fallback ───────────────────────────────
-- A missing row falls back to process.env, and then to a hardcoded default. So
-- this migration changes NOTHING on its own: every setting keeps its current
-- effective value until an administrator deliberately overrides it. That also
-- means a bad row can be deleted to restore the previous behaviour, rather than
-- having to guess what the value used to be.
--
-- ── Why updated_by is nullable ──────────────────────────────────────────────
-- ON DELETE SET NULL: a setting is a fact about the platform and must survive
-- the administrator who set it leaving. The audit trail in admin_audit_logs
-- keeps the name.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
	setting_key VARCHAR(100) NOT NULL PRIMARY KEY,

	-- Always TEXT. The service layer owns parsing and validation, because a
	-- column type cannot express "an integer between 0 and 100" anyway, and
	-- keeping one storage type means adding a boolean setting needs no DDL.
	setting_value TEXT NULL,

	updated_by INT NULL DEFAULT NULL,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

	CONSTRAINT fk_settings_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Deliberately seeded EMPTY. Inserting current values here would freeze
-- whatever the environment happens to hold today into the database, and the
-- env-var fallback would then never be consulted again. Rows appear only when
-- an administrator sets one.
