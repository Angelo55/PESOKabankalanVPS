const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

/**
 * Centralised Trash for the Job Seeker's two personal collections.
 *
 * Both sources use the SAME soft-delete shape (`deleted_at`, migration 018), so
 * this router is written once and parameterised by `:type` rather than
 * duplicated per table. TYPE_MAP is the allow-list — `type` is never
 * interpolated into SQL directly, only used to look up a frozen descriptor.
 *
 * Retention: 7 days from deleted_at. Expired rows are purged lazily on every
 * read of this router (see `purgeExpired`), so a user can never see or restore
 * an item past its window, and the tables self-clean without a scheduler. The
 * live lists filter `deleted_at IS NULL` regardless, so an unpurged expired row
 * is invisible rather than incorrect.
 */
const RETENTION_DAYS = 7;

const TYPE_MAP = {
	'saved-jobs': {
		table: 'saved_jobs',
		idColumn: 'id',
		label: 'Saved Vacancies',
		// Joined so Trash can show the vacancy's real title, not just an id.
		selectSql: `
			SELECT sj.id, sj.deleted_at, sj.color_label, sj.is_pinned,
			       pj.title, pj.company, pj.location, pj.work_setup
			FROM saved_jobs sj
			JOIN pesoadmin_job_posts pj ON sj.job_id = pj.id
			WHERE sj.user_id = ? AND sj.deleted_at IS NOT NULL
			ORDER BY sj.deleted_at DESC
		`,
	},
	'applications': {
		table: 'usertrackedjobs',
		idColumn: 'id',
		label: 'My Applications',
		selectSql: `
			SELECT id, deleted_at, color_label, is_pinned,
			       job_title AS title, company, status, job_type AS work_setup
			FROM usertrackedjobs
			WHERE user_id = ? AND deleted_at IS NOT NULL
			ORDER BY deleted_at DESC
		`,
	},
};

const resolveType = (type) => TYPE_MAP[type] || null;

/** Normalises a body `ids` array to positive integers. Empty => null (reject). */
const parseIds = (raw) => {
	if (!Array.isArray(raw)) return null;
	const ids = raw.map(Number).filter(n => Number.isInteger(n) && n > 0);
	return ids.length ? ids : null;
};

/**
 * Hard-delete anything past the retention window, for this user only.
 * Runs before every read/mutation on this router. Never throws into the caller:
 * a failed purge must not block the user from seeing or restoring their items.
 */
async function purgeExpired(userId) {
	for (const { table } of Object.values(TYPE_MAP)) {
		try {
			await db.query(
				`DELETE FROM ${table}
				 WHERE user_id = ? AND deleted_at IS NOT NULL
				   AND deleted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
				[userId, RETENTION_DAYS]
			);
		} catch (error) {
			console.error(`[Trash] Purge failed for ${table}:`, error.message);
		}
	}
}

// ==========================================
// 1. LIST — both sources, categorised
// ==========================================
router.get('/', async (req, res) => {
	try {
		await purgeExpired(req.userId);

		const groups = {};
		for (const [type, cfg] of Object.entries(TYPE_MAP)) {
			const [rows] = await db.query(cfg.selectSql, [req.userId]);
			groups[type] = {
				label: cfg.label,
				items: rows.map(r => ({
					...r,
					// Precomputed so the client never has to re-derive the policy.
					days_left: Math.max(
						0,
						RETENTION_DAYS - Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 86400000)
					),
				})),
			};
		}

		res.status(200).json({ status: 'success', retentionDays: RETENTION_DAYS, data: groups });
	} catch (error) {
		console.error('[Trash] GET / failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to load Trash.' });
	}
});

// ==========================================
// 2. MOVE TO TRASH (soft delete)
// ==========================================
router.post('/:type', async (req, res) => {
	const cfg = resolveType(req.params.type);
	if (!cfg) return res.status(400).json({ status: 'error', message: 'Unknown item type.' });

	const ids = parseIds(req.body?.ids);
	if (!ids) return res.status(400).json({ status: 'error', message: 'No items selected.' });

	try {
		// Only touches rows that are currently LIVE, so a double-submit cannot
		// overwrite the original deleted_at and silently extend the window.
		const [result] = await db.query(
			`UPDATE ${cfg.table} SET deleted_at = CURRENT_TIMESTAMP
			 WHERE user_id = ? AND deleted_at IS NULL AND ${cfg.idColumn} IN (?)`,
			[req.userId, ids]
		);

		res.status(200).json({ status: 'success', moved: result.affectedRows });
	} catch (error) {
		console.error('[Trash] Soft delete failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to move items to Trash.' });
	}
});

// ==========================================
// 3. RESTORE (Undo, or manual restore from Trash)
// ==========================================
router.post('/:type/restore', async (req, res) => {
	const cfg = resolveType(req.params.type);
	if (!cfg) return res.status(400).json({ status: 'error', message: 'Unknown item type.' });

	const ids = parseIds(req.body?.ids);
	if (!ids) return res.status(400).json({ status: 'error', message: 'No items selected.' });

	try {
		await purgeExpired(req.userId); // an expired item must not be restorable

		const [result] = await db.query(
			`UPDATE ${cfg.table} SET deleted_at = NULL
			 WHERE user_id = ? AND deleted_at IS NOT NULL AND ${cfg.idColumn} IN (?)`,
			[req.userId, ids]
		);

		res.status(200).json({ status: 'success', restored: result.affectedRows });
	} catch (error) {
		console.error('[Trash] Restore failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to restore items.' });
	}
});

// ==========================================
// 4. DELETE PERMANENTLY (explicit, from Trash only)
// ==========================================
router.delete('/:type', async (req, res) => {
	const cfg = resolveType(req.params.type);
	if (!cfg) return res.status(400).json({ status: 'error', message: 'Unknown item type.' });

	const ids = parseIds(req.body?.ids);
	if (!ids) return res.status(400).json({ status: 'error', message: 'No items selected.' });

	try {
		// `deleted_at IS NOT NULL` is the safety rail: this endpoint can only ever
		// destroy something already in Trash, never a live record.
		const [result] = await db.query(
			`DELETE FROM ${cfg.table}
			 WHERE user_id = ? AND deleted_at IS NOT NULL AND ${cfg.idColumn} IN (?)`,
			[req.userId, ids]
		);

		res.status(200).json({ status: 'success', deleted: result.affectedRows });
	} catch (error) {
		console.error('[Trash] Permanent delete failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to delete items.' });
	}
});

module.exports = router;
