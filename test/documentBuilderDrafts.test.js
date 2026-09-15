const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the Document Builder draft + AI-generation fixes (2026-08-08).
 *
 *  1. Cover-letter draft persistence: `cover_letter_drafts.user_id` is only a NON-UNIQUE
 *     index, so `INSERT ... ON DUPLICATE KEY UPDATE` silently inserted a new row on every
 *     save (325 rows / 10 users) and the unordered `drafts[0]` returned a stale/empty
 *     draft. The POST must now manage a single row explicitly (no ON DUPLICATE KEY), and
 *     the GET must return the most recent MEANINGFUL draft.
 *  2. Resignation AI body generation must reach parity with the cover letter via a SHARED
 *     service (services/letterBodyService.js) — no duplicated AI wiring.
 *
 * Source-only (no DB: require('../db') runs initDB against prod, §13). `npm test`.
 */

const COVER = fs.readFileSync(path.join(__dirname, '..', 'routes', 'coverLetterRoutes.js'), 'utf8');
const RESIGN = fs.readFileSync(path.join(__dirname, '..', 'routes', 'resignationRoutes.js'), 'utf8');
const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'letterBodyService.js'), 'utf8');
const SCHEMAS = fs.readFileSync(path.join(__dirname, '..', 'job-tracker-frontend', 'src', 'components', 'builder', 'documentSchemas.jsx'), 'utf8');
const MIG_047 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '047_cover_letter_drafts_unique.sql'), 'utf8');

// ── Cover-letter draft fix ──────────────────────────────────────────────────────

test('cover-letter draft POST no longer relies on ON DUPLICATE KEY UPDATE', () => {
	// Strip line comments first — the fix's comments explain WHY it was removed.
	const code = COVER.replace(/\/\/.*$/gm, '');
	assert.doesNotMatch(code, /ON DUPLICATE KEY UPDATE/i,
		'must not use ON DUPLICATE KEY UPDATE in SQL (user_id is non-unique → it silently inserts dup rows)');
});

test('cover-letter draft POST manages a single row (count → update/insert, collapse dups)', () => {
	const start = COVER.indexOf("router.post('/draft'");
	const body = COVER.slice(start, COVER.indexOf('router.', start + 10));
	assert.match(body, /SELECT COUNT\(\*\)[\s\S]*FROM cover_letter_drafts WHERE user_id = \?/i, 'must count existing rows for the user');
	assert.match(body, /UPDATE cover_letter_drafts SET draft_data = \? WHERE user_id = \?/i, 'must update in place when a row exists');
	assert.match(body, /DELETE FROM cover_letter_drafts WHERE user_id = \?/i, 'must collapse duplicates (delete-all) when c > 1');
	assert.match(body, /INSERT INTO cover_letter_drafts/i, 'must insert on first save / after collapse');
});

test('cover-letter draft GET returns the most recent MEANINGFUL draft', () => {
	const start = COVER.indexOf("router.get('/draft'");
	const body = COVER.slice(start, COVER.indexOf("router.post('/draft'"));
	assert.match(body, /ORDER BY updated_at DESC/i, 'must order by recency');
	// Recover work lost to empty auto-saves: prefer the newest row with a non-empty body.
	assert.match(body, /\.find\(\([^)]*\)\s*=>[\s\S]*body[\s\S]*trim\(\)\s*!==\s*''\)/, 'must prefer the newest draft with a non-empty body');
});

// ── Migration 047: cover_letter_drafts UNIQUE(user_id) hardening ─────────────────
// The DB-level defense-in-depth for the dup-row bug above. It must (a) dedup each
// user to one row BEFORE adding the constraint (the ALTER fails while dups exist),
// (b) keep the SAME row the GET returns (newest meaningful body, else newest), and
// (c) add the UNIQUE index re-runnably.

test('migration 047 dedups then adds UNIQUE(user_id) on cover_letter_drafts', () => {
	// Deduplicate step: delete losers, keyed off the winner per user.
	assert.match(MIG_047, /DELETE FROM cover_letter_drafts/i, 'must delete duplicate rows before the ALTER');
	// The kept row must mirror the GET: prefer a non-empty JSON body, then recency.
	assert.match(MIG_047, /JSON_EXTRACT\(c\.draft_data,\s*'\$\.body'\)/i, 'winner selection must inspect the JSON body');
	assert.match(MIG_047, /ORDER BY[\s\S]*updated_at DESC/i, 'winner selection must prefer the newest row');
	// Add-constraint step. Plain ADD UNIQUE INDEX (this TiDB version's parser rejects
	// `ADD INDEX IF NOT EXISTS`; re-runnability comes from STEP 1 being idempotent and
	// a failed migration not being recorded — matches migration 033).
	assert.match(MIG_047, /ADD UNIQUE INDEX uq_cover_letter_drafts_user \(user_id\)/i,
		'must add a UNIQUE(user_id) index');
	assert.doesNotMatch(MIG_047, /ADD (UNIQUE )?INDEX IF NOT EXISTS/i,
		'ADD INDEX IF NOT EXISTS is an ER_PARSE_ERROR on this TiDB version — use plain ADD UNIQUE INDEX');
	// Order matters: the dedup DELETE must come before the ALTER. Compare against the
	// executable SQL only (strip `--` comment lines — the header describes STEP 2 first).
	const sql047 = MIG_047.replace(/^\s*--.*$/gm, '');
	assert.ok(sql047.search(/DELETE FROM cover_letter_drafts/i) < sql047.search(/ADD UNIQUE INDEX/i),
		'the dedup DELETE must precede the ALTER (the ALTER fails while duplicates remain)');
});

test('migration 047 targets rows by _tidb_rowid (table has no primary key)', () => {
	// cover_letter_drafts has no PK/id column, so all-but-one deletion needs a row id.
	assert.match(MIG_047, /_tidb_rowid/i, 'must use TiDB _tidb_rowid to target individual rows without a PK');
	assert.match(MIG_047, /_tidb_rowid DESC/i, 'must break a perfect updated_at tie deterministically so one row survives');
});

// ── Shared letter-body generation service ───────────────────────────────────────

test('letterBodyService exposes generateBody + both prompt builders', () => {
	assert.match(SVC, /module\.exports\s*=\s*\{[^}]*generateBody[^}]*coverLetterPrompt[^}]*resignationPrompt[^}]*\}/,
		'must export generateBody, coverLetterPrompt, resignationPrompt');
	assert.match(SVC, /aiClient\.chat\(/, 'generateBody must go through the unified aiClient');
	assert.match(SVC, /tier:\s*aiClient\.TIER\.DRAFT/, 'must use the DRAFT tier (with failover), like the cover letter did');
});

test('both letter routes reuse the shared generation service (no duplicate AI wiring)', () => {
	assert.match(COVER, /require\(['"]\.\.\/services\/letterBodyService['"]\)/, 'cover letter must import the shared service');
	assert.match(COVER, /generateBody\(coverLetterPrompt\(data\)\)/, 'cover /generate-body must call the shared service');
	assert.match(RESIGN, /require\(['"]\.\.\/services\/letterBodyService['"]\)/, 'resignation must import the shared service');
	assert.match(RESIGN, /generateBody\(resignationPrompt\(data\)\)/, 'resignation /generate-body must call the shared service');
});

test('resignation exposes /generate-body with the same shape as the cover letter', () => {
	assert.match(RESIGN, /router\.post\('\/generate-body'/, 'resignation must add the /generate-body route');
	const start = RESIGN.indexOf("router.post('/generate-body'");
	const body = RESIGN.slice(start, RESIGN.indexOf('router.', start + 10));
	assert.match(body, /const\s*\{\s*data\s*\}\s*=\s*req\.body/, 'must read { data } like the cover letter');
	assert.match(body, /generatedText/, 'must return generatedText');
});

// ── Frontend schema parity ──────────────────────────────────────────────────────

test('resignation schema gains the AI generate action + a generatable body section', () => {
	const start = SCHEMAS.indexOf('const resignation = {');
	const block = SCHEMAS.slice(start, SCHEMAS.indexOf('export const DOCUMENT_SCHEMAS'));
	assert.match(block, /endpoint:\s*'\/resignation\/generate-body'/, 'must define the generate action endpoint');
	assert.match(block, /generate:\s*'generate'/, 'the body section must be marked generatable (shows the button)');
});
