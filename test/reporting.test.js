const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * DOLE PESO Accomplishment Report (Phase A). Source-only (no DB: requiring ../db runs
 * a connectivity check against the live database, §13). Locks the invariants that make
 * the report correct + reconcilable with the existing §7.11 referral report.
 */
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const REPO = read('repositories', 'reportingRepository.js');
const SVC = read('services', 'reportingService.js');
const PDF = read('services', 'reportPdfService.js');
const REF_ROUTES = read('routes', 'referralRoutes.js');
const ADMIN_ROUTES = read('routes', 'adminRoutes.js');

// ── Cohort reconciles with the existing referral report (§7.11) ─────────────────
test('referred cohort matches the existing report: status=Approved, dated by reviewed_at', () => {
	const fn = REPO.slice(REPO.indexOf('async referredMatrix'), REPO.indexOf('async solicitedTotals'));
	assert.match(fn, /rq\.status = 'Approved'/, 'referred = Approved referrals (same as reportOutcomeTotals)');
	assert.match(fn, /rq\.reviewed_at >= \?/, 'dated by reviewed_at (issue date)');
	assert.match(fn, /DATE_ADD\(\?, INTERVAL 1 DAY\)/, 'inclusive of the "to" date, like the existing report');
	assert.match(fn, /pj\.peso_admin_id = \?/, 'owner-scopable by administrator');
});

test('placement counts ONLY Hired (invariant 0.14); decided excludes Issued', () => {
	const fn = REPO.slice(REPO.indexOf('async referredMatrix'), REPO.indexOf('async solicitedTotals'));
	assert.match(fn, /WHEN outcome = 'Hired' THEN 1 ELSE 0 END\) AS placed/, "placed = Hired only");
	assert.match(fn, /outcome <> 'Issued'/, 'decided = referrals with a recorded outcome (Issued = unknown)');
});

test('demographics bucket NULL/empty into a transparent "Not specified", grouped via a derived table', () => {
	// Grouping by a COALESCE alias trips TiDB only_full_group_by — must group by a derived column.
	assert.match(REPO, /const NS = "'Not specified'"/, 'defines the shared Not-specified bucket label');
	assert.match(REPO, /COALESCE\(NULLIF\(TRIM\([^)]*\), ''\), \$\{NS\}\)/, 'null/empty demographics → Not specified bucket');
	assert.match(REPO, /\) t\s*GROUP BY sex, education/i, 'groups by derived-table columns, not the COALESCE alias');
	// Check the SQL only — the header comment legitimately says "No JOIN userprofiles".
	const repoSql = REPO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	assert.doesNotMatch(repoSql, /JOIN\s+userprofiles/i, 'must not blind-join userprofiles (invariant 0.8)');
});

test('registration is office-wide (not owner-scoped); solicited + referred are owner-scopable', () => {
	const reg = REPO.slice(REPO.indexOf('async registeredMatrix'), REPO.indexOf('async referredMatrix'));
	assert.doesNotMatch(reg, /peso_admin_id/, 'registered applicants are not attributable to one administrator');
	assert.match(REPO, /solicitedTotals[\s\S]*peso_admin_id = \?/, 'solicited is owner-scopable');
});

// ── Service shaping + export ─────────────────────────────────────────────────────
test('service exposes both denominators (§7.11) and a Hired-only placement', () => {
	assert.match(SVC, /of_all:\s*pct\(placed, referred\)/, 'placement of_all = placed / referred');
	assert.match(SVC, /of_known:\s*pct\(placed, decided\)/, 'placement of_known = placed / decided');
});

test('CSV export is BOM-prefixed + formula-injection guarded (csvField)', () => {
	assert.match(SVC, /require\('\.\.\/utils\/csv'\)/, 'reuses the shared csvField guard');
	assert.match(SVC, /csvField/, 'every field escaped via csvField');
	assert.match(SVC, /return '\\ufeff'|return '﻿'/, 'CSV carries a UTF-8 BOM for Excel');
});

test('buildAccomplishmentExport serves json / pdf / csv from one builder', () => {
	assert.match(SVC, /format === 'pdf'[\s\S]*renderAccomplishmentReportPdf/, 'pdf via reportPdfService');
	assert.match(SVC, /format === 'csv'[\s\S]*toCsv/, 'csv via toCsv');
	assert.match(PDF, /new PDFDocument/, 'PDF is self-hosted via pdfkit');
	assert.doesNotMatch(PDF, /PDFMonkey|pdfmonkey/i, 'no external PDF service');
});

// ── Routes: both roles, correct scope ────────────────────────────────────────────
test('PESO-admin route is owner-scoped; Super-admin route is office-wide', () => {
	const peso = REF_ROUTES.slice(REF_ROUTES.indexOf("'/reports/accomplishment'"), REF_ROUTES.indexOf("'/reports/accomplishment'") + 700);
	assert.match(peso, /requireRole\(ROLE_KEYS\.PESO_ADMINISTRATOR\)/, 'PESO admin guarded');
	assert.match(peso, /ownerId:\s*req\.userId/, 'PESO admin report is owner-scoped');

	const admin = ADMIN_ROUTES.slice(ADMIN_ROUTES.indexOf("'/reports/accomplishment'"), ADMIN_ROUTES.indexOf("'/reports/accomplishment'") + 700);
	assert.match(admin, /ownerId:\s*null/, 'Super admin report is office-wide');
	// adminRoutes gates the whole router to SUPER_ADMINISTRATOR (router.use), so no per-route guard needed.
});

// ── Phase B: age-group breakdown (from users.dob) ───────────────────────────────
test('age-group bucketing guards implausible / missing DOB into "Not specified"', () => {
	assert.match(REPO, /const AGE_CASE = \(dob\) =>/, 'AGE_CASE derives an age bucket from a DOB column');
	assert.match(REPO, /TIMESTAMPDIFF\(YEAR, \$\{dob\}, CURDATE\(\)\) < 10 OR TIMESTAMPDIFF\(YEAR, \$\{dob\}, CURDATE\(\)\) > 100 THEN \$\{NS\}/, 'implausible ages (<10 or >100) collapse to Not specified, not a garbage bucket');
	assert.match(REPO, /WHEN \$\{dob\} IS NULL THEN \$\{NS\}/, 'missing DOB → Not specified');
});

test('both matrices carry age_group and group by it (3D: sex, education, age_group)', () => {
	assert.match(REPO, /\$\{AGE_CASE\('dob'\)\} AS age_group/, 'registeredMatrix buckets age');
	assert.match(REPO, /\$\{AGE_CASE\('u\.dob'\)\} AS age_group/, 'referredMatrix buckets age (applicant dob)');
	const groupBys = REPO.match(/GROUP BY sex, education, age_group/g) || [];
	assert.ok(groupBys.length >= 2, 'both matrices group by (sex, education, age_group)');
});

test('service exposes by_age_group with a preferred age ordering', () => {
	assert.match(SVC, /AGE_ORDER = \['Below 18', '18-24', '25-34', '35-44', '45-54', '55-64', '65 and above'\]/, 'DOLE-style age brackets, ordered');
	assert.match(SVC, /by_age_group:\s*breakdownBy\('age_group'/, 'report includes by_age_group');
	// CSV + PDF carry the age section too.
	assert.match(SVC, /By age group/, 'CSV has a By age group section');
	assert.match(PDF, /By age group/, 'PDF has a By age group table');
});
