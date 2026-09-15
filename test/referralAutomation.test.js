const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the seeker referral-automation preference (manual | auto_accept |
 * auto_decline). Source-only (no DB: require('../db') runs initDB, §13). Locks the
 * enforcement point, the fail-safe-to-manual behaviour, the persistence table, and
 * the owner-scoped GET/PUT endpoints.
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'referralService.js'), 'utf8');
const PROFILE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'profileRoutes.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '050_conversation_states_and_referral_prefs.sql'), 'utf8');

test('the three referral modes are defined and validated', () => {
	assert.match(SVC, /REFERRAL_MODES\s*=\s*\['manual',\s*'auto_accept',\s*'auto_decline'\]/, 'the mode allow-list exists');
	assert.match(SVC, /Invalid referral preference/, 'setReferralPreference rejects unknown modes');
});

test('preference lookup FAILS SAFE to manual (automation is never assumed)', () => {
	assert.match(SVC, /async function getReferralPreference/, 'reader exists');
	assert.match(SVC, /REFERRAL_MODES\.includes\(mode\)\s*\?\s*mode\s*:\s*'manual'/, 'unknown/absent → manual');
	assert.match(SVC, /treating as manual/, 'a read error → manual, never auto');
});

test('auto-accept / auto-decline are enforced AFTER the endorsement commits (full audit trail)', () => {
	// The automation must run on the committed Pending-Seeker-Acceptance referral,
	// reusing the same acceptReferral/declineReferral tail — not a parallel path.
	assert.match(SVC, /const mode = await getReferralPreference\(application\.applicant_id\)/, 'reads the seeker preference in the endorse path');
	assert.match(SVC, /mode === 'auto_accept'/, 'auto-accept branch');
	assert.match(SVC, /mode === 'auto_decline'/, 'auto-decline branch');
	assert.match(SVC, /referralService\.acceptReferral\(\{ referralId, applicantId: application\.applicant_id/, 'auto-accept reuses acceptReferral');
	assert.match(SVC, /referralService\.declineReferral\(\{ referralId, applicantId: application\.applicant_id/, 'auto-decline reuses declineReferral');
});

test('the "please respond" nudge is only sent in MANUAL mode', () => {
	assert.match(SVC, /if \(mode === 'manual'\) \{[\s\S]*?REFERRAL_ENDORSEMENT/, 'the endorsement nudge is gated on manual mode');
});

test('an automation failure leaves the referral for manual review (never blocks the endorsement)', () => {
	assert.match(SVC, /left for manual review/, 'auto action is best-effort, wrapped in try/catch');
});

test('the preference is persisted in referral_preferences (migration 050) and default is manual', () => {
	assert.match(MIG, /CREATE TABLE IF NOT EXISTS referral_preferences/, 'table exists');
	assert.match(MIG, /mode\s+VARCHAR\(20\)\s+NOT NULL\s+DEFAULT\s+'manual'/, 'default mode is manual');
});

test('GET/PUT /profile/referral-preference are owner-scoped (req.userId)', () => {
	assert.match(PROFILE, /router\.get\('\/referral-preference'/, 'GET endpoint');
	assert.match(PROFILE, /router\.put\('\/referral-preference'/, 'PUT endpoint');
	assert.match(PROFILE, /getReferralPreference\(req\.userId\)/, 'GET is scoped to the caller');
	assert.match(PROFILE, /setReferralPreference\(req\.userId/, 'PUT is scoped to the caller');
	assert.match(PROFILE, /CREATE TABLE IF NOT EXISTS referral_preferences/, 'zero-crash boot create so a fresh deploy works');
});
