-- 053: Google account-LINK identity — backs the full Linked Accounts connect/disconnect
-- flow (beyond the 052 `oauth_provider` display flag).
--   google_sub   — the linked Google account's STABLE subject id. This is the
--                  duplicate-protection key: one Google identity may be linked to only
--                  ONE PESO account. NULL for a local account, or for a 052-heuristic
--                  backfilled row that hasn't signed in with Google since.
--   google_email — the linked Google email, shown as the connected identity in the UI.
-- Additive + idempotent columns; a UNIQUE index on google_sub enforces the
-- one-Google-account → one-PESO-account rule at the DB level (nullable, so the many
-- local accounts all stay NULL without colliding). google_sub is all-NULL at apply
-- time (no login has populated it yet), so the unique index add cannot hit a dup.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255) NULL;
ALTER TABLE users ADD UNIQUE INDEX uq_users_google_sub (google_sub);
