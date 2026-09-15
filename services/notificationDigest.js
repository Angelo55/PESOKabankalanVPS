/**
 * Daily notification digest (Phase 2, optional — OFF by default).
 *
 * Emails each user a once-a-day summary of their UNREAD in-app notifications, so
 * a busy administrator who missed the bell still learns what happened. Gated by
 * the `notification_digest_enabled` system setting (default false, read PER CALL);
 * with it off this is a cheap no-op.
 *
 * ── HOW IT RESPECTS THE ARCHITECTURE ────────────────────────────────────────
 * - **No setTimeout state, no cron.** A lightweight interval merely POLLS; the
 *   run state lives in the database (a `notification_digest_last_run` marker), so
 *   the digest runs at most once per calendar day and survives restarts. Mirrors
 *   the referral/email workers' poll-and-check design (§7.5).
 * - **Delivery is durable.** Each digest is handed to the email OUTBOX
 *   (emailOutboxService.enqueue), inheriting retry / backoff / dead-letter /
 *   admin-resend — never an inline best-effort send that a provider blip loses.
 * - **Mute is already honoured.** Muted types were never written to
 *   `notifications` (notificationService suppresses them), so "unread" rows are
 *   inherently un-muted; the digest needs no extra filtering.
 * - **Secondary concern (invariant 0.1).** Every step is wrapped; a digest
 *   failure logs and moves on, never throwing into the loop.
 *
 * SINGLE-INSTANCE NOTE: the deployment runs one instance, so the read-marker /
 * set-marker pair needs no cross-instance lock. If it ever scales out, claim the
 * marker with a conditional UPDATE before sending (same pattern as the outbox).
 */

const db = require('../db');
const systemSettings = require('./systemSettingsService');
const emailOutboxService = require('./emailOutboxService');

const LAST_RUN_KEY = 'notification_digest_last_run';
// Poll every 30 min; the once-per-day marker is what actually paces the send.
const POLL_INTERVAL_MS = Number(process.env.NOTIFICATION_DIGEST_POLL_MS) || 30 * 60 * 1000;
const MAX_TITLES = 5;

let timer = null;
let ticking = false;

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

async function getLastRun() {
	try {
		const [rows] = await db.query(
			'SELECT setting_value FROM system_settings WHERE setting_key = ?',
			[LAST_RUN_KEY]
		);
		return rows[0]?.setting_value || null;
	} catch (error) {
		// Table missing / DB blip → treat as "never run"; the enabled gate still
		// guards, and a duplicate digest is harmless next to a missed one.
		return null;
	}
}

async function setLastRun(day) {
	await db.query(`
		INSERT INTO system_settings (setting_key, setting_value)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
	`, [LAST_RUN_KEY, day]);
}

function buildDigestEmail({ name, unread, titles }) {
	const greeting = name ? `Hello ${name},` : 'Hello,';
	const list = titles.map((t) => `<li style="margin:4px 0;">${t}</li>`).join('');
	const html = `
		<div style="font-family: Arial, Helvetica, sans-serif; color:#1f2937; max-width:560px; margin:0 auto; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
			<div style="background-color:#1a4a38; padding:20px; text-align:center; color:#fff;">
				<h2 style="margin:0; font-size:18px;">PESO Kabankalan — Daily Summary</h2>
			</div>
			<div style="padding:22px 24px;">
				<p style="margin:0 0 12px;">${greeting}</p>
				<p style="margin:0 0 14px;">You have <strong>${unread}</strong> unread notification${unread === 1 ? '' : 's'}:</p>
				<ul style="margin:0 0 16px; padding-left:18px; color:#374151;">${list}</ul>
				<p style="margin:0; font-size:13px; color:#6b7280;">Sign in to the platform to view them. This is a once-a-day summary; you can turn it off in your platform settings.</p>
			</div>
		</div>`;
	const text = `${greeting}\n\nYou have ${unread} unread notification(s):\n${titles.map((t) => `- ${t}`).join('\n')}\n\nSign in to view them.`;
	return { subject: `You have ${unread} unread notification${unread === 1 ? '' : 's'}`, html, text };
}

/**
 * Sends the digest if it is enabled and has not already run today. Returns a
 * small summary for logging/tests. Safe to call repeatedly; only the first call
 * of the day does work.
 */
async function runDigestIfDue() {
	if (!(await systemSettings.get('notification_digest_enabled'))) return { skipped: 'disabled' };

	const day = today();
	if ((await getLastRun()) === day) return { skipped: 'already-run-today' };

	// Claim the day up front so a second poll (or a slow first one) does not
	// double-send. Single instance, so this is a plain write.
	await setLastRun(day);

	// Users with at least one unread notification, plus a few recent titles each.
	let recipients = [];
	try {
		const [rows] = await db.query(`
			SELECT n.user_id, u.name, u.email, COUNT(*) AS unread
			FROM notifications n
			JOIN users u ON u.id = n.user_id
			WHERE n.is_read = FALSE
			  AND u.email IS NOT NULL
			  AND (u.account_status = 'Active' OR u.account_status IS NULL)
			GROUP BY n.user_id, u.name, u.email
			HAVING unread > 0
		`);
		recipients = rows;
	} catch (error) {
		console.error('[Digest] Could not read unread notifications:', error.message);
		return { skipped: 'query-failed' };
	}

	let queued = 0;
	for (const r of recipients) {
		try {
			const [titleRows] = await db.query(
				`SELECT title FROM notifications
				 WHERE user_id = ? AND is_read = FALSE
				 ORDER BY created_at DESC, id DESC LIMIT ?`,
				[r.user_id, MAX_TITLES]
			);
			const titles = titleRows.map((t) => t.title);
			const { subject, html, text } = buildDigestEmail({ name: r.name, unread: Number(r.unread), titles });

			// dedupeKey makes the day's digest idempotent per user, so a retry or a
			// second poll cannot queue two copies for the same person on the same day.
			await emailOutboxService.enqueue({
				to: r.email,
				category: 'notification_digest',
				subject,
				html,
				text,
				dedupeKey: `digest:${day}:${r.user_id}`,
			});
			queued += 1;
		} catch (error) {
			console.error(`[Digest] Failed to queue digest for user ${r.user_id}:`, error.message);
		}
	}

	console.log(`[Digest] Ran for ${day}: queued ${queued} digest email(s).`);
	return { ran: day, queued };
}

async function tick() {
	if (ticking) return;
	ticking = true;
	try {
		await runDigestIfDue();
	} catch (error) {
		console.error('[Digest] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

function startNotificationDigest() {
	if (timer) return;
	// A poll, not a scheduler: the DB marker paces the actual send to once/day.
	// Runs a first check shortly after boot, then on the interval.
	tick();
	timer = setInterval(tick, POLL_INTERVAL_MS);
	if (timer.unref) timer.unref();
	console.log(`[Digest] Scheduler started (poll ${Math.round(POLL_INTERVAL_MS / 60000)}m; sends only when enabled + due).`);
}

function stopNotificationDigest() {
	if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { runDigestIfDue, startNotificationDigest, stopNotificationDigest };
