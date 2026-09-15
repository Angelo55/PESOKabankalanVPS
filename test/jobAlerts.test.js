const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reliability guards for the AI job-alert pipeline (Enhancement D).
 *
 * These lock the invariants that keep the jobMatchWorker fault-tolerant and cheap,
 * and that guarantee a seeker is never double-alerted — the same class of thing
 * that, when it drifted on the re-score query, dead-lettered every job. Like the
 * other suites, they assert on SOURCE text (no DB: require('../db') runs initDB()
 * against the live database, §13).
 *
 * Run with `npm test` (node --test).
 */

const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'jobAlertsRepository.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '031_job_alerts.sql'), 'utf8');

/** Extract the backtick SQL template of a repository method (comments excluded). */
function query(methodName) {
	const m = REPO.match(new RegExp(`async ${methodName}\\b[\\s\\S]*?conn\\.query\\(\`([\\s\\S]*?)\``));
	assert.ok(m, `could not locate the ${methodName} query`);
	return m[1];
}

test('findJobForMatching aliases the REAL job columns (guards schema drift)', () => {
	const sql = query('findJobForMatching');
	// Live pesoadmin_job_posts columns are experience/education, aliased to what
	// aiScoringService reads. If someone "fixes" these to the legacy initDB names
	// (required_experience/educational_requirements), these assertions fail before
	// the worker can dead-letter every job.
	assert.match(sql, /experience\s+AS\s+required_experience/i, 'must alias experience AS required_experience');
	assert.match(sql, /education\s+AS\s+educational_requirements/i, 'must alias education AS educational_requirements');
});

test('generateCandidates keeps the cost + dedup + eligibility guards', () => {
	const sql = query('generateCandidates');
	// Dedup: never re-shortlist a seeker already alerted for this job.
	assert.match(sql, /NOT\s+EXISTS[\s\S]*job_alerts_sent/i, 'must exclude already-alerted seekers');
	// Cost: only score seekers who actually have a parsed resume.
	assert.match(sql, /EXISTS[\s\S]*uploaded_resumes[\s\S]*parsed_text/i, 'must require a parsed resume');
	// Consent: opted-out seekers are excluded before any AI call.
	assert.match(sql, /<>\s*'off'/i, "must exclude frequency = 'off'");
	// Bound: the shortlist is capped so a publish can't fan out to everyone.
	assert.match(sql, /LIMIT\s+\?/i, 'must cap the candidate set');
});

test('recordMatch dedups atomically with INSERT IGNORE', () => {
	const sql = query('recordMatch');
	assert.match(sql, /INSERT\s+IGNORE\s+INTO\s+job_alerts_sent/i, 'dedup relies on INSERT IGNORE + the UNIQUE');
});

test('migration 031 declares the dedup UNIQUE constraints INSERT IGNORE relies on', () => {
	// job_alerts_sent: one row per (seeker, job) — the never-alert-twice guarantee.
	assert.match(MIG, /UNIQUE\s+KEY\s+\w+\s*\(\s*user_id\s*,\s*job_id\s*\)/i, 'job_alerts_sent needs UNIQUE(user_id, job_id)');
	// job_alert_jobs: one match task per job — re-publishing re-arms, never duplicates.
	assert.match(MIG, /UNIQUE\s+KEY\s+\w+\s*\(\s*job_id\s*\)/i, 'job_alert_jobs needs UNIQUE(job_id)');
});
