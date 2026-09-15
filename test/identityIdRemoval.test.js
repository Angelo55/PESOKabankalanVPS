const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the Identity Verification ID removal (2026-08-23). Source-only (§13).
 * The ID-TYPE field is removed from all LIVE code paths; the DB columns/table are left
 * DORMANT (not dropped) per §0.7. These lock that no code reads/writes the ID type and
 * that unrelated identity subsystems are untouched.
 */
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const PROFILE_ROUTES = read('routes', 'profileRoutes.js');
const PESO = read('routes', 'pesoAdminRoutes.js');
const APPLICANT_SVC = read('services', 'applicantProfileService.js');

// Strip line comments so documentation mentions of the dormant columns don't count as
// live usage — we assert on the CODE, not the explanatory notes.
const stripComments = (src) => src.split('\n').filter((l) => !l.trim().startsWith('--') && !l.trim().startsWith('//')).join('\n');

test('the /verification/id-types endpoint is gone', () => {
	assert.doesNotMatch(PROFILE_ROUTES, /router\.(get|post)\('\/verification\/id-types'/, 'id-types route removed');
	assert.doesNotMatch(stripComments(PROFILE_ROUTES), /FROM verification_id_types/, 'no query against the id-types table');
});

test('the profile save no longer writes the identity ID columns', () => {
	const code = stripComments(PROFILE_ROUTES);
	assert.doesNotMatch(code, /verification_id_type\s*=/, 'no write to verification_id_type');
	assert.doesNotMatch(code, /pwd_category\s*=/, 'no write to pwd_category');
});

test('the ATS applicant queries no longer select the identity ID', () => {
	const code = stripComments(PESO);
	assert.doesNotMatch(code, /verification_id_type/, 'ATS list/detail selects dropped');
	assert.doesNotMatch(stripComments(APPLICANT_SVC), /id_type/, 'unified profile no longer composes id_type');
});

test('unrelated identity subsystems are untouched (dormant, not removed)', () => {
	// accessibility_accommodations (a job-post feature) and the password-strength
	// tokens are NOT part of this removal — they must never be swept up by it.
	assert.doesNotMatch(PROFILE_ROUTES, /accessibility_accommodations\s*=\s*null/, 'accessibility feature untouched');
});
