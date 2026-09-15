const { test } = require('node:test');
const assert = require('node:assert');
const {
	deliveryStateOf,
	buildDeliveryStateCaseSql,
	DELIVERY_STATES,
} = require('../services/deliveryState');

/**
 * Locks the referral delivery-state contract (services/deliveryState.js). If you
 * change the rules, update these expectations deliberately — and mirror the change
 * in the frontend's deliveryState() in Referrals.jsx, which is the one copy that
 * lives in a separate package and cannot import this module.
 *
 * Run with `npm test` (node --test).
 */

// [row, expected bucket]. Order matters — first matching rule wins.
const CASES = [
	[{ status: 'Voided', email_status: 'Sent' }, 'voided'],                          // void outranks a delivered letter
	[{ status: 'Voided', email_status: 'Sent', job_status: 'processing' }, 'voided'],
	[{ status: 'Rejected' }, 'not_referred'],
	[{ email_status: 'Sent' }, 'delivered'],
	[{ job_status: 'failed' }, 'failed'],
	[{ email_status: 'Failed' }, 'failed'],
	[{ job_status: 'processing' }, 'processing'],
	[{}, 'queued'],
	[{ status: 'Approved', email_status: 'Pending' }, 'queued'],
	[{ status: 'Pending Review' }, 'queued'],
];

test('deliveryStateOf buckets referral rows correctly (first match wins)', () => {
	for (const [row, expected] of CASES) {
		assert.strictEqual(deliveryStateOf(row), expected, `row ${JSON.stringify(row)}`);
	}
});

test('the generated SQL CASE covers exactly the same states', () => {
	const sql = buildDeliveryStateCaseSql();
	for (const state of DELIVERY_STATES) {
		assert.ok(sql.includes(`'${state}'`), `SQL CASE is missing state '${state}'`);
	}
	// Structural sanity: a CASE with an ELSE fallback.
	assert.match(sql, /CASE[\s\S]*ELSE 'queued'[\s\S]*END/);
});
