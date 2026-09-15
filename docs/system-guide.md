# PESO Kabankalan Employment System — Developer & Demonstration Guide

**Purpose:** a single reference for explaining what each part of the system does,
how it works, when it runs, and why it was built that way. Written to be read
under questioning — each section answers *what / how / when / why* directly.

**Companion material:** `docs/referral-management-enhancement.md` (the referral
review and roadmap). Per-file detail lives in the header comment of each module;
this document is the map that tells you which file to open.

---

## 1. One-paragraph description

A government employment platform for the Public Employment Service Office of
Kabankalan City. Job seekers register, build or upload a resume, browse
vacancies posted by PESO administrators, and apply. An AI scores how well each
applicant matches the job. Administrators work applicants through a pipeline and
approve referrals; the system then generates an official PESO referral letter as
a PDF, emails it to the applicant, and tracks whether it resulted in a hire.
Every step is recorded in an audit trail.

**The three actors**

| Actor | Stored role | Sees | Does |
|---|---|---|---|
| Job Seeker | `applicant` | `AppLayout` | Applies, tracks applications, chats, receives referrals |
| PESO Administrator | `peso_administrator` | `AppLayout` | Posts vacancies, works the ATS, approves referrals, records outcomes |
| Super Administrator | `admin` | `AdminLayout` | Platform metrics, moderation, audit |

**Careful in the demo:** the stored role string differs from the display label.
`peso_administrator` displays as "PESO Administrator", and `employer` is a legacy
alias kept for old rows. Always compare through `normalizeRole()`, never against
a raw string. This has caused real bugs — see §7.

---

## 2. Architecture at a glance

```
Browser (React 18 + Vite)
   │  axios ─── JWT in sessionStorage
   │  socket.io-client ── one connection, owned by ChatContext
   ▼
Express API  (server.js — mounts every router under /api)
   │
   ├── routes/       HTTP only: parse, authorize, respond
   ├── services/     business rules and transaction boundaries
   ├── repositories/ SQL
   │
   ├── referralWorker.js   in-process background worker, polls every ~5s
   └── socketServer.js     realtime chat + notification push
   ▼
TiDB (MySQL-compatible) via a mysql2 pool
   │
   └── Make.com (downstream consumer only — never orchestrates;
       AUTOMATION_WEBHOOK_URL; replaced the retired self-hosted n8n, 2026-09)
```

**Layering rule.** Routes never contain SQL. Services never write HTTP
responses. If you are asked "where would I add X?", the answer follows this
split.

**Why an in-process worker rather than a queue service.** The deployment is a
single Render instance; adding Redis or a queue broker would add a component
that can fail independently for no benefit at this scale. The database *is* the
queue — see §6.

---

## 3. Authentication and accounts

**Files:** `routes/authRoutes.js` · `services/otpService.js` ·
`middleware/authMiddleware.js` · `middleware/rbac.js`

**What.** Email/password registration with mandatory email verification, plus
Google sign-in. JWT sessions.

**How registration works (two steps).**

1. `POST /api/auth/register` — validates, hashes the password with bcrypt,
   stages the signup in `email_verifications`, emails a 6-digit code.
   **No `users` row is created.** Responds `202 verification_required`.
2. `POST /api/auth/register/verify` — checks the code; only here is the account
   created. The user then signs in normally.

**When.** Only for new signups. Existing accounts are never asked to verify.

**Why staged rather than a `verified = 0` flag.** Inserting an unverified user
still burns the email address, appears in every `COUNT(*)` on the landing page
and admin metrics, and leaves a password hash for an address nobody has proven
they own. An abandoned signup here simply expires.

**Security specifics worth quoting.** The code comes from `crypto.randomInt`,
not `Math.random`; it is stored as SHA-256 with a server-side pepper, never in
plaintext; comparison is constant-time; it expires in 10 minutes; there is a
60-second resend cooldown, a cap of 5 sends and 5 wrong guesses, and per-IP rate
limits on top of the per-address ones.

**Why SHA-256 and not bcrypt for the code.** bcrypt is deliberately slow, which
is right for passwords and wrong here: the search space is only 10⁶ and is
already closed off by the attempt cap and the 10-minute expiry, while verify sits
on the hot path of a signup.

**Google sign-in** skips the OTP — Google has already proven control of the
address. GitHub OAuth was removed and must not be reintroduced.

**Roles.** `middleware/rbac.js` holds `ROLE_KEYS` and `ROLE_ALIASES`, mirrored
on the frontend in `src/utils/roles.js`. Backend guard is
`requireAuth` → `requireRole(...)`. Frontend `<ProtectedRoute>` is UX only —
**every protected endpoint also enforces ownership**, because authentication is
not authorization.

---

## 4. Profile, avatars, and resume analysis

**Files:** `routes/profileRoutes.js` · `src/utils/avatar.js` ·
`src/components/common/Avatar.jsx` · `src/utils/imageThumb.js` ·
`services/pdfTextService.js`

### Avatars

**What.** Every user always has a picture — an uploaded photo, an avatar chosen
from a gallery, or a generated one.

**How.** `resolveAvatarSrc()` resolves in order: `avatar_thumb` → `avatar_url` →
a deterministic DiceBear "micah" avatar generated from the user's id. `<Avatar>`
is the only component that renders a face, so a change propagates everywhere at
once through `AuthContext`.

**Why the generated tier is not stored.** It is a pure function of the user id.
Storing it would add ~8KB per row for information already implied by the id, plus
a migration and a backfill. Deriving it meant every existing account gained a
face instantly with no data change.

**Why a *chosen* avatar IS stored.** A deliberate choice is not derivable. It is
written to `users.avatar_url` through the same endpoint an upload uses, so no
downstream code can tell the two apart — which is exactly the requirement.

**Why two size columns.** Avatars are base64 data URIs averaging ~319KB. A list
of 7 applicants cost ~2.2MB per page. `avatar_thumb` (~96px, 10–25KB) is what
list endpoints select. Downscaling happens in the browser with a canvas, which
avoids adding a native image library to the Render deployment.

### AI resume analysis ("Analyze My Resume")

**What.** The user uploads a resume; the system extracts the text, has the AI
parse it into structured career data, and builds their Unified Profile and
career insights.

**How.** Text extraction goes through `services/pdfTextService.js` — **never**
`require('pdf-parse')` directly. That module bridges pdf-parse v1's function API
and v2's `PDFParse` class. Calling the library directly broke twice on a version
bump, and the failure was silent: the AI scorer simply received no resume text.

**Why the name changed.** It was called "Upload Resume", which described the
input rather than the feature. Uploading is incidental; the AI parsing and career
insight generation are the point.

---

## 5. Applying for a job

**Files:** `routes/applicationRoutes.js` · `services/aiScoringService.js` ·
`src/components/ApplyWizard.jsx` · `src/components/PublicJobBoard.jsx`

**What happens on `POST /api/applications`,** in order:

1. **Vacancy gate.** Refuses non-Open/Published postings and count-filled jobs.
   The disabled button in the UI is convenience; this is the enforcement.
2. **Insert the application** into `job_applications`.
3. **Snapshot the resume** into `application_resumes` as base64 — an immutable
   per-application copy, so the administrator always retrieves exactly what was
   submitted even if the seeker later edits their resume.
4. **Extract text** from an uploaded PDF into `uploaded_resumes.parsed_text`,
   *before* scoring, because that is what the scorer reads.
5. **AI score** via `scoreApplication()`.
6. **Stage a referral** if the score clears `REFERRAL_AI_THRESHOLD`.
7. **Notify** the owning administrator.

**Why steps 3–7 cannot fail the application.** Each is wrapped independently. An
applicant must be able to apply even if the AI, the email, the snapshot, or the
notification dies. This is the system's first invariant.

### AI compatibility scoring

**What.** One engine, `scoreApplication()`, returns
`{ overall, skills, education, experience, summary, provenance }` — or **`NULL`**.
`overall` is the only number (0–100); the sub-scores are qualitative
High/Medium/Low (no false precision); `summary` is the AI's one-sentence
rationale; `provenance` records how the score was produced (below).

**Why NULL matters.** A fabricated score is worse than no score: it silently
misroutes a real person's application. `NULL` means "not scored" and routes to
manual review, and the application still succeeds. Every AI-backed screen has a
defined "AI Compatibility Unavailable" state. The old `Math.random()` fallback is
gone; an unavailable AI produces an ABSENCE, and an absence routes to a human.

**When / where.** Scored at apply time (immutable `match_score` / `ai_analysis`)
and re-scored on a live path when the evidence changes (`current_match_score` /
`current_ai_analysis`; the apply-time value is never mutated). The job board shows
the **numeric %** as primary with the qualitative band + a "Why this score"
rationale beside it, so the number is explained, not raw.

**Is it reproducible / defensible? (the key question)**
- **Deterministic parameters.** Temperature **0** + JSON mode, one shared prompt
  (`buildScoringPrompt`) for the board and apply-time, so the *same inputs* yield
  the *same score* — validated by the eval harness (`npm run eval:scoring`): MAE
  3.6, 100 % band accuracy on the labelled set.
- **One source of truth.** The exact string that is scored is the exact string that
  is hashed (`computeScoringSignature`), so the change-detection guard can never
  drift from what was scored, and a redundant recompute is skipped rather than
  producing a second, possibly different, number.
- **The reproducibility boundary (stated honestly).** Determinism holds **within a
  provider + model version**. The *only* sources of drift are (a) a **provider
  failover** (OpenRouter ↔ DeepSeek-direct may serve slightly differently) or (b) a
  **model version update** by the provider. Both are bounded: the apply-time score
  is immutable, and the input-hash guard avoids needless recomputation, so a stored
  score does not silently change.
- **Provenance (auditability).** Every score is stamped with
  `{ provider, model, promptVersion, scoredAt }` — e.g. *"85 %, `deepseek-v4-flash`
  via `deepseek`, prompt `tier1-2026-08`, 2026-08-24"* — persisted with the score and
  shown to admins. So any displayed % is traceable to the exact engine and rubric
  that produced it. If a score ever *looks* different from a screenshot, provenance
  says whether the model version or provider changed.
- **Safeguards against arbitrary %.** Out-of-range / non-numeric output is rejected
  as a hallucination (→ NULL); the threshold is a system setting **bounded 50–80**;
  a crossed threshold **stages for review, it does not approve** — a named admin
  approves every referral.

**The threshold.** `referral_ai_threshold` (system setting, read per call, bounded
50–80; env fallback `REFERRAL_AI_THRESHOLD`). Instrumenting the score distribution
before tuning it is a known next step; spreading the top end ("Tier-2 scale anchors",
strong matches anchor ~85) is a documented future item, not a code cap.

---

## 6. Referral management

The largest subsystem, and the one most likely to be questioned.

**Files:** `services/referralService.js` (decisions and transactions) ·
`services/referralWorker.js` (delivery) · `repositories/referralRepository.js`
(SQL) · `services/pdfService.js` (letter rendering) · `routes/referralRoutes.js`
· `src/components/Referrals.jsx`

### The pipeline, end to end

```
applicant applies
      ↓  AI score ≥ threshold
staged as 'Pending Review'  ──→  admin sees it in AI Recommended
      ↓  ADMIN APPROVES (a human, always)
ONE TRANSACTION:
   referral_queue      status → Approved
   referral_letters    reference number reserved
   referral_jobs       outbox row armed
   referral_activity_log  REFERRAL_APPROVED
   (+ job → 'Filled' if this consumed the last slot)
      ↓  worker polls every ~5s
generate_pdf → send_email → notify → dispatch_n8n → done
      ↓
admin records the OUTCOME (hired / not hired / …)
```

**Why an outbox and a worker rather than doing it inline.** Generating a PDF and
sending an email inside the HTTP request would make approval slow and would lose
the work entirely if the process died mid-request. The outbox row is committed in
the same transaction as the approval, so once the admin sees "approved", delivery
is guaranteed to be attempted. Processes die; rows do not.

**Why one step per commit.** Each step advances `step` and commits. A crash
resumes at the next step rather than redoing the whole chain — which matters most
for `send_email`, since an email cannot be un-sent.

**Failure handling.** Exponential backoff persisted in `next_run_at`, dead-letter
after 5 attempts, stuck jobs reclaimed on boot. TiDB has no `SKIP LOCKED`, so the
worker claims rows with conditional atomic `UPDATE`s instead.

**Why the automation cannot break anything.** The `dispatch_n8n` step (its
persisted name, kept after the n8n→Make.com cutover — §59/§70) hands the completed
referral to **Make.com** (`AUTOMATION_WEBHOOK_URL`). It is the last step, after the
letter is generated, emailed, and the applicant notified. If `AUTOMATION_WEBHOOK_URL`
is unset the step is a no-op success. This is the exact inversion of the original
design, where the automation *was* the pipeline and its silence killed the feature.

### The vacancy cap

One approved referral consumes one position. Enforced inside the approval
transaction: `SELECT … FOR UPDATE` on the job row (so concurrent approvals
serialize) plus a `COUNT(*)` of approved referrals. Past capacity → HTTP 409.

**Why count-based rather than a flag.** A count cannot drift out of sync with the
referrals that exist. It also means cancelling a referral releases its slot
automatically, with no separate bookkeeping.

### Letter storage

Letters are stored **in the database as base64** (`referral_letter_files`), not
on disk. Render's filesystem is erased on every deploy; 27 letters were one
deploy away from being unrecoverable while their database rows still claimed they
existed. `scripts/backfill-referral-letters.js` rescued them.

Letters are served through an authenticated route, never from `/uploads` — a
referral names a citizen and the employer they were endorsed to.

**Regeneration** (`scripts/regenerate-referral-letters.js`) archives the previous
version to `referral_letter_archive` before overwriting. The old copy is the
document the citizen actually received and must survive. Regeneration keeps the
original approval date and **sends nothing**.

### Outcomes, reports, cancellation

- **Outcomes** — `Issued → Employer Acknowledged → Interview Scheduled → Hired /
  Not Hired / Withdrawn / No Response`. Recorded by an administrator, because
  employers report hires by email to the office. `outcome_at` (when it happened)
  is stored separately from `recorded_at` (when it was typed in) because reports
  need the real date. Deliberately not a state machine — employers commonly
  report "hired" with no prior acknowledgement.
- **Reports** — monthly counts, list of names, placement rate, CSV export. The
  date range filters on *issue* date so the rate's numerator and denominator
  describe the same cohort. The placement rate is reported **two ways** with the
  denominator spelled out, because "of all referrals" and "of decided referrals"
  currently read 6.7% and 100% on the same data; publishing either alone would be
  indefensible.
- **Cancellation** — `Voided` state with a mandatory reason. The record is kept;
  the slot is released; a posting auto-flipped to `Filled` reopens in the same
  transaction. It cannot un-send the email, and the dialog says so.

### The DOLE Accomplishment Report

**Files:** `services/reportingService.js` (shaping + export) ·
`repositories/reportingRepository.js` (aggregation SQL) ·
`services/reportPdfService.js` (pdfkit) ·
`src/components/common/AccomplishmentReport.jsx` (UI).

**What.** The government-format report a PESO office submits to DOLE: for a chosen
period, aggregate counts — **registered applicants · vacancies/positions solicited ·
referred · placed** — each broken down by **sex, educational attainment, and age
group**, as an official **PDF** and a sectioned **CSV**. This is a different document
from the referral-row report above: that one lists individual referrals; this one is
the accomplishment *summary*.

**Where.** A PESO Administrator opens it in **Referral Reports** (owner-scoped — their
own postings); a Super Administrator opens it in **System Reports** (office-wide). One
builder, two scopes; the same on-screen tables, PDF, and CSV.

**How the numbers are trustworthy (the defence anchor).** The report uses the **exact
same cohort** as the referral report it sits beside, so the two always agree: *referred*
= referrals with `referral_queue.status = 'Approved'`, dated by their issue date
(`reviewed_at`); *placed* = only those whose recorded outcome is **`Hired`** (never an
unfollowed-up "Issued"). On the live data that reconciles to referred **48** / placed
**7** — the same figures the public landing page shows. The placement rate is reported
**two ways** (of all referred vs. of referrals with a recorded outcome), the denominator
spelled out, exactly as the referral report does.

**Demographics — honest, never fabricated.** Sex and educational attainment come from
the applicant's profile; age is the current age computed from their date of birth, with
implausible dates (the DB holds one corrupt value) guarded out. Anything not captured —
or a bad date — shows as a transparent **"Not specified"** bucket, never hidden and never
guessed. The report footer states these limits in plain language.

**Why.** PESO offices report their accomplishments to DOLE on a schedule; before this,
the office could export a flat list of referrals but had to hand-tabulate the demographic
summary DOLE actually asks for. No new data was invented — the report is a new *view* of
records the system already keeps.

### The audit trail

`referral_activity_log` records every event with actor and timestamp:
`REFERRAL_APPROVED`, `PDF_GENERATED`, `EMAIL_SENT`, `NOTIFICATION_SENT`,
`N8N_DISPATCHED`, `DELIVERY_FAILED`, `DELIVERY_RETRIED`, `JOB_FILLED`,
`OUTCOME_RECORDED`, `LETTER_REGENERATED`, `REFERRAL_VOIDED`. (`N8N_DISPATCHED` /
`N8N_DISPATCH_SKIPPED` are the persisted action names for the Make.com automation
dispatch — kept unchanged after the n8n→Make cutover so history stays queryable, §59/§70.)

Visible via the **History** button — including to the job seeker, who is entitled
to see what was done with their own referral.

**Why this matters:** the system never auto-sends a referral. A named
administrator approves every one, and this log is the proof.

---

## 7. Applicant Tracking System (ATS)

**Files:** `routes/pesoAdminRoutes.js` · `src/components/PesoAdminATS.jsx`

**What.** Per-vacancy applicant pipeline: view applicants, read their AI match
score, open the exact resume they submitted, change status, message them, and
approve or reject a referral.

**How resume retrieval works.** The button fetches with the auth header as a
blob, then opens a blob URL. A plain `window.open` cannot attach a bearer token,
and the endpoint is owner-scoped — an administrator can only stream resumes for
their own vacancies.

**Why list endpoints select `avatar_thumb`.** See §4 — the full-size column made
a 7-applicant page cost megabytes.

**The role-comparison trap.** Code that tested `user.role === 'employer'` never
matched, because the stored value is `peso_administrator`. In Messages this made
a PESO admin see *their own* name as the conversation peer. Both the list and the
header now share one `peerOf()` helper keyed on user id.

---

## 8. Notifications

**Files:** `services/notificationService.js` · `routes/notificationRoutes.js` ·
`src/context/NotificationContext.jsx` · `src/components/layout/TopHeader.jsx`

**What.** The bell in the top header, backed by the `notifications` table.

**How.** `notificationService` is the **single writer**. It writes the database
row **first**, then best-effort emits over socket.io. It never throws into the
caller.

**Why row-first.** A notification that was pushed but not persisted vanishes on
refresh. A notification persisted but not pushed simply arrives a moment later.
Only one of those is acceptable.

**Why it never throws.** A failed notification must never fail the action that
triggered it — you should not lose an application because a bell icon failed to
update.

**Message notifications are deduplicated:** one unread `NEW_MESSAGE` row is
refreshed rather than stacking one row per chat message.

**Types map to deep links** — `NEW_APPLICATION` → `/peso-admin/ats`,
`AI_RECOMMENDATION` → `/referrals/recommended`, `NEW_MESSAGE` → `/messages`, and
so on. Adding a type means adding its `TYPE_META` entry and its link together.
Visiting a linked module auto-marks those notifications read.

---

## 9. Messaging

**Files:** `routes/messageRoutes.js` · `socketServer.js` ·
`src/context/ChatContext.jsx` · `src/components/Messages.jsx`

**What.** Direct applicant ↔ administrator chat, tied to a job application.

**How.** `ChatContext` owns the **only** socket connection in the app. New
realtime listeners join it; a second connection is never opened. Messages persist
to the database and are pushed over the socket; the recipient also gets a
deduplicated bell notification.

**Why one socket.** Two connections mean two lifecycles, two reconnect policies,
and duplicate event delivery that is very hard to diagnose.

---

## 10. Dashboards, analytics, and the public board

**Files:** `routes/jobBoardRoutes.js` · `routes/analyticsRoutes.js` ·
`src/components/Dashboard.jsx` · `src/components/LandingPage.jsx`

**Landing page statistics** map one-to-one to `/api/job-board/stats`:

| Tile | Source |
|---|---|
| Available Opportunities | live postings |
| Registered Job Seekers | active applicant accounts |
| Successful Referrals | `referral_outcomes` where outcome = **`Hired`** |
| Active Local Employers | distinct companies on live postings |

**Worth knowing:** "Successful Referrals" previously counted *approved* referrals
— that is, letters that had been emailed. A referral the employer ignored was
being published as a success. It now counts actual hires, which is why the figure
is smaller and defensible.

**`safeQuery`** returns a default on SQL failure so one broken panel degrades
instead of 500-ing an entire dashboard.

**Filled vacancies stay visible** on the public board with an honest "Vacancy
Filled" label rather than disappearing. Use `isJobFilled()` / `filledLabel()`
from `jobs/JobCard.jsx` — never re-derive the check locally.

---

## 11. Importing past applications

**Files:** `src/components/Dashboard.jsx` (Import Past Applications) ·
`routes/trackedJobRoutes.js`

**What.** A job seeker uploads a spreadsheet (.xlsx/.csv) of jobs they applied to
elsewhere; the system auto-detects Company / Title / Status columns and skips
duplicates.

**Why the name changed.** It was "Import Tracker", which described neither the
input nor the outcome. It imports historical application records; it does not
track anything.

---

## 12. Database and migrations

**Migrations own the schema.** New DDL always goes in a numbered file in
`migrations/`, applied by `npm run migrate`, tracked in `schema_migrations`.
`initDB()` in `db.js` is legacy and pending retirement.

**Applied through `024_referral_void.sql`.** The recent ones:

| # | What |
|---|---|
| 019 | `avatar_thumb`, `verification_id_type` |
| 020 | signup email verification (OTP) |
| 021 | durable referral letter storage |
| 022 | referral letter archive (regeneration) |
| 023 | referral placement outcomes |
| 024 | referral `Voided` state |

**TiDB is not MySQL.** Two rules that have already caused production incidents:

- **Enum values may only be APPENDED.** Writing a value the enum lacks raises
  `WARN_DATA_TRUNCATED` and rolls back the *enclosing transaction*. Migration 014
  exists because the app wrote `'Published'` to an enum that did not have it, and
  referral approval 500'd as a result.
- **No `SKIP LOCKED`** — the worker uses conditional atomic `UPDATE`s instead.

**`CREATE TABLE IF NOT EXISTS` silently skips a table that exists with a
different shape.** Verify against `INFORMATION_SCHEMA`, not by assuming.

**Production is live.** Every migration targets the real database. The runner
prints its target host on startup — read that line.

---

## 13. Design rules the code follows

Useful if asked "why is it built this way?"

1. **Never fail the primary action for a secondary concern.** AI, email,
   notifications, and snapshots are each wrapped, logged, and skippable.
2. **The AI returns a real result or NULL — never a guess.**
3. **The database is the job store.** No workflow state in memory, in an external
   orchestrator, or in a `setTimeout`.
4. **A human approves every referral.** The letter carries a government
   signature.
5. **Durable binaries live in the database as base64.** The filesystem is
   ephemeral.
6. **Migrations own the schema.**
7. **Owner-scoping on every endpoint.** Authentication is not authorization.
8. **404, not 403, for someone else's record** — so the existence of a citizen's
   referral is never disclosed to a stranger.
9. **One writer per concern.** One notification writer, one avatar resolver, one
   socket, one PDF text extractor.

---

## 14. Known gaps — answer honestly if asked

| Item | State |
|---|---|
| Job Seeker Verification | **Decommissioned (2026-08-01)** by product decision — the identity approval workflow (endpoints, admin queue, nav, profile ID-document upload) was removed; the tables are dormant. Do not reintroduce. The referral-letter ID-**type** selector is a separate feature and remains. |
| Pagination on referral lists | Not implemented. Correct at current volume (~30); needed in the hundreds. |
| AI recommendation queue | Used for ~4% of referrals. Needs score-distribution data before the threshold is tuned. |
| Referral rejection / decline | Implemented. Declining now notifies the seeker (`APPLICATION_DECLINED`) and sets their application to **"Not Referred"**, so the decision is no longer silent (audit finding G3). |
| DOLE report demographics | The report breaks down by sex, education, and age, but capture is **optional**, so a real **"Not specified"** bucket is often large (e.g. sex/DOB filled for ~30–45% of applicants). This is shown honestly, never hidden. Fill improves as the profile nudge takes effect. |
| Letter retention policy | Not set. Letters are kept indefinitely; `purge_after` exists and nothing reads it. |
| `.env` in git history | The repository is private. Secrets must be rotated before it is ever made public. |

---

## 15. Quick answers

**"Where does a request go?"** `server.js` mounts every router under `/api`.
Find the mount, open that route file, follow it to a service, then to a
repository.

**"How do I run it?"** Backend `npm run dev` (port 5000, nodemon). Frontend
`npm run dev` (5173) or `npm run preview` (4300 — 4173 is inside a Windows
reserved range). Migrations `npm run migrate`.

**"What happens if the AI is down?"** The application still succeeds with a NULL
score and routes to manual review.

**"What happens if email is down?"** Referral delivery retries with backoff and
dead-letters after 5 attempts, with the administrator notified. Signup OTP is the
one place email failure is fatal — an undelivered code cannot be entered, so it
surfaces as an error and the staged signup is rolled back.

**"What happens if the automation (Make.com) is down?"** Nothing, for the referral.
Only downstream record-keeping is missed, and the Referral Register now says so.
(The self-hosted n8n this replaced was retired in 2026-09, §70.)

**"Can two administrators approve the last position at once?"** No. The job row
is locked `FOR UPDATE` inside the transaction, so the second approval re-reads
the count after the first commits and is refused with a 409.

**"Can the job seeker and the administrator see different compatibility scores?"**
No, for the *committed* application score — both read the same persisted value
(`COALESCE(current_match_score, match_score)`). The public Job Board shows a live
*preview* for the seeker's current résumé, which is cached and re-computed when the
résumé changes; it is a what-if estimate, not the committed score. The scoring engine
is deterministic (temperature 0), so identical inputs give identical scores, and every
stored score records the provider/model that produced it (provenance).

**"How does PESO report its accomplishments to DOLE?"** Referral Reports (per
administrator) or System Reports (office-wide) → **DOLE Accomplishment Report**: pick a
period, view the aggregate counts (registered, solicited, referred, placed) broken down
by sex, education, and age, and download the **PDF** or **CSV**. The figures reconcile
with the referral report — same cohort, `Hired`-only placements — and any uncaptured
demographic shows as "Not specified", never a guess.
