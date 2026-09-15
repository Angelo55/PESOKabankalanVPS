-- 052: users.oauth_provider — the external identity provider linked to an account
-- ('google'), or NULL for a local email/password account. This lets the Account
-- Settings "Linked Accounts" section show the REAL connection state instead of
-- assuming every account is Google-connected (the caveat found in the settings audit).
--
-- Additive + idempotent. The Google OAuth flow stamps this authoritatively going
-- forward (POST /auth/google + the /google/callback redirect flow). The backfill uses
-- the app's EXISTING implicit heuristic: a passwordless account is a Google-created
-- account — the login route already refuses a local password on such a row with
-- "This account uses Google Sign-In." Walk-in and email/password accounts always carry
-- a bcrypt password, so they stay NULL (local).
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20) NULL;

UPDATE users
   SET oauth_provider = 'google'
 WHERE oauth_provider IS NULL
   AND (password IS NULL OR password = '');
