# Phase 2C — Generic Email Outbox — Implementation Blueprint

**Status:** IMPLEMENTED (approved 2026-08-01). Code is in place behind the
`EMAIL_OUTBOX_ENABLED` flag; migration `027` is **applied**. The only remaining
step to go live is flipping `EMAIL_OUTBOX_ENABLED=true` (blueprint §9). See
`docs/resilience-hardening.md` → "P2C" for the shipped file list, and §13 below
for the per-file checklist (now ticked).

This is the last item on the resilience roadmap (see `docs/resilience-hardening.md`
for the full context and what already shipped in P0–P2b). It is deliberately the
largest, because it introduces a new table, a new background worker, and rewires
several email senders. This document remains the authoritative design; it was
implemented as specified with two small, documented deltas noted in §7 and §13.

---

## 1. Objective & scope

**Problem.** Today, only *referral letters* have durable email delivery (via the
referral outbox `referral_jobs` + `services/referralWorker.js`). Every other
transactional email is sent **inline, best-effort** — if the provider hiccups at
that moment, the email is **lost**: no retry, no record, no resend.

Senders that are currently best-effort / ad-hoc:
- `routes/authRoutes.js` — password-reset email (its own nodemailer transport).
- `routes/jobBoardRoutes.js` — contact-inquiry handling (own transport).
- `services/emailService.js` — additional ad-hoc sender.
- `services/otpService.js` — OTP signup code (made resilient in **P0** via provider
  failover + de-fatalise, but still not queued/replayable).

**Goal.** Route all transactional email through one durable queue table
(`email_outbox`) drained by a background worker, giving **retry + backoff +
dead-letter + admin resend + delivery monitoring** to *every* email — the same
guarantees referral letters already have.

**In scope:** password reset, contact-inquiry replies, `emailService` sends,
OTP signup (see §7 for the special handling), a Super Admin "Email Delivery"
monitor + resend, and health probes.

**Out of scope (deliberate boundary):**
- **Referral letters stay on their existing referral outbox.** They carry a PDF
  attachment and ride a multi-step state machine (`generate_pdf → send_email →
  notify → dispatch_n8n`). Do NOT move them; the generic outbox is for
  attachment-less transactional mail. (v1 of `email_outbox` does not model
  attachments — see §3.)
- No new external broker (Redis, SQS, etc.). **The database is the job store**
  (invariant 0.3), exactly as the referral outbox already proves.

---

## 2. Architecture overview

```
 caller (authRoutes, jobBoardRoutes, otpService, emailService, …)
      │  emailOutboxService.enqueue({ to, subject, html, text, category, dedupeKey })
      ▼
 ┌─────────────────────┐     poll ~5s      ┌──────────────────────┐
 │  email_outbox table │◄──────────────────│  services/emailWorker │
 │  (migration 027)    │   claim → send    │  (single-step drain)  │
 └─────────────────────┘   via mailService └──────────────────────┘
      │                        │ P0 provider failover (primary → Brevo)
      │                        ▼
      │                    SMTP providers
      ▼
 GET /admin/email  (status)  +  POST /admin/email/:id/resend  →  Super Admin
 "Email Delivery" page (mirrors the P2b Workflow Automation page)
```

Pattern is a **direct copy of the referral outbox mechanics** (claim with a
conditional atomic UPDATE — TiDB has no `SKIP LOCKED`, §7.5 — exponential
backoff persisted in `next_run_at`, dead-letter after N attempts, stuck-job
reclaim on boot), but **single-step** ("send") instead of a state machine.

---

## 3. Database migration strategy

**File:** `migrations/027_email_outbox.sql` (next number after 026). Additive
only, `CREATE TABLE IF NOT EXISTS` — instant metadata change on TiDB, no downtime,
no touch to existing tables. Applied with `npm run migrate` (runner targets
production; see §9).

```sql
CREATE TABLE IF NOT EXISTS email_outbox (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    to_email      VARCHAR(255) NOT NULL,
    subject       VARCHAR(500) NOT NULL,
    body_html     LONGTEXT NULL,
    body_text     LONGTEXT NULL,
    category      VARCHAR(60) NOT NULL DEFAULT 'general',   -- otp | password_reset | contact_reply | general
    status        ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
    attempts      INT NOT NULL DEFAULT 0,
    max_attempts  INT NOT NULL DEFAULT 5,
    next_run_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at     DATETIME NULL,
    worker_id     VARCHAR(64) NULL,
    provider      VARCHAR(40) NULL,          -- which provider delivered it (primary/fallback)
    last_error    VARCHAR(1000) NULL,
    dedupe_key    VARCHAR(120) NULL,         -- optional idempotency key
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at       DATETIME NULL,
    INDEX idx_email_outbox_claim (status, next_run_at),
    UNIQUE KEY uq_email_outbox_dedupe (dedupe_key)
);
```

Notes:
- **`uq_email_outbox_dedupe`** lets `enqueue` upsert on a caller-supplied key so a
  retried request (e.g. a double-submitted password reset) does not queue two
  emails. `NULL` dedupe keys are allowed and never collide (MySQL/TiDB treat NULL
  as distinct in a UNIQUE index).
- **No attachments column** in v1 — the only attachment-bearing mail (referral
  letters) stays on its own outbox. If a future email needs an attachment, add a
  `attachments LONGTEXT` (base64 JSON) in a later migration; don't block v1 on it.
- **Migration order:** 027 is independent of 023–026; it only needs the DB to
  exist. No FK to other tables, so no rebuild concerns. Baseline check: run
  `npm run migrate:status` first; expect `026` applied, `027` pending.

---

## 4. Background worker architecture

**File:** `services/emailWorker.js`. Mirrors `services/referralWorker.js` but
single-step. Responsibilities:

1. **Poll loop** (`EMAIL_OUTBOX_POLL_MS`, default 5000ms). On each tick, claim a
   small batch of *due* rows and process them.
2. **Claim** — conditional atomic UPDATE (no `SKIP LOCKED`):
   ```sql
   UPDATE email_outbox
   SET status='processing', worker_id=?, locked_at=NOW(), attempts=attempts+1
   WHERE id=? AND status='pending' AND next_run_at <= NOW();
   ```
   Only the worker whose UPDATE affects the row owns it — safe across multiple
   Render instances (invariant compatible with §7.5).
3. **Send** via `mailService.sendMail(...)` — inherits the **P0 provider
   failover** for free. Record which provider delivered it.
4. **Outcome:**
   - success → `status='sent', sent_at=NOW(), provider=<name>, last_error=NULL`.
   - failure & `attempts >= max_attempts` → `status='failed'` (dead-letter).
   - failure & attempts remain → `status='pending', next_run_at = NOW() + backoff(attempts)`.
5. **Reclaim stuck** on boot + periodically: rows in `processing` with
   `locked_at` older than `EMAIL_OUTBOX_STUCK_MS` (default 5 min) → back to
   `pending`. (A worker that died mid-send must not strand the row.)
6. **Started in `server.js`** after `verifyMailTransport()`, gated by
   `EMAIL_OUTBOX_ENABLED` (see §10 for why the flag matters for rollback).

The worker NEVER throws into the loop; a single bad row is logged and left to
retry/dead-letter, never crashing the drain (mirrors the referral worker).

---

## 5. Queue processing workflow / job lifecycle

```
enqueue() ──► pending ──(claim, due)──► processing ──► sent      (terminal, success)
                 ▲                            │
                 │  backoff (attempts<max)    ├──► pending (retry later)
                 └────────────────────────────┘
                                              └──► failed    (terminal, dead-letter)
 failed ──(admin resend)──► pending          processing ──(stuck > timeout, on boot)──► pending
```

- **pending** — waiting for its `next_run_at`.
- **processing** — claimed by a worker; short-lived.
- **sent** — delivered; `sent_at` + `provider` recorded.
- **failed** — exhausted retries; visible in the admin monitor, **resendable**.

Admin **resend** = reset a `failed` (or old `pending`) row: `status='pending',
attempts=0, next_run_at=NOW(), last_error=NULL`. Same primitive as the referral
retry / n8n replay already shipped.

---

## 6. Retry policy & scheduling

- **Backoff:** exponential, capped at ~1 hour — reuse the referral worker's
  `backoffSeconds(attempts)` shape (extract it to a shared helper, or copy).
- **max_attempts:** default 5 (`EMAIL_OUTBOX_MAX_ATTEMPTS`), per-row overridable.
- **Poll interval:** `EMAIL_OUTBOX_POLL_MS` default 5000.
- **Stuck timeout:** `EMAIL_OUTBOX_STUCK_MS` default 300000 (5 min).
- **Batch size:** small (e.g. 10 per tick) so one slow SMTP call can't starve the
  loop; the next tick picks up the rest.

---

## 7. Integration points (rewiring senders)

Each sender changes from "send inline" to "enqueue". Do them incrementally; each
is independently shippable.

| Sender | File | Change | Notes |
|---|---|---|---|
| Password reset | `routes/authRoutes.js` | enqueue via `emailOutboxService` | Retire its private nodemailer transport (folds the "two transports drift" note). Highest-value: currently pure best-effort. |
| Contact-inquiry reply | `routes/jobBoardRoutes.js` | enqueue | |
| Misc sends | `services/emailService.js` | enqueue (or delete if superseded) | Audit callers first. |
| **OTP signup** | `services/otpService.js` | **enqueue + one inline attempt** | See below — do NOT make the user wait a poll cycle. |

**OTP special handling (important).** The signup code is latency-sensitive — the
user is staring at a "enter your code" screen. Do NOT replace the P0 direct send
with a pure queue (that adds up to one poll interval of delay). Instead:
1. Enqueue the OTP row (durable record).
2. Attempt an **immediate inline send** once (the existing P0 failover path).
3. On inline success → mark the row `sent`. On inline failure → leave it
   `pending`; the worker retries. Either way the user's flow is unchanged and the
   P0 "delivery pending, resend available" UX still applies.

This keeps OTP immediacy **and** gains durable retry. Verification integrity is
untouched — a real code still gates account creation.

**Referral letters:** unchanged. They keep their own outbox (attachments + state
machine). Document the boundary in code comments so no one "unifies" them later.

---

## 8. Monitoring & admin recovery

1. **Health probe** — extend `GET /admin/health` with:
   ```
   emailOutbox: { pending, failed, oldestPendingAgeMinutes }
   ```
   and surface it on the existing **Platform Health** page (P2a) as another
   StatusCard (tone: `failed>0` → warn, `oldestPendingAgeMinutes>30` → warn).
2. **Email Delivery page** — new Super Admin feature
   `superadmin/features/email/EmailDelivery.jsx`, wired like the P2b Workflow
   Automation page:
   - counts (pending / sent / failed),
   - recent failed list with **Resend selected / Resend all**,
   - backed by `GET /admin/email` + `POST /admin/email/resend`
     (audited via a new `EMAIL_RESEND` action in `adminAuditService`).
3. Add a sidebar item "Email Delivery" (`/admin/email`) next to Platform Health
   and Workflow Automation.

---

## 9. Deployment sequence

1. **Merge** the P2C branch (migration + worker + service + rewired senders +
   admin page), with `EMAIL_OUTBOX_ENABLED` **unset/false** so senders still send
   inline and the worker is dormant.
2. **Run the migration:** `npm run migrate` → creates `email_outbox` (additive,
   no downtime). Confirm with `npm run migrate:status`.
3. **Deploy backend.** With the flag off, behaviour is identical to today; the
   worker either doesn't start or drains an empty table (no-op).
4. **Flip `EMAIL_OUTBOX_ENABLED=true`** (env change + restart). Senders now
   enqueue; the worker drains. Watch the Email Delivery page.
5. **Verify** end-to-end (see §12), then leave it on.

Ship senders incrementally if preferred — password reset first (safest, highest
value), then contact, then OTP.

---

## 10. Rollback plan

- **Feature flag is the primary rollback.** `EMAIL_OUTBOX_ENABLED=false` (env +
  restart) makes every rewired sender fall back to a direct send and stops the
  worker — **no code deploy needed**. This is why senders must keep a direct-send
  code path behind the flag rather than hard-cutting to enqueue.
- **Code rollback:** revert the P2C commit(s). Senders return to inline send.
- **The migration is additive** — leave `email_outbox` in place on rollback
  (harmless, unused). Never drop it as part of a rollback (dropping a table on
  live TiDB is the risk we avoid).
- **Draining before rollback:** if rows are `pending`/`failed` when you roll back,
  they simply sit; roll forward (or run the worker once) to flush them, or resend
  from the admin page. No data loss — the rows are durable.

---

## 11. Infrastructure changes

- **None external.** No broker, no new service. The worker runs in the same Node
  process as the API and the referral worker (invariant 0.3).
- **New env vars:** `EMAIL_OUTBOX_ENABLED`, `EMAIL_OUTBOX_POLL_MS`,
  `EMAIL_OUTBOX_MAX_ATTEMPTS`, `EMAIL_OUTBOX_STUCK_MS`. All have safe defaults.
- **Multi-instance safe:** if Render runs >1 instance, each starts a worker; the
  atomic-claim UPDATE guarantees a row is processed once (same guarantee the
  referral worker already relies on).
- **Render filesystem:** irrelevant — everything is in TiDB and streamed; no disk
  writes.

---

## 12. Testing strategy

Production TiDB, no test creds, email-gated signup — so verify without writing
against prod (§13 of the architecture skill):
- **Unit / local:** enqueue → claim → send (mock `mailService.sendMail`) → assert
  status transitions; simulate failure to assert backoff + dead-letter; assert
  dedupe upsert.
- **Manual (staging or local):** enqueue a test email, watch it send; break the
  primary provider password (as done in the P0 test) to watch failover; break
  both providers to watch retry → dead-letter; then **Resend** from the admin page
  and watch it deliver once a provider is restored.
- **Never test a write path against production** (skill §13).

---

## 13. File inventory / implementation checklist

- [x] `migrations/027_email_outbox.sql` — table (§3)
- [x] `repositories/emailOutboxRepository.js` — SQL: `enqueue` (idempotent upsert
      on dedupe via `id=LAST_INSERT_ID(id)`), `findDue` + `claim` (the
      split-read/atomic-claim pattern referralRepository uses, in place of a
      single `claimDue`), `markSent`, `reschedule`/`fail` (= `markFailedOrRetry`),
      `reclaimStuck`, `counts`, `listRecent` (= `listFailed`, ordered
      failed→pending→recent), `resetToPending`, `health`
- [x] `services/emailOutboxService.js` — `enqueue` (fire-and-forget) +
      `sendImmediate` (OTP: enqueue + one inline attempt) + monitor/resend/health
      helpers; flag read per call
- [x] `services/emailWorker.js` — poll/claim/send/backoff/reclaim (§4)
- [x] `server.js` — start the worker (gated by `EMAIL_OUTBOX_ENABLED`)
- [x] Rewire senders (§7): `authRoutes` (password reset + security alert),
      `jobBoardRoutes` (contact), `emailService` (orphan; future-proofed),
      `otpService` (`sendImmediate` = enqueue + inline attempt)
- [x] `routes/adminRoutes.js` — `GET /admin/email`, `POST /admin/email/resend`
      (body `{ ids }`); extend `/admin/health` with `emailOutbox`
- [x] `services/adminAuditService.js` — add `EMAIL_RESEND` action
- [x] `superadmin/features/email/EmailDelivery.jsx` + route in `App.jsx` + nav in
      `SuperAdminSidebar.jsx` + a StatusCard on Platform Health (mirror
      `WorkflowAutomation.jsx`)
- [x] `docs/resilience-hardening.md` — P2C marked implemented

**Implementation deltas (documented):**
1. **Repository claim** — used `findDue()` + atomic `claim(id)` (referral outbox's
   proven split) rather than one combined `claimDue`. Same guarantee, same TiDB
   no-`SKIP LOCKED` safety; keeps the two workers structurally identical.
2. **Contact inquiry** — the inquiry is already persisted to `contact_inquiries`,
   so the email is a convenience ping; v1 has no `replyTo` column, so the
   enquirer's address is carried as a "reply to" line in the body (unchanged from
   the original intent, just no header field).

---

## 14. Invariants respected

- **0.1** never fail the primary action for a secondary concern — enqueue is
  cheap and non-blocking; a queue write failure must not fail the user's action
  (fall back to inline send, or log-and-continue).
- **0.3** the database is the job store — no broker, no `setTimeout`, no n8n.
- **0.11** notifications go only through `notificationService` — the email outbox
  is a *separate* channel; do not conflate it with in-app notifications.
- **§7.5 pattern** — reuse the transactional-outbox mechanics; do not invent a
  second async mechanism.
- **Verification integrity** — OTP still requires a real, delivered code.
