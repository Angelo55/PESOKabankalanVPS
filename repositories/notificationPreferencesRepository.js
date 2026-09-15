const pool = require('../db');

/**
 * Notification preference data access (migration 028).
 *
 * Presence semantics: a row exists only when the user has explicitly SET a
 * preference for a type. No row = deliver (the default). muted = TRUE = suppress.
 *
 * FAIL-OPEN CONTRACT: every read here returns the "deliver" answer on any error
 * (including the table not existing yet). A notification is a secondary concern
 * (invariant 0.1) — it must never be dropped because a preference lookup failed.
 */
const notificationPreferencesRepository = {

	/**
	 * True only if this (user, type) is explicitly muted. Any error → false
	 * (deliver), so a lookup failure can never silently swallow notifications.
	 */
	async isMuted(userId, type, conn = pool) {
		try {
			const [rows] = await conn.query(
				`SELECT 1 FROM notification_preferences
				 WHERE user_id = ? AND type = ? AND muted = TRUE LIMIT 1`,
				[userId, type]
			);
			return rows.length > 0;
		} catch (error) {
			console.warn(`[NotifPrefs] isMuted lookup failed (delivering) for user ${userId}/${type}:`, error.message);
			return false;
		}
	},

	/** The set of muted type strings for a user. Empty set on any error. */
	async mutedTypeSet(userId, conn = pool) {
		try {
			const [rows] = await conn.query(
				`SELECT type FROM notification_preferences WHERE user_id = ? AND muted = TRUE`,
				[userId]
			);
			return new Set(rows.map((r) => r.type));
		} catch (error) {
			console.warn(`[NotifPrefs] mutedTypeSet failed for user ${userId}:`, error.message);
			return new Set();
		}
	},

	/** All stored preferences for a user, as { type: muted(bool) }. */
	async listForUser(userId, conn = pool) {
		const [rows] = await conn.query(
			`SELECT type, muted FROM notification_preferences WHERE user_id = ?`,
			[userId]
		);
		return rows.reduce((acc, r) => { acc[r.type] = !!r.muted; return acc; }, {});
	},

	/**
	 * Upserts one preference. muted = TRUE suppresses; FALSE is an explicit
	 * deliver. ON DUPLICATE KEY so a user can flip a type as often as they like.
	 */
	async setPreference(userId, type, muted, conn = pool) {
		const [result] = await conn.query(
			`INSERT INTO notification_preferences (user_id, type, muted)
			 VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE muted = VALUES(muted)`,
			[userId, type, muted ? 1 : 0]
		);
		return result.affectedRows;
	},
};

module.exports = notificationPreferencesRepository;
