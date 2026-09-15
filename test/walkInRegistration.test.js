const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for Walk-In Job Seeker registration (#7). Source-only (no DB, §13).
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'walkInService.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pesoAdminRoutes.js'), 'utf8');
const RBAC = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rbac.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(__dirname, '..', 'routes', 'configRoutes.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '043_walk_in_registration.sql'), 'utf8');

test('a walk-in becomes a REAL seeker row in the centralized model (not a separate store)', () => {
	assert.match(SVC, /INSERT INTO users/, 'creates a users row');
	assert.match(SVC, /role', '?applicant|'applicant'/, "role is applicant");
	assert.match(SVC, /'walk_in'/, "account_origin = walk_in");
	assert.match(SVC, /'unclaimed'/, 'claim_status = unclaimed (claimable later)');
	assert.match(SVC, /claim_token/, 'a claim token is minted');
});

test('consent is required and duplicate detection guards against a second account', () => {
	assert.match(SVC, /consent/, 'consent captured');
	assert.match(SVC, /consent_given_at/, 'consent timestamp persisted');
	assert.match(SVC, /findPotentialDuplicates/, 'duplicate detection exists');
	assert.match(SVC, /force/, 'staff can override after reviewing matches');
});

test('walk-in is gated by the walkin:manage capability and the runtime flag (Manager only)', () => {
	const mgr = RBAC.match(/\[ROLE_KEYS\.PESO_ADMINISTRATOR\]:\s*\[([\s\S]*?)\]/);
	const staff = RBAC.match(/\[ROLE_KEYS\.PESO_STAFF\]:\s*\[([\s\S]*?)\]/);
	assert.ok(mgr && /'walkin:manage'/.test(mgr[1]), 'Manager has walkin:manage');
	assert.ok(staff && !/'walkin:manage'/.test(staff[1]), 'publication Staff do NOT have walkin:manage');
	assert.match(ROUTES, /requirePermission\('walkin:manage'\)/, 'endpoint uses the capability guard');
	assert.match(ROUTES, /walk_in_registration_enabled/, 'endpoint is flag-gated');
	assert.match(CONFIG, /walkInRegistration/, 'the client can see whether the feature is on');
});

test('the migration is additive and the seeker record stays claimable', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS account_origin/, 'additive origin');
	assert.match(MIG, /claim_status/, 'claim status column');
	assert.match(MIG, /consent_given_at/, 'consent column');
});
