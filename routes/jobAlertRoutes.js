const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const jobAlertsService = require('../services/jobAlertsService');

/**
 * AI job-alert routes (Enhancement D).
 *
 * Seeker preferences are auth-scoped; the unsubscribe endpoint is PUBLIC and
 * token-based (the one-click opt-out link in every alert email), so requireAuth
 * is applied per-route, not globally.
 */
const router = express.Router();

// A seeker's own alert preferences (frequency + optional personal score floor).
router.get('/preferences', requireAuth, async (req, res) => {
	try {
		res.status(200).json({ status: 'success', data: await jobAlertsService.getPreferences(req.userId) });
	} catch (error) {
		console.error('[JobAlerts] prefs read failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to load your job-alert settings.' });
	}
});

router.put('/preferences', requireAuth, async (req, res) => {
	try {
		const data = await jobAlertsService.setPreferences(req.userId, {
			frequency: req.body?.frequency,
			minScore: req.body?.min_score,
		});
		res.status(200).json({ status: 'success', message: 'Job-alert settings saved.', data });
	} catch (error) {
		console.error('[JobAlerts] prefs write failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Failed to save your job-alert settings.' });
	}
});

// PUBLIC one-click unsubscribe (token in the alert email). No auth by design.
router.get('/unsubscribe', async (req, res) => {
	const ok = await jobAlertsService.handleUnsubscribe(String(req.query.token || '')).catch(() => false);
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.status(ok ? 200 : 400).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job alerts</title></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1f2937;text-align:center;">
<h2 style="color:#1a4a38;">${ok ? 'You have been unsubscribed' : 'Link expired or invalid'}</h2>
<p>${ok ? 'You will no longer receive AI job-alert emails. You can turn them back on any time from your profile settings.' : 'This unsubscribe link is not valid. You can manage alerts from your profile settings after signing in.'}</p>
</body></html>`);
});

module.exports = router;
