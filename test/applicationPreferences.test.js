const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the My Applications card board's pin + colour label (migration 037) and the
 * imported-only bulk status route. Source-only (never requires ../db, which runs initDB
 * against prod, §13). Run with `npm test`.
 */
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const APP_ROUTES = read('routes', 'applicationRoutes.js');
const TRACKED = read('routes', 'trackedJobRoutes.js');

function between(src, startAnchor, endAnchor) {
	const s = src.indexOf(startAnchor);
	assert.ok(s !== -1, `anchor not found: ${startAnchor}`);
	const e = endAnchor ? src.indexOf(endAnchor, s + startAnchor.length) : src.length;
	return src.slice(s, e === -1 ? src.length : e);
}

test('migration 037 creates application_preferences keyed by (user_id, app_uid), no FK', () => {
	const mig = read('migrations', '037_application_preferences.sql');
	assert.match(mig, /CREATE TABLE IF NOT EXISTS application_preferences/i);
	assert.match(mig, /PRIMARY KEY \(user_id, app_uid\)/i, 'one pref row per (user, unified uid)');
	assert.doesNotMatch(mig, /FOREIGN KEY/i, 'uid spans two tables — no FK by design');
});

test('PATCH /applications/:uid/preferences validates uid+colour, upserts owner-scoped, never touches job_applications', () => {
	const fn = between(APP_ROUTES, "router.patch('/:uid/preferences'", 'JOB SEEKER: SUBMIT JOB APPLICATION');
	assert.match(fn, /APP_UID_RE\.test\(uid\)/, 'must validate the uid shape');
	assert.match(fn, /APP_PREF_COLORS\.has/, 'must validate colour against the allow-list');
	assert.match(fn, /INSERT INTO application_preferences[\s\S]*ON DUPLICATE KEY UPDATE/i, 'must upsert (true PATCH)');
	assert.match(fn, /req\.userId/, 'must be owner-scoped');
	assert.doesNotMatch(fn, /UPDATE job_applications|INSERT INTO job_applications|DELETE FROM job_applications/i,
		'pin/colour is a personal marker — must never mutate the application/referral record');
});

test('the unified feed attaches personal prefs best-effort (page survives pre-migration)', () => {
	const route = between(APP_ROUTES, "router.get('/unified'", "router.patch('/:uid/preferences'");
	assert.match(route, /FROM application_preferences WHERE user_id = \?/i, 'must read the personal prefs store');
	assert.match(route, /degrade to no prefs/i, 'must degrade (not 500) if the table is missing pre-migration');
});

test('tracked-jobs bulk status is owner-scoped and declared before /:id (else "bulk" is captured as an id)', () => {
	const bulk = TRACKED.indexOf("router.put('/bulk/status'");
	const byId = TRACKED.indexOf("router.put('/:id'");
	assert.ok(bulk !== -1 && byId !== -1, 'both routes must exist');
	assert.ok(bulk < byId, 'bulk/status must precede /:id');
	const fn = between(TRACKED, "router.put('/bulk/status'", "router.put('/:id'");
	assert.match(fn, /WHERE user_id = \? AND id IN \(\?\) AND deleted_at IS NULL/i, 'atomic UPDATE, owner-scoped + trash-aware');
});
