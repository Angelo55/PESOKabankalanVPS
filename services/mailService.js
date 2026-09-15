const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');

/**
 * Shared email layer with PROVIDER FAILOVER.
 *
 * WHY A MODULE AND NOT createTransport() PER CALLER: two transports means two
 * configurations that WILL drift — one gets a timeout, the other doesn't, and
 * you find out during a defense. One place, reused by every sender.
 *
 * WHY FAILOVER: email was the platform's one hard single point of failure —
 * a single Gmail hiccup blocked NEW REGISTRATIONS entirely (OTP signup treated
 * a send failure as fatal). sendMail now tries an ORDERED LIST of providers and
 * returns on the first success, so one provider being down no longer stops mail.
 *
 * ── TWO TRANSPORT KINDS: HTTP (Brevo / Resend) + SMTP ──────────────────────
 * Render (and many PaaS hosts) BLOCK outbound SMTP ports (25/465/587) to prevent
 * spam, so nodemailer/Gmail/Brevo-SMTP cannot connect from a deployed instance —
 * every SMTP verify fails with ENETUNREACH / timeout. The fix is to send over an
 * HTTP API (port 443, always allowed). Two HTTP providers are supported and tried
 * FIRST when configured: BREVO_API_KEY enables Brevo (delivers from a verified
 * SINGLE SENDER — no domain needed), and RESEND_API_KEY enables Resend (domain
 * required for arbitrary recipients). Locally (where SMTP is fine) you leave BOTH
 * unset and mail keeps using Gmail exactly as before — so the same code works in
 * both environments without branching on NODE_ENV.
 *
 * RESEND SENDER: Resend only sends "From" a verified domain (or its shared test
 * address onboarding@resend.dev, which delivers only to your own Resend account
 * email until you add + verify a domain). Set RESEND_FROM to a verified sender
 * (e.g. "PESO Kabankalan <noreply@yourdomain>") for real delivery. It deliberately
 * does NOT default to EMAIL_FROM/EMAIL_USER, because a gmail.com "From" is rejected
 * by Resend (you can't verify a domain you don't own).
 *
 * PROVIDER-NEUTRAL SMTP: the SMTP fallback is plain SMTP via EMAIL_FALLBACK_* — a
 * second Gmail, or a transactional provider's SMTP (Brevo, SES, Mailgun…). No SDK.
 *
 * SMTP transports are created lazily and cached; a failing one is dropped from the
 * cache so a transient socket error doesn't stick to a healthy provider.
 */

function getPrimaryPassword() {
	// The deployment documents the SMTP password under EITHER name; accept both
	// so there is exactly one answer to "is mail configured?".
	return process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS || null;
}

const SMTP_TIMEOUTS = {
	// Without timeouts a hung SMTP connection holds the worker forever and the job
	// sits in 'processing' until reclaimStuckJobs rescues it 5 minutes later. Fail
	// fast instead and let failover / backoff do its job.
	connectionTimeout: 15000,
	greetingTimeout: 15000,
	socketTimeout: 30000,
};

// ── Resend HTTP provider ────────────────────────────────────────────────────

const RESEND_API_BASE = 'https://api.resend.com';

/** Resend HTTP provider. Null when RESEND_API_KEY is not set. */
function resendConfig() {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) return null;
	// NOT EMAIL_FROM/EMAIL_USER — a gmail.com sender is rejected by Resend. Default
	// to the shared test sender (delivers only to your own account email) until you
	// verify a domain and set RESEND_FROM.
	const from = process.env.RESEND_FROM || 'PESO Kabankalan <onboarding@resend.dev>';
	return { name: 'resend', apiKey, from };
}

/** Read one attachment's bytes (from a `content` Buffer/string or a file `path`) as base64. */
function attachmentBase64(a) {
	let content = a.content;
	if (content == null && a.path) content = fs.readFileSync(a.path);
	return Buffer.isBuffer(content)
		? content.toString('base64')
		: (typeof content === 'string' ? Buffer.from(content).toString('base64') : null);
}

/** Normalise nodemailer-style attachments into Resend's base64 `content` shape. */
function toResendAttachments(attachments) {
	if (!attachments || !attachments.length) return undefined;
	return attachments.map((a) => ({ filename: a.filename, content: attachmentBase64(a) }));
}

async function resendSend(cfg, { to, subject, html, text, attachments }) {
	const payload = { from: cfg.from, to, subject };
	if (html) payload.html = html;
	if (text) payload.text = text;
	const atts = toResendAttachments(attachments);
	if (atts) payload.attachments = atts;

	const res = await axios.post(`${RESEND_API_BASE}/emails`, payload, {
		headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
		timeout: 20000,
	});
	return res.data?.id || 'resend';
}

async function resendVerify(cfg) {
	// No dedicated "verify key" endpoint; GET /domains is a cheap authenticated call
	// that a FULL-access key can make. But the RECOMMENDED, most-secure key type is
	// "send-only" (restricted), which cannot read /domains and answers 401 with
	// "This API key is restricted to only send emails". That key sends perfectly —
	// sending is all we do — so it must count as verified, not failed. So: a 2xx is
	// a full key; a restricted-key rejection is a valid send-only key; only a
	// genuine invalid-key rejection or an unreachable API is a real failure.
	try {
		await axios.get(`${RESEND_API_BASE}/domains`, {
			headers: { Authorization: `Bearer ${cfg.apiKey}` },
			timeout: 10000,
		});
	} catch (error) {
		const msg = (error.response?.data?.message || error.message || '').toLowerCase();
		if (msg.includes('restricted') || msg.includes('only send')) return; // valid send-only key
		throw error; // invalid key or Resend unreachable
	}
}

// ── Brevo HTTP provider ─────────────────────────────────────────────────────

const BREVO_API_URL = 'https://api.brevo.com/v3';

/**
 * Brevo transactional-email HTTP provider. Null unless BREVO_API_KEY is set.
 * Unlike Resend (domain-only), Brevo delivers from a VERIFIED SINGLE SENDER — an
 * individual address (e.g. your Gmail) you confirm in Brevo → Senders, no domain
 * required. Uses the v3 HTTP API key (`xkeysib-…`), NOT the SMTP key (`xsmtpsib-…`)
 * used by the EMAIL_FALLBACK_* SMTP provider. The sender email MUST be verified in
 * Brevo; it defaults to EMAIL_USER for convenience, override with BREVO_FROM_EMAIL.
 */
function brevoConfig() {
	const apiKey = process.env.BREVO_API_KEY;
	const email = process.env.BREVO_FROM_EMAIL || process.env.EMAIL_USER;
	if (!apiKey || !email) return null;
	return { name: 'brevo-http', apiKey, sender: { name: process.env.BREVO_FROM_NAME || 'PESO Kabankalan', email } };
}

function toBrevoAttachments(attachments) {
	if (!attachments || !attachments.length) return undefined;
	return attachments.map((a) => ({ name: a.filename, content: attachmentBase64(a) }));
}

async function brevoSend(cfg, { to, subject, html, text, attachments }) {
	const recipients = (Array.isArray(to) ? to : [to]).map((email) => ({ email }));
	const payload = { sender: cfg.sender, to: recipients, subject };
	if (html) payload.htmlContent = html;
	if (text) payload.textContent = text;
	const atts = toBrevoAttachments(attachments);
	if (atts) payload.attachment = atts;

	const res = await axios.post(`${BREVO_API_URL}/smtp/email`, payload, {
		headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
		timeout: 20000,
	});
	return res.data?.messageId || 'brevo';
}

async function brevoVerify(cfg) {
	// GET /account is a cheap authenticated call any valid v3 key can make (401 = bad key).
	await axios.get(`${BREVO_API_URL}/account`, {
		headers: { 'api-key': cfg.apiKey, accept: 'application/json' },
		timeout: 10000,
	});
}

// ── SMTP providers ──────────────────────────────────────────────────────────

/** Primary SMTP provider: the existing Gmail account. Null when not configured. */
function primaryConfig() {
	const pass = getPrimaryPassword();
	if (!process.env.EMAIL_USER || !pass) return null;
	return {
		name: 'primary',
		from: process.env.EMAIL_FROM || `"PESO Kabankalan" <${process.env.EMAIL_USER}>`,
		options: { service: 'gmail', auth: { user: process.env.EMAIL_USER, pass }, ...SMTP_TIMEOUTS },
	};
}

/** Optional secondary SMTP provider: any SMTP endpoint via EMAIL_FALLBACK_*. */
function fallbackConfig() {
	const host = process.env.EMAIL_FALLBACK_HOST;
	const user = process.env.EMAIL_FALLBACK_USER;
	const pass = process.env.EMAIL_FALLBACK_PASS || process.env.EMAIL_FALLBACK_PASSWORD;
	if (!host || !user || !pass) return null;
	const port = Number(process.env.EMAIL_FALLBACK_PORT) || 587;
	// The visible sender defaults to your REAL identity (the same address the
	// primary sends as), never the SMTP login — a relay login like
	// `xxxx@smtp-brevo.com` is not a valid "From" and providers reject it. So you
	// verify ONE sender with the fallback provider and it just works; only
	// override with EMAIL_FALLBACK_FROM if you want a different visible sender.
	const from = process.env.EMAIL_FALLBACK_FROM
		|| process.env.EMAIL_FROM
		|| (process.env.EMAIL_USER ? `"PESO Kabankalan" <${process.env.EMAIL_USER}>` : `"PESO Kabankalan" <${user}>`);
	return {
		name: 'fallback',
		from,
		options: {
			host, port,
			secure: process.env.EMAIL_FALLBACK_SECURE === 'true' || port === 465,
			auth: { user, pass },
			...SMTP_TIMEOUTS,
		},
	};
}

const transportCache = new Map();
function getTransport(cfg) {
	if (transportCache.has(cfg.name)) return transportCache.get(cfg.name);
	const t = nodemailer.createTransport(cfg.options);
	transportCache.set(cfg.name, t);
	return t;
}

// ── Unified provider list ───────────────────────────────────────────────────

/**
 * Ordered list of usable providers, each exposing a uniform { name, send, verify }.
 * HTTP providers (Brevo, then Resend) are FIRST when configured — they are the ones
 * that work on a host that blocks SMTP — then the SMTP providers as fallback. Brevo
 * leads because it delivers from a verified single sender (no domain), so it's the
 * effective sender in production even if a domain-less Resend key is also present.
 * `drop()` clears any cached SMTP transport after a failure (no-op for HTTP).
 */
function buildProviders() {
	const providers = [];

	const brevo = brevoConfig();
	if (brevo) {
		providers.push({
			name: brevo.name,
			send: (msg) => brevoSend(brevo, msg),
			verify: () => brevoVerify(brevo),
			drop: () => {},
		});
	}

	const resend = resendConfig();
	if (resend) {
		providers.push({
			name: resend.name,
			send: (msg) => resendSend(resend, msg),
			verify: () => resendVerify(resend),
			drop: () => {},
		});
	}

	for (const cfg of [primaryConfig(), fallbackConfig()].filter(Boolean)) {
		providers.push({
			name: cfg.name,
			send: async (msg) => {
				const info = await getTransport(cfg).sendMail({
					from: cfg.from, to: msg.to, subject: msg.subject,
					text: msg.text, html: msg.html, attachments: msg.attachments || [],
				});
				return info.messageId;
			},
			verify: () => getTransport(cfg).verify(),
			drop: () => transportCache.delete(cfg.name), // don't reuse a broken socket
		});
	}

	return providers;
}

/** True when at least one provider can send. Lets callers degrade deliberately. */
function isMailConfigured() {
	return buildProviders().length > 0;
}

/**
 * Sends one email, trying each configured provider in order until one accepts it.
 * Returns the id (string) of the successful send — unchanged contract, so existing
 * callers are untouched. Throws only if EVERY provider fails.
 *
 * `attachments` is Nodemailer's format: [{ filename, path }] or [{ filename, content }].
 * The Resend provider converts these to base64 automatically.
 */
async function sendMail({ to, subject, html, text, attachments }) {
	const providers = buildProviders();
	if (providers.length === 0) {
		throw new Error('No email provider configured (set RESEND_API_KEY, or EMAIL_USER + EMAIL_APP_PASSWORD, and optionally EMAIL_FALLBACK_*).');
	}

	const errors = [];
	for (const provider of providers) {
		try {
			const id = await provider.send({ to, subject, html, text, attachments });
			if (provider.name !== providers[0].name) {
				console.warn(`[Mail] Delivered via '${provider.name}' provider — an earlier provider was unavailable.`);
			}
			return id;
		} catch (error) {
			const detail = error.response?.data?.message || error.message;
			console.error(`[Mail] Provider '${provider.name}' failed: ${detail}`);
			errors.push(`${provider.name}: ${detail}`);
			provider.drop();
		}
	}

	throw new Error(`All email providers failed — ${errors.join(' | ')}`);
}

/**
 * Verifies each configured provider without sending. Called on boot so a
 * misconfigured mailer is discovered immediately. Returns true if AT LEAST ONE
 * provider is usable (failover means we don't need all of them healthy).
 */
async function verifyMailTransport() {
	const providers = buildProviders();
	if (providers.length === 0) {
		console.error('[Mail] No email provider configured. Mail (incl. OTP signup) will be unavailable.');
		return false;
	}

	let anyOk = false;
	for (const provider of providers) {
		try {
			await provider.verify();
			console.log(`[Mail] Provider '${provider.name}' verified.`);
			anyOk = true;
		} catch (error) {
			console.error(`[Mail] Provider '${provider.name}' verification FAILED: ${error.response?.data?.message || error.message}`);
			provider.drop();
		}
	}
	if (!anyOk) console.error('[Mail] No usable email provider — sends will fail and be retried.');
	return anyOk;
}

/**
 * Live per-provider reachability, for /admin/health. Runs verify() on each
 * configured provider so the health page shows exactly which sender is up. No
 * secrets are returned — only the provider name and its ok/error state.
 */
async function getMailHealth() {
	const providers = buildProviders();
	const results = await Promise.all(providers.map(async (provider) => {
		try {
			await provider.verify();
			return { name: provider.name, ok: true };
		} catch (error) {
			provider.drop();
			return { name: provider.name, ok: false, error: error.response?.data?.message || error.message };
		}
	}));
	return {
		configured: providers.length,
		providers: results,
		healthy: results.some(r => r.ok),
	};
}

module.exports = { sendMail, verifyMailTransport, isMailConfigured, getMailHealth };
