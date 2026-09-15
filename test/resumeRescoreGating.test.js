const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Change-driven re-score gating guard for POST /resume/draft (2026-08-07).
 *
 * The résumé autosave is now CHANGE-DRIVEN: the builder only saves a draft when
 * the content actually changed, and sends `rescore: false` when ONLY cosmetic
 * fields (template / photo / language / contact info) changed. The backend must
 * honour that flag — enqueue a live re-score / proactive re-match ONLY when
 * `rescore !== false` — so a cosmetic-only save no longer schedules AI worker
 * jobs, while any content change (or a missing flag, or a legacy caller) still
 * re-scores. This is the safe replacement for the reverted server-side content
 * dirty-check (§18.5): the decision comes from the real client edit and DEFAULTS
 * TO TRUE, so a genuine content change can never be silently swallowed.
 *
 * Reads the route SOURCE rather than requiring it: `require('../db')` runs
 * initDB() against the live database on load (§13), which a test must never do.
 * Run with `npm test` (node --test).
 */

const SRC = fs.readFileSync(
	path.join(__dirname, '..', 'routes', 'resumeRoutes.js'),
	'utf8'
);

/** Body of the POST /resume/draft handler (up to the /optimize route). */
function draftHandler() {
	const start = SRC.indexOf("router.post('/draft'");
	assert.ok(start !== -1, "could not locate the POST /draft route");
	const end = SRC.indexOf("router.post('/optimize'", start);
	assert.ok(end !== -1, "could not locate the end of the /draft route");
	return SRC.slice(start, end);
}

test('POST /resume/draft reads the client rescore flag', () => {
	const body = draftHandler();
	assert.match(body, /const\s*\{\s*resumeData\s*,\s*rescore\s*\}\s*=\s*req\.body/,
		'must destructure `rescore` from req.body');
});

test('re-score + proactive re-match are gated on rescore !== false (default-true)', () => {
	const body = draftHandler();

	// The gate must be the default-true form, so an absent/undefined flag still
	// re-scores (a genuine content change is never swallowed).
	assert.match(body, /if\s*\(\s*rescore\s*!==\s*false\s*\)/,
		'the enqueue must be guarded by `if (rescore !== false)`');

	// Both enqueues must sit INSIDE that guard.
	const guardStart = body.search(/if\s*\(\s*rescore\s*!==\s*false\s*\)/);
	const guarded = body.slice(guardStart);
	assert.match(guarded, /applicationScoringService\.enqueueForUser\(req\.userId\)/,
		'enqueueForUser must be inside the rescore guard');
	assert.match(guarded, /proactiveReferralService\.enqueueForSeeker\(req\.userId\)/,
		'enqueueForSeeker must be inside the rescore guard');

	// And they must not ALSO be called unconditionally before the guard (which
	// would defeat the gating and re-score on every cosmetic-only save).
	const beforeGuard = body.slice(0, guardStart);
	assert.doesNotMatch(beforeGuard, /applicationScoringService\.enqueueForUser\(/,
		'enqueueForUser must not run unconditionally before the guard');
	assert.doesNotMatch(beforeGuard, /proactiveReferralService\.enqueueForSeeker\(/,
		'enqueueForSeeker must not run unconditionally before the guard');
});

test('the /upload route still ALWAYS re-scores (a new file is always AI-relevant)', () => {
	const start = SRC.indexOf("router.post('/upload'");
	assert.ok(start !== -1, "could not locate the POST /upload route");
	const body = SRC.slice(start);
	// Upload has no cosmetic-only case, so it must enqueue unconditionally (no gate).
	assert.match(body, /applicationScoringService\.enqueueForUser\(req\.userId\)/,
		'/upload must enqueue a re-score');
	const uploadHead = body.slice(0, body.indexOf('applicationScoringService.enqueueForUser'));
	assert.doesNotMatch(uploadHead, /if\s*\(\s*rescore\s*!==\s*false\s*\)/,
		'/upload must not gate its re-score on a rescore flag');
});
