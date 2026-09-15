# Public Visitor Support Chatbot — Landing Page AI Assistant (Proposal)

Status: **SHIPPED — all phases A–E complete (2026-09). Detail: dev-history §50.**
Commits: A `f2ba673`, B `1901f96` (+ answer-quality fix `8d5c634`), C `fbcfdea`, D `4fe0b4b`, E (docs).
Follow-up DONE (dev-history §50.1): app-wide Express `trust proxy` set → all rate limiters key per-client; `loginLimiter` 5→15; public route uses the default keyGenerator.
Author grounding: read against the LIVE code 2026-09 (`routes/chatbotRoutes.js`,
`services/aiClient.js`, `routes/jobBoardRoutes.js`, `routes/eventRoutes.js`, `server.js`,
`components/LandingPage.jsx`).

**Confirmed defaults (§10):** route `/api/public-assistant`; rate limits 20 msgs/15min/IP + 60/day/IP,
≤500 chars, ≤12 turns, ≤3 tool rounds; **counts-only logging (no message bodies stored)**; reuse the
DeepL + dialect translation layer; launcher on the **Landing Page only**; `TIER.CHAT` (deepseek-chat,
prefer `deepseek`) for tool calling, `DRAFT` for translation.

---

## 0. Answer to the precise question

**Yes.** We can add a dedicated **Public AI Assistant / Visitor Support Chatbot** to the Landing
Page, powered through the existing DeepSeek infrastructure (`services/aiClient.js`) but **separate
from the authenticated Job-Seeker chatbot**, with a public-safe knowledge layer, controlled
tool/function calls for dynamic vacancy/event lookups, Landing-Page navigation actions, a premium
UI matching the landing palette, IP-based rate limiting, hard privacy boundaries, and human
handoff to the existing "Message Us" channel. It exposes **zero** authenticated data because the
public route runs with **no auth context and no access to any per-user table**.

The design reuses the shared DeepSeek client, the provider-failover/circuit-breaker, and the UI
animation language — while giving the public assistant its **own route, own system prompt, own
tool allowlist, and own rate limits**. The existing authenticated chatbot is **untouched**.

---

## 1. Architecture reality-check (what exists, what must NOT change)

| Concern | Current reality (verified) | Consequence for this feature |
|---|---|---|
| Authed chatbot | `routes/chatbotRoutes.js` — `router.use(requireAuth)` gates the WHOLE router; `/query` writes per-user `chathistory` (keyed by `user_id`), rate-limited 30/15min; job-seeker `SYSTEM_PROMPT` | **Do NOT touch it.** The public assistant is a SEPARATE router. It must NEVER write `chathistory` (that table is user-keyed) or reuse the authed prompt. |
| AI client | `aiClient.chat({messages,temperature,tier,prefer,extra})` returns `message.content` only; `extra` is passed through to the provider body (already used for `response_format`) | Tool-calling needs `message.tool_calls`, which `chat()` drops. Add ONE new method (`chatRaw`/`chatWithTools`) that returns the full assistant message. Everything else reused. |
| DeepSeek tool calling | `deepseek-chat` supports OpenAI-style `tools` + `tool_choice`; both providers accept passthrough body params | Feasible today via `extra:{tools,tool_choice}` once the client returns `tool_calls`. |
| Public data | `GET /api/job-board` (list+filters), `/stats`, `/categories`, `/:id`, `/:id/questions`, `GET /api/events`, `/api/events/:id` are ALL public (no `requireAuth`) | The tools wrap these EXISTING public repositories server-side — no new data exposure, no raw DB/tool access for the model. |
| Landing palette | `LandingPage.jsx` is deliberately EXCLUDED from the app design tokens (§24/§45) — bespoke marketing palette (greens `#003631`/`#1a4a38`, `#f8f9ff` grounds) | The public chatbot matches the LANDING palette, NOT `bg-surface`/`text-content` tokens. It is self-contained light, like the rest of the landing. |
| Reusable UI | `components/layout/dropdownMotion.js` (fade+slide language, §47), `hooks/useFocusTrap.js` (§35.5), the authed `Chatbot.jsx` message/typing primitives | Reuse the ANIMATION LANGUAGE + focus-trap; the public panel is a NEW component (different palette, quick actions, no auth/history). |
| Contact channel | The single landing contact channel is "Message Us" → office Facebook (§46); office info is static LandingPage content | Human handoff routes to "Message Us" + office info. No new contact form (§46 removed it deliberately). |

**Invariant this feature must honor (SKILL 0.x + §46 + privacy):** an unauthenticated surface may
read only public data; it must never fabricate vacancies/policies/requirements; dynamic facts come
from the source of truth via a fixed tool allowlist; the DeepSeek key stays server-side.

---

## 2. Separation model — two assistants, one engine

```
                    ┌─────────────────────────────┐
                    │   services/aiClient.js       │  (SHARED: failover + breaker)
                    │   + NEW chatRaw() for tools  │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │                                                        │
┌───────────────────────────┐                    ┌────────────────────────────────┐
│ AUTHED  /api/chatbot       │                    │ PUBLIC  /api/public-assistant  │ ← NEW
│ (UNCHANGED)                │                    │ • NO requireAuth               │
│ • requireAuth              │                    │ • public SYSTEM_PROMPT         │
│ • chathistory (user_id)    │                    │ • tool allowlist (public data) │
│ • job-seeker prompt        │                    │ • IP rate-limit (stricter)     │
│ • Chatbot.jsx (AppLayout)  │                    │ • NO chathistory / no user data│
└───────────────────────────┘                    │ • PublicChatbot.jsx (Landing)  │
                                                  └────────────────────────────────┘
```

The two never share a route, a prompt, a history store, or a rate-limit bucket. They share only
the stateless DeepSeek client and the UI animation constants.

---

## 3. Backend — new public route + tool-calling loop

**New file `routes/publicAssistantRoutes.js`**, mounted `app.use('/api/public-assistant', …)` in
`server.js`. No `requireAuth` anywhere in it.

**`POST /api/public-assistant/query`** (public, IP rate-limited):
- Body: `{ messages: [{role,content}], language? }` — **client-managed conversation** (stateless
  server, matching DeepSeek's stateless Responses model; no DB persistence of anonymous chats →
  no anonymous PII stored). Server validates + caps (see §6).
- Flow (the tool loop):
  1. Prepend the **public SYSTEM_PROMPT** (§4) + inject a compact live snapshot? No — dynamic
     facts come via TOOLS, not prompt injection, so the model must *call* a tool to state a fact.
  2. `aiClient.chatRaw({ messages, tier: CHAT, prefer:'deepseek', extra:{ tools, tool_choice:'auto' } })`.
  3. If the model returns `tool_calls`: execute each against the **tool allowlist** (§5), append
     the `tool` results, and call the model again (bounded to **max 3 tool rounds** to cap cost).
  4. Return the final assistant text → optional DeepL/AI translation (reuse the existing
     `translateResponse` pattern from `chatbotRoutes.js`, extracted to a shared helper).
- Degrade: if `aiClient` is unavailable → a graceful canned reply pointing to the FAQ + "Message Us"
  (never a fabricated answer; preserves invariant 0.2).

**`services/aiClient.js` addition:** `chatRaw(opts)` → returns `{ message, provider, model }` where
`message` is the full assistant message (`content` + `tool_calls`). `chat()`/`chatDetailed()` stay
exactly as they are (every existing caller unchanged). One small, additive method.

**New `services/publicAssistant/` module:** the public `SYSTEM_PROMPT`, the `tools` JSON schema,
and the tool dispatcher (`runTool(name,args)` → allowlist switch). Keeps the route thin.

---

## 4. Public SYSTEM_PROMPT — the Visitor Guidance Layer

A NEW prompt (not the authed one). Framing: **inform, guide, navigate, assist, escalate — never
invent.** It contains only PUBLIC, stable marketing facts (what PESO is, the seeker journey,
registration/apply steps, requirements overview, résumé/referral/walk-in explanations, office
location + hours + "Message Us", the Landing section anchors). It explicitly:
- states it serves **anonymous visitors** and cannot access anyone's account/records;
- must **call a tool** for anything dynamic (vacancies, events) rather than stating counts/titles
  from memory;
- distinguishes **factual system data** (from tools, quoted as current) vs **general guidance**;
- escalates to **"Message Us" + office info** for staff-judgment/account/complaint cases;
- outputs English; the existing translation layer localizes (Filipino/Cebuano/Hiligaynon/etc.).

Office/FAQ/contact facts are stable public content → embedded in the prompt, with the LandingPage
as the single source of truth (keep them in lockstep, like the authed prompt rule §48).

---

## 5. Tools (allowlist) — controlled, public-only

Each tool wraps an EXISTING public endpoint/repository; the model can call ONLY these. No tool
takes a user id, touches an auth table, or accepts free SQL.

| Tool | Wraps | Returns (public) |
|---|---|---|
| `search_vacancies({ keyword?, category?, location?, limit≤5 })` | `jobBoardRepository` behind `GET /api/job-board` | title, company, location, category, salary text, `/job-board?job=<id>` deep link |
| `get_vacancy_categories()` | `GET /api/job-board/categories` | category list (for "what kinds of jobs?") |
| `get_platform_stats()` | `GET /api/job-board/stats` | opportunities, hires, employers (the landing figures) |
| `get_upcoming_events({ limit≤5 })` | `eventRepository.listPublished({scope:'upcoming'})` | event title, date, venue, `#events` anchor |
| `get_office_contact()` | static public office info | address, hours, Facebook "Message Us" |
| `suggest_navigation({ target })` | n/a (returns a Landing anchor / auth-modal intent) | `#jobs` / `#faq` / `#location` / open Register / open Sign-In |

Tool results are returned to the model as data; the model phrases them. The **frontend** turns a
`suggest_navigation` result (or a link in the reply) into an actual scroll/anchor or auth-modal
open (§7). Vacancy links use the existing `/job-board?job=<id>` deep-link (§23).

---

## 6. Privacy, rate limiting, abuse (unauthenticated-appropriate)

- **Privacy:** the route has no auth context → structurally cannot read user records. Tools expose
  only public data. **No `chathistory`/DB persistence** of anonymous conversations (no anonymous
  PII at rest). Never echo IPs or internal ids to the model.
- **Rate limiting:** a dedicated `express-rate-limit` keyed by **IP** (not user), stricter than the
  authed 30/15min — proposed **20 messages / 15 min / IP** (§10 to confirm), plus a soft
  **60/day/IP** cap. Message length cap (**≤ 500 chars**), conversation cap (**≤ 12 turns** sent
  back), tool-round cap (**≤ 3**). Reject oversize/empty/malformed with a friendly message.
- **Abuse:** input validation (type/length), strip control chars, cap `messages` array length,
  ignore/za role-spoof attempts (server always sets the system message). Optional lightweight
  logging of counts (not content) for monitoring — **no message bodies stored** unless you later
  want a moderation log (§10).
- **Guardrails in-prompt:** no fabricated vacancies/policies/requirements/schedules/contacts; if a
  tool returns nothing, say so plainly + offer "Message Us"; no promises/decisions ("you will be
  hired/referred"); redirect off-topic requests.

---

## 7. Frontend — `PublicChatbot.jsx` (Landing-native, premium)

New component mounted in `LandingPage.jsx` only (never in `AppLayout`). Matches the **landing
palette**, reuses the **animation language** (`dropdownMotion.js`) + `useFocusTrap`.

- **Floating launcher:** compact FAB bottom-right, brand-green, subtle open/close transition
  (fade+slide+scale, `origin-bottom-right`), reduced-motion aware; `inert` when the panel is closed.
- **Chat panel:** responsive (full-width sheet on mobile, ~380px card on desktop), header with
  title + reset + close; message list with **fade/slide-in** bubbles, **auto-scroll**, **typing
  indicator**, **disabled input while processing**; footer input + send.
- **Greeting + quick actions (chips):** the exact entry points requested — "How do I register?",
  "How do I apply for a job?", "What are the requirements?", "What is PESO?", "Where is the PESO
  office?", "What jobs are available?", "How can I contact PESO?", "I need help with my account."
  Chips seed the input/send.
- **Navigation actions:** replies can include a "Take me there" affordance that scrolls to the
  Landing anchor (`#jobs`/`#faq`/`#location`) or opens the existing auth modal (Register/Sign-In) —
  reusing `LandingPage`'s existing `setAuthMode`/anchor scrolling, no new routing.
- **Reset / graceful fallback:** clear-conversation button; on backend error, a friendly inline
  message + "Message Us" link (never a blank failure).
- **A11y:** focus trap + restore, `role="dialog"` + labelledby, Escape closes, keyboard-navigable
  chips, `aria-live="polite"` on the message stream, visible focus rings.

State is client-side only (React state; optional `sessionStorage` draft). No token, no auth.

---

## 8. Human handoff

The assistant answers routine questions first; it escalates to a human when the request needs
staff judgment (account-specific help, complaints, verification, anything it can't confidently
source from a tool). Escalation = surface **"Message Us"** (office Facebook, the §46 single contact
channel) + office location/hours via `get_office_contact`, and — for account help — guide to
Register/Sign-In. It never promises a human will reply within a timeframe.

---

## 9. Phased build plan (proposal-first, then A→E on approval)

- **Phase A — shared plumbing.** Add `aiClient.chatRaw()` (full message incl. `tool_calls`);
  extract `translateResponse` into a shared `services/aiTranslate.js` reused by both chatbots. No
  behavior change to the authed chatbot. Tests for `chatRaw` shape + tool-round cap.
- **Phase B — public route + prompt + tools (no UI).** `routes/publicAssistantRoutes.js` +
  `services/publicAssistant/` (prompt, tool schema, dispatcher wrapping the public endpoints) +
  IP rate-limit + validation. Verify via curl (public, unauth): FAQ answer, a `search_vacancies`
  tool round, a graceful fallback. `npm test` for the dispatcher + guards.
- **Phase C — Landing UI.** `PublicChatbot.jsx` (launcher + panel + quick actions + typing/auto-
  scroll/disabled states + a11y), wired to `/api/public-assistant/query`, matching the landing
  palette + animation language. Navigation actions hook into existing anchors/auth modal.
- **Phase D — hardening.** Conversation/tool caps end-to-end, reduced-motion + mobile sheet,
  degrade paths, optional counts-only monitoring, final privacy pass (no user data reachable).
- **Phase E — docs.** Dev-history §N, SKILL still-live rule ("PUBLIC assistant is separate from the
  authed chatbot; public-safe tools only; never touch `chathistory`"), this doc → "SHIPPED".

Build order strictly A→E; each phase verifiable before the next.

---

## 10. Decisions to confirm before I build

1. **Route name:** `/api/public-assistant` (proposed) vs `/api/assistant` vs `/api/chatbot/public`.
2. **Rate limits:** 20 msgs/15min/IP + 60/day/IP; msg ≤500 chars; ≤12 turns; ≤3 tool rounds — OK?
3. **Anonymous logging:** counts-only (no message bodies) [recommended] vs a moderation log that
   stores message text (adds an anonymous-PII table + retention policy) vs nothing.
4. **Vacancy tool depth:** return up to 5 matches with deep links [recommended] — cap value?
5. **Translation:** reuse the DeepL + AI-dialect layer for the public bot too (Filipino/Cebuano/
   Hiligaynon)? [recommended yes]
6. **Launcher scope:** Landing Page only [recommended], or also the public Job Board / auth pages?
7. **Model tier:** `TIER.CHAT` (deepseek-chat, prefer `deepseek`) for tool calling [recommended],
   translation on `DRAFT` as today.

---

## 11. What stays untouched (regression fence)

- `routes/chatbotRoutes.js`, the authed `SYSTEM_PROMPT`, `chathistory`, `Chatbot.jsx` — unchanged.
- `aiClient.chat()/chatDetailed()` signatures + every existing caller — unchanged (only an additive
  `chatRaw`).
- The §46 landing contact model ("Message Us" only; no new contact form).
- The LandingPage bespoke-palette exclusion from app tokens (§24) — the public bot follows it.
- No new public data exposure beyond what `GET /api/job-board*` and `GET /api/events*` already serve.
