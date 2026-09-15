const pool = require('../db');

/**
 * SMS-outbox data access layer (migration 044).
 *
 * The SMS twin of emailOutboxRepository.js — the concurrency model is DELIBERATELY
 * IDENTICAL: a read-only findDue() followed by an atomic conditional claim(), the
 * only pattern this codebase has proven safe on TiDB (no SELECT ... FOR UPDATE SKIP
 * LOCKED, §7.5). Do not invent a second mechanism here.
 *
 * Every method accepts an optional `conn` so a caller inside a transaction can thread
 * its own connection through; otherwise queries default to the pool. (Enqueue is
 * normally OUTSIDE a transaction — the outbox decouples the send from the request.)
 */
const smsOutboxRepository = {

	// ========================================================================
	// ENQUEUE
	// ========================================================================

	/**
	 * Queues one SMS. Returns the row id.
	 *
	 * IDEMPOTENT ON dedupe_key (like the email outbox): a repeated enqueue with the
	 * same key is a NO-OP returning the existing row's id, so a double-fired referral
	 * notification texts the recipient exactly once. A NULL dedupe_key never collides
	 * (TiDB treats NULL as distinct in a UNIQUE index).
	 */
	async enqueue({ userId = null, toNumber, templateKey = 'general', body, dedupeKey = null, maxAttempts }, conn = pool) {
		const [result] = await conn.query(`
			INSERT INTO sms_outbox
				(user_id, to_number, template_key, body, dedupe_key, max_attempts, status, attempts, next_run_at)
			VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
		`, [
			userId,
			toNumber,
			templateKey,
			String(body || '').slice(0, 480),
			dedupeKey,
			Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : (Number(process.env.SMS_OUTBOX_MAX_ATTEMPTS) || 4),
		]);

		return result.insertId;
	},

	// ========================================================================
	// WORKER: claim / advance / fail / reclaim
	// ========================================================================

	/** Rows due to be sent. Read-only — claiming happens separately. */
	async findDue(limit, conn = pool) {
		const [rows] = await conn.query(`
			SELECT id, user_id, to_number, template_key, body, attempts, max_attempts
			FROM sms_outbox
			WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
			ORDER BY next_run_at ASC
			LIMIT ?
		`, [limit]);

		return rows;
	},

	/**
	 * Atomically claims a row. The WHOLE concurrency model is this one statement:
	 * `status = 'pending'` serializes racing workers — only the first UPDATE matches,
	 * the loser matches zero rows. Safe across instances with no locking clause,
	 * identical to emailOutboxRepository.claim. Returns true if this worker owns it.
	 */
	async claim(id, workerId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE sms_outbox
			SET status = 'processing',
				worker_id = ?,
				locked_at = CURRENT_TIMESTAMP,
				attempts = attempts + 1
			WHERE id = ? AND status = 'pending'
		`, [workerId, id]);

		return result.affectedRows === 1;
	},

	/** Delivered. Terminal success — record the provider + its message id. */
	async markSent(id, provider, providerMessageId, conn = pool) {
		const [result] = await conn.query(`
			UPDATE sms_outbox
			SET status = 'sent',
				sent_at = CURRENT_TIMESTAMP,
				provider = ?,
				provider_message_id = ?,
				last_error = NULL,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [provider || null, providerMessageId || null, id]);

		return result.affectedRows;
	},

	/** Send failed but retries remain. Backoff persisted as a TIMESTAMP, not a setTimeout. */
	async reschedule(id, delaySeconds, errorMessage, conn = pool) {
		await conn.query(`
			UPDATE sms_outbox
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
			UPDATE sms_outbox
			SET status = 'failed',
				last_error = ?,
				worker_id = NULL,
				locked_at = NULL
			WHERE id = ?
		`, [String(errorMessage).slice(0, 1000), id]);
	},

	/**
	 * Recovers rows abandoned mid-send (process killed between claim() and markSent()).
	 * `attempts` is NOT reset, so a row that repeatedly crashes the worker still
	 * exhausts its retries instead of looping.
	 */
	async reclaimStuck(staleSeconds, conn = pool) {
		const [result] = await conn.query(`
			UPDATE sms_outbox
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
	// ADMIN MONITOR + RESEND (Super Admin "SMS Delivery" page)
	// ========================================================================

	/** Row counts by status, for the monitor tiles and the health probe. */
	async counts(conn = pool) {
		const [rows] = await conn.query(
			`SELECT status, COUNT(*) AS count FROM sms_outbox GROUP BY status`
		);
		const base = { pending: 0, processing: 0, sent: 0, failed: 0 };
		for (const r of rows) base[r.status] = Number(r.count);
		return base;
	},

	/**
	 * Recent rows for the monitor table. Failed and pending first (the rows an
	 * administrator can act on), then most recent. The number is masked in the route
	 * layer — the repository returns raw rows.
	 */
	async listRecent(limit = 100, conn = pool) {
		const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
		const [rows] = await conn.query(`
			SELECT id, to_number, template_key, status, attempts, max_attempts,
			       provider, provider_message_id, last_error, next_run_at, created_at, sent_at
			FROM sms_outbox
			ORDER BY
				CASE status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,
				created_at DESC
			LIMIT ?
		`, [safeLimit]);
		return rows;
	},

	/**
	 * Resend primitive: re-arm dead-lettered (or stalled pending) rows. The
	 * `status IN ('failed','pending')` guard means a resend can never disturb an
	 * already-'sent' row (double delivery) or one currently 'processing'.
	 */
	async resetToPending(ids, conn = pool) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		const [result] = await conn.query(`
			UPDATE sms_outbox
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

	/** Operational snapshot for GET /admin/health. */
	async health(conn = pool) {
		const [[{ pending }]] = await conn.query(
			`SELECT COUNT(*) AS pending FROM sms_outbox WHERE status = 'pending'`
		);
		const [[{ failed }]] = await conn.query(
			`SELECT COUNT(*) AS failed FROM sms_outbox WHERE status = 'failed'`
		);
		const [[{ oldest }]] = await conn.query(
			`SELECT TIMESTAMPDIFF(MINUTE, MIN(created_at), NOW()) AS oldest
			   FROM sms_outbox WHERE status = 'pending'`
		);
		return {
			pending: Number(pending) || 0,
			failed: Number(failed) || 0,
			oldestPendingAgeMinutes: oldest === null ? 0 : Number(oldest),
		};
	},
};

module.exports = smsOutboxRepository;
