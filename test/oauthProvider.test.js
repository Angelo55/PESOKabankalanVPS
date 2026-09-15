const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Linked-Accounts honesty (2026-09): users.oauth_provider records the real external
 * provider so Account Settings shows the true Google connection state instead of
 * assuming every account is linked. Source-only (§13 — never require('../db')).
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const AUTH = read('routes', 'authRoutes.js');
const MIG = read('migrations', '052_users_oauth_provider.sql');
const MIG53 = read('migrations', '053_google_link_identity.sql');

test('migration 052 adds oauth_provider additively + backfills passwordless → google', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS oauth_provider/i, 'additive column add');
	assert.match(MIG, /UPDATE users[\s\S]*oauth_provider = 'google'[\s\S]*password IS NULL OR password = ''/i, 'heuristic backfill');
});

test('authRoutes has a zero-crash boot ALTER so a deploy is never ahead of the migration', () => {
	assert.match(AUTH, /ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider/i, 'boot ALTER present');
});

test('the Google flows stamp oauth_provider + identity (create + existing sign-in)', () => {
	// Both POST /google and the /google/callback INSERT include the identity columns.
	const inserts = AUTH.match(/INSERT INTO users \(name, email, role, oauth_provider, google_sub, google_email\) VALUES/g) || [];
	assert.ok(inserts.length >= 2, 'both Google INSERTs carry oauth_provider + identity');
	// An existing account signing in via Google is stamped idempotently (COALESCE keeps a set sub).
	assert.match(AUTH, /UPDATE users SET oauth_provider = 'google', google_sub = COALESCE\(google_sub, \?\), google_email = COALESCE\(google_email, \?\) WHERE id = \?/, 'existing Google sign-in stamps the linkage');
});

test('oauth_provider + google_email are exposed in the user object (/me, /login, /google)', () => {
	assert.match(AUTH, /SELECT id, name, email, role, avatar_url, avatar_thumb, oauth_provider, google_email FROM users/, '/me selects them');
	assert.match(AUTH, /password, role, avatar_url, avatar_thumb, oauth_provider, google_email, account_status/, '/login selects them');
	assert.match(AUTH, /oauth_provider: user\.oauth_provider \|\| null/, '/login returns oauth_provider');
	assert.match(AUTH, /google_email: user\.google_email \|\| null/, '/login returns google_email');
});

// ── Account LINK flow (2026-09) ──────────────────────────────────────────────

test('migration 053 adds google_sub + google_email + the unique index (duplicate protection)', () => {
	assert.match(MIG53, /ADD COLUMN IF NOT EXISTS google_sub/i);
	assert.match(MIG53, /ADD COLUMN IF NOT EXISTS google_email/i);
	assert.match(MIG53, /ADD UNIQUE INDEX uq_users_google_sub \(google_sub\)/i, 'one Google identity → one account');
});

test('link-start is authed and returns a signed link-ticket state (never a raw redirect)', () => {
	assert.match(AUTH, /router\.get\('\/google\/link\/start', requireAuth/, 'start endpoint is authed');
	assert.match(AUTH, /jwt\.sign\(\{ uid: req\.userId, purpose: 'link' \}[\s\S]*expiresIn: '10m'/, 'short-lived signed link ticket');
	assert.match(AUTH, /prompt: 'select_account'/, 'user picks which Google account');
	assert.match(AUTH, /access_type: 'online'/, 'identity only — no refresh token stored');
});

test('the callback distinguishes a LINK ticket from a login state and protects against duplicates', () => {
	assert.match(AUTH, /jwt\.verify\(state[\s\S]*purpose === 'link'/, 'link intent from signed state');
	assert.match(AUTH, /SELECT id FROM users WHERE google_sub = \? AND id <> \?/, 'duplicate-account check');
	assert.match(AUTH, /status=duplicate|LINK_RESULT\(FE, 'duplicate'\)/, 'duplicate → clear status');
	assert.match(AUTH, /LINK_RESULT\(FE, 'cancelled'\)/, 'cancel → clear status');
	assert.match(AUTH, /LINK_RESULT\(FE, 'success'\)/, 'success → clear status');
});

test('unlink is safe: refuses when Google is the only sign-in method (no password) and never deletes the account', () => {
	assert.match(AUTH, /router\.post\('\/google\/unlink', requireAuth/, 'unlink is authed');
	assert.match(AUTH, /if \(!u\.password\)[\s\S]*NO_PASSWORD/, 'blocked without a local password');
	assert.match(AUTH, /UPDATE users SET oauth_provider = NULL, google_sub = NULL, google_email = NULL/, 'clears linkage only — no DELETE');
	assert.ok(!/DELETE FROM users/i.test(AUTH), 'unlink never deletes a user');
});

test('token handling: Google linking is identity-only — id_token verified, no Google tokens persisted', () => {
	assert.match(AUTH, /verifyIdToken\(\{ idToken: tokens\.id_token/, 'verifies the id_token');
	// The Google link/login writes ONLY identity (provider/sub/email), never tokens.
	// (The separate Indeed integration has its own linked_accounts token store — unrelated.)
	assert.match(AUTH, /SET oauth_provider = 'google', google_sub = \?, google_email = \?/, 'link stores identity only');
	assert.ok(!/google_access_token|google_refresh_token/.test(AUTH), 'no Google token columns exist');
});
