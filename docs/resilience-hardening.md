# Resilience & Fault-Tolerance Hardening — Progress & Continuation Point

**Purpose.** This is the authoritative checkpoint for the resilience-hardening
effort. It records what shipped (with commit hashes), the current dependency
posture, the new environment variables, and how to resume. The final item —
**Phase 2C (generic email outbox)** — has now been **implemented** (behind the
`EMAIL_OUTBOX_ENABLED` flag); its blueprint is
`docs/phase-2c-email-outbox-plan.md`. Migration `027` is **applied**; the only
remaining operational step is to flip `EMAIL_OUTBOX_ENABLED=true` when ready
(blueprint §9).

> New session? Read this file first, then `docs/phase-2c-email-outbox-plan.md`,
> then skim the commits listed below. The broader architecture reference is the
> `peso-kabankalan-ai-system-architect` skill and `docs/system-guide.md`.

---

## Origin

A full assessment identified every external dependency, its blast radius, current
handling, and mitigation. Headline finding: the core was already fault-tolerant;
exposure was concentrated in a few specific places (a hard email SPOF at signup,
AI with no failover, PDFMonkey as a deletable dependency, missing operational
visibility). The work below closed those gaps in priority order (P0 → P2).

---

## Shipped (all on `main`, pushed)

### P0 — Email provider failover + de-fatalise OTP signup  ·  `510b0b2`, `ce93fdc`
The only hard single point of failure on a core flow: one Gmail hiccup blocked
**all** new registrations (OTP send was fatal — 502 + rollback).
- `services/mailService.js` — `sendMail` now tries an **ordered provider list**
  (primary Gmail + optional `EMAIL_FALLBACK_*` SMTP) and returns on first success.
  Provider-neutral SMTP; lazy-cached transports dropped on failure. Added
  `getMailHealth()`. Fallback "From" defaults to the real identity, not the SMTP
  login (`ce93fdc`).
- `services/otpService.js` — de-fatalised: on total mail failure the staged signup
  is **kept** (not deleted) and reported `delivered:false`; the user resends once
  mail recovers. Verification integrity intact.
- `routes/authRoutes.js`, `LandingPage.jsx` — surface `deliveryPending`; fixed a
  `resendAvailableInSeconds || 60` bug that swallowed a legitimate `0` (→ `??`).
- `/admin/health` mail probe → live per-provider reachability.
- **Verified live** by the user: broke the primary Gmail, registered an account,
  the code was delivered via Brevo (`Delivered via 'fallback' provider`).

### P1a — Unified `aiClient` (failover + circuit breaker)  ·  `d892820`
- `services/aiClient.js` — one chat-completion client with automatic
  **OpenRouter ↔ DeepSeek** failover (both serve `deepseek-chat`), a per-provider
  **circuit breaker**, shared timeout, model tiers (CHAT / DRAFT), and an `extra`
  passthrough (e.g. `response_format`). Each caller keeps its primary via
  `prefer`, so load stays spread and merely gains a fallback. `getAiHealth()` for
  the health page.
- Migrated the compatibility path (`aiScoringService`, `jobRoutes /match` &
  `/similar`) — the exact features that hit the OpenRouter 402.

### P1b — Route ALL AI features through `aiClient`  ·  `dd6df1d`
- `resumeRoutes`, `resignationRoutes`, `chatbotRoutes`, `coverLetterRoutes`,
  `profileRoutes` — every remaining inline OpenRouter/DeepSeek call migrated. Zero
  inline AI calls remain outside `aiClient`. `axios` kept only where non-AI calls
  need it (PDFMonkey/DeepL/Coresignal). Pure transport swap + failover.

### P1c — Retire PDFMonkey → self-hosted pdfkit  ·  `0222d75`
- `services/letterPdfService.js` — renders cover-letter & resignation PDFs as a
  formal business letter with **pdfkit** (same self-hosted engine referral letters
  and resumes already use in prod). No external API, key, template id, or polling.
- `coverLetterRoutes` / `resignationRoutes` render in-memory and stream the PDF;
  builders download the blob instead of a hosted URL. **Deletes an external
  dependency outright.** Verified by rendering sample PDFs (valid output, correct
  layout). `PDFMONKEY_API_KEY` / `COVER_LETTER_TEMPLATE_ID` are now dead config.

### P2a — Platform Health page  ·  `ae2211a`
- `superadmin/features/health/PlatformHealth.jsx` (`/admin/health` nav) — live
  status board: DB latency, both email providers (P0), both AI providers +
  circuit-breaker state (P1), referral-worker backlog, letter durability. Each
  subsystem shows its own ok/warn/critical tone; a Re-check button re-probes.
- `/admin/health` enriched with `aiClient.getAiHealth()`.

### P2b — n8n workflow monitoring + replay  ·  `f8900b9`
- `superadmin/features/automation/WorkflowAutomation.jsx` (`/admin/automation`) —
  platform-wide n8n dispatch status (dispatched / undispatched / pending /
  dead-lettered), the undispatched list, and **Replay selected / all**.
- `GET /admin/automation`, `POST /admin/automation/replay` (audited `N8N_REPLAY`);
  `referralService.getAutomationStatus` / `replayN8nDispatch`; repository
  `automationCounts` / `listUndispatchedAll` / `filterApprovedQueueIds`.
- Replay re-queues **only** the dispatch step (`enqueueJob('dispatch_n8n')`) — the
  worker runs dispatch → done, never regenerating or re-emailing the letter.

---

### P2C — Generic email outbox  ·  **IMPLEMENTED (flag-gated; migration 027 applied)**
The belt-and-suspenders completion: *all* attachment-less transactional email now
routes through a durable queue for universal retry/backoff/dead-letter/resend/
monitoring — the same guarantees referral letters have. **Full blueprint:**
`docs/phase-2c-email-outbox-plan.md`.
- **Migration** — `migrations/027_email_outbox.sql` (additive, `CREATE TABLE IF
  NOT EXISTS`). **Applied** via `npm run migrate`.
- **Queue + worker** — `repositories/emailOutboxRepository.js`,
  `services/emailOutboxService.js` (enqueue / sendImmediate / monitor / resend),
  `services/emailWorker.js` (single-step drain, mirrors `referralWorker`). Started
  in `server.js`, **gated by `EMAIL_OUTBOX_ENABLED`** (dormant unless `="true"`).
- **Senders rewired** — password reset + security alert (`authRoutes`), contact
  inquiry (`jobBoardRoutes`), the orphan `emailService`, and OTP signup
  (`otpService`, via `sendImmediate` = enqueue + one inline attempt so OTP keeps
  its immediacy). All private nodemailer transports retired; everything now flows
  through `mailService` (P0 failover) whether inline (flag off) or queued (flag on).
- **Admin surface** — `GET /admin/email`, `POST /admin/email/resend` (audited
  `EMAIL_RESEND`); `/admin/health` extended with `emailOutbox`;
  `superadmin/features/email/EmailDelivery.jsx` at `/admin/email` (nav + Platform
  Health card added).
- **Rollback** — `EMAIL_OUTBOX_ENABLED=false` (env + restart) reverts every sender
  to inline send with no code deploy; the additive table is left in place.

### P3 — Production deployment hardening (2026-08-02)  ·  **IMPLEMENTED (deployed)**
The platform went from "runs locally" to "deployed cross-origin on Vercel (frontend)
+ Render (backend)." Deploying surfaced two host realities that this phase closed.
Full detail: `SKILL.md` §19; continuation: `docs/session-continuation-2026-08-02.md`.

- **HTTP email — Render blocks outbound SMTP.** nodemailer (Gmail + Brevo-SMTP) fails
  on Render with `ENETUNREACH`/timeout, so `services/mailService.js` was refactored to
  an ordered provider chain of uniform `{ name, send, verify, drop }` providers mixing
  two transport kinds: **HTTP-API first** (Brevo `POST /v3/smtp/email` via
  `BREVO_API_KEY`, then Resend `POST /emails` via `RESEND_API_KEY` — both over 443,
  which Render allows), then the **SMTP providers as fallback** (Gmail + `EMAIL_FALLBACK_*`,
  used locally). Brevo leads because a **verified single sender** reaches any recipient
  with no domain; Resend needs a verified domain (else test-mode to the account owner).
  All env-gated → local dev (no HTTP key) is unchanged. Attachments (referral letters)
  base64-convert via a shared helper. `sendMail`/`verify`/`isMailConfigured`/
  `getMailHealth` contracts unchanged. **Validated in prod** (password reset delivered).
- **Env-driven cross-origin URLs.** A Vercel↔Render split is cross-origin, so hardcoded
  `localhost` URLs were moved to env (localhost fallbacks keep dev identical):
  `server.js` CORS + socket.io origin now read `FRONTEND_URL`/`CORS_ORIGINS`;
  `ChatContext.jsx` socket URL and `LandingPage.jsx` Google-login URL now read
  `VITE_API_URL`. Without these, the deployed frontend is CORS-rejected and the socket
  (hybrid pipeline real-time, chat, notifications) never connects. Verified: backend
  returns `access-control-allow-origin: https://peso-kabankalan.vercel.app`.
- **Real-time pipeline shipped (SKILL §18.9).** `applicationScoringWorker` starts
  `with io` and emits `scores_updated`; the 45s poll became a 90s visibility-gated
  backstop — the platform's durable-state + best-effort-push + slow-poll posture.

## Pending

_Resilience roadmap (P0–P3) implemented._ Deferred, NOT blocking: production email
**domain auth** (SPF/DKIM/DMARC + branded sender) once a domain is purchased — env +
DNS only, no code (SKILL §19.5); rotate the `.env`/`GOOGLE_CLIENT_SECRET` secrets
before the repo goes public.

---

## Current dependency posture

| Dependency | Before | Now |
|---|---|---|
| Email (OTP signup) | hard SPOF — one outage blocked all signups | provider failover + de-fatalised; durable outbox (P2C) with immediate inline attempt |
| Email (other) | best-effort, lost on failure | durable outbox (P2C): retry + backoff + dead-letter + admin resend (flag-gated) |
| Email transport (host blocks SMTP) | nodemailer only — dead on Render (SMTP blocked) | HTTP-API providers (Brevo/Resend) lead the chain, SMTP fallback (P3) |
| AI (OpenRouter/DeepSeek) | pinned per feature; 402 = feature outage | unified client, automatic failover + breaker |
| PDF (cover/resignation) | PDFMonkey (external, paid) | self-hosted pdfkit — dependency deleted |
| n8n | silent gap after 5 tries | monitored + replayable (Super Admin) |
| Ops visibility | `/admin/health` API only, no UI | Platform Health + Workflow Automation pages |

---

## Environment variables introduced

All optional with safe defaults; nothing breaks if unset.

- **Email failover (P0):** `EMAIL_FALLBACK_HOST`, `EMAIL_FALLBACK_PORT`,
  `EMAIL_FALLBACK_USER`, `EMAIL_FALLBACK_PASS`, `EMAIL_FALLBACK_FROM` (opt),
  `EMAIL_FALLBACK_SECURE` (opt). Also honoured: `EMAIL_FROM`.
- **AI client (P1):** `AI_TIMEOUT_MS`, `AI_BREAKER_THRESHOLD`,
  `AI_BREAKER_COOLDOWN_MS` (all optional).
- **Now-unused (safe to delete from env):** `PDFMONKEY_API_KEY`,
  `COVER_LETTER_TEMPLATE_ID`.
- **HTTP email + cross-origin deploy (P3):** `BREVO_API_KEY` (+ `BREVO_FROM_EMAIL`
  default `EMAIL_USER`, `BREVO_FROM_NAME`), `RESEND_API_KEY` (+ `RESEND_FROM`) —
  HTTP senders for SMTP-blocked hosts; `FRONTEND_URL` (or `CORS_ORIGINS` csv) — the
  browser origin the backend trusts (CORS + socket + OAuth redirects); frontend
  `VITE_API_URL` (API + socket + Google button) and `VITE_PIPELINE_POLL_MS` (90000).
  All optional with localhost fallbacks — unset ⇒ local dev behaves exactly as before.
- **Email outbox (P2C):** `EMAIL_OUTBOX_ENABLED` (the master flag — unset/false
  keeps senders inline and the worker dormant), `EMAIL_OUTBOX_POLL_MS` (5000),
  `EMAIL_OUTBOX_BATCH_SIZE` (10), `EMAIL_OUTBOX_MAX_ATTEMPTS` (5),
  `EMAIL_OUTBOX_STUCK_MS` (300000). All optional with safe defaults. Optional
  `EMAIL_FROM_INBOX` overrides where contact-inquiry notifications are delivered
  (defaults to `EMAIL_USER`).

Brevo fallback setup notes (from live testing): the `…@smtp-brevo.com` value is
the **login** (→ `EMAIL_FALLBACK_USER`); the password is the **SMTP key**
(`xsmtpsib-…`, → `EMAIL_FALLBACK_PASS`). Disable Brevo's **Authorized IPs**
restriction (Render's IP changes) and verify a **single sender email** (free, no
domain needed).

---

## Deploy / operational reminders

- **Migrations applied through `027`.** `027_email_outbox.sql` (additive) has
  been applied via `npm run migrate`. Confirm any time with `npm run
  migrate:status`.
- Self-hosted PDFs need nothing on deploy — `pdfkit ^0.19.1` is already a
  dependency and already runs in prod.
- Verify locally/staging only. Production TiDB has no test creds; never exercise a
  write path against prod (skill §13).

---

## How to resume in a new session

1. Read this file + `docs/phase-2c-email-outbox-plan.md`.
2. Load the `peso-kabankalan-ai-system-architect` skill for architecture rules.
3. Confirm the working tree is clean and on `main` at/after `f8900b9`.
4. If P2C is approved: follow the blueprint's file inventory (§13) and deployment
   sequence (§9); build behind `EMAIL_OUTBOX_ENABLED` for a flag-based rollback.
5. Standing rule: **flag before large feature builds** and confirm the release is
   stable/production-ready first (small polish/bugfix work is exempt).
