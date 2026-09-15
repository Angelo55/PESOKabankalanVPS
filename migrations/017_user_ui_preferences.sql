-- ============================================================================
-- 017_user_ui_preferences.sql
--
-- Creates the per-user UI preference store that 016 INTENDED to create.
--
-- WHY 016 DID NOTHING (and why this file exists):
-- Migration 016 ran `CREATE TABLE IF NOT EXISTS user_preferences (...)`. A table
-- named `user_preferences` ALREADY existed on the live database with a totally
-- different shape — (user_id, preferred_roles, preferred_locations, work_setup,
-- created_at), an orphaned career-preferences table with no code references and
-- zero rows. `IF NOT EXISTS` matched on NAME only, so the statement was a silent
-- no-op: the runner reported OK, the table kept its old shape, and every query
-- against pref_key/pref_value failed with ER_BAD_FIELD_ERROR at runtime.
--
-- This is the exact trap called out in SKILL.md §13. The lesson, restated:
-- ALWAYS verify shape via INFORMATION_SCHEMA before assuming a CREATE TABLE
-- IF NOT EXISTS did anything.
--
-- RESOLUTION: a distinct table name rather than dropping or altering the
-- existing one. Dropping a table on production TiDB is destructive and was not
-- required; renaming a physical table is frozen by invariant 0.7. The legacy
-- `user_preferences` table is left exactly as it was found.
--
-- SHAPE (unchanged intent from 016):
--   PRIMARY KEY (user_id, pref_key) gives a natural upsert target for
--   INSERT … ON DUPLICATE KEY UPDATE, so writes are idempotent and free of any
--   read-modify-write race between two open tabs.
--   pref_value is VARCHAR, not JSON: every value is a short scalar, and the API
--   validates keys AND values against an allow-list, so this column can never
--   hold free-form client input.
--
-- Deliberately NO foreign key to users: an orphaned preference row is inert (it
-- is only ever read via an authenticated user_id), and this project has already
-- hit duplicate-FK migration failures on live TiDB.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_ui_preferences (
	user_id INT NOT NULL,
	pref_key VARCHAR(60) NOT NULL,
	pref_value VARCHAR(120) NOT NULL,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, pref_key)
);
