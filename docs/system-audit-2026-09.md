# System Audit — Abuse-Protection, Reliability & Legal/Compliance (2026-09)

**Method:** verify-before-change. Every item below was audited against the live code first; existing
compliant implementations were retained, and only confirmed gaps were changed. Nothing working was
rewritten. `npm test` 192/192, frontend build clean after the changes.

**Legend:** ✅ already compliant (verified) · 🔧 gap fixed this pass · 📋 recommendation / owner decision.

---

## Part A — Requests, usage & abuse protection

### A.1 What was already correct (verified, unchanged)
- ✅ **AI client** (`services/aiClient.js`): 20s per-call **timeout**, **circuit breaker** (3 failures → 60s
  cooldown), single-pass **provider failover** (openrouter→deepseek). No runaway retry loop — each provider
  is tried at most once per request. Env-tunable (`AI_TIMEOUT_MS`, `AI_BREAKER_*`).
- ✅ **Background workers** (7-worker outbox, `startWorkers.js`): each job has a **`max_attempts` dead-letter
  cap**, **exponential backoff capped at 1h**, a **per-tick batch cap** (`BATCH_SIZE` 5), and a clean
  `stopAllWorkers()` on SIGINT/SIGTERM. Failures dead-letter to Failed Referrals + notify an admin. No
  unbounded execution.
- ✅ **Existing rate limits:** auth (login 15/15m, reset 3/1h, registration 5/1h, OTP send 10/1h, verify
  30/15m, claim 20/15m), authed chatbot (30/15m), public assistant (burst 20/15m + 60/day), AI builders
  (résumé/cover-letter/resignation 20/1h, PDF 10/1h). `trust proxy=1` so all key on the real client IP.
- ✅ **Public assistant tool loop** bounded (`MAX_TOOL_ROUNDS` 3, message caps, `sanitizeMessages`).
- ✅ **Import** has per-user caps (2MB / 500 rows / 5-per-day / 1000 total) in `importService`.
- ✅ **Caches** in front of hot AI/stat paths (`matchScoreCache`, similar-jobs TTL, stats TTL).

### A.2 Gaps fixed this pass
- 🔧 **No app-wide security headers** → added `helmet()` in `server.js` (CSP off — this process serves JSON +
  public `/uploads`, not the app HTML which Vercel owns; `crossOriginResourcePolicy: cross-origin` so the
  Vercel frontend can still load `/uploads` images).
- 🔧 **No global rate-limit backstop** → added a shared `middleware/rateLimiters.js` and mounted
  `globalLimiter` on the whole `/api` surface (default 300/min/IP, health + preflight exempt), so **no
  endpoint is unbounded** even if it lacks a tighter limiter.
- 🔧 **Top AI-cost / heavy endpoints were unprotected** → attached tight per-category limiters:
  - `POST /applications` (apply: snapshot + AI score + referral staging + notify) → **applyLimiter** (25/hr).
  - `POST /jobs/match` (AI compatibility, fires on every job-panel open) → **aiLimiter** (40/15m).
  - `POST /profile/upload`, `/profile/insights/generate`, `/profile/match` (all hit DeepSeek) → **aiLimiter**.
  - `POST /profile/avatar` (image upload) and `POST /messages/conversations` (row-creating write) →
    **writeLimiter** (60/5m).
  - Every limit is **env-overridable** (`RL_*`) so ops can tune without a deploy; `standardHeaders` on, so
    the client receives `RateLimit-*` for friendly feedback.
- 🔧 **Frontend requests had no timeout** → `api.js` axios instance now has a **60s default timeout**
  (`VITE_API_TIMEOUT_MS` override), so a stalled request rejects instead of spinning; components already
  handle a rejected promise.

### A.3 Remaining recommendations (owner decision — not changed)
- 📋 **Body-size limit is a blanket `50mb`** on `express.json`/`urlencoded`. The largest legitimate payload
  is a ~3MB base64 event banner, so 50mb is a generous DoS surface. Reducing to ~12–15mb globally (with the
  known upload routes verified) would tighten it, but needs a payload-size audit first to avoid breaking any
  upload — left as a deliberate, tested follow-up rather than a blind change.
- 📋 **Socket.IO message sending** (real-time half of chat) is not express-rate-limited (it's not HTTP).
  Consider a per-socket send throttle in `socketServer.js` if chat spam becomes a concern.
- 📋 **Frontend double-submit**: most forms already gate on a `saving`/`loading` state; a quick sweep to
  confirm every mutating button disables on submit would close the last accidental-double-post gaps.
- 📋 The `RL_*` defaults are conservative starting points — watch the first weeks of real traffic and tune.

---

## Part B — Legal & compliance

### B.1 What was already correct (verified, unchanged)
- ✅ **Privacy Policy** and **Terms of Service** exist (Landing footer + signup consent link, modal form),
  citing **RA 8759** (PESO Act), **RA 10691** (PESO strengthening), and **RA 10173** (Data Privacy Act 2012)
  with the data-subject access/correction/deletion rights.
- ✅ **No fabricated testimonials/reviews** — the placeholder "Voices from the Community" section was removed
  (§46). Landing content is system-backed.
- ✅ **Image/illustration attribution present** — Streamline free-license credit in the footer (linked).
- ✅ **Minimal third-party surface** — `index.html` loads **no external scripts, fonts, or CDNs** (only an
  inline theme bootstrap); **DiceBear avatars are generated locally** (npm package, no external API call);
  favicon is local. Google is used only for optional "Sign in with Google".
- ✅ **Cookies:** exactly **one strictly-necessary** auth cookie (`httpOnly`, `sameSite=lax`, `secure` in
  prod) + local/session storage for the token and UI prefs. **No advertising/analytics/tracking cookies** →
  under the DPA a cookie **consent banner is not required**; a clear notice suffices (see B.2).

### B.2 Gaps fixed this pass
- 🔧 **Outdated/misleading claim** — the Privacy Policy stated it collects "uploaded government
  identification documents," but ID-document verification was **removed (§48)**. Corrected to the data
  actually collected, with an explicit "does not collect or store scanned government ID documents."
- 🔧 **Incomplete subprocessor / data-provenance disclosure** — the AI section now names the real processors
  (DeepSeek direct + via OpenRouter; DeepL for translation; Cloudflare R2 for image storage; the
  transactional email provider; Google for optional sign-in), notes possible **cross-border processing**,
  "minimum necessary text, not used for model training," and that the AI features are optional.
- 🔧 **Cookie/storage notice** — the Data Security section now states plainly that only one strictly-necessary
  session cookie + local storage are used and that **no tracking cookies** are set (so no consent banner).

> ⚠️ **These privacy-policy edits are accurate to the current system but should still be reviewed/approved by
> the PESO/LGU data-protection officer or counsel before public launch** — the wording is drafting, not legal
> sign-off.

### B.3 Remaining recommendations (owner / legal decision — not changed)
- 📋 **Standalone routed pages** for `/privacy`, `/terms`, `/cookies` (currently modals only). Shareable,
  linkable, indexable URLs are better practice for public government services; the modal content can be
  reused verbatim.
- 📋 **NPC compliance operational items** (outside code): register the data processing system / appoint a
  Data Protection Officer with the National Privacy Commission if not already done; keep a data-processing
  record; define a concrete **retention period** and a breach-notification procedure (the policy references
  retention generally but names no period).
- 📋 **Accessibility (WCAG)** — a prior pass improved this; a fresh audit of the redesigned surfaces
  (vacancy-detail panel §55, Landing dark mode §53, chatbots) for contrast, focus order, and alt text is
  worth scheduling before launch.
- 📋 **Security pre-public rotation (already tracked)** — rotate the hardcoded `GOOGLE_CLIENT_SECRET`
  fallback (`authRoutes.js`) + the `.env` in git history, and the R2 API token pasted in chat, before going
  public. (See memory `standing-reminders-deferred-work`.)
- 📋 **Content consistency** — the auth-modal illustration code comment says "Bangalore set" while the files
  are the Streamline "Tokyo" set (cosmetic; no user impact).

---

## Summary
The system was already strong on the hardest reliability pieces (AI timeouts/breaker, bounded outbox
workers, auth/AI rate limits, no third-party trackers, existing privacy/terms). This pass closed the
concrete gaps — an app-wide security-header + rate-limit backstop, tight limits on the previously-unprotected
AI-cost endpoints, a client request timeout, and correction of an outdated/misleading privacy claim plus
fuller data-provenance disclosure — without rewriting any working module. The remaining items are either
deliberate tested follow-ups (body-size limit) or owner/legal operational decisions (standalone legal pages,
NPC registration, retention period, accessibility re-audit, secret rotation).
