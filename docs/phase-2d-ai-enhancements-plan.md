# Phase 2D — AI-Centric Enhancements — Implementation Blueprint

**Status:** IMPLEMENTED (A–D), 2026-08-01 — approved and built. B/C-score-feed/D
ship behind feature flags (`APPLICATION_SCORING_ENABLED`, `JOB_ALERTS_ENABLED`);
migrations `029`–`031` apply via `npm run migrate`. Per-phase notes in §8.
**Author:** architecture assessment for the PESO Kabankalan Referral System.
**Scope:** four panel-requested enhancements that deepen the platform's use of the
existing AI Compatibility Match Score and the P2C email outbox.

> This document is a *design for review*. It deliberately stops at "here is what
> we would build and why"; implementation begins only after the open decisions in
> §11 are signed off. It follows the same blueprint shape as
> `docs/phase-2c-email-outbox-plan.md`.

---

## 0. Executive summary

| # | Enhancement | Core idea | Relative size | Depends on |
|---|---|---|---|---|
| A | **Unified Applicant Profile** | One centralized admin view of an applicant (personal, education, employment, skills, certs, documents, resume insights, AI analysis) — no redundant navigation. | M | — |
| B | **AI Applicant Ranking + dynamic re-scoring** | Rank/sort/filter applicants per vacancy by AI Match Score; re-score in the background when a seeker's resume/profile/docs change. | M–L | existing AI score; new scoring worker |
| C | **Supporting Certificates** | Upload one/many certificates (TESDA, licences, seminars…) in the Apply Wizard; store durably; show in the pipeline; optionally feed the AI score. | M | A (display), B (to feed score) |
| D | **AI-Powered Job Alerts** | When a vacancy is published, email seekers whose profile matches above a configurable AI threshold — with reason + link; thresholds, frequency, dedup, digest, admin policy. | L–XL | AI score (reverse), P2C email outbox, B's scoring infra |

**Recommended build order (by risk + dependency):** **A → B → C → D.**
A is low-risk read/UI and lays the pipeline surface B and C plug into; B introduces
the background re-scoring the platform doesn't yet have; C rides B to let certs
influence the score; D is the largest and reuses everything.

**The whole theme:** turn the AI Match Score from a *one-time apply-time number*
into a *living signal* that ranks applicants, reacts to new evidence, and proactively
reaches seekers — without violating the invariant that the score used for a
government referral decision must stay auditable and un-fabricated.

---

## 1. Guiding principles (non-negotiables this must respect)

Every enhancement below is designed around the existing invariants; the plan calls
out where each applies. If a proposal here appears to bend one, §11 flags it as a
decision, never a silent override.

- **0.1 Never fail the primary action for a secondary concern.** Applying,
  editing a profile, or publishing a job must succeed even if scoring, cert
  storage, or an alert fails.
- **0.2 AI returns a real result or `NULL` — never fabricated.** Ranking, alerts,
  and re-scores all treat `NULL` as "not scored → manual", never as 0.
- **0.3 The database is the job store.** All new async work (re-scoring, job
  matching, alert sending) uses the **transactional-outbox + in-process worker**
  pattern (§7.5) — no new broker, no `setTimeout`, no n8n.
- **0.5 / 0.13 Durable binaries live in the DB as base64** in their own table.
  Certificates follow the `application_resumes` model exactly.
- **0.6 Migrations own the schema.** Every schema change is a numbered migration,
  additive, enum changes append-only.
- **0.11 Notifications only through `notificationService`;** email only through the
  **P2C email outbox** (`emailOutboxService`). Job alerts are email + (optionally)
  a bell type — never a fourth ad-hoc channel.
- **§7.12 Tunables are system settings read PER CALL** (thresholds, frequency
  caps, feature toggles), with an env-var fallback — never a module-level const.
- **AI cost is a first-class constraint.** Enhancement D can, if naïve, fan out to
  thousands of AI calls per published job. Bounding that (candidate generation)
  is a design requirement, not an optimisation.

---

## 2. Enhancement A — Unified Applicant Profile view

### A.1 Objective
Give a PESO Administrator, from a single place in the Applicant Pipeline, the
complete picture of one applicant: personal information, contact details,
education, employment history, skills, certifications, uploaded documents, resume
insights (AI Resume Analysis), and the AI compatibility analysis — with no
redundant data entry and no bouncing between screens.

### A.2 Why it is first
It is almost entirely **read + presentation**, touches no AI or async machinery,
and delivers immediate reviewer value. It also creates the surface (a rich
applicant drawer) that Enhancements B (rank badges, score history) and C
(certificate list) slot into, so building it first avoids reworking the pipeline UI
twice.

### A.3 Technical approach
- **One aggregation endpoint**, owner-scoped, powers the view:
  `GET /api/peso-admin/ats/applications/:applicationId/profile`. It returns a single
  composed object rather than making the client stitch five calls.
- **Snapshot vs live (decision §11.1).** An application is a *submitted package*.
  The resume PDF (`application_resumes`), the personal-info **`applicant_snapshot`**
  already stored on `job_applications`, and (Enh. C) the certificates are the
  **immutable record of what was applied with**. Broader profile facets (current
  skills, resume insights) may be *live*. Proposal: the view shows the **submitted
  snapshot as authoritative**, and clearly labels any live-profile section as
  "current profile" so a reviewer is never misled about what the applicant actually
  submitted.
- **Data sources** (all already exist): `job_applications` (status, match_score,
  ai_analysis, applicant_snapshot), `users` (identity/contact/education/employment/
  skills profile fields), `uploaded_resumes.parsed_text` + the AI Resume Analysis
  output (resume insights), `application_resumes` (PDF), plus `application_certificates`
  (Enh. C). **`userprofiles` is only joined if selected from (invariant 0.8)** — it
  holds multiple rows per user and must not be blind-joined; the aggregator reads at
  most one deterministic row or avoids it.

### A.4 Affected modules
- **Backend:** `routes/pesoAdminRoutes.js` (new aggregation route), a new
  `services/applicantProfileService.js` (composes the object; owner-scope +
  snapshot/live policy live here), `repositories` for the reads.
- **Frontend:** `PesoAdminATS.jsx` gains a **"View full profile"** action per
  applicant opening an `ApplicantProfileDrawer.jsx` (new) — sectioned/tabbed
  (Personal · Education · Employment · Skills · Certifications · Documents · Resume
  Insights · AI Analysis). Authenticated document/resume/cert streaming reuses the
  existing blob-fetch pattern (a bearer token can't ride `window.open`).

### A.5 DB / API / performance / security
- **DB:** none for A itself (reads existing tables; certificates arrive in C).
- **API:** one new GET. Stable JSON shape; `safeQuery`-style degradation so a
  missing facet renders "not provided", never 500s the drawer.
- **Performance:** one aggregated request; avoid N+1 (no per-section round trips).
  Do **not** select base64 blobs in the aggregate — list document metadata and
  stream bytes on demand.
- **Security:** owner-scoped (`peso_admin_id = req.userId`); an admin can only open
  applicants to jobs they published (§12). PII stays behind auth; nothing to
  `/uploads`.

---

## 3. Enhancement B — AI Applicant Ranking + dynamic re-scoring

### B.1 Objective
In the Applicant Pipeline, rank/sort/filter applicants for a vacancy by AI Match
Score so the strongest candidates surface instantly, while manual evaluation stays
fully available. Re-score **dynamically** when an applicant changes their resume,
profile, or supporting documents so the displayed ranking stays accurate.

### B.2 The central design tension (decision §11.2)
Today the apply-time score is **immutable and is the source of truth** (§7.4): it is
what a referral decision and the referral record rest on, and referral *staging*
fires once, at apply time, when it clears the threshold. The panel wants a score
that **changes** as evidence changes. These pull in opposite directions.

**Proposal — two scores, one immutable, one live:**
- Keep `job_applications.match_score` / `ai_analysis` as the **immutable apply-time
  score** — untouched, still the referral record and the staging trigger.
- Add **`current_match_score`**, **`current_ai_analysis`**, **`scored_at`** — the
  *living* score the ranking uses (falls back to the apply-time score until first
  re-score).
- **Re-scoring updates only the live score.** It does **not** retroactively re-stage
  referrals or change a decided application. A rise above the referral threshold
  after the fact is surfaced to the admin as *information* ("live score now 82% —
  consider referral"), never an automatic action (preserves 0.4 "a named admin
  approves every referral" and the apply-time staging contract).

This keeps the audit trail honest (the number behind a referral never mutates) and
still gives the panel a live ranking.

### B.3 Technical approach — the re-scoring worker (outbox pattern, §7.5)
- **New outbox table `application_scoring_jobs`** (application_id, status, attempts,
  max_attempts, next_run_at, locked_at, worker_id, last_error, dedupe on
  application_id) — a direct sibling of `referral_jobs` / `email_outbox`.
- **New worker `services/applicationScoringWorker.js`** — single-step ("score"),
  mirrors `emailWorker`: poll → atomic claim → call
  `aiScoringService.scoreApplication()` → write `current_match_score` / `scored_at`
  → backoff/dead-letter. Gated by a flag (`APPLICATION_SCORING_ENABLED`) for a
  clean rollback, like the email worker.
- **Enqueue triggers** (each wrapped, non-fatal — 0.1):
  - resume change (builder save / PDF upload → `uploaded_resumes.parsed_text`),
  - profile change (skills / education / experience),
  - certificate upload (Enh. C).
  Each enqueues a re-score **only for that seeker's ACTIVE applications**
  (status in Applied / Under Review — never Rejected / Hired / Referred / Voided).
- **Debounce / dedupe (performance, decision §11.3).** A profile edit must not fire
  an immediate AI call per application. The outbox row is **deduped per application**
  (`ON DUPLICATE KEY` re-arms one pending job) and `next_run_at` is set a short
  quiet-period out (e.g. 60–120s), so rapid successive edits collapse into one
  re-score. Concurrency is bounded by the worker's small batch size; the aiClient's
  circuit breaker + failover already protect against provider issues.
- **NULL-safety (0.2).** A failed/uncertain re-score keeps the previous live score
  and leaves `scored_at` stale rather than writing a fabricated or zero value; the
  UI can show a subtle "score may be out of date" hint.

### B.4 Ranking / sort / filter (extends the Phase 1 pagination)
- The cross-job ATS list (`GET /peso-admin/ats/applicants`) and the per-job list
  gain **server-side sort** (`sort=match_desc|match_asc|applied_desc`) and a
  **score-band filter** (`minScore`), building directly on the pagination shipped in
  Phase 1. Rank is derived (position within the sorted, filtered set).
- **UI:** a "Sort by AI Match" control + score-band chips; rank badges (#1, #2…) and
  a score pill per row; a "not scored → manual review" state (never a fake 0);
  optional "live score updated Xh ago" indicator. Manual status changes are
  untouched — ranking never blocks a manual decision.

### B.5 DB / API / testing / security
- **DB (migration):** `application_scoring_jobs` outbox + the three
  `job_applications` live-score columns.
- **API:** ATS list endpoints gain `sort` + `minScore`; an optional admin
  `POST /peso-admin/ats/rescore` (re-arm scoring for a job's active applicants) for
  manual refresh.
- **Testing (`node --test`, now wired):** active-vs-decided selection; dedupe/quiet
  window collapsing edits; immutable-score-untouched invariant; NULL keeps old
  score; sort/filter SQL. AI itself is mocked (no prod write path).
- **Security:** re-scoring is system-initiated and owner-agnostic but only reads the
  seeker's own data; ranking endpoints stay owner-scoped.

---

## 4. Enhancement C — Supporting Certificates

### C.1 Objective
Let applicants attach one or many supporting documents (TESDA certifications,
professional licences, training/seminar certificates, etc.) during application;
store them securely and durably; validate them; and display them in the Applicant
Pipeline beside the resume and AI results. Decide whether they also feed the score.

### C.2 Storage model (decision §11.4)
Two viable shapes:
- **(Recommended) User certificate *library* + per-application *snapshot*.** A
  seeker manages a reusable library in their profile; at apply time the selected
  certs are **snapshotted** (base64 copy) into the application package. This mirrors
  the resume model exactly (builder resume → immutable per-application PDF snapshot),
  avoids re-uploading the same licence for every application, and keeps the submitted
  package immutable for audit.
- (Simpler alternative) **Per-application only** — upload at apply time, no library.
  Less convenient for repeat applicants; still valid.

Either way: **durable base64 in its own table** (0.5/0.13), memory-multer +
validation, never on `/uploads` (PII).

### C.3 AI contribution (decision §11.5)
- **Phase 1 (recommended default): evidence only.** Certs are stored, validated,
  displayed, and downloadable for manual review — **no AI change**, lowest risk.
- **Phase 2 (opt-in extension): certs feed the score.** Extract text from **PDF**
  certs via the existing `pdfTextService`, append it to the scoring context, and let
  a cert upload **trigger a re-score through Enhancement B's worker**. This is where
  B and C compose cleanly: upload a licence → re-score → ranking reflects it. Image
  certs (JPG/PNG) are evidence-only unless OCR is later added (explicitly out of
  scope now).

### C.4 Affected modules / DB / API / security
- **DB (migration):** `application_certificates` (application_id, file_name,
  mime_type, byte_size, content_base64, `parsed_text` NULL for PDF-fed scoring,
  uploaded_at) and — if the library model is chosen — `user_certificates`
  (user_id + same columns). Counts/size caps enforced in the service.
- **Backend:** apply endpoint (`applicationRoutes`) accepts certs (multipart, memory
  storage), validates (type ∈ PDF/JPG/PNG/WEBP, per-file ≤ ~5 MB, ≤ N files),
  stores base64; profile routes manage the library; a new owner-scoped streaming
  route serves a cert to the admin (blob fetch, like the resume).
- **Frontend:** Apply Wizard gains a **Certificates** section/step (multi-select,
  list, remove, progress); Profile gains library management; the
  `ApplicantProfileDrawer` (Enh. A) lists certs with view/download.
- **Security/validation:** MIME + magic-byte sanity, size/count caps, base64 in DB,
  owner-scoped retrieval, never public. A malformed upload fails the upload, never
  the whole application (0.1).

---

## 5. Enhancement D — AI-Powered Job Alerts

### D.1 Objective
When a vacancy is published, proactively email job seekers whose profile/resume
matches it above a configurable AI compatibility threshold. The email carries the
job title, employer, match score/level, a short **why-recommended** rationale, and a
direct link to apply. Bounded by thresholds, frequency controls, duplicate
prevention, batching/digest, and administrator-configurable policies.

### D.2 The hard part: reverse scoring at bounded cost (decision §11.6)
Apply-time scoring is *one seeker × one job*. This is *one job × many seekers* — a
naïve implementation is **one AI call per active seeker per published job**, i.e.
potentially thousands of calls and dollars per posting. **This is the make-or-break
constraint.** The design is a standard recommendation funnel:

```
 New job published
   → CANDIDATE GENERATION (cheap, SQL): shortlist seekers by keyword/skill overlap,
     category, and location — plus "has a parsed resume" and "opted in". Cuts the
     set from thousands to tens.
   → RANKING (AI): score only the shortlist via aiScoringService (reverse: job vs
     each seeker's parsed_text), through aiClient (failover + circuit breaker).
   → THRESHOLD: keep matches ≥ job_alert_ai_threshold (system setting).
   → DELIVER: per-seeker frequency policy → immediate email (via P2C outbox) OR
     stage for the daily digest; dedupe so the same seeker+job is never alerted twice.
```

Candidate generation is what makes this affordable; without it the feature is not
viable. The shortlist size cap is itself a system setting.

### D.3 Async architecture (outbox pattern, §7.5)
- **On publish:** creating/publishing an Open/Published job **enqueues a job-match
  task** (`job_alert_jobs` outbox, keyed by job_id) — the publish request returns
  immediately (0.1); matching happens in the background.
- **`services/jobMatchWorker.js`** drains it: candidate-generate → AI-score shortlist
  → threshold → for each match, either enqueue an alert email now or record it for
  the digest. Backoff/dead-letter/stuck-reclaim like every other worker. Flag-gated
  (`JOB_ALERTS_ENABLED`).
- **Emails ride the P2C email outbox** (`emailOutboxService.enqueue`, category
  `job_alert`) — durable retry/dead-letter/admin-resend for free.
- **Digest option** reuses the Phase 2 `notificationDigest` machinery (a daily tick,
  DB last-run marker, no cron) — a per-seeker daily "N new matching jobs" email.
- **Optional bell type** `JOB_ALERT` via `notificationService` for in-app parity —
  muteable through the Notification Center already shipped.

### D.4 Controls, consent, policy
- **System settings (§7.12):** `job_alerts_enabled` (master), `job_alert_ai_threshold`,
  `job_alert_max_per_day`, `job_alert_default_frequency`, `job_alert_candidate_cap`.
- **Per-seeker preferences:** opt-in/out, frequency (immediate | daily digest | off),
  personal minimum score. Stored in a new `job_alert_preferences` table (or folded
  into notification preferences). **Consent + an unsubscribe link in every alert
  email** are required (anti-spam / good practice), independent of the bell mute.
- **Dedup + audit:** `job_alerts_sent` (user_id, job_id, match_score, sent_at)
  guarantees one alert per seeker+job and gives an auditable record of who was
  notified and why.

### D.5 DB / API / performance / security / testing
- **DB (migrations):** `job_alert_jobs` outbox, `job_alerts_sent`,
  `job_alert_preferences`; system-settings keys registered in
  `systemSettingsService`.
- **API:** seeker `GET/PUT /api/notifications/job-alerts` (prefs); admin policy via
  the existing `/admin/settings`; an admin monitor (matches attempted, alerts sent,
  dead-lettered) mirroring the Email Delivery / Workflow Automation pages; a public
  unsubscribe endpoint (tokened).
- **Performance:** candidate cap + shortlist scoring + worker batch size + circuit
  breaker keep AI spend bounded and predictable; matching never blocks publishing.
- **Security/privacy:** matching reads seeker resumes internally; alert emails go
  **only to the matched seeker about a public posting** (no third-party PII leak);
  unsubscribe honoured; opt-out respected before any scoring even runs (a seeker who
  opted out is excluded at candidate generation, saving the AI call).
- **Testing:** candidate generation SQL; threshold + dedupe + frequency/digest logic;
  unsubscribe token; "opted-out never scored". AI mocked.

---

## 6. Cross-cutting architecture

- **Shared scoring core.** B (seeker→their jobs) and D (job→many seekers) are the
  same `aiScoringService` used in two directions. Extract a small reusable
  `scoreResumeAgainstJob(parsedText, job)` so both call one implementation; keep the
  `aiClient` failover/breaker underneath.
- **One async pattern, several outboxes.** `application_scoring_jobs`, `job_alert_jobs`
  join `referral_jobs` and `email_outbox` as siblings. Consider a thin shared
  worker-loop helper (claim/backoff/reclaim) so we stop hand-copying that shape — a
  modest refactor that pays off across four workers. (Optional; not required for
  correctness.)
- **Feature flags for the big two.** B (`APPLICATION_SCORING_ENABLED`) and D
  (`JOB_ALERTS_ENABLED`) ship dark and flip on when validated — the same rollback
  posture as `EMAIL_OUTBOX_ENABLED`.
- **AI budget guardrail.** A single system setting caps total AI scoring calls per
  hour across B + D so a burst (bulk profile edits, many publishes) can't run up
  cost; over the cap, work defers via `next_run_at` rather than failing.

---

## 7. Database migration summary (proposed, additive, numbered 029+)

| Migration | Adds | For |
|---|---|---|
| 029 | `application_certificates` (+ `user_certificates` if library model) | C |
| 030 | `job_applications`: `current_match_score`, `current_ai_analysis`, `scored_at` (+ optional `score_stale`); `application_scoring_jobs` outbox | B |
| 031 | `job_alert_jobs` outbox, `job_alerts_sent`, `job_alert_preferences` | D |

All additive `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`; enum changes
append-only; no drops on live TiDB (§0.7). New `system_settings` keys are seeded by
registration in `systemSettingsService`, not by migration (table stays empty by
design). A (unified profile) needs **no** migration.

---

## 8. Phased sequence & dependencies

1. **Phase A — Unified Applicant Profile** (M). **IMPLEMENTED 2026-08-01 (pending
   review).** `services/applicantProfileService.js` + `GET /peso-admin/ats/
   applications/:id/profile` (owner-scoped, snapshot-authoritative + labelled live,
   userprofiles 0.8-safe richest-row, no base64 in the aggregate) and
   `components/ApplicantProfileDrawer.jsx` opened from every ATS applicant card. No
   AI, no async, no migration. Foundation for B/C UI.
2. **Phase B — Ranking + re-scoring** (M–L). **IMPLEMENTED 2026-08-01 (pending
   review).** Migration **029** (live-score columns + `application_scoring_jobs`
   outbox); `applicationScoringWorker` (dark behind `APPLICATION_SCORING_ENABLED`);
   enqueue triggers on profile + resume change; ATS `sort`/`minScore` + rank UI +
   health probe. Apply-time score stays immutable; re-scoring never auto-stages a
   referral. (Note: this took migration number 029 since B shipped before C.)
3. **Phase C — Certificates** (M). **IMPLEMENTED 2026-08-01 (pending review).**
   Migration **030** (`user_certificates` library + `application_certificates`
   snapshot). C.1: Apply-Wizard multi-upload → validated durable base64 → owner-
   scoped stream → shown in the applicant drawer. C.3: PDF cert text feeds the LIVE
   score via B's worker (image certs evidence-only). **C.2 (profile library reuse
   across applications) is now DONE** (verified in code 2026-08-02): `/profile/certificates`
   CRUD + owner-scoped streaming (`certificatesRepository`), `CertificateLibrary.jsx` mounted
   as Profile → Portfolio, and the Apply Wizard "From your library" picker snapshots selections
   as `user_certificate_id` on submit. All of Phase C (C.1–C.3) is complete.
4. **Phase D — AI Job Alerts** (L–XL). **IMPLEMENTED 2026-08-01.** Migration `031`
   (job_alert_jobs outbox, job_alerts_sent dedup, job_alert_preferences);
   `jobMatchWorker` (candidate generation → AI score → threshold → immediate email
   via the P2C outbox or the marker-paced daily digest); publish triggers; seeker
   prefs (Notification Center) + public unsubscribe + Super Admin monitor + health
   card; tunables as system settings. Behind `JOB_ALERTS_ENABLED`.

Each phase is independently shippable and independently revertable (flag or commit).

---

## 9. Testing strategy

- **Unit (`npm test` → `node --test`, already wired):** pure logic — active/decided
  selection, dedupe/quiet window, immutable-score invariant, candidate generation
  filters, threshold/frequency/digest, unsubscribe token, cert validation. **AI is
  always mocked** — no test ever exercises a real scoring call or a prod write path.
- **Integration (local/staging):** enqueue → claim → score/send transitions; outbox
  backoff/dead-letter; flag on/off equivalence.
- **Manual (prod-safe, §13):** read-only probes and rolled-back transactions only;
  verify with `npm run build` + `node --check`; **never exercise a write path
  against production**; anything behind auth is a stated manual step.
- **Health surfaces:** extend `/admin/health` with scoring-worker and job-alert
  backlog, mirroring the referral/email probes.

---

## 10. Deployment & rollback

- **Additive migrations**, applied with `npm run migrate` (runner targets prod —
  read the announced host); confirm with `npm run migrate:status`.
- **Flag-gated rollout:** merge dark → run migration → flip
  `APPLICATION_SCORING_ENABLED` / `JOB_ALERTS_ENABLED` → watch the health/monitor
  pages → leave on. Rollback = flip the flag (no deploy); code rollback = revert the
  phase's commits; leave additive tables in place (never drop on live TiDB).
- **Incremental within a phase** (e.g. certs evidence-only before certs-feed-score;
  immediate alerts before digest) so each step is small and observable.

---

## 11. Open decisions requiring approval (please rule on these)

1. **Unified view — snapshot vs live.** Show the **submitted application package as
   authoritative** with clearly-labelled "current profile" sections? (Recommended.)
2. **Immutable vs dynamic score.** Keep the apply-time score immutable for the
   referral record and add a separate **live score** for ranking, with re-scoring
   never auto-staging referrals? (Recommended — respects 0.2/0.4/§7.4.)
3. **Re-score cadence.** Debounced background re-score (≈60–120s quiet window,
   deduped per application, active applications only) rather than instant per-edit
   AI calls? (Recommended for cost/stability.)
4. **Certificate storage.** Reusable **profile library + per-application snapshot**
   (Recommended) vs per-application-only?
5. **Do certificates feed the AI score?** Start **evidence-only**, then an opt-in
   Phase 2 where PDF cert text feeds a re-score? (Recommended) — or feed the score
   from day one?
6. **Job-alert matching cost model.** Approve **candidate generation (cheap SQL
   shortlist) → AI-score the shortlist only**, with a configurable candidate cap and
   an AI-calls-per-hour budget? (Required for viability.)
7. **Alert delivery default.** Default new seekers to **daily digest** (opt-up to
   immediate) or **immediate** (opt-down to digest/off)? Plus: confirm an
   **unsubscribe link** in every alert email.
8. **Feature flags & sequence.** Approve **A → B → C → D**, each behind a flag where
   noted, shipped dark then flipped?

---

## 12. Invariants respected (quick map)

0.1 primary action never fails · 0.2 real-or-NULL AI · 0.3 DB is the job store
(outbox+worker, no new mechanism) · 0.4 a named admin still approves every referral
(re-scoring never auto-stages) · 0.5/0.13 durable base64 binaries · 0.6 migrations
own schema · 0.8 no blind `userprofiles` join · 0.11 notifications via
`notificationService`, email via the P2C outbox · §7.5 one async pattern · §7.12
tunables are per-call system settings.
