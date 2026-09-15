const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

/**
 * Per-user UI preferences (see migration 016).
 *
 * Small, durable settings that must survive a refresh, a logout, and a move to
 * another device — which is exactly why these live in the database rather than
 * localStorage. localStorage would satisfy "refresh" and "log back in on the
 * same browser", but a user who signs in elsewhere would silently lose the
 * setting, and the request was explicitly for cross-session persistence.
 *
 * SECURITY: both the key AND the value are validated against the allow-list
 * below. The table therefore can never hold free-form client input, and a
 * compromised client cannot use it as arbitrary storage. Every query is scoped
 * by req.userId, so preferences are private to their owner by construction.
 */

// key -> allowed values. Adding a preference means adding one line here.
const ALLOWED = {
	referralsView: ['list', 'grid'],
};

const isValid = (key, value) =>
	Object.prototype.hasOwnProperty.call(ALLOWED, key) && ALLOWED[key].includes(value);

/**
 * GET /api/preferences
 * Returns every stored preference for the caller as a flat object, so the
 * client can hydrate in a single request:  { referralsView: 'grid' }
 */
router.get('/', async (req, res) => {
	try {
		const [rows] = await db.query(
			'SELECT pref_key, pref_value FROM user_ui_preferences WHERE user_id = ?',
			[req.userId]
		);

		// Drop anything no longer in the allow-list (e.g. a retired preference)
		// so a stale row can never resurrect a removed behaviour.
		const data = {};
		for (const row of rows) {
			if (isValid(row.pref_key, row.pref_value)) data[row.pref_key] = row.pref_value;
		}

		res.status(200).json({ status: 'success', data });
	} catch (error) {
		console.error('[Preferences] GET / failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to load preferences.' });
	}
});

/**
 * PUT /api/preferences/:key   body: { value }
 * Upsert via the (user_id, pref_key) primary key — idempotent, and free of any
 * read-modify-write race between two open tabs.
 */
router.put('/:key', async (req, res) => {
	try {
		const key = String(req.params.key || '');
		const value = req.body?.value === undefined || req.body?.value === null
			? ''
			: String(req.body.value);

		if (!isValid(key, value)) {
			return res.status(400).json({ status: 'error', message: 'Unknown preference key or value.' });
		}

		await db.query(
			`INSERT INTO user_ui_preferences (user_id, pref_key, pref_value)
			 VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE pref_value = VALUES(pref_value)`,
			[req.userId, key, value]
		);

		res.status(200).json({ status: 'success', message: 'Preference saved.' });
	} catch (error) {
		console.error('[Preferences] PUT failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to save preference.' });
	}
});

module.exports = router;
