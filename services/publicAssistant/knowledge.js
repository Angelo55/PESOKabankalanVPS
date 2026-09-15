/**
 * publicAssistant/knowledge — the PUBLIC "Visitor Guidance Layer" knowledge + guardrails.
 *
 * PURE module (no db, no network) so it can be unit-tested directly (unlike publicData.js,
 * which requires ../db and would connect to prod TiDB on require, §13). It holds:
 *   - OFFICE  : the office facts (source of truth = LandingPage.jsx §46 — keep in lockstep)
 *   - NAV     : the allowlisted Landing-Page navigation targets the assistant may suggest
 *   - SYSTEM_PROMPT : the public system prompt (anonymous visitors; inform/guide/navigate/
 *                     assist/escalate; NEVER invent; dynamic facts come from TOOLS)
 *   - TOOL_SCHEMAS  : the DeepSeek/OpenAI function schema the model may call (public data only)
 *   - LIMITS + sanitizeMessages() : conversation caps + input hardening for an UNAUTH endpoint
 *   - FALLBACK_REPLY : the graceful degrade text when the AI is unavailable (never fabricated)
 *
 * This assistant is SEPARATE from the authenticated Job-Seeker chatbot (routes/chatbotRoutes.js):
 * its own prompt, its own tools, no `chathistory`, no per-user data. See
 * docs/public-visitor-chatbot-proposal.md.
 */

// Office facts — mirror components/LandingPage.jsx (the single source of truth, §46).
const OFFICE = Object.freeze({
    name: 'Public Employment Service Office (PESO) — Kabankalan City',
    address: 'J.Y. Perez Highway, Brgy. Talubangi (2nd Floor), Kabankalan City, Negros Occidental 6111',
    hours: 'Monday – Friday, 8:00 AM – 5:00 PM',
    facebook: 'https://www.facebook.com/profile.php?id=100085082224847',
    directions: 'https://www.google.com/maps/dir/?api=1&destination=10.008007,122.803436',
});

// Allowlisted navigation targets the assistant may hand the frontend (Phase C turns these
// into buttons). Anything not in this map is ignored — the model cannot invent a route.
const NAV = Object.freeze({
    '#jobs': 'Browse the Job Board',
    '#events': 'See Events & Job Fairs',
    '#faq': 'Read Common Questions',
    '#location': 'Find the PESO office',
    register: 'Create an account',
    signin: 'Sign in',
});

const LIMITS = Object.freeze({
    MAX_TURNS: 12,       // client-supplied messages kept per request
    MAX_MSG_CHARS: 500,  // per message
    MAX_TOOL_ROUNDS: 3,  // bounded tool-call loop (cost cap)
});

const SYSTEM_PROMPT = `You are the "PESO Kabankalan Assistant" — the friendly PUBLIC guide on the Landing Page of the Public Employment Service Office (PESO) of Kabankalan City. You help ANONYMOUS VISITORS and prospective job seekers who are NOT signed in.

YOUR JOB (a Visitor Guidance Layer): INFORM, GUIDE, NAVIGATE, ASSIST, and ESCALATE. You are not a general-purpose AI. Answer routine questions about PESO and this platform, then point people to the right place.

TONE: warm, encouraging, concise. Many visitors are first-time job seekers — be reassuring. Prefer short steps over long paragraphs.

WHAT PESO KABANKALAN IS:
The official digital employment portal of the PESO of Kabankalan City. It connects job seekers with local employers, uses AI to estimate how well a résumé matches a vacancy's stated requirements, and lets PESO refer strong candidates to employers.

WHAT YOU CAN EXPLAIN (public, general guidance):
- Registration/Sign-in: visitors create a free Job Seeker account (or sign in) to apply. Suggest the Register / Sign-in action.
- Completing the profile (REQUIRED before applying): full name, phone, location, gender, date of birth, educational attainment, AND a résumé on file. A short onboarding step collects these after first login.
- Applying: browse the Job Board, open a vacancy, and use the 3-step Apply Wizard (Personal Info → Résumé → Additional Questions). On submit, the system runs a real AI compatibility analysis against the job's stated requirements.
- Requirements: each vacancy lists its own requirements (education, experience, skills). The AI score reflects ONLY the employer's stated requirements. A complete, detailed résumé matters.
- Résumé: seekers can build one in the in-app Document Builder (PDF or Word) or upload a PDF/DOCX.
- Referrals: when PESO endorses a seeker for a vacancy it becomes a referral; the seeker may need to ACCEPT it, then PESO issues an official referral letter with a reference number, and later records an outcome (e.g. Hired).
- Walk-in job seekers: people can also visit the PESO office in person; office staff can help register them.
- Events & Job Fairs, Saved Vacancies, and in-platform Messages/Notifications exist for signed-in users.

ALWAYS WRITE A REAL, SUBSTANTIVE TEXT ANSWER. Never reply with only "I added a button" — a button is a SUPPLEMENT to an answer, never a replacement. Answer the question in your own words first.

HOW TO ANSWER ABOUT DYNAMIC THINGS (vacancies, job categories, events, platform stats, office contact): you MUST CALL A TOOL and answer from its result. NEVER state a specific vacancy, count, category, or event from memory. If a tool returns nothing, say so plainly and offer the office contact — do not invent. Specifically:
- "What jobs are available?" / a role / a place → CALL search_vacancies, then LIST 2–3 results in your reply as "Title — Company (location)". If none, say there are none matching right now.
- "What kinds of jobs?" → CALL get_vacancy_categories and name a few categories.
- Events / job fairs → CALL get_upcoming_events and list them (or say none upcoming).
- Where is the office / how to contact PESO → CALL get_office_contact and STATE the address, the opening hours, and the "Message Us" Facebook link in your reply.
- "What is PESO?" → explain it in 1–2 sentences (no tool needed).

NAVIGATION: you do NOT control buttons — the page automatically shows relevant shortcuts (Job Board, Events, office location, Register/Sign-in) beneath your reply based on the topic. So never say "I added a button"; just give the answer, and you may mention e.g. "you can browse the Job Board below" in words.

STRICT GUARDRAILS:
- You serve UNAUTHENTICATED visitors. You cannot access anyone's account, application status, match score, or referral — say so and guide them to sign in and look for themselves.
- NEVER invent vacancies, requirements, policies, schedules, salaries, contact details, or outcomes. Distinguish factual system data (from a tool, described as current) from general guidance.
- Make no promises or decisions ("you will be hired/referred/approved"). PESO staff decide referrals.
- For account-specific help, complaints, verification, unusual cases, or anything you cannot confidently source from a tool: ESCALATE — share the office contact ("Message Us" on Facebook) and office location/hours (call get_office_contact), and suggest signing in for account matters.
- If asked something outside PESO or job-seeking, gently redirect to how you can help.

OUTPUT: write your reply in ENGLISH only. A downstream service translates it to the visitor's language. Keep feature names, "referral", "AI compatibility", "Job Board", and reference-number formats exactly as written.`;

// DeepSeek/OpenAI function schema. Every tool is READ-ONLY and PUBLIC (see publicData.js).
const TOOL_SCHEMAS = Object.freeze([
    {
        type: 'function',
        function: {
            name: 'search_vacancies',
            description: 'Search CURRENT public PESO vacancies. Use for "what jobs are available", a role, a place, or a category. Returns up to a few live postings with a link.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Free-text role/skill/company, e.g. "driver", "encoder".' },
                    category: { type: 'string', description: 'A job category name (see get_vacancy_categories).' },
                    location: { type: 'string', description: 'A place, e.g. "Kabankalan".' },
                    limit: { type: 'integer', description: 'Max results (1–5).' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_vacancy_categories',
            description: 'List the job categories that currently have open vacancies, with counts. Use for "what kinds of jobs are there".',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_platform_stats',
            description: 'Current public PESO figures: open opportunities, successful hires, active local employers, referral letters issued.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_upcoming_events',
            description: 'List upcoming PESO events / job fairs / announcements. Use for "any events" or "job fair".',
            parameters: {
                type: 'object',
                properties: { limit: { type: 'integer', description: 'Max results (1–5).' } },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_office_contact',
            description: 'The PESO Kabankalan office address, opening hours, and "Message Us" Facebook contact. Use for "where is the office", "how do I contact PESO", or when escalating to a human.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
]);

const FALLBACK_REPLY = "I'm sorry — I can't reach my assistant service right now. You can browse the Job Board and Common Questions on this page, or contact the PESO Kabankalan office directly: message us on Facebook (PESO Kabankalan) or visit " + OFFICE.address + ' (' + OFFICE.hours + ').';

/**
 * Harden + cap the client-supplied conversation for an UNAUTHENTICATED endpoint.
 * - keeps only the last MAX_TURNS messages,
 * - accepts only role 'user' | 'assistant' (the SERVER always owns the system message — a
 *   client cannot inject/override the system prompt or spoof 'tool'/'system' roles),
 * - coerces content to a trimmed string capped at MAX_MSG_CHARS,
 * - drops empty messages.
 * Returns a clean array (possibly empty). Never throws.
 */
function sanitizeMessages(raw) {
    if (!Array.isArray(raw)) return [];
    // Bound the work BEFORE iterating: an unauth caller could POST a huge array. We only
    // ever keep the last MAX_TURNS, so cap the scan to a small multiple of that.
    const bounded = raw.length > 100 ? raw.slice(-100) : raw;
    const cleaned = [];
    for (const m of bounded) {
        if (!m || typeof m !== 'object') continue;
        const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
        if (!role) continue; // ignore system/tool/unknown roles from the client
        const content = String(m.content ?? '').trim().slice(0, LIMITS.MAX_MSG_CHARS);
        if (!content) continue;
        cleaned.push({ role, content });
    }
    return cleaned.slice(-LIMITS.MAX_TURNS);
}

/**
 * Derive up to 2 navigation buttons DETERMINISTICALLY — from which DATA tools the model
 * actually ran plus a light keyword scan of the visitor's latest message. Navigation is
 * NOT a model tool (the model kept choosing a nav tool over answering); instead the model
 * focuses on INFORMING via the data tools, and the frontend still gets sensible shortcuts.
 * Pure + allowlisted (only NAV targets); never throws.
 *
 * @param {string[]} toolsUsed  names of tools the model called this turn
 * @param {string}   userText   the visitor's latest message
 * @returns {Array<{type:'navigate', target:string, label:string}>}
 */
function deriveActions(toolsUsed = [], userText = '') {
    const used = Array.isArray(toolsUsed) ? toolsUsed : [];
    const t = String(userText || '').toLowerCase();
    const out = [];
    const add = (target) => {
        if (NAV[target] && out.length < 2 && !out.some((a) => a.target === target)) {
            out.push({ type: 'navigate', target, label: NAV[target] });
        }
    };
    // Data-driven first (most relevant), then intent keywords. Leading \b only — several
    // are prefixes (vacanc*, regist*) so a trailing \b would wrongly reject "vacancy"/"register".
    if (used.includes('search_vacancies') || used.includes('get_vacancy_categories') || /\b(jobs?|vacanc|hiring|work|position|role|career|opening)/.test(t)) add('#jobs');
    if (used.includes('get_upcoming_events') || /\b(events?|job fair|fair|seminar|announcement)/.test(t)) add('#events');
    if (used.includes('get_office_contact') || /\b(office|address|contact|located|location|visit|directions|where)/.test(t)) add('#location');
    if (/\b(regist|sign ?up|create an? account|how.*apply|get started)/.test(t)) add('register');
    if (/\b(sign ?in|log ?in|log ?on|my account)/.test(t)) add('signin');
    return out.slice(0, 2);
}

module.exports = { OFFICE, NAV, LIMITS, SYSTEM_PROMPT, TOOL_SCHEMAS, FALLBACK_REPLY, sanitizeMessages, deriveActions };
