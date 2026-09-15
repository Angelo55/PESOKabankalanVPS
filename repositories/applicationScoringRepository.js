const pool = require('../db');

/**
 * Application re-scoring data access (migration 029, Enhancement B).
 *
 * The outbox mechanics are the proven pattern from referralRepository /
 * emailOutboxRepository — read-only findDue() + an atomic conditional claim()
 * (TiDB has no SKIP LOCKED, §7.5). What is specific here: the score writes land on
 * the LIVE columns (`current_match_score` / `current_ai_analysis` / `scored_at`),
 * never on the immutable apply-time `match_score` / `ai_analysis`.
 *
 * "Active" applications (the only ones worth re-scoring) are those still under
 * evaluation — never Hired/Rejected/withdrawn.
 */

// The ATS pipeline states an application is still ACTIVELY being decided in — the
// only ones worth re-scoring. Standardized to the PESO workflow (2026-08-04):
// Applied → Under Review → Shortlisted → Referred. 'Referred' is a FINALIZED business
// record (signed letter + permanent reference number) and is DELIBERATELY absent here,
// so a referred application is never re-scored (its apply-time score stays the historical
// record). 'Interview'/'Hired'/'Rejected' were deprecated from the ATS. A VOID reverts a
// referred app to 'Shortlisted', which re-enters it here (reopen path).
const ACTIVE_STATUSES = ['Applied', 'Under Review', 'Shortlisted'];

// Belt-and-suspenders: even if a referred application's status was not flipped to
// 'Referred' (a legacy row, or a race where a re-score was armed the instant before
// approval), an APPROVED referral marks the record finalized — exclude it. Kept in
// lockstep with the ACTIVE_STATUSES filter in both enqueue paths + the worker guard.
const NOT_FINALIZED = `NOT EXISTS (
			SELECT 1 FROM referral_queue rq
			WHERE rq.application_id = ja.id AND rq.status = 'Approved'
		)`;

const applicationScoringRepository = {

	ACTIVE_STATUSES,

	/**
	 * Re-arm (or create) a re-score for ONE application, due after `delaySeconds`.
	 * ON DUPLICATE KEY collapses rapid successive edits into a single pending job
	 * (dedupe on application_id) and pushes the due time out — the debounce.
	 */
	async enqueue(applicationId, delaySeconds = 0, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO application_scoring_jobs (application_id, status, attempts, next_run_at)
			VALUES (?, 'pending', 0, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
			ON DUPLICATE KEY UPDATE
				status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
		`, [applicationId, delaySeconds, delaySeconds]);
		return result.insertId;
	},

	/**
	 * Re-arm a re-score for EVERY active application of one applicant, in one
	 * round trip (INSERT … SELECT … ON DUPLICATE KEY). Used when the seeker edits
	 * their resume/profile. Returns how many applications were (re)armed.
	 */
	async enqueueForUserActiveApplications(userId, delaySeconds = 0, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO application_scoring_jobs (application_id, status, attempts, next_run_at)
			SELECT ja.id, 'pending', 0, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			FROM job_applications ja
			WHERE ja.applicant_id = ? AND ja.status IN (?) AND ${NOT_FINALIZED}
			ON DUPLICATE KEY UPDATE
				status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = VALUES(next_run_at)
		`, [delaySeconds, userId, ACTIVE_STATUSES]);
		return result.affectedRows;
	},

	/**
	 * Re-arm a re-score for every ACTIVE application to one JOB — used when the
	 * vacancy's requirements change (a job edit), so every candidate is re-evaluated
	 * against the new criteria. Same dedupe/debounce as the per-user path.
	 */
	async enqueueForJobActiveApplications(jobId, delaySeconds = 0, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO application_scoring_jobs (application_id, status, attempts, next_run_at)
			SELECT ja.id, 'pending', 0, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			FROM job_applications ja
			WHERE ja.job_id = ? AND ja.status IN (?) AND ${NOT_FINALIZED}
			ON DUPLICATE KEY UPDATE
				status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = VALUES(next_run_at)
		`, [delaySeconds, jobId, ACTIVE_STATUSES]);
		return result.affectedRows;
	},

	// ── Worker: claim / score / fail / reclaim ──────────────────────────────

	async findDue(limit, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, application_id, attempts, max_attempts
			FROM application_scoring_jobs
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);
		return rows;
	},

	async claim(id, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'processing', worker_id = ?, locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, id]);
		return result.affectedRows === 1;
	},

	/**
	 * The applicant + the job fields aiScoringService needs, for one application.
	 *
	 * NOTE: the LIVE pesoadmin_job_posts columns are `experience` / `education`
	 * (from the baseline migration). The names `required_experience` /
	 * `educational_requirements` exist only in the legacy db.js initDB, which
	 * drifted — selecting them raised "Unknown column 'pj.required_experience'"
	 * and dead-lettered every re-score. Alias the real columns to the names
	 * aiScoringService expects, exactly as jobAlertsRepository does.
	 */
	// `includeHash` adds last_scored_input_hash to the SELECT — passed ONLY by the
	// worker when SCORING_INPUT_HASH_GUARD is on (migration 038 applied). Kept
	// conditional so the column is never referenced when the guard is off, making the
	// code deploy-safe BEFORE the migration lands (an unknown-column select would
	// dead-letter every re-score).
	async findApplicationForScoring(applicationId, includeHash = false, conn = pool) {
		const hashCol = includeHash ? ', ja.last_scored_input_hash' : '';
		const [rows] = await conn.query(`
			SELECT ja.id AS application_id, ja.job_id, ja.applicant_id, ja.status${hashCol}, pj.peso_admin_id,
			       pj.title, pj.company, pj.description, pj.skills, pj.qualifications, pj.gender,
			       pj.experience AS required_experience,
			       pj.education AS educational_requirements,
			       EXISTS (SELECT 1 FROM referral_queue rq
			               WHERE rq.application_id = ja.id AND rq.status = 'Approved') AS is_referred
			FROM job_applications ja
			JOIN pesoadmin_job_posts pj ON pj.id = ja.job_id
			WHERE ja.id = ?
		`, [applicationId]);
		return rows[0] || null;
	},

	/**
	 * Writes the LIVE score and completes the job. The apply-time columns
	 * (match_score / ai_analysis / ai_scored_at) are set ONLY IF STILL NULL, via
	 * COALESCE — so the FIRST score of an application (apply-time scoring, now decoupled
	 * to this worker) fills the immutable apply-time record, while every later re-score
	 * updates only the LIVE columns and can never mutate the apply-time source of truth
	 * (§7.4). Two statements, ordered score-then-complete: a crash between leaves the
	 * job 'processing' → reclaimed → re-scored (idempotent), never a lost score.
	 */
	// `inputHash` (the scoring-input signature) is persisted ONLY when the worker
	// supplies it (guard on, post-migration). When null it is left out of the SET, so
	// markScored is safe BEFORE migration 038 and behaves exactly as before. The hash
	// records the inputs of THIS successful score, so the next re-arm can skip the AI
	// call if the inputs are byte-identical (a NULL/skip never updates it, so an AI
	// outage can't poison the baseline).
	async markScored(jobId, applicationId, score, inputHash = null, conn = pool) {
		const hashSet = inputHash ? ', last_scored_input_hash = ?' : '';
		const params = [score.overall, JSON.stringify(score), score.overall, JSON.stringify(score)];
		if (inputHash) params.push(inputHash);
		params.push(applicationId);

		await conn.query(`
			UPDATE job_applications
			SET current_match_score = ?, current_ai_analysis = ?, scored_at = CURRENT_TIMESTAMP,
			    match_score  = COALESCE(match_score, ?),
			    ai_analysis  = COALESCE(ai_analysis, ?),
			    ai_scored_at = COALESCE(ai_scored_at, CURRENT_TIMESTAMP)${hashSet}
			WHERE id = ?
		`, params);

		await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'done', worker_id = NULL, locked_at = NULL, last_error = NULL
			WHERE id = ?
		`, [jobId]);
	},

	/**
	 * The AI returned NULL (no resume / AI down / hallucination). Do NOT write a
	 * fabricated score (invariant 0.2) — keep the previous live score and just
	 * complete the job. The row is re-armed on the next real edit.
	 */
	async completeWithoutScore(jobId, reason, conn = pool) {
		await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'done', worker_id = NULL, locked_at = NULL, last_error = ?
			WHERE id = ?
		`, [String(reason || 'no score').slice(0, 1000), jobId]);
	},

	async reschedule(id, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'pending', last_error = ?, worker_id = NULL, locked_at = NULL,
			    next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), delaySeconds, id]);
	},

	async fail(id, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'failed', last_error = ?, worker_id = NULL, locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), id]);
	},

	async reclaimStuck(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE application_scoring_jobs
			SET status = 'pending', worker_id = NULL, locked_at = NULL, next_run_at = CURRENT_TIMESTAMP
			WHERE status = 'processing'
			  AND locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
		`, [staleSeconds]);
		return result.affectedRows;
	},

	/** Backlog snapshot for the health probe. */
	async health(conn = pool) {
		const [[{ pending }]] = await conn.query(
			`SELECT COUNT(*) AS pending FROM application_scoring_jobs WHERE status = 'pending'`
		);
		const [[{ failed }]] = await conn.query(
			`SELECT COUNT(*) AS failed FROM application_scoring_jobs WHERE status = 'failed'`
		);
		return { pending: Number(pending) || 0, failed: Number(failed) || 0 };
	},
};

module.exports = applicationScoringRepository;
