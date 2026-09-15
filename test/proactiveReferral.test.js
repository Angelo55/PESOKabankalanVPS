const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reliability guards for the Proactive AI Referral matcher (Phase 1).
 *
 * These lock the invariants that keep the proactiveReferralWorker cheap and correct:
 * the scoring query uses the REAL job columns (the drift that once dead-lettered
 * every re-score, §18.5); candidate generation enforces the eligibility + dedup +
 * cost gates; the upsert never resurrects a decided candidate; and the migration
 * declares the UNIQUE constraints the dedup relies on. Like the other suites, they
 * assert on SOURCE text (no DB: require('../db') runs initDB() against prod, §13).
 *
 * Run with `npm test` (node --test).
 */

const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'proactiveReferralRepository.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '032_proactive_referrals.sql'), 'utf8');

/** Extract the backtick SQL template of a repository method (comments excluded). */
function query(methodName) {
	const m = REPO.match(new RegExp(`async ${methodName}\\b[\\s\\S]*?conn\\.query\\(\`([\\s\\S]*?)\``));
	assert.ok(m, `could not locate the ${methodName} query`);
	return m[1];
}

test('findJobForMatching aliases the REAL job columns and selects the owner', () => {
	const sql = query('findJobForMatching');
	assert.match(sql, /experience\s+AS\s+required_experience/i, 'must alias experience AS required_experience');
	assert.match(sql, /education\s+AS\s+educational_requirements/i, 'must alias education AS educational_requirements');
	// Proactive referrals are owner-scoped to the vacancy's publisher.
	assert.match(sql, /peso_admin_id/i, 'must select peso_admin_id for owner-scoping');
});

test('generateCandidates keeps the eligibility + dedup + cost guards', () => {
	const sql = query('generateCandidates');
	// Consent/eligibility: only seekers who have already submitted >=1 application.
	assert.match(sql, /EXISTS[\s\S]*job_applications ja2[\s\S]*applicant_id\s*=\s*u\.id/i, 'must require >=1 existing application');
	// Never suggest a seeker who already applied to THIS job (would be a duplicate).
	assert.match(sql, /NOT\s+EXISTS[\s\S]*job_applications ja[\s\S]*ja\.job_id\s*=\s*\?/i, 'must exclude seekers who already applied to this job');
	// Never re-surface a candidate already decided (dismissed/promoted).
	assert.match(sql, /NOT\s+EXISTS[\s\S]*proactive_referral_candidates[\s\S]*'Dismissed'\s*,\s*'Promoted'/i, 'must exclude decided candidates');
	// Cost: only score seekers who actually have a parsed resume.
	assert.match(sql, /EXISTS[\s\S]*uploaded_resumes[\s\S]*parsed_text/i, 'must require a parsed resume');
	// Bound: the shortlist is capped so a publish can't fan out to everyone.
	assert.match(sql, /LIMIT\s+\?/i, 'must cap the candidate set');
});

test('upsertCandidate re-scores without resurrecting a decided candidate', () => {
	const sql = query('upsertCandidate');
	assert.match(sql, /INSERT\s+INTO\s+proactive_referral_candidates/i, 'must upsert into the candidates table');
	const onDup = sql.split(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i)[1] || '';
	assert.ok(onDup, 'must have an ON DUPLICATE KEY UPDATE clause');
	assert.match(onDup, /match_score\s*=\s*VALUES/i, 'must refresh match_score on re-match');
	// CRITICAL: the update must NOT touch status, or a Dismissed/Promoted candidate
	// would flip back to Suggested and reappear in the queue.
	assert.doesNotMatch(onDup, /status\s*=/i, 'ON DUPLICATE must not overwrite status');
});

test('latestResumeSnapshot orders by the application PK, not a nonexistent ar.id', () => {
	const sql = query('latestResumeSnapshot');
	// application_resumes has NO synthetic id — its PK is application_id (one snapshot
	// per application). "Most recent" therefore means the newest job_applications row,
	// so order by ja.id. Ordering by ar.id raised 1054 "Unknown column 'ar.id'" and
	// failed every proactive approve.
	assert.match(sql, /ORDER\s+BY\s+ja\.id\s+DESC/i, 'must order by ja.id DESC (the application PK)');
	assert.doesNotMatch(sql, /ORDER\s+BY\s+ar\.id/i, 'must NOT order by ar.id — application_resumes has no id column');
});

test('openJobsForSeeker keeps the bound + exclusion guards (P4 re-match)', () => {
	const sql = query('openJobsForSeeker');
	assert.match(sql, /status\s+IN\s*\(\s*'Open'\s*,\s*'Published'\s*\)/i, 'only open/published vacancies');
	assert.match(sql, /NOT\s+EXISTS[\s\S]*job_applications/i, 'exclude jobs the seeker already applied to');
	assert.match(sql, /LIMIT\s+\?/i, 'must cap the job set (one edit can\'t fan out to all vacancies)');
});

test('migration 033 hard-enforces one application per (job, applicant)', () => {
	const MIG33 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '033_job_applications_unique.sql'), 'utf8');
	assert.match(MIG33, /ADD\s+UNIQUE\s+INDEX\s+\w+\s*\(\s*job_id\s*,\s*applicant_id\s*\)/i, 'job_applications needs UNIQUE(job_id, applicant_id)');
});

test('counts() tallies only actionable candidates (joins job + applicant, excludes orphans)', () => {
	// The monitor count must match what an admin can actually see: a candidate whose
	// job or applicant was deleted is an orphan and must not inflate the count.
	assert.match(REPO, /GROUP BY prc\.status/i, 'candidate counts must use the joined group query');
	assert.match(REPO, /proactive_referral_candidates prc[\s\S]*?JOIN\s+pesoadmin_job_posts[\s\S]*?JOIN\s+users/i, 'counts must inner-join job + applicant');
});

test('migration 032 declares the dedup UNIQUEs and the origin column', () => {
	// One Smart-Referral-Queue row per (job, applicant) — the dedup guarantee.
	assert.match(MIG, /UNIQUE\s+KEY\s+\w+\s*\(\s*job_id\s*,\s*applicant_id\s*\)/i, 'candidates need UNIQUE(job_id, applicant_id)');
	// One match task per job — re-publishing re-arms, never duplicates.
	assert.match(MIG, /UNIQUE\s+KEY\s+\w+\s*\(\s*job_id\s*\)/i, 'proactive_match_jobs needs UNIQUE(job_id)');
	// The provenance column that distinguishes an admin-initiated referral.
	assert.match(MIG, /origin\s+ENUM\(\s*'seeker'\s*,\s*'admin_referral'\s*\)/i, 'job_applications.origin enum must exist');
});
