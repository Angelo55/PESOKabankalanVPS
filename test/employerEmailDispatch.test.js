const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the employer-email referral recipient (migration 051). Source-only (no
 * DB: require('../db') runs initDB, §13). Locks that the automation dispatch targets
 * the EMPLOYER's company_email — not the PESO admin's own user email — and that the
 * field is validated + required before a vacancy goes live.
 */

const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'referralRepository.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pesoAdminRoutes.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '051_job_company_email.sql'), 'utf8');

test('migration 051 adds a nullable company_email to the vacancy', () => {
	assert.match(MIG, /ALTER TABLE pesoadmin_job_posts/, 'targets the vacancy table');
	assert.match(MIG, /ADD COLUMN IF NOT EXISTS company_email VARCHAR\(255\) NULL/, 'nullable, idempotent');
});

test('the dispatch payload sources employer email from the vacancy, NOT the PESO admin', () => {
	assert.match(REPO, /pj\.company_email AS employer_email/, 'employer_email comes from pj.company_email');
	assert.doesNotMatch(REPO, /emp\.email AS employer_email/, 'the admin-email source is removed');
	assert.match(REPO, /pj\.company AS employer_name/, 'employer_name is the company, not the admin');
});

test('employer email is validated and REQUIRED before a vacancy is live (Open/Published)', () => {
	assert.match(ROUTES, /function validateCompanyEmail/, 'validator exists');
	assert.match(ROUTES, /\['Open', 'Published'\]\.includes\(status\)/, 'live-status gate');
	assert.match(ROUTES, /required to publish a vacancy/, 'a live vacancy must carry a recipient');
	// Enforced on BOTH create and update.
	const hits = ROUTES.match(/validateCompanyEmail\(company_email, status\)/g) || [];
	assert.ok(hits.length >= 2, 'validated on both POST and PUT /jobs');
});

test('company_email is persisted on create and update, and the column is created defensively at boot', () => {
	assert.match(ROUTES, /INSERT INTO pesoadmin_job_posts \([^)]*company_email/, 'INSERT includes company_email');
	assert.match(ROUTES, /UPDATE pesoadmin_job_posts SET[^;]*company_email=\?/, 'UPDATE includes company_email');
	assert.match(ROUTES, /ADD COLUMN IF NOT EXISTS company_email VARCHAR\(255\) NULL/, 'zero-crash boot ALTER');
});
