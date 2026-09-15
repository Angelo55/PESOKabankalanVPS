/**
 * smsService — the PROVIDER ABSTRACTION for SMS delivery (#8).
 *
 * WHY AN ABSTRACTION (requirement): the SMS provider must be swappable without
 * rewriting the notification system. Callers only ever use `sendSms()` /
 * `isSmsConfigured()`; the concrete provider (Semaphore, Twilio, …) is chosen by
 * env and hidden behind a uniform `{ name, send }` shape — exactly how mailService
 * hides its HTTP/SMTP providers.
 *
 * STATUS (2026-08-23): the ARCHITECTURE is complete and provider-agnostic. Providers:
 *   - `semaphore` — the intended PRODUCTION provider (PH-local), fully wired but ON
 *     HOLD: the account is unfunded (credits ≈ ₱2,800 / 5,000 too costly at this
 *     stage) and Semaphore's account is still "Pending" activation. Config, code, and
 *     migration path are kept intact so it can be switched on later with NO code
 *     change (see docs/sms-notification-proposal.md → "Deferred").
 *   - `textbee` — a TEMPORARY, low-cost DEV provider (textbee.dev; an Android phone as
 *     the SMS gateway) wired 2026-08-23 for real-delivery testing while Semaphore is
 *     unfunded. Env-only (`TEXTBEE_API_KEY` + optional `TEXTBEE_DEVICE_ID`).
 *   - `twilio` — a second stub, ready to wire, so the abstraction is provably swappable.
 *   - `console` (alias `log`) — a ZERO-COST DEV/SANDBOX provider that "delivers" to the
 *     server log, used to validate the whole architecture + workflow without credits.
 * Callers only ever use sendSms()/isSmsConfigured(); the concrete provider is chosen by
 * SMS_PROVIDER. Swapping console → semaphore later is an env change, not a rewrite.
 *
 * Still INERT by default: with SMS_PROVIDER unset (or its key missing),
 * isSmsConfigured() is false and sendSms() is a logged no-op — the channel ships dark.
 * The channel router in notificationService is separately gated by
 * sms_notifications_enabled, so even a configured provider sends nothing until that flag
 * is on and the recipient has a verified, opted-in phone.
 */

const axios = require('axios');

// Normalize a PH mobile number to E.164 (+63XXXXXXXXXX) where possible. Providers
// vary in what they accept; a shared normalizer keeps callers simple.
function toE164PH(raw) {
	const d = String(raw || '').replace(/\D/g, '');
	if (!d) return null;
	if (d.startsWith('63')) return `+${d}`;
	if (d.startsWith('0')) return `+63${d.slice(1)}`;
	if (d.length === 10) return `+63${d}`; // 9XXXXXXXXX
	return `+${d}`;
}

// ── Providers (each: { name, configured(), async send(to, body) → {id} }) ──────
// Only skeletons here; the actual HTTP call is added when a provider is chosen so we
// never ship an untested request to a real API. Env-gated so nothing runs by default.

const SEMAPHORE_API_URL = 'https://api.semaphore.co/api/v4/messages';

const semaphore = {
	name: 'semaphore',
	configured: () => Boolean(process.env.SEMAPHORE_API_KEY),
	async send(to, body) {
		// PH-local gateway (docs/sms-notification-proposal.md §3). Form-encoded POST,
		// same axios style mailService uses for Brevo/Resend. `sendername` is OPTIONAL:
		// omit it (env unset) and Semaphore delivers under its shared default sender
		// until a custom LGU sender name ("PESO Kabankalan") is APPROVED — a
		// self-registered, unapproved name would be rejected, so we don't force it.
		// Semaphore expects the PH number WITHOUT the leading '+' (e.g. 639171234567 or
		// 09171234567). Our canonical form is +63…, so strip the '+' for this provider.
		const params = new URLSearchParams({
			apikey: process.env.SEMAPHORE_API_KEY,
			number: String(to || '').replace(/^\+/, ''),
			message: String(body || '').slice(0, 480),
		});
		const senderName = String(process.env.SEMAPHORE_SENDER_NAME || '').trim();
		if (senderName) params.append('sendername', senderName);

		const res = await axios.post(SEMAPHORE_API_URL, params.toString(), {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS) || 15000,
		});

		// Semaphore returns an array of queued message objects. A non-2xx throws (axios),
		// and an empty/odd 2xx body is treated as a failure so it retries rather than
		// being silently marked sent.
		const first = Array.isArray(res.data) ? res.data[0] : res.data;
		const id = first?.message_id ?? first?.messageId ?? null;
		if (!first || (Array.isArray(res.data) && res.data.length === 0)) {
			throw new Error('Semaphore accepted the request but returned no message — treating as failed.');
		}
		return { id: id != null ? String(id) : null };
	},
};

const twilio = {
	name: 'twilio',
	configured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
	async send(/* to, body */) {
		throw new Error('Twilio provider not yet wired — confirm the account + messaging number first.');
	},
};

// TextBee (open-source Android SMS gateway, textbee.dev) — a TEMPORARY, low-cost DEV
// provider that turns a registered Android phone into the SMS sender. Chosen because
// Semaphore is deferred/unfunded; kept behind the SAME abstraction so Semaphore can be
// switched on later with NO business-logic change (just SMS_PROVIDER + its key).
//
// API (verified 2026-08-23): POST https://api.textbee.dev/api/v1/gateway/send-sms with
// header `x-api-key` and JSON `{ recipients:[E.164], message }`. There is NO sender-name
// concept — it sends from the phone's own number — so TEXTBEE_SENDER_NAME is IGNORED; the
// DEVICE is the endpoint. TEXTBEE_DEVICE_ID (optional) targets a specific phone on the
// unified endpoint; omit it to use the account's default device. E.164 keeps the '+'.
// The API key lives ONLY in env (local/Render), never in code, docs, or the bundle.
const TEXTBEE_API_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';

const textbee = {
	name: 'textbee',
	configured: () => Boolean(process.env.TEXTBEE_API_KEY),
	async send(to, body) {
		const payload = { recipients: [to], message: String(body || '').slice(0, 480) };
		const deviceId = String(process.env.TEXTBEE_DEVICE_ID || '').trim();
		if (deviceId) payload.deviceId = deviceId;

		const res = await axios.post(TEXTBEE_API_URL, payload, {
			headers: { 'x-api-key': process.env.TEXTBEE_API_KEY, 'Content-Type': 'application/json' },
			timeout: Number(process.env.SMS_HTTP_TIMEOUT_MS) || 15000,
		});
		// A 2xx = the gateway accepted + queued it on the phone. The response id field is
		// not guaranteed by the docs, so extract best-effort and NEVER fail on its absence
		// (unlike Semaphore, where an empty body is a real failure signal).
		const d = res.data?.data ?? res.data;
		const id = d?.smsBatchId ?? d?.messageId ?? d?._id ?? d?.id ?? null;
		return { id: id != null ? String(id) : null };
	},
};

// ── Development / sandbox provider ─────────────────────────────────────────
// A ZERO-COST provider for DEV + TESTING only (production SMS via Semaphore is on
// hold, see docs/sms-notification-proposal.md). It is NOT a real carrier: it
// "delivers" by printing the full message to the server log, so a developer can read
// OTP codes and validate the ENTIRE SMS architecture end-to-end — enqueue → worker →
// send → 'sent', the phone-verify + claim-OTP round-trips, the channel router, and the
// Super Admin monitor — with no external account and no credits. Select it explicitly
// with SMS_PROVIDER=console (alias: log). Because everything sits behind this uniform
// provider shape, swapping to Semaphore later is a single env change (SMS_PROVIDER +
// key) with NO change to the notification business logic. DO NOT use in production.
const consoleDev = {
	name: 'console',
	configured: () => true,
	async send(to, body) {
		console.log(`\n────────────── [SMS:console DEV — not a real carrier] ──────────────\n  to:   ${to}\n  body: ${body}\n─────────────────────────────────────────────────────────────────────\n`);
		return { id: `dev-${Date.now()}` };
	},
};

const PROVIDERS = { semaphore, twilio, textbee, console: consoleDev, log: consoleDev };

function activeProvider() {
	const chosen = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
	const p = PROVIDERS[chosen];
	// Only use a chosen provider if it is actually configured; otherwise stay inert.
	if (p && p.configured()) return p;
	return null;
}

/** True only when a real, configured SMS provider is selected. */
function isSmsConfigured() {
	return activeProvider() != null;
}

/**
 * Best-effort SMS send. Returns { ok, provider, id } — NEVER throws into the caller
 * (SMS is a secondary channel; invariant 0.1). When no provider is configured it is
 * a logged no-op, so callers can be written now and light up when a provider lands.
 */
async function sendSms(to, body) {
	const number = toE164PH(to);
	if (!number) return { ok: false, reason: 'invalid_number' };

	const provider = activeProvider();
	if (!provider) {
		console.log(`[SMS] no provider configured; would send → ${number}`);
		return { ok: false, reason: 'not_configured' };
	}
	try {
		const res = await provider.send(number, body);
		return { ok: true, provider: provider.name, id: res?.id ?? null };
	} catch (error) {
		// Surface the provider's response body, not just the axios status line — that is
		// where the real reason lives (e.g. a Pending/unactivated account or 0 credits
		// returns 403; an invalid number returns a field error). Makes a failed send
		// diagnosable from the log without guessing.
		const detail = error.response
			? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}`
			: error.message;
		console.error(`[SMS] send via ${provider.name} failed: ${detail}`);
		return { ok: false, provider: provider.name, reason: 'send_failed' };
	}
}

module.exports = { sendSms, isSmsConfigured, toE164PH };
