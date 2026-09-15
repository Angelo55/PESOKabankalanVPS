const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * PESO Admin dashboard CSV export parity (2026-09).
 * The dashboard DISPLAYS 6 KPIs + vacancy/application distributions + pending actions +
 * a monthly trend series; the export used to include only 4 KPIs + the 2 distributions
 * (missing job seekers, employers, pending actions, and trends), from DUPLICATED SQL.
 * These guards lock the fix: overview + export both read ONE computeOverview() (parity by
 * construction), the export carries every displayed metric, and it respects the trend
 * window. Source-only (no DB: require('../db') runs initDB against prod, §13).
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pesoAdminRoutes.js'), 'utf8');
const slice = (marker) => { const i = SRC.indexOf(marker); return i === -1 ? '' : SRC.slice(i, SRC.indexOf('router.', i + 20)); };
const exportBody = slice("router.get('/analytics/export'");
const overviewBody = slice("router.get('/analytics/overview'");

test('overview + export share ONE computeOverview() so they cannot drift', () => {
	assert.match(SRC, /async function computeOverview\(adminId, windowMonths\)/, 'computeOverview() must exist');
	assert.match(overviewBody, /computeOverview\(req\.userId/, 'overview must read computeOverview');
	assert.match(exportBody, /computeOverview\(req\.userId/, 'export must read computeOverview (not its own SQL)');
	assert.doesNotMatch(exportBody, /db\.query/, 'export must NOT re-run its own duplicated SQL');
});

test('the export includes ALL six displayed KPIs (parity)', () => {
	for (const kpi of ['totalJobSeekers', 'totalEmployers', 'activeVacancies', 'applicationsReceived', 'referralLettersGenerated', 'successfulHires']) {
		assert.match(exportBody, new RegExp('c\\.' + kpi + '\\b'), `export must include the ${kpi} KPI`);
	}
});

test('the export includes pending actions, both distributions, and the monthly trend', () => {
	assert.match(exportBody, /p\.pendingReferrals/, 'pending: referrals awaiting review');
	assert.match(exportBody, /p\.newApplications/, 'pending: new applications');
	assert.match(exportBody, /p\.failedReferrals/, 'pending: failed referral letters');
	assert.match(exportBody, /d\.vacancyStatus/, 'vacancy status distribution');
	assert.match(exportBody, /d\.applicationStatus/, 'application status distribution');
	assert.match(exportBody, /d\.monthly/, 'monthly employment trend series');
});

test('the export respects the trend window (?months=), matching the on-screen view', () => {
	assert.match(exportBody, /resolveAnalyticsWindow\(req\.query\.months\)/, 'export resolves the ?months window');
});
