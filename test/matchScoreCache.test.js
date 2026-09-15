const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * G3.3 — board match-preview cache invalidation. The board preview and the committed
 * application score diverged (75 vs 30) when the preview was a CACHED score for an older
 * résumé. The cache is now a shared module invalidated the moment a résumé changes.
 * matchScoreCache is pure in-memory (no DB) so it is required directly here.
 */
const matchScoreCache = require('../services/matchScoreCache');
const { createTtlCache } = require('../utils/ttlCache');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('ttlCache.delByPrefix removes only the matching keys', () => {
	const c = createTtlCache({ ttlMs: 60000, max: 100 });
	c.set('7:1', 'a'); c.set('7:2', 'b'); c.set('70:1', 'c'); c.set('8:1', 'd');
	const removed = c.delByPrefix('7:');
	assert.strictEqual(removed, 2, "only '7:' keys removed (not '70:' or '8:')");
	assert.strictEqual(c.get('7:1'), undefined);
	assert.strictEqual(c.get('7:2'), undefined);
	assert.strictEqual(c.get('70:1'), 'c', "'70:1' must survive (prefix is '7:' not '7')");
	assert.strictEqual(c.get('8:1'), 'd');
});

test("matchScoreCache.invalidateUser clears that user's previews, keyed by (user, job)", () => {
	matchScoreCache.set(42, 100, { overall: 75 });
	matchScoreCache.set(42, 200, { overall: 60 });
	matchScoreCache.set(43, 100, { overall: 90 });
	assert.deepStrictEqual(matchScoreCache.get(42, 100), { overall: 75 });

	matchScoreCache.invalidateUser(42);
	assert.strictEqual(matchScoreCache.get(42, 100), undefined, 'user 42 preview invalidated');
	assert.strictEqual(matchScoreCache.get(42, 200), undefined, 'all of user 42 invalidated');
	assert.deepStrictEqual(matchScoreCache.get(43, 100), { overall: 90 }, 'other users untouched');
	assert.strictEqual(matchScoreCache.invalidateUser(null), 0, 'null userId is a safe no-op');
});

test('the board /match route uses the shared cache (not a private one)', () => {
	const jobRoutes = read('routes', 'jobRoutes.js');
	assert.match(jobRoutes, /require\('\.\.\/services\/matchScoreCache'\)/, 'jobRoutes imports the shared cache');
	assert.match(jobRoutes, /matchScoreCache\.get\(req\.userId,\s*jobId\)/, 'reads by (userId, jobId)');
	assert.match(jobRoutes, /matchScoreCache\.set\(req\.userId,\s*jobId,\s*score\)/, 'writes by (userId, jobId)');
});

test("résumé-change sites invalidate the user's board previews (G3.3)", () => {
	const resumeRoutes = read('routes', 'resumeRoutes.js');
	const invalidations = (resumeRoutes.match(/matchScoreCache\.invalidateUser\(req\.userId\)/g) || []).length;
	assert.ok(invalidations >= 2, 'builder save + résumé upload both invalidate');
	const appRoutes = read('routes', 'applicationRoutes.js');
	assert.match(appRoutes, /matchScoreCache\.invalidateUser\(applicantId\)/, 'apply-time résumé overwrite invalidates');
});
