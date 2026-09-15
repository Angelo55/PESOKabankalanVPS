/**
 * reportingService — builds the DOLE PESO Accomplishment Report (Phase A).
 *
 * Shapes the aggregate + demographic report from reportingRepository. Read-only; every
 * query is best-effort so a single failing aggregation degrades that block rather than
 * 500-ing the report (the platform's safeQuery posture). Reconciles with the existing
 * §7.11 referral report (same referred/placed cohort) — this ADDS the DOLE accomplishment
 * FORMAT (aggregate counts by sex + educational attainment + a period summary), which the
 * existing flat referral-row CSV does not produce.
 *
 * `ownerId` NULL → office-wide (Super Admin); set → one administrator's postings (PESO
 * Admin, owner-scoped). Placement = 'Hired' ONLY (invariant 0.14). Age is not reported
 * (no DOB captured — Phase B); demographic gaps show a transparent 'Not specified' bucket.
 */
const reportingRepository = require('../repositories/reportingRepository');
const { csvField } = require('../utils/csv');
const { renderAccomplishmentReportPdf } = require('./reportPdfService');

const NOT_SPECIFIED = 'Not specified';
// Preferred display order for known demographic buckets; unknown values sort after (A–Z)
// and 'Not specified' always sits last.
const SEX_ORDER = ['Male', 'Female'];
const EDU_ORDER = [
	'Postgraduate', 'College Graduate', 'College Undergraduate',
	'Vocational / Technical', 'High School Graduate', 'High School Undergraduate',
	'Elementary Graduate', 'Elementary Undergraduate',
];
const AGE_ORDER = ['Below 18', '18-24', '25-34', '35-44', '45-54', '55-64', '65 and above'];

function orderBuckets(present, preferred) {
	const set = new Set(present);
	const ordered = [];
	for (const p of preferred) if (set.has(p)) { ordered.push(p); set.delete(p); }
	const rest = [...set].filter((b) => b !== NOT_SPECIFIED).sort((a, b) => a.localeCompare(b));
	ordered.push(...rest);
	if (set.has(NOT_SPECIFIED)) ordered.push(NOT_SPECIFIED);
	return ordered;
}

/** Roll a (dimension, metrics) matrix up to one dimension (e.g. sex), preserving order. */
function breakdownBy(dimension, registeredRows, referredRows, preferred) {
	const acc = new Map(); // bucket -> { registered, referred, placed }
	const bump = (bucket, key, n) => {
		const row = acc.get(bucket) || { registered: 0, referred: 0, placed: 0 };
		row[key] += Number(n) || 0;
		acc.set(bucket, row);
	};
	for (const r of registeredRows) bump(r[dimension], 'registered', r.registered);
	for (const r of referredRows) { bump(r[dimension], 'referred', r.referred); bump(r[dimension], 'placed', r.placed); }

	return orderBuckets([...acc.keys()], preferred).map((bucket) => ({ bucket, ...acc.get(bucket) }));
}

function validateRange(from, to) {
	for (const [label, value] of [['from', from], ['to', to]]) {
		if (value && Number.isNaN(new Date(value).getTime())) {
			const err = new Error(`The "${label}" date is not a valid date.`);
			err.statusCode = 400;
			throw err;
		}
	}
	if (from && to && new Date(from) > new Date(to)) {
		const err = new Error('The start date must not be after the end date.');
		err.statusCode = 400;
		throw err;
	}
}

async function buildAccomplishmentReport({ ownerId = null, from = null, to = null } = {}) {
	validateRange(from, to);
	const range = { from: from || null, to: to || null };

	// Best-effort: a failing block degrades to empty, never 500s the whole report.
	const safe = async (p, fallback) => { try { return await p; } catch (e) { console.error('[Reporting] block failed:', e.message); return fallback; } };

	const [registeredRows, referredRows, solicited] = await Promise.all([
		safe(reportingRepository.registeredMatrix(range), []),
		safe(reportingRepository.referredMatrix({ ownerId, ...range }), []),
		safe(reportingRepository.solicitedTotals({ ownerId, ...range }), { vacancies: 0, positions: 0 }),
	]);

	const registered = registeredRows.reduce((s, r) => s + (Number(r.registered) || 0), 0);
	const referred = referredRows.reduce((s, r) => s + (Number(r.referred) || 0), 0);
	const placed = referredRows.reduce((s, r) => s + (Number(r.placed) || 0), 0);
	const decided = referredRows.reduce((s, r) => s + (Number(r.decided) || 0), 0);

	const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

	return {
		range,
		scope: ownerId == null ? 'office' : 'administrator',
		generated_at: new Date().toISOString(),
		summary: {
			registered,          // office-wide (registration is not owner-attributable)
			vacancies_solicited: solicited.vacancies,
			positions_solicited: solicited.positions,
			referred,
			placed,
			decided,
		},
		placement_rate: {
			of_all: pct(placed, referred),     // placed / all referred
			of_known: pct(placed, decided),    // placed / referrals with a recorded outcome
			basis: `${placed} placed of ${referred} referred (${referred - decided} with no recorded outcome)`,
		},
		by_sex: breakdownBy('sex', registeredRows, referredRows, SEX_ORDER),
		by_education: breakdownBy('education', registeredRows, referredRows, EDU_ORDER),
		by_age_group: breakdownBy('age_group', registeredRows, referredRows, AGE_ORDER),
		// Honest limits, surfaced so the report is never read as complete when it isn't.
		notes: [
			'Placement counts only referrals with a "Hired" outcome; referrals with no recorded outcome are shown as unknown, not as failures.',
			'"Not specified" reflects applicants whose sex, educational attainment, or date of birth was not captured (or an implausible date of birth).',
			'Age is the current age as of report generation, computed from the applicant\'s date of birth.',
		],
	};
}

/**
 * Sectioned CSV of the aggregate report (distinct from the existing referral-ROW CSV).
 * Every field is escaped + formula-injection-guarded via the shared csvField.
 */
function toCsv(report) {
	const line = (arr) => arr.map(csvField).join(',');
	const pctOrDash = (v) => (v == null ? '—' : `${v}%`);
	const rows = [
		line(['PESO Accomplishment Report']),
		line(['Reporting period', `${report.range.from || 'Beginning'} to ${report.range.to || 'Present'}`]),
		line(['Scope', report.scope]),
		line(['Generated', report.generated_at]),
		'',
		line(['Summary']),
		line(['Indicator', 'Count']),
		line(['Registered applicants (office-wide)', report.summary.registered]),
		line(['Vacancies solicited', report.summary.vacancies_solicited]),
		line(['Positions solicited', report.summary.positions_solicited]),
		line(['Applicants referred', report.summary.referred]),
		line(['Applicants placed (Hired)', report.summary.placed]),
		line(['Placement rate (of all referred)', pctOrDash(report.placement_rate.of_all)]),
		line(['Placement rate (of recorded outcomes)', pctOrDash(report.placement_rate.of_known)]),
		'',
		line(['By sex']),
		line(['Sex', 'Registered', 'Referred', 'Placed']),
		...report.by_sex.map((r) => line([r.bucket, r.registered, r.referred, r.placed])),
		line(['Total', report.summary.registered, report.summary.referred, report.summary.placed]),
		'',
		line(['By educational attainment']),
		line(['Educational attainment', 'Registered', 'Referred', 'Placed']),
		...report.by_education.map((r) => line([r.bucket, r.registered, r.referred, r.placed])),
		line(['Total', report.summary.registered, report.summary.referred, report.summary.placed]),
		'',
		line(['By age group']),
		line(['Age group', 'Registered', 'Referred', 'Placed']),
		...report.by_age_group.map((r) => line([r.bucket, r.registered, r.referred, r.placed])),
		line(['Total', report.summary.registered, report.summary.referred, report.summary.placed]),
	];
	return '﻿' + rows.join('\r\n'); // UTF-8 BOM so Excel reads it correctly
}

/**
 * Build the report AND serialize it in the requested format. Returns
 * { contentType, filename, body } where body is a string (json/csv) or Buffer (pdf).
 * Keeps the two route handlers (PESO admin + Super admin) DRY — they differ only in
 * `ownerId` (owner-scoped vs office-wide) and their auth guard.
 */
async function buildAccomplishmentExport({ ownerId = null, from = null, to = null, format = 'json' } = {}) {
	const report = await buildAccomplishmentReport({ ownerId, from, to });
	const stamp = new Date().toISOString().slice(0, 10);
	const base = `PESO_Accomplishment_Report_${stamp}`;
	if (format === 'pdf') {
		return { contentType: 'application/pdf', filename: `${base}.pdf`, body: await renderAccomplishmentReportPdf(report) };
	}
	if (format === 'csv') {
		return { contentType: 'text/csv; charset=utf-8', filename: `${base}.csv`, body: toCsv(report) };
	}
	return { contentType: 'application/json', filename: `${base}.json`, body: report };
}

module.exports = { buildAccomplishmentReport, buildAccomplishmentExport, toCsv };
