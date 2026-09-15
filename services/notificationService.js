/**
 * notificationService -- the single writer for in-app notifications.
 *
 * Every function here is FIRE-AND-FORGET SAFE: it never throws. Notifications
 * are a secondary concern (invariant 0.1) -- an application submit, a chat
 * message, or a referral step must never fail because a notification row or a
 * socket emit did.
 *
 * Delivery contract (same as the referral worker's notify step):
 *   1. The database row is written FIRST -- it is the durable deliverable.
 *   2. The socket emit is best-effort. Offline users see the row on next load.
 *
 * Socket events consumed by ChatContext.jsx on the frontend:
 *   - 'notification_created'   -> targeted at one user's room (user_${id})
 *   - 'notification_broadcast' -> io-wide, carries targetRole for client filtering
 */
const db = require('../db');
const notificationPreferences = require('../repositories/notificationPreferencesRepository');
const systemSettings = require('./systemSettingsService');
const smsOutboxService = require('./smsOutboxService');
const { SMS_FANOUT_TYPES, renderForNotification } = require('./smsTemplates');

/**
 * CHANNEL ROUTER (docs/sms-notification-proposal.md §2).
 *
 * The in-app row is the durable deliverable (§0.11) and is written first by notifyUser.
 * AFTER that, this best-effort side channel fans the SAME event out to SMS when, and
 * only when, ALL of these hold:
 *   1. the type is an SMS type (SMS_FANOUT_TYPES — referral events only, by decision),
 *   2. sms_notifications_enabled is ON (a §7.12 system setting, read per call),
 *   3. the recipient has a VERIFIED phone AND has OPTED IN (consent, §5).
 * It NEVER throws (invariant 0.1) — an SMS failure can never affect the notification
 * that triggered it. Call sites keep calling notifyUser(); the router decides channels.
 */
async function maybeFanOutSms(userId, { type, title, body }) {
	try {
		if (!SMS_FANOUT_TYPES.has(type)) return;

		const enabled = await systemSettings.get('sms_notifications_enabled');
		if (!(enabled === true || enabled === 'true' || enabled === 1 || enabled === '1')) return;

		const [rows] = await db.query(
			`SELECT name, phone, phone_verified_at, sms_opt_in FROM users WHERE id = ?`,
			[userId]
		);
		const u = rows[0];
		if (!u || !u.phone || !u.phone_verified_at || !Number(u.sms_opt_in)) return;

		const smsBody = renderForNotification({ type, name: u.name, title, body });
		if (!smsBody) return;

		// dedupeKey collapses a double-FIRED notification into ONE text (idempotent on the
		// sms_outbox UNIQUE key). The time bucket sets how coarse that collapse is:
		//   • Referral events can double-fire from the pipeline near-simultaneously →
		//     HOUR bucket (slice 0,13) so a stray repeat is absorbed.
		//   • ACCOUNT_* lifecycle events are DELIBERATE, DISTINCT admin actions — an
		//     hour bucket wrongly suppressed a legitimate re-suspend/reactivate (the
		//     "suspension sends no SMS on retry" bug). Use a MINUTE bucket (slice 0,16):
		//     still de-dupes an accidental double-submit, but every real action sends.
		const isLifecycle = type === 'ACCOUNT_SUSPENDED' || type === 'ACCOUNT_REACTIVATED';
		const bucket = new Date().toISOString().slice(0, isLifecycle ? 16 : 13);
		await smsOutboxService.enqueue({
			userId,
			to: u.phone,
			templateKey: type,
			body: smsBody,
			dedupeKey: `notif:${type}:${userId}:${bucket}`,
		});
	} catch (error) {
		// Secondary channel — log and move on. The in-app row already succeeded.
		console.error(`[Notifications] SMS fan-out skipped for ${type}/${userId}:`, error.message);
	}
}

function emitToUser(io, userId, payload) {
	try {
		if (io) io.to(`user_${userId}`).emit('notification_created', payload);
	} catch (error) {
		console.error('[Notifications] Live push failed (row WAS persisted):', error.message);
	}
}

/**
 * Persist a notification for one user and push it live.
 * Returns the new notification id, or null if persistence failed.
 */
async function notifyUser(io, { userId, type, title, body = null, link = null }) {
	if (!userId || !type || !title) return null;

	// Per-type mute (migration 028). isMuted is fail-open, so a preference-lookup
	// failure can never suppress a real notification (invariant 0.1). A muted type
	// writes no row at all, so it never badges, toasts, or lands in history.
	if (await notificationPreferences.isMuted(userId, type)) return null;

	try {
		const [result] = await db.query(
			`INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`,
			[userId, type, title, body, link]
		);

		emitToUser(io, userId, {
			id: result.insertId,
			type, title, body, link,
			is_read: 0,
			created_at: new Date().toISOString()
		});

		// Best-effort SMS fan-out (referral events, opted-in verified phones only).
		// Awaited but non-throwing, so it never delays or breaks the caller's action.
		await maybeFanOutSms(userId, { type, title, body });

		return result.insertId;
	} catch (error) {
		console.error(`[Notifications] Failed to persist ${type} for user ${userId}:`, error.message);
		return null;
	}
}

/**
 * Chat messages arrive in bursts; one bell entry per unread conversation state
 * is enough. If the user already has an UNREAD message notification, refresh it
 * (title/body/timestamp) instead of stacking a new row per message. Once they
 * read it, the next message starts a fresh one.
 */
async function notifyNewMessage(io, { userId, senderName = null }) {
	if (!userId) return;
	if (await notificationPreferences.isMuted(userId, 'NEW_MESSAGE')) return;

	const title = 'New message received';
	const body = senderName
		? `${senderName} sent you a new message in Communications.`
		: 'You have a new unread message in Communications.';

	try {
		const [existing] = await db.query(
			`SELECT id FROM notifications
			 WHERE user_id = ? AND type = 'NEW_MESSAGE' AND is_read = FALSE
			 ORDER BY id DESC LIMIT 1`,
			[userId]
		);

		if (existing.length > 0) {
			await db.query(
				`UPDATE notifications SET title = ?, body = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`,
				[title, body, existing[0].id]
			);
			emitToUser(io, userId, { id: existing[0].id, type: 'NEW_MESSAGE', title, body, link: '/messages', is_read: 0, created_at: new Date().toISOString() });
		} else {
			await notifyUser(io, { userId, type: 'NEW_MESSAGE', title, body, link: '/messages' });
		}
	} catch (error) {
		console.error(`[Notifications] Failed to persist NEW_MESSAGE for user ${userId}:`, error.message);
	}
}

/**
 * Broadcast to every active job seeker in ONE statement (INSERT ... SELECT),
 * then a single io-wide emit that clients filter by role. Used for new job
 * postings. Deliberately NOT a per-user loop: one round-trip regardless of
 * how many seekers are registered.
 */
async function notifyAllJobSeekers(io, { type, title, body = null, link = null }) {
	if (!type || !title) return;

	const baseInsert =
		`INSERT INTO notifications (user_id, type, title, body, link)
		 SELECT id, ?, ?, ?, ? FROM users
		 WHERE role = 'applicant' AND (account_status = 'Active' OR account_status IS NULL)`;
	// Skip seekers who muted this type (migration 028), in the same one round-trip.
	const mutedAwareInsert = baseInsert +
		` AND NOT EXISTS (
			SELECT 1 FROM notification_preferences np
			WHERE np.user_id = users.id AND np.type = ? AND np.muted = TRUE
		 )`;

	try {
		try {
			await db.query(mutedAwareInsert, [type, title, body, link, type]);
		} catch (prefError) {
			// FAIL-OPEN: if the preferences table is unavailable, deliver to all
			// rather than drop the broadcast (invariant 0.1).
			console.warn('[Notifications] Broadcast mute filter unavailable, delivering to all:', prefError.message);
			await db.query(baseInsert, [type, title, body, link]);
		}

		try {
			if (io) io.emit('notification_broadcast', { targetRole: 'applicant', type, title, body, link });
		} catch (emitError) {
			console.error('[Notifications] Broadcast push failed (rows WERE persisted):', emitError.message);
		}
	} catch (error) {
		console.error(`[Notifications] Failed to broadcast ${type} to job seekers:`, error.message);
	}
}

module.exports = { notifyUser, notifyNewMessage, notifyAllJobSeekers };
