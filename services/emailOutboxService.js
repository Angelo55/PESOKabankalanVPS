/**
 * Generic transactional-email API (Phase 2C).
 *
 * SINGLE ENTRY POINT for every attachment-less transactional email in the
 * platform — password reset, contact-inquiry notification, OTP signup code,
 * security alerts. Senders call enqueue()/sendImmediate() here instead of newing
 * up their own nodemailer transport; that is what folds away the "two transports
 * drift" problem the mailService header warns about, and what gives all of them
 * retry / backoff / dead-letter / admin-resend / monitoring for free.
 *
 * ── THE FEATURE FLAG (EMAIL_OUTBOX_ENABLED) ─────────────────────────────────
 * Read PER CALL, never captured in a module-level const (skill §13: a const that
 * reads process.env keeps serving the boot-time value, so a flag flip appears to
 * do nothing). This is the primary rollback (blueprint §10):
 *
 *   flag OFF (default) → behaves exactly like today: senders send INLINE through
 *                        mailService (which already has P0 provider failover), no
 *                        row is written, the worker is dormant. Turning the flag
 *                        off after rollback needs no code deploy.
 *   flag ON            → enqueue() writes a durable row and returns; the
 *                        emailWorker drains it. sendImmediate() enqueues AND
 *                        makes one inline attempt (for latency-sensitive OTP).
 *
 * ── NEVER FAILS THE PRIMARY ACTION (invariant 0.1) ──────────────────────────
 * enqueue() and sendImmediate() never throw. Email is a SECONDARY concern for
 * every caller here except OTP signup, and even OTP is de-fatalised (P0): the
 * caller is told delivery is pending and the user resends. A queue-write failure
 * degrades to an inline send; a total failure is logged and reported, never
 * thrown into a password-reset or contact-form request.
 */

const emailOutboxRepository = require('../repositories/emailOutboxRepository');
const { sendMail, isMailConfigured } = require('./mailService');

/** Read per call — see the flag note above. */
const isOutboxEnabled = () => process.env.EMAIL_OUTBOX_ENABLED === 'true';

/**
 * Best-effort inline send. Returns the provider tag on success (mailService
 * reports which provider delivered via its own log; here we only need "primary"
 * as a coarse marker since sendMail returns just the messageId). Never throws.
 */
async function tryInlineSend({ toEmail, subject, bodyHtml, bodyText }) {
	if (!isMailConfigured()) return { delivered: false, error: 'no email provider configured' };
	try {
		await sendMail({ to: toEmail, subject, html: bodyHtml, text: bodyText });
		return { delivered: true };
	} catch (error) {
		return { delivered: false, error: error.message };
	}
}

/**
 * Queue an email for durable, retryable delivery.
 *
 * Fire-and-forget for the caller: the request returns the moment the intent is
 * durable, NOT when the email is sent. Use this for everything that is NOT
 * latency-sensitive (password reset, contact notification, security alerts).
 *
 * Returns { queued, id, delivered } for callers that care; safe to ignore.
 */
async function enqueue({ to, subject, html, text, category = 'general', dedupeKey = null, maxAttempts } = {}) {
	const msg = { toEmail: to, subject, bodyHtml: html, bodyText: text, category, dedupeKey, maxAttempts };

	// Flag OFF → preserve today's behaviour exactly: inline, best-effort.
	if (!isOutboxEnabled()) {
		const { delivered, error } = await tryInlineSend(msg);
		if (!delivered && error) console.warn(`[EmailOutbox] Inline send (flag off) failed for ${to}: ${error}`);
		return { queued: false, id: null, delivered };
	}

	try {
		const id = await emailOutboxRepository.enqueue(msg);
		return { queued: true, id, delivered: false };
	} catch (error) {
		// The queue write itself failed (DB blip). Do not lose the email and do
		// not fail the caller's action — fall back to an inline send.
		console.error(`[EmailOutbox] enqueue failed, falling back to inline send for ${to}: ${error.message}`);
		const { delivered } = await tryInlineSend(msg);
		return { queued: false, id: null, delivered };
	}
}

/**
 * Latency-sensitive path (OTP signup): enqueue a durable row AND make one
 * immediate inline attempt, so the user staring at the "enter your code" screen
 * does not wait a poll cycle. Blueprint §7 "OTP special handling":
 *   - inline success → mark the row 'sent' and return delivered:true.
 *   - inline failure → leave the row 'pending'; the worker retries. delivered:false,
 *     which drives the existing P0 "delivery pending, resend available" UX.
 * Either way verification integrity is untouched — a real code still gates
 * account creation. Never throws.
 */
async function sendImmediate({ to, subject, html, text, category = 'general', dedupeKey = null, maxAttempts } = {}) {
	const msg = { toEmail: to, subject, bodyHtml: html, bodyText: text, category, dedupeKey, maxAttempts };

	// Flag OFF → pure inline send, no row (identical to the P0 direct-send path).
	if (!isOutboxEnabled()) {
		const { delivered } = await tryInlineSend(msg);
		return { queued: false, id: null, delivered };
	}

	let id = null;
	try {
		id = await emailOutboxRepository.enqueue(msg);
	} catch (error) {
		// Could not stage the durable row — fall back to a plain inline attempt so
		// OTP still works during a DB blip, just without the retry safety net.
		console.error(`[EmailOutbox] sendImmediate could not stage row for ${to}: ${error.message}`);
		const { delivered } = await tryInlineSend(msg);
		return { queued: false, id: null, delivered };
	}

	const { delivered } = await tryInlineSend(msg);
	if (delivered) {
		try { await emailOutboxRepository.markSent(id, 'primary'); }
		catch (error) { console.warn(`[EmailOutbox] sent inline but could not mark row ${id}: ${error.message}`); }
	}
	// On inline failure the row stays 'pending' and the worker takes over.
	return { queued: true, id, delivered };
}

// ── Admin monitor + resend (Super Admin "Email Delivery" page) ──────────────

/** Status for GET /admin/email: whether the worker is enabled, counts, recent rows. */
async function getStatus() {
	const [counts, recent] = await Promise.all([
		emailOutboxRepository.counts(),
		emailOutboxRepository.listRecent(100),
	]);
	return { enabled: isOutboxEnabled(), counts, recent };
}

/**
 * Re-arm the given rows for delivery. Ids are validated to integers by the
 * route; resetToPending guards on status so only failed/pending rows move.
 * Returns { requeued, skipped }.
 */
async function resend(ids) {
	const clean = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Number.isInteger);
	if (clean.length === 0) return { requeued: 0, skipped: 0 };
	const requeued = await emailOutboxRepository.resetToPending(clean);
	return { requeued, skipped: clean.length - requeued };
}

/** Health snapshot for GET /admin/health. */
async function getHealth() {
	const h = await emailOutboxRepository.health();
	return { enabled: isOutboxEnabled(), ...h };
}

module.exports = {
	enqueue,
	sendImmediate,
	getStatus,
	resend,
	getHealth,
	isOutboxEnabled,
};
