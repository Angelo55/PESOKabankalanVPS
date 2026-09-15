const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the PESO Staff / Co-worker RBAC role (Phase 2). Source-only
 * assertions (no DB: require('../db') runs initDB against prod, §13 — and rbac.js
 * itself requires ../db, so it cannot be imported here).
 *
 * These lock the invariants that make the limited role SAFE:
 *   - §0.15: an unrecognised role token normalizes to JOB_SEEKER. peso_staff MUST
 *     be a recognised alias, or a staff account would silently become a seeker.
 *   - Least privilege: staff get jobs/events management, NEVER referral decisions
 *     or the applicant pipeline.
 *   - Deny-by-default enforcement: staff reach only /jobs* on the PESO router.
 */

const RBAC = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rbac.js'), 'utf8');
const ROLE_ADMIN = fs.readFileSync(path.join(__dirname, '..', 'services', 'roleAdminService.js'), 'utf8');
const PESO_ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pesoAdminRoutes.js'), 'utf8');
const ROLES_FE = fs.readFileSync(path.join(__dirname, '..', 'job-tracker-frontend', 'src', 'utils', 'roles.js'), 'utf8');

test('rbac defines the PESO_STAFF role with stored value peso_staff', () => {
	assert.match(RBAC, /PESO_STAFF:\s*'peso_staff'/, 'ROLE_KEYS.PESO_STAFF must be "peso_staff"');
	assert.match(RBAC, /\[ROLE_KEYS\.PESO_STAFF\]:\s*'PESO Staff'/, 'must carry a display label');
});

test('peso_staff is a recognised alias — never silently demoted to JOB_SEEKER (§0.15)', () => {
	assert.match(RBAC, /peso_staff:\s*ROLE_KEYS\.PESO_STAFF/, 'ROLE_ALIASES must map peso_staff');
	// The frontend mirror must normalize it BEFORE peso_administrator, or it falls through.
	assert.match(ROLES_FE, /peso_staff[^\n]*ROLE_KEYS\.PESO_STAFF/, 'frontend normalizeRole must handle peso_staff');
});

test('a Super Administrator may assign peso_staff', () => {
	assert.match(ROLE_ADMIN, /ROLE_KEYS\.PESO_STAFF/, 'ASSIGNABLE_ROLES must include PESO_STAFF');
});

test('peso_staff has jobs/events management but NEVER referral or applicant powers (least privilege)', () => {
	const block = RBAC.match(/\[ROLE_KEYS\.PESO_STAFF\]:\s*\[([\s\S]*?)\]/);
	assert.ok(block, 'ROLE_PERMISSIONS must define a PESO_STAFF entry');
	const perms = block[1];
	assert.match(perms, /'jobs:manage'/, 'staff can manage jobs');
	assert.doesNotMatch(perms, /referrals:decide/, 'staff must NOT decide referrals');
	assert.doesNotMatch(perms, /applicants:manage/, 'staff must NOT manage the applicant pipeline');
});

test('the PESO router lets staff REACH it but restricts them to job publication (deny-by-default)', () => {
	assert.match(PESO_ROUTES, /requireRole\(ROLE_KEYS\.PESO_ADMINISTRATOR,\s*ROLE_KEYS\.PESO_STAFF\)/, 'both roles reach the router');
	// The staff guard: only /jobs* (excluding question authoring), else 403.
	assert.match(PESO_ROUTES, /req\.userRole\s*!==\s*ROLE_KEYS\.PESO_STAFF/, 'guard fast-paths managers, restricts staff');
	assert.match(PESO_ROUTES, /\^\\\/jobs/, 'staff are restricted to the /jobs* endpoints');
});

test('staff-published jobs are attributed to the office Manager (D2 — no ownership break)', () => {
	assert.match(PESO_ROUTES, /req\.effectiveOwnerId/, 'job ops must key on the effective office owner');
	assert.match(PESO_ROUTES, /peso_administrator'\)\s*ORDER BY id ASC LIMIT 1/, 'staff resolve to the office PESO Administrator');
});
