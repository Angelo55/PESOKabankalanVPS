# PESO Kabankalan — Root-to-Top Engineering & UX Audit (2026-08-24)

**Author:** engineering audit pass · **Scope:** the *currently implemented* system as of HEAD `29b731e`,
`npm test` 127, migrations→047. **This is an audit of what exists** — not a rewrite, not a feature plan.

> **Implementation status (2026-08-24):** the recommended **first increment is DONE** — **F1** (score
> provenance), **F2** (surfaced AI rationale), **B1** (sub-score colours), **D1** (debounced tab-focus
> refetch), **F3** (documented reproducibility). Then **C1 DONE** (modal focus-trap + restore, reusable
> `useFocusTrap`). **D2 DECLINED** — on review it conflicts with a deliberate, documented decision in
> `App.jsx` to keep LandingPage eager for the landing first-impression; the saving (~26 kB gzip entry) does
> not justify a spinner flash on the public front door, so LandingPage stays eager. See development-history
> **§35**. Remaining audit items (A2, G3) are P3, not yet implemented; the "Future" rows stay deferred.

## 0. Method, scope & exclusions

**How this was produced.** Grounded code review (not generic advice), plus real measurements:
a production build (bundle sizes), the running app's DOM/network behaviour, and the test suite.
Depth varies by subsystem — stated per finding:

- **Deep review:** the AI Compatibility subsystem (engine, re-score service, worker, hash guard, display),
  the worker roster, notification/polling/socket wiring, the score display layer.
- **Sampled review:** individual routes/components (representative reads + pattern greps), design-token
  usage, accessibility primitives. A per-endpoint `EXPLAIN`-under-load pass and a full component-by-component
  a11y sweep are the natural *next* step, not done here.

**Explicitly EXCLUDED (already-documented roadmap / "Future" — do not implement now):**
- Worker-process split + Redis adapter + horizontal scaling (SKILL §25).
- Production Semaphore SMS funding/activation (`docs/sms-notification-proposal.md` §6a).
- Pre-public **security rotation** (`GOOGLE_CLIENT_SECRET` fallback `authRoutes.js`, `.env` in git history)
  and **email domain auth** (SPF/DKIM/DMARC) — standing items, tracked in memory.
- AI scoring **Tier-2 scale anchors** (spread the top end; SKILL §21) — deferred pending real fixtures.
- Separate dev/prod database (currently one shared TiDB).
- Render Starter upgrade / cold-start elimination.

**Headline:** the system is architecturally sound and the invariants hold. **No P0 (functional / security /
data-integrity) defect was found within audit scope.** The highest-value work is (a) making the AI score
*auditable and explainable* for the defense, and (b) trimming a redundant tab-focus refetch waterfall.

---

## Phase 1 — Architecture & subsystem integrity

**Healthy — keep as-is:**
- Clean layering (routes parse/authorize → services own rules/transactions → repositories own SQL).
- One axios instance (`src/api.js`); one notification writer (`notificationService`, invariant 0.11);
  seven outbox workers wired through the single `startWorkers.js` bootstrap (web + `worker.js` can't drift).
- DB-as-job-store everywhere (no `setTimeout`/broker); transactional referral approval; graceful degradation.

**Findings:**
| id | finding | evidence |
|----|---------|----------|
| **A1** | **Tab-focus refetch waterfall** (cross-cutting → Phase 4/5). Multiple independent `visibilitychange` refetches fire on *every* tab return. | `NotificationContext.jsx:244-251` (45s poll + focus), `ChatContext.jsx:119-127` (focus), `PesoAdminATS.jsx:198-207` (interval + focus). On one tab-return, a PESO Admin on the ATS fires ≥3 requests. |
| **A2** | `jobMatchWorker` / `proactiveReferralWorker` / `smsWorker` are started **without `io`** in `startAllWorkers`, so any real-time nudge they might emit is dark even in single-process mode. Low impact (they may not emit), but worth confirming vs. the Scoring/Referral workers which *do* get `io`. | `startWorkers.js:39-43` |
| **A3** | The persisted score carries **no provenance** (model / provider / prompt version) — see Phase 6 F1. | `aiScoringService.js:202-208` |

**Not a defect (documented):** two card implementations exist — the token-styled seeker `EventCard` and the
bespoke-palette `LandingEventCard` — because the LandingPage is intentionally excluded from the design tokens
(§24). This is deliberate, not duplication to eliminate.

---

## Phase 2 — Frontend UX/UI

**Strong baseline:** centralized design tokens with a mandatory interaction-state gate (§24.1), a reusable
`EmptyState`/`GettingStartedGuide` system across ~24 surfaces (§27), shared `Pagination` + `BulkActionBar`,
one status-colour system for applications (§28). Visual consistency *within the token app* is good.

**Findings:**
| id | finding | evidence |
|----|---------|----------|
| **B1** | **Sub-score colours are hardcoded**, not tied to the value: Skills always emerald, Education always amber, Experience always emerald — so a **"Low"** skills match still renders green. Misleading. | `PublicJobBoard.jsx:707-709` |
| **B2** | The AI's **one-sentence rationale (`summary`) is computed AND persisted but never displayed.** The seeker sees only a number, band, bar, and High/Med/Low sub-scores. (→ Phase 6 F2.) | engine returns `summary` (`aiScoringService.js:207`), stored in `ai_analysis` (`applicationRoutes.js:455`), absent from the board panel (`PublicJobBoard.jsx:664-709`). |
| **B3** | Two visual languages coexist (bespoke marketing LandingPage vs. token-driven app). **Intentional & documented (§24)** — keep; noted only so it isn't "fixed" by mistake. | — |

The recent **discovery-first landing reorder** (§34.1) already addressed the "scroll past marketing to reach
search results" complaint; no further landing-order work needed.

---

## Phase 3 — Accessibility & responsive design

**Strong baseline (§10 WCAG pass):** a global `prefers-reduced-motion` catch-all and a global keyboard
`:focus-visible` outline are enforced in `index.css`; the compatibility bar exposes `role="progressbar"` +
`aria-valuenow/min/max` + `aria-label` (`PublicJobBoard.jsx:698`). Responsive verified (the Events carousel is
1-col on mobile with no horizontal page overflow).

**Findings:**
| id | finding | evidence |
|----|---------|----------|
| **C1** | Modals close on Esc/backdrop but do **not trap focus** or **restore focus to the trigger** on close (WCAG 2.4.3 focus order). Keyboard/screen-reader users can tab "behind" the modal. | `Events.jsx` EventModal; `LandingPage.jsx` `LandingEventModal` (built this session). |
| **C2** | The two-row horizontal carousel is keyboard-reachable (cards are `<button>`s) but has **no visible scroll affordance** for the off-screen columns beyond native scrollbar. Acceptable; note for polish. | `LandingPage.jsx` `#events` |
| **C3** | Spot-check: confirm every styled `<select>` (status dropdowns) carries an `aria-label` per the §10 rule — sampled ones comply; a full sweep wasn't done. | (sampled) |

---

## Phase 4 — Frontend performance

**Real bundle data (production build):**
- `DocumentBuilder` **1,825 kB (592 kB gzip)** — route-lazy ✅ (loads only when a builder opens).
- `ComposedChart` (recharts) **389 kB (110 kB gzip)** — route-lazy ✅.
- **`index` (entry) 527 kB (156 kB gzip)** — the initial-load bundle; **includes the LandingPage** (heavy
  marketing page with the SVG carousel) shipped to *every first-time visitor*.

**Findings:**
| id | finding | evidence / benefit |
|----|---------|---------|
| **D1** | **Debounce the focus refetches (A1).** Each `visibilitychange` handler should skip if it fetched within the last ~20–30 s. Sockets are the primary path; polls/focus are backstops (§18.9) — so debouncing cuts the tab-switch/idle-return request storm **without removing the backstop**. Biggest measurable request reduction for least effort. | `NotificationContext`, `ChatContext`, `PesoAdminATS` |
| **D2** | **Route-lazy the LandingPage** (or split its carousel SVGs) so the entry bundle shed the marketing page for signed-in users. Charts + DocumentBuilder are already lazy; the LandingPage is the remaining large always-loaded chunk. | `App.jsx` route for `/` |
| **D3** | Events base64 banners are already bounded via `?limit` (§34). No action. | — |

Caching (board `/match`, `/similar`, `/stats`) is in place (§22) — keep.

---

## Phase 5 — Backend / API performance

**Findings:**
| id | finding | evidence |
|----|---------|----------|
| **E1** | The tab-focus waterfall (A1/D1) also lands on the backend as **redundant `/notifications`, `/messages/unread`, and applicant refetches** on every focus. The **client-side debounce (D1) fixes both** ends — no backend change needed. | as A1 |
| **E2** | "Only process when data changes" is **largely satisfied**: the re-score input-hash guard (§29, live) skips redundant DeepSeek calls; REFERRED apps are excluded from re-scoring (§18.5); the debounce collapses edit bursts. Good. | `applicationScoringWorker.js:113-133` |
| **E3** | **N+1 / index pass not exhaustively done.** Convention is explicit column lists + subquery `referred_count`; sampled endpoints showed no obvious N+1. A per-endpoint `EXPLAIN` under real concurrency via `/admin/timing` is the next step (partly Future). | (sampled) |

---

## Phase 6 — AI Compatibility Match Score (deep) — **the defense document**

> Goal: make the % **explainable, reproducible, auditable, and defensible** — not an unexplained AI number.
> Primary engine: `services/aiScoringService.js`. This section answers each required question with evidence.

### 6.1 How it works today (answering the required questions)

1. **Evidence extracted from the résumé:** the most recent parsed résumé **text** (`uploaded_resumes.parsed_text`,
   legacy fallback `resumes.parsed_text`), truncated to **8000 chars**; plus, for an application, extracted
   **PDF supporting-certificate** text (TESDA/licences/training), capped ~800 chars each. Image certs are
   evidence-only (not text-extractable). `aiScoringService.js:22-45`, `applicationScoringService.js:38-63`.
2. **Job fields considered:** `title`, `company`, `description`, `skills`, `qualifications`, experience
   (`required_experience`/`experience`), education (`educational_requirements`/`education`), and `gender`
   (stated preference, mig 040). `buildScoringPrompt` `aiScoringService.js:64-99`.
3. **How the score is produced:** ONE assembled prompt → `deepseek/deepseek-chat` via the unified `aiClient`
   at **temperature 0 + JSON mode**, returning `{ overall 0-100, skills/education/experience High|Med|Low,
   summary }`. Rules: score **only against stated requirements**; certs are supporting, not mandatory;
   unstated gender never penalized. `aiScoringService.js:73-99, 172-180`.
4. **Normalization:** `overall` is coerced to a finite number and **rounded**; anything outside 0–100 (or
   NaN/"high") is rejected as a hallucination → **NULL**. Only `overall` is numeric; sub-scores stay
   qualitative to avoid false precision. `aiScoringService.js:193-208`.
5. **What causes a re-score:** a résumé change, a profile-linked evidence change, a **new certificate**, or a
   **job edit** re-arms the applicant's/ job's ACTIVE applications (debounced ~90 s, deduped). Apply-time
   scoring runs once at submit. `applicationScoringService.js:69-111`.
6. **When scores persist:** apply-time `match_score` + full `ai_analysis` (incl. `summary`) + `ai_scored_at`
   are written at submit and are **immutable** (the referral decision's source of truth). The live re-score
   writes only `current_match_score` / `current_ai_analysis` / `scored_at`. `applicationRoutes.js:455`,
   `applicationScoringWorker.js:15-19,147`.
7. **Display — Job Seeker vs PESO Admin:** the seeker board shows the **numeric `overall` %** (primary) + a
   qualitative band ("Strong/Good/Moderate/Low") + a progress bar + High/Med/Low sub-scores, with an explicit
   **"AI Compatibility Unavailable"** state for NULL. The admin pipeline **ranks** by
   `current_match_score ?? match_score`. `PublicJobBoard.jsx:664-709`, `applicationRoutes.js:189`.
8. **Effect on ranking/recommendations:** the live score orders the Applicant Pipeline and the AI-Recommended
   queue; the board number is the same engine (unified in Tier-1, §21).
9. **Threshold ↔ Smart Referral Queue / proactive:** a re-score crossing the **referral AI threshold**
   (system setting, **bounded 50–80**, read per call) STAGES a `Pending Review` recommendation — it **does
   not approve** (invariant 0.4; a named admin approves every referral). `applicationScoringService.js:125-149`.
10. **AI provider failure:** `aiClient` does OpenRouter→DeepSeek **failover + circuit breaker**; if no result,
    `scoreApplication` returns **NULL** — never a fabricated number. `aiScoringService.js:150-213`.
11. **Stale / unavailable scores:** on NULL the worker **keeps the previous live score** and completes the job
    (never overwrites with a guess). NULL at the display layer renders the "Unavailable" card.
    `applicationScoringWorker.js:137-142`.
12. **Can the same (candidate, job) give inconsistent scores?** Within one provider + model version — **no**
    (temp 0 + JSON mode is reproducible; the eval harness measured MAE 3.6 / 100 % band accuracy, §21). The
    **only** drift sources are a **provider failover** (OpenRouter vs DeepSeek-direct may serve slightly
    differently) or a **model version update**. The persisted apply-time score is immutable and the input-hash
    guard avoids needless recomputation, so drift is bounded — see F3.
13. **Safeguards against arbitrary/random/misleading %:** the historical `Math.random()` score is gone; the
    **NULL contract** (0.2) forbids fabrication; a single engine/prompt/hash prevents divergence; the threshold
    is bounded so no admin can quietly flood the queue; staging ≠ approval. `aiScoringService.js:5-20,193-213`.

### 6.2 Findings — strengthen the defensibility (this is the high-value work)

| id | finding | benefit |
|----|---------|---------|
| **F1** | **Stamp provenance on every score.** Persist `{ model, provider, promptVersion, scoredAt }` alongside `ai_analysis`, so any displayed % is fully auditable ("85 %, produced by `deepseek-chat` via OpenRouter, prompt v1, 2026-08-24"). Directly answers Q10/Q12 for the defense. Low effort (extend the JSON / add columns; the worker already knows the provider it used). | Highest academic/defense value. |
| **F2** | **Surface the `summary` rationale** (already computed + stored) in the seeker board *and* the admin pipeline. Turns the number into an explained number ("Strong skills overlap; 2 yrs vs 3 yrs experience"). Near-zero cost — data exists. | Biggest explainability win for least effort. |
| **F3** | **Document the reproducibility boundary** (this doc + `docs/system-guide.md`): deterministic within provider+model; failover/model-update is the only drift; immutable apply-time score + hash guard bound it. Defensible, honest. | Removes the "why did it change?" question at defense. |
| **F4** | Fix the sub-score colour bug (B1) so High/Med/Low drives the colour. | Correctness of the explainability UI. |

**Keep unchanged (correct):** the engine, the NULL contract, temp-0 determinism, the immutable apply-time
score, the input-hash guard, threshold bounding, staging-not-approval. **Tier-2 scale anchors = Future.**

---

## Phase 7 — Notification & synchronization audit

**Channels present & healthy:** durable in-app rows (single writer, row-first-then-socket, never throws);
email via the outbox + provider chain; SMS via the outbox + provider-agnostic `smsService` (referral +
account-lifecycle types only); real-time Socket.IO with poll backstops (§18.9). Dedupe exists
(`notifyNewMessage` collapses unread; SMS fan-out per-type bucket, §33.1).

**Findings:**
| id | finding | evidence |
|----|---------|----------|
| **G1** | The redundant refetch waterfall (A1/D1) is the main *synchronization* issue — not a missing channel. Debounce (D1) resolves it. | as A1 |
| **G2** | **No duplicate-notification defect found** in sampled paths; dedupe is deliberate and per-type. | `notificationService` |
| **G3** | Verify (not confirmed here) that every terminal action notifies the seeker consistently — e.g. referral **Void/decline** and each ATS status change. Outcome sync (§26) + `APPLICATION_STATUS` cover the main paths; a matrix check is a cheap P3. | (sampled) |

---

## Phase 8 — Decision matrix

Priority: **P0** functional/security/data-integrity · **P1** high-impact UX/perf · **P2** important refinement
· **P3** polish · **Future** documented roadmap (don't implement now).

| id | Finding | Subsystem | Pri | Complexity | Expected benefit | Perf impact | Regression risk | Implement now? |
|----|---------|-----------|-----|-----------|------------------|-------------|-----------------|----------------|
| **F1** | Stamp score provenance (model/provider/promptVersion) | AI scoring | **P1** | Low–Med (schema + worker write) | Score becomes fully auditable/defensible | none | Low (additive) | **Yes** |
| **F2** | Surface the AI `summary` rationale (seeker + admin) | AI scoring UI | **P1** | Low (data exists) | Score becomes *explained*, not raw % | none | Very low | **Yes** |
| **D1** | Debounce focus refetches (notif/chat/ATS) | FE + API perf | **P1** | Low | Kills tab-switch/idle request storm | ↓ requests | Low (keep polls as backstop) | **Yes** |
| **B1/F4** | Sub-score colours reflect High/Med/Low | FE UI / AI UI | **P2** | Trivial | Removes a misleading green "Low" | none | None | **Yes** |
| **F3** | Document AI reproducibility boundary | Docs | **P2** | Low | Defense readiness | none | None | **Yes** |
| **C1** | Modal focus-trap + focus-restore | A11y | **P2** | Low–Med | WCAG 2.4.3 for keyboard/SR users | none | Low | **DONE** (`useFocusTrap`) |
| **D2** | Route-lazy the LandingPage | FE perf | **P2** | Low | ~26 kB gzip smaller entry (signed-in users) | ↓ initial JS | Low–Med (landing flash) | **DECLINED** — documented App.jsx decision keeps it eager for the landing first-impression; saving not worth the flash |
| **A2** | Pass `io` to jobMatch/proactive/sms workers (or confirm unneeded) | Architecture | **P3** | Trivial | Real-time parity / clarity | none | None | If confirmed useful |
| **G3** | Notification-coverage matrix check (void/decline/status) | Notifications | **P3** | Low (audit) | Confidence there are no gaps | none | None | Cheap check |
| **C2** | Carousel scroll affordance | A11y/polish | **P3** | Low | Discoverability of off-screen cards | none | None | Optional |
| **E3** | Per-endpoint `EXPLAIN`/index pass under load | API perf | **P2/Future** | Med | Confirm no N+1 at scale | measure-first | — | Partly Future (`/admin/timing`) |
| — | Worker split / Redis / Semaphore funding / security rotation / email domain auth / Tier-2 anchors / dev-prod DB | infra/AI | **Future** | — | (roadmap) | — | — | **No — documented roadmap** |

---

## Cost-vs-impact summary (your nine questions)

1. **Fix immediately (P0):** none — no functional/security/data-integrity defect within audit scope. (The
   security rotation + email domain auth are real but already documented as Future/pre-public.)
2. **Biggest UX win for least effort:** **F2** (show the `summary` rationale) + **B1** (sub-score colours) —
   both near-zero cost, both directly improve how the flagship AI score reads.
3. **Lighthouse / frontend performance:** **D1** (debounce focus refetches) then **D2** (lazy LandingPage).
4. **Reduce backend/AI processing cost:** already strong (hash guard live, referred-excluded); **D1** removes
   redundant queries; no new AI cost is introduced by any recommendation.
5. **Accessibility:** **C1** (modal focus trap/restore) is the one concrete gap; the global baseline is solid.
6. **AI score — technically & academically:** **F1 + F2 + F3** (provenance stamp, surfaced rationale,
   documented reproducibility) — the trifecta that makes the % defensible.
7. **Meaningful regression risk:** only if **D1** is done by *removing* polls instead of *debouncing* them
   (the polls are the socket backstop, §18.9) — debounce, don't delete. Do **not** touch the scoring engine.
8. **Keep unchanged (already correct):** the scoring engine + NULL contract; the seven-worker outbox;
   `notificationService`; transactional referral approval + vacancy cap; the design-token system.
9. **Defer (Future/roadmap):** worker split + Redis, Semaphore funding, security rotation + email domain auth,
   Tier-2 scale anchors, dev/prod DB split, full load-tested index pass.

**Recommended first increment (low risk, high value, ~half a day):** F2 + B1 + F1 + D1 + F3 — they make the
AI Compatibility Score explainable *and* auditable for the defense and cut the tab-switch request storm,
touching no core invariant.
