# Proposal — n8n → Make.com Migration + Backend Modular Architecture (2026-09)

**Status:** proposal for review (no code changed yet). **Scope:** (A) migrate the self-hosted n8n
automation to Make.com one-for-one; (B) a pragmatic modular-backend plan for the Render Free tier.

---

## 0. Headline findings (audit first)

Two facts from auditing the actual codebase change the shape of this work:

1. **n8n's entire footprint is ONE workflow.** The only outbound automation is the referral
   pipeline's final `dispatch_n8n` step (`services/referralWorker.js`). Everything else the app
   talks to (Resend/Brevo email, DeepL, DeepSeek/OpenRouter, Semaphore/TextBee, Cloudflare R2) is a
   **first-party API integration, not n8n**. So "migrate every active n8n workflow" = migrate **one
   scenario**.

2. **The hard parts are already built on the backend.** The request asks for idempotency, retry
   caps, backoff, dead-letter/manual-review, error handling, and "referrals must work even when the
   automation is down." All of that already exists in the transactional-outbox worker — n8n is a
   **downstream consumer (invariant 0.10)**, contacted only *after* a referral is fully complete.
   Migrating to Make does **not** require rebuilding any of it; the backend is automation-provider-
   neutral (it just POSTs JSON to a configured webhook URL).

**Recommendation in one line:** migrate the single scenario to Make, make the backend env-var
provider-neutral, add idempotency *inside* the Make scenario, and **keep the modular monolith on the
Free tier** — extract workloads into separate services only when profiling proves contention *and*
a paid tier is available (a separate Free service just adds cold-starts).

---

## Part A — n8n → Make.com migration

### A.1 Inventory of the existing automation (grounded in code)

| Aspect | Current implementation |
|---|---|
| **Trigger** | Referral outbox step `dispatch_n8n` — the LAST step, after the letter is generated, emailed, and the applicant notified. |
| **Transport** | `axios.post(process.env.N8N_WEBHOOK_URL, payload, { timeout: N8N_DISPATCH_TIMEOUT_MS ?? 15000 })`. |
| **Payload** | `{ event:'referral.completed', referenceNumber, matchScore, reviewedAt, applicant{name,email}, job{title,company}, employer{name,email}, reviewer }`. |
| **Expected response** | HTTP 2xx = received. Non-2xx → retryable. |
| **What n8n does** | Side-channel only: (1) log the referral to a Google Sheet, (2) notify the employer. |
| **Auth** | Shared-secret webhook URL (unguessable path). No user auth — it's server→automation. |
| **Degradation** | `N8N_WEBHOOK_URL` unset → **no-op success**. Unreachable → retry with exponential backoff up to `max_attempts` (5), then **SKIP** (logs `N8N_DISPATCH_SKIPPED`, referral still COMPLETES — never dead-letters a completed referral as "failed"). |
| **Observability** | Super-Admin **Workflow Automation** page (`GET /admin/automation` → `getAutomationStatus`): configured flag, Dispatched / Undispatched counts, the undispatched list. |
| **Manual recovery** | `POST /admin/automation/replay` re-queues ONLY the dispatch step for selected Approved referrals (idempotent — never regenerates/re-emails the letter). |
| **Activity log** | `N8N_DISPATCHED` / `N8N_DISPATCH_SKIPPED` rows per referral. |

> The n8n **scenario internals** (the node graph: Sheet-append, notify) live in the n8n instance,
> not the repo. The owner must **export the active n8n workflow JSON** so we confirm the exact Sheet
> columns and the employer-notification template before rebuilding — the table above is the contract
> the backend guarantees; the export fills in the last mile.

### A.2 Make scenario design (one-for-one)

**Scenario: `PESO — Referral Completed`**

1. **Custom Webhook** (trigger) — receives the `referral.completed` JSON. Copy the webhook URL into
   the backend env (see A.4).
2. **Idempotency guard** (see A.3) — Google Sheets *Search Rows* for `referenceNumber`; a **Filter**
   stops the run if it already exists (prevents duplicate rows/emails on a retry).
3. **Google Sheets — Add a Row** — the referral log (mirror the current n8n Sheet columns).
4. **Email/Gmail — Send** — the employer notification (mirror the current template).
5. **Webhook Response** — `200` so the backend records `N8N_DISPATCHED` (Make responds 200 by
   default; add an explicit response module to be safe).

Behaviour, triggers, branching, and outcome are identical to n8n — only the host changes.

### A.3 Idempotency, retries, failure protection

- **Backend side (already done, keep as-is):** exactly-once *enqueue* per referral, capped retries
  (`max_attempts` 5) with exponential backoff, skip-not-dead-letter on exhaustion, per-referral
  activity log, admin monitor + manual replay. No change needed.
- **Make side (NEW — the only idempotency work):** because a backend retry (or a manual replay) can
  re-send the same `referral.completed`, the scenario must be **idempotent on `referenceNumber`** —
  the A.2 step-2 search+filter. Without it, a retry would append a duplicate Sheet row and re-email
  the employer. This is the single most important addition.
- **Credit safety:** the filter also caps credit burn — a duplicate delivery exits after 1–2 modules
  instead of running the full chain.

### A.4 Backend changes (minimal)

The backend already POSTs to a configurable URL, so the migration is essentially configuration:

- **Option 1 (zero code):** set `N8N_WEBHOOK_URL` = the Make webhook URL. Works today, but the env
  var and the Super-Admin UI still say "n8n."
- **Option 2 (recommended, small):** introduce a provider-neutral `AUTOMATION_WEBHOOK_URL`
  (fall back to `N8N_WEBHOOK_URL` for continuity), and relabel the Workflow Automation UI + activity
  actions from "n8n" to "automation / Make." Purely cosmetic + a rename; the pipeline is untouched.

Either way the referral pipeline, retries, and degradation contract are unchanged.

### A.5 Migration sequence

1. **Export** the active n8n workflow JSON (owner) → confirm Sheet columns + employer template.
2. **Build** the Make scenario (A.2) with the idempotency filter (A.3).
3. **Test** against the real backend: fire a `referral.completed` (use the **Replay** button on a
   test referral, or a sandbox referral) → verify one Sheet row + one employer email.
4. **Parallel validation:** point a *second* copy of the payload at Make while n8n still runs
   (or simply run Make on replays first), compare outputs for a few real referrals.
5. **Cutover:** switch `AUTOMATION_WEBHOOK_URL` to Make in Render → redeploy.
6. **Monitor** the Workflow Automation page (Undispatched should stay ~0) + Make's execution log +
   credit usage for one cycle.
7. **Retire n8n** only after a clean verification window — shut down the self-hosted instance,
   removing its hosting/maintenance burden entirely.

### A.6 Credit budget (Make Free = 1,000 ops/month)

Per referral ≈ **3–4 module ops** (webhook + search + add-row + email; the dedupe filter costs ~0).
Even at, say, 100 completed referrals/month that's ~400 ops — comfortably inside 1,000. Monitor
in Make; if volume ever grows, the idempotency filter and a single "batch to Sheets" step keep it
lean. Because dispatch is **downstream and best-effort**, a credit exhaustion never blocks a
referral — it just shows up as Undispatched for a later replay.

---

## Part B — Backend modular architecture (Render Free tier)

### B.1 Current state (already more modular than it looks)

- **Layered monolith:** `routes/` (HTTP) → `services/` (business rules/transactions) →
  `repositories/` (SQL). Concerns are already separated by module, matching the proposed split:
  Core CRUD, **AI** (`services/aiClient.js` — its own timeout + circuit breaker + failover),
  **File/Media** (`services/storageService.js` — env-aware, **already on Cloudflare R2**, not the
  ephemeral disk), **Import** (`services/importService.js` — bounded CPU work with per-user caps),
  **Notification/Automation** (the 7 outbox workers), **Public Assistant** (`routes/publicAssistantRoutes.js`
  + `services/publicAssistant/*` — already isolated, rate-limited, public-safe).
- **Worker-split already engineered (§25):** `startWorkers.js` is a shared module and a `WORKER_MODE`
  flag already lets the same codebase run as **API-only** (`WORKER_MODE=web`) with a separate
  `node worker.js` process owning the workers — a **one-flag change, not a rewrite**.
- **Uploads are NOT on the container disk** (R2, §41) — the Render ephemeral-filesystem risk the
  request flags is already handled for the primary case (only the legacy `/uploads` static remains).

### B.2 Recommended target — for the Free tier, do NOT fragment

The request's own reasoning is correct and worth committing to: on the **Render Free tier** (spin-down
after 15 min, ~1 min cold wake, ephemeral disk, no always-on worker), splitting the app into many
services **hurts** — each service is a separate cold-start and deploy, and a second Free web service
spins down too. The practical architecture stays:

```
React (Vercel) → Core Node.js API (Render) → TiDB + Cloudflare R2
                       │
                       ├── AI, Import, Notifications = in-process modules/workers (isolated in code)
                       └── downstream automation → Make.com (out of the request path)
```

Moving the automation to Make already removes one *self-hosted service* (n8n) — a real
operational win without adding any.

### B.3 Justified extractions — and their gate

Extract a workload into its **own process/service only when BOTH**: (a) `/admin/timing` profiling
under real concurrency shows it contends with the core request path, and (b) a **paid tier** is
available (the Free tier can't run an always-on background worker, and a 2nd Free web service just
adds cold-starts).

| Candidate | Isolate as | When justified |
|---|---|---|
| **The 7 outbox workers** (email, SMS, referral dispatch, scoring, job-match, digest, proactive) | A dedicated **Render Background Worker** via the existing `WORKER_MODE=web` + `worker.js` | First and cleanest extraction — already engineered (§25). Needs a **paid** worker service. |
| **AI processing** | Stays an in-process module with its own timeout/breaker; only worth a separate worker if AI scoring volume dominates CPU | Profile-gated. Its cost controls already exist (`aiLimiter`, breaker, cache). |
| **Import/CSV processing** | Already a bounded service; extract to the worker process alongside the outbox if imports cause request-path stalls | Profile-gated. |
| **File/Media** | Already externalized to **R2**; no separate service needed | Done. |
| **Public Assistant** | Already isolated + rate-limited; keep in the API (it IS a request path) | No extraction. |

### B.4 Render Free-tier constraints → design implications

- **Ephemeral filesystem** → persistent files must live in **object storage** — already true (R2).
  Do **not** write uploads to the container disk.
- **Spin-down / cold start** → minimize the number of always-on services; a background worker or a
  second web service is only worth it on a **paid** plan. (This is the §25 roadmap's exact gate.)
- **No always-on Free worker** → keep workers in-process until the paid worker split; the outbox is
  durable (DB-backed), so a spin-down loses no work — it resumes on wake.

### B.5 Progressive decomposition sequence

```
Automation:  export n8n → build Make scenario → test vs backend → add idempotency →
             parallel validate → cutover AUTOMATION_WEBHOOK_URL → monitor credits → retire n8n
Backend:     keep modular monolith → profile /admin/timing under load → (paid) extract the
             worker process via WORKER_MODE → measure again → extract a 2nd workload ONLY if
             profiling still shows contention → keep all core transactions in the Core API
```

---

## Risks, non-goals, decision points

- **Non-goal:** a full microservices split. The capstone scope + Free tier don't justify it; this is
  progressive, profile-gated decomposition.
- **Dependency:** the Make rebuild needs the **exported n8n workflow JSON** (Sheet columns + employer
  template) — owner to provide.
- **Make Free limits:** 1,000 ops/month + Make's own scenario-scheduling minimums; fine at PESO
  volume, but monitor. If it's ever exceeded, the downstream design means referrals are unaffected.
- **Decision needed:** Option 1 (zero-code, keep "n8n" naming) vs **Option 2 (recommended:** neutral
  `AUTOMATION_WEBHOOK_URL` + relabel the UI). And: proceed to implement Part A now, or after the n8n
  export?

## Recommendation
Approve **Part A** (migrate the one scenario to Make, Option 2 env/UI rename, idempotency in Make) —
it's small, low-risk, removes the self-hosted n8n burden, and most safeguards already exist. Treat
**Part B** as a **standing architectural principle** (modular monolith now; profile-gated, paid-gated
extraction of the worker process first) rather than immediate work — nothing to build until
`/admin/timing` under real load says so.
