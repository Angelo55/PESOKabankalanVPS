const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the Tier-1 AI-scoring recalibration (2026-08). These lock the
 * consistency/robustness fixes that came out of the eval — NOT a rubric change:
 * one shared prompt for the board + apply-time, the full job context (skills +
 * qualifications + experience + education under either alias), deterministic params,
 * and the re-score lookup carrying skills/qualifications. Source-only assertions
 * (no DB: require('../db') runs initDB against prod, §13).
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiScoringService.js'), 'utf8');
const JOBROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobRoutes.js'), 'utf8');
const SCORE_REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'applicationScoringRepository.js'), 'utf8');
const AICLIENT = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiClient.js'), 'utf8');

test('scoring prompt feeds the job skills + qualifications (B3)', () => {
	assert.match(SVC, /Required skills:/i, 'prompt must include the job skills line');
	assert.match(SVC, /Qualifications:/i, 'prompt must include the job qualifications line');
	assert.match(SVC, /job\.skills/, 'must read job.skills');
	assert.match(SVC, /job\.qualifications/, 'must read job.qualifications');
});

test('scoring reads experience/education under either alias (raw apply vs aliased worker)', () => {
	assert.match(SVC, /job\.required_experience\s*\|\|\s*job\.experience/, 'experience must fall back raw->aliased');
	assert.match(SVC, /job\.educational_requirements\s*\|\|\s*job\.education/, 'education must fall back raw->aliased');
});

test('scoring uses deterministic params (temp 0 + JSON mode)', () => {
	assert.match(SVC, /temperature:\s*0\b/, 'temperature must be 0 for reproducible scores');
	assert.match(SVC, /response_format:\s*\{\s*type:\s*'json_object'\s*\}/, 'must request json_object mode');
});

test('the board (/match) scores through the shared core, not an inline prompt (B1)', () => {
	assert.match(JOBROUTES, /require\(['"]\.\.\/services\/aiScoringService['"]\)/, 'must import the shared scorer');
	assert.match(JOBROUTES, /scoreApplication\(\{[^}]*job:\s*job\[0\][^}]*\}\)/, '/match must call scoreApplication');
});

test('the re-score lookup selects skills + qualifications (so workers score with full context)', () => {
	assert.match(SCORE_REPO, /pj\.skills/, 'findApplicationForScoring must select pj.skills');
	assert.match(SCORE_REPO, /pj\.qualifications/, 'findApplicationForScoring must select pj.qualifications');
});

test('markScored fills apply-time columns only if NULL (COALESCE) — decoupled apply scoring', () => {
	// Apply-time scoring moved to the worker; markScored must set match_score/ai_analysis/
	// ai_scored_at on the FIRST score via COALESCE, and never overwrite them on a re-score
	// (immutable apply-time source of truth, §7.4).
	assert.match(SCORE_REPO, /match_score\s*=\s*COALESCE\(\s*match_score/i, 'match_score must be COALESCE-guarded');
	assert.match(SCORE_REPO, /ai_scored_at\s*=\s*COALESCE\(\s*ai_scored_at/i, 'ai_scored_at must be COALESCE-guarded');
});

// ── F1: score provenance (auditability) ─────────────────────────────────────────

test('aiClient exposes chatDetailed reporting the provider + model actually used', () => {
	assert.match(AICLIENT, /async function chatDetailed\(/, 'chatDetailed must exist');
	// Provenance now flows through the shared failover loop (runCompletion): it stamps the
	// serving provider/model onto the returned message, and chatDetailed surfaces the content
	// alongside them. (Refactored in Phase A of the public assistant so tool_calls survive.)
	assert.match(AICLIENT, /return\s*\{\s*message,\s*provider:\s*p\.name,\s*model:/, 'the failover loop must stamp the serving provider/model');
	assert.match(AICLIENT, /return\s*\{\s*content:\s*message\.content,\s*provider,\s*model\s*\}/, 'chatDetailed must return { content, provider, model }');
	assert.match(AICLIENT, /async function chat\(opts\)\s*\{\s*return \(await chatDetailed\(opts\)\)\.content;/, 'chat() must delegate to chatDetailed (unchanged string contract)');
	assert.match(AICLIENT, /module\.exports\s*=\s*\{[^}]*chatDetailed[^}]*\}/, 'chatDetailed must be exported');
});

test('scoreApplication stamps provenance (provider/model/promptVersion/scoredAt) via chatDetailed', () => {
	assert.match(SVC, /const SCORING_PROMPT_VERSION\s*=/, 'a prompt-version constant must exist');
	assert.match(SVC, /aiClient\.chatDetailed\(/, 'must call chatDetailed to learn the serving provider/model');
	const retStart = SVC.indexOf('overall: Math.round');
	const ret = SVC.slice(retStart, SVC.indexOf('} catch (error)', retStart));
	assert.match(ret, /provenance:\s*\{/, 'the returned score must carry a provenance object');
	assert.match(ret, /provider,/, 'provenance records the provider');
	assert.match(ret, /model,/, 'provenance records the model');
	assert.match(ret, /promptVersion:\s*SCORING_PROMPT_VERSION/, 'provenance records the prompt version');
	assert.match(ret, /scoredAt:/, 'provenance records when it was scored');
});

test('provenance is OUTPUT metadata — NEVER part of the scoring signature (no spurious re-scores)', () => {
	// computeScoringSignature hashes buildScoringPrompt() only; buildScoringPrompt must not
	// mention provenance, so a provider failover can never change the hash / trigger a re-score.
	assert.match(SVC, /function computeScoringSignature[\s\S]*buildScoringPrompt\(/, 'signature is derived from buildScoringPrompt');
	const prompt = SVC.slice(SVC.indexOf('function buildScoringPrompt'), SVC.indexOf('function computeScoringSignature'));
	assert.doesNotMatch(prompt, /provenance|promptVersion|scoredAt/, 'the scored prompt must not include provenance/output metadata');
});
