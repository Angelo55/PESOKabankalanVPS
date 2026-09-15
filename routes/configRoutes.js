/**
 * configRoutes — client-readable runtime configuration.
 *
 * The frontend cannot see `system_settings` (that is a Super Admin surface), but
 * it does need to know which optional features are switched ON so it can render
 * the matching UI only when the backend will honour it. This endpoint exposes the
 * small, non-sensitive subset of runtime flags the client gates surfaces on —
 * NEVER secrets, thresholds, or anything an unauthenticated caller shouldn't see.
 *
 * Values resolve through the normal per-call order (DB row → env → default,
 * §7.12), so flipping a flag in the Super Admin settings screen takes effect on
 * the next fetch with no redeploy.
 */
const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const systemSettings = require('../services/systemSettingsService');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/config/features
 * The resolved boolean feature flags the client gates UI on. Read per call;
 * degrades to all-off if settings are briefly unreadable (never 500s a surface
 * the app needs to boot).
 */
router.get('/features', async (req, res) => {
	const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
	try {
		const [referralLifecycleSync, referralAcceptance, vacancyManualFill, walkInRegistration, smsNotifications] = await Promise.all([
			systemSettings.get('referral_lifecycle_sync_enabled'),
			systemSettings.get('referral_acceptance_enabled'),
			systemSettings.get('vacancy_manual_fill_enabled'),
			systemSettings.get('walk_in_registration_enabled'),
			systemSettings.get('sms_notifications_enabled'),
		]);
		res.status(200).json({
			status: 'success',
			data: {
				referralLifecycleSync: truthy(referralLifecycleSync),
				// #6 — the seeker accept/decline step (My Referrals shows the controls).
				referralAcceptance: truthy(referralAcceptance),
				// #11b — vacancy closure is PESO-verified; the client keys "Filled" on
				// status, not the referred count, when this is ON.
				vacancyManualFill: truthy(vacancyManualFill),
				// #7 — staff walk-in registration surface (Manager nav + form).
				walkInRegistration: truthy(walkInRegistration),
				// #8 — SMS channel; gates the profile phone-verify + opt-in surface.
				smsNotifications: truthy(smsNotifications),
			},
		});
	} catch (error) {
		console.error('[Config] features failed:', error.message);
		// Fail SAFE: features simply stay hidden rather than crashing the app.
		res.status(200).json({ status: 'success', data: { referralLifecycleSync: false, referralAcceptance: false, vacancyManualFill: false, walkInRegistration: false, smsNotifications: false } });
	}
});

module.exports = router;
