/**
 * PUBLIC VISITOR-SUPPORT ASSISTANT — the ONLY chatbot route with no auth.
 *
 * Serves anonymous Landing-Page visitors (docs/public-visitor-chatbot-proposal.md). It is
 * SEPARATE from the authenticated Job-Seeker chatbot (routes/chatbotRoutes.js): its own
 * public system prompt + tool allowlist, NO `chathistory`, NO per-user data, stricter
 * IP rate limits, and a graceful (never fabricated) fallback.
 *
 * Flow: sanitize the client-supplied conversation → prepend the SERVER-owned public system
 * prompt → run a BOUNDED DeepSeek tool-calling loop (public read-only tools only) → localize
 * → return { reply, actions }. Conversation state is client-managed (stateless server): no
 * anonymous chat is persisted, so there is no anonymous PII at rest.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const aiClient = require('../services/aiClient');
const { translateResponse } = require('../services/aiTranslate');
const { SYSTEM_PROMPT, TOOL_SCHEMAS, LIMITS, FALLBACK_REPLY, sanitizeMessages, deriveActions } = require('../services/publicAssistant/knowledge');
const { runTool } = require('../services/publicAssistant/publicData');

const router = express.Router();

// Per-visitor throttling. `req.ip` is the real client IP because server.js sets
// `trust proxy` (one hop, Render), so the default keyGenerator keys per-visitor — no custom
// X-Forwarded-For parsing needed and express-rate-limit's proxy validators are satisfied.
const tooMany = { status: 'error', reply: "You've asked a lot in a short time. Please wait a few minutes, or contact the PESO office directly." };

const burstLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: tooMany });
const dailyLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 60, message: tooMany });

const safeArgs = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

router.post('/query', burstLimiter, dailyLimiter, async (req, res) => {
    const { messages: clientMessages, language } = req.body || {};
    // Clamp the client language to a short code token — it is interpolated into the shared
    // translation prompt, so an unauth caller must not be able to smuggle free text through it.
    const lang = typeof language === 'string' ? language.trim().slice(0, 8).replace(/[^a-zA-Z-]/g, '') || undefined : undefined;
    const history = sanitizeMessages(clientMessages);
    if (!history.length) {
        return res.status(400).json({ status: 'error', reply: 'Please type a question.' });
    }

    // AI down / unconfigured → graceful, non-fabricated fallback (still HTTP 200 so the widget
    // shows it as a normal message rather than an error state).
    if (!aiClient.isAiConfigured()) {
        return res.status(200).json({ status: 'degraded', reply: FALLBACK_REPLY, actions: [] });
    }

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
    const toolsUsed = [];    // which DATA tools the model called → drives derived navigation
    let reply = null;

    try {
        for (let round = 0; round < LIMITS.MAX_TOOL_ROUNDS; round += 1) {
            const { message } = await aiClient.chatRaw({
                messages,
                temperature: 0.4,
                tier: aiClient.TIER.CHAT,
                prefer: 'deepseek',
                extra: { tools: TOOL_SCHEMAS, tool_choice: 'auto' },
            });
            messages.push(message);

            const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
            if (!calls.length) { reply = message.content; break; }

            for (const call of calls) {
                const name = call.function?.name;
                toolsUsed.push(name);
                const result = await runTool(name, safeArgs(call.function?.arguments));
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            }
        }

        // Bounded out with tool calls still pending → force ONE final text answer (no tools).
        if (!reply) {
            reply = await aiClient.chat({ messages, temperature: 0.4, tier: aiClient.TIER.CHAT, prefer: 'deepseek' });
        }

        // Navigation buttons are derived HERE (deterministically), not chosen by the model.
        const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
        const actions = deriveActions(toolsUsed, lastUser);

        const localized = await translateResponse(String(reply || '').trim() || FALLBACK_REPLY, lang);
        // Counts-only logging (NO message bodies stored) — abuse/health signal for a public endpoint.
        console.log(`[publicAssistant] ok — turns=${history.length} tools=${toolsUsed.length} actions=${actions.length}`);
        return res.status(200).json({ status: 'success', reply: localized, actions });
    } catch (error) {
        console.error(`[publicAssistant] failed: ${error.message}`);
        return res.status(200).json({ status: 'degraded', reply: FALLBACK_REPLY, actions: [] });
    }
});

module.exports = router;
