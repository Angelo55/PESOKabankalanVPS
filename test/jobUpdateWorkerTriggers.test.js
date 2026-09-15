const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Worker-trigger precision for PUT /peso-admin/jobs/:id (2026-09).
 * The frontend saves a job edit by ALWAYS re-sending the full form via PUT, so a
 * media-only edit (image swap, handled by the SEPARATE POST /jobs/:id/image endpoint)
 * used to re-arm scoring/proactive/job-alert workers even though nothing scoring-relevant
 * changed. These guards lock the change-detection that fixes it: workers arm ONLY when a
 * field buildScoringPrompt() actually reads has changed (or the vacancy was just published).
 * Same handler serves PESO Admin AND PESO Staff (via effectiveOwnerId), so the rule is one.
 * Source-only (no DB: require('../db') runs initDB against prod, §13).
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pesoAdminRoutes.js'), 'utf8');
const start = SRC.indexOf("router.put('/jobs/:id'");
const put = SRC.slice(start, SRC.indexOf('router.', start + 20)); // just the PUT /jobs/:id handler

test('PUT /jobs/:id snapshots the prior scoring fields + status for change detection', () => {
	assert.match(put, /SELECT id, status, title, company, description, skills, qualifications, education, experience, gender/,
		'the pre-update SELECT must fetch the scoring-relevant fields + status');
	assert.match(put, /const prev = check\[0\]/, 'must keep a prev snapshot');
});

test('scoring worker arms ONLY when a scoring-relevant field changed', () => {
	assert.match(put, /const scoringChanged = Object\.entries\(scoringFields\)\.some/, 'computes scoringChanged');
	assert.match(put, /if \(scoringChanged\) \{\s*applicationScoringService\.enqueueForJob/,
		'the scoring enqueue must be gated on scoringChanged');
});

test('job-alert + proactive arm only when published AND (changed OR just published)', () => {
	assert.match(put, /if \(nowPublished && \(scoringChanged \|\| becamePublished\)\) \{/,
		'alerts/proactive gated on nowPublished && (scoringChanged || becamePublished)');
	const gate = put.slice(put.indexOf('if (nowPublished && (scoringChanged || becamePublished))'), put.indexOf('Enhancement B'));
	assert.match(gate, /jobAlertsService\.enqueueForJob/, 'jobAlerts inside the gate');
	assert.match(gate, /proactiveReferralService\.enqueueForJob/, 'proactive inside the gate');
});

test('featured_image (media) is NOT a scoring field and NOT written by the PUT', () => {
	assert.doesNotMatch(put, /scoringFields\s*=\s*\{[^}]*featured_image/, 'featured_image must not be a scoring field');
	assert.doesNotMatch(put, /UPDATE pesoadmin_job_posts SET[^;]*featured_image/, 'PUT must not write featured_image (its own endpoint owns it)');
});

test('the scoring-change set equals the buildScoringPrompt inputs (no metadata fields)', () => {
	const m = put.match(/const scoringFields = \{([^}]*)\}/);
	assert.ok(m, 'scoringFields object not found');
	const fields = m[1];
	for (const f of ['title', 'company', 'description', 'skills', 'qualifications', 'education', 'experience', 'gender']) {
		assert.match(fields, new RegExp('\\b' + f + '\\b'), `${f} must be a scoring field`);
	}
	for (const f of ['location', 'salary_range', 'positions_available', 'deadline', 'work_setup', 'featured_image']) {
		assert.doesNotMatch(fields, new RegExp('\\b' + f + '\\b'), `${f} must NOT be treated as a scoring field`);
	}
});
