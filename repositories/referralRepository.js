const pool = require('../db');

// ── Referral Register (Phase 1 server-side pagination) ──────────────────────
// The register's "delivery state" is DERIVED, not a stored column. The CASE is
// GENERATED from the single source of truth in services/deliveryState.js, which
// also exposes the JS evaluator (deliveryStateOf) — so the backend's SQL and JS
// derivations can never drift, and test/deliveryState.test.js locks the buckets.
// The frontend's deliveryState() in Referrals.jsx still mirrors the same buckets
// by hand (separate package); keep it matching what that test asserts.
const { buildDeliveryStateCaseSql } = require('../services/deliveryState');
const DELIVERY_STATE_CASE = buildDeliveryStateCaseSql();

// Whitelisted sort → ORDER BY. Unknown falls back to newest — caller input is
// never interpolated into SQL.
const REGISTER_SORT_SQL = {
    newest: 'rq.created_at DESC',
    oldest: 'rq.created_at ASC',
    az: 'pj.title ASC, rq.created_at DESC',
    za: 'pj.title DESC, rq.created_at DESC',
    reference: 'rl.reference_number ASC',
};

// The joins the register's filter / sort / count all share (the outcome joins
// are only needed for the row payload, so they live in the paged SELECT below).
const REGISTER_LEAN_FROM = `
    FROM referral_queue rq
    JOIN job_applications ja ON rq.application_id = ja.id
    JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
    JOIN users u ON ja.applicant_id = u.id
    LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
    LEFT JOIN referral_jobs rj ON rj.queue_id = rq.id`;

// Owner scope + optional search + optional derived delivery-state filter.
function buildRegisterWhere(employerId, { status = '', q = '' } = {}) {
    const where = ['pj.peso_admin_id = ?'];
    const params = [employerId];
    if (q) {
        const like = `%${q}%`;
        where.push('(pj.title LIKE ? OR pj.company LIKE ? OR u.name LIKE ? OR rl.reference_number LIKE ?)');
        params.push(like, like, like, like);
    }
    if (status) {
        where.push(`${DELIVERY_STATE_CASE} = ?`);
        params.push(status);
    }
    return { whereSql: where.join(' AND '), params };
}

/**
 * Referral data access layer.
 *
 * Every method accepts an optional `conn`. Inside a transaction the service
 * passes its dedicated connection; otherwise queries default to the pool.
 *
 * WHY THIS MATTERS: a pool hands out a DIFFERENT connection per query. If a
 * repository method grabbed its own connection while a transaction was open on
 * another, its write would commit independently -- outside the transaction,
 * unrollbackable, and invisible in review. Threading `conn` through is not
 * ceremony; it is the difference between an atomic referral and a corrupt one.
 */
const referralRepository = {

	/**
	 * Loads everything needed to issue a referral, and simultaneously enforces
	 * ownership: the PESO administrator may only act on applications to jobs
	 * THEY published. Authorization is expressed as a JOIN, not as a separate
	 * query, so there is no window between "check" and "use".
	 */
	async findApplicationForReferral(applicationId, employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				ja.id AS application_id,
				ja.status AS application_status,
				ja.match_score,
				u.id AS applicant_id,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.id AS job_id,
				pj.title AS job_title,
				pj.company AS company_name,
				pj.location AS job_location,
				pj.peso_admin_id AS employer_id
			FROM job_applications ja
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			WHERE ja.id = ? AND pj.peso_admin_id = ?
		`, [applicationId, employerId]);

		return rows[0] || null;
	},

	/**
	 * Locks the job row for the duration of the caller's transaction (FOR UPDATE)
	 * and returns its vacancy fields. This serializes concurrent approvals on the
	 * same job: two admins approving simultaneously cannot both pass the capacity
	 * check, because the second SELECT blocks until the first transaction commits.
	 */
	async lockJobVacancy(jobId, conn) {
		const [rows] = await conn.query(`
			SELECT id, positions_available, status
			FROM pesoadmin_job_posts
			WHERE id = ?
			FOR UPDATE
		`, [jobId]);

		return rows[0] || null;
	},

	/**
	 * How many referral slots this job has already consumed: one per APPROVED
	 * referral. 'Pending Review' and 'Rejected' hold no slot.
	 */
	async countApprovedForJob(jobId, conn = pool) {
		const [[{ approved }]] = await conn.query(`
			SELECT COUNT(*) AS approved
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			WHERE ja.job_id = ? AND rq.status = 'Approved'
		`, [jobId]);

		return approved || 0;
	},

	/**
	 * Marks a referral void. Never deletes: a letter was generated and emailed
	 * to a citizen, and erasing the row would erase the fact that it happened.
	 *
	 * Guarded on status = 'Approved' in the WHERE clause rather than checked
	 * first and written second, so two concurrent voids cannot both succeed --
	 * the second matches zero rows and the caller sees affectedRows = 0.
	 */
	async voidReferral({ referralId, adminId, reason }, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_queue
			   SET status = 'Voided',
			       voided_at = CURRENT_TIMESTAMP,
			       voided_by = ?,
			       void_reason = ?
			 WHERE id = ? AND status = 'Approved'
		`, [adminId, reason, referralId]);

		return result.affectedRows;
	},

	/** The owning job, for a referral. Needed to release the vacancy slot on void. */
	async findJobForReferral(referralId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT pj.id AS job_id, pj.title, pj.status, pj.positions_available, pj.peso_admin_id,
			       ja.id AS application_id, ja.applicant_id AS applicant_id
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			WHERE rq.id = ?
		`, [referralId]);

		return rows[0] || null;
	},

	async setJobStatus(jobId, status, conn = pool) {
		await conn.query(
			'UPDATE pesoadmin_job_posts SET status = ? WHERE id = ?',
			[status, jobId]
		);
	},

	// Couple the ATS status to the referral lifecycle (2026-08-04). approveReferral sets
	// 'Referred' (the application is now a finalized record — no more live re-scoring, §18.5);
	// voidReferral reverts it to an active state so the reopened application re-enters the
	// pipeline. Kept inside the referral transaction so the two axes never drift.
	async setApplicationStatus(applicationId, status, conn = pool) {
		await conn.query(
			'UPDATE job_applications SET status = ? WHERE id = ?',
			[status, applicationId]
		);
	},

	async findReferralByApplication(applicationId, conn = pool) {
		const [rows] = await conn.query(
			'SELECT * FROM referral_queue WHERE application_id = ?',
			[applicationId]
		);
		return rows[0] || null;
	},

	async findReferralById(referralId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.*,
				ja.applicant_id,
				ja.job_id,
				ja.origin,
				u.name AS applicant_name,
				u.email AS applicant_email,

				-- Address lines for the referral letter body. pdfService reads
				-- applicant_address and company_address / job_location; none of
				-- them were ever SELECTed here, so every letter rendered
				-- "a resident of ______" and an empty company address. The alias
				-- names match what the template already expects rather than
				-- changing the template, because the template mirrors the wording
				-- of the official paper form.
				u.location AS applicant_address,
				pj.location AS job_location,

				pj.title AS job_title,
				pj.company AS company_name,
				pj.peso_admin_id AS employer_id,
				rl.reference_number,
				rl.pdf_path,
				rl.email_status,
				rl.sent_at,
				rj.status AS job_status,
				rj.step AS job_step,
				rj.attempts,
				rj.last_error,
				ru.name AS reviewer_name
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			LEFT JOIN referral_jobs rj ON rj.queue_id = rq.id
			LEFT JOIN users ru ON rq.reviewed_by = ru.id
			WHERE rq.id = ?
		`, [referralId]);

		return rows[0] || null;
	},


	async updateLetterPdfPath(queueId, pdfPath, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_letters SET pdf_path = ? WHERE queue_id = ?
		`, [pdfPath, queueId]);

		return result.affectedRows;
	},

	/**
	 * Stores the letter PDF durably (migration 021).
	 *
	 * ON DUPLICATE KEY UPDATE, not INSERT: the worker may retry generate_pdf
	 * after a partial failure, and the regenerated bytes are identical because
	 * the content is a pure function of the referral. Overwriting is therefore
	 * both safe and the behaviour we want -- an INSERT would throw on the
	 * uq_rlf_queue constraint and dead-letter a referral that is actually fine.
	 */
	async saveLetterFile({ queueId, referenceNumber, buffer, source = 'generated' }, conn = pool) {
		const base64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : String(buffer);
		const byteSize = Buffer.isBuffer(buffer) ? buffer.length : Buffer.byteLength(base64, 'base64');

		const [result] = await conn.query(`
			INSERT INTO referral_letter_files
				(queue_id, reference_number, content_base64, byte_size, source)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				reference_number = VALUES(reference_number),
				content_base64 = VALUES(content_base64),
				byte_size = VALUES(byte_size),
				source = VALUES(source)
		`, [queueId, referenceNumber, base64, byteSize, source]);

		return result.affectedRows;
	},

	/**
	 * The stored PDF as a Buffer, or null when this referral has no durable copy
	 * yet (pre-migration rows that the backfill has not reached).
	 *
	 * Callers MUST handle null by falling back to disk -- that fallback is the
	 * whole reason the expand phase keeps writing files.
	 */
	async findLetterFile(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT content_base64, byte_size FROM referral_letter_files WHERE queue_id = ?
		`, [queueId]);

		if (rows.length === 0) return null;

		return {
			buffer: Buffer.from(rows[0].content_base64, 'base64'),
			byteSize: rows[0].byte_size
		};
	},

	/** Existence check that does NOT drag the base64 payload across the wire. */
	async hasLetterFile(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT 1 FROM referral_letter_files WHERE queue_id = ? LIMIT 1
		`, [queueId]);

		return rows.length > 0;
	},

	/**
	 * Reporting rows for one PESO administrator over a date range.
	 *
	 * COHORT BASIS: the range filters on rq.reviewed_at -- the date the referral
	 * was ISSUED, not the date an outcome was recorded. So the report answers
	 * "of the referrals we issued in July, what became of them", which is the
	 * framing a placement rate needs: a hire reported in August against a July
	 * referral belongs to July's cohort. Filtering on outcome_at instead would
	 * make the denominator and numerator describe different populations.
	 *
	 * One row per referral, with the applicant named -- DOLE asks for the list
	 * of names, not just counts.
	 */
	/**
	 * Referrals that COMPLETED but never reached n8n.
	 *
	 * By design, dispatch_n8n dead-letters after 5 attempts and the referral is
	 * still considered done -- n8n is a consumer and must never be able to hold
	 * up a referral (invariant 0.10). The side effect was that the gap became
	 * completely silent: production showed 25 N8N_DISPATCHED against 27
	 * completed referrals, and nothing anywhere said so.
	 *
	 * ADVISORY, NOT AN ERROR. The referrals themselves are fine and the citizens
	 * have their letters. What is missing is whatever n8n does downstream (sheet
	 * logging, employer notification), so this reports rather than alarms.
	 *
	 * Detected by ABSENCE of the N8N_DISPATCHED audit entry, not by the outbox
	 * row's state: the outbox row advances past the step or is cleaned up, while
	 * the audit entry is permanent.
	 */
	async listUndispatchedForEmployer(employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id,
				rl.reference_number,
				u.name AS applicant_name,
				pj.title AS job_title,
				rq.reviewed_at
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			WHERE pj.peso_admin_id = ?
			  AND rq.status = 'Approved'
			  AND rl.email_status = 'Sent'
			  AND NOT EXISTS (
				  SELECT 1 FROM referral_activity_log ral
				  WHERE ral.queue_id = rq.id AND ral.action = 'N8N_DISPATCHED'
			  )
			ORDER BY rq.reviewed_at DESC
		`, [employerId]);

		return rows;
	},

	async reportRows({ employerId, from, to }, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rl.reference_number,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.title AS job_title,
				pj.company AS company_name,
				rq.reviewed_at AS issued_at,
				rq.match_score,
				COALESCE(ro.outcome, 'Issued') AS outcome,
				ro.outcome_at,
				ro.notes AS outcome_notes,
				rec.name AS outcome_recorded_by
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			LEFT JOIN users rec ON ro.recorded_by = rec.id
			WHERE pj.peso_admin_id = ?
			  AND rq.status = 'Approved'
			  AND (? IS NULL OR rq.reviewed_at >= ?)
			  AND (? IS NULL OR rq.reviewed_at < DATE_ADD(?, INTERVAL 1 DAY))
			ORDER BY rq.reviewed_at DESC
		`, [employerId, from, from, to, to]);

		return rows;
	},

	/** Outcome breakdown for the same cohort. Feeds the placement rate. */
	async reportOutcomeTotals({ employerId, from, to }, conn = pool) {
		const [rows] = await conn.query(`
			SELECT COALESCE(ro.outcome, 'Issued') AS outcome, COUNT(*) AS count
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			WHERE pj.peso_admin_id = ?
			  AND rq.status = 'Approved'
			  AND (? IS NULL OR rq.reviewed_at >= ?)
			  AND (? IS NULL OR rq.reviewed_at < DATE_ADD(?, INTERVAL 1 DAY))
			GROUP BY COALESCE(ro.outcome, 'Issued')
		`, [employerId, from, from, to, to]);

		return rows;
	},

	/** Referrals issued and hires, bucketed by month. The monthly count DOLE asks for. */
	async reportMonthly({ employerId, from, to }, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				DATE_FORMAT(rq.reviewed_at, '%Y-%m') AS month,
				COUNT(*) AS referrals,
				SUM(CASE WHEN ro.outcome = 'Hired' THEN 1 ELSE 0 END) AS hired
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			WHERE pj.peso_admin_id = ?
			  AND rq.status = 'Approved'
			  AND rq.reviewed_at IS NOT NULL
			  AND (? IS NULL OR rq.reviewed_at >= ?)
			  AND (? IS NULL OR rq.reviewed_at < DATE_ADD(?, INTERVAL 1 DAY))
			GROUP BY DATE_FORMAT(rq.reviewed_at, '%Y-%m')
			ORDER BY month DESC
		`, [employerId, from, from, to, to]);

		return rows;
	},

	async createReferral({ applicationId, matchScore, status, reviewedBy, remarks }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO referral_queue
				(application_id, match_score, status, reviewed_by, reviewed_at, remarks)
			VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
		`, [applicationId, matchScore, status, reviewedBy, remarks]);

		return result.insertId;
	},

	/**
	 * Re-decides an existing referral (e.g. a previously rejected applicant is
	 * now approved). Returns affectedRows so the caller can detect a no-op.
	 */
	async updateReferralDecision({ referralId, status, reviewedBy, remarks }, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_queue
			SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, remarks = ?
			WHERE id = ?
		`, [status, reviewedBy, remarks, referralId]);

		return result.affectedRows;
	},

	/**
	 * Transition ONLY the referral status (seeker accept/decline, #6) — leaves
	 * reviewed_by/reviewed_at intact so the endorsing administrator stays recorded.
	 */
	async setReferralStatus(referralId, status, conn = pool) {
		const [result] = await conn.query(
			'UPDATE referral_queue SET status = ? WHERE id = ?',
			[status, referralId]
		);
		return result.affectedRows;
	},

	async createLetter({ queueId, referenceNumber }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO referral_letters (queue_id, reference_number, email_status)
			VALUES (?, ?, 'Pending')
		`, [queueId, referenceNumber]);

		return result.insertId;
	},

	/**
	 * The letter row for a referral, if one exists. Lets the service re-approve a
	 * previously-rejected referral WITHOUT minting a second letter (there is no
	 * UNIQUE on queue_id in referral_letters, so a blind re-insert would create a
	 * duplicate artifact with a new reference number).
	 */
	async findLetterByQueue(queueId, conn = pool) {
		const [rows] = await conn.query(
			'SELECT * FROM referral_letters WHERE queue_id = ? LIMIT 1',
			[queueId]
		);
		return rows[0] || null;
	},

	

	/**
	 * Writes the outbox row, in the SAME transaction as the referral itself.
	 * The starting step comes from referralPipeline.js -- the repository does not
	 * decide what "first" means.
	 *
	 * ON DUPLICATE KEY resets an existing row (uq_refjobs_queue allows only one
	 * per referral), so re-approving a previously rejected applicant re-arms the
	 * pipeline from the start rather than colliding.
	 */
	async enqueueJob(queueId, firstStep, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO referral_jobs (queue_id, step, status, attempts, next_run_at)
			VALUES (?, ?, 'pending', 0, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				step = VALUES(step),
				status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = CURRENT_TIMESTAMP
		`, [queueId, firstStep]);

		return result.insertId;
	},

	async logActivity({ queueId, actorId, action, detail }, conn = pool) {
		await conn.query(`
			INSERT INTO referral_activity_log (queue_id, actor_id, action, detail)
			VALUES (?, ?, ?, ?)
		`, [queueId, actorId, action, detail]);
	},

	async listActivity(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT ral.id, ral.action, ral.detail, ral.created_at, u.name AS actor_name
			FROM referral_activity_log ral
			LEFT JOIN users u ON ral.actor_id = u.id
			WHERE ral.queue_id = ?
			ORDER BY ral.created_at ASC, ral.id ASC
		`, [queueId]);

		return rows;
	},


	/**
	 * AI-recommended referrals awaiting human review, for this admin's jobs.
	 * The pre-vetted queue: high-match applicants the AI flagged, one click from
	 * an approved referral.
	 */
	async listPendingReviewForEmployer(employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id,
				rq.application_id,
				rq.status,
				rq.match_score,
				rq.ai_recommendation,
				rq.created_at,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.title AS job_title,
				pj.company AS company_name
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			WHERE pj.peso_admin_id = ? AND rq.status = 'Pending Review'
			ORDER BY rq.match_score DESC, rq.created_at ASC
		`, [employerId]);

		return rows;
	},

	/** Everything n8n needs about a completed referral, in one row. */
	async findReferralForDispatch(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id AS referral_id,
				rq.match_score,
				rq.reviewed_at,
				rl.reference_number,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.title AS job_title,
				pj.company AS company_name,
				-- The EMPLOYER is the vacancy's company + its contact email (migration
				-- 051), NOT the PESO admin. This is the authoritative recipient the
				-- automation layer notifies. company_email may be NULL on older/draft
				-- vacancies — the referral still completes (invariant 0.10); the
				-- automation simply has no external recipient until the job is edited.
				pj.company AS employer_name,
				pj.company_email AS employer_email,
				rev.name AS reviewer_name
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			LEFT JOIN users rev ON rq.reviewed_by = rev.id
			WHERE rq.id = ?
		`, [queueId]);

		return rows[0] || null;
	},

	/** Referrals for jobs this PESO administrator published. */
	async listForEmployer(employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id,
				rq.status,
				rq.match_score,
				rq.remarks,
				rq.reviewed_at,
				rq.created_at,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.title AS job_title,
				pj.company AS company_name,
				rl.reference_number,
				rl.pdf_path,
				rl.email_status,
				rl.sent_at,
				rj.status AS job_status,
				rj.step AS job_step,
				rj.attempts,
				rj.last_error,

				-- Placement outcome (migration 023). COALESCE to 'Issued' so a
				-- referral with no recorded outcome reads as "letter issued,
				-- nothing heard back" rather than NULL -- which is the truthful
				-- state for every referral predating outcome tracking.
				COALESCE(ro.outcome, 'Issued') AS outcome,
				ro.outcome_at,
				ro.notes AS outcome_notes,
				ro.recorded_at AS outcome_recorded_at,
				rec.name AS outcome_recorded_by_name
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			LEFT JOIN referral_jobs rj ON rj.queue_id = rq.id
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			LEFT JOIN users rec ON ro.recorded_by = rec.id
			WHERE pj.peso_admin_id = ?
			ORDER BY rq.created_at DESC
		`, [employerId]);

		return rows;
	},

	/**
	 * One page of the register — server-side search (name/company/title/reference),
	 * derived delivery-state filter, and whitelisted sort. Same row shape as
	 * listForEmployer, so the frontend's badge derivation and row actions are
	 * unchanged; only WHICH rows arrive changes.
	 */
	async listForEmployerPaged(employerId, { limit = 20, offset = 0, status = '', sort = 'newest', q = '' } = {}, conn = pool) {
		const { whereSql, params } = buildRegisterWhere(employerId, { status, q });
		const orderBy = REGISTER_SORT_SQL[sort] || REGISTER_SORT_SQL.newest;
		const [rows] = await conn.query(`
			SELECT
				rq.id, rq.status, rq.match_score, rq.remarks, rq.reviewed_at, rq.created_at,
				ja.origin,
				u.name AS applicant_name, u.email AS applicant_email,
				pj.title AS job_title, pj.company AS company_name,
				rl.reference_number, rl.pdf_path, rl.email_status, rl.sent_at,
				rj.status AS job_status, rj.step AS job_step, rj.attempts, rj.last_error,
				COALESCE(ro.outcome, 'Issued') AS outcome, ro.outcome_at, ro.notes AS outcome_notes,
				ro.recorded_at AS outcome_recorded_at, rec.name AS outcome_recorded_by_name
			${REGISTER_LEAN_FROM}
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			LEFT JOIN users rec ON ro.recorded_by = rec.id
			WHERE ${whereSql}
			ORDER BY ${orderBy}
			LIMIT ? OFFSET ?
		`, [...params, limit, offset]);

		return rows;
	},

	/** Total matching the SAME search + status filter, for the pager. */
	async countForEmployer(employerId, { status = '', q = '' } = {}, conn = pool) {
		const { whereSql, params } = buildRegisterWhere(employerId, { status, q });
		const [[{ total }]] = await conn.query(
			`SELECT COUNT(*) AS total ${REGISTER_LEAN_FROM} WHERE ${whereSql}`, params
		);
		return Number(total);
	},

	/**
	 * Delivery-state counts over the WHOLE employer set (ignoring search + status),
	 * so the filter chips always show real totals — the per-state count the frontend
	 * used to derive client-side from the full list before it was paginated.
	 */
	async deliveryStateCountsForEmployer(employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT ${DELIVERY_STATE_CASE} AS delivery_state, COUNT(*) AS count
			${REGISTER_LEAN_FROM}
			WHERE pj.peso_admin_id = ?
			GROUP BY delivery_state
		`, [employerId]);
		return rows.map((r) => ({ state: r.delivery_state, count: Number(r.count) }));
	},

	/**
	 * Records (or updates) the placement outcome for one referral.
	 *
	 * UPSERT because an outcome moves forward over time -- acknowledged, then
	 * interviewed, then hired -- and each report replaces the last. The trail of
	 * changes lives in referral_activity_log, which is already the audit trail
	 * for this module; a second history table would be a second place to look.
	 */
	async setOutcome({ queueId, outcome, outcomeAt, notes, recordedBy }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO referral_outcomes
				(queue_id, outcome, outcome_at, notes, recorded_by)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				outcome = VALUES(outcome),
				outcome_at = VALUES(outcome_at),
				notes = VALUES(notes),
				recorded_by = VALUES(recorded_by)
		`, [queueId, outcome, outcomeAt || null, notes || null, recordedBy || null]);

		return result.affectedRows;
	},

	async findOutcome(queueId, conn = pool) {
		const [rows] = await conn.query(
			'SELECT outcome, outcome_at, notes, recorded_by, recorded_at FROM referral_outcomes WHERE queue_id = ?',
			[queueId]
		);
		return rows[0] || null;
	},

	/**
	 * Appends one row to the structured outcome ledger (migration 036). Records
	 * EVERY transition — an administrator's official write (isOfficial=1) and a
	 * job seeker's suggestion (isOfficial=0) alike — with who/when/prev→new. A
	 * suggestion row NEVER touches referral_outcomes, so it can never enter the
	 * official placement statistics (invariant 0.14); confirming one is a fresh
	 * official write that appends its own is_official=1 row here.
	 */
	async appendOutcomeHistory({ queueId, outcome, outcomeAt, previousOutcome, notes, changedBy, changedByRole, isOfficial }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO referral_outcome_history
				(queue_id, outcome, outcome_at, previous_outcome, notes, changed_by, changed_by_role, is_official)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			queueId, outcome, outcomeAt || null, previousOutcome || null,
			notes || null, changedBy || null, changedByRole || 'system', isOfficial ? 1 : 0
		]);
		return result.insertId;
	},

	/** The full outcome-transition trail for one referral, oldest first. */
	async listOutcomeHistory(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				h.id, h.outcome, h.outcome_at, h.previous_outcome, h.notes,
				h.changed_by, h.changed_by_role, h.is_official, h.created_at,
				u.name AS changed_by_name
			FROM referral_outcome_history h
			LEFT JOIN users u ON h.changed_by = u.id
			WHERE h.queue_id = ?
			ORDER BY h.created_at ASC, h.id ASC
		`, [queueId]);
		return rows;
	},

	/**
	 * The most recent seeker SUGGESTION that is newer than the last OFFICIAL
	 * outcome — i.e. an open suggestion the administrator has not yet acted on.
	 * Returns null when the latest word on the referral is already official.
	 * Powers the "Seeker reports … — Confirm" affordance in the Register.
	 */
	async findPendingSuggestion(queueId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT h.id, h.outcome, h.outcome_at, h.notes, h.changed_by, h.created_at,
			       u.name AS changed_by_name
			FROM referral_outcome_history h
			LEFT JOIN users u ON h.changed_by = u.id
			WHERE h.queue_id = ? AND h.is_official = 0
			  AND h.created_at > COALESCE(
				(SELECT MAX(o.created_at) FROM referral_outcome_history o
				 WHERE o.queue_id = h.queue_id AND o.is_official = 1),
				'1970-01-01'
			  )
			ORDER BY h.created_at DESC, h.id DESC
			LIMIT 1
		`, [queueId]);
		return rows[0] || null;
	},

	/**
	 * Confirms a referral belongs to a job this administrator owns.
	 *
	 * Authentication is not authorization: without this, any PESO administrator
	 * could record an outcome against another office's referral.
	 */
	async isReferralOwnedBy(queueId, employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT 1
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			WHERE rq.id = ? AND pj.peso_admin_id = ?
			LIMIT 1
		`, [queueId, employerId]);

		return rows.length > 0;
	},

	/** Referrals belonging to a job seeker. Only approved ones are visible.
	 *
	 * Now selects the placement OUTCOME too (LEFT JOIN referral_outcomes), so the
	 * seeker's My Referrals shows the real state an administrator recorded instead
	 * of a permanent "Awaiting outcome" — the pill read `referral.outcome` but this
	 * query never returned it. A missing row is a genuine 'Issued' (unknown), which
	 * the UI renders as "Awaiting outcome" (§7.11). */
	async listForApplicant(applicantId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id,
				rq.status,
				rq.created_at,
				ja.origin,
				pj.title AS job_title,
				pj.company AS company_name,
				pj.location AS job_location,
				rl.reference_number,
				rl.pdf_path,
				rl.email_status,
				rl.sent_at,
				ro.outcome,
				ro.outcome_at,
				ro.notes AS outcome_notes
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			LEFT JOIN referral_outcomes ro ON ro.queue_id = rq.id
			WHERE ja.applicant_id = ?
			  AND rq.status IN ('Approved', 'Pending Seeker Acceptance', 'Declined')
			ORDER BY rq.created_at DESC
		`, [applicantId]);

		return rows;
	},

	/**
	 * Referral decisions for every applicant to one job.
	 *
	 * Powers the ATS button state. Ownership is enforced in the JOIN -- a PESO
	 * administrator cannot read referral state for a job they did not publish.
	 */
	async listByJob(jobId, employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id AS referral_id,
				rq.application_id,
				rq.status,
				rl.reference_number
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			WHERE pj.id = ? AND pj.peso_admin_id = ?
		`, [jobId, employerId]);

		return rows;
	},

	async referenceNumberExists(referenceNumber, conn = pool) {
		const [rows] = await conn.query(
			'SELECT id FROM referral_letters WHERE reference_number = ?',
			[referenceNumber]
		);
		return rows.length > 0;
	},

	// ========================================================================
	// OUTBOX / WORKER
	// ========================================================================

	/**
	 * Jobs that are due to run. Read-only -- claiming happens separately, so a
	 * long SELECT never holds a lock.
	 */
	async findDueJobs(limit, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, queue_id, step, attempts, max_attempts
			FROM referral_jobs
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);

		return rows;
	},

	/**
	 * Atomically claims a job.
	 *
	 * THE ENTIRE CONCURRENCY MODEL IS THIS ONE STATEMENT. The predicate
	 * `status = 'pending'` is what makes it safe: if two workers race, the
	 * database serializes the UPDATEs and only the first sees status='pending'.
	 * The second matches zero rows and walks away.
	 *
	 * We do NOT use SELECT ... FOR UPDATE SKIP LOCKED -- TiDB does not implement
	 * SKIP LOCKED (issue #18207). This pattern needs no locking clause at all
	 * and behaves identically on MySQL, MariaDB, TiDB, and PostgreSQL.
	 *
	 * Returns true if this worker owns the job.
	 */
	async claimJob(jobId, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_jobs
			SET status = 'processing',
				worker_id = ?,
				locked_at = CURRENT_TIMESTAMP,
				attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, jobId]);

		return result.affectedRows === 1;
	},

	/** Step succeeded, more steps remain. Re-arm for the next one. */
	async advanceStep(jobId, nextStep, conn = pool) {
		await conn.query(`
			UPDATE referral_jobs
			SET step = ?,
				status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, [nextStep, jobId]);
	},

	/** Pipeline finished. */
	async completeJob(jobId, conn = pool) {
		await conn.query(`
			UPDATE referral_jobs
			SET step = 'done',
				status = 'completed',
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [jobId]);
	},

	/**
	 * Step failed. Backoff is persisted as a TIMESTAMP, not held in a
	 * setTimeout -- a setTimeout dies with the process; next_run_at survives a
	 * crash, a redeploy, and a laptop lid closing.
	 */
	async rescheduleJob(jobId, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE referral_jobs
			SET status = 'pending',
				last_error = ?,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			WHERE id = ?
		`, [String(errorMessage).slice(0, 2000), delaySeconds, jobId]);
	},

	/** Out of retries. Dead-letter it for a human. */
	async failJob(jobId, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE referral_jobs
			SET status = 'failed',
				last_error = ?,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 2000), jobId]);
	},

	/**
	 * Recovers jobs abandoned mid-flight.
	 *
	 * If the process is killed between claimJob() and the handler finishing, the
	 * row is stranded in 'processing' forever and that referral is never
	 * delivered -- silently. This is the single most important line of recovery
	 * code in the module: on every boot, and periodically, anything held too
	 * long is returned to the queue. `attempts` is NOT reset, so a job that
	 * crashes the worker repeatedly still exhausts its retries instead of
	 * looping forever.
	 */
	async reclaimStuckJobs(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_jobs
			SET status = 'pending',
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = CURRENT_TIMESTAMP
			WHERE status = 'processing'
				AND locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
		`, [staleSeconds]);

		return result.affectedRows;
	},

	// ========================================================================
	// NOTIFICATIONS
	// ========================================================================



	async markLetterSent(queueId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_letters
			SET email_status = 'Sent', sent_at = CURRENT_TIMESTAMP
			WHERE queue_id = ?
		`, [queueId]);

		return result.affectedRows;
	},

	async markLetterEmailFailed(queueId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_letters
			SET email_status = 'Failed'
			WHERE queue_id = ?
		`, [queueId]);

		return result.affectedRows;
	},


	async setAiRecommendation(queueId, recommendation, conn = pool) {
		await conn.query(
			'UPDATE referral_queue SET ai_recommendation = ? WHERE id = ?',
			[recommendation, queueId]
		);
	},


	/**
	 * Dead-lettered referrals: delivery jobs that exhausted their retries.
	 * Scoped to jobs this PESO admin published. Includes which step failed and
	 * why, so the admin can decide whether a retry will help.
	 */
	async listFailedForEmployer(employerId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT
				rq.id AS queue_id,
				rq.status AS referral_status,
				rj.id AS job_id,
				rj.step,
				rj.attempts,
				rj.max_attempts,
				rj.last_error,
				rj.updated_at AS failed_at,
				rl.reference_number,
				rl.email_status,
				u.name AS applicant_name,
				u.email AS applicant_email,
				pj.title AS job_title,
				pj.company AS company_name
			FROM referral_jobs rj
			JOIN referral_queue rq ON rj.queue_id = rq.id
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			WHERE pj.peso_admin_id = ? AND rj.status = 'failed'
			ORDER BY rj.updated_at DESC
		`, [employerId]);

		return rows;
	},

	/**
	 * Re-arms a failed job. Resets it to 'pending' with attempts cleared, so the
	 * worker reclaims it on its next tick.
	 *
	 * WHERE status = 'failed' is the guard: only a genuinely dead-lettered job
	 * can be retried. A running or completed job is untouched, so a double-click
	 * or a stale UI cannot disrupt an in-flight referral.
	 *
	 * Returns affectedRows so the caller can tell a real retry from a no-op.
	 */
	async retryFailedJob(queueId, employerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE referral_jobs rj
			JOIN referral_queue rq ON rj.queue_id = rq.id
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			SET rj.status = 'pending',
				rj.attempts = 0,
				rj.last_error = NULL,
				rj.worker_id = NULL,
				rj.locked_at = NULL,
				rj.next_run_at = CURRENT_TIMESTAMP
			WHERE rq.id = ?
				AND pj.peso_admin_id = ?
				AND rj.status = 'failed'
		`, [queueId, employerId]);

		return result.affectedRows;
	},

	
	async createNotification({ userId, type, title, body, link }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO notifications (user_id, type, title, body, link)
			VALUES (?, ?, ?, ?, ?)
		`, [userId, type, title, body, link]);

		return result.insertId;
	},

	// ========================================================================
	// PLATFORM-WIDE AUTOMATION (n8n) — Super Admin monitor + replay
	// ========================================================================
	// These are NOT owner-scoped (the per-office undispatched advisory is
	// listUndispatchedForEmployer). "Dispatched" is measured by the PERMANENT
	// N8N_DISPATCHED audit entry, not the transient outbox row, mirroring the
	// per-office detection.

	async automationCounts(conn = pool) {
		const [[dispatched]] = await conn.query(
			`SELECT COUNT(DISTINCT queue_id) AS c FROM referral_activity_log WHERE action = 'N8N_DISPATCHED'`
		);
		const [[failed]] = await conn.query(
			`SELECT COUNT(*) AS c FROM referral_jobs WHERE status = 'failed'`
		);
		const [[pending]] = await conn.query(
			`SELECT COUNT(*) AS c FROM referral_jobs WHERE step = 'dispatch_n8n' AND status IN ('pending','processing')`
		);
		const [[undispatched]] = await conn.query(`
			SELECT COUNT(*) AS c
			FROM referral_queue rq
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			WHERE rq.status = 'Approved' AND rl.email_status = 'Sent'
			  AND NOT EXISTS (
				  SELECT 1 FROM referral_activity_log ral
				  WHERE ral.queue_id = rq.id AND ral.action = 'N8N_DISPATCHED'
			  )
		`);
		return {
			dispatched: Number(dispatched.c) || 0,
			undispatched: Number(undispatched.c) || 0,
			failed: Number(failed.c) || 0,
			pending: Number(pending.c) || 0,
		};
	},

	async listUndispatchedAll(limit = 100, conn = pool) {
		const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
		const [rows] = await conn.query(`
			SELECT rq.id AS queue_id, rl.reference_number,
			       u.name AS applicant_name, pj.title AS job_title, pj.company AS company_name,
			       rq.reviewed_at
			FROM referral_queue rq
			JOIN job_applications ja ON rq.application_id = ja.id
			JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
			JOIN users u ON ja.applicant_id = u.id
			LEFT JOIN referral_letters rl ON rl.queue_id = rq.id
			WHERE rq.status = 'Approved' AND rl.email_status = 'Sent'
			  AND NOT EXISTS (
				  SELECT 1 FROM referral_activity_log ral
				  WHERE ral.queue_id = rq.id AND ral.action = 'N8N_DISPATCHED'
			  )
			ORDER BY rq.reviewed_at DESC
			LIMIT ?
		`, [safeLimit]);
		return rows;
	},

	/** Narrows caller-supplied ids to REAL approved referrals (guards the replay). */
	async filterApprovedQueueIds(queueIds, conn = pool) {
		if (!Array.isArray(queueIds) || queueIds.length === 0) return [];
		const [rows] = await conn.query(
			`SELECT id FROM referral_queue WHERE status = 'Approved' AND id IN (?)`,
			[queueIds]
		);
		return rows.map((r) => r.id);
	}
};






module.exports = referralRepository;