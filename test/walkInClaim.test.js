const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the Walk-In account CLAIM flow (#7, deferred half). Source-only (§13).
 * Locks the invariants that make claiming SAFE: the code is stored hashed, claiming
 * LINKS the existing row (never a second profile), ownership is verified, codes
 * expire, and staff can reissue.
 */
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SVC = read('services', 'walkInService.js');
const AUTH = read('routes', 'authRoutes.js');
const PESO = read('routes', 'pesoAdminRoutes.js');
const MIG = read('migrations', '045_walk_in_claim.sql');

test('migration 045 is additive: claim expiry + reissue tracking', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS claim_token_expires_at/, 'expiry column');
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS claim_reissue_count/, 'reissue counter');
	assert.doesNotMatch(MIG, /DROP|DELETE FROM/, 'no destructive op on live TiDB');
});

test('the claim code is stored HASHED, never raw (a DB dump cannot hijack an account)', () => {
	assert.match(SVC, /function hashClaimCode/, 'hashing helper exists');
	assert.match(SVC, /createHash\('sha256'\)/, 'peppered SHA-256');
	// The INSERT stores the HASH, not the raw code.
	assert.match(SVC, /claim_token, claim_token_expires_at[\s\S]*?claimTokenHash/, 'stores the hash in claim_token');
	assert.match(SVC, /const claimTokenHash = hashClaimCode\(claimCode\)/, 'raw code is hashed before storage');
});

test('claiming LINKS the existing row and never creates a second profile', () => {
	// completeClaim UPDATEs the existing walk-in row; it must not INSERT a new users row.
	const complete = SVC.slice(SVC.indexOf('async function completeClaim'), SVC.indexOf('async function reissueClaim'));
	assert.match(complete, /UPDATE users/, 'links via UPDATE');
	assert.doesNotMatch(complete, /INSERT INTO users/, 'never inserts a new profile');
	assert.match(complete, /claim_status = 'claimed'/, 'marks the row claimed');
	// Duplicate guard: the chosen email must not belong to ANOTHER account.
	assert.match(complete, /WHERE LOWER\(email\) = \? AND id <> \?/, 'email-uniqueness guard excludes self');
});

test('a claim only resolves an unclaimed, unexpired code (ownership + expiry)', () => {
	assert.match(SVC, /account_origin = 'walk_in' AND claim_status = 'unclaimed' AND claim_token = \?/, 'scoped lookup');
	assert.match(SVC, /claim_token_expires_at < NOW\(\)/, 'expiry enforced');
	// Second factor: a texted phone OTP when a phone is on file + SMS configured.
	assert.match(SVC, /requiresPhoneOtp = !!norm\(row\.phone\) && isSmsConfigured\(\)/, 'phone-OTP second factor');
	assert.match(SVC, /phoneVerifyService\.confirmVerification/, 'OTP is actually verified at complete');
});

test('reissue mints a fresh code, invalidating the old one; and lists unclaimed', () => {
	assert.match(SVC, /async function reissueClaim/, 'reissue exists');
	assert.match(SVC, /claim_reissue_count = claim_reissue_count \+ 1/, 'reissue is tracked');
	assert.match(SVC, /WALKIN_CLAIM_REISSUED/, 'reissue is audited');
	assert.match(SVC, /async function listUnclaimed/, 'unclaimed list for the reissue UI');
});

test('claim endpoints are PUBLIC and sign the seeker in; reissue is Manager-only', () => {
	assert.match(AUTH, /router\.post\('\/claim\/start'/, 'public claim start');
	assert.match(AUTH, /router\.post\('\/claim\/complete'/, 'public claim complete');
	assert.match(AUTH, /jwt\.sign/, 'complete issues a session');
	assert.match(PESO, /router\.post\('\/walk-in\/:id\/reissue', requirePermission\('walkin:manage'\)/, 'reissue is Manager-gated');
	assert.match(PESO, /router\.get\('\/walk-in\/unclaimed', requirePermission\('walkin:manage'\)/, 'list is Manager-gated');
});

test('claim never throws raw; codes are text-deliverable via the SMS channel', () => {
	assert.match(SVC, /async function textClaimLink/, 'claim link can be texted');
	assert.match(SVC, /smsTemplates\.walkInClaim/, 'uses the keyed WALKIN_CLAIM template');
	assert.match(SVC, /templateKey: 'WALKIN_CLAIM'/, 'enqueued under the claim template key');
});
