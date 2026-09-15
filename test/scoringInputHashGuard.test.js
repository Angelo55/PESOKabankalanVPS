const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Change-detection input-hash guard for AI re-scoring (migration 038, 2026-08-08).
 *
 * A re-score's inputs (résumé + the job's scoring fields) are hashed
 * into a signature; when the signature matches the last SUCCESSFUL score's, the worker
 * completes the job WITHOUT an AI call — safe because scoring is deterministic (temp 0,
 * §21). These guards lock the SAFETY properties that keep it from repeating the reverted
 * server-side dirty-check (§18.5, `2464403`) that silently swallowed real re-scores:
 *
 *   1. The guard is SHIP-DARK and DEFAULT-OFF (strict === 'true') — behaviour is
 *      identical to before until the migration is applied and the flag is set.
 *   2. The signature is derived from the EXACT assembled scoring prompt, so it can
 *      never drift from what is actually scored (a hash omitting a scored input could
 *      wrongly skip a real change).
 *   3. It gates at EXECUTION (in the worker, before the AI call), never at scheduling
 *      — so a mistake costs one redundant AI call, never a swallowed re-score.
 *   4. The hash write is CONDITIONAL (omitted when the guard is off), so the code is
 *      safe BEFORE the additive column exists.
 *
 * Source-only assertions (no DB: require('../db') runs initDB against prod, §13).
 * Run with `npm test` (node --test).
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiScoringService.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(__dirname, '..', 'services', 'applicationScoringWorker.js'), 'utf8');
const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'applicationScoringRepository.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '038_scoring_input_hash.sql'), 'utf8');

// ── aiScoringService: the signature is derived from the scored prompt ───────────

test('aiScoringService exports buildScoringPrompt + computeScoringSignature', () => {
	assert.match(SVC, /module\.exports\s*=\s*\{[^}]*buildScoringPrompt[^}]*\}/, 'must export buildScoringPrompt');
	assert.match(SVC, /module\.exports\s*=\s*\{[^}]*computeScoringSignature[^}]*\}/, 'must export computeScoringSignature');
});

test('scoreApplication scores the SAME string buildScoringPrompt builds (no drift)', () => {
	assert.match(SVC, /const\s+prompt\s*=\s*buildScoringPrompt\(\{\s*resume,\s*job,\s*extraContext\s*\}\)/,
		'scoreApplication must build its prompt via buildScoringPrompt');
});

test('computeScoringSignature hashes the assembled prompt, whitespace-normalized', () => {
	const m = SVC.match(/function computeScoringSignature\([\s\S]*?\n\}/);
	assert.ok(m, 'computeScoringSignature not found');
	const body = m[0];
	// Derived from the shared prompt builder → captures exactly the scored inputs.
	assert.match(body, /buildScoringPrompt\(\{\s*resume,\s*job,\s*extraContext\s*\}\)/,
		'signature must be built from buildScoringPrompt (so it cannot drift from scoring)');
	// Whitespace-normalized so formatting-only changes do not force a re-score.
	assert.match(body, /\.replace\(\/\\s\+\/g,\s*' '\)/, 'must whitespace-normalize before hashing');
	assert.match(body, /createHash\('sha256'\)/, 'must SHA-256 the normalized inputs');
	// No résumé → null, so an empty résumé is never treated as "unchanged".
	assert.match(body, /return null/, 'must return null when there is no résumé');
});

// ── Worker: ship-dark, execution-time, never swallows a real re-score ──────────

test('the input-hash guard is ship-dark and DEFAULT-OFF (strict === "true")', () => {
	assert.match(WORKER, /const INPUT_HASH_GUARD\s*=\s*process\.env\.SCORING_INPUT_HASH_GUARD\s*===\s*'true'/,
		'the guard must default OFF via a strict === "true" flag');
});

test('the guard runs at EXECUTION, before the AI call, and skips via completeWithoutScore', () => {
	// The skip branch must call completeWithoutScore (not fail, not fabricate) and RETURN
	// before scoreApplication.
	const guardIdx = WORKER.indexOf('INPUT_HASH_GUARD');
	const scoreIdx = WORKER.indexOf('await scoreApplication(');
	assert.ok(guardIdx !== -1 && scoreIdx !== -1 && guardIdx < scoreIdx,
		'the guard must be evaluated before the scoreApplication call');

	assert.match(WORKER, /computeScoringSignature\(\{\s*resume:\s*resumeText,\s*job:\s*application\s*\}\)/,
		'the worker must sign the actual scoring inputs (résumé + job fields; certificates are no longer a scoring input)');
	assert.match(WORKER, /inputSignature\s*&&\s*inputSignature\s*===\s*application\.last_scored_input_hash/,
		'must compare the fresh signature to the LAST scored hash');

	// The skip branch: complete without an AI call, and return.
	const skipBlock = WORKER.slice(WORKER.indexOf('inputSignature === application.last_scored_input_hash'));
	assert.match(skipBlock.slice(0, 400), /completeWithoutScore\(job\.id,\s*'skipped/, 'a hash match must complete the job without scoring');
});

test('the worker passes the signature to markScored and reuses the fetched résumé', () => {
	assert.match(WORKER, /markScored\(job\.id,\s*job\.application_id,\s*score,\s*inputSignature\)/,
		'markScored must receive the input signature');
	// resumeText fetched once and threaded into scoreApplication (no double DB read).
	assert.match(WORKER, /scoreApplication\(\{[^}]*resumeText\s*\}\)/, 'scoreApplication must receive the reused resumeText');
});

// ── Repository: deploy-safe conditional read + write of the hash column ─────────

test('findApplicationForScoring selects the hash column ONLY when includeHash is set', () => {
	assert.match(REPO, /findApplicationForScoring\(applicationId,\s*includeHash\s*=\s*false,\s*conn\s*=\s*pool\)/,
		'includeHash must default false (column not referenced pre-migration)');
	assert.match(REPO, /includeHash\s*\?\s*',\s*ja\.last_scored_input_hash'\s*:\s*''/,
		'the hash column must be conditionally added to the SELECT');
});

test('markScored writes the hash ONLY when supplied (safe pre-migration)', () => {
	assert.match(REPO, /markScored\(jobId,\s*applicationId,\s*score,\s*inputHash\s*=\s*null,\s*conn\s*=\s*pool\)/,
		'inputHash must default null');
	assert.match(REPO, /const hashSet\s*=\s*inputHash\s*\?\s*',\s*last_scored_input_hash = \?'\s*:\s*''/,
		'the hash column must be conditionally added to the UPDATE SET');
	// The immutable apply-time COALESCE guards must remain intact alongside the new column.
	assert.match(REPO, /match_score\s*=\s*COALESCE\(\s*match_score/i, 'apply-time COALESCE must be preserved');
});

// ── Migration 038 is additive + idempotent ─────────────────────────────────────

test('migration 038 adds last_scored_input_hash additively (IF NOT EXISTS)', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS last_scored_input_hash\s+CHAR\(64\)/i,
		'must add the column with IF NOT EXISTS (additive, idempotent)');
});
