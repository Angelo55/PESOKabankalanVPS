const pool = require('../db');

/**
 * Email-outbox data access layer (migration 027).
 *
 * The generic-email twin of the referral outbox in referralRepository.js. The
 * concurrency model is deliberately IDENTICAL — a read-only findDue() followed
 * by an atomic conditional claim() — because that pattern is the one this
 * codebase has already proven safe on TiDB, which has no SELECT ... FOR UPDATE
 * SKIP LOCKED (skill §7.5). Do not invent a second mechanism here.
 *
 * Every method accepts an optional `conn` so a caller inside a transaction can
 * thread its own connection through; otherwise queries default to the pool.
 * (Enqueue is normally called OUTSIDE a transaction — the whole point of the
 * outbox is that the send is decoupled from the request — but the parameter is
 * kept for symmetry with the referral repository.)
 */
const emailOutboxRepository = {

	// ========================================================================
	// ENQUEUE
	// ========================================================================

	/**
	 * Queues one email. Returns the row id.
	 *
	 * IDEMPOTENT ON dedupe_key: the UNIQUE constraint uq_email_outbox_dedupe plus
	 * `ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` makes a repeated enqueue
	 * with the same key a NO-OP that returns the existing row's id — a
	 * double-submitted password reset queues exactly one email, and it is never
	 * re-sent just because the caller retried. A NULL dedupe_key never collides
	 * (MySQL/TiDB treat NULL as distinct in a UNIQUE index), so keyless callers
	 * always get a fresh row.
	 */
	async enqueue({ toEmail, subject, bodyHtml, bodyText, category = 'general', dedupeKey = null, maxAttempts }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO email_outbox
				(to_email, subject, body_html, body_text, category, dedupe_key, max_attempts, status, attempts, next_run_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
		`, [
			toEmail,
			String(subject || '').slice(0, 500),
			bodyHtml || null,
			bodyText || null,
			category,
			dedupeKey,
			Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : (Number(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS) || 5),
		]);

		return result.insertId;
	},

	// ========================================================================
	// WORKER: claim / advance / fail / reclaim
	// ========================================================================

	/**
	 * Rows due to be sent. Read-only — claiming happens separately, so a long
	 * SELECT never holds a lock.
	 */
	async findDue(limit, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, to_email, subject, body_html, body_text, category, attempts, max_attempts
			FROM email_outbox
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);

		return rows;
	},

	/**
	 * Atomically claims a row. THE ENTIRE CONCURRENCY MODEL IS THIS ONE
	 * STATEMENT: the `status = 'pending'` predicate serializes racing workers, so
	 * only the first UPDATE sees the row pending and the loser matches zero rows.
	 * Safe across multiple Render instances with no locking clause — identical to
	 * referralRepository.claimJob. Returns true if this worker owns the row.
	 */
	async claim(id, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE email_outbox
			SET status = 'processing',
				worker_id = ?,
				locked_at = CURRENT_TIMESTAMP,
				attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, id]);

		return result.affectedRows === 1;
	},

	/** Delivered. Terminal success — record which provider accepted it. */
	async markSent(id, provider, conn = pool) {
		const [result] = await conn.query(`
			UPDATE email_outbox
			SET status = 'sent',
				sent_at = CURRENT_TIMESTAMP,
				provider = ?,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [provider || null, id]);

		return result.affectedRows;
	},

	/**
	 * Send failed but retries remain. Backoff is persisted as a TIMESTAMP, not
	 * held in a setTimeout — next_run_at survives a crash, a redeploy, and the
	 * process dying mid-send.
	 */
	async reschedule(id, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE email_outbox
			SET status = 'pending',
				last_error = ?,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), delaySeconds, id]);
	},

	/** Out of retries. Dead-letter it for a human to resend from the admin page. */
	async fail(id, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE email_outbox
			SET status = 'failed',
				last_error = ?,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), id]);
	},

	/**
	 * Recovers rows abandoned mid-send. If the process is killed between claim()
	 * and markSent(), the row is stranded in 'processing' forever and that email
	 * is never sent — silently. On every boot, and periodically, anything held
	 * too long is returned to the queue. `attempts` is NOT reset, so a row that
	 * repeatedly crashes the worker still exhausts its retries instead of looping.
	 */
	async reclaimStuck(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE email_outbox
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
	// ADMIN MONITOR + RESEND (Super Admin "Email Delivery" page)
	// ========================================================================

	/** Row counts by status, for the monitor tiles and the health probe. */
	async counts(conn = pool) {
		const [rows] = await conn.query(
			`SELECT status, COUNT(*) AS count FROM email_outbox GROUP BY status`
		);
		const base = { pending: 0, processing: 0, sent: 0, failed: 0 };
		for (const r of rows) base[r.status] = Number(r.count);
		return base;
	},

	/**
	 * Recent rows for the monitor table. Failed and pending first (the rows an
	 * administrator can act on), then most recent. No body columns — the LONGTEXT
	 * payload never needs to cross the wire for a status list.
	 */
	async listRecent(limit = 100, conn = pool) {
		const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
		const [rows] = await conn.query(`
			SELECT id, to_email, subject, category, status, attempts, max_attempts,
			       provider, last_error, next_run_at, created_at, sent_at
			FROM email_outbox
			ORDER BY
				CASE status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,
				created_at DESC
			LIMIT ?
		`, [safeLimit]);
		return rows;
	},

	/**
	 * Resend primitive: re-arm dead-lettered (or stalled pending) rows so the
	 * worker picks them up on its next tick. Same shape as the referral retry /
	 * n8n replay already shipped. The `status IN ('failed','pending')` guard means
	 * a resend can never disturb an already-'sent' row (which would duplicate a
	 * delivered email) or one currently 'processing'. Returns affectedRows so the
	 * caller can tell a real resend from a no-op.
	 */
	async resetToPending(ids, conn = pool) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		const [result] = await conn.query(`
			UPDATE email_outbox
			SET status = 'pending',
				attempts = 0,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL,
				next_run_at = CURRENT_TIMESTAMP
			WHERE id IN (?) AND status IN ('failed', 'pending')
		`, [ids]);
		return result.affectedRows;
	},

	/**
	 * Operational snapshot for GET /admin/health: how many are waiting, how many
	 * dead-lettered, and how long the oldest pending row has been waiting (a
	 * rising age is the signal the worker has stalled or is disabled).
	 */
	async health(conn = pool) {
		const [[{ pending }]] = await conn.query(
			`SELECT COUNT(*) AS pending FROM email_outbox WHERE status = 'pending'`
		);
		const [[{ failed }]] = await conn.query(
			`SELECT COUNT(*) AS failed FROM email_outbox WHERE status = 'failed'`
		);
		const [[{ oldest }]] = await conn.query(
			`SELECT TIMESTAMPDIFF(MINUTE, MIN(created_at), NOW()) AS oldest
			   FROM email_outbox WHERE status = 'pending'`
		);
		return {
			pending: Number(pending) || 0,
			failed: Number(failed) || 0,
			oldestPendingAgeMinutes: oldest === null ? 0 : Number(oldest),
		};
	},
};

module.exports = emailOutboxRepository;
