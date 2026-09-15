/**
 * notificationRoutes -- the read/acknowledge API for the bell panel.
 *
 * The `notifications` table is owned by migration 002_referral_module.sql; the
 * guard below only mirrors it so a fresh database self-heals on first request
 * (same convention as the other routers).
 *
 * All queries are owner-scoped by req.userId -- a user can only ever see or
 * acknowledge their own notifications.
 */
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const notificationPreferences = require('../repositories/notificationPreferencesRepository');

const router = express.Router();
router.use(requireAuth);

// Types a user can control from the Notification Center. Writes are RAW-validated
// against this set — an unknown type is rejected, never stored. Mirrors the
// TYPE_META contract in TopHeader.jsx; add a new type in both places.
const CONTROLLABLE_TYPES = [
	{ type: 'NEW_APPLICATION', label: 'New applications' },
	{ type: 'AI_RECOMMENDATION', label: 'AI recommendations' },
	{ type: 'NEW_MESSAGE', label: 'New messages' },
	{ type: 'NEW_JOB', label: 'New job postings' },
	{ type: 'APPLICATION_STATUS', label: 'Application status updates' },
	{ type: 'APPLICATION_DECLINED', label: 'Application not referred' },
	{ type: 'REFERRAL_ISSUED', label: 'Referral issued' },
	{ type: 'REFERRAL_UPDATE', label: 'Referral updates' },
	{ type: 'REFERRAL_OUTCOME', label: 'Referral outcome updates' },
	{ type: 'REFERRAL_ENDORSEMENT', label: 'Referrals to review' },
	{ type: 'REFERRAL_WITHDRAWN', label: 'Referral withdrawn' },
	{ type: 'EVENT_ANNOUNCEMENT', label: 'Event announcements' },
];
const CONTROLLABLE_TYPE_SET = new Set(CONTROLLABLE_TYPES.map((t) => t.type));

// Idempotent mirror of migration 002 (see §13 caveat: skips if the table
// already exists, which is the normal case in production).
let schemaReady = null;
const ensureNotificationSchema = () => {
	if (db.isPostgres) return Promise.resolve(); // schema owned by postgres/schema.sql
	if (!schemaReady) {
		schemaReady = db.query(`
			CREATE TABLE IF NOT EXISTS notifications (
				id INT AUTO_INCREMENT PRIMARY KEY,
				user_id INT NOT NULL,
				type VARCHAR(60) NOT NULL,
				title VARCHAR(200) NOT NULL,
				body TEXT NULL,
				link VARCHAR(255) NULL,
				is_read BOOLEAN NOT NULL DEFAULT FALSE,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				INDEX idx_notif_user_read (user_id, is_read, created_at)
			)
		`).catch((e) => console.error('[Notifications] Schema guard failed:', e.message));
	}
	return schemaReady;
};
ensureNotificationSchema();

// ==========================================
// 1. LIST -- latest notifications + unread total for the bell badge
// ==========================================
router.get('/', async (req, res) => {
	try {
		await ensureNotificationSchema();

		const [rows] = await db.query(
			`SELECT id, type, title, body, link, is_read, created_at
			 FROM notifications
			 WHERE user_id = ?
			 ORDER BY created_at DESC, id DESC
			 LIMIT 40`,
			[req.userId]
		);

		const [[{ unread }]] = await db.query(
			`SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = FALSE`,
			[req.userId]
		);

		res.status(200).json({ status: 'success', data: rows, unreadCount: unread || 0 });
	} catch (error) {
		console.error('Fetch Notifications Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to fetch notifications.' });
	}
});

// ==========================================
// 2. MARK ALL READ
// ==========================================
router.patch('/read-all', async (req, res) => {
	try {
		await db.query(
			`UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE`,
			[req.userId]
		);
		res.status(200).json({ status: 'success', message: 'All notifications marked as read.' });
	} catch (error) {
		console.error('Mark All Read Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to mark notifications as read.' });
	}
});

// ==========================================
// 3. MARK READ BY LINK -- auto-acknowledge when the user visits the module a
//    notification points at (e.g. opening /messages clears message alerts).
// ==========================================
router.patch('/read-by-link', async (req, res) => {
	try {
		const link = typeof req.body?.link === 'string' ? req.body.link.trim() : '';
		if (!link) return res.status(400).json({ status: 'error', message: 'A link is required.' });

		const [result] = await db.query(
			`UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND link = ? AND is_read = FALSE`,
			[req.userId, link]
		);
		res.status(200).json({ status: 'success', cleared: result.affectedRows });
	} catch (error) {
		console.error('Mark Read By Link Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to mark notifications as read.' });
	}
});

// ==========================================
// 4. MARK ONE READ -- owner-scoped by the WHERE clause
// ==========================================
router.patch('/:id/read', async (req, res) => {
	try {
		const [result] = await db.query(
			`UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?`,
			[req.params.id, req.userId]
		);
		if (result.affectedRows === 0) {
			return res.status(404).json({ status: 'error', message: 'Notification not found.' });
		}
		res.status(200).json({ status: 'success', message: 'Notification marked as read.' });
	} catch (error) {
		console.error('Mark Read Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to mark notification as read.' });
	}
});

// ==========================================
// 5. HISTORY -- full, paged notification history (the Notification Center).
//    The bell's GET / is capped at 40 for the panel; this is the complete,
//    owner-scoped, pageable trail behind the "See all" view.
// ==========================================
router.get('/history', async (req, res) => {
	try {
		await ensureNotificationSchema();

		const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
		const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

		const [rows] = await db.query(
			`SELECT id, type, title, body, link, is_read, created_at
			 FROM notifications
			 WHERE user_id = ?
			 ORDER BY created_at DESC, id DESC
			 LIMIT ? OFFSET ?`,
			[req.userId, limit, offset]
		);

		const [[{ total }]] = await db.query(
			`SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?`,
			[req.userId]
		);

		res.status(200).json({ status: 'success', data: rows, total: Number(total), limit, offset });
	} catch (error) {
		console.error('Notification History Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to load notification history.' });
	}
});

// ==========================================
// 6. PREFERENCES -- per-type mute (Notification Center controls).
//    A muted type is SUPPRESSED at the single writer (notificationService), so it
//    never badges, toasts, or lands in history until un-muted.
// ==========================================
router.get('/preferences', async (req, res) => {
	try {
		const stored = await notificationPreferences.listForUser(req.userId);
		const data = CONTROLLABLE_TYPES.map((t) => ({
			type: t.type,
			label: t.label,
			muted: stored[t.type] === true, // absent row = deliver (default)
		}));
		res.status(200).json({ status: 'success', data });
	} catch (error) {
		console.error('Notification Preferences Read Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to load notification preferences.' });
	}
});

router.put('/preferences', async (req, res) => {
	try {
		const type = String(req.body?.type || '');
		const muted = req.body?.muted === true || req.body?.muted === 'true';

		// Validate the RAW type against the known set — never store an arbitrary one.
		if (!CONTROLLABLE_TYPE_SET.has(type)) {
			return res.status(400).json({ status: 'error', message: 'Unknown notification type.' });
		}

		await notificationPreferences.setPreference(req.userId, type, muted);
		res.status(200).json({ status: 'success', message: muted ? 'Notifications muted.' : 'Notifications on.', data: { type, muted } });
	} catch (error) {
		console.error('Notification Preferences Write Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to save notification preference.' });
	}
});

module.exports = router;
