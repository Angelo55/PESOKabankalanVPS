-- ============================================================================
-- 016_user_preferences.sql
--
-- A small, generic per-user preference store.
--
-- WHY A KEY/VALUE TABLE RATHER THAN COLUMNS ON `users`:
-- The first consumer is the Referrals list⇄grid view toggle, but UI preferences
-- of this shape recur (density, default sort, dismissed hints…). Adding a column
-- to the live `users` table for each one means a production DDL per preference
-- on a table that is read on every authenticated request. One narrow side table
-- absorbs all of them with no further migrations.
--
-- SHAPE:
--   PRIMARY KEY (user_id, pref_key) gives a natural upsert target for
--   INSERT … ON DUPLICATE KEY UPDATE, so writes are idempotent and there is no
--   read-modify-write race between two tabs.
--   pref_value is VARCHAR, not JSON: every value so far is a short scalar, and
--   the API validates keys AND values against an allow-list, so this column can
--   never hold free-form client input.
--
-- Deliberately NO foreign key to users: an orphaned preference row is inert
-- (it is only ever read via an authenticated user_id), and this project has
-- already hit duplicate-FK migration failures on live TiDB. Integrity here is
-- not worth that risk.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
	user_id INT NOT NULL,
	pref_key VARCHAR(60) NOT NULL,
	pref_value VARCHAR(120) NOT NULL,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, pref_key)
);
