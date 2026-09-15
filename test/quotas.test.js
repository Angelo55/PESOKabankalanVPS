const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Centralized quota/usage system (2026-09). Locks the catalogue integrity, the
 * state machine, the informational-only decisions, and that the enforcement
 * modules SOURCE their numbers from the catalogue (single source of truth).
 * config/quotas.js is pure (no ../db) so it is required directly; everything that
 * touches the pool is asserted from SOURCE TEXT (§13 — never require('../db')).
 */

const quotas = require('../config/quotas');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('catalogue: every resource has the required metadata and unique keys', () => {
	const seen = new Set();
	for (const r of quotas.RESOURCES) {
		assert.ok(r.key && r.label && r.category, `resource ${r.key} needs key/label/category`);
		assert.ok(['seeker', 'admin', 'both'].includes(r.scope), `${r.key} scope`);
		assert.ok(['count', 'bytes', 'rate', 'processing'].includes(r.type), `${r.key} type`);
		assert.ok(!seen.has(r.key), `duplicate key ${r.key}`);
		seen.add(r.key);
	}
});

test('resourcesForScope includes "both" resources (pins) in each scope', () => {
	const seeker = quotas.resourcesForScope('seeker').map(r => r.key);
	const admin = quotas.resourcesForScope('admin').map(r => r.key);
	assert.ok(seeker.includes('pinned_conversations'), 'pins in seeker scope');
	assert.ok(admin.includes('pinned_conversations'), 'pins in admin scope');
	assert.ok(seeker.includes('tracked_applications') && !admin.includes('tracked_applications'), 'seeker-only stays seeker');
	assert.ok(admin.includes('vacancies') && !seeker.includes('vacancies'), 'admin-only stays admin');
});

test('LIMITS match the real enforcement numbers', () => {
	const L = quotas.LIMITS;
	assert.equal(L.IMPORT_FILE_BYTES, 2 * 1024 * 1024);
	assert.equal(L.IMPORT_ROWS, 500);
	assert.equal(L.IMPORTS_PER_DAY, 5);
	assert.equal(L.TRACKED_APPLICATIONS, 1000);
	assert.equal(L.CERTIFICATE_FILE_BYTES, 5 * 1024 * 1024);
	assert.equal(L.CERTIFICATES_PER_APPLICATION, 8);
	assert.equal(L.CERTIFICATE_LIBRARY, 30);
	assert.equal(L.PINNED_CONVERSATIONS, 5);
	assert.equal(L.JOB_IMAGE_BYTES, 8 * 1024 * 1024);
	assert.equal(L.EVENT_BANNER_CHARS, 3_000_000);
});

test('evaluateState: only ENFORCED limits ever block; informational never blocks', () => {
	const enforced = quotas.RESOURCE_BY_KEY.tracked_applications; // enforced count, max 1000
	assert.equal(quotas.evaluateState(enforced, 500), 'normal');
	assert.equal(quotas.evaluateState(enforced, 900), 'warn');   // 90% >= 85%
	assert.equal(quotas.evaluateState(enforced, 1000), 'blocked');

	const informational = quotas.RESOURCE_BY_KEY.peso_applications; // max null
	assert.equal(quotas.evaluateState(informational, 0), 'unlimited');
	assert.equal(quotas.evaluateState(informational, 99999), 'unlimited');

	const storage = quotas.RESOURCE_BY_KEY.stored_data; // bytes, soft, enforced:false
	assert.equal(quotas.evaluateState(storage, storage.max), 'warn', 'a soft cap warns, never blocks');
	assert.equal(quotas.evaluateState(storage, storage.max * 2), 'warn', 'over the soft cap is still only warn (informational)');

	const proc = quotas.RESOURCE_BY_KEY.resume_upload; // processing
	assert.equal(quotas.evaluateState(proc, null), 'reference');
});

test('informational resources are max:null + enforced:false (invariant 0.1 — no new blocks)', () => {
	for (const key of ['peso_applications', 'saved_vacancies', 'active_referrals', 'vacancies', 'referrals_issued', 'events', 'applicant_records']) {
		const r = quotas.RESOURCE_BY_KEY[key];
		assert.equal(r.max, null, `${key} has no cap`);
		assert.equal(r.enforced, false, `${key} is informational, not enforced`);
	}
});

test('enforcement modules SOURCE their numbers from config/quotas (single source)', () => {
	const imp = read('services', 'importService.js');
	assert.match(imp, /require\('\.\.\/config\/quotas'\)/, 'importService reads the catalogue');
	assert.match(imp, /QUOTAS\.IMPORT_FILE_BYTES[\s\S]*QUOTAS\.TRACKED_APPLICATIONS/, 'import limits come from the catalogue');

	const cert = read('repositories', 'certificatesRepository.js');
	assert.match(cert, /require\('\.\.\/config\/quotas'\)/, 'certificatesRepository reads the catalogue');
	assert.match(cert, /MAX_LIBRARY\s*=\s*QUOTAS\.CERTIFICATE_LIBRARY/, 'cert library cap from the catalogue');

	const msg = read('routes', 'messageRoutes.js');
	assert.match(msg, /MAX_PINNED\s*=\s*require\('\.\.\/config\/quotas'\)\.LIMITS\.PINNED_CONVERSATIONS/, 'pin cap from the catalogue');
});

test('usageService: Trash-excluded counts + rolling-24h imports + owner scoping (no userprofiles join)', () => {
	const svc = read('services', 'usageService.js');
	assert.match(svc, /usertrackedjobs WHERE user_id = \? AND deleted_at IS NULL/, 'tracked count is Trash-excluded (matches enforcement)');
	assert.match(svc, /saved_jobs WHERE user_id = \? AND deleted_at IS NULL/, 'saved count is Trash-excluded');
	assert.match(svc, /import_batches WHERE user_id = \? AND created_at >= \(NOW\(\) - INTERVAL 1 DAY\)/, 'imports mirror the rolling 24h window');
	assert.match(svc, /pesoadmin_job_posts WHERE peso_admin_id = \?/, 'admin vacancies owner-scoped');
	assert.ok(!/JOIN userprofiles/i.test(svc), 'must not JOIN userprofiles (invariant 0.8)');
});

test('usage endpoints exist and are owner-scoped', () => {
	const seeker = read('routes', 'usageRoutes.js');
	assert.match(seeker, /computeSeekerUsage\(req\.userId\)/, 'seeker usage scoped to req.userId');
	const admin = read('routes', 'pesoAdminRoutes.js');
	assert.match(admin, /computeAdminUsage\(req\.effectiveOwnerId, req\.userId\)/, 'admin usage owner-scoped via effectiveOwnerId');
	const server = read('server.js');
	assert.match(server, /'\/api\/usage'/, 'seeker usage route mounted');
});
