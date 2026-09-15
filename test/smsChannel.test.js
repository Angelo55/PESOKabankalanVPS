const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the SMS notification channel (#8). Source-only (no DB, no network, §13).
 * These lock the invariants that make SMS a SAFE, swappable, best-effort side channel:
 * the provider abstraction, the outbox pattern parity, consent/verification gating, and
 * that an SMS failure can never affect the in-app row or the primary action.
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SVC = read('services', 'smsService.js');
const OUTBOX_SVC = read('services', 'smsOutboxService.js');
const WORKER = read('services', 'smsWorker.js');
const REPO = read('repositories', 'smsOutboxRepository.js');
const TEMPLATES = read('services', 'smsTemplates.js');
const PHONE_VERIFY = read('services', 'phoneVerifyService.js');
const NOTIFY = read('services', 'notificationService.js');
const SETTINGS = read('services', 'systemSettingsService.js');
const CONFIG = read('routes', 'configRoutes.js');
const ADMIN = read('routes', 'adminRoutes.js');
const START = read('startWorkers.js');
const MIG = read('migrations', '044_sms_channel.sql');

test('migration 044 is additive and models the phone-verify + outbox schema', () => {
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS phone_verified_at/, 'phone_verified_at added');
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS sms_opt_in/, 'sms_opt_in added');
	assert.match(MIG, /CREATE TABLE IF NOT EXISTS sms_outbox/, 'sms_outbox created');
	assert.match(MIG, /CREATE TABLE IF NOT EXISTS phone_verifications/, 'phone_verifications created');
	assert.match(MIG, /DEFAULT 0/, 'sms_opt_in defaults OFF so nothing sends until opt-in');
	assert.match(MIG, /uq_sms_outbox_dedupe/, 'dedupe UNIQUE for idempotent enqueue');
});

test('the provider stays behind an abstraction — Semaphore is wired but swappable', () => {
	assert.match(SVC, /module\.exports = \{ sendSms, isSmsConfigured, toE164PH \}/, 'callers only see the abstraction');
	assert.match(SVC, /api\.semaphore\.co\/api\/v4\/messages/, 'Semaphore HTTP endpoint implemented');
	assert.match(SVC, /SEMAPHORE_SENDER_NAME/, 'sender name is env-driven (optional until approved)');
	assert.match(SVC, /if \(senderName\) params\.append\('sendername'/, 'sender name only sent when set');
	assert.match(SVC, /PROVIDERS = \{ semaphore, twilio,/, 'Twilio stays a second provider for swap-out');
	assert.match(SVC, /process\.env\.SMS_PROVIDER/, 'the active provider is chosen by env, not hardcoded');
});

test('a zero-cost console/dev provider validates the workflow without credits', () => {
	assert.match(SVC, /const consoleDev = \{/, 'a dev/sandbox provider exists');
	assert.match(SVC, /console: consoleDev, log: consoleDev/, 'selectable via SMS_PROVIDER=console (or log)');
	assert.match(SVC, /DO NOT use in production/, 'dev provider is documented as non-production');
	// Semaphore is kept intact (on hold), NOT removed.
	assert.match(SVC, /api\.semaphore\.co/, 'Semaphore integration is preserved, not deleted');
});

test('sendSms never throws and no-ops safely when unconfigured (invariant 0.1)', () => {
	assert.match(SVC, /NEVER throws/i, 'documented never-throws contract');
	assert.match(SVC, /if \(!provider\)[\s\S]*?not_configured/, 'unconfigured is a no-op, not an error');
	assert.match(SVC, /catch \(error\)[\s\S]*?send_failed/, 'a provider error returns, never throws');
});

test('the SMS outbox mirrors the proven email/referral outbox concurrency model', () => {
	assert.match(REPO, /status = 'pending'/, 'atomic conditional claim on pending');
	assert.match(REPO, /attempts = attempts \+ 1/, 'claim increments attempts');
	assert.match(REPO, /reclaimStuck/, 'stuck-row reclaim exists');
	assert.match(REPO, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/, 'idempotent dedupe enqueue');
	assert.match(WORKER, /backoffSeconds/, 'exponential backoff');
	assert.match(WORKER, /DEAD after/, 'dead-letter after max attempts');
	assert.match(WORKER, /if \(!isSmsConfigured\(\)\)/, 'worker self-gates on a configured provider (ships dark)');
	assert.match(START, /startSmsWorker/, 'the 7th worker is wired into the shared bootstrap');
});

test('SMS templates are keyed and scoped to referral, claim, and account-suspension events', () => {
	// Referral events + account suspension (item 4) fan out to SMS; still cost-bounded.
	assert.match(TEMPLATES, /SMS_FANOUT_TYPES = new Set\(\[[^\]]*'REFERRAL_ISSUED'[^\]]*'REFERRAL_ENDORSEMENT'[^\]]*\]\)/, 'referral events fan out');
	assert.match(TEMPLATES, /'ACCOUNT_SUSPENDED'/, 'account suspension notice fans out to SMS (item 4)');
	assert.match(TEMPLATES, /'ACCOUNT_REACTIVATED'/, 'reactivation fans out to SMS too — consistent with suspension');
	assert.doesNotMatch(TEMPLATES, /APPLICATION_STATUS/, 'application-status is NOT an SMS type');
	assert.match(TEMPLATES, /function walkInClaim/, 'walk-in claim text exists');
});

test('walk-in claim SMS carries an absolute claim URL + code + open/enter instruction', () => {
	assert.match(TEMPLATES, /claimUrl \|\| appUrl\('\/claim'\)/, 'claim URL falls back to the env-driven absolute appUrl (never a relative path)');
	assert.match(TEMPLATES, /open \$\{url\} and enter code \$\{claimCode\}/, 'instruction tells the seeker to open the link and enter the code');
	// The Manager route builds the same absolute claim URL via appUrl (no relative fallback).
	assert.match(read('routes', 'pesoAdminRoutes.js'), /function claimBaseUrl\(\)\s*\{\s*return appUrl\('\/claim'\)/, 'claimBaseUrl uses appUrl');
});

test('actionable SMS: referral templates carry an auth-gated app link', () => {
	// Referral/endorsement SMS deep-link to /referrals (routes through the app auth guard).
	assert.match(TEMPLATES, /appUrl\('\/referrals'\)/, 'referral SMS includes the /referrals link');
	// The link comes from the env-driven appUrl helper — never a hardcoded production URL.
	assert.match(TEMPLATES, /require\('\.\.\/utils\/appUrl'\)/, 'templates use the shared appUrl helper');
});

test('account-lifecycle SMS de-dupes per MINUTE so every deliberate suspend/reactivate sends', () => {
	// The hour bucket (slice 0,13) wrongly suppressed a repeat suspension within the hour.
	// Lifecycle types must use the minute bucket (slice 0,16); referral events keep hour.
	assert.match(NOTIFY, /ACCOUNT_SUSPENDED' \|\| type === 'ACCOUNT_REACTIVATED'/, 'lifecycle types identified for finer dedupe');
	assert.match(NOTIFY, /slice\(0, isLifecycle \? 16 : 13\)/, 'lifecycle = minute bucket, referral = hour bucket');
});

test('suspend and reactivate both notify via notifyUser (consistent all-channel fan-out)', () => {
	assert.match(ADMIN, /type: 'ACCOUNT_SUSPENDED'/, 'suspend calls notifyUser (→ in-app + SMS fan-out)');
	assert.match(ADMIN, /type: 'ACCOUNT_REACTIVATED'/, 'reactivate calls notifyUser (→ in-app + SMS fan-out)');
	assert.match(ADMIN, /buildStatusEmail\(\{[\s\S]*?suspended: true/, 'suspend enqueues the email notice');
});

test('the channel router keeps the in-app row primary and gates SMS on consent (0.11)', () => {
	// in-app row is written first, THEN SMS fan-out.
	const rowIdx = NOTIFY.indexOf('INSERT INTO notifications');
	const smsCallIdx = NOTIFY.indexOf('await maybeFanOutSms');
	assert.ok(rowIdx > -1 && smsCallIdx > rowIdx, 'SMS fan-out runs after the durable row');
	assert.match(NOTIFY, /sms_notifications_enabled/, 'gated by the runtime setting');
	assert.match(NOTIFY, /!u\.phone_verified_at \|\| !Number\(u\.sms_opt_in\)/, 'requires a verified AND opted-in phone');
	assert.match(NOTIFY, /SMS fan-out skipped[\s\S]*?catch/, 'fan-out never throws into notifyUser');
	assert.match(NOTIFY, /dedupeKey/, 'a double-fired notification texts once');
});

test('phone verification reuses the OTP security discipline; opt-in requires a verified phone', () => {
	assert.match(PHONE_VERIFY, /crypto\.randomInt/, 'not Math.random');
	assert.match(PHONE_VERIFY, /createHash\('sha256'\)/, 'peppered SHA-256');
	assert.match(PHONE_VERIFY, /timingSafeEqual/, 'constant-time compare');
	assert.match(PHONE_VERIFY, /MAX_ATTEMPTS/, 'attempt cap');
	assert.match(PHONE_VERIFY, /phone_verified_at = NOW\(\)/, 'confirm stamps verification');
	assert.match(PHONE_VERIFY, /Verify your mobile number before turning on SMS/, 'opt-in requires verification');
});

test('the flag is registered in DEFINITIONS and exposed to the client', () => {
	// §31.9 lesson: an unregistered systemSettings.get() key THROWS.
	assert.match(SETTINGS, /sms_notifications_enabled:\s*\{/, 'flag registered in the catalogue');
	assert.match(SETTINGS, /SMS_NOTIFICATIONS_ENABLED/, 'env fallback');
	assert.match(CONFIG, /smsNotifications:/, 'client can read whether SMS is on');
});

test('the Super Admin SMS monitor exists and masks recipient numbers', () => {
	assert.match(ADMIN, /router\.get\('\/sms'/, 'GET /admin/sms monitor');
	assert.match(ADMIN, /router\.post\('\/sms\/resend'/, 'resend endpoint');
	assert.match(ADMIN, /maskNumber/, 'recipient numbers are masked on the monitor');
	assert.match(ADMIN, /SMS_RESEND/, 'resend is audited');
});
