/**
 * GET /api/usage — the signed-in Job Seeker's live usage across every quota'd
 * resource (record counts, the daily import rate, stored-data footprint, and the
 * per-operation upload ceilings). Read-only, owner-scoped by req.userId.
 *
 * The catalogue + limits live in config/quotas.js (single source); the live
 * figures are computed by services/usageService.js. The frontend renders them via
 * hooks/useUsage.js + components/common/UsageMeter.
 */
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/authMiddleware');
const usageService = require('../services/usageService');

router.get('/', requireAuth, async (req, res) => {
	try {
		const resources = await usageService.computeSeekerUsage(req.userId);
		res.json({ status: 'success', scope: 'seeker', resources });
	} catch (e) {
		console.error('[usage] seeker usage failed:', e);
		res.status(500).json({ status: 'error', message: 'Could not load usage.' });
	}
});

module.exports = router;
