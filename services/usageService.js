const pool = require('../db');
const { resourcesForScope, evaluateState } = require('../config/quotas');

/**
 * Usage computation for the quota/limit indicators (task: usage/limit system).
 *
 * Attaches LIVE per-user usage to the static catalogue in config/quotas.js and
 * returns one row per resource for GET /api/usage (seeker) and
 * GET /api/peso-admin/usage (admin). Read-only.
 *
 * Rules baked in here:
 *   - Trash-aware counts EXACTLY mirror what the enforcement path counts, so the
 *     indicator never disagrees with the actual quota calc: tracked applications
 *     and saved vacancies count `deleted_at IS NULL` (Trash-excluded), matching
 *     importService's MAX_TOTAL_TRACKED enforcement.
 *   - `imports_daily` mirrors importService's ROLLING 24h window (NOT calendar day).
 *   - The storage figure is the DB footprint (stored base64 length) of a seeker's
 *     avatar + certificate library + per-application certificate & résumé snapshots.
 *     It COUNTS everything stored (incl. records that would survive a soft-delete),
 *     kept deliberately separate from the Trash-excluded record counts.
 *   - Every sub-query degrades to 0 on error (a usage read must never 500 a page,
 *     invariant 0.1); a missing table just yields 0 for that figure.
 */

// Single-scalar query that degrades to a fallback instead of throwing.
async function scalar(sql, params, fallback = 0) {
	try {
		const [rows] = await pool.query(sql, params);
		const row = rows && rows[0];
		if (!row) return fallback;
		const v = Object.values(row)[0];
		return v == null ? fallback : Number(v);
	} catch (e) {
		console.warn('[usage] query degraded:', e && (e.code || e.message));
		return fallback;
	}
}

function attach(resource, usedByKey) {
	const used = resource.type === 'processing' ? null : Number(usedByKey[resource.key] ?? 0);
	const state = evaluateState(resource, used ?? 0);
	const remaining = (resource.max != null && used != null) ? Math.max(0, resource.max - used) : null;
	const percent = (resource.max != null && used != null && resource.max > 0)
		? Math.min(100, Math.round((used / resource.max) * 100))
		: null;
	return {
		key: resource.key,
		label: resource.label,
		category: resource.category,
		type: resource.type,
		unit: resource.unit,
		max: resource.max ?? null,
		used,
		remaining,
		percent,
		state,
		enforced: !!resource.enforced,
		window: resource.window || null,
		soft: !!resource.soft,
		approxBytes: !!resource.approxBytes,
		secondary: resource.secondary || null,
		help: resource.help || '',
	};
}

/** Aggregate stored base64 footprint (bytes) for a seeker. */
async function storedBytes(userId) {
	const [avatar, certLib, certSnap, resumeSnap] = await Promise.all([
		scalar('SELECT COALESCE(LENGTH(avatar_url), 0) AS n FROM users WHERE id = ?', [userId]),
		scalar('SELECT COALESCE(SUM(LENGTH(content_base64)), 0) AS n FROM user_certificates WHERE user_id = ?', [userId]),
		scalar(`SELECT COALESCE(SUM(LENGTH(ac.content_base64)), 0) AS n
				  FROM application_certificates ac
				  JOIN job_applications ja ON ac.application_id = ja.id
				 WHERE ja.applicant_id = ?`, [userId]),
		scalar(`SELECT COALESCE(SUM(LENGTH(ar.file_data)), 0) AS n
				  FROM application_resumes ar
				  JOIN job_applications ja ON ar.application_id = ja.id
				 WHERE ja.applicant_id = ?`, [userId]),
	]);
	return avatar + certLib + certSnap + resumeSnap;
}

/** Live usage for a Job Seeker (owner-scoped by userId). */
async function computeSeekerUsage(userId) {
	const [applications, tracked, saved, referrals, certs, importsToday, pins, stored] = await Promise.all([
		scalar('SELECT COUNT(*) AS n FROM job_applications WHERE applicant_id = ?', [userId]),
		scalar('SELECT COUNT(*) AS n FROM usertrackedjobs WHERE user_id = ? AND deleted_at IS NULL', [userId]),
		scalar('SELECT COUNT(*) AS n FROM saved_jobs WHERE user_id = ? AND deleted_at IS NULL', [userId]),
		scalar(`SELECT COUNT(*) AS n FROM referral_queue rq
				  JOIN job_applications ja ON rq.application_id = ja.id
				 WHERE ja.applicant_id = ?`, [userId]),
		scalar('SELECT COUNT(*) AS n FROM user_certificates WHERE user_id = ?', [userId]),
		scalar('SELECT COUNT(*) AS n FROM import_batches WHERE user_id = ? AND created_at >= (NOW() - INTERVAL 1 DAY)', [userId]),
		scalar('SELECT COUNT(*) AS n FROM conversation_states WHERE user_id = ? AND pinned_at IS NOT NULL', [userId]),
		storedBytes(userId),
	]);

	const usedByKey = {
		peso_applications: applications,
		tracked_applications: tracked,
		saved_vacancies: saved,
		active_referrals: referrals,
		certificate_library: certs,
		imports_daily: importsToday,
		pinned_conversations: pins,
		stored_data: stored,
	};
	return resourcesForScope('seeker').map((r) => attach(r, usedByKey));
}

/**
 * Live usage for a PESO Administrator. `ownerId` is the office owner
 * (req.effectiveOwnerId — so PESO Staff see the Manager's office totals);
 * `userId` is the acting user (pins are per-user).
 */
async function computeAdminUsage(ownerId, userId) {
	const [vacancies, referrals, events, applicants, pins] = await Promise.all([
		scalar('SELECT COUNT(*) AS n FROM pesoadmin_job_posts WHERE peso_admin_id = ?', [ownerId]),
		scalar(`SELECT COUNT(*) AS n FROM referral_queue rq
				  JOIN job_applications ja ON rq.application_id = ja.id
				  JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
				 WHERE pj.peso_admin_id = ? AND rq.status = 'Approved'`, [ownerId]),
		scalar('SELECT COUNT(*) AS n FROM peso_events', []),
		scalar(`SELECT COUNT(*) AS n FROM job_applications ja
				  JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
				 WHERE pj.peso_admin_id = ?`, [ownerId]),
		scalar('SELECT COUNT(*) AS n FROM conversation_states WHERE user_id = ? AND pinned_at IS NOT NULL', [userId]),
	]);

	const usedByKey = {
		vacancies,
		referrals_issued: referrals,
		events,
		applicant_records: applicants,
		pinned_conversations: pins,
	};
	return resourcesForScope('admin').map((r) => attach(r, usedByKey));
}

module.exports = { computeSeekerUsage, computeAdminUsage, storedBytes };
