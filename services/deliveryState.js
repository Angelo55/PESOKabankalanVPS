/**
 * Referral "delivery state" — the ONE source of truth for the register's derived
 * status (Phase 1 pagination made this derivation exist in SQL as well as JS).
 *
 * A referral's delivery state is not a stored column; it is derived from the
 * referral status, the letter's email status, and the outbox job status. Before
 * this module the logic lived in TWO hand-written copies — a JS `if` ladder in
 * the frontend's Referrals.jsx and a SQL CASE in referralRepository.js — that
 * could silently drift so the filter and the badge disagreed.
 *
 * Now the ordered RULES are declared once here. `deliveryStateOf()` evaluates them
 * in JS and `buildDeliveryStateCaseSql()` GENERATES the SQL CASE from the very same
 * list, so the backend's two views can never diverge. `test/deliveryState.test.js`
 * locks the buckets. The frontend's deliveryState() still mirrors this by hand
 * (separate package) — keep it matching the buckets this module's test asserts.
 *
 * ORDER IS SIGNIFICANT: first matching rule wins. Voided outranks a delivered
 * letter (the referral no longer stands, even though the citizen holds the PDF).
 */

const DELIVERY_STATE_RULES = [
	{ state: 'voided',       js: (r) => r.status === 'Voided',    sql: "rq.status = 'Voided'" },
	{ state: 'not_referred', js: (r) => r.status === 'Rejected',  sql: "rq.status = 'Rejected'" },
	// Seeker-acceptance lifecycle (#6, flag referral_acceptance_enabled). These have
	// no letter/email yet, so they must be classified BEFORE the delivered/queued
	// rules — otherwise a not-yet-accepted endorsement would read as 'queued'.
	{ state: 'declined',            js: (r) => r.status === 'Declined',                  sql: "rq.status = 'Declined'" },
	{ state: 'awaiting_acceptance', js: (r) => r.status === 'Pending Seeker Acceptance', sql: "rq.status = 'Pending Seeker Acceptance'" },
	{ state: 'delivered',    js: (r) => r.email_status === 'Sent', sql: "rl.email_status = 'Sent'" },
	{ state: 'failed',       js: (r) => r.job_status === 'failed' || r.email_status === 'Failed', sql: "rj.status = 'failed' OR rl.email_status = 'Failed'" },
	{ state: 'processing',   js: (r) => r.job_status === 'processing', sql: "rj.status = 'processing'" },
];

// The fall-through when no rule matches (approved, letter not yet sent, etc.).
const DEFAULT_STATE = 'queued';

/** Every state this derivation can produce, in rule order then the default. */
const DELIVERY_STATES = [...DELIVERY_STATE_RULES.map((r) => r.state), DEFAULT_STATE];

/** Evaluate the rules against a referral row (first match wins). */
function deliveryStateOf(row = {}) {
	for (const rule of DELIVERY_STATE_RULES) {
		if (rule.js(row)) return rule.state;
	}
	return DEFAULT_STATE;
}

/**
 * Build the SQL CASE that buckets a joined referral row into its delivery state.
 * Uses rq (referral_queue), rl (referral_letters), rj (referral_jobs) aliases —
 * the caller's FROM must join those (referralRepository.REGISTER_LEAN_FROM does).
 */
function buildDeliveryStateCaseSql() {
	const whens = DELIVERY_STATE_RULES
		.map((r) => `        WHEN ${r.sql} THEN '${r.state}'`)
		.join('\n');
	return `\n    CASE\n${whens}\n        ELSE '${DEFAULT_STATE}'\n    END`;
}

module.exports = { DELIVERY_STATE_RULES, DEFAULT_STATE, DELIVERY_STATES, deliveryStateOf, buildDeliveryStateCaseSql };
