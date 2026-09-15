const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Schema-drift guard for the re-score query (Enhancement B).
 *
 * The re-score worker dead-lettered EVERY job once because
 * findApplicationForScoring selected pj.required_experience /
 * pj.educational_requirements — names that live only in the legacy db.js initDB,
 * not on the real pesoadmin_job_posts table (whose columns are experience /
 * education). This test locks the query to the REAL columns so the drift can't
 * silently come back.
 *
 * It reads the repository SOURCE rather than requiring it: `require('../db')`
 * runs initDB() on load (db.js:179), which would touch the live database — a
 * test must never do that (§13). So we assert on the query TEMPLATE text, which
 * also keeps the check independent of any DB.
 *
 * Run with `npm test` (node --test).
 */

const SRC = fs.readFileSync(
	path.join(__dirname, '..', 'repositories', 'applicationScoringRepository.js'),
	'utf8'
);

/** Extract the backtick SQL template of a repository method (comments excluded). */
function extractQuery(methodName) {
	const re = new RegExp(`async ${methodName}\\b[\\s\\S]*?conn\\.query\\(\`([\\s\\S]*?)\``);
	const m = SRC.match(re);
	assert.ok(m, `could not locate the ${methodName} query`);
	return m[1];
}

test('findApplicationForScoring selects the REAL job columns, aliased', () => {
	const sql = extractQuery('findApplicationForScoring');

	// Live columns (baseline migration), aliased to what aiScoringService reads.
	assert.match(sql, /pj\.experience\s+AS\s+required_experience/i, 'must select pj.experience AS required_experience');
	assert.match(sql, /pj\.education\s+AS\s+educational_requirements/i, 'must select pj.education AS educational_requirements');

	// The drifted legacy names must NEVER be selected directly — they do not exist
	// on the live table and dead-letter every re-score.
	assert.doesNotMatch(sql, /pj\.required_experience/i, 'must not select pj.required_experience (legacy/initDB-only name)');
	assert.doesNotMatch(sql, /pj\.educational_requirements/i, 'must not select pj.educational_requirements (legacy/initDB-only name)');
});

// ── Finalized-referral exclusion (2026-08-04, §18.5) ────────────────────────
// A REFERRED application is a finalized record and must never be live-re-scored.

test('ACTIVE_STATUSES is the standardized pre-referral set (no Referred/Interview/Hired/Rejected)', () => {
	const m = SRC.match(/const ACTIVE_STATUSES\s*=\s*(\[[^\]]*\])/);
	assert.ok(m, 'ACTIVE_STATUSES array not found');
	const arr = m[1];
	assert.match(arr, /'Applied'/); assert.match(arr, /'Under Review'/); assert.match(arr, /'Shortlisted'/);
	for (const finalized of ['Referred', 'Interview', 'Hired', 'Rejected']) {
		assert.doesNotMatch(arr, new RegExp(`'${finalized}'`), `ACTIVE_STATUSES must NOT include '${finalized}' (finalized/deprecated)`);
	}
});

test('NOT_FINALIZED guard excludes applications with an Approved referral', () => {
	const m = SRC.match(/const NOT_FINALIZED\s*=\s*`([\s\S]*?)`/);
	assert.ok(m, 'NOT_FINALIZED guard not found');
	const g = m[1];
	assert.match(g, /NOT\s+EXISTS/i, 'must be a NOT EXISTS subquery');
	assert.match(g, /referral_queue/i, 'must reference referral_queue');
	assert.match(g, /rq\.status\s*=\s*'Approved'/i, "must key on rq.status = 'Approved'");
	assert.match(g, /rq\.application_id\s*=\s*ja\.id/i, 'must correlate on application_id');
});

test('both enqueue paths apply the NOT_FINALIZED guard', () => {
	for (const method of ['enqueueForUserActiveApplications', 'enqueueForJobActiveApplications']) {
		const sql = extractQuery(method);
		assert.match(sql, /ja\.status IN \(\?\) AND \$\{NOT_FINALIZED\}/, `${method} must AND-in the NOT_FINALIZED guard`);
	}
});

test('findApplicationForScoring exposes is_referred for the worker guard', () => {
	const sql = extractQuery('findApplicationForScoring');
	assert.match(sql, /EXISTS\s*\([\s\S]*referral_queue[\s\S]*'Approved'[\s\S]*\)\s+AS\s+is_referred/i, 'must select an is_referred EXISTS flag');
});

test('the worker skips finalized/ineligible applications before scoring', () => {
	const WSRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'applicationScoringWorker.js'), 'utf8');
	assert.match(WSRC, /application\.is_referred\s*\|\|\s*!applicationScoringRepository\.ACTIVE_STATUSES\.includes\(application\.status\)/,
		'worker must skip when is_referred OR status not in ACTIVE_STATUSES');
	assert.match(WSRC, /completeWithoutScore\(job\.id,\s*`skipped/, 'a skipped job must be completed (not scored, not retried)');
});
