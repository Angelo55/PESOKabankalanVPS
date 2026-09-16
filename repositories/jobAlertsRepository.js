const pool = require('../db');

/**
 * AI job-alert data access (migration 031, Enhancement D).
 *
 * Outbox mechanics mirror the other workers (read-only findDue + atomic claim,
 * §7.5). The feature-specific parts are CANDIDATE GENERATION (a cheap SQL
 * shortlist that bounds how many seekers get AI-scored per job) and the
 * (user, job) DEDUP that guarantees no seeker is ever alerted twice for the same
 * vacancy.
 */

const jobAlertsRepository = {

	// ── Match outbox (one task per published job) ────────────────────────────

	async enqueueMatch(jobId, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO job_alert_jobs (job_id, status, attempts, next_run_at)
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
			FROM job_alert_jobs
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);
		return rows;
	},

	async claim(id, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE job_alert_jobs
			SET status = 'processing', worker_id = ?, locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, id]);
		return result.affectedRows === 1;
	},

	async markDone(id, matched, conn = pool) {
		await conn.query(`
			UPDATE job_alert_jobs
			SET status = 'done', matched = ?, worker_id = NULL, locked_at = NULL, last_error = NULL
			WHERE id = ?
		`, [matched, id]);
	},

	async reschedule(id, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE job_alert_jobs
			SET status = 'pending', last_error = ?, worker_id = NULL, locked_at = NULL,
			    next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), delaySeconds, id]);
	},

	async fail(id, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE job_alert_jobs
			SET status = 'failed', last_error = ?, worker_id = NULL, locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), id]);
	},

	async reclaimStuck(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE job_alert_jobs
			SET status = 'pending', worker_id = NULL, locked_at = NULL, next_run_at = CURRENT_TIMESTAMP
			WHERE status = 'processing' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
		`, [staleSeconds]);
		return result.affectedRows;
	},

	// ── Matching ─────────────────────────────────────────────────────────────

	/** The job to match against — only Open/Published vacancies are alerted on. */
	async findJobForMatching(jobId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, title, company, category, location, skills, qualifications,
			       description, education AS educational_requirements,
			       experience AS required_experience, status
			FROM pesoadmin_job_posts
			WHERE id = ?
		`, [jobId]);
		return rows[0] || null;
	},

	/**
	 * CANDIDATE GENERATION — the cheap SQL shortlist that bounds AI cost. Eligible
	 * seekers only: active, has a parsed resume, opted in (frequency ≠ off), and NOT
	 * already alerted for this job. Ordered by a light location-match boost, then
	 * recency, and capped. The AI score + threshold do the real relevance.
	 */
	async generateCandidates(jobId, { defaultFrequency = 'daily', jobLocation = '', cap = 50 } = {}, conn = pool) {
		const safeCap = Math.min(Math.max(parseInt(cap, 10) || 50, 1), 500);
		const [rows] = await conn.query(`
			SELECT u.id AS user_id, u.name, u.email,
			       COALESCE(jap.frequency, ?) AS frequency,
			       jap.min_score
			FROM users u
			LEFT JOIN job_alert_preferences jap ON jap.user_id = u.id
			WHERE u.role = 'applicant'
			  AND (u.account_status = 'Active' OR u.account_status IS NULL)
			  AND u.email IS NOT NULL
			  AND COALESCE(jap.frequency, ?) <> 'off'
			  AND EXISTS (SELECT 1 FROM uploaded_resumes ur WHERE ur.user_id = u.id AND ur.parsed_text IS NOT NULL AND ur.parsed_text <> '')
			  AND NOT EXISTS (SELECT 1 FROM job_alerts_sent jas WHERE jas.user_id = u.id AND jas.job_id = ?)
			ORDER BY (CASE WHEN ? <> '' AND u.location LIKE ? THEN 1 ELSE 0 END) DESC, u.id DESC
			LIMIT ?
		`, [defaultFrequency, defaultFrequency, jobId, jobLocation || '', `%${jobLocation || ''}%`, safeCap]);
		return rows;
	},

	/**
	 * Records that a seeker matched a job. INSERT IGNORE respects the (user, job)
	 * UNIQUE — the dedup guarantee — so a re-run never double-alerts. delivered=1 +
	 * sent_at set for an immediate email; delivered=0 stages it for the daily digest.
	 * Returns affectedRows (1 = new, 0 = already alerted).
	 */
	async recordMatch({ userId, jobId, score, reason, channel = 'email', delivered = 0 }, conn = pool) {
		const [result] = await conn.query(`
			INSERT IGNORE INTO job_alerts_sent (user_id, job_id, match_score, channel, delivered, reason, sent_at)
			VALUES (?, ?, ?, ?, ?, ?, ${delivered ? 'CURRENT_TIMESTAMP' : 'NULL'})
		`, [userId, jobId, score ?? null, channel, delivered ? 1 : 0, (reason || '').slice(0, 500)]);
		return result.affectedRows;
	},

	/** Immediate alerts already emailed to this seeker today (for the per-day cap). */
	async alertedTodayCount(userId, conn = pool) {
		const [[{ c }]] = await conn.query(`
			SELECT COUNT(*) AS c FROM job_alerts_sent
			WHERE user_id = ? AND delivered = 1 AND sent_at >= CURDATE()
		`, [userId]);
		return Number(c) || 0;
	},

	// ── Digest (D.2 reads these) ─────────────────────────────────────────────

	/** Seekers with at least one staged (delivered=0) match, for the daily digest. */
	async listUsersWithStaged(conn = pool) {
		const [rows] = await conn.query(`
			SELECT jas.user_id, u.name, u.email, COUNT(*) AS staged
			FROM job_alerts_sent jas
			JOIN users u ON u.id = jas.user_id
			WHERE jas.delivered = 0
			  AND (u.account_status = 'Active' OR u.account_status IS NULL)
			  AND u.email IS NOT NULL
			GROUP BY jas.user_id, u.name, u.email
		`);
		return rows;
	},

	/** One seeker's staged matches (with job detail) for the digest email body. */
	async listStagedForUser(userId, conn = pool) {
		const [rows] = await conn.query(`
			SELECT jas.id, jas.job_id, jas.match_score, jas.reason,
			       pj.title, pj.company
			FROM job_alerts_sent jas
			JOIN pesoadmin_job_posts pj ON pj.id = jas.job_id
			WHERE jas.user_id = ? AND jas.delivered = 0
			ORDER BY jas.match_score DESC
		`, [userId]);
		return rows;
	},

	async markStagedDelivered(ids, conn = pool) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		const [result] = await conn.query(
			`UPDATE job_alerts_sent SET delivered = 1, sent_at = CURRENT_TIMESTAMP WHERE id IN (?) AND delivered = 0`,
			[ids]
		);
		return result.affectedRows;
	},

	// ── Preferences + unsubscribe ────────────────────────────────────────────

	async getPreferences(userId, conn = pool) {
		const [rows] = await conn.query('SELECT frequency, min_score, unsubscribe_token FROM job_alert_preferences WHERE user_id = ?', [userId]);
		return rows[0] || null;
	},

	async upsertPreferences({ userId, frequency, minScore = null, unsubscribeToken = null }, conn = pool) {
		await conn.query(`
			INSERT INTO job_alert_preferences (user_id, frequency, min_score, unsubscribe_token)
			VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				frequency = VALUES(frequency),
				min_score = VALUES(min_score),
				unsubscribe_token = COALESCE(job_alert_preferences.unsubscribe_token, VALUES(unsubscribe_token))
		`, [userId, frequency, minScore, unsubscribeToken]);
	},

	async findUserByUnsubscribeToken(token, conn = pool) {
		const [rows] = await conn.query('SELECT user_id FROM job_alert_preferences WHERE unsubscribe_token = ?', [token]);
		return rows[0] ? rows[0].user_id : null;
	},

	// ── Monitor ──────────────────────────────────────────────────────────────

	async counts(conn = pool) {
		const [[{ pending }]] = await conn.query(`SELECT COUNT(*) AS pending FROM job_alert_jobs WHERE status IN ('pending','processing')`);
		const [[{ failed }]] = await conn.query(`SELECT COUNT(*) AS failed FROM job_alert_jobs WHERE status = 'failed'`);
		const [[{ sent }]] = await conn.query(`SELECT COUNT(*) AS sent FROM job_alerts_sent WHERE delivered = 1`);
		const [[{ staged }]] = await conn.query(`SELECT COUNT(*) AS staged FROM job_alerts_sent WHERE delivered = 0`);
		return { pending: Number(pending) || 0, failed: Number(failed) || 0, sent: Number(sent) || 0, staged: Number(staged) || 0 };
	},
};

module.exports = jobAlertsRepository;
