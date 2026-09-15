/**
 * SHARED RATE LIMITERS — the ONE place per-category abuse limits are defined, so the
 * numbers are consistent across entry points and tunable by ops WITHOUT a code deploy
 * (every limit reads an env override, falling back to a sane default).
 *
 * WHY A SHARED MODULE: limiters were previously declared ad-hoc inside a handful of route
 * files (auth, chatbot, public-assistant, the three AI builders) and the highest-cost
 * endpoints — apply, /jobs/match, résumé analysis — had NONE. This centralizes the policy:
 *   - a GLOBAL backstop on the whole /api surface (so an unlisted endpoint is still bounded), and
 *   - tight per-category limiters on the expensive ones (AI/DeepSeek cost, apply, uploads/writes).
 *
 * KEYING: server.js sets `trust proxy` (one hop, Render), so express-rate-limit's default
 * keyGenerator keys on the REAL client IP — per-visitor, not one global bucket. No custom
 * X-Forwarded-For parsing (which its validators warn about) is needed.
 *
 * HEADERS: `standardHeaders` surfaces the RateLimit-* response headers so the frontend can
 * read remaining/retry and show friendly feedback instead of a bare 429.
 */
const rateLimit = require('express-rate-limit');

// Consistent JSON error body. `key` is 'message' for most routes; chatbot/assistant routes
// render `reply`, so those keep their own inline limiters with the reply-shaped message.
const body = (message) => ({ status: 'error', message });

const num = (env, def) => Number(process.env[env]) || def;

const make = ({ windowMs, max, message, skip }) =>
    rateLimit({ windowMs, max, message: body(message), standardHeaders: true, legacyHeaders: false, ...(skip ? { skip } : {}) });

// App-wide backstop for EVERY /api entry point (incl. those without a tighter limiter below).
// Generous so normal use — a dashboard firing several requests on load, 45–90s polls — never
// trips it; it exists to stop a bot hammering an endpoint we didn't individually cap. Health
// checks and CORS preflight are exempt so uptime pings / OPTIONS never consume the budget.
const globalLimiter = make({
    windowMs: num('RL_GLOBAL_WINDOW_MS', 60 * 1000),
    max: num('RL_GLOBAL_MAX', 300),
    message: 'Too many requests. Please slow down and try again shortly.',
    skip: (req) => req.method === 'OPTIONS' || req.path === '/api/health' || req.path === '/health',
});

// Expensive AI calls (DeepSeek cost): compatibility scoring, résumé analysis, profile insights.
// A misbehaving client or a script re-opening job panels can otherwise bill real money.
const aiLimiter = make({
    windowMs: num('RL_AI_WINDOW_MS', 15 * 60 * 1000),
    max: num('RL_AI_MAX', 40),
    message: 'AI capacity reached for now. Please wait a few minutes and try again.',
});

// Applying to a vacancy: résumé snapshot + AI score + referral staging + notifications — one of
// the heaviest write paths. Bounds accidental double-submits and automated application floods.
const applyLimiter = make({
    windowMs: num('RL_APPLY_WINDOW_MS', 60 * 60 * 1000),
    max: num('RL_APPLY_MAX', 25),
    message: 'You have submitted many applications in a short time. Please try again later.',
});

// Uploads / row-creating writes that hit storage or the DB (avatars, starting conversations).
const writeLimiter = make({
    windowMs: num('RL_WRITE_WINDOW_MS', 5 * 60 * 1000),
    max: num('RL_WRITE_MAX', 60),
    message: 'Too many requests in a short time. Please slow down.',
});

module.exports = { globalLimiter, aiLimiter, applyLimiter, writeLimiter, make, body };
