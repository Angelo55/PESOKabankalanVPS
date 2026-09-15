const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for Phase 4 — the seeker-acceptance referral lifecycle (#6) and vacancy
 * de-automation (#11b). Source-only (no DB: require('../db') runs initDB, §13).
 * BOTH features are flag-gated OFF by default, so these lock the ON behaviour AND
 * that the OFF path (today's behaviour) is preserved.
 */

const SVC = fs.readFileSync(path.join(__dirname, '..', 'services', 'referralService.js'), 'utf8');
const DELIVERY = fs.readFileSync(path.join(__dirname, '..', 'services', 'deliveryState.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(__dirname, '..', 'routes', 'configRoutes.js'), 'utf8');
const NOTIF = fs.readFileSync(path.join(__dirname, '..', 'routes', 'notificationRoutes.js'), 'utf8');
const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'referralRepository.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '042_referral_seeker_acceptance.sql'), 'utf8');

test('both Phase-4 features are flag-gated and read per call (ship dark)', () => {
	assert.match(SVC, /referral_acceptance_enabled/, 'acceptance flag');
	assert.match(SVC, /vacancy_manual_fill_enabled/, 'manual-fill flag');
	assert.match(SVC, /async function isAcceptanceEnabled/, 'acceptance flag reader');
	assert.match(SVC, /async function isManualFillEnabled/, 'manual-fill flag reader');
});

test('with acceptance ON the admin ENDORSES (no letter) — the letter waits for the seeker', () => {
	assert.match(SVC, /if \(acceptanceEnabled\)/, 'approveReferral branches on the flag');
	assert.match(SVC, /'Pending Seeker Acceptance'/, 'endorse sets the pending state');
	assert.match(SVC, /REFERRAL_ENDORSEMENT/, 'the seeker is notified to review');
	// The endorse branch must NOT mint a letter — finalize (letter/outbox) is only the OFF/accept path.
	assert.match(SVC, /async acceptReferral/, 'seeker accept exists');
	assert.match(SVC, /async declineReferral/, 'seeker decline exists');
	assert.match(SVC, /finalizeApprovedReferral/, 'accept + direct-approve share the letter/outbox tail');
});

test('vacancy cap is ADVISORY and auto-fill is skipped when manual-fill is ON or the headcount is unspecified (#11b + Not-Specified)', () => {
	assert.match(SVC, /!manualFill && !unspecifiedCapacity && approvedSoFar >= capacity/, 'the 409 cap is skipped under manual-fill or an unspecified headcount');
	assert.match(SVC, /!manualFill && !unspecifiedCapacity && approvedNow >= capacity/, 'auto-fill is skipped under manual-fill or an unspecified headcount');
	// NULL positions_available must never be coerced into a real cap.
	assert.match(SVC, /positions_available == null/, 'unspecified headcount (NULL) is detected, never treated as 0/1');
});

test('accept/decline are owner-scoped and only act on a pending referral', () => {
	assert.match(SVC, /Number\(referral\.applicant_id\) !== Number\(applicantId\)/, 'ownership check');
	assert.match(SVC, /status !== 'Pending Seeker Acceptance'/, 'only a pending referral can be accepted/declined');
});

test('the seeker can SEE referrals awaiting their acceptance (/mine no longer approved-only)', () => {
	assert.match(REPO, /status IN \('Approved', 'Pending Seeker Acceptance', 'Declined'\)/, 'listForApplicant returns pending + declined too');
});

test('delivery-state derivation gains the acceptance buckets (SQL + JS in lockstep)', () => {
	assert.match(DELIVERY, /awaiting_acceptance/, 'awaiting_acceptance bucket');
	assert.match(DELIVERY, /Pending Seeker Acceptance/, 'mapped from the referral status');
	assert.match(DELIVERY, /'declined'/, 'declined bucket');
});

test('the migration APPENDS the two states (never reorders/removes) and config + mutes are wired', () => {
	assert.match(MIG, /'Pending Seeker Acceptance',\s*\n\s*'Declined'/, 'appended at the END of the enum');
	assert.match(CONFIG, /referralAcceptance/, 'config exposes the acceptance flag');
	assert.match(CONFIG, /vacancyManualFill/, 'config exposes the manual-fill flag');
	assert.match(NOTIF, /REFERRAL_ENDORSEMENT/, 'the endorsement notification is muteable');
});
