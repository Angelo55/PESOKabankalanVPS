const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Centralized environment-aware storage (services/storageService.js).
 * Locks the contract that fixes "images work locally but fail in production":
 *   - driver is env-driven (STORAGE_DRIVER), default 'local';
 *   - R2 credentials/bucket come EXCLUSIVELY from env (no secrets in code);
 *   - the AWS SDK is lazy-required so local dev never needs it;
 *   - the job-featured image routes go through storageService, not local disk.
 * Source-only (no DB / no network): require('../db') runs initDB against prod (§13).
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SVC = read('services', 'storageService.js');
const PESO = read('routes', 'pesoAdminRoutes.js');
const ADMIN = read('routes', 'adminRoutes.js');
const preFns = SVC.slice(0, SVC.indexOf('function ')); // module head, before any function body

test('driver is env-driven (STORAGE_DRIVER) and defaults to local', () => {
	assert.match(SVC, /process\.env\.STORAGE_DRIVER/, 'driver must come from env');
	assert.match(SVC, /\|\|\s*'local'/, 'must default to local');
});

test('R2 credentials + bucket come EXCLUSIVELY from env (no secrets in code)', () => {
	for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) {
		assert.match(SVC, new RegExp('process\\.env\\.' + v), `${v} must be read from env`);
	}
	// The endpoint is BUILT from the env account id (template literal), never a hardcoded string.
	assert.doesNotMatch(SVC, /["']https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com/i, 'endpoint must not be hardcoded');
});

test('both providers exist and save() dispatches on the driver', () => {
	assert.match(SVC, /function localSave\(/, 'local writer present');
	assert.match(SVC, /PutObjectCommand/, 'r2 writer present');
	assert.match(SVC, /DRIVER === 'r2'\s*\?\s*r2Save/, 'save() dispatches by driver');
});

test('remove() is best-effort and never throws', () => {
	const m = SVC.match(/async function remove\([\s\S]*?\n}/);
	assert.ok(m, 'remove() not found');
	assert.match(m[0], /try\s*{/, 'remove() must swallow errors (invariant 0.1)');
});

test('the AWS SDK is LAZY-required (local dev never loads it at module init)', () => {
	assert.doesNotMatch(preFns, /require\(['"]@aws-sdk/, 'no top-level require of the AWS SDK');
	assert.match(SVC, /require\('@aws-sdk\/client-s3'\)/, 'AWS SDK required lazily inside a function');
});

test('job-featured image routes go through storageService, not local disk', () => {
	for (const [name, src] of [['pesoAdminRoutes', PESO], ['adminRoutes', ADMIN]]) {
		assert.match(src, /require\('\.\.\/services\/storageService'\)/, `${name} must use storageService`);
		assert.match(src, /storageService\.save\(/, `${name} must save via storageService`);
		assert.match(src, /storageService\.remove\(/, `${name} must clean up via storageService`);
		assert.match(src, /multer\.memoryStorage\(\)/, `${name} must use memory storage`);
		assert.doesNotMatch(src, /multer\.diskStorage/, `${name} must NOT write featured images to local disk`);
	}
});

test('validation (size limit + MIME allow-list) is preserved at the route', () => {
	for (const src of [PESO, ADMIN]) {
		assert.match(src, /fileSize:\s*8\s*\*\s*1024\s*\*\s*1024/, '8MB size limit kept');
		assert.match(src, /image\/jpeg.*image\/png.*image\/webp/s, 'MIME allow-list kept');
	}
});
