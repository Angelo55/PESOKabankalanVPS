/**
 * SMS delivery API — the durable, retryable send path for the SMS channel.
 *
 * SINGLE ENTRY POINT for queuing an SMS. Callers (the notificationService channel
 * router, the walk-in claim flow) call enqueue() here; the smsWorker drains the row
 * through the swappable smsService provider. This is the SMS twin of
 * emailOutboxService, minus the inline "sendImmediate" path — SMS is always a
 * SECONDARY, best-effort channel (§0.1/§0.11), never on a user's hot request path, so
 * everything goes through the durable outbox with retry/backoff/dead-letter.
 *
 * NEVER THROWS (invariant 0.1): a queue-write failure is logged and swallowed — an
 * SMS must never fail the referral/claim action that triggered it.
 *
 * GATING: enqueue only writes a row when a provider is actually configured
 * (isSmsConfigured). WHETHER to fan a notification out to SMS at all is decided
 * upstream by the channel router (the sms_notifications_enabled system setting +
 * the recipient's verified/opted-in phone), so this service never reads that setting.
 */

const smsOutboxRepository = require('../repositories/smsOutboxRepository');
const { isSmsConfigured, toE164PH } = require('./smsService');

/**
 * Queue one SMS for durable delivery. Returns { queued, id } (safe to ignore).
 * A missing provider or an un-normalizable number is a logged no-op, never an error.
 */
async function enqueue({ userId = null, to, templateKey = 'general', body, dedupeKey = null, maxAttempts } = {}) {
	const toNumber = toE164PH(to);
	if (!toNumber) {
		console.warn(`[SmsOutbox] Skipped — un-normalizable number for template ${templateKey}.`);
		return { queued: false, id: null };
	}
	if (!isSmsConfigured()) {
		// No provider wired yet — stay dark. The router should not have called us, but
		// this second guard keeps the table empty until Semaphore (or another provider)
		// is configured, so a stray row never sits pending forever.
		console.log(`[SmsOutbox] Skipped — no SMS provider configured (${templateKey}).`);
		return { queued: false, id: null };
	}

	try {
		const id = await smsOutboxRepository.enqueue({ userId, toNumber, templateKey, body, dedupeKey, maxAttempts });
		return { queued: true, id };
	} catch (error) {
		console.error(`[SmsOutbox] enqueue failed for ${templateKey} (swallowed, primary action unaffected): ${error.message}`);
		return { queued: false, id: null };
	}
}

// ── Admin monitor + resend (Super Admin "SMS Delivery" page) ────────────────

/** Status for GET /admin/sms: provider config, counts, recent rows (numbers masked in the route). */
async function getStatus() {
	const [counts, recent] = await Promise.all([
		smsOutboxRepository.counts(),
		smsOutboxRepository.listRecent(100),
	]);
	return { configured: isSmsConfigured(), counts, recent };
}

/** Re-arm the given rows for delivery. Returns { requeued, skipped }. */
async function resend(ids) {
	const clean = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Number.isInteger);
	if (clean.length === 0) return { requeued: 0, skipped: 0 };
	const requeued = await smsOutboxRepository.resetToPending(clean);
	return { requeued, skipped: clean.length - requeued };
}

/** Health snapshot for GET /admin/health. */
async function getHealth() {
	const h = await smsOutboxRepository.health();
	return { configured: isSmsConfigured(), ...h };
}

module.exports = { enqueue, getStatus, resend, getHealth };
