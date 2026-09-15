const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Post-registration onboarding / account-completion gate (2026-09).
 * A job seeker must complete the mandatory identity/DOLE fields AND have a résumé on file
 * before applying. Enforcement is server-side + derived (never a bypassable flag). These
 * guards lock the contract. Source-only (no DB: require('../db') runs initDB against prod, §13).
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SVC = read('services', 'onboardingService.js');
const APP = read('routes', 'applicationRoutes.js');
const PROF = read('routes', 'profileRoutes.js');

test('the required set is the 6 identity/DOLE fields', () => {
	assert.match(SVC, /REQUIRED_PROFILE_FIELDS\s*=\s*\[[^\]]*'name'[^\]]*'phone'[^\]]*'location'[^\]]*'gender'[^\]]*'dob'[^\]]*'educational_attainment'[^\]]*\]/s,
		'required set must be name/phone/location/gender/dob/educational_attainment');
});

test('canApply couples a complete profile AND a résumé on file', () => {
	assert.match(SVC, /uploaded_resumes[\s\S]*parsed_text IS NOT NULL/i, 'résumé signal = uploaded_resumes.parsed_text (what the scorer reads)');
	assert.match(SVC, /canApply:\s*profileComplete && hasResume/, 'canApply = profileComplete && hasResume');
});

test('evaluate fails OPEN on a DB error (returns error:true) — never hard-locks', () => {
	assert.match(SVC, /catch \(error\)[\s\S]*error:\s*true/, 'a DB error yields an indeterminate error:true state');
});

test('POST /applications enforces the gate, before creating the application', () => {
	const start = APP.indexOf("router.post('/'");
	assert.ok(start > -1, 'apply handler found');
	const body = APP.slice(start);
	assert.match(body, /onboardingService\.evaluate\(applicantId\)/, 'apply calls evaluate(applicantId)');
	assert.match(body, /!onboarding\.canApply && !onboarding\.error/, 'blocks only a DEFINITIVE incomplete (fail-open on error)');
	assert.match(body, /code:\s*['"]PROFILE_INCOMPLETE['"]/, 'returns the machine-readable PROFILE_INCOMPLETE code');
	const gateIdx = APP.indexOf('onboardingService.evaluate');
	const insertIdx = APP.indexOf('INSERT INTO job_applications');
	if (insertIdx > -1) assert.ok(gateIdx > -1 && gateIdx < insertIdx, 'the gate must precede the application insert');
});

test('profileRoutes exposes the owner-scoped GET /onboarding status endpoint', () => {
	assert.match(PROF, /router\.get\('\/onboarding'/, 'status endpoint present');
	assert.match(PROF, /onboardingService\.evaluate\(req\.userId\)/, 'owner-scoped to req.userId');
});
