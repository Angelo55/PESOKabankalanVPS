const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Change-detection input-hash guard for the PROACTIVE matcher (migration 039, 2026-08-08).
 *
 * The twin of test/scoringInputHashGuard.test.js, for proactiveReferralService.matchJob:
 * a candidate whose scoring inputs are unchanged since the last score for the same
 * (job, applicant) pair is skipped WITHOUT an AI call — safe because scoring is
 * deterministic (temp 0, §21). These guards lock the same safety properties:
 * ship-dark + default-off, signature derived from the shared scoring prompt (no drift),
 * gated at EXECUTION (before scoreApplication), and the hash read/write both conditional
 * so the code is safe BEFORE the additive column exists.
 *
 * Source-only assertions (no DB: require('../db') runs initDB against prod, §13).
 * Run with `npm test` (node --test).
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'proactiveReferralService.js'), 'utf8');
const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'proactiveReferralRepository.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '039_proactive_scoring_input_hash.sql'), 'utf8');

test('matchJob imports the shared signature helper from aiScoringService', () => {
	assert.match(SVC, /require\(['"]\.\/aiScoringService['"]\)/, 'must import aiScoringService');
	assert.match(SVC, /getApplicantResume/, 'must import getApplicantResume (reuse the résumé, no double read)');
	assert.match(SVC, /computeScoringSignature/, 'must import computeScoringSignature (the shared, drift-proof hash)');
});

test('the proactive guard is ship-dark and DEFAULT-OFF (strict === "true")', () => {
	assert.match(SVC, /process\.env\.PROACTIVE_INPUT_HASH_GUARD\s*===\s*'true'/,
		'the guard must default OFF via a strict === "true" flag');
});

test('the guard runs at EXECUTION, before the AI call, and skips via continue', () => {
	const guardIdx = SVC.indexOf('PROACTIVE_INPUT_HASH_GUARD');
	const scoreIdx = SVC.indexOf('scoreApplication({ userId: cand.user_id, job, resumeText })');
	assert.ok(guardIdx !== -1 && scoreIdx !== -1 && guardIdx < scoreIdx,
		'the guard must be evaluated before the guarded scoreApplication call');

	assert.match(SVC, /computeScoringSignature\(\{\s*resume:\s*resumeText,\s*job,\s*extraContext:\s*null\s*\}\)/,
		'must sign the actual proactive scoring inputs (extraContext null — no certs)');
	assert.match(SVC, /inputHash\s*&&\s*cand\.last_scored_input_hash\s*&&\s*inputHash\s*===\s*cand\.last_scored_input_hash/,
		'must compare the fresh signature to the candidate\'s last scored hash');

	// A hash match must SKIP (continue) — never fabricate, never re-score.
	const skipBlock = SVC.slice(SVC.indexOf('inputHash === cand.last_scored_input_hash'));
	assert.match(skipBlock.slice(0, 200), /continue;/, 'a hash match must continue past the AI call');
});

test('the guard reuses the fetched résumé and threads the hash into the upsert', () => {
	assert.match(SVC, /scoreApplication\(\{\s*userId:\s*cand\.user_id,\s*job,\s*resumeText\s*\}\)/,
		'the guarded score must reuse resumeText (no double DB read)');
	assert.match(SVC, /upsertCandidate\(\{[\s\S]*?reason,\s*inputHash\s*,?\s*\}\)/,
		'the upsert must receive inputHash so the next re-match can skip');
});

test('generateCandidates exposes the hash ONLY when includeHash is set (deploy-safe)', () => {
	assert.match(REPO, /generateCandidates\(jobId,\s*\{\s*jobLocation\s*=\s*'',\s*cap\s*=\s*50,\s*includeHash\s*=\s*false\s*\}/,
		'includeHash must default false');
	assert.match(REPO, /includeHash[\s\S]{0,120}last_scored_input_hash/,
		'the hash must be conditionally selected only when includeHash is set');
});

test('upsertCandidate writes the hash ONLY when supplied, and never touches status on dup', () => {
	assert.match(REPO, /upsertCandidate\(\{[^}]*inputHash\s*=\s*null[^}]*\}/, 'inputHash must default null');
	assert.match(REPO, /const dupHash\s*=\s*inputHash\s*\?\s*',\s*last_scored_input_hash = VALUES\(last_scored_input_hash\)'\s*:\s*''/,
		'the hash must be conditionally added to ON DUPLICATE KEY UPDATE');
	// The no-resurrection invariant (§20) must survive: status is never in the update.
	const upsert = REPO.slice(REPO.indexOf('async upsertCandidate'));
	const onDup = upsert.slice(0, upsert.indexOf('`, params)')).split(/ON DUPLICATE KEY UPDATE/i)[1] || '';
	assert.doesNotMatch(onDup, /status\s*=/i, 'ON DUPLICATE must still never overwrite status');
});

test('migration 039 adds last_scored_input_hash additively (IF NOT EXISTS)', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS last_scored_input_hash\s+CHAR\(64\)/i,
		'must add the column with IF NOT EXISTS');
	assert.match(MIG, /proactive_referral_candidates/i, 'must target proactive_referral_candidates');
});
