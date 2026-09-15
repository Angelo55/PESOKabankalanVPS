/**
 * ADMIN AUDIT TRAIL — the single writer for admin_audit_logs.
 *
 * WHAT: records what a Super Administrator did, to whom, and when.
 *
 * WHY A SERVICE AND NOT INLINE INSERTS: before this existed, exactly ONE action
 * in the whole platform wrote an audit entry (verification approval). Suspending
 * an account and deleting a job posting — both destructive, both affecting a
 * real person — left no trace at all. One writer means a new administrative
 * action cannot be added without an obvious place to record it.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 * Same contract as notificationService: the audit write is a SECONDARY concern
 * and must never fail the action it describes. An administrator suspending an
 * abusive account must not be blocked because the log table is unavailable.
 *
 * The one exception is deliberate and lives in the caller, not here: role
 * changes write their audit entry INSIDE the same transaction as the change, so
 * a privilege escalation that cannot be recorded does not happen at all. That
 * is the only action where the trade-off runs the other way.
 *
 * ── ACTION NAMING ──────────────────────────────────────────────────────────
 * SCREAMING_SNAKE verbs, past tense, mirroring referral_activity_log so both
 * trails read alike: ACCOUNT_SUSPENDED, ROLE_CHANGED, JOB_DELETED.
 * `action_details` carries the human-readable specifics.
 */

const db = require('../db');

/** Canonical action names. Add here rather than passing ad-hoc strings. */
const AUDIT_ACTIONS = {
	ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
	ACCOUNT_REACTIVATED: 'ACCOUNT_REACTIVATED',
	ROLE_CHANGED: 'ROLE_CHANGED',
	JOB_DELETED: 'JOB_DELETED',
	JOB_IMAGE_CHANGED: 'JOB_IMAGE_CHANGED',
	VERIFICATION_REVIEWED: 'VERIFICATION_REVIEWED',
	SETTING_CHANGED: 'SETTING_CHANGED',

	// PESO Administrator actions. Previously UNRECORDED: a PESO admin could
	// create, edit or delete a vacancy and move an applicant through the hiring
	// pipeline with no trace at all, while the Super Admin's equivalents were
	// fully audited. For a government office the vacancy and hiring trail is
	// exactly what needs to be accountable.
	JOB_CREATED: 'JOB_CREATED',
	JOB_UPDATED: 'JOB_UPDATED',
	JOB_STATUS_BULK_CHANGED: 'JOB_STATUS_BULK_CHANGED',
	APPLICATION_STATUS_CHANGED: 'APPLICATION_STATUS_CHANGED',

	// Workflow automation recovery (n8n replay).
	N8N_REPLAY: 'N8N_REPLAY',

	// Email delivery recovery (Phase 2C outbox resend).
	EMAIL_RESEND: 'EMAIL_RESEND',

	// SMS delivery recovery (#8 outbox resend).
	SMS_RESEND: 'SMS_RESEND',

	// Walk-In Job Seeker registration (#7) — staff encoding a physical visitor into
	// the centralized seeker model, the later account claim, and claim-code reissue.
	WALKIN_CREATED: 'WALKIN_CREATED',
	WALKIN_CLAIMED: 'WALKIN_CLAIMED',
	WALKIN_CLAIM_REISSUED: 'WALKIN_CLAIM_REISSUED',
};

/**
 * Writes one audit entry.
 *
 * `conn` lets a caller enlist this in an existing transaction — used by the
 * role-change path, where the entry and the change must commit together.
 * Omitting it writes on the pool and swallows any failure.
 */
async function record({ adminId, action, targetEntity, targetId, details }, conn = null) {
	const sql = `
		INSERT INTO admin_audit_logs (admin_id, action, target_entity, target_id, action_details)
		VALUES (?, ?, ?, ?, ?)
	`;
	const params = [adminId, action, targetEntity || null, targetId || null, details || null];

	// Inside a transaction the caller owns error handling: if the entry cannot be
	// written, the caller's rollback is the correct outcome.
	if (conn) {
		await conn.query(sql, params);
		return;
	}

	try {
		await db.query(sql, params);
	} catch (error) {
		console.error('[AdminAudit] Could not write audit entry:', error.message);
	}
}

/**
 * Reads the trail, newest first, with optional filters.
 *
 * PAGINATED, unlike the endpoint this replaces — that one was hardcoded to
 * LIMIT 10 because it only ever fed a dashboard panel, which meant the
 * remaining history was unreachable through the UI at all.
 */
async function list({ action, adminId, from, to, limit = 50, offset = 0 } = {}) {
	const where = [];
	const params = [];

	if (action) { where.push('l.action = ?'); params.push(action); }
	if (adminId) { where.push('l.admin_id = ?'); params.push(adminId); }
	if (from) { where.push('l.created_at >= ?'); params.push(from); }
	if (to) { where.push('l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); }

	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

	// Bounded so a malformed query string cannot ask for the entire table.
	const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
	const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);

	const [rows] = await db.query(`
		SELECT l.id, l.action, l.target_entity, l.target_id, l.action_details,
		       l.created_at, l.admin_id, u.name AS admin_name
		FROM admin_audit_logs l
		LEFT JOIN users u ON l.admin_id = u.id
		${whereSql}
		ORDER BY l.created_at DESC, l.id DESC
		LIMIT ? OFFSET ?
	`, [...params, safeLimit, safeOffset]);

	const [[{ total }]] = await db.query(
		`SELECT COUNT(*) AS total FROM admin_audit_logs l ${whereSql}`,
		params
	);

	return { rows, total: Number(total), limit: safeLimit, offset: safeOffset };
}

/** Distinct action names present in the data, for the filter dropdown. */
async function listActions() {
	const [rows] = await db.query(
		'SELECT DISTINCT action FROM admin_audit_logs ORDER BY action'
	);
	return rows.map((r) => r.action);
}

module.exports = { record, list, listActions, AUDIT_ACTIONS };
