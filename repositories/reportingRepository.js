/**
 * reportingRepository — SQL for the DOLE PESO Accomplishment Report (Phase A).
 *
 * Aggregate + demographic counts over a reporting period. The REFERRED/PLACED cohort
 * is DEFINED IDENTICALLY to the existing §7.11 referral report (`reportOutcomeTotals`):
 *   - a referral counts as "referred" when `referral_queue.status = 'Approved'`,
 *   - dated by `rq.reviewed_at` (the issue date),
 *   - "placed" = its `referral_outcomes.outcome = 'Hired'` (invariant 0.14 — only Hired
 *     is a placement; 'Issued'/no-outcome is UNKNOWN, never a negative).
 * so the two reports RECONCILE (same numerator/denominator).
 *
 * `ownerId` scopes to one PESO Administrator's postings (PESO-admin report); pass NULL
 * for the office-wide figure (Super Admin report). Demographics come from the applicant
 * `users` row (`gender`, `educational_attainment`) — NULL/'' collapses to a transparent
 * 'Not specified' bucket, never hidden. Age is intentionally absent (no DOB captured →
 * Phase B). Registration is NOT owner-scoped (a seeker registers to the platform, not to
 * one admin), so `registeredMatrix` is always office-wide.
 *
 * No `JOIN userprofiles` (invariant 0.8). Date range is inclusive of `to` via
 * `< DATE_ADD(to, INTERVAL 1 DAY)`, matching the existing report exactly.
 */
const db = require('../db');

const NS = "'Not specified'"; // shared bucket label for NULL/empty demographics

// Age-group bucket from a DOB column (Phase B). Current age as of report generation.
// GUARDS bad data: NULL, or an implausible age (< 10 or > 100 — the DB holds at least one
// corrupt DOB giving a negative age), collapse to 'Not specified' rather than a garbage bin.
const AGE_CASE = (dob) => `CASE
	WHEN ${dob} IS NULL THEN ${NS}
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 10 OR TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) > 100 THEN ${NS}
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 18 THEN 'Below 18'
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 25 THEN '18-24'
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 35 THEN '25-34'
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 45 THEN '35-44'
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 55 THEN '45-54'
	WHEN TIMESTAMPDIFF(YEAR, ${dob}, CURDATE()) < 65 THEN '55-64'
	ELSE '65 and above'
END`;

const reportingRepository = {
	/**
	 * Registered applicants in the period, cross-tabbed by (sex, education).
	 * Office-wide (registration is not attributable to one administrator).
	 */
	async registeredMatrix({ from = null, to = null } = {}) {
		// Bucket the demographics in a derived table, then GROUP BY its real columns —
		// grouping by a COALESCE alias trips TiDB's only_full_group_by.
		const [rows] = await db.query(
			`SELECT sex, education, age_group, COUNT(*) AS registered
			 FROM (
				SELECT
					COALESCE(NULLIF(TRIM(gender), ''), ${NS}) AS sex,
					COALESCE(NULLIF(TRIM(educational_attainment), ''), ${NS}) AS education,
					${AGE_CASE('dob')} AS age_group
				FROM users
				WHERE role = 'applicant'
				  AND (? IS NULL OR created_at >= ?)
				  AND (? IS NULL OR created_at < DATE_ADD(?, INTERVAL 1 DAY))
			 ) t
			 GROUP BY sex, education, age_group`,
			[from, from, to, to]
		);
		return rows;
	},

	/**
	 * The referred cohort in the period, cross-tabbed by (sex, education), with the
	 * placed (Hired) and decided (any recorded outcome ≠ 'Issued') counts folded in —
	 * one query yields referred + placed + the two placement-rate denominators.
	 */
	async referredMatrix({ ownerId = null, from = null, to = null } = {}) {
		// Derived table buckets the demographics + carries the outcome; the outer query
		// aggregates (referred / placed / decided) grouped by the real bucket columns.
		const [rows] = await db.query(
			`SELECT
				sex, education, age_group,
				COUNT(*) AS referred,
				SUM(CASE WHEN outcome = 'Hired' THEN 1 ELSE 0 END) AS placed,
				SUM(CASE WHEN outcome IS NOT NULL AND outcome <> 'Issued' THEN 1 ELSE 0 END) AS decided
			 FROM (
				SELECT
					COALESCE(NULLIF(TRIM(u.gender), ''), ${NS}) AS sex,
					COALESCE(NULLIF(TRIM(u.educational_attainment), ''), ${NS}) AS education,
					${AGE_CASE('u.dob')} AS age_group,
					ro.outcome AS outcome
				FROM referral_queue rq
				JOIN job_applications ja ON rq.application_id = ja.id
				JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
				JOIN users u ON ja.applicant_id = u.id
				LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
				WHERE rq.status = 'Approved'
				  AND (? IS NULL OR pj.peso_admin_id = ?)
				  AND (? IS NULL OR rq.reviewed_at >= ?)
				  AND (? IS NULL OR rq.reviewed_at < DATE_ADD(?, INTERVAL 1 DAY))
			 ) t
			 GROUP BY sex, education, age_group`,
			[ownerId, ownerId, from, from, to, to]
		);
		return rows;
	},

	/**
	 * Vacancies solicited in the period (job posts) + total positions. Owner-scoped
	 * when `ownerId` is set. A NULL `positions_available` ("Not specified", §31.6)
	 * contributes 0 positions but still counts as one vacancy.
	 */
	async solicitedTotals({ ownerId = null, from = null, to = null } = {}) {
		const [[row]] = await db.query(
			`SELECT
				COUNT(*) AS vacancies,
				COALESCE(SUM(positions_available), 0) AS positions
			 FROM pesoadmin_job_posts
			 WHERE (? IS NULL OR peso_admin_id = ?)
			   AND (? IS NULL OR created_at >= ?)
			   AND (? IS NULL OR created_at < DATE_ADD(?, INTERVAL 1 DAY))`,
			[ownerId, ownerId, from, from, to, to]
		);
		return { vacancies: Number(row.vacancies) || 0, positions: Number(row.positions) || 0 };
	},
};

module.exports = reportingRepository;
