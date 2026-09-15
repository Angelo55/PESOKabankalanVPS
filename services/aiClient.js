const axios = require('axios');

/**
 * UNIFIED AI CHAT CLIENT — provider failover + circuit breaker.
 *
 * WHY THIS EXISTS: the chat-completion call (URL, key, model, headers, timeout,
 * response shape) was copy-pasted inline across ~8 route/service files, split
 * arbitrarily between two providers that serve the SAME underlying model. When
 * one account's OpenRouter credits ran out (HTTP 402), every OpenRouter-backed
 * feature failed even though the identical model was reachable, paid-for, on the
 * DeepSeek-direct account. This client makes failover automatic.
 *
 * ── PROVIDERS ───────────────────────────────────────────────────────────────
 *   openrouter  → OpenRouter gateway (OPENROUTER_API_KEY)
 *   deepseek    → DeepSeek direct    (DEEPSEEK_API_KEY)
 * Both answer the reasoning tier with deepseek-chat. `prefer` sets which one is
 * tried FIRST, so each caller keeps its existing primary (load stays spread
 * across the two accounts) and merely GAINS a fallback.
 *
 * ── MODEL TIERS ─────────────────────────────────────────────────────────────
 *   CHAT   reasoning / scoring / extraction  → deepseek-chat everywhere
 *   DRAFT  free-text drafting (letters, chat) → gpt-4o-mini on OpenRouter,
 *                                               deepseek-chat as the substitute
 * Callers pick a tier; each provider maps it to its own model id.
 *
 * ── CIRCUIT BREAKER ─────────────────────────────────────────────────────────
 * After N consecutive failures a provider is "opened" (skipped) for a cooldown,
 * so a dead/credit-exhausted provider is not retried on every request — the
 * fallback is used directly instead of eating the primary's timeout each time.
 *
 * ── CONTRACT ────────────────────────────────────────────────────────────────
 * chat() returns the assistant message CONTENT (string) or throws AiError. It
 * deliberately does NOT parse JSON or invent a fallback result — callers keep
 * their own parsing and their own degrade path (return null / "unavailable"),
 * preserving invariant 0.2 (a real result or nothing, never a fabricated score).
 *
 * chatDetailed() is the same call but ALSO reports which provider + model actually
 * served the response (after any failover), for callers that need to STAMP that
 * provenance onto their result — e.g. the compatibility scorer records it so a
 * displayed % is auditable ("produced by deepseek-chat via openrouter"). chat()
 * simply returns chatDetailed().content, so every existing caller is unchanged.
 */

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
const BREAKER_THRESHOLD = Number(process.env.AI_BREAKER_THRESHOLD) || 3;
const BREAKER_COOLDOWN_MS = Number(process.env.AI_BREAKER_COOLDOWN_MS) || 60000;

const TIER = { CHAT: 'CHAT', DRAFT: 'DRAFT' };

const PROVIDERS = {
	openrouter: {
		name: 'openrouter',
		url: 'https://openrouter.ai/api/v1/chat/completions',
		envKey: 'OPENROUTER_API_KEY',
		model: { CHAT: 'deepseek/deepseek-chat', DRAFT: 'openai/gpt-4o-mini' },
	},
	deepseek: {
		name: 'deepseek',
		url: 'https://api.deepseek.com/chat/completions',
		envKey: 'DEEPSEEK_API_KEY',
		model: { CHAT: 'deepseek-chat', DRAFT: 'deepseek-chat' },
	},
};

class AiError extends Error {
	constructor(message, code = 'ai_error') {
		super(message);
		this.name = 'AiError';
		this.code = code; // 'unavailable' (nothing configured/all open) | 'all_failed'
	}
}

// ── Circuit breaker: in-memory, per provider (single-process app) ────────────
const breaker = new Map(); // name -> { failures, openUntil }

function isOpen(name) {
	const b = breaker.get(name);
	return Boolean(b && b.openUntil && Date.now() < b.openUntil);
}
function recordSuccess(name) {
	breaker.set(name, { failures: 0, openUntil: 0 });
}
function recordFailure(name) {
	const b = breaker.get(name) || { failures: 0, openUntil: 0 };
	b.failures += 1;
	if (b.failures >= BREAKER_THRESHOLD) {
		b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
		b.failures = 0;
		console.warn(`[AI] Circuit opened for '${name}' — pausing it ${Math.round(BREAKER_COOLDOWN_MS / 1000)}s after repeated failures.`);
	}
	breaker.set(name, b);
}

const providerConfigured = (p) => Boolean(process.env[p.envKey]);

/** Provider order for a caller: its preferred primary, then the other. */
function orderFor(prefer) {
	const primary = PROVIDERS[prefer] ? prefer : 'openrouter';
	const secondary = primary === 'openrouter' ? 'deepseek' : 'openrouter';
	return [PROVIDERS[primary], PROVIDERS[secondary]];
}

/** True if at least one provider has a key. Lets callers degrade deliberately. */
function isAiConfigured() {
	return providerConfigured(PROVIDERS.openrouter) || providerConfigured(PROVIDERS.deepseek);
}

/**
 * Run a chat completion, failing over across providers.
 *
 * @param {object}  opts
 * @param {Array}   opts.messages      OpenAI-style messages
 * @param {number} [opts.temperature]  default 0.3
 * @param {string} [opts.tier]         TIER.CHAT (default) | TIER.DRAFT
 * @param {string} [opts.prefer]       'openrouter' (default) | 'deepseek'
 * @param {number} [opts.timeout]      ms
 * @returns {Promise<string>}          assistant message content
 * @throws  {AiError}                  when no provider can serve the request
 */
async function chat(opts) {
	return (await chatDetailed(opts)).content;
}

/**
 * Same failover call as chat(), but returns { content, provider, model } so the
 * caller can record the provenance of the response (which provider/model actually
 * served it, after any failover). Throws AiError when no provider can serve it.
 *
 * @returns {Promise<{content: string, provider: string, model: string}>}
 */
/**
 * The shared failover loop. Returns the FULL assistant message (so `tool_calls`
 * survive for function-calling callers) plus the serving provider/model. Both
 * chatDetailed() and chatRaw() are thin wrappers over this — one loop, no drift.
 *
 * @returns {Promise<{message: object, provider: string, model: string}>}
 * @throws  {AiError}
 */
async function runCompletion({ messages, temperature = 0.3, tier = TIER.CHAT, prefer = 'openrouter', timeout = AI_TIMEOUT_MS, extra = {} }) {
	const order = orderFor(prefer);
	const errors = [];
	let attempted = false;

	for (const p of order) {
		if (!providerConfigured(p)) { errors.push(`${p.name}: not configured`); continue; }
		if (isOpen(p.name)) { errors.push(`${p.name}: circuit open`); continue; }

		attempted = true;
		const model = p.model[tier] || p.model.CHAT;
		try {
			const res = await axios.post(
				// `extra` carries provider-passthrough params like
				// response_format: { type: 'json_object' } (strict JSON) or
				// tools / tool_choice (function calling); both providers accept it,
				// and callers keep their own parsing/degrade path anyway.
				p.url,
				{ model, messages, temperature, ...extra },
				{ headers: { Authorization: `Bearer ${process.env[p.envKey]}` }, timeout }
			);
			const message = res.data?.choices?.[0]?.message;
			// Usable = has text OR tool calls. A tool-calling reply legitimately has
			// content:null, so we must NOT treat that as empty; only a message with
			// neither text nor tool_calls is a real (fail-over-worthy) empty response.
			const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
			if (!message || (!message.content && !hasToolCalls)) throw new Error('empty response');
			recordSuccess(p.name);
			if (p !== order[0]) console.warn(`[AI] Served by fallback provider '${p.name}' (primary was unavailable).`);
			// Report the model the provider actually reports back when present (a version
			// tag like 'deepseek-chat'); fall back to the requested model id.
			return { message, provider: p.name, model: res.data?.model || model };
		} catch (error) {
			const detail = error.response ? `HTTP ${error.response.status}` : error.message;
			console.error(`[AI] Provider '${p.name}' failed: ${detail}`);
			errors.push(`${p.name}: ${detail}`);
			recordFailure(p.name);
		}
	}

	throw new AiError(
		`${attempted ? 'All AI providers failed' : 'No AI provider available'} — ${errors.join(' | ')}`,
		attempted ? 'all_failed' : 'unavailable'
	);
}

async function chatDetailed(opts) {
	const { message, provider, model } = await runCompletion(opts);
	return { content: message.content, provider, model };
}

/**
 * Same failover call as chat(), but returns the FULL assistant message
 * ({ message: { role, content, tool_calls? }, provider, model }) so a caller can
 * run a function/tool-calling loop (DeepSeek/OpenAI style). `extra.tools` +
 * `extra.tool_choice` enable it. The public visitor-support assistant uses this;
 * content-only callers keep using chat()/chatDetailed() unchanged.
 *
 * @returns {Promise<{message: object, provider: string, model: string}>}
 * @throws  {AiError}
 */
async function chatRaw(opts) {
	return runCompletion(opts);
}

/** Per-provider config + breaker state, for a future health page. No secrets. */
function getAiHealth() {
	return {
		configured: isAiConfigured(),
		providers: Object.values(PROVIDERS).map((p) => ({
			name: p.name,
			configured: providerConfigured(p),
			circuitOpen: isOpen(p.name),
		})),
	};
}

module.exports = { chat, chatDetailed, chatRaw, isAiConfigured, getAiHealth, TIER, AiError };
