const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards the synchronized referral-lifecycle feature (2026). Source-only — these
 * read the module TEXT rather than requiring anything, because `require('../db')`
 * runs initDB() against the live database on load (§13). They lock the invariants
 * that matter most, especially the 0.14 boundary: a JOB SEEKER's suggestion must
 * NEVER be written to referral_outcomes (the official placement record that feeds
 * the DOLE report and the public "Successful Referrals" tile).
 *
 * Run with `npm test` (node --test).
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const SERVICE = read('services', 'referralService.js');
const REPO = read('repositories', 'referralRepository.js');
const REF_ROUTES = read('routes', 'referralRoutes.js');
const APP_ROUTES = read('routes', 'applicationRoutes.js');

/** Slice a source region between two anchor substrings (start inclusive, end exclusive). */
function between(src, startAnchor, endAnchor) {
	const start = src.indexOf(startAnchor);
	assert.ok(start !== -1, `anchor not found: ${startAnchor}`);
	const end = endAnchor ? src.indexOf(endAnchor, start + startAnchor.length) : src.length;
	assert.ok(end !== -1, `end anchor not found: ${endAnchor}`);
	return src.slice(start, end);
}

// ── The confirmed defect: My Referrals now returns the real outcome ─────────────
test('listForApplicant selects the placement outcome (LEFT JOIN referral_outcomes)', () => {
	const q = between(REPO, 'async listForApplicant(', 'async listByJob(');
	assert.match(q, /LEFT JOIN referral_outcomes ro/i, 'must LEFT JOIN referral_outcomes');
	assert.match(q, /ro\.outcome/i, 'must select ro.outcome so the seeker sees the recorded outcome');
	assert.match(q, /ro\.outcome_at/i, 'must select ro.outcome_at');
});

// ── Official write path (admin) ─────────────────────────────────────────────────
test('recordOutcome writes the OFFICIAL row and an is_official history row', () => {
	const fn = between(SERVICE, 'async recordOutcome(', 'async suggestOutcome(');
	assert.match(fn, /referralRepository\.setOutcome\(/, 'admin path must write the official referral_outcomes row');
	assert.match(fn, /appendOutcomeHistory\(/, 'admin path must append a history row');
	assert.match(fn, /isOfficial:\s*true/, 'admin history row must be is_official=true');
	assert.match(fn, /notifyUser\(/, 'admin path must notify the seeker on a real change');
	assert.match(fn, /isLifecycleSyncEnabled\(\)/, 'the notify/history side effects must be flag-gated');
});

// ── The 0.14 boundary: a seeker suggestion NEVER becomes official ───────────────
test('suggestOutcome appends a NON-official history row and never touches referral_outcomes', () => {
	const fn = between(SERVICE, 'async suggestOutcome(', 'async getOutcomeHistory(');
	assert.match(fn, /appendOutcomeHistory\(/, 'suggestion must be recorded in the history ledger');
	assert.match(fn, /isOfficial:\s*false/, 'a seeker suggestion must be is_official=false');
	// THE INVARIANT: the seeker path must not write the official placement record.
	assert.doesNotMatch(fn, /setOutcome\(/, 'suggestOutcome must NEVER call setOutcome (invariant 0.14)');
});

test('suggestOutcome is owner-scoped to the applicant the referral names', () => {
	const fn = between(SERVICE, 'async suggestOutcome(', 'async getOutcomeHistory(');
	assert.match(fn, /applicant_id\)\s*!==\s*Number\(seekerId\)/, 'must reject a seeker who does not own the referral (404)');
});

// ── The collaborative endpoint is flag-gated ────────────────────────────────────
test('the seeker suggestion route is gated by the runtime feature flag', () => {
	const route = between(REF_ROUTES, "'/:id/outcome/suggest'", "GET /api/referrals/:id/outcome/history");
	assert.match(route, /referral_lifecycle_sync_enabled/, 'suggest route must read the flag');
	assert.match(route, /403/, 'suggest route must 403 when the feature is disabled');
});

// ── The seeker PESO pipeline endpoint reads the RIGHT table, owner-scoped ────────
test('GET /applications/mine reads job_applications (not the private tracker), owner-scoped, no userprofiles join', () => {
	// Bounded to the /mine handler alone — /unified follows it and legitimately reads
	// usertrackedjobs, so end at the next route to keep this guard precise.
	const route = between(APP_ROUTES, "router.get('/mine'", "router.get('/unified'");
	assert.match(route, /FROM job_applications ja/i, 'must read job_applications (the real PESO submissions)');
	assert.match(route, /ja\.applicant_id = \?/i, 'must be owner-scoped by applicant_id');
	// Check the SQL read, not the word (the /unified doc-comment that follows names the
	// tracker in prose) — /mine must never SELECT FROM the private external-job tracker.
	assert.doesNotMatch(route, /FROM usertrackedjobs/i, 'must NOT read the private external-job tracker');
	assert.doesNotMatch(route, /JOIN userprofiles/i, 'must not blind-join userprofiles (invariant 0.8)');
});

// ── The unified feed COMPOSES both stores, owner-scoped, read-only ──────────────
test('GET /applications/unified composes both stores, owner-scoped, and never mutates job_applications', () => {
	const route = between(APP_ROUTES, "router.get('/unified'", 'JOB SEEKER: SUBMIT JOB APPLICATION');
	// Presentation-layer composition: reads BOTH stores, tagged by source.
	assert.match(route, /FROM job_applications ja/i, 'must read PESO submissions');
	assert.match(route, /FROM usertrackedjobs/i, 'must also read the imported/external tracker');
	assert.match(route, /source:\s*'peso'/, 'PESO rows must be source-tagged');
	assert.match(route, /source:\s*'imported'/, 'imported rows must be source-tagged');
	// Owner-scoped on BOTH queries.
	assert.match(route, /ja\.applicant_id = \?/i, 'PESO query owner-scoped by applicant_id');
	assert.match(route, /user_id = \? AND deleted_at IS NULL/i, 'tracked query owner-scoped + trash-aware');
	assert.doesNotMatch(route, /JOIN userprofiles/i, 'must not blind-join userprofiles (invariant 0.8)');
	// READ-ONLY: the referral pipeline stays FK-bound to job_applications; this feed
	// must never write it (no secondary application entity / duplicate workflow).
	assert.doesNotMatch(route, /INSERT INTO job_applications|UPDATE job_applications|DELETE FROM job_applications/i, 'unified feed must not mutate applications');
});

// ── The migration exists and models the ledger correctly ────────────────────────
test('migration 036 creates referral_outcome_history with the is_official flag', () => {
	const mig = read('migrations', '036_referral_outcome_history.sql');
	assert.match(mig, /CREATE TABLE IF NOT EXISTS referral_outcome_history/i, 'additive create');
	assert.match(mig, /is_official/i, 'must carry the is_official flag (official vs suggestion)');
	assert.match(mig, /changed_by_role/i, 'must record who changed it and in what capacity');
});

// ── G3 (audit): voiding an approved referral NOTIFIES the seeker ─────────────────
// The seeker was told when it was ISSUED (REFERRAL_ISSUED); leaving them uninformed
// on a void made their referral status go stale. The void now sends a best-effort,
// dedicated REFERRAL_WITHDRAWN notification (post-commit, never throws).
test('voidReferral notifies the seeker with REFERRAL_WITHDRAWN (post-commit, best-effort)', () => {
	const fn = between(SERVICE, 'async voidReferral', 'async ');
	assert.match(fn, /io\s*=\s*null/, 'voidReferral accepts io (best-effort push)');
	assert.match(fn, /notifyUser\(io,\s*\{[\s\S]*type:\s*'REFERRAL_WITHDRAWN'/, 'notifies the seeker with the dedicated type');
	assert.match(fn, /userId:\s*job\.applicant_id/, 'targets the seeker (applicant_id)');
	// Must fire AFTER the commit — the void succeeds regardless of the notification.
	assert.ok(fn.indexOf('connection.commit()') < fn.indexOf('REFERRAL_WITHDRAWN'), 'notify comes after commit');
	// The admin's internal reason is not echoed to the seeker.
	assert.doesNotMatch(fn.slice(fn.indexOf('REFERRAL_WITHDRAWN')), /trimmedReason/, 'internal void reason not sent to the seeker');
});

test('findJobForReferral selects applicant_id, and the void route forwards io', () => {
	assert.match(REPO, /findJobForReferral[\s\S]*?ja\.applicant_id AS applicant_id/, 'the void query must expose the seeker id');
	assert.match(REF_ROUTES, /voidReferral\(\{[\s\S]*io:\s*req\.app\.get\('io'\)/, 'the route passes io so the seeker push can fire');
});

test('REFERRAL_WITHDRAWN is a registered, muteable notification type (§7.7)', () => {
	const notifRoutes = read('routes', 'notificationRoutes.js');
	assert.match(notifRoutes, /type:\s*'REFERRAL_WITHDRAWN'/, 'must be in CONTROLLABLE_TYPES (muteable)');
	const bell = read('job-tracker-frontend', 'src', 'components', 'layout', 'NotificationBell.jsx');
	assert.match(bell, /REFERRAL_WITHDRAWN:/, 'must have a TYPE_META entry so the bell renders it');
});

// ── G3.1 + G3.2 (audit): decline notifies the seeker AND sets a 'Not Referred' state ──
test('rejectReferral sets the application to "Not Referred" and notifies the seeker (APPLICATION_DECLINED)', () => {
	const fn = between(SERVICE, 'async rejectReferral', 'async ');
	assert.match(fn, /io\s*=\s*null/, 'rejectReferral accepts io (best-effort push)');
	// G3.2: the seeker's application lifecycle gets a clear terminal state.
	assert.match(fn, /setApplicationStatus\(applicationId,\s*'Not Referred'/, "must system-set the app to 'Not Referred'");
	// G3.1: the seeker is told, post-commit, best-effort, with the dedicated type.
	assert.match(fn, /notifyUser\(io,\s*\{[\s\S]*type:\s*'APPLICATION_DECLINED'/, 'must notify the seeker of the decline');
	assert.ok(fn.indexOf('connection.commit()') < fn.indexOf('APPLICATION_DECLINED'), 'notify comes after commit');
	assert.doesNotMatch(fn.slice(fn.indexOf('APPLICATION_DECLINED')), /\breason\b/, 'internal reject reason not sent to the seeker');
});

test('both reject routes (single + bulk) forward io; APPLICATION_DECLINED is registered + muteable', () => {
	// Count io-forwarding on reject calls (single + bulk loop).
	const rejectCalls = (REF_ROUTES.match(/rejectReferral\(\{[\s\S]*?io:\s*req\.app\.get\('io'\)/g) || []).length;
	assert.ok(rejectCalls >= 2, 'single + bulk reject must both forward io');
	const notifRoutes = read('routes', 'notificationRoutes.js');
	assert.match(notifRoutes, /type:\s*'APPLICATION_DECLINED'/, 'APPLICATION_DECLINED must be muteable (CONTROLLABLE_TYPES)');
	const bell = read('job-tracker-frontend', 'src', 'components', 'layout', 'NotificationBell.jsx');
	assert.match(bell, /APPLICATION_DECLINED:/, 'APPLICATION_DECLINED must have a TYPE_META entry');
});

test("'Not Referred' is a first-class canonical stage in the seeker status system (G3.2)", () => {
	const hook = read('job-tracker-frontend', 'src', 'hooks', 'useUnifiedApplications.js');
	assert.match(hook, /ALT_STAGES\s*=\s*\[[^\]]*'Not Referred'/, 'must be a canonical ALT stage');
	assert.match(hook, /'Not Referred':\s*\{\s*hex:/, 'must have a STAGE_STYLE colour entry');
	assert.match(hook, /PESO_BASE\s*=\s*\{[^}]*'Not Referred':\s*'Not Referred'/, 'PESO base status must map through');
});
