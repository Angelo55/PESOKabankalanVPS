const pool = require('../db');

/**
 * Proactive AI Referral data access (migration 032, Phase 1).
 *
 * Outbox mechanics mirror the other workers (read-only findDue + atomic claim,
 * §7.5). The feature-specific parts are CANDIDATE GENERATION — a cheap SQL
 * shortlist that bounds how many seekers get AI-scored per job — and the
 * (job, applicant) DEDUP that guarantees one Smart-Referral-Queue row per pair.
 *
 * ELIGIBILITY (the panel's basis for proactive referral): only seekers who have
 * already submitted >=1 application are considered — an existing application is the
 * consent/intent signal. A seeker who already applied to THIS job, or was already
 * dismissed/promoted for it, is excluded (no wasted AI, no resurrecting a decision).
 */

const proactiveReferralRepository = {

	// ── Match outbox (one task per Open/Published job) ───────────────────────

	async enqueueMatch(jobId, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO proactive_match_jobs (job_id, status, attempts, next_run_at)
			VALUES (?, 'pending', 0, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				status = 'pending', attempts = 0, last_error = NULL,
				worker_id = NULL, locked_at = NULL, next_run_at = CURRENT_TIMESTAMP
		`, [jobId]);
		return result.insertId;
	},

	async findDue(limit, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, job_id, attempts, max_attempts
			FROM proactive_match_jobs
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);
		return rows;
	},

	async claim(id, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE proactive_match_jobs
			SET status = 'processing', worker_id = ?, locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, id]);
		return result.affectedRows === 1;
	},

	async markDone(id, matched, conn = pool) {
		await conn.query(`
			UPDATE proactive_match_jobs
			SET status = 'done', matched = ?, worker_id = NULL, locked_at = NULL, last_error = NULL
			WHERE id = ?
		`, [matched, id]);
	},

	async reschedule(id, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE proactive_match_jobs
			SET status = 'pending', last_error = ?, worker_id = NULL, locked_at = NULL,
			    next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), delaySeconds, id]);
	},

	async fail(id, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE proactive_match_jobs
			SET status = 'failed', last_error = ?, worker_id = NULL, locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), id]);
	},

	async reclaimStuck(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE proactive_match_jobs
			SET status = 'pending', worker_id = NULL, locked_at = NULL, next_run_at = CURRENT_TIMESTAMP
			WHERE status = 'processing' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
		`, [staleSeconds]);
		return result.affectedRows;
	},

	// ── Matching ─────────────────────────────────────────────────────────────

	/**
	 * The job to match against, with its owner (proactive referrals are owner-scoped
	 * to the admin who published the vacancy) and the same scoring columns the ATS
	 * re-score uses — REAL columns `experience`/`education`, aliased (guards the drift
	 * that once dead-lettered every re-score, §18.5).
	 */
	async findJobForMatching(jobId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, peso_admin_id, title, company, category, location, skills, qualifications, gender,
			       description, education AS educational_requirements,
			       experience AS required_experience, status, positions_available
			FROM pesoadmin_job_posts
			WHERE id = ?
		`, [jobId]);
		return rows[0] || null;
	},

	/**
	 * CANDIDATE GENERATION — the cheap SQL shortlist that bounds AI cost. Eligible
	 * seekers only: active applicants with a parsed resume who have ALREADY applied
	 * to >=1 job (the consent/intent basis), have NOT applied to THIS job, and have
	 * NOT already been dismissed/promoted for it. Ordered by a light location-match
	 * boost, then recency, and capped. The AI score + threshold do the real relevance.
	 */
	// `includeHash` exposes each candidate's existing last_scored_input_hash (for the
	// ship-dark input-hash guard, migration 039) via a correlated subquery — passed
	// ONLY when PROACTIVE_INPUT_HASH_GUARD is on, so the column is never referenced
	// before the migration lands (deploy-safe, mirrors applicationScoringRepository).
	async generateCandidates(jobId, { jobLocation = '', cap = 50, includeHash = false } = {}, conn = pool) {
		const safeCap = Math.min(Math.max(parseInt(cap, 10) || 50, 1), 500);
		const hashSelect = includeHash
			? `, (SELECT prc_h.last_scored_input_hash FROM proactive_referral_candidates prc_h
			     WHERE prc_h.job_id = ? AND prc_h.applicant_id = u.id) AS last_scored_input_hash`
			: '';
		const params = [];
		if (includeHash) params.push(jobId); // the subquery's ? appears first in the SQL
		params.push(jobId, jobId, jobLocation || '', jobLocation || '', safeCap);
		const [rows] = await conn.query(`
			SELECT u.id AS user_id, u.name, u.email, u.location${hashSelect}
			FROM users u
			WHERE u.role = 'applicant'
			  AND (u.account_status = 'Active' OR u.account_status IS NULL)
			  AND u.email IS NOT NULL
			  AND EXISTS (SELECT 1 FROM uploaded_resumes ur WHERE ur.user_id = u.id AND ur.parsed_text IS NOT NULL AND ur.parsed_text <> '')
			  AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.applicant_id = u.id)
			  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.applicant_id = u.id AND ja.job_id = ?)
			  AND NOT EXISTS (SELECT 1 FROM proactive_referral_candidates prc
			                  WHERE prc.job_id = ? AND prc.applicant_id = u.id AND prc.status IN ('Dismissed','Promoted'))
			ORDER BY (CASE WHEN ? <> '' AND u.location LIKE CONCAT('%', ?, '%') THEN 1 ELSE 0 END) DESC, u.id DESC
			LIMIT ?
		`, params);
		return rows;
	},

	/**
	 * Upsert a suggested candidate. On a brand-new (job, applicant) it inserts a
	 * 'Suggested' row; on re-match it REFRESHES the score/analysis/reason but never
	 * touches status — so a Dismissed or Promoted candidate is silently re-scored yet
	 * does not reappear in the queue. Returns affectedRows (1 = new insert).
	 */
	// `inputHash` (the scoring-input signature) is persisted ONLY when supplied (guard
	// on, post-migration 039), so the column is never referenced before it exists. It
	// records the inputs of THIS score so an unchanged re-match can skip the AI call.
	async upsertCandidate({ jobId, applicantId, score, aiAnalysis, reason, inputHash = null }, conn = pool) {
		const cols = inputHash ? ', last_scored_input_hash' : '';
		const valPlaceholder = inputHash ? ', ?' : '';
		const dupHash = inputHash ? ', last_scored_input_hash = VALUES(last_scored_input_hash)' : '';
		const params = [jobId, applicantId, score ?? null, aiAnalysis ? JSON.stringify(aiAnalysis) : null, (reason || '').slice(0, 500)];
		if (inputHash) params.push(inputHash);
		const [result] = await conn.query(`
			INSERT INTO proactive_referral_candidates (job_id, applicant_id, match_score, ai_analysis, reason, status${cols})
			VALUES (?, ?, ?, ?, ?, 'Suggested'${valPlaceholder})
			ON DUPLICATE KEY UPDATE
				match_score = VALUES(match_score),
				ai_analysis = VALUES(ai_analysis),
				reason = VALUES(reason)${dupHash}
		`, params);
		// affectedRows: 1 = inserted, 2 = updated (ON DUPLICATE), 0 = unchanged.
		return result.affectedRows === 1;
	},

	// ── Smart Referral Queue reads + review (P2) ─────────────────────────────

	/** One candidate, OWNER-SCOPED to the admin who published the vacancy. */
	async findCandidateForAdmin(candidateId, adminId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT prc.id, prc.job_id, prc.applicant_id, prc.match_score, prc.ai_analysis, prc.reason, prc.status,
			       pj.title AS job_title, pj.peso_admin_id,
			       u.name AS applicant_name, u.email AS applicant_email
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			JOIN users u ON u.id = prc.applicant_id
			WHERE prc.id = ? AND pj.peso_admin_id = ?
		`, [candidateId, adminId]);
		return rows[0] || null;
	},

	/** Suggested candidates for this admin's vacancies, ranked by score, paged. */
	async listCandidatesForAdmin(adminId, { limit, offset, jobId = null }, conn = pool) {
		const params = [adminId];
		let where = `pj.peso_admin_id = ? AND prc.status = 'Suggested'`;
		if (jobId) { where += ` AND prc.job_id = ?`; params.push(jobId); }
		const [rows] = await conn.query(`
			SELECT prc.id, prc.job_id, prc.applicant_id, prc.match_score, prc.reason, prc.created_at,
			       pj.title AS job_title, pj.company, pj.positions_available,
			       u.name AS applicant_name, u.email AS applicant_email, u.avatar_thumb, u.avatar_url, u.location
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			JOIN users u ON u.id = prc.applicant_id
			WHERE ${where}
			ORDER BY prc.match_score DESC, prc.created_at DESC
			LIMIT ? OFFSET ?
		`, [...params, limit, offset]);
		return rows;
	},

	async countCandidatesForAdmin(adminId, { jobId = null }, conn = pool) {
		const params = [adminId];
		let where = `pj.peso_admin_id = ? AND prc.status = 'Suggested'`;
		if (jobId) { where += ` AND prc.job_id = ?`; params.push(jobId); }
		const [[{ total }]] = await conn.query(`
			SELECT COUNT(*) AS total
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			WHERE ${where}
		`, params);
		return Number(total) || 0;
	},

	// ── Vacancy-GROUPED reads (Smart Referral Queue, grouped by job) ─────────
	// The queue is grouped by the posted vacancy and RANKED WITHIN each vacancy, so a
	// candidate is only ever compared against others for the SAME job (a defensible
	// referral order). Pagination is BY VACANCY — a job's full ranking never splits
	// across pages. All three methods are owner-scoped and INNER-JOIN users so an
	// orphaned candidate (deleted applicant) is never counted or shown (mirrors counts()).

	/** One page of VACANCIES that have suggested candidates, most-promising first. */
	async listVacancyGroupsPage(adminId, { limit, offset }, conn = pool) {
		const [rows] = await conn.query(`
			SELECT pj.id AS job_id, pj.title AS job_title, pj.company, pj.positions_available,
			       COUNT(prc.id) AS candidate_count, MAX(prc.match_score) AS top_score
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			JOIN users u ON u.id = prc.applicant_id
			WHERE pj.peso_admin_id = ? AND prc.status = 'Suggested'
			GROUP BY pj.id, pj.title, pj.company, pj.positions_available
			ORDER BY top_score DESC, pj.title ASC
			LIMIT ? OFFSET ?
		`, [adminId, limit, offset]);
		return rows;
	},

	/** How many vacancies have at least one suggested candidate (for pagination). */
	async countVacancyGroups(adminId, conn = pool) {
		const [[{ total }]] = await conn.query(`
			SELECT COUNT(*) AS total FROM (
				SELECT prc.job_id
				FROM proactive_referral_candidates prc
				JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
				JOIN users u ON u.id = prc.applicant_id
				WHERE pj.peso_admin_id = ? AND prc.status = 'Suggested'
				GROUP BY prc.job_id
			) t
		`, [adminId]);
		return Number(total) || 0;
	},

	/** All suggested candidates for the given vacancies, ranked by score WITHIN each job. */
	async listCandidatesForJobs(adminId, jobIds, conn = pool) {
		if (!Array.isArray(jobIds) || jobIds.length === 0) return [];
		const [rows] = await conn.query(`
			SELECT prc.id, prc.job_id, prc.applicant_id, prc.match_score, prc.reason, prc.created_at,
			       u.name AS applicant_name, u.email AS applicant_email, u.avatar_thumb, u.avatar_url, u.location
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			JOIN users u ON u.id = prc.applicant_id
			WHERE pj.peso_admin_id = ? AND prc.status = 'Suggested' AND prc.job_id IN (?)
			ORDER BY prc.job_id ASC, prc.match_score DESC, prc.created_at DESC
		`, [adminId, jobIds]);
		return rows;
	},

	/** Does the seeker already have ANY application for this job? (duplicate guard) */
	async findExistingApplication(jobId, applicantId, conn = pool) {
		const [rows] = await conn.query('SELECT id FROM job_applications WHERE job_id = ? AND applicant_id = ? LIMIT 1', [jobId, applicantId]);
		return rows[0] || null;
	},

	// ── Materialization (create the admin-initiated application) ──────────────

	/** The seeker's most recent wizard personal-info snapshot, to reuse on the letter. */
	async latestApplicantSnapshot(applicantId, conn = pool) {
		const [rows] = await conn.query(
			`SELECT applicant_snapshot FROM job_applications WHERE applicant_id = ? AND applicant_snapshot IS NOT NULL ORDER BY id DESC LIMIT 1`,
			[applicantId]
		);
		return rows[0]?.applicant_snapshot || null;
	},

	/** The seeker's most recent immutable resume snapshot (base64), to copy forward. */
	async latestResumeSnapshot(applicantId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT ar.file_name, ar.mime_type, ar.file_data, ar.source
			FROM application_resumes ar
			JOIN job_applications ja ON ja.id = ar.application_id
			WHERE ja.applicant_id = ? AND ar.file_data IS NOT NULL
			ORDER BY ja.id DESC LIMIT 1
		`, [applicantId]);
		return rows[0] || null;
	},

	/** Create the admin-initiated application row (origin = 'admin_referral'). */
	async createAdminInitiatedApplication({ jobId, applicantId, matchScore, aiAnalysis, applicantSnapshot, adminId }, conn = pool) {
		const [res] = await conn.query(`
			INSERT INTO job_applications
				(job_id, applicant_id, status, match_score, ai_analysis, ai_scored_at, applicant_snapshot, resume_url, origin, referred_by, referred_at)
			VALUES (?, ?, 'Applied', ?, ?, ?, ?, 'PESO Proactive Referral', 'admin_referral', ?, CURRENT_TIMESTAMP)
		`, [jobId, applicantId, matchScore ?? null, aiAnalysis || null, matchScore != null ? new Date() : null, applicantSnapshot || null, adminId]);
		return res.insertId;
	},

	/** Copy a resume snapshot onto the new application so the admin sees the résumé. */
	async copyResumeSnapshot(applicationId, snap, conn = pool) {
		if (!snap?.file_data) return;
		await conn.query(`
			INSERT INTO application_resumes (application_id, file_name, mime_type, file_data, source)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_data = VALUES(file_data), source = VALUES(source)
		`, [applicationId, snap.file_name || 'Resume.pdf', snap.mime_type || 'application/pdf', snap.file_data, snap.source || 'proactive']);
	},

	async markPromoted(candidateId, adminId, applicationId, conn = pool) {
		await conn.query(
			`UPDATE proactive_referral_candidates SET status = 'Promoted', reviewed_by = ?, promoted_application_id = ? WHERE id = ?`,
			[adminId, applicationId, candidateId]
		);
	},

	async markDismissed(candidateId, adminId, reason, conn = pool) {
		await conn.query(
			`UPDATE proactive_referral_candidates SET status = 'Dismissed', reviewed_by = ?, dismissed_reason = ? WHERE id = ? AND status = 'Suggested'`,
			[adminId, (reason || '').slice(0, 500), candidateId]
		);
	},

	/** Compensation: return a candidate to the queue after a failed promotion. */
	async revertToSuggested(candidateId, conn = pool) {
		await conn.query(
			`UPDATE proactive_referral_candidates SET status = 'Suggested', promoted_application_id = NULL WHERE id = ?`,
			[candidateId]
		);
	},

	/** Compensation: delete the orphaned application (cascades its resume snapshot). */
	async deleteApplication(applicationId, conn = pool) {
		await conn.query('DELETE FROM job_applications WHERE id = ?', [applicationId]);
	},

	// ── Seeker-edit re-match (P4 sub-flag) ───────────────────────────────────

	/**
	 * Open/Published jobs this seeker has NOT applied to and is NOT already decided
	 * for — the bounded set to re-arm proactive matching against when the seeker's
	 * evidence changes. Capped so one profile edit can't fan out to every vacancy.
	 */
	async openJobsForSeeker(userId, cap = 25, conn = pool) {
		const safeCap = Math.min(Math.max(parseInt(cap, 10) || 25, 1), 100);
		const [rows] = await conn.query(`
			SELECT pj.id
			FROM pesoadmin_job_posts pj
			WHERE pj.status IN ('Open','Published')
			  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.job_id = pj.id AND ja.applicant_id = ?)
			  AND NOT EXISTS (SELECT 1 FROM proactive_referral_candidates prc
			                  WHERE prc.job_id = pj.id AND prc.applicant_id = ? AND prc.status IN ('Dismissed','Promoted'))
			ORDER BY pj.id DESC
			LIMIT ?
		`, [userId, userId, safeCap]);
		return rows.map((r) => r.id);
	},

	// ── Monitor / health ─────────────────────────────────────────────────────

	async counts(conn = pool) {
		const [[{ pending }]] = await conn.query(`SELECT COUNT(*) AS pending FROM proactive_match_jobs WHERE status IN ('pending','processing')`);
		const [[{ failed }]] = await conn.query(`SELECT COUNT(*) AS failed FROM proactive_match_jobs WHERE status = 'failed'`);
		// Count only ACTIONABLE candidates — those whose job AND applicant still exist,
		// the same INNER JOINs the Smart Referral Queue uses. Without this, a candidate
		// orphaned by a deleted job/user is tallied by the monitor but can never appear
		// in any admin's queue, so the monitor read higher than the queue for no visible
		// reason. (Owner-scoping — a candidate for another admin's job — is a SEPARATE,
		// intentional reason the per-admin queue can be shorter than this platform-wide
		// count; that is correct, not an orphan.)
		const [rows] = await conn.query(`
			SELECT prc.status, COUNT(*) AS c
			FROM proactive_referral_candidates prc
			JOIN pesoadmin_job_posts pj ON pj.id = prc.job_id
			JOIN users u ON u.id = prc.applicant_id
			WHERE prc.status IN ('Suggested','Promoted','Dismissed')
			GROUP BY prc.status
		`);
		const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.c) || 0]));
		return {
			pending: Number(pending) || 0, failed: Number(failed) || 0,
			suggested: byStatus.Suggested || 0, promoted: byStatus.Promoted || 0, dismissed: byStatus.Dismissed || 0,
		};
	},
};

module.exports = proactiveReferralRepository;
