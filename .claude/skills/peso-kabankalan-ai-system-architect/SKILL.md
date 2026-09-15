---
name: peso-kabankalan-ai-system-architect
description: >-
  Authoritative architecture, conventions, and workflow reference for the PESO
  Kabankalan Employment System (React 19/Vite SPA + Node/Express + TiDB/MySQL,
  AI via OpenRouter→DeepSeek, self-hosted pdfkit referral letters stored durably
  as base64, transactional-outbox referral worker, OTP signup verification,
  DiceBear avatar system, in-app notifications, vacancy-capped referrals with
  placement-outcome tracking and DOLE reporting, a governed Super Administrator
  subsystem, n8n as downstream consumer only). Use this skill whenever working
  ANYWHERE in this project — the ATS, Public Job Board, Apply Wizard,
  resume/cover-letter/resignation builders, AI resume analysis, AI compatibility
  scoring, the referral-letter pipeline and its outcome/report/void/audit
  surfaces, the bell notification system, messaging, avatars, registration and
  OTP, the Super Admin portal (audit trail, role administration, system
  settings, platform health), RBAC, database migrations, the Express API, or the
  layout shells — or any change that must respect the project's established
  architecture, naming conventions (PWD→Job Seeker, Admin→SuperAdmin), outbox
  pattern, or fault-tolerant background-job design. Trigger it even when the
  request never names the project, mentions only a file or symbol from it, or
  looks like a small isolated fix — small fixes are exactly where these
  invariants get broken.
---

# PESO Kabankalan Employment System — Architect Skill

Authoritative developer knowledge base for the PESO Kabankalan employment
platform. Read this **before** designing, debugging, or modifying anything in the
codebase, so changes stay consistent with the architecture already in production.

## How to use this document

1. Read §0 (non-negotiables) — every one of them has already been violated once
   and caused a real production defect.
2. Read the sections covering the area you are touching.
3. For any **asynchronous, background-job, referral, AI-scoring, or migration**
   work, read §7.4–§7.11 and §13 here, then the module headers in
   `services/referralWorker.js`, `services/referralService.js` and the migration
   files themselves — those carry the implementation-level contract.
   (An earlier edition pointed at `references/referral-pipeline-and-scoring.md`.
   That file does not exist in this repository; the pointer was dangling.)
4. For any **UI, layout, responsive, card, colour, filter, or touch-interaction**
   work, also load `references/ui-ux-and-responsive-layout.md`. It is an ADDENDUM
   to this file (not a replacement) covering the presentation layer: page-width
   taxonomy and sidebar-aware widening, fluid grid patterns, the card system,
   pinning and colour labels, the contrast model, input-capability accessibility,
   and component ownership. §10 here is the short form; that file is the detail
   and the more recent statement wherever the two overlap on presentation.
5. Before shipping, walk the checklist in §16 — and, for UI work, the additional
   checklist in the addendum's §12.

6. Two in-repo documents complement this one and are kept with the code:
   - `docs/system-guide.md` — the demonstration/defence reference. Same
     subsystems, written as what/how/when/why prose for explaining the system
     out loud, plus a quick-answers section.
   - `docs/referral-management-enhancement.md` — the referral review, its
     findings and the remaining roadmap.
   Most modules also carry a file-header comment stating what they do, when they
   run, and which past incident shaped them.

Treat the existing codebase as the authoritative baseline. Where this document
and the code disagree, the code wins — but say so explicitly rather than silently
adapting, because a drift between them is itself a defect worth reporting.

---

## 0. Non-negotiables

These are invariants, not preferences. Breaking one is a regression even if the
feature "works".

| # | Invariant | Why |
|---|---|---|
| 0.1 | **Never fail the primary action for a secondary concern.** | An applicant must be able to apply even if AI, email, notifications, or the snapshot write dies. |
| 0.2 | **AI returns a real result or `NULL` — never a fabricated one.** | A synthetic score is worse than no score; it silently misroutes a real person's application. |
| 0.3 | **The database is the job store.** No workflow state lives in n8n, in memory, or in a `setTimeout`. | Processes die; rows do not. |
| 0.4 | **The system never auto-sends a referral.** A named administrator approves every one. | The letter carries a government signature. |
| 0.5 | **Durable binaries live in the DB as base64** — EXCEPT job featured images, which now use object storage via `storageService` (§41). New uploads NEVER go to local disk. | Render's filesystem is ephemeral. |
| 0.6 | **Migrations own the schema.** New DDL goes in a numbered migration, never in `initDB()`. | Schema must be reproducible and versioned. |
| 0.7 | **Physical DB column names are frozen** unless a migration explicitly renames them (see §11). | Production TiDB is live; renames are downtime. |
| 0.8 | **Never `JOIN userprofiles` unless you select from it.** | It holds multiple rows per `user_id` and silently multiplies result rows. |
| 0.9 | **Job Seeker Verification is DECOMMISSIONED (2026-08-01).** Do not reintroduce a job-seeker identity approval workflow; `job_seeker_verifications` / `verification_history` are dormant. This does NOT touch `verification_id_type` / `pwd_category` (the ID TYPE on the referral letter) — those stay. | Removed from scope by product decision (§14). |
| 0.10 | **n8n is a consumer, never an orchestrator.** | Its failures must never be able to drop a referral. |
| 0.11 | **Notifications are written ONLY through `notificationService`** and never throw into the caller. | One writer keeps delivery semantics (row first, socket second) consistent; a notification failure must never fail the action that triggered it. |
| 0.12 | **One approved referral consumes one vacancy slot.** The cap is the COUNT of approved referrals vs `positions_available`, enforced inside the approval transaction — never a status flag alone. | Count-based state cannot drift; a flag can. |
| 0.13 | **Referral letters live in the database as base64** (`referral_letter_files`), never only on disk. Regeneration archives the superseded copy first. | Render wipes the filesystem on deploy; 27 signed government letters were one deploy from being unrecoverable. |
| 0.14 | **Delivery state and placement outcome are separate axes.** "Delivered" means the letter was emailed; only `referral_outcomes.outcome = 'Hired'` means someone got a job. | Conflating them had the public landing page reporting emailed PDFs as successful placements. |
| 0.15 | **`normalizeRole()` is for READING a role, never for validating one you are about to WRITE.** It maps anything unrecognised to `JOB_SEEKER`. | A mistyped role passed an allow-list check on the normalized value and would have silently demoted an account. |
| 0.16 | **A privilege change that cannot be audited must not happen.** Role changes write their audit entry INSIDE the transaction — the one place the "never fail the primary action" rule is deliberately inverted. | Undocumented privilege escalation is indistinguishable from compromise. |

## 1. What the system is

A government employment platform for the **Public Employment Service Office
(PESO) of Kabankalan City**. It connects **Job Seekers** with vacancies posted by
**PESO Administrators**, scores applicant↔job compatibility with AI, and
**automates the generation and email delivery of official PESO referral letters**
under human approval. A **Super Administrator** governs the platform (users,
verification, moderation, reports).

| Actor | Portal | Primary capabilities |
|---|---|---|
| Job Seeker | `AppLayout` | Browse the public board, apply, build resume/cover letter/resignation, track applications, chat with admins, receive bell notifications |
| PESO Administrator | `AppLayout` | Post and manage own vacancies, work the ATS, review the AI-Recommended queue, approve/reject referrals within the vacancy cap |
| Super Administrator | `SuperAdminLayout` | Platform metrics, account + role administration, moderation, audit trail, system settings, platform health |

The system began as a generic "job tracker" and was progressively refactored into
the PESO domain. Legacy naming survives in some DB columns and route aliases and
is **intentionally preserved** — see §11 before renaming anything.

Scope note: the platform is **not** PWD-specific and PWDs are not its intended
user segment. Accessibility accommodations on job posts remain a legitimate
feature (§11), but nothing in the product should be designed around PWD status.

## 2. Tech stack

- **Frontend** — React 19 + Vite, React Router, Tailwind CSS, `lucide-react`,
  `axios` (the standard HTTP client; do not introduce `fetch` wrappers or another
  client), `socket.io-client`, **`@dicebear/core` + `@dicebear/collection`**
  (generated avatars — note the package is `collection`, NOT `@dicebear/styles`),
  `recharts`/`apexcharts`/`chart.js` for dashboards, `framer-motion`,
  `@hello-pangea/dnd`. Dev server **5173**, preview **4300** (4173 falls inside a
  Windows reserved port range — §13).
- **Backend** — Node.js + Express. `socket.io` (realtime), `multer` in **memory
  storage**, `pdfkit` (self-hosted PDF), `nodemailer` (email), `jsonwebtoken` +
  `bcryptjs` (auth), `pdf-parse` **v2** for resume text extraction — accessed
  ONLY through `services/pdfTextService.js`, which bridges the v1 function API
  and the v2 `PDFParse` class (calling `pdf-parse` directly broke twice on the
  version bump). Default port **5000**. Local dev runs under nodemon
  (`npm run dev`), so backend edits hot-reload.
- **Database** — **dual-driver, selected at boot by `DB_CLIENT`** (`db.js`):
  - `mysql` (**default**) → **TiDB** (MySQL wire-compatible) via a `mysql2` pool —
    the original production line. TiDB is *not* MySQL: no `SKIP LOCKED` (conditional
    atomic `UPDATE`s instead, §7.5), and enum columns only accept **appending**
    values at the end of the list (§13).
  - `postgres` → **PostgreSQL (Supabase)** via the mysql2-compatible pg adapter
    `dbPgAdapter.js` (`?`→`$n`, `IN (?)` expansion, `ON DUPLICATE KEY`→`ON CONFLICT`,
    auto `RETURNING id`, MySQL→Postgres dialect translation). On this path the schema
    is owned by `postgres/schema.sql` (58 tables), NOT the numbered migrations, and
    `initDB()` never runs. **THIS VPS repo deploys on the postgres path** — `.env`
    sets `DB_CLIENT=postgres` + the Supabase **session-pooler** `DATABASE_URL`
    (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`, `DB_SSL=true`); see
    `postgres/README.md` + `DEPLOYMENT.md`.
  Whichever driver is active, it points at a **live** instance — every schema or
  data change is production-affecting. (The mysql2-coupled test suite stays green on
  the default mysql path; adapter unit tests cover the pg path.)
- **AI** — **OpenRouter** gateway calling `deepseek/deepseek-chat`; some routes
  still call the **DeepSeek API directly**. **DeepL** for translation. All AI is
  **gracefully degradable**.
- **Automation** — **Make.com** is the sole downstream webhook consumer (n8n is
  FULLY RETIRED, §70; the dispatch reads `AUTOMATION_WEBHOOK_URL`, and the persisted
  `dispatch_n8n` step key + `N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED` identifiers are
  kept ON PURPOSE — renaming them orphans in-flight rows/history). A **downstream
  consumer only**: referrals that complete without reaching it are surfaced as an
  advisory, never an error (§7.8, invariant 0.10).
- **Hosting** — TWO deployment lines share this codebase:
  - **THIS repo = single VPS + Supabase** (`DEPLOYMENT.md`): Nginx serves the built
    SPA and reverse-proxies `/api` + `/socket.io` to the Node API on the **SAME
    origin** (no CORS needed in that topology); **PM2** runs two processes —
    `peso-api` (`WORKER_MODE=web`, API only) + `peso-worker` (`worker.js`, the six
    background workers) per `ecosystem.config.js`; domain `pesokabankalan.tech`. The
    VPS has a **persistent disk and outbound SMTP**, so the Render constraints below
    do not bite here (`STORAGE_DRIVER=local` is viable; SMTP works directly).
  - **Original line = split Vercel + Render + TiDB** (§19), CROSS-ORIGIN: frontend
    on Vercel (`peso-kabankalan.vercel.app`), backend on Render
    (`peso-kabankalan-backend.onrender.com`). Render's filesystem is **ephemeral**,
    it **blocks outbound SMTP** (email via an HTTP API, §19.3), and **hibernates**
    the free instance when idle (cold-start — the pipeline's slow poll backstops it,
    §18.9). There, CORS + the socket URL + OAuth URLs are all **env-driven** (§19.2),
    never hardcoded localhost.
- **Auth providers** — email/password + **Google OAuth only**. GitHub OAuth was
  **fully removed** (2026-07-19): routes, env vars, UI, and the dead
  `Login.jsx` / `auth/AuthModal.jsx` components are gone. Do not reintroduce it.

## 3. Repository layout

```
job-tracker-backend/            # Express API (repo root)
  server.js                     # bootstrap, route mounting, socket.io, worker start
  db.js                         # TiDB pool + legacy initDB (pending retirement)
  middleware/                   # authMiddleware (JWT), rbac.js (roles), requireAdmin
  routes/                       # one router per domain (§5) — HTTP concerns only
  services/                     # aiScoringService, notificationService, referral*,
                                #   otpService, systemSettingsService,
                                #   adminAuditService, roleAdminService,
                                #   pdfTextService, *PdfService, mailService…
  repositories/                 # referralRepository — all referral SQL lives here
  migrations/                   # 000_baseline … 025_*, applied in order
  scripts/migrate.js            # migration runner (npm run migrate)
  scripts/backfill-referral-letters.js    # disk → DB rescue (one-off, re-runnable)
  scripts/regenerate-referral-letters.js  # archive-then-rebuild letters
  assets/letterhead/            # TRACKED. letterhead.png is the official artwork;
                                #   absent = letters silently fall back to text
  docs/                         # system-guide.md, referral-management-enhancement.md
  socketServer.js               # isolated socket.io wiring (chat + notification push)
  storage/                      # legacy letter files; EPHEMERAL, no longer the source
  uploads/                      # PUBLIC static assets — never write PII here
  job-tracker-frontend/         # React/Vite SPA
    src/App.jsx                 # routes + AppLayout shell
    src/api.js                  # the ONLY axios instance; attaches the bearer token
    src/components/             # PublicJobBoard, ApplyWizard, PesoAdmin*, builders,
                                #   Referrals + ReferralReports/ReferralActivity,
                                #   jobs/JobCard (isJobFilled/filledLabel helpers)…
    src/components/common/      # Avatar — the ONLY component that renders a face
    src/components/layout/      # TopHeader (bell panel + avatar menu)
    src/superadmin/             # Super Admin subsystem, FEATURE-based (§9)
      SuperAdminLayout.jsx      #   the /admin shell
      SuperAdminSidebar.jsx
      features/{overview,accounts,moderation,reports,settings,audit,health,automation,email}/
    src/context/                # AuthContext, NotificationContext, ChatContext
    src/utils/avatar.js         # avatar resolution + DiceBear generation
    src/utils/roles.js          # frontend mirror of RBAC role normalization
```

**Layering rule** — routes parse, authorize and respond; services hold business
rules and transaction boundaries; repositories hold SQL. Adding SQL to a route
file is a review-blocking smell.

**Git hygiene (2026-07-24)** — root `.gitignore` covers `node_modules/`, `.env`,
`uploads/`, `storage/`, logs, and `.claude/*` — note the `/*`, not `/`. Git does
not descend into an excluded DIRECTORY, so excluding the CONTENTS is what allows
`!.claude/skills/` to take effect. **This file is therefore tracked**;
`.claude/worktrees/` is not.

**`.env` still exists in the GitHub history** (repo is private) — rotate all
secrets before ever making the repo public.

TWO things have now been lost to being untracked, so treat this as a pattern:
`assets/letterhead/letterhead.png` (every letter used the text-only fallback for
months) and this skill itself (a clone had no copy of the architecture
reference). If a file is documentation or an asset the product depends on, track
it.

**UI logo** — `job-tracker-frontend/src/assets/PESO LOGO.jpg` is the office seal shown in
the Sidebar (desktop + mobile) and LandingPage header, imported as `pesoLogo` in BOTH.
Updated 2026-08-03 to the new official seal and downscaled to ~25KB / 256px (`2319d71`).
Keep the **filename stable** (both imports rely on it) and don't leave a `NEW PESO LOGO.jpg`
lying around — overwrite in place. This is DISTINCT from the referral-letter letterhead
(`assets/letterhead/letterhead.png`), which is unaffected by logo changes.

Remote (THIS VPS/Supabase repo) is `github.com/Angelo55/PESOKabankalanVPS`;
`main` is current; local checkout `C:\PESOKabankalanVPS\job-tracker-backend`
(dev: `npm run dev` for the API + `npm --prefix job-tracker-frontend run dev`
for the SPA). The original TiDB/Render line lives in a separate repo
(`github.com/Angelo55/PESO-Kabankalan`, historical checkout
`C:\xampp\htdocs\job-tracker-backend`), where the tag `stable-pre-f8` marks the
state before the final referral phase.

## 4. Roles & RBAC

Canonical roles live in `middleware/rbac.js` (`ROLE_KEYS`) and are mirrored in
`src/utils/roles.js`. **The stored `users.role` value differs from the display
label** — always normalize with `normalizeRole()` before comparing, on both sides.

| ROLE_KEY | stored value | display label | portal |
|---|---|---|---|
| `JOB_SEEKER` | `applicant` | Job Seeker | `AppLayout` (`Sidebar`) |
| `PESO_ADMINISTRATOR` | `peso_administrator` (legacy `employer`) | PESO Administrator | `AppLayout` (`Sidebar`) |
| `PESO_STAFF` | `peso_staff` | PESO Staff | `AppLayout` (`Sidebar`) — **Job Publication Manager + Events ONLY** |
| `SUPER_ADMINISTRATOR` | `admin` | Super Administrator | `SuperAdminLayout` (`SuperAdminSidebar`) |

**PESO Staff (co-worker, §31.3)** is a distinct, more-restricted PESO role, NOT a `peso_administrator`
variant — so every existing Manager-only `requireRole(PESO_ADMINISTRATOR)` guard excludes it by default.
Permissions: `jobs:manage` + `events:manage` only (never referrals/ATS/analytics/walk-in/settings).
Enforced by a **deny-by-default** guard in `pesoAdminRoutes` (staff reach `/jobs*` only) and, for job
ownership, `req.effectiveOwnerId` attributes staff-published vacancies to the office Manager (D2). Access is
capability-derived — new guard `requirePermission(...)`, not per-page checks.

`ROLE_ALIASES` maps legacy values so old rows and tokens keep working. Never
compare `req.user.role` to a raw string.

- **Backend guard**: `requireAuth` then `requireRole(ROLE_KEYS.X)`.
- **Frontend guard**: `<ProtectedRoute allowedRoles={…}>`.

Frontend guards are UX, not security. Every protected route needs its server-side
guard **and** an ownership filter (§12).

## 5. Backend API surface

Mounted in `server.js` under `/api`:

| Mount | Router | Purpose |
|---|---|---|
| `/api/auth` | authRoutes | **two-step registration with OTP email verification** (`/register` → 202, `/register/verify`, `/register/resend`), login (JWT + bcrypt; **blocks a Suspended account → 403 `ACCOUNT_SUSPENDED` + notice, §33.1**), **Google** OAuth (GitHub removed), Indeed, password reset |
| `/api/profile` | profileRoutes | job-seeker profile, **`/onboarding` completion status (§43, owner-scoped, derived)**, avatar (base64 photo OR chosen DiceBear SVG — one endpoint, indistinguishable downstream), AI resume analysis upload |
| `/api/job-board` | jobBoardRoutes | **public** job list/detail (incl. `referred_count`), `/stats` for the landing page, `/:id/questions` |
| `/api/jobs` | jobRoutes | authenticated job-seeker job interactions |
| `/api/applications` | applicationRoutes | **submit application** (+ **account-completion gate §43** → 403 `PROFILE_INCOMPLETE` if the seeker's profile/résumé is incomplete, before any insert; vacancy gate, resume snapshot, AI score, referral staging, admin notifications); **`/mine`** — the seeker's own PESO applications lifecycle (`job_applications`); **`/unified`** — the seeker's ONE application feed that COMPOSES `job_applications` + `usertrackedjobs` (source-tagged, read-only) behind the consolidated `My Applications` page + Dashboard analytics (§28) |
| `/api/peso-admin` (+ `/api/employer` alias) | pesoAdminRoutes | jobs CRUD (+ reopen rule), images, questions, **ATS applicants**, status updates (+ applicant notification), owner-scoped resume streaming, **`/jobs/duplicate-check`** (§26), **`/proactive/candidates/grouped`** (Smart Referral Queue GROUPED by vacancy, ranked within each, paged by vacancy — §33.2; flat `/proactive/candidates` retained), **`/walk-in`** (§31.7) |
| `/api/admin` | adminRoutes | platform metrics, moderation, **`/audit-logs`** (paged + filterable), **`/users`** (paged; `q`/`role`/**`status`/`sort`** filters — §33.1), **`/users/:id/role`** (guarded role administration), **`/users/:id/status`** (suspend/reactivate; takes `reason`+optional `endsAt`, writes mig-046 metadata, notifies in-app/email/SMS — §33.1), **`/roles`**, **`/settings`** (GET/PUT/DELETE), **`/health`**, **`/email`** + **`/sms`** delivery monitors, **`/reports/accomplishment`** (office-wide DOLE Accomplishment Report — json/pdf/csv, §39) |
| `/api/referrals` | referralRoutes | approve/reject (rejecting notifies the seeker `APPLICATION_DECLINED` + sets 'Not Referred', §36)/**void** (notifies `REFERRAL_WITHDRAWN`)/retry (approve enforces the vacancy cap → 409; void releases the slot), register, recommended, failed, **`/:id/outcome`** (placement — admin official write, notifies the seeker), **`/:id/outcome/suggest`** (seeker self-report → non-official history, §26), **`/:id/outcome/history`**, **`/mine`**, **`/:id/activity`**, **`/reports/summary`** + **`/reports/export`** (referral-row CSV) + **`/reports/accomplishment`** (owner-scoped DOLE Accomplishment Report — json/pdf/csv, §39), **`/undispatched`**, `/:id/letter` |
| `/api/notifications` | notificationRoutes | bell panel API: list + unread count, mark one/all read, mark-read-by-link (owner-scoped) |
| `/api/config` | configRoutes | **`/features`** — client-readable runtime feature flags (e.g. `referralLifecycleSync`) so the UI renders flag-gated surfaces only when the backend honours them (§26) |
| `/api/resume` `/api/cover-letter` `/api/resignation` | *Routes | Unified Document Builder backends: draft GET/POST, AI (`/optimize`, **`/generate-body`** on cover + resignation via the shared `services/letterBodyService`, `/translate`), self-hosted pdfkit PDF (client react-pdf is primary, §30). Cover-letter draft GET/POST fixed for the dup-row bug (§30.2) |
| `/api/messages` | messageRoutes | applicant↔admin chat (socket-backed) |
| `/api/saved-jobs` `/api/tracked-jobs` | *Routes | bookmarking / tracking |
| `/api/chatbot` | chatbotRoutes | site assistant (OpenRouter + DeepL) |
| `/api/analytics` | analyticsRoutes | dashboards |

Conventions: keep the domain-per-router split; preserve the `/api/employer`
alias; return a stable JSON shape; let `safeQuery` degrade a panel rather than
500 a dashboard. `/uploads` is public and ephemeral — never PII.

## 6. Data model (key tables)

Not exhaustive — migrations hold the full DDL.

- **users** — identity, role, profile fields. `pwd_category` stores the
  government **ID type**, superseded by `verification_id_type` (migration 019,
  expand phase — read the new column, pwd_category is the fallback). `avatar_url
  LONGTEXT` = base64 data URI or a DiceBear SVG data URI; `avatar_thumb` is the
  ~96px variant every LIST must select. `email_verified_at` is INFORMATIONAL —
  nothing in login reads it, and legacy NULL rows are trusted forever. `location`
  is the job seeker's address and feeds the referral letter. No `oauth_provider`
  column — OAuth users are ordinary email rows. `account_status` (`Active`/`Suspended`,
  legacy NULL = active) is now ENFORCED server-side (§33.1); its metadata
  `suspended_at`/`suspension_reason`/`suspension_ends_at`/`suspended_by` (mig 046) is
  set on suspend and CLEARED on reactivate. Walk-in rows carry `account_origin`/
  `claim_*`/`consent_given_at` (mig 043/045); phone verify/opt-in via
  `phone_verified_at`/`sms_opt_in` (mig 044).
- **userprofiles** — extended/AI profile data. **May hold multiple rows per
  `user_id`** — invariant 0.8.
- **resumes** / **uploaded_resumes** — builder JSON / extracted plain text (what
  the AI scorer reads). Both PDF uploads and builder saves sync into
  `uploaded_resumes.parsed_text`.
- **pesoadmin_job_posts** — vacancies. Owner `peso_admin_id`. `location` feeds
  the referral letter's company address. **`status` is
  `ENUM('Open','Closed','Draft','Published','Filled')`** as of migration 014 —
  writing any other value raises `WARN_DATA_TRUNCATED` and rolls back the
  enclosing transaction (§13). `positions_available` is the vacancy cap.
  `skills` and `qualifications` columns are persisted by POST/PUT (they were
  silently dropped before 2026-07-19).
- **job_applications** — one per (job, applicant): `status`, `match_score`,
  `ai_analysis`, `applicant_snapshot`, `resume_url` (legacy label only).
- **application_resumes** — immutable per-application PDF snapshot (base64).
- **notifications** — the bell store: `user_id`, `type`, `title`, `body`,
  `link`, `is_read`, `created_at`, index `(user_id, is_read, created_at)`.
  Created by migration 002, fully wired since 2026-07-19 (§7.7).
- **Verification** — `job_seeker_verifications`, `verification_history` are
  **DECOMMISSIONED (2026-08-01)**, left dormant (never dropped on live TiDB, §0.7).
  `verification_id_types` REMAINS — it is NOT the approval workflow; it lists the
  government ID TYPEs for the profile's "Verification Identity" selector, whose
  value (`verification_id_type` / `pwd_category`) feeds the referral letter (§11).
- **Referral** — `referral_queue` (status
  `ENUM('Pending AI','Pending Review','Approved','Rejected','Voided')` plus
  `voided_at`/`voided_by`/`void_reason`), `referral_jobs` (the outbox),
  `referral_letters` (reference number, email status; `pdf_path` is now a legacy
  fallback), **`referral_letter_files`** (the DURABLE base64 PDF — migration 021),
  **`referral_letter_archive`** (superseded copies, written before any
  regeneration — 022), **`referral_outcomes`** (placement result, `outcome_at`
  separate from `recorded_at` — 023), `referral_activity_log` (§7.5).
- **email_verifications** — staged signups awaiting OTP (020). A pending signup
  is NOT a `users` row; see §7.9.
- **system_settings** — key/value platform configuration (025). Resolution is
  row → env var → hardcoded default, so the table being empty changes nothing.
- **admin_audit_logs** — `admin_id`, `action`, `target_entity`, `target_id`,
  `action_details`, `created_at`. Written ONLY through `adminAuditService`.
- **Misc** — `saved_jobs`, `usertrackedjobs`, `contact_inquiries`,
  `admin_audit_logs`, `schema_migrations`.

**Naming trap**: referrals attach to **`job_applications`**, never to
`applications` (the seeker's private external-job tracker).

## 7. Core workflows

### 7.1 Auth
Email/password (bcrypt) plus **Google** OAuth, issuing a JWT stored in
`sessionStorage.jobTrackerToken` (tab-scoped — the office uses shared public
terminals). **A Suspended account is rejected server-side (§33.1)** — both at login
and on every request in `requireAuth` (403 `ACCOUNT_SUSPENDED`; fail-open on DB
error); a JWT alone is no longer sufficient. **Registration now requires OTP email verification — see §7.9.**
GitHub OAuth is removed; former GitHub users recover via "Forgot Password".
Job Seeker Verification (the identity APPROVAL workflow) was **decommissioned
2026-08-01** — see §14. The government ID **type** the seeker picks in their
profile is still captured (`verification_id_type` / `pwd_category`) because it is
printed on the referral letter (§11); that is a different thing from the removed
approval workflow.

### 7.2 Public Job Board & Apply Wizard
`PublicJobBoard.jsx` lists vacancies publicly (statuses Open/Published **and
Filled** — filled postings stay visible with an honest state instead of
vanishing). Every list/detail payload carries `referred_count`.
`jobs/JobCard.jsx` exports the shared helpers:
- `isJobFilled(job)` — true when status is Filled/Closed OR
  `referred_count >= positions_available` (count wins over the flag).
- `filledLabel(job)` — **"Vacancy Filled"** when `positions_available === 1`,
  **"Vacancies Filled"** otherwise. Use these helpers; never re-derive locally.

Filled jobs show the label as a card ribbon and replace the Apply button with a
locked chip + banner; `ApplyWizard` entry is blocked client-side AND the apply
endpoint refuses server-side (§7.8). The wizard is a **3-step** flow (Personal
Info → Resume → Additional Questions); the cover-letter step was removed. Resume
options are exactly two: the PESO Kabankalan resume builder or PDF upload.

### 7.3 Resume snapshot architecture
Every application stores **its own** PDF in `application_resumes` (base64), so
the admin always retrieves exactly what was submitted. Uploaded PDFs are parsed
into `uploaded_resumes` **before** AI scoring via `pdfTextService`. Admin
retrieval is owner-scoped streaming; the ATS button fetches with the auth header
as a blob (a plain `window.open` cannot attach the bearer token).

### 7.4 AI compatibility scoring
`services/aiScoringService.scoreApplication()` reads `parsed_text`, prompts DeepSeek
via the unified `aiClient`, and returns `{ overall, skills, education, experience,
summary, provenance }` — or **`NULL`** on any failure (no résumé, AI down, unparseable, outside
0–100). `NULL` means "not scored" and routes to manual review; **the application
still succeeds**. It **NEVER fabricates a number** — the old `Math.random()` score is
long gone. **`provenance` (auditability, §35/F1): `{ provider, model, promptVersion, scoredAt }`**
— captured via `aiClient.chatDetailed()` (which reports the provider+model that ACTUALLY served the
response, after failover), stamped onto the score, and JSON-persisted whole into `ai_analysis`/
`current_ai_analysis` (NO migration). It is OUTPUT metadata, deliberately **NOT** in `buildScoringPrompt`/
`computeScoringSignature`, so a provider failover can never trigger a spurious re-score. Bump
`SCORING_PROMPT_VERSION` whenever the prompt changes. **`summary`** (the AI's one-sentence rationale) is
surfaced in the seeker board ("Why this score") + the admin drawer (§35/F2) — the score is an *explained*
number. Reproducible within a provider+model version (temp 0 + JSON mode); a failover / model-version bump is
the only drift, bounded by the immutable apply-time score + the hash guard (defense writeup: `docs/system-guide.md` §5). This ONE function is the single scoring engine behind EVERY compatibility %:
apply-time (`match_score`, computed ASYNC off the request path since 2026-08 — §22.1),
the Applicant Pipeline LIVE score (`current_match_score`,
§18.5), the AI-Recommended queue (`referral_queue.match_score`), the proactive matcher
(§20), AND the Public Board — the board's `/jobs/match` was UNIFIED onto it in the
Tier-1 recalibration, so it is no longer a thinner board-only prompt.

**Tier-1 recalibration (2026-08-02, §21):** one prompt for board + apply-time; the
job's `skills`/`qualifications` are now fed (they were being dropped) and experience/
education read under EITHER column name (raw apply-path vs aliased-worker); résumé
budget 3000→8000; **temperature 0 + JSON mode** so scores are REPRODUCIBLE (no
run-to-run drift) and the board number matches the apply-time number. Validated with
the eval harness (§21): MAE 3.6, 100% band accuracy on the labelled set. **No rubric
re-weighting** was done (the engine already scored well); scale anchors are deferred,
which is why strong matches ANCHOR around 85 — model behaviour, **not a code cap**.

**Requirement-only scoring + certificates DE-SCORED (2026-08-25, §40).** The prompt now scores
STRICTLY against the employer's STATED Requirements & Qualifications (education / experience / gender /
skills / qualifications): a stated-but-unmet requirement LOWERS the score; an UNSTATED dimension
neither helps nor hurts. The long-standing "do NOT lower for unstated" rule gained its SYMMETRIC twin —
**"do NOT raise the score for résumé content beyond the stated requirements"** — so unrequested résumé
extras cannot inflate the number. Separately, the **supporting-certificate SCORING path (Phase 2D-C /
§18.6 C.3) was REMOVED**: attached certificate FILES are still stored and admin-viewable as EVIDENCE
ONLY — they no longer feed the AI score and no longer arm a re-score (`getCertificateContext` deleted;
the worker's cert `extraContext` gone; the apply-time cert re-score trigger gone). The prompt's "certs
are supporting evidence, NOT mandatory" rule STAYS — it governs certs mentioned INSIDE the résumé, which
is still scored via `parsed_text`. `SCORING_PROMPT_VERSION` → `req-strict-2026-08-25` (one-time input-hash
re-baseline). Eval-confirmed calibration-neutral (`requirement-strict` variant: MAE 7.9, 100% band, 0 FP/
FN, off-tol 1 — the baseline). A "surface unrequested strengths in the `summary`" idea was TESTED and
REJECTED (every wording inflated strong matches / dropped band accuracy in the eval); the Manager already
sees the full résumé + the `summary` rationale for that context (0.4).

**Public board display (panel request, 2026-08):** the AI Compatibility module (Job
Details) shows the numeric `overall` % as the PRIMARY value, with the qualitative
`matchBand()` label as secondary text + a progress bar. Sub-scores (`skills`/`education`/
`experience`) are qualitative "High/Medium/Low" strings, NOT percentages — only
`overall` is numeric. "Explore Similar Jobs" (`RecommendationCarousel`) shows a neutral
`recommendation_reason`, NOT a compatibility score — leave it. Implementation detail
lives in `services/aiScoringService.js`, `routes/jobRoutes.js` (`/match`), and the
step-6 comment block in `routes/applicationRoutes.js`.

The threshold is a SYSTEM SETTING (§7.12), resolved DB row → env var → 60, and
**BOUNDED 50–80** (2026-08-01) so no administrator can quietly flood the queue with
low-confidence matches — improve staging SPEED via the workers, never by lowering
this bar. **Staging is now ALSO triggered on RE-SCORE (Enhancement B):** when an
applicant's LIVE score crosses the threshold, `applicationScoringService.considerStaging`
stages a 'Pending Review' recommendation (idempotent; a job edit also re-scores its
active applicants). Staging surfaces a candidate for REVIEW — it is not an approval,
so invariant 0.4 (a named admin approves every referral) is unchanged.
It is currently 60 and mediates ~4% of referrals — see §14 before tuning it.

### 7.5 Referral automation — transactional outbox + in-process worker
The reference pattern for **every** asynchronous feature. Do not invent a second
async mechanism.

- **Stage** — at apply time, if `aiScore.overall >= REFERRAL_AI_THRESHOLD`, a
  'Pending Review' referral is staged into the admin's AI-Recommended queue and
  the admin gets an `AI_RECOMMENDATION` notification. Sends nothing.
- **Approve** — `referralService.approveReferral` first enforces the **vacancy
  cap** (§7.8) inside the transaction, then writes four rows atomically:
  `referral_queue`, `referral_letters` (reference number reserved),
  `referral_jobs` (outbox), `referral_activity_log`. If this approval consumes
  the last slot it also flips the job to `'Filled'` **in the same transaction**
  and logs `JOB_FILLED`.
- **Drain** — `services/referralWorker.js` polls ~5s, claims rows with
  conditional atomic `UPDATE`s (no `SKIP LOCKED` in TiDB), advances **one step
  per commit**: `generate_pdf → send_email → notify → dispatch_n8n → done`.
- **Failure handling** — exponential backoff persisted in `next_run_at`;
  dead-letter after 5 attempts (admin gets a `REFERRAL_UPDATE` notification
  deep-linking to Failed Referrals); stuck jobs reclaimed on boot.
- **Notifications from the worker** — the `notify` step writes the applicant's
  `REFERRAL_ISSUED` row inside its own transaction then best-effort emits
  `referral_issued`; successful `send_email` notifies the owning admin
  (`REFERRAL_UPDATE` → `/referrals`) AFTER the commit via `notifyUser` so it can
  never trigger a duplicate-send retry.
- **Human in the loop** — the system never auto-sends; the audit trail proves it.

### 7.6 Digital tools — the Unified Document Builder *(rebuilt 2026-08-08, §30)*
The three separate wizards (`ResumeBuilder`/`CoverLetterBuilder`/`ResignationBuilder`)
were **replaced by ONE schema-driven framework**, `components/builder/DocumentBuilder.jsx`
(`docType` prop), serving résumé, cover letter, and resignation. Flow: **Template Gallery →
editor (structured forms + live A4 WYSIWYG preview) with AI woven in → export PDF + DOCX**.
The old "Create with AI / Create Manually" intermediate modal and `?mode=` branching are
GONE (Dashboard doc buttons open the gallery directly); AI and manual are integrated modes.
- **Rendering = `@react-pdf/renderer` client-side** — the SAME template component drives the
  live preview AND the PDF export (no drift). DOCX from the same structured data via `docx`.
  Both libs are route-lazy. `src/bufferPolyfill.js` (loaded first in `main.jsx`) provides
  the browser `Buffer` react-pdf needs to decode an embedded photo — without it, exporting a
  résumé WITH a photo throws "Buffer is not defined".
- **§12 CONSTRAINT (blueprint):** the résumé stays structured JSON; `/resume/draft` (incl. the
  `rescore` flag, §18.5) is UNCHANGED, so the AI scoring / ATS sync is preserved. Templates
  render FROM the model; they never replace it. Do NOT move the résumé to freeform rich text.
- **Drafts:** one per user per doc, change-driven autosave (`useDocumentDraft`). Résumé/
  resignation use SELECT→UPDATE/INSERT; **cover letter was fixed (2026-08-08)** — its table's
  `user_id` is non-unique so the old `ON DUPLICATE KEY UPDATE` inserted dup rows; POST now
  self-heals to one row and GET returns the newest non-empty draft (§30.2).
- **AI body generation is a SHARED service** `services/letterBodyService.js`
  (`generateBody` + per-doc prompts); cover letter AND resignation both `/generate-body`
  through it — but each endpoint is hit ONLY by its own builder (one click = one request; the
  shared service does not double-fire). PDFs still self-hosted via `pdfkit` as the export
  fallback. Detail: **§30** + `docs/document-builder-platform-plan.md` + UI addendum §16.

### 7.7 In-app notification system *(added 2026-07-19)*
The bell in `TopHeader` is backed by the `notifications` table end-to-end.

- **Single writer** — `services/notificationService.js` (invariant 0.11):
  - `notifyUser(io, { userId, type, title, body, link })` — DB row FIRST, then
    best-effort `io.to(user_${id}).emit('notification_created', …)`. Never throws.
  - `notifyNewMessage(io, { userId, senderName })` — **deduped**: one unread
    `NEW_MESSAGE` row at a time is refreshed instead of stacking a row per chat
    message.
  - `notifyAllJobSeekers(io, {…})` — one `INSERT … SELECT` for every active
    applicant + one io-wide `notification_broadcast` (payload carries
    `targetRole`; clients filter locally).
- **Types → deep links** (the routing contract):
  `NEW_APPLICATION` → `/peso-admin/ats` · `AI_RECOMMENDATION` →
  `/referrals/recommended` · `NEW_MESSAGE` → `/messages` · `NEW_JOB` →
  `/job-board` · `APPLICATION_STATUS` → `/my-applications` (seeker; §28) · `REFERRAL_ISSUED` →
  `/referrals` (applicant) · `REFERRAL_UPDATE` → `/referrals` or
  `/referrals/failed` (admin) · **`REFERRAL_WITHDRAWN` → `/referrals`** (seeker; a voided
  approved referral, §36.1) · **`APPLICATION_DECLINED` → `/my-applications`** (seeker; a
  rejected/not-referred application, §36.1). Add new types to `TYPE_META` in `NotificationBell.jsx`
  AND to `CONTROLLABLE_TYPES` in `notificationRoutes.js` (so it is muteable).
- **Notification Center (Phase 2, 2026-08-01)** — `components/NotificationCenter.jsx`
  at `/notifications` (linked from the bell's "See all & settings"): the full paged
  history (`GET /notifications/history`) plus per-type MUTE toggles
  (`GET`/`PUT /notifications/preferences`, table `notification_preferences`, mig 028).
  A muted `(user, type)` is SUPPRESSED at the single writer — `notificationService`
  checks `notificationPreferencesRepository.isMuted` (fail-OPEN: a lookup error never
  drops a notification) and adds a `NOT EXISTS` to the `notifyAllJobSeekers` bulk
  insert. Optional **daily digest** (`services/notificationDigest.js`, off by default
  via the `notification_digest_enabled` system setting) emails unread summaries
  through the email OUTBOX — a DB last-run marker paces it to once/day (no cron).
- **Emit points** — application submit (admin), AI staging success (admin),
  socket `send_message` (recipient, deduped), job create with Open/Published
  status (broadcast), ATS status change (applicant), worker email-sent and
  dead-letter (admin).
- **API** — `routes/notificationRoutes.js`: `GET /` (latest 40 + unread count),
  `PATCH /read-all`, `PATCH /read-by-link` (auto-acknowledge on module visit),
  `PATCH /:id/read`. All owner-scoped by `req.userId`.
- **Frontend** — `NotificationContext` holds BOTH the ephemeral toasts and the
  persistent bell store (optimistic mark-read; `markVisitedLink(pathname)` runs
  on every route change from `TopHeader`). `ChatContext` owns the socket and
  wires `notification_created` / `notification_broadcast` to refresh the bell —
  toasts for types not already toasted by their dedicated events
  (`NEW_MESSAGE`, `NEW_APPLICATION`, `REFERRAL_ISSUED` are in the quiet set).
  The bell opens on **click**, and ALSO on **hover** on desktop (hover + fine
  pointer only — capability-gated so touch keeps tap/click; §47). It shows **New**
  (unread) and **Earlier** (read) sections with per-type icon + source label +
  relative timestamp, and marks read on click or on visiting the linked module.
  (The original "click, never hover" rule was relaxed to hover-open by owner
  request in §47 — click + touch behaviour is unchanged.)

### 7.8 Vacancy-based referral management *(added 2026-07-19)*
One approved referral consumes one of `positions_available` (invariant 0.12).

- **Approval cap** — inside `approveReferral`'s transaction:
  `lockJobVacancy()` (`SELECT … FOR UPDATE` on the job row — serializes
  concurrent approvals) + `countApprovedForJob()`. At capacity → `ServiceError`
  409 with a human message; the AI-Recommended panel and ATS surface it as-is.
  'Pending Review' and 'Rejected' hold no slot.
- **Auto-fill** — the approval that consumes the last slot sets
  `status = 'Filled'` in the same transaction.
- **Reopen rule** — `PUT /peso-admin/jobs/:id`: if the submitted status is
  'Filled' but the new `positions_available` exceeds the approved count, the
  posting auto-reopens to 'Open' (raising the cap IS the reopen gesture).
- **Apply gate** — `POST /api/applications` refuses non-Open/Published statuses
  and count-filled jobs server-side (the disabled button is UX, not enforcement).
- **Surfaces** — public board keeps Filled postings visible with
  `filledLabel()`; admin dashboard cards show "N/M positions referred" + FULL
  chip; legacy over-cap rows (approved before the cap existed) simply render as
  filled — do not "fix" them.
- **Undispatched advisory** — `dispatch_n8n` dead-letters after 5 attempts and
  the referral is still complete (invariant 0.10). That made the gap invisible;
  `GET /referrals/undispatched` now surfaces it on the register as INFORMATION,
  never as an error. Detected by ABSENCE of the `N8N_DISPATCHED` audit entry,
  because the outbox row advances past the step while the audit entry is
  permanent.

### 7.9 Signup email verification — OTP *(added 2026-07-23)*
Registration is TWO steps and creates no account until the code is verified.

- `POST /auth/register` (or `/register/start`) validates, bcrypts the password,
  stages the signup in `email_verifications`, emails a 6-digit code, returns
  **202 `verification_required`**. `POST /auth/register/verify` is the ONLY place
  a `users` row is created. `/register/resend` re-sends.
- **Why staged, not `verified = 0`** — an unverified user row still burns the
  address, appears in every `COUNT(*)` on the landing page and admin metrics, and
  leaves a password hash for an address nobody has proven they own.
- **Security** — `crypto.randomInt` (never `Math.random`), stored as peppered
  SHA-256, constant-time compare, 10-min TTL, 60s resend cooldown, 5 sends and 5
  wrong guesses max, plus per-IP limiters ON TOP of the per-address pacing.
  SHA-256 not bcrypt: the space is only 1e6 and already closed by the attempt cap,
  and verify sits on the hot path of a signup.
- **Email failure here is RESILIENT, not fatal (updated 2026-07-28, §17).** The
  code is still the primary action, but `mailService` now fails over across
  providers (P0), and if EVERY provider is down the staged signup is KEPT (not
  rolled back) and `/register` returns `verification_required` with
  `deliveryPending: true`. A mail outage no longer blocks registration; the user
  resends once mail recovers. Verification integrity is unchanged. (The original
  design — 502 + rollback — made email a hard single point of failure.)
- **Backward compatible**: existing accounts are never asked to verify. Google
  signups skip OTP (Google already proved the address).

### 7.10 Avatar system *(added 2026-07-23)*
- `utils/avatar.js` resolves `avatar_thumb` → `avatar_url` → a deterministic
  DiceBear **micah** avatar seeded from the user id. `components/common/Avatar`
  is the ONLY component that renders a face; there is no initials fallback left.
- The generated tier is **derived, never stored** — that is why every pre-existing
  account gained a picture with no migration and no backfill.
- A **chosen gallery avatar IS stored**, as an SVG data URI, through the same
  `POST /profile/avatar` an upload uses — so nothing downstream can tell them
  apart. SVG is safe because avatars only ever render inside `<img>`.
- Company placeholders on JOB CARDS are a different thing: a company initial over
  a gradient, not an avatar. Do not swap those for `<Avatar>` — it draws people.

### 7.11 Referral outcomes, reporting and cancellation *(added 2026-07-23)*
- **Outcomes** (`referral_outcomes`) — `Issued → Employer Acknowledged →
  Interview Scheduled → Hired / Not Hired / Withdrawn / No Response`. Recorded by
  an administrator, because employers report hires by EMAIL to the office.
  `outcome_at` (when it happened) is stored separately from `recorded_at` (when
  it was typed in) because reports must use the real date. Deliberately NOT a
  state machine — employers routinely report "hired" with no prior step.
- **This is what makes the landing page honest.** "Successful Referrals" counts
  `outcome = 'Hired'`, not approved rows (§10, invariant 0.14).
- **Reports** — `/reports/summary` and `/reports/export` (CSV). Date range filters
  on ISSUE date so the placement rate's numerator and denominator describe one
  cohort. The rate ships **two ways** with the denominator spelled out, because
  "of all" and "of decided" read 6.7% and 100% on the same live data and either
  alone would be indefensible. CSV quotes every field, prefixes `= + - @` against
  Excel formula injection, and carries a UTF-8 BOM.
- **Cancellation** — `Voided` with a mandatory reason. The record is KEPT. The
  slot releases itself because the cap counts `Approved` rows; a posting
  auto-flipped to `Filled` reopens in the SAME transaction. It cannot un-send the
  email, and the dialog says so.
- **Audit trail UI** — `GET /referrals/:id/activity`, visible to the job seeker
  too. `referral_activity_log` had been written faithfully since the module was
  built and nothing ever read it back.
- **Collaborative outcome sync (2026-08-05, §26, flag `referral_lifecycle_sync_enabled`).**
  The seeker now SEES the real outcome in My Referrals (`listForApplicant` selects the
  `referral_outcomes` columns — it never did, so the pill was stuck on "Awaiting outcome"),
  is NOTIFIED (`REFERRAL_OUTCOME`) on every official change, and can SUGGEST an outcome they
  heard from the employer. A seeker suggestion is stored in `referral_outcome_history`
  (`is_official=0`) and NEVER touches `referral_outcomes`, so a self-reported 'Hired' can't
  enter the DOLE/landing stats until an administrator CONFIRMS it (invariant 0.14 preserved).
  `recordOutcome` takes `io` and appends an `is_official=1` history row; both parties refetch
  live via the `referral_outcome_updated` socket. Admin stays the sole writer of the official
  record.
- **Letter lifecycle** — letters are base64 in `referral_letter_files`.
  `scripts/backfill-referral-letters.js` rescued the 27 that existed only on
  disk; `scripts/regenerate-referral-letters.js` archives the superseded copy to
  `referral_letter_archive` before rebuilding. Regeneration keeps the ORIGINAL
  approval date (`pdfService` dates from `reviewed_at`) and **sends nothing**.

### 7.12 Super Administrator governance *(added 2026-07-23)*
- **Audit trail** — `adminAuditService` is the single writer; `/admin/audit` is
  paged and filterable. Account suspension, job deletion, role changes and
  setting changes all record. Before this, exactly ONE action wrote an entry.
- **Role administration** — `roleAdminService`, the most dangerous operation in
  the platform. There are TWO Super Administrators and NO way to create one
  except promotion by an existing one. Guards: last-Super-Administrator check
  taken under `SELECT … FOR UPDATE` (so two concurrent demotions cannot both
  read "count = 2"), self-demotion refused, and the audit entry written INSIDE
  the transaction (invariant 0.16). Validate the RAW role token, never the
  normalized one (invariant 0.15).
- **System settings** — `systemSettingsService` over `system_settings`.
  Resolution: DB row → env var → hardcoded default. Four settings are live and
  wired: AI referral threshold, signup kill switch, signup email domain
  allow-list, OTP lifetime. Values are read PER CALL, not captured at module
  load — a setting captured at boot appears to save and does nothing.
- **Platform health** — `GET /admin/health`: database reachability + latency,
  mail and AI configuration, referral-worker stuck/failed counts, and letters not
  yet stored durably. Every probe is independent so a failing check reports
  itself rather than 500-ing the page opened to diagnose it.

## 8. External integrations & environment

| Concern | Variables | Notes |
|---|---|---|
| AI gateway | `OPENROUTER_API_KEY` | → `deepseek/deepseek-chat` |
| AI direct | `DEEPSEEK_API_KEY` | still used by some routes |
| Translation | `DEEPL_API_KEY` | builders, chatbot |
| Email (SMTP) | `EMAIL_USER` / `EMAIL_PASS` or `EMAIL_APP_PASSWORD`; `EMAIL_FALLBACK_*` | nodemailer via Gmail + optional SMTP fallback. **SMTP is BLOCKED on Render** — used locally, dead in prod (§19.3) |
| Email (HTTP) | `BREVO_API_KEY` (+ `BREVO_FROM_EMAIL`/`BREVO_FROM_NAME`); `RESEND_API_KEY` (+ `RESEND_FROM`) | HTTP-API senders that work on the SMTP-blocked host (§19.3). Brevo leads the chain (verified single sender, no domain); Resend needs a verified domain |
| OAuth | Google client id/secret; **`GOOGLE_REDIRECT_URI`** (env-driven, §19.2); Indeed | **`GITHUB_*` removed — do not re-add** |
| Deployment URLs | **`FRONTEND_URL`** (CORS + OAuth redirects) or **`CORS_ORIGINS`** (csv); frontend **`VITE_API_URL`** (API+socket+OAuth button) + **`VITE_PIPELINE_POLL_MS`** | env-driven cross-origin wiring (§19.2). Localhost fallbacks keep dev unchanged |
| Database | `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SSL` | live TiDB |
| Referral tuning | `REFERRAL_AI_THRESHOLD`, `REFERRAL_WORKER_*` | now a **system setting** with the env var as fallback (§7.12) |
| Signup / OTP | `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_SENDS`, `OTP_MAX_ATTEMPTS`, `ALLOWED_SIGNUP_EMAIL_DOMAINS` | TTL and domain list are also system settings |
| Letterhead | `PESO_SIGNATORY_NAME` / `_TITLE` / `_ROLE` | printed on every referral letter |
| Object storage (§41) | **`STORAGE_DRIVER`** (`local` default \| `r2`); `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | job featured images via `services/storageService.js`. Unset ⇒ `local` (`uploads/`, dev). Set `r2` + the five `R2_*` on Render for prod (Cloudflare R2). Creds env-only, never to the frontend. Setup: `docs/cloudflare-r2-setup.md` |
| Deprecated | `PDFMONKEY_API_KEY`, `CORESIGNAL_API_KEY` | do not build on these |

Every integration must degrade: a missing or failing key produces a logged skip
and a NULL/manual path, never a 500 on a user-facing action. The ONE exception
is the signup OTP (§7.9), where the email IS the primary action.

`mailService` accepts `EMAIL_APP_PASSWORD` **or** `EMAIL_PASS`. They diverged
once — password resets worked on a host where referral mail did not.

`mailService` now sends through an **ordered provider chain** of two transport
kinds (§19.3): HTTP-API providers (Brevo, then Resend) FIRST, then the SMTP
providers (Gmail primary + `EMAIL_FALLBACK_*`). Each provider exposes a uniform
`{ name, send, verify }`; `sendMail` returns on the first success. HTTP providers
exist because **Render blocks outbound SMTP**, so nodemailer cannot connect in
prod. All are env-gated, so local dev (no HTTP keys) uses Gmail SMTP exactly as
before. Callers (`sendMail`/`verifyMailTransport`/`isMailConfigured`/
`getMailHealth`) are unchanged.

## 9. Frontend architecture

- **Shells** — `AppLayout` (Sidebar + TopHeader + main, in `App.jsx`) for job
  seekers and PESO admins; **`superadmin/SuperAdminLayout.jsx`** for super admins
  (no TopHeader — the bell/notification fetch is skipped for role `admin`). The
  admin shell was previously declared inline in `App.jsx` while an EMPTY
  `admin/layouts/AdminLayout.jsx` sat in the tree as a decoy.
- **Super Admin subsystem** (`src/superadmin/`) — FEATURE-based:
  `features/{overview,accounts,moderation,reports,verification,settings,audit}/`.
  Named `SuperAdmin*` / feature nouns, never bare `Admin*` — "Admin" is ambiguous
  here because `peso_administrator` is a different role with a different portal
  and the stored value for a Super Administrator is literally `'admin'`.
  **URL paths stay `/admin/*`** (bookmarked, and used in notification deep links).
  See `src/superadmin/README.md`.
- **`src/api.js` is the ONLY axios instance.** A component using bare `fetch` or
  its own client sends an unauthenticated request. Authenticated FILES (letters,
  resumes, CSV exports) are fetched as a blob because an interceptor cannot
  attach a header to `window.open()`.
- **TopHeader** — bell (badge = unread notifications; click-open panel per
  §7.7) + avatar menu; **hidden on mobile** (`hidden md:flex`).
- **Sidebars** are sticky; manual collapse/expand persisted in
  `localStorage['sidebarCollapsed']`. Hover-to-expand was removed.
- **State & persistence** — job application components must survive switching
  between sidebar views; lift state or cache rather than refetching.
- **Context** — `AuthContext` (token, role), `NotificationContext` (toasts +
  persistent bell store), `ChatContext` (the ONLY socket owner — new socket
  listeners join it, never a second connection). New cross-cutting state joins
  an existing context.
- **Landing page** — `LandingPage.jsx` stat tiles map 1:1 to
  `/api/job-board/stats` fields: `jobs`→Available Opportunities,
  `users`→Registered Job Seekers, **`hires`→Successful Referrals (referral_outcomes
  where outcome = 'Hired')**, `partners`→Active Local Employers (distinct
  companies on live postings). Never render one field into multiple tiles.
  `hires` previously counted APPROVED referrals — emailed letters published as
  placements (invariant 0.14).
- **Gebbie mascot** *(current design, 2026-07-19)* — an ORIGINAL honey-amber
  bunny (`#f7c873→#e09a3f` body, peach ears/hands/feet, rosy freckled cheeks,
  front teeth) whose only green element is the lime PESO sash + star badge; it
  sits on a **white-gray** panel (`#fafbfc→#e6e9ee`) with an animated
  amber/violet aurora, drifting glow orbs, and floating accent dots. The
  animation rig is class-based and REUSABLE: `.gebbie-body` (bob),
  `.gebbie-shadow` (synced squash), `.gebbie-sprout` (ear sway),
  `.gebbie-eyes` (blink), `.gebbie-wave-arm` (wave-then-rest), hover perk-up;
  speech bubble uses a calm rise-and-settle entrance (`speechIn`) + slow idle
  drift — no bounce/rotation. ALL of it is disabled under
  `prefers-reduced-motion`; keep new mascot/backdrop classes in that block.
- **Auth overlay** — compact split modal (`max-w-[880px]`, `max-h-[92vh]`,
  scrollable form pane): single full-width "Continue with Google", inputs
  `py-2.5 sm:py-3 text-sm` with leading icons (User/Mail/Lock), proper
  `autoComplete`, centered password toggle.

## 10. UI/UX conventions (mobile-first, compact)

- Page padding `p-3 sm:p-5 lg:p-6` (never `p-8`); cards `p-4 sm:p-6`;
  section spacing `space-y-6`.
- Inputs/selects `p-2.5 sm:p-3 rounded-lg text-sm`; headings
  `text-base sm:text-lg`; page titles `text-2xl sm:text-3xl lg:text-4xl`.
- Headers stack on mobile (`flex-col md:flex-row`); grids responsive; wide
  tables inside `overflow-x-auto`.
- **Carousels** — native scroll-snap with page-based pagination dots
  (reference: `RecommendationCarousel` in `PublicJobBoard.jsx`).
- **Vacancy states** — always via `isJobFilled()` / `filledLabel()` from
  `jobs/JobCard.jsx` (§7.2); labels are "Vacancy Filled" / "Vacancies Filled".
- The Create/Edit Job Posting modal (in `PesoAdminDashboard.jsx`) follows the
  compact spec (`max-w-3xl`, `space-y-6`, compact inputs) — keep it that way.
- Every AI-backed surface needs a defined empty/degraded state; `NULL` is a
  normal outcome (§7.4).
- **Accessibility (WCAG 2.1 AA pass, 2026-08-01).** Two guarantees are now GLOBAL
  in `src/index.css` — do not defeat them: (1) a `prefers-reduced-motion: reduce`
  catch-all collapses all animation/transition durations to ~0 (WCAG 2.3.3), so
  new animations are covered automatically; (2) a keyboard `:focus-visible`
  outline is restored on interactive elements even when a component uses Tailwind's
  `focus:outline-none` (WCAG 2.4.7) — so removing the ring for a mouse no longer
  removes it for keyboard users. Any styled `<select>` (e.g. status dropdowns)
  MUST carry an `aria-label` or an associated `<label>` — a bare coloured dropdown
  has no accessible name. The lime `#99e742` is contrast-safe ONLY on the dark
  green `#1a4a38` or in dark mode; never use it as text on a light surface.

## 11. Naming conventions — "PWD" → "Job Seeker"

The product is **no longer PWD-specific**. **Do NOT blindly replace remaining
"pwd"/"PWD" tokens** — these are deliberate:

| Token | Why it stays |
|---|---|
| `pwd_category`, `pwd_verification_status` | Physical DB columns kept for live-TiDB compatibility. `pwd_category` = government **ID type**; UI label "Verification Identity". |
| `"PWD ID"` | A real Philippine government ID card. |
| `accessibility_accommodations` | Genuine accessibility feature on job posts. |
| `pwd`, `pwdStrength`, `SAFE_PWD_DEFAULT` | These mean **password**. Never touch. |

`/admin/metrics` returns `users.job_seekers` (the `verifications.pending_job_seekers`
field was removed with Job Seeker Verification, §14). Before any rename, grep both
the column and its API key, and confirm the frontend consumer.

**Feature renames (2026-07-23)** — labels now describe purpose, not mechanism:

| Was | Now | Why |
|---|---|---|
| Upload Resume *(button)* | **Analyze My Resume** | It parses, extracts career history and generates DeepSeek insights. Uploading is the input, not the feature. |
| Upload Resume *(modal)* | **AI Resume Analysis** | |
| Import Tracker | **Import Past Applications** | It ingests an xlsx/csv of historical applications; it tracks nothing. |
| "Upload Resume" CTAs → `/builder` | **Add Your Resume** | They offer a builder, not an upload. |
| `admin/` module, `Admin*` components | **`superadmin/`, `SuperAdmin*` / feature nouns** | "Admin" collided with PESO Administrator (§9). |

**Code identifiers renamed, URL paths NOT.** `/admin/*` stays.

## 12. Engineering conventions & patterns

- **Never fail the primary action for a secondary concern** — AI, email,
  notifications, snapshots, staging: each wrapped independently, logged, skipped.
- **Notifications**: only via `notificationService` (row first, socket second,
  never throws). New notification types need a `TYPE_META` entry in TopHeader.
- **PDF text extraction**: only via `pdfTextService.extractPdfText()` /
  `isPdfExtractAvailable()` — never `require('pdf-parse')` directly.
- **Durable binaries as base64 in the DB**, in their own table.
- **Transactions around multi-write invariants** — referral approval (four rows
  + vacancy cap + auto-fill), question replace-all.
- **`safeQuery`** returns a default on SQL failure so dashboards degrade.
- **Owner-scoping** — PESO-admin endpoints filter by `peso_admin_id = req.userId`;
  notifications by `user_id = req.userId`. Authentication is not authorization.
- **Auth transport** — bearer JWT in `sessionStorage`; authed downloads via
  fetch → blob URL.
- **Modular extension over refactor** — narrow edits, no functional regressions.
- **SQL style** — uppercase keywords; `mysql2` placeholders; explicit column
  lists in list endpoints; subquery-computed `referred_count` follows the
  existing pattern in jobBoard/pesoAdmin list queries.

## 13. Migrations, environment & gotchas

**Migration system** — numbered files in `migrations/`, applied by
`npm run migrate`, tracked in `schema_migrations` (`migrate:status`,
`migrate:baseline`). The runner announces its target host — read that line, the
target is production. `db.js` `initDB()` is pending retirement; new DDL always
goes through a migration. **Applied through `053` (owner-APPLIED 2026-09-14).** `052` adds `users.oauth_provider` (honest Linked-Accounts Connected state + backfill of passwordless→'google', §68); `053` adds `users.google_sub`/`google_email` + `UNIQUE INDEX uq_users_google_sub` (Google account link/unlink + duplicate protection, §68). **No migration in §69** — the PESO/Super-Admin account consolidation was a one-off DATA operation via `scripts/consolidate-*.js` (reassignment + guarded delete, backup-first), not schema. Earlier — **Applied through `051_job_company_email.sql`** (2026-09 — `051` adds
`pesoadmin_job_posts.company_email`, the authoritative employer referral recipient, §61 — owner-APPLIED;
`050` adds `conversation_states` (Messages mute/pin/manual-unread) + `referral_preferences` (seeker
auto-accept/decline), §60 — owner-APPLIED; both also have zero-crash boot creates. `049` adds the
`import_batches` audit/idempotency ledger for Import Past Applications, §49; `048` event-banner rollback
archive APPLIED, §45.6). Earlier — **`047_cover_letter_drafts_unique.sql`** (2026-08-24 — `047`
adds `UNIQUE(user_id)` on `cover_letter_drafts` after deduping (§30.2 hardening, §14) — APPLIED + owner-verified.
Earlier `044` SMS channel + `045` walk-in claim (§32) and `046` account-suspension metadata (§33) all APPLIED + owner-verified. Earlier — the
office-interview cycle §31: `040` job gender, `041` peso_events, `042` referral seeker-acceptance states,
`043` walk-in columns; all owner-APPLIED. **`044` (SMS channel) + `045` (walk-in claim) are the §32
follow-up migrations — ON DISK, additive, and must be applied with `npm run migrate` (owner runs it).** Earlier `038`+`039` are the AI re-score-guard columns of §29;
their flags `SCORING_INPUT_HASH_GUARD` / `PROACTIVE_INPUT_HASH_GUARD` are `true` in prod → guards LIVE,
each worker boot-logs `input-hash guard ON`). Migrations
through `037_application_preferences.sql` (2026-08-05): Phase 2C + Phase 2D + the Proactive AI Referral Workflow (§20) + the Saved
Vacancies bookmark-manager refactor (§23) + ATS status standardization (035) + the
Referral Lifecycle Synchronization ledger (036, §26) — email outbox, notification
preferences, application scoring, supporting certificates, job alerts, proactive
referrals, saved-job snapshots, and the outcome-history/suggestion table, all additive
(`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`; 033 adds one guarded UNIQUE;
034/035/036 add columns/data + a backfill). See §17–§18, §20, §23, §26,
`docs/phase-2c-email-outbox-plan.md`, `docs/phase-2d-ai-enhancements-plan.md`,
`docs/proactive-ai-referral-plan.md`, and `docs/referral-lifecycle-sync-plan.md`.

| # | What it added |
|---|---|
| 019 | `avatar_thumb`, `verification_id_type` |
| 020 | `email_verifications`, `users.email_verified_at` (OTP signup) |
| 021 | `referral_letter_files` — durable base64 letters |
| 022 | `referral_letter_archive` + `source='regenerated'` |
| 023 | `referral_outcomes` — placement tracking |
| 024 | `referral_queue.status += 'Voided'`, void columns |
| 025 | `system_settings` (seeded EMPTY on purpose) |
| 026 | `pesoadmin_profiles` office fields (`office_hours`, `office_phone`, `office_email`, `facebook_url`) — PESO org profile (§17) |
| 027 | `email_outbox` — generic transactional-email queue (Phase 2C). Applied. |
| 028 | `notification_preferences` — per-user/per-type notification mute (Notification Center). Applied. |
| 029 | `job_applications` live-score cols + `application_scoring_jobs` outbox — dynamic re-scoring (Phase 2D-B). Applied. Behind `APPLICATION_SCORING_ENABLED`. |
| 030 | `user_certificates` (library) + `application_certificates` (snapshot) — supporting certificates (Phase 2D-C). Applied. |
| 031 | `job_alert_jobs` / `job_alerts_sent` / `job_alert_preferences` — AI job alerts (Phase 2D-D). Applied. Behind `JOB_ALERTS_ENABLED`. |
| 032 | `proactive_referral_candidates` + `proactive_match_jobs` outbox + `job_applications.origin`/`referred_by`/`referred_at` — Proactive AI Referral Workflow (§20). Applied. Behind `PROACTIVE_REFERRALS_ENABLED`. |
| 033 | `job_applications` **guarded** `UNIQUE(job_id, applicant_id)` — one application per (seeker, job) at the DB level (§20). Applied (run the header dedup pre-check first). |
| 034 | `saved_jobs` snapshot columns (`job_title`/`job_company`/`job_location`) + `last_checked_at` — Saved Vacancies bookmark-manager refactor (§23). Applied. Additive + backfill. |
| 035 | ATS status standardization (§18.5): backfill approved-referral apps → `'Referred'` (34) + fold `'Interview'`→`'Shortlisted'`. Applied. DATA-only (status is VARCHAR), idempotent; terminal `Hired`/`Rejected` left historical. |
| 036 | `referral_outcome_history` — structured outcome-transition ledger + seeker-suggestion channel (§26). Applied. Additive; VARCHAR outcome (no enum-append); forward backfill of one official row per existing `referral_outcomes` (NOT EXISTS-guarded). Behind `referral_lifecycle_sync_enabled`. |
| 037 | `application_preferences` (user_id, app_uid, is_pinned, color_label) — per-user pin + colour label for the card-based My Applications, keyed by the unified uid; no FK (§28.5). **Applied (2026-08-07).** Additive; the unified feed reads it best-effort. |
| 038 | `job_applications.last_scored_input_hash CHAR(64)` — change-detection guard for AI re-scoring (§29). **APPLIED + flag `SCORING_INPUT_HASH_GUARD=true` in prod (2026-08-08) → guard LIVE, owner-verified** (Render log `skipped — inputs unchanged`). Additive `ADD COLUMN IF NOT EXISTS`. |
| 039 | `proactive_referral_candidates.last_scored_input_hash CHAR(64)` — same guard for the proactive matcher (§29). **APPLIED + flag `PROACTIVE_INPUT_HASH_GUARD=true` in prod (2026-08-08) → guard LIVE.** Additive. |
| 040 | `pesoadmin_job_posts.gender VARCHAR(20)` — Gender as a job qualification field, fed to the AI scorer (§31.2, #11a). **APPLIED.** Additive. |
| 041 | `peso_events` — extensible Events/Announcements subsystem (event_type discriminator, base64 banner, status) (§31.4, #2). **APPLIED.** Additive `CREATE TABLE IF NOT EXISTS`. |
| 042 | `referral_queue.status += 'Pending Seeker Acceptance','Declined'` — seeker referral-acceptance lifecycle (§31.5, #6). **APPLIED.** Append-only enum (§13). Behind `referral_acceptance_enabled`. |
| 043 | `users` walk-in columns (`account_origin`/`claim_status`/`encoded_by`/`claim_token`/`claimed_at`/`consent_given_at`) — Walk-In registration (§31.7, #7). **APPLIED.** Additive. Behind `walk_in_registration_enabled`. |
| 044 | `sms_outbox` + `phone_verifications` + `users.phone_verified_at`/`sms_opt_in` — SMS notification channel (§32.1, #8). Additive (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Ships dark; behind `sms_notifications_enabled` + a configured `SMS_PROVIDER`. **APPLIED (2026-08-23).** |
| 045 | `users.claim_token_expires_at`/`claim_reissued_at`/`claim_reissue_count` — Walk-In account CLAIM expiry + reissue (§32.2, #7). `claim_token` now stores a peppered SHA-256 HASH (code shown once). Additive. **APPLIED (2026-08-23).** |
| 046 | `users` suspension metadata (`suspended_at`/`suspension_reason`/`suspension_ends_at`/`suspended_by`) — server-side account-suspension enforcement (§33.1). Populated on suspend, CLEARED on reactivate; NO auto-reactivation. Additive. **APPLIED + owner-verified (2026-08-23).** |
| 047 | `cover_letter_drafts` `UNIQUE(user_id)` (`uq_cover_letter_drafts_user`) — DB-level defense-in-depth for the dup-row bug (§30.2, §14). STEP 1 dedups each user to the row the GET returns (newest non-empty JSON body, else newest) via TiDB `_tidb_rowid` (no PK on the table), idempotent; STEP 2 adds the unique index (plain `ADD UNIQUE INDEX` — this TiDB parser rejects `ADD INDEX IF NOT EXISTS`). FK index left in place. **APPLIED + owner-verified (2026-08-24; 253 dup rows removed, 10 kept, every letter preserved).** |
| 048 | `peso_events.banner_image_legacy LONGTEXT NULL` — rollback archive for the event-banner base64→R2 migration (§45.6). The migration script copies the original base64 here BEFORE overwriting `banner_image` with the R2 URL, so a rollback restores it. Additive `ADD COLUMN IF NOT EXISTS`, no event data touched. **APPLIED + owner-verified (2026-09; all 3 banners on R2, HTTP 200).** |
| 049 | `import_batches` (`user_id`, `import_id`, `file_name`, counts, `created_at`; `UNIQUE(user_id, import_id)` + `(user_id, created_at)` index) — Import Past Applications audit/idempotency ledger (§49). Counts only — the normalized application rows go into `usertrackedjobs`, no raw CSV retained. Additive greenfield `CREATE TABLE IF NOT EXISTS`. **APPLIED (2026-09).** |
| 050 | `conversation_states` (`user_id`,`conversation_id` PK, `is_muted`,`pinned_at`,`manually_unread`,`updated_at`) — per-viewer Messages Hub state (mute / pin ≤5 / manual-unread), §60 — AND `referral_preferences` (`user_id` PK, `mode` VARCHAR default `manual`, `updated_at`) — seeker referral automation (manual/auto_accept/auto_decline), §60. Both greenfield `CREATE TABLE IF NOT EXISTS` + zero-crash boot creates (`messageRoutes.js`/`profileRoutes.js`). **APPLIED (2026-09).** |
| 051 | `pesoadmin_job_posts.company_email VARCHAR(255) NULL` — the authoritative employer referral recipient read into the automation payload (`findReferralForDispatch` → `pj.company_email`), §61. Validated + required-on-Published at the API. Additive `ADD COLUMN IF NOT EXISTS` + zero-crash boot ALTER (`pesoAdminRoutes.js`). **APPLIED (2026-09).** |
| 052 | `users.oauth_provider VARCHAR(20) NULL` — the external identity provider linked to an account (`'google'` \| NULL local), so Account Settings → Linked Accounts shows the REAL Connected state instead of assuming every account is Google-linked (§68.4). Additive `ADD COLUMN IF NOT EXISTS` + **backfill** `oauth_provider='google' WHERE password IS NULL OR password=''` (the app's existing heuristic). Zero-crash boot ALTER (`authRoutes.js`). **ON DISK — owner runs `npm run migrate`.** |
| 053 | `users.google_sub VARCHAR(64) NULL` + `users.google_email VARCHAR(255) NULL` + `UNIQUE INDEX uq_users_google_sub (google_sub)` — the Google account-LINK identity (stable `sub` = duplicate key; `email` = display) backing the full Linked-Accounts connect/disconnect flow (§68.5). `google_sub` is all-NULL at apply time so the unique add can't hit a dup; plain `ADD UNIQUE INDEX` (this TiDB parser rejects `IF NOT EXISTS` on ADD INDEX, §13). Additive columns + zero-crash boot ALTER. **ON DISK — owner runs `npm run migrate`.** |

**Hard-won gotchas**

- **Enum truncation rolls back transactions.** `pesoadmin_job_posts.status` was
  `ENUM('Open','Closed','Draft')` while the app wrote 'Published' and 'Filled' —
  `WARN_DATA_TRUNCATED` (errno 1265) failed the entire referral-approval
  transaction with a 500. TiDB only supports **appending** enum values (instant
  metadata change); never reorder or remove them. Before writing a new enum
  value anywhere, check `INFORMATION_SCHEMA.COLUMNS.COLUMN_TYPE` first.
- **`pdf-parse` v2 has no callable default export** — the v1 style
  `await pdfParse(buffer)` throws "pdfParse is not a function". Use
  `pdfTextService`.
- **`CREATE TABLE IF NOT EXISTS` silently skips a mismatched existing table.**
  Verify shape via `INFORMATION_SCHEMA`.
- **Production TiDB, no test credentials, email-gated signup.** Verify with
  `npm run build` + public-endpoint curls; authed flows need the user's login.
  Read-only probes against prod are fine; test writes only inside a rolled-back
  transaction.
- **Vite preview is 4300**; dev 5173 (frontend) / 5000 (backend, nodemon).
- **Windows dev host** — prefer Docker for local services; `dist/` is a build
  artifact — never hand-edit.
- **`normalizeRole()` maps ANYTHING unknown to `JOB_SEEKER`.** Fine for reading a
  legacy value, catastrophic for validating one you are about to write —
  `normalizeRole('wizard')` returns `'applicant'`. Validate the raw token against
  `ROLE_ALIASES` before writing (invariant 0.15).
- **Never test a write path against production.** A validation test that called
  `changeUserRole` promoted a real Job Seeker to Super Administrator; it had to
  be reverted by hand. Test the pure function, or wrap in a rolled-back
  transaction.
- **`assets/letterhead/letterhead.png` must exist AND be committed.** Absent, the
  generator silently falls back to a text-only header — which it did for every
  letter issued before 2026-07-23. A real letter is ~397KB; a fallback is ~2.9KB,
  so size is the tell.
- **The letterhead artwork is header + footer with a BLANK middle.** A full
  filled-in letter template double-prints under the generated body.
- **A module-level `const` reading `process.env` cannot become a runtime
  setting.** It keeps serving the boot-time value, so the setting appears to save
  and does nothing. Read per call (§7.12).
- **Boolean env flags are matched with a STRICT `=== 'true'`, and a TRAILING SPACE
  breaks them.** `APPLICATION_SCORING_ENABLED`, `EMAIL_OUTBOX_ENABLED`,
  `PROACTIVE_REFERRALS_ENABLED`, `JOB_ALERTS_ENABLED`, `WORKER_MODE`, etc. — a value
  of `"true "` (trailing space) is `!== 'true'`, so the feature ships DARK even though
  the dashboard "looks" set. **`dotenv` TRIMS the trailing space (local `.env` is
  safe); Render's dashboard env vars are NOT trimmed** — so a flag can work locally
  and be silently OFF in production. ✅ CHECKLIST before shipping / when a flagged
  feature "doesn't run" in prod: open the Render dashboard var and confirm the value is
  exactly `true` with NO leading/trailing whitespace (retype it, don't trust the eye).
  Verify with `node -e "require('dotenv').config(); console.log(JSON.stringify(process.env.FLAG), process.env.FLAG==='true')"` locally; on Render, a `[Worker] Disabled`
  / `[ScoringWorker] Disabled` boot log means the flag didn't match.

## 14. Known-broken / parked work

| Item | State | Rule |
|---|---|---|
| **Exclude REFERRED apps from live re-scoring** | **DONE 2026-08-04 (`b7616c2`, migration 035)** | Referred applications are now finalized records excluded from live re-scoring (§18.5). `ACTIVE_STATUSES=['Applied','Under Review','Shortlisted']`; both enqueue paths AND-in `NOT_FINALIZED` (`NOT EXISTS` an Approved referral); worker race-guards on `is_referred`/status. `approveReferral` sets status `'Referred'`, `voidReferral` reverts to `'Shortlisted'` (reopen re-enables scoring). Apply-time `match_score` stays immutable. Application-specific: a new application to another vacancy still scores. |
| **Job Seeker Verification** | **REMOVED from scope (2026-08-01)** | Approval workflow decommissioned by product decision: `/verification/status` & `/verification/submit`, the admin `/verifications/*` endpoints, the Super Admin queue + nav + routes, the Pending-Verification KPI, and the profile ID-**document** upload + status badge are all gone. `job_seeker_verifications` / `verification_history` left dormant (§0.7). Do not reintroduce. The referral-letter ID-**type** selector (`verification_id_type` / `pwd_category`, `/verification/id-types`, `verification_id_types`) is a separate feature and is unaffected. |
| PDFMonkey | **REMOVED from code (2026-07-28, §17)** | Cover-letter & resignation PDFs are now self-hosted via `services/letterPdfService.js` (pdfkit). Do not re-integrate. `PDFMONKEY_API_KEY`/`COVER_LETTER_TEMPLATE_ID` are dead env. |
| Coresignal | Superseded | Do not re-integrate (still referenced in `profileRoutes` enrichment, optional/skipped) |
| `initDB()` legacy DDL | Pending retirement | Read-only; new DDL to migrations |
| Cover-letter step in Apply Wizard | Removed by decision | Do not reintroduce |
| GitHub OAuth | Removed by decision (2026-07-19) | Do not reintroduce; former GitHub users recover via Forgot Password |
| Pagination on referral/admin lists | **Server-side (Phase 1, 2026-08-01)** for Super-Admin Users & Job Moderation and the **Referral Register** (`GET /admin/users`, `/admin/jobs`, `/referrals` take `?page,limit,q,…` → `{data,total,page,limit}`; shared `utils/pagination.getPageParams` + `components/common/Pagination.jsx`). The register's derived delivery-state filter/counts run in SQL via `DELIVERY_STATE_CASE` in `referralRepository` — **it MUST stay in lockstep with `deliveryState()` in `Referrals.jsx`**. Still client-side: the cross-job ATS applicant list (fast-follow) and the audit trail (was already paged). |
| AI-Recommended queue | Mediates ~4% of referrals (1 of 28) | Instrument the score distribution BEFORE tuning the threshold |
| Referral rejection | Implemented, never used in production | Find out why before building on it |
| Letter retention policy | Not set | `referral_letter_files.purge_after` exists and nothing reads it. Age the PDF only, never the record |
| `cover_letter_drafts` `UNIQUE(user_id)` hardening | **DONE (migration 047, 2026-08-24)** | The dup-row bug (§30.2) is now closed at the DB level too. Migration 047 deduped each user to the row the GET returns (via TiDB `_tidb_rowid`, the table has no PK) then added `UNIQUE(user_id)`. Applied + owner-verified (253 dup rows removed, 10 kept, every letter preserved; unique index present). The POST self-heal (§30.2) stays as belt-and-suspenders — do NOT revert it to `ON DUPLICATE KEY UPDATE` |
| The 27 pre-2026-07-23 letters | Regenerated with letterhead + address | Superseded copies are in `referral_letter_archive`; nothing was re-sent |

## 15. Recent changelog (2026-07-23 — current state)

**Registration & identity**
- **OTP email verification** (020) — two-step signup; no `users` row until the
  code is verified. Peppered SHA-256, 10-min TTL, resend cooldown, attempt caps,
  per-IP limiters. Existing accounts unaffected; Google signups skip it.
- **Avatar system** — `utils/avatar.js` + `components/common/Avatar`. DiceBear
  micah fallback derived from the user id (never stored), gallery picker whose
  selection IS stored through the upload endpoint. Every initials fallback gone.
  `imageThumb.js` was dead code and is now actually wired, so uploads finally
  downscale instead of storing ~319KB originals.

**Referral management** (the bulk of the work)
- **Durable letters** (021) — base64 in the DB. 27 letters were on Render's
  ephemeral disk with rows insisting they existed; `backfill-referral-letters.js`
  rescued all 27.
- **Official letterhead** — `assets/letterhead/letterhead.png` committed. Fixed
  two overlaps only visible once real artwork existed: a duplicated office
  subtitle and a double-printed address strip (`hasImageFooter` had been returned
  and discarded since it was written).
- **Address fields fixed** — `pdfService` read `applicant_address` /
  `company_address` / `job_location`; `findReferralById` selected NONE of them,
  so EVERY letter ever issued read "a resident of ______" with a blank company
  address. Data existed all along in `users.location` and
  `pesoadmin_job_posts.location`.
- **Regeneration with archiving** (022) — the 27 rebuilt with letterhead and
  addresses; superseded copies archived; original approval dates preserved;
  nothing re-sent.
- **Placement outcomes** (023) — the lifecycle no longer ends at "email sent".
  The landing page's "Successful Referrals" now counts real hires.
- **Reports & CSV export** — monthly count, name list, placement rate reported
  two ways with the denominator stated.
- **Audit trail UI** — `/referrals/:id/activity`, visible to job seekers too.
- **Cancellation** (024) — `Voided` with a mandatory reason; slot released;
  posting reopened in the same transaction.
- **n8n advisory** — the 25-of-27 dispatch gap is now visible.

**Super Administrator subsystem**
- **Restructured** `src/admin/` → `src/superadmin/`, feature-based, `SuperAdmin*`
  naming, URLs unchanged. Deleted 9 dead files — six were 0 bytes, including an
  `AdminLayout.jsx` decoy shadowing a layout declared inline in `App.jsx`, and an
  unused `adminApi.js` with a hardcoded localhost URL.
- **Two role bugs fixed** — the account matrix compared raw role strings, so
  every PESO Administrator rendered with the applicant badge showing
  `PESO_ADMINISTRATOR` raw, and the role filter matched none of them.
- **New capabilities** — audit trail viewer, guarded role administration,
  real system settings (025) wired to four live behaviours, platform health.
  Account suspension and job deletion are now audited and validated.

**Terminology** — Upload Resume → Analyze My Resume, Import Tracker → Import
Past Applications, builder CTAs → Add Your Resume (§11).

**Documentation** — `docs/system-guide.md` (demonstration reference) and
`docs/referral-management-enhancement.md` (review + roadmap); file headers added
across ~21 backend and frontend modules that had none.

## 16. Pre-flight checklist

Before proposing or shipping a change:

1. Does it reintroduce Job Seeker Verification (the identity APPROVAL workflow)? → don't; removed by decision (§14). The referral-letter ID-**type** field is separate and stays.
2. Does it add asynchronous work? → outbox + worker pattern (§7.5), not a new
   mechanism, not `setTimeout`, not n8n.
3. Does it add schema? → numbered migration; enum changes append-only; column
   names checked against §11.
4. Does it add a query? → no `JOIN userprofiles` unless selected from;
   owner-scope filter present; placeholders; uppercase keywords.
5. Does it store a binary? → base64 in its own DB table; PII to `storage/`,
   never `/uploads`.
6. Does it call AI, email, or write a notification? → wrapped, degradable,
   NULL-safe; notifications only via `notificationService`; the primary action
   still succeeds if it fails.
7. Does it create/consume referrals? → the vacancy cap (§7.8) holds: count vs
   `positions_available` inside the transaction, 409 past capacity.
8. Does it notify users of something new? → reuse an existing notification type
   or add the type + `TYPE_META` entry + deep link together.
9. Does it add UI? → §10 spacing spec, responsive, `overflow-x-auto` for wide
   tables, degraded/empty state defined, filled-state labels via
   `filledLabel()`, new animations added to the `prefers-reduced-motion` block.
10. Does it rename anything? → §11 checked on both the DB column and the API key.
    Renaming a URL path is separate from renaming code — paths are bookmarked
    and appear in notification deep links.
11. Does it WRITE a role, or any enum-like value? → validate the RAW input
    against a known set. `normalizeRole()` will not reject bad input (0.15).
12. Does it touch the Super Admin subsystem? → `SuperAdmin*` / feature naming,
    `src/superadmin/features/<feature>/`, and read `superadmin/README.md`.
13. Does it change a referral's meaning? → delivery state and placement outcome
    are separate axes (0.14). Do not compute a placement figure from approvals.
14. Does it add a tunable? → a system setting (§7.12) read PER CALL, with the
    env var as fallback — not a module-level `const`.
15. Does it produce or consume a referral letter? → durable base64 (0.13);
    archive before regenerating; never re-send silently.
16. Verified how? → `npm run build`, `node --check`, targeted read-only probes,
    and a stated manual step for anything behind auth. **Never exercise a write
    path against production** (§13). Say plainly what was not verifiable.
17. Calling AI? → `services/aiClient.chat(...)` (§17), NEVER inline OpenRouter/
    DeepSeek axios. Generating a cover-letter/resignation PDF? →
    `services/letterPdfService.js` (pdfkit), NEVER PDFMonkey. Sending email? →
    `mailService.sendMail` (has provider failover).
18. Does it add or change an EXPORT / download (CSV/PDF)? → pull the COMPLETE
    authorized dataset from the BACKEND (owner-scoped / RBAC), respect the module's
    active filters + date range, and NEVER export only the visible page. A dashboard /
    analytics export must stay at PARITY with what is displayed via a SHARED computation
    (e.g. `computeOverview`), never a second copy of the SQL (§44). Standardize on
    `utils/csv.js` (`sendCsv` / `csvField` — BOM, escaping, formula-injection guard) and a
    stable filename.

## Development history — phase records (§17–§26 → `references/development-history.md`)

The dated, phase-by-phase development records **§17–§26** were moved to
**`references/development-history.md`** (2026-08-05) to keep this always-loaded file lean;
§0–§16 above remain the core reference. Section numbers are unchanged, so every `(§NN)`
cross-reference still resolves. **Load that file** when you need a phase's detail, a commit
hash, or a subsystem's history.

Index (all in `references/development-history.md`):
- **§17** Resilience hardening — aiClient failover, mailService provider chain, PDFMonkey retired, Platform Health / Workflow Automation pages (2026-07-28)
- **§18** Part 3 + Phase 2C/2D — **§18.1 the six-worker outbox roster**, **§18.5 dynamic re-scoring (REFERRED apps are finalized & excluded)**, **§18.9 hybrid pipeline polling** (2026-08-01)
- **§19** Cross-origin Vercel + Render deploy, env-driven URLs, HTTP email Brevo/Resend (2026-08-02)
- **§20** Proactive AI Referral Workflow — Smart Referral Queue (2026-08-02)
- **§21** AI scoring Tier-1 recalibration + eval harness `npm run eval:scoring` (2026-08-02)
- **§22** Performance hardening — async apply scoring, caches, `GET /admin/timing`; never inline DDL in a handler (2026-08-02)
- **§23** Saved Vacancies bookmark-manager refactor (2026-08-02)
- **§24** Theme design-token system; **§24.1 interaction-state token standard = MANDATORY UI review gate** (2026-08-03)
- **§25** Infrastructure Optimization roadmap — **DEFERRED but APPROVED; remind each session**; **`WORKER_MODE` is UNSET in prod** (single-service, workers share `io`) (2026-08-04)
- **§26** Referral Lifecycle Synchronization + real-time hardening + R1 similarity duplicate detector (2026-08-05)
- **§27** "Building with Good UX" — Empty State design system (`common/EmptyState`, `GettingStartedGuide`) + unified Search Dropdown (`common/SearchDropdown`, supersedes below-content chips) (2026-08-07); component reference in `references/ui-ux-and-responsive-layout.md` §14–§15
- **§28** Job Seeker application-lifecycle consolidation — ONE `My Applications` (`/my-applications`) over `GET /api/applications/unified`; `/jobs` redirects; `MyJobs`/`MyPesoApplications` deleted; referrals still FK-bound to `job_applications` (2026-08-07)
- **§29** AI re-scoring change-detection input-hash guard — BOTH scoring workers skip a redundant DeepSeek call when scoring inputs are byte-identical (deterministic, temp 0); **LIVE in prod (migs 038/039 applied, flags `SCORING_INPUT_HASH_GUARD`/`PROACTIVE_INPUT_HASH_GUARD` set true, owner-verified; workers boot-log `input-hash guard ON`)**; guards at EXECUTION not scheduling (never swallows a real re-score); preserves the Resume→scoring sync. Also: Document Builder platform blueprint `docs/document-builder-platform-plan.md` (planning) (2026-08-08)
- **§30** Unified Document Builder — SHIPPED: one `components/builder/DocumentBuilder` (docType prop) replaces the 3 wizards; Template Gallery + live react-pdf A4 preview + PDF/DOCX export; AI/Manual modal removed; §12 résumé→scoring sync preserved. Buffer polyfill for photo export. Fixes: cover-letter draft dup-row recovery (no migration) + resignation "Generate Body with AI" via shared `services/letterBodyService`. On `main` (HEAD `ee0da67`), pushed. `npm test` 74 (2026-08-08)

- **§31** Office-interview requirements — Phases 1–6 + Positions-Not-Specified (2026-08-23, HEAD `dd8a7e3`, pushed, migs 040–043 APPLIED, `npm test` 97): Phase 1 landing-stat removal + `/home` button + JPM field removals + job-seeker mascot; §1.5 Gender job field (mig 040) + scoring-input refinement (employer-stated authoritative, certs non-mandatory); Phase 2 **PESO Staff `peso_staff` RBAC** (deny-by-default, `effectiveOwnerId`, `requirePermission`); Phase 3 **Events subsystem** (mig 041, `peso_events`, `EVENT_ANNOUNCEMENT`); Phase 4 **referral acceptance** (`referral_acceptance_enabled`, mig 042, endorse→accept→letter, `REFERRAL_ENDORSEMENT`) + **vacancy de-automation** (`vacancy_manual_fill_enabled`, no auto-fill, status-based `isJobFilled`); Positions **"Not Specified"** (NULL headcount); Phase 5 **walk-in registration** (`walk_in_registration_enabled`, mig 043, claimable `users` row); Phase 6 **SMS proposal + `smsService` abstraction** (ship-dark, provider TBD); settings-flag FIX + D6 soft-warn.
- **§32** Office-interview FOLLOW-UPS (2026-08-23, migs 044/045 **APPLIED**): **SMS channel BUILT** (mig 044; provider-agnostic `smsService` — Semaphore wired + `console` zero-cost DEV provider + **`textbee` real-delivery DEV provider (§33.10, owner-verified — env-only `TEXTBEE_API_KEY`/`TEXTBEE_DEVICE_ID`; NO sender name, the device is the endpoint)** + Twilio stub; 7th outbox worker; `phoneVerifyService`; channel router in `notificationService` for referral events only, gated `sms_notifications_enabled` + verified/opted-in phone; `/admin/sms` monitor; seeker opt-in card) — **production Semaphore DEFERRED (unfunded, account Pending; ≈₱2,800/5,000 credits); resume via `docs/sms-notification-proposal.md` §6a**; **Walk-In CLAIM** (mig 045; hashed claim code + expiry; public `/claim` links the EXISTING row, email-dup guard, optional phone-OTP 2nd factor; staff reissue; works SMS-disabled); **sidebar navigation refactor** (grouped by workflow, RBAC unchanged); **Identity-Verification-ID REMOVED** (code/UI only; columns dormant §0.7; referral letter never used it).

- **§33** Refinement pass + Landing carousel (2026-08-23, HEAD **`b828a4d`**, PUSHED, `npm test` **118**, mig **046 APPLIED**): **account SUSPENSION now enforced SERVER-SIDE** (mig 046) — `requireAuth` + login reject a Suspended account (403 `ACCOUNT_SUSPENDED`; `api.js` interceptor force-logs-out); suspend captures reason/end-date, notifies in-app+email+best-effort-SMS; `SuspendDialog` + Status/Sort filters in User Management. **Smart Referral Queue GROUPED BY VACANCY** (new `/peso-admin/proactive/candidates/grouped`, ranked within each job, paged by vacancy; flat endpoint retained). **Email/SMS Delivery pagination+search.** **Events skeleton.** **Collapsed-sidebar tooltip fix** (removed `overflow-hidden` clip). **TopHeader welcome ILLUSTRATION.** **Landing mascot → 5-slide Streamline Tokyo CAROUSEL** (local SVGs in `src/components/`, crossfade + dots + hover-pause + reduced-motion, no libs); **Chatbot icon REVERTED to `JobSeekerMascot`**; Streamline free assets used WITH a footer attribution credit.

- **§34** Landing Page **PESO Events & Job Fairs carousel** (2026-08-24, HEAD `082bfbd`, `npm test` **127**, NO migration): the public LandingPage now surfaces upcoming events in a **two-row horizontal-scrolling shelf** after the Local Employment Board (`#jobs`), reusing the SAME `GET /api/events` + `banner_image` as the seeker `Events.jsx` (identical poster). `eventRepository.listPublished` gained optional `{ scope:'upcoming', limit }` (banner ALWAYS included; bounded 1..50); the earlier banner-free `listPublishedLite`/`LITE_COLUMNS` was REMOVED. `LandingEventCard`/`LandingEventModal` are bespoke-palette landing components (LandingPage excluded from tokens, §24). No new migration/records/upload path. **⚠️ The two-row SHELF presentation was SUPERSEDED by the single-event carousel of §45 (2026-09); the data source + `LandingEventModal` are unchanged, but `LandingEventCard`/`EventsShelf` are gone.**
- **§35** Root-to-top **AUDIT** (`docs/system-audit-2026-08-24.md`, P0..Future matrix, **no P0 found**) + first improvement increment (2026-08-24): **F1** AI-score PROVENANCE (`aiClient.chatDetailed()` reports the ACTUAL serving provider+model after failover; `scoreApplication` stamps `{provider,model,promptVersion,scoredAt}` into the JSON-persisted score — NO migration, NOT in the prompt/signature so no spurious re-score); **F2** surfaced the AI `summary` rationale (board + admin drawer); **B1** sub-score colours track High/Med/Low; **D1** debounced the tab-focus refetch waterfall (20s `MIN_REFETCH_MS` on notif/chat/ATS visibility handlers — debounce NOT removal; interval+socket backstops kept); **F3** documented reproducibility (`docs/system-guide.md` §5). §35.5: **C1** reusable `src/hooks/useFocusTrap.js` (focus-trap+restore, WCAG 2.4.3; focuses SYNCHRONOUSLY — rAF pauses when the pane is hidden) on the event modals + **auth overlay + applicant drawer**; **D2 DECLINED** (LandingPage stays EAGER — documented App.jsx first-impression decision). **A2** documented the intentional worker-`io` asymmetry (only referral+scoring workers emit → take io).
- **§36** **G3 deep-dive** (2026-08-24/25, OWNER-VERIFIED end-to-end): **G3.1** declining an applicant (`rejectReferral`, Pipeline/AI-Recommended, single+bulk) now notifies the seeker (`APPLICATION_DECLINED`, best-effort post-commit, both routes forward io; internal reason NOT echoed) — plus the earlier void→seeker `REFERRAL_WITHDRAWN`; **G3.2** declining system-sets the app to **'Not Referred'** (twin of approve→'Referred', terminal, excluded from re-scoring; first-class stage in `STAGE_STYLE`/`ALT_STAGES`/`TERMINAL_STAGES`/`PESO_BASE` + ATS filter/tone + drawer tone); **G3.3** the 75(board)→30(pipeline) gap TRACED to the **cached board PREVIEW vs the committed score for different résumé states** (engine deterministic 90/90/90, single-sourced; seeker+admin already share `COALESCE(current_match_score,match_score)`) — reconciled by extracting the board cache to `services/matchScoreCache.js` (+`ttlCache.delByPrefix`) invalidated on every résumé change (builder save/upload/apply-overwrite) + a "Calculating…" chip in My Applications. **NO scoring logic changed.**
- **§37** Audit **E3** — read-only hot-path `EXPLAIN`/index pass (2026-08-25): every hot query is index-driven (`IndexRangeScan`/`Point_Get`), **zero full scans, no query-level N+1**; no missing index → no code change. Confirming AT SCALE stays Future.
- **§38** Audit **C2** — Events-carousel scroll affordance (2026-08-25): `EventsShelf` edge-fades (shown only on overflow; `pointer-events-none`/`aria-hidden`) + a thin horizontal scrollbar; NOT a carousel pattern (no arrows/dots/autoplay/snap). **ROOT-TO-TOP AUDIT COMPLETE** — all actionable non-Future items done; only the documented Future roadmap remains. **⚠️ The `EventsShelf` edge-fade affordance is GONE — the shelf was replaced by the single-event carousel of §45 (2026-09).**
- **§39** **DOLE PESO Accomplishment Report** (2026-08-25, new feature, NO migration, HEAD `70a1339`, `npm test` 148): the DOLE accomplishment-report FORMAT (period aggregate counts — registered/solicited/referred/placed — by **sex** + **educational attainment**, as **PDF** + sectioned **CSV**) the flat §7.11 referral-row report doesn't produce. RECONCILES with §7.11 (same cohort: `referral_queue.status='Approved'` by `reviewed_at`, placed = `outcome='Hired'` only, 0.14 — verified live: referred 48 / placed 7). `reportingRepository` (demographics COALESCE→'Not specified', derived-table GROUP BY to dodge TiDB `only_full_group_by`, no `JOIN userprofiles`) + `reportingService` (both placement denominators + `toCsv` BOM/`csvField`-guarded + `buildAccomplishmentExport`) + `reportPdfService` (pdfkit, page-break-aware, NOT the single-page letterhead). Endpoints: `GET /referrals/reports/accomplishment` (PESO admin, owner-scoped) + `GET /admin/reports/accomplishment` (Super admin, office-wide) — one builder. Shared `common/AccomplishmentReport` in `ReferralReports` + `PlatformReports`. **Phase B deferred** (capture DOB/age + stronger sex/education prompts; age not reported today).
- **§40** Certificate-scoring removal + requirement-only scoring rule + ProactiveWorker summary log (2026-08-25, NO migration, `npm test` **151**, eval-confirmed): (1) the **separate certificate SCORING path (Phase 2D-C / §18.6 C.3) was REMOVED** — certificate FILES are stored + admin-viewable EVIDENCE ONLY (Apply Wizard upload + Portfolio library UNCHANGED), but no longer feed the AI score and no longer arm a re-score (`getCertificateContext` + the worker `extraContext` feed + the apply-time cert re-score trigger all deleted; `computeScoringSignature({resume,job})`). The prompt's "certs are supporting evidence, NOT mandatory" rule STAYS (it governs certs mentioned INSIDE the résumé, still scored via `parsed_text`). (2) `buildScoringPrompt` gained the **symmetric "do NOT RAISE the score for unrequested résumé content"** rule (twin of the existing "don't lower for unstated") → the score reflects ONLY the employer's STATED Requirements & Qualifications; `SCORING_PROMPT_VERSION`→`req-strict-2026-08-25` (one-time hash re-baseline). Eval `requirement-strict` variant: MAE 6.4→7.9, band 100%, 0 FP/FN, off-tol 1 (neutral). (3) A "surface unrequested strengths in the `summary`" idea was TESTED + REJECTED (inflated scores in the eval; the Manager already sees the full résumé + `summary`, 0.4) — a separate non-scoring strengths field is a DEFERRED future option (owner: leave it). (4) `[ProactiveWorker]` now logs a per-RUN summary (`job N: X candidate(s) — Y scored, Z skipped (unchanged), W new`), not per-candidate.
- **§41** Centralized environment-aware storage + Cloudflare R2 for job images (2026-09, NO migration, `npm test` **158**, ship-dark): fixes the ONE genuinely disk-dependent upload path — **job featured images** (`multer.diskStorage`→`uploads/job-featured/`→`express.static`, in `pesoAdminRoutes`+`adminRoutes`) — that worked locally but VANISHED in prod (Render's ephemeral disk). New **`services/storageService.js`** — env-driven `STORAGE_DRIVER` = `local` (default → `uploads/`, returns `/uploads/<key>`) | `r2` (Cloudflare R2, S3-compatible via lazy-required `@aws-sdk/client-s3`, returns `${R2_PUBLIC_BASE_URL}/<key>`); `save`/`remove`(best-effort, never throws)/`getStatus`; creds EXCLUSIVELY from env (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL`), never to the frontend. Both handlers → `memoryStorage` + `storageService.save/remove`; **validation preserved** (8MB + JPG/PNG/WEBP). Frontend UNCHANGED (`resolveJobImage` already used full URLs verbatim). `server.js` boot-logs `[Storage] driver=…`. Discovery reconciliation: everything ELSE (avatars/résumés/event banners/certificates/referral letters) is already base64-in-DB and WORKS in prod → **owner decision: STAYS base64-in-DB** (migrating them is the proposal's deferred Phases 1–4). Blueprints `docs/cloud-storage-proposal.md` + `docs/cloudflare-r2-setup.md`.
- **§42** UI skeleton alignment + job-update worker-trigger precision (2026-09, `npm test` **163**, NO migration): (1) shared **`SkeletonCompactCard`/`SkeletonCompactCardGrid`** in `components/Skeleton.jsx` mirror the Saved Vacancies / My Applications compact card + 240px grid EXACTLY (no CLS); the media-band `SkeletonJobCard`/`SkeletonCardGrid` (Public Board / PESO Dashboard) are untouched — UI addendum §5.5. (2) **Worker-trigger precision** — `PUT /peso-admin/jobs/:id` now arms scoring/proactive/job-alert workers ONLY on a real scoring-field change: it snapshots the prior row and compares the `buildScoringPrompt` inputs (title/company/description/skills/qualifications/education/experience/gender); `applicationScoringService.enqueueForJob` fires only on `scoringChanged`, `jobAlerts`/`proactive` only on `nowPublished && (scoringChanged || becamePublished)`. A **media-only image edit** (`featured_image` → its OWN `POST /jobs/:id/image` endpoint, never in the PUT UPDATE) or non-scoring metadata (location/salary/deadline/positions/setup/category/department/accommodations) arms NOTHING. Enqueue-time twin of the §29 input-hash guard; identical for PESO Admin + Staff (`effectiveOwnerId`).
- **§43** Post-registration onboarding + account-completion gate (2026-09, `npm test` **168**, NO migration): a job seeker must complete **name, phone, location, gender, dob, educational_attainment** (identity for the referral letter + DOLE §39) AND have a **résumé on file** before **Apply** unlocks (résumé optional to finish onboarding, required to apply; owner decision, gate applies to EVERYONE at apply-time). State is DERIVED by `services/onboardingService.evaluate()` from the `users` columns + `uploaded_resumes.parsed_text` (no new column/flag → can't be bypassed by refresh/logout; both new AND walk-in accounts fall through the same gate). Enforced server-side: `POST /applications` → **403 `PROFILE_INCOMPLETE`** before any insert (fails OPEN on a DB error); status via `GET /profile/onboarding`. Frontend: `AuthContext.onboarding`/`openOnboarding` + `components/onboarding/OnboardingModal.jsx` (mounted once in `AppLayout`, auto-opens for incomplete seekers + force-opened by a gated Apply; reuses `PUT /profile` with a FULL prefilled payload so no field is wiped). Removed the empty Profile Activity + Response Tracker sections. Detail: dev-history §43.
- **§44** PESO Admin export audit + dashboard-CSV parity fix (2026-09, `npm test` **172**, NO migration): audited ALL four PESO Admin exports — ATS applicants (`/ats/applicants/export`, filter-aware full dataset), referral rows (`/referrals/reports/export`, date-range-aware), and DOLE accomplishment (`/referrals/reports/accomplishment`) were already COMPLETE (backend queries, owner-scoped, not paginated); only the **dashboard summary** (`/peso-admin/analytics/export`) was incomplete — it emitted 4 of 6 KPIs + 2 distributions from its OWN duplicated SQL, missing Registered Job Seekers, Active Local Employers, the 3 pending-action counts, and the monthly trend series, and ignored `?months=`. Fixed by extracting a shared **`computeOverview(adminId, windowMonths)`** that BOTH `/analytics/overview` (JSON) and `/analytics/export` (CSV) call → parity by construction; the export now carries every displayed metric for the SAME trend window (frontend passes `?months=<trendMonths>`). Detail: dev-history §44.
- **§45** Landing Events single-event carousel + PHP currency centralization (2026-09, NO migration, frontend-only): (1) the Landing **Events & Job Fairs** section was redesigned from the §34/§38 two-row shelf into a **premium single-event carousel** (`EventsCarousel` + `LandingEventSlide` replace `EventsShelf`/`LandingEventCard` in `LandingPage.jsx`) — one hero slide (uploaded `banner_image` as the focus), GPU `translateX` autoplay right→left, **dynamic dots** (one per published event) + hover-revealed prev/next arrows (§7 `.reveal-on-hover`, always shown on touch) + touch swipe + full carousel/slide ARIA; autoplay pauses on hover/focus, resets its timer on manual nav, and is disabled under `prefers-reduced-motion`; `single = count<=1` → static hero, 0 events → the existing empty state. SAME data source (`GET /api/events?scope=upcoming&limit=12`, banner included) + SAME `LandingEventModal` — a presentation refactor; reverses the earlier "no arrows/dots/autoplay" owner directive by a later owner request (do NOT restore the shelf). A small shared `usePrefersReducedMotion` hook was extracted (mirrors `HeroMascot`'s inline idiom). (2) **Currency: the system is already PHP** — salary is a FREE-TEXT `salary_range` field rendered verbatim (no numeric money formatting anywhere, no `$NNN` values, reports/letters/notifications/analytics carry no money). The only `$`-as-currency indicators were decorative `DollarSign` lucide icons → swapped to **`PhilippinePeso`** (`PesoAdminDashboard` salary input, `LandingPage` job-detail salary; the unused import in `PublicJobBoard` removed); the salary placeholder now shows `₱`. New **`src/utils/currency.js`** (`formatPHP` via `Intl.NumberFormat('en-PH', PHP)` + `PESO='₱'`) is the centralized formatter for any FUTURE numeric money — it has NO caller today (salary is free text; do NOT ₱-prefix `salary_range` with it). `npm run build` clean; carousel verified functionally in-browser (autoplay/dots/arrows/wrap/hover-pause/ARIA) via a client-side mock (prod had 0 upcoming events; no test data written to prod). **§45.4 (follow-up): banner/poster QUALITY + Landing-stat "+" removal.** The blur was NOT R2 (event banners are base64-in-DB, §41) — it was destructive upload processing: `PesoEventManager` hard-downscaled every poster to 1000px/JPEG-q0.82. Fixed → `fileToBannerDataUrl` keeps the original VERBATIM when ≤2000px & under the store cap (lossless; crisp PNG text posters preserved), else downscales (never up) to 2000px/q0.92 with a white matte; backend `eventRoutes.MAX_BANNER_CHARS` 2.6M→3.0M (client mirrors it — keep in lockstep). Carousel CSS: poster now **`object-contain`** over a **blurred self-backdrop** (no crop/distortion, any aspect ratio), taller frame (24/30/34rem), poster hover-`scale` removed (raster interpolation = blur); modal img → `object-contain max-h-[60vh]`. EXISTING banners stay degraded until re-uploaded (loss is permanent). True retina/responsive `srcset` needs event banners on R2 (deferred §41 phase — flagged, NOT done, reverses the base64 decision). Landing stats: `CountUp` `suffix` default `'+'`→`''` (its ONE caller is the stats tiles) so the four hero figures show the EXACT recorded value; NO query/analytics change (still bound to `/job-board/stats`). **§45.5 (follow-up): TRUE infinite loop + R2-ready banner URLs.** The seam rewind was fixed by a **clone-based** loop (track `[cloneLast, ...events, cloneFirst]`, `pos` from 1; landing on a clone triggers a transition-OFF JUMP to its real twin → last→first/first→last continue in-direction, no rewind). Jump is **`setTimeout`-driven not `transitionend`** (re-render retargets transform → event never fires → `pos` runaway) and transition re-enable is **`setTimeout` not rAF** (rAF paint-gated → stuck in a hidden tab). Autoplay+manual share `step`; dots/ARIA read `realIndex`; 1/2/0-event edges handled. Banners now go through `resolveBannerSrc` (pass-through `data:`/`http(s)` R2 URLs, else `FILE_BASE`) — but the event carousel never used `/uploads`: banners are base64 `data:` URIs (§41), only *job* `featured_image` uses R2. Verified in-browser (both seams, dot jump, continuation). **§45.6 (owner-approved): event banners base64→R2 migration DONE + verified (owner-ran locally with Render's R2 creds — free-tier Render has no shell; the local checkout already targets prod TiDB).** Audit: 3 events, all base64 (no /uploads). New shared `services/eventBannerStorage.js` (`persistBannerRef` + content-addressed `event-banners/<sha16>.<ext>` keys); `eventRoutes` POST/PUT upload new banners to R2 in prod (base64 in dev); migration **048** adds `peso_events.banner_image_legacy` (rollback archive); `scripts/migrate-event-banners-to-r2.js` (`npm run migrate:event-banners`, idempotent/dry-run/rollback, refuses non-r2 driver) migrates the 3 existing banners archiving base64 first; `resolveBannerSrc` centralized into `jobs/jobImage.js` + applied at every render site (Landing, Events, PesoEventManager). Verified: build clean, `--dry-run` vs prod found+decoded all 3. Owner run-book in dev-history §45.6. **DONE: owner ran it (locally, Render's R2 creds in the PS session); all 3 banners now serve `https://pub-6ddbb…r2.dev/event-banners/<sha16>.<ext>` (HTTP 200, carousel `posterIsR2=true`). LESSON: `R2_PUBLIC_BASE_URL` MUST be the bucket's PUBLIC ORIGIN (r2.dev URL/custom domain), NOT the bucket name — a first run stored `<bucket>/<key>` (broken); the script now GUARDS this (aborts unless the base is `http(s)://`) and its `--rollback` matches any non-`data:` value. R2 secret was pasted in chat → owner rotating the token.**
- **§46** Landing content-integrity cleanup (2026-09, NO migration, `LandingPage.jsx` + one dead backend route): (1) **removed the "Voices from the Community — Built for Kabankalan's Workforce" testimonials** section + hardcoded `TESTIMONIALS` (placeholder personas, not real/consented feedback, no data backing — an unsupported claim) + the now-unused `Quote`/`Star` imports. (2) **consolidated "Common Questions" (FAQ) + "Visit Us In Person — Our Office" into ONE `#faq` section** — the four FAQs UNCHANGED; office info/Get Directions/Message Us/map-preview moved into the right column with `id="location"` on it so BOTH nav anchors still resolve; the standalone Visit Us section deleted. (3) **removed the redundant "Contact Us — Connect with PESO Administrators" form** (inputs/handlers/`contactForm`+`sendingContact` state/the `POST /job-board/contact` call) AND its now-dead backend route in `jobBoardRoutes.js` (nothing else called it; **nothing reads `contact_inquiries`**) + the orphaned `emailOutboxService` require — the office **"Message Us"** (Facebook) is now the SINGLE landing contact channel. The dormant `contact_inquiries` table is LEFT in place (frozen schema, §0.7). (4) **repositioned the "Your next opportunity…" green CTA INTO the FAQ column** (below the accordion, not a separate closer band) to fill the gap beside the taller office-card+map column: the left column is `flex flex-col` and the CTA is `flex-1`, so under grid `align-items:stretch` the columns **bottom-align** (verified 897px=897px at lg); mobile stacks it below the FAQ at natural height; buttons unchanged. Preserved all auth/messaging/FAQ/office/other sections. Verified in the live DOM (testimonials gone, contact form gone, `#location` nested in `#faq`, exactly 4 FAQs, one "Message Us", CTA in the FAQ column bottom-aligned, no console errors).
- **§47** Dashboard UX — top-header hover dropdowns + welcome-greeting relocation (2026-09, NO migration, frontend-only): (1) the **TopHeader avatar menu AND the NotificationBell now open on HOVER as well as click** — capability-gated (`matchMedia('(hover: hover) and (pointer: fine)')`, so touch keeps tap/click), `onMouseEnter`/`onMouseLeave` on the `relative` wrapper (button+panel) with a ~180ms leave-close timer, existing `slide-in-from-top-2` slide-down kept; click/outside-click/Escape/all contents/handlers/auth/notification logic UNCHANGED (relaxes the old "bell click, never hover" rule §7.7/addendum §10.1 by owner request). (2) the persistent **"Welcome back" chip was REMOVED from TopHeader** (header is controls-only now) and **relocated to `components/dashboard/DashboardGreeting.jsx`**, a temporary session greeting ABOVE the `Dashboard Overview` `<h1>`: personalized "Hello, {firstName}! 👋" + illustration, shown **once per session per user** (`sessionStorage` `pk_dash_greeted:<userId>` — no reappear on in-dashboard nav; fresh login greets again), **auto fade-out** ~7.5s (`transition-opacity`, reduced-motion→instant), name from the authed `user` (any role); illustration is `src/assets/illustrations/welcome-hero.png` (owner-added 1254×1254). Hover-intent timing: **open 110ms / close 320ms** (single `hoverTimer` per menu; retuned from the initial instant-open/180ms after owner feedback). Build clean; header/greeting are behind `AppLayout` (authed) so runtime behaviour is owner-verified (no test creds this session).
- **§49** Data-processing module refactor — Import Past Applications + Analyze My Resume (2026-09, HEAD `f426e74`, mig **049 APPLIED**, new dep `mammoth`, `npm test` **172**): Phases A–D. **A** shared `components/dataflow/ProcessingModal` (backdrop-close GUARDED while busy, focus-trap, `inert`) + `StepProgress`. **B** deterministic (no-AI) Import pipeline — mig 049 `import_batches` (idempotency/rate-limit/history), `services/importService.js` (CSV/XLSX parse → column-synonym resolve → **local-tz-safe date coerce, NEVER `toISOString`** → validate → dedupe within-file + vs `usertrackedjobs` → limits 2MB/500/5-per-day/1000 → idempotent transactional commit), routes `POST /profile/import/preview` + `/import/commit`, `ImportPastApplicationsModal`; REPLACED the old `/tracker/upload` (AI-validate + **destructive `DELETE all tracked jobs`**). **C** hardened Analyze My Resume — `services/resumeText.js` (ONE path: PDF via `pdfTextService` §12, DOCX via `mammoth` — DOCX never worked before), `/profile/upload` persists parsed text to `uploaded_resumes` (feeds AI scoring §7.4; binary never stored), `AnalyzeResumeModal`. **D** shared `services/resumeAnalyzer.js` (route + harness share ONE analyzer) + `scripts/eval-resume-analysis.js` (`npm run eval:resume`, résumé-corpus harness, no DB). **§49.5 integration invariant VERIFIED:** imported records write `usertrackedjobs` and surface via `GET /api/applications/unified` — the SAME store/schema/status model/read feed as manual tracked jobs and both the Dashboard "All Your Applications" and the "My Applications" page; validation/dedupe/limits run BEFORE persistence, `import_batches` is a counts-only audit ledger (not an application store), commit is append-only (existing rows untouched), edits stay on the unchanged `/tracked-jobs` routes. Detail: dev-history §49.
- **§50** Public Visitor-Support Chatbot on the Landing Page (2026-09, NO migration, `npm test` **192**): a dedicated PUBLIC assistant for anonymous visitors, SEPARATE from the authed Job-Seeker chatbot (`routes/chatbotRoutes.js`, UNTOUCHED). **A** `aiClient.chatRaw()` (full assistant message incl. `tool_calls`, via a refactored shared `runCompletion`; `chat`/`chatDetailed` unchanged) + `translateResponse`→`services/aiTranslate.js` (both bots share it). **B** `POST /api/public-assistant/query` (NO auth) — `services/publicAssistant/knowledge.js` (PURE: public system prompt, tool schema, caps, `sanitizeMessages`, `deriveActions`, `FALLBACK_REPLY`) + `publicData.js` (read-only PUBLIC data + one allowlisted `runTool` — vacancies/categories/stats/events/office, no per-user table, no free SQL); per-IP burst 20/15m + daily 60/day, bounded ≤3-round tool loop, **no `chathistory`/no anonymous persistence**, graceful non-fabricated fallback. **Nav is derived server-side (`deriveActions`), NOT a model tool** (the model kept choosing nav over answering) — allowlisted to landing anchors, capped at 2. **C** `components/PublicChatbot.jsx` in `LandingPage.jsx` — floating launcher + responsive panel + 8 quick actions + typing/auto-scroll/reset/a11y (focus trap, `role=dialog`, Escape, `aria-live`), landing palette (not app tokens), self-contained reduced-motion bubble keyframe; `actions` → the page's own `scrollTo`/`setAuthMode`. **D** hardening (raw-array bound in `sanitizeMessages`, `language` clamp). Detail: dev-history §50.
- **§51** Event edit — atomic banner Replace + `event_date` re-save fix (2026-09, `edd693f`, NO migration, `npm test` **192**): a banner edit could make a still-published event VANISH from the Landing carousel — the cause was the edit form re-sending `event_date` as a full UTC datetime (`…T00:00:00.000Z`, DB pool `timezone:'Z'`) into the DATE column on EVERY save, risking a shift out of the upcoming filter (`event_date >= CURDATE()`); NOT the banner (backend never deletes/unpublishes on a banner edit; the slide renders a gradient for a null banner). Fixed by normalizing `event_date`→YYYY-MM-DD both server-side (`eventRoutes.cleanEventInput`) and client-side (`PesoEventManager.save`). Also added a proper **"Change"** (atomic replace) beside "Remove" in the Edit modal — validates the new image and swaps ONLY on success (keeps the current banner on a bad/oversized/cancelled pick); transaction-safe (R2 upload before the single UPDATE; old value/asset retained on failure). PESO Admin + Staff share the one path. Detail: dev-history §51.
- **§52** Chatbot UI unification (2026-09, `accc431`+`c81c89c`, frontend-only, `npm test` **192**): the public Landing assistant + the authenticated PESO Assistant now share a common frontend layer in **`components/chat/`** — `ChatLauncher` (shared pill: mascot + "Ask PESO Assistant" + Chat chip), `chatMotion` (one open/close transition + `.chat-msg-in` keyframe in `index.css` — the app has NO tailwindcss-animate, so `animate-in …` was a no-op), `MessageBubble`, `TypingIndicator` — palette-parameterized by `variant` (`app` tokens vs `landing` greens). Public launcher is now the shared pill (was a circular FAB); the authed bot's no-op message animation is fixed. Kept SEPARATE at the context level (routes/prompts/tools/permissions §50 — never merge); the backend AI layer (`aiClient` + `aiTranslate`) was already shared. Composer + QuickActions stay per-context (auth language menu/interaction chips vs public nav-actions/quick-actions). Detail: dev-history §52.
- **§53** Landing Page Light/Dark toggle + bespoke dark palette (2026-09, `750ac07`, frontend-only, `npm test` **192**): a `components/common/ThemeToggle` in the Landing header (desktop + mobile) reuses the EXISTING `ThemeContext` (state, `localStorage['theme']` persistence, `.dark`-on-`<html>`, View-Transitions toggle animation; `ThemeProvider` already wraps the Landing in `main.jsx`) → theme SYNCED Landing↔app, NO duplicate logic. **SUPERSEDES the §24/§45 "Landing is always-light" stance:** added a curated bespoke DARK palette via `dark:` hex variants (NOT app tokens — the §24 token-exclusion STILL HOLDS; do NOT tokenize the Landing) across every surface (root `#0b1220`, cards `#111b2e`, tints/borders/text, dimmed hero photo, `.dark .glass-card`) + the public chatbot's landing variants/panel. Light mode unchanged; full-page scan = 0 light surfaces in dark. Detail: dev-history §53. (See the §53 still-live rule below.)
- **§54** UI/UX optimization pass (2026-09, `ccbfc5e`, NO migration, `npm test` **192**): (A) the Landing **Events & Job Fairs** section rendered BLANK-but-clickable — root cause was the scroll-reveal `.reveal` stuck at `opacity:0` because the `LandingPage.jsx` IntersectionObserver effect's deps omitted `events`, so the late-mounting `EventsCarousel` (mounts only after the async fetch resolves) was never `observe()`d when `events` won the load race vs `jobs`; fixed by adding `events`/`loadingEvents` to the deps. (B) `LandingEventSlide` banner `<img> onError` → gradient fallback (a broken/404/invalid banner never blanks a card). (C) the Landing now shows **ALL** published events, upcoming-first→undated→past via `eventRepository.listPublished` 'all' scope (a LIMIT no longer buries the next event); relabeled "Upcoming PESO Events"→"PESO Events & Job Fairs"; `scope='upcoming'` UNCHANGED (chatbot `get_upcoming_events`). (D) authed `Chatbot.jsx` render parity with the public bot — dropped the full-page + ~7 stacked `backdrop-blur` passes, `3xl→md` + `transform-gpu`, direct `scrollTop`, real `.chat-msg-in`. (E) TopHeader Profile role-aware — PESO Admin → `/peso-admin/profile` "Organization Profile" (was applicant-only `/profile`). Detail: dev-history §54. (See the §54 still-live rule below.)
- **§55** Job Seeker vacancy-detail side panel — hierarchy/scanability redesign (2026-09, `650abfc`, frontend-only, build clean): the Public Job Board posted-vacancy slide-over (`PublicJobBoard.jsx` `selectedJob`, opened by double-clicking a `JobCard`) was restructured for scanability — a new **key-facts strip** (Salary emphasized, Employment+setup, Location, Positions open, Deadline) via a module-level **`DetailFact`** cell leads directly under the title (replacing the buried sidebar "Application Details" card, now REMOVED, + the old header chips); a status pill (Now Hiring/Vacancies Filled) + **posting age** (`postedLabel(created_at)`, available since the detail route is `SELECT pj.*`) + department in a context row; consistent iconized section headings + tighter rhythm (`space-y-6`, `p-5/6/8`, `rounded-2xl`). **Layout only** — the double-click open flow, deep-fetch pipeline, AI Compatibility card, apply/save/inquire handlers, similar-jobs, and filled logic are untouched. Detail: dev-history §55. (See the §55 still-live rule below.)
- **§56** System audit — abuse-protection + AI-cost rate limits + legal/privacy accuracy (2026-09, `4ffb377`, `npm test` 192): verify-before-change pass. Added **`middleware/rateLimiters.js`** (shared, env-tunable `RL_*` factory) — an app-wide `/api` **`globalLimiter`** backstop (300/min/IP, health+OPTIONS exempt) in `server.js`, plus tight **`aiLimiter`** (`/jobs/match`, `/profile/{upload,insights/generate,match}`), **`applyLimiter`** (`/applications`), **`writeLimiter`** (`/profile/avatar`, `/messages/conversations`) on the previously-unprotected cost endpoints; app-wide **`helmet`** (CSP OFF — serves JSON+/uploads, not app HTML; `crossOriginResourcePolicy: cross-origin` REQUIRED for `/uploads`); a 60s frontend axios `timeout`; and Privacy Policy accuracy (removed the false "government ID documents" claim §48, disclosed real subprocessors + cookie notice — needs DPO sign-off). Existing controls (AI timeout/breaker, bounded outbox workers, auth/builder limiters) verified + UNCHANGED. Deferred (owner/legal): body-size limit, standalone `/privacy` routes, NPC registration/retention, WCAG re-audit, secret rotation. Detail: dev-history §56 + `docs/system-audit-2026-09.md`. (See the §56 still-live rule below.)
- **§57** Standalone legal pages + SPA deep-link fix (2026-09, `fa5d2f6`, frontend-only): the Landing Privacy/Terms modals are now ALSO real routed pages at **`/privacy` · `/terms` · `/cookies`** (public, dark-aware) via `components/legal/LegalPage.jsx`, both backed by the shared **`components/legal/legalContent.jsx`** (ONE source — modals + pages render `<LegalSections>`, can't drift) + a new Cookie Policy. Added **`job-tracker-frontend/vercel.json`** SPA rewrite (`/(.*)`→`/index.html`) — **fixed a latent prod bug: deep routes (`/reset-password` from reset emails, `/job-board`, …) 404'd on a hard hit/refresh with no fallback; now 200.** Detail: dev-history §57. (See the §57 still-live rule below.)
- **§58** Remaining audit items — socket throttle, body-size, secret removal, panel a11y (2026-09, `64da8e6`, `npm test` 192): per-socket `send_message` throttle + content cap + empty/malformed guard (`socketServer.js`); removed the hardcoded `GOOGLE_CLIENT_SECRET` (`authRoutes.js`) + socket `'fallback_secret_key'` (`socketServer.js`) fallbacks — env-only now; `express.json`/`urlencoded` `50mb`→**`15mb`** (`BODY_LIMIT`); vacancy-detail panel got `role="dialog"`/`aria-modal`/Escape-to-close. Operational remainder (NPC registration, retention period, DPO sign-off, **actual secret rotation** in the consoles) → **`docs/compliance-and-security-runbook.md`**. Detail: dev-history §58. (See the §58 still-live rule below.)
- **§59** Automation n8n → Make.com migration — proposal + Option 2 (2026-09, `bed7af8`/`e24d55a`): n8n is ONE downstream webhook (referral `dispatch_n8n` → Sheet + employer notify); backend safeguards already exist. Proposal `docs/automation-and-backend-architecture-proposal.md` + build guide `docs/make-com-migration-guide.md`. Option 2 SHIPPED: the dispatch reads provider-neutral **`AUTOMATION_WEBHOOK_URL`** (fallback `N8N_WEBHOOK_URL`); UI relabeled n8n→Make.com; internal `dispatch_n8n`/`N8N_DISPATCHED` identifiers KEPT. (See the §59 still-live rule below.)
- **§60** Coordinated refinement pass — Motion system, Events skeleton, Messages Hub controls, seeker referral automation, org logo (2026-09, `efa9f2b` backend + `b5a644e` frontend, **migration 050**, `npm test` **206**): **(A)** shared Motion (`framer-motion`, previously bundled-but-unused) config `job-tracker-frontend/src/config/motion.js` — one expo-out easing + variants aligned to `chatMotion`, reduced-motion aware. **(B)** Events detail modal shows a **skeleton** (no white flash) + `AnimatePresence` enter/exit (`Events.jsx`); admin event modal on the same motion (`PesoEventManager.jsx`). **(C)** Seeker **referral automation** — `referral_preferences (mode: manual|auto_accept|auto_decline, default manual)`; enforced in `referralService.approveReferral` AFTER the endorsement commits (reuses `acceptReferral`/`declineReferral`, FAIL-SAFE to manual); owner-scoped GET/PUT `/profile/referral-preference`; Account Settings "Referrals" tab (seeker-only, confirm-before-enabling). **(D)** `Referrals.jsx` loading skeleton (parity). **(E)** Messages Hub: sidebar "Communications"→**"Messages"**; `conversation_states (mute/pin/manual-unread)` + mute/pin/batch-read-unread endpoints (`messageRoutes.js`); **5-pin cap enforced server-side in a transaction**; muted excluded from unread count; roster pinned-first with per-viewer unread; multi-select bulk bar + per-row/active-chat kebab menus (`Messages.jsx`). **(F)** `Avatar.jsx` renders the **official PESO logo** for the org account (`isOrgAccount`, role-based) across header/messages/profile/referral views — seeker avatars untouched; `peerOf` carries `role`. Detail: dev-history §60. (See the §60 still-live rule below.)
- **§61** Employer email · Messages 429 fix · Landing events motion · analytics tooltip (2026-09, `83a3b86`/`2f359b7`/`4f347fe`/`0cce505`, **migration 051**, `npm test` **210**): **(1)** **Messages 429 loop FIXED** — the §60 `fetchConversations` `setActiveConv(new ref)` re-ran the history effect (keyed on the whole `activeConv` object) → `triggerBadgeRefresh` → `messageUpdateTrigger++` → `fetchConversations` → loop → 429 on `/unread`+`/conversations`+`/:id`. Fix: key the history effect on **`activeConv?.id`**, add an `AbortController` (cancel on switch/unmount), `patchConv` also updates the open convo (safe under id-keying), debounce the socket-driven roster refresh. Backend limiter unchanged. **(2)** **Employer email** — `pesoadmin_job_posts.company_email` (migration 051, nullable + zero-crash boot ALTER); Job Publication Manager form input, `validateCompanyEmail` **required-on-Published** (optional for Draft) on POST/PUT `/peso-admin/jobs`; `referralRepository.findReferralForDispatch` now sources `employer_email` from `pj.company_email` (+ `employer_name` from `pj.company`) — the automation payload targets the EMPLOYER, not the admin. **(3)** **Make.com cutover finalized** — worker log/activity wording n8n→"automation (Make.com)" (persisted `dispatch_n8n`/`N8N_DISPATCHED*` KEPT §59); blueprint updated: recipient `{{1.employer.email}}`, data-store `reviewedAt` `""`→`{{1.reviewedAt}}`. **(4)** Landing `LandingEventModal` gets §60 Motion + skeleton parity. **(5)** `PipelineAnalyticsChart` custom tooltip shows only non-zero statuses + Total. Detail: dev-history §61. (See the §61 still-live rule below.)
- **§62** AI Compatibility synchronized score reveal (2026-09, `6872108`, frontend-only, NO migration): the vacancy panel's AI Compatibility score no longer snaps in as static text. New module-scope **`AnimatedScore`** (`PublicJobBoard.jsx`) drives BOTH the numeric score AND the progress-bar width off ONE rAF value (`displayed`), counting up 0 → real score over a consistent **~1.4s ease-out** (`SCORE_ANIM_MS`/`easeOutCubic`). MOUNT-triggered: `handleOpenDetails` resets `aiScores=null` on every open/reopen and the component only renders once the VERIFIED score arrives, so it re-reveals per new result/reopen but NOT on unrelated re-renders; no fabricated intermediate score. Bar's CSS `transition` REMOVED (rAF drives it, a transition would desync from the number). Clean at 0%/partial/100%/non-numeric ("—") + `prefers-reduced-motion` (jumps to final). Scoring/thresholds/DeepSeek/referral/backend unchanged. Detail: dev-history §62. (See the §62 still-live rule below.)
- **§63** Analytics tooltip motion · shared scroll-reveal · Landing discovery panel (2026-09, `53b3c53`/`73c2cae`/`ae4f07f`/`eb67857`/`4e4e362`, frontend-only, NO migration, `npm test` 210): **(1)** all FOUR recharts tooltips (`PipelineAnalyticsChart` + `PesoAdminOverview` trend/pie/bar) stop **sliding in from the chart's left edge** — `isAnimationActive={false}` drops them at their overflow-safe position, and a shared `.chart-tooltip-in` keyframe fades them in with the app's dropdown motion (opacity + 6px translateY, 200ms ease-out = `dropdownMotion` `DROPDOWN_PANEL`); each custom tooltip root is **keyed by the active data point** so it re-fires per point and stays stable on continuous hover. **(2)** New **`components/common/Reveal.jsx`** — the ONE scroll-reveal for every posted-job card (Public Board grid + `JobCategorySections` rows, Admin manager grid, Landing panel): one `IntersectionObserver` PER root (viewport singleton + a `WeakMap` of container observers), **repeatable with hysteresis** (toggles `.reveal-in` on enter/exit, reveal ≥15% visible / reset only when fully out, `threshold:[0,0.15]` dead-band kills jitter), pure `classList` (no React state / no remount), reduced-motion aware; CSS contract `.reveal-item`/`.reveal-in` in `index.css`. Takes a **`root` ref** (viewport by default for the page-scrolled Board/Admin grids; a container for the Landing). **(3)** Landing posted-jobs redesigned into a **self-contained scroll PANEL** (`max-h-[min(720px,72vh)]` `overflow-y-auto` `custom-scrollbar`, own scrollbar) so publishing more vacancies never lengthens the page — a responsive `auto-fill` grid (no horizontal overflow) whose cards reveal against the PANEL (`Reveal root={panelRef}`); driven by **`useJobFilters`** (shared category taxonomy + hero search/location bound to `jf.state`/`jf.set`); a bespoke-palette **`LandingCategorySelector`** (reuses `CategoryChips` row logic) filters in place; a **`LandingJobModal`** (shared §60 Motion + backdrop, renders from the job object) opens on card click, "Apply Now"→login. Detail: dev-history §63. (See the §63 still-live rule below.)
- **§64** Landing job search relocated into the board section as a contextual search module (2026-09, `001cc07`, frontend-only, NO migration): the Landing search moved out of the HERO (now two CTAs — Explore Local Jobs → `#jobs`, Events & Job Fairs → `#events`) into a new **`LandingJobSearch`** module at the TOP of the "Local Employment Board" section — keyword + location inputs (leading icon, per-field clear `×`, `sr-only` labels, focus ring) + a Clear-all reset, `role="search"`, bound to `jf.state`/`jf.set` (the SAME `useJobFilters` — no second matcher). Section flow is now **Search → category Controls → Results Count/State → Matching Results**, with an `aria-live` count ("N vacancies available" / "Showing K of N vacancies for '…'") + a loading state + a "Clear filters" empty-state action; results update live in the §63 panel (no navigation). `LandingCategorySelector` gained an optional `className`. Detail: dev-history §64. (SUPERSEDED by §65 — the Landing search was REMOVED.)
- **§65** Landing search REMOVED + full-width category navigation (2026-09, frontend-only, NO migration): an IA reversal of §64 (owner request). `LandingJobSearch` (the §64 keyword/location module) + its unused `Search` import are DELETED — the Landing no longer keyword-searches; full keyword/location/sort/advanced discovery is the **Public Job Board's** job (reached via the header "View All Jobs →" CTA). `LandingCategorySelector` changed from a left-concentrated horizontal scroller (`overflow-x-auto` + `grid grid-flow-col auto-cols-max w-max`) to a full-width **`flex flex-wrap items-center gap-2.5`** row that spans the `max-w-7xl` container and wraps on narrow screens (fixes the "concentrated left / empty right" complaint without stretching chips; dropped `keepInView`/`scrollIntoView`). Same shared `useJobFilters` taxonomy, same chips/badges/a11y, same Landing bespoke palette (§24/§53), `className` prop kept. Section flow now **Board → Category Nav → Results Count → Filtered Jobs → View All Jobs**; the `aria-live` count reads category context ("…in <Category>", the dead search span removed); empty-state copy → "No jobs in this category yet" + "Show all jobs" (`jf.reset`). §63 scroll panel + `Reveal` UNCHANGED. Detail: dev-history §65. (See the §65 still-live rule below — it REPLACES §64's.)
- **§66** Centralized quota & usage-indicator system (2026-09, `npm test` **218**, NO migration): a cross-cutting "make invisible limits visible" system. **`config/quotas.js`** is the SINGLE source for every limit — each resource `{ key, scope, category, type, max, warnRatio, enforced, … }` + flat `LIMITS` + `evaluateState`; FOUR axes never conflated (`count`/`bytes`/`rate`/`processing`). Owner decisions: **informational-only** for resources uncapped today (`max:null`+`enforced:false` ⇒ state `unlimited`, never blocked — invariant 0.1) and a **soft-warn storage meter** (`bytes`+soft, warns, never blocks an upload). Only pre-existing caps carry `enforced:true`/can reach `blocked` (imports/day 5, 1000 tracked, cert library 30, pins 5, upload sizes). **`services/usageService.js`** attaches live usage: Trash-aware (`deleted_at IS NULL`, matches importService's `MAX_TOTAL_TRACKED`), imports mirror the ROLLING 24h window, storage = base64 footprint (avatar + certs + résumé snapshots, counts trashed, kept separate from record counts), every sub-query degrades to 0 (never 500s a page, 0.1), no `userprofiles` join. Endpoints `GET /api/usage` (seeker, `req.userId`) + `GET /api/peso-admin/usage` (owner-scoped `req.effectiveOwnerId`, Manager-only). Frontend `hooks/useUsage` + `components/common/UsageMeter` (used/max + state-coloured bar + "N remaining"/"Limit reached"/"No limit"/"Max X MB", `compact` variant) + `UsagePanel` (grouped by Records/Storage/Requests/Uploads); mounted on the seeker **Account Settings → "Usage & Limits" tab**, the **PESO Admin Overview "Office Usage & Limits" card**, and inline (via a shared **`components/common/InlineUsageMeter`** wrapper — hook + compact card, `refreshKey` re-pulls on mutation) in the **Import modal** + **Certificate Library** (`certificate_library` 30-cap) + **My Applications** (`peso_applications` + `tracked_applications` 1000-cap). (Saved Vacancies briefly had one too — REMOVED in §67 by owner request; `saved_vacancies` still shows in the comprehensive Usage & Limits tab.) Enforcement (`importService`/`certificatesRepository`/`messageRoutes`) now SOURCES its numbers from the catalogue (behaviour-preserving). `test/quotas.test.js` (8 guards). Detail: dev-history §66. (See the §66 still-live rule below.)
- **§67** Three UI refinements (2026-09, frontend-only, NO migration, build clean): (1) the **Saved Vacancies inline usage meter was REMOVED** (only there — `SavedJobs.jsx` reverted to no `InlineUsageMeter`; all save/filter/sort/pin/trash functionality intact; Certificate Library + My Applications + the Import modal KEEP their meters). (2) the **My Referrals skeleton was rebuilt** (`Referrals.jsx`) to structurally mirror the loaded module: a **toolbar skeleton** renders during `hydrating` (the real toolbar is gated on `!hydrating` because its view toggle would flash the wrong active state, so it used to pop in + shift the body), and the body skeleton is **VIEW-AWARE** (cached `view` is synchronous) — LIST echoes the column headers + rows matching `ReferralRow`'s `grid-cols-[minmax(0,1fr)_150px_140px_110px_auto]` (icon `w-9 h-9 rounded-lg`, title/subtitle, reference, status pill, date, actions; stacked mobile meta+actions); GRID renders `ReferralTile`-matching cards (`p-4 rounded-2xl border`, `w-10 h-10 rounded-xl`, 2-line title, pills, `mt-auto pt-3 border-t` footer) in the same `auto-fill/minmax(240px)` grid; inside the same `bg-raised rounded-3xl border` container, `aria-hidden` + `animate-pulse` + tokens + reduced-motion-safe. Kills the loading→loaded shift + the list-only mismatch (§60.4). (3) the **TopHeader avatar dropdown is positioned + sized RELATIVE TO THE PROFILE TRIGGER CONTAINER** (`layout/TopHeader.jsx`): fixed `w-56` → `absolute right-0 mt-2 min-w-full w-max max-w-[min(20rem,calc(100vw-1.5rem))]`. The panel is `absolute` inside the `relative` profile wrapper (sized by the trigger button: avatar + name-span capped `max-w-[140px]` + chevron), so `right-0` aligns to the trigger and **`min-w-full` makes it ≥ the trigger width** (reads as attached; width tracks the container, not the name); `w-max` only guarantees the menu labels fit; `max-w` clamps to the viewport. Header **name + email both `w-0 min-w-full`** → contribute 0 to intrinsic width but fill + `truncate` to the container-driven width, so short OR long names never look disproportionate/detached. **(Owner revised the basis twice: fixed → Full-Name-driven → container-relative; the container is the final basis.)** Design/motion/hover-click-Escape + menu items unchanged; ≥768px only (`hidden md:flex`). Detail: dev-history §67. (Refines the §47 dropdown rule below.)
- **§68** Account Settings persistence audit + Full-Name fix + Google OAuth account linking (2026-09, **migrations 052 + 053**, `npm test` **227**): audited all 5 seeker settings sections (read→edit→validate→save→persist→reload→display). **(1) Full-Name persistence bug FIXED** — `AccountSettings.jsx` Profile-Info was a fake `setTimeout` success + an uncontrolled `defaultValue` input (edits never read, no API call). Now a controlled `fullName` seeded from `GET /profile`, a **full-payload `PUT /profile`** (only `name` is `COALESCE`d; others set directly → send the whole loaded profile so nothing is nulled, §43; `dob`→`YYYY-MM-DD`), **success only after the 2xx**, `updateUser({name})` propagation to the top-header + every `<Avatar>`. **(2) Security** — added server-side password **min-length 8** (was frontend-only). **(3) Linked Accounts rebuilt** into a real backend-authoritative Google **link/unlink** flow (`users.oauth_provider` mig 052 = honest Connected state + backfill passwordless→'google'; `google_sub`/`google_email` + `UNIQUE INDEX` mig 053 = duplicate protection): `GET /auth/google/link/start` (authed XHR → signed 10-min `{uid,purpose:'link'}` state → Google consent URL, `select_account`, `access_type=online`) → the SAME `/auth/google/callback` (link vs login distinguished by JWT-shaped state) → `settings?link=google&status=success|duplicate|cancelled|error`; **secure token handling** = verify `id_token`, read sub/email, discard (no Google tokens stored); `POST /auth/google/unlink` **SAFE** (refuses `NO_PASSWORD` → Security tab, never DELETEs the account); login now matches **`google_sub` first**, then email (a linked account with a different Google email signs into the right account, no duplicate); an EXPIRED link ticket fails to `error`, never silent-logs-in. Frontend: Connect/Disconnect UI (loading/success/cancel/error, inline confirm), `AuthContext.refreshUser()` re-pulls `/auth/me` so **Connected is derived from the backend, never a local flip**. `test/oauthProvider.test.js` (9 guards). **Owner runs `npm run migrate` (052+053).** Detail: dev-history §68. (See the §68 still-live rule below.)
- **§48** Identity & Profile structural skeleton + AI Chatbot knowledge alignment (2026-09, NO migration, frontend + chatbot system-prompt): (1) new **`SkeletonProfile`** in `components/Skeleton.jsx` STRUCTURALLY mirrors `Profile.jsx` (header + 12-col grid: left summary card with avatar circle/name/buttons/Basic-Info, right column with Profile-Strength card + tabbed form card with labelled field rows), same `max-w-5xl` shell & card box model → no layout shift; `Profile.jsx` returns `<SkeletonProfile/>` while loading (generic `SkeletonPageHeader`/`SkeletonForm` kept for other consumers). (2) **AI Chatbot aligned to current features** — the backend `SYSTEM_PROMPT` (`routes/chatbotRoutes.js`, the chatbot's single knowledge base) rewritten: Skill Demand (not "Top Platforms"), **My Applications** (not MyJobs Kanban), account-completion gate + 3-step Apply Wizard (§43), unified **Document Builder** PDF+DOCX (§30), referral **endorse→accept→letter** + outcomes (§26/§31.5), Events, notification bell, Saved Vacancies/Import Past Applications renames, ₱ salaries, requirement-only scoring (certs not scored, §40), Identity & Profile tabs (NO ID-document verification). Frontend `Chatbot.jsx` `QUICK_ACTIONS` chips refreshed (dead drag-and-drop-pipeline chip removed). Reuses the existing `/chatbot/query` route + `aiClient` + DeepL — no new intents/logic/duplication. Build clean; both behind `AppLayout` (owner-verifies runtime).

**Still-live rules embedded in those records — honour these even though the narrative moved:**
- REFERRED applications are finalized records → excluded from live AI re-scoring (§18.5; also §14).
- **Landing Page Events carousel reuses the Events subsystem, never duplicates it (§34).** It reads the SAME `peso_events` records + `banner_image` via the SAME public `GET /api/events` as the seeker `Events.jsx`, so the poster is identical for Job Seeker / PESO Admin / PESO Staff and an image uploaded by EITHER the Manager or PESO Staff (both `events:manage`, one create/update path) is surfaced as-is. There is ONE list method (`listPublished({scope,limit})`, banner always included) — do NOT re-add a banner-free/lite projection or a second image path. **PRESENTATION (§45, 2026-09, SUPERSEDES the §34/§38 two-row shelf):** a **single-event carousel** (`EventsCarousel` + `LandingEventSlide` in `LandingPage.jsx`) — one hero slide at a time, `banner_image` as the primary visual; GPU `translateX` autoplay right→left; **dynamic dots** (one per event), hover-revealed prev/next arrows (§7 `.reveal-on-hover`, always shown on touch), touch swipe, full carousel/slide ARIA; autoplay pauses on hover/focus + resets on manual nav + off under `prefers-reduced-motion`; `single = count<=1` → static hero (no autoplay/arrows/dots); 0 events → the section's empty state. `LandingEventCard`/`EventsShelf` and the shelf edge-fade (§38 C2) are GONE. This reverses the earlier "no arrows/dots/autoplay" owner directive by a later owner request — do NOT restore the two-row shelf. The data source, `LandingEventModal`, and bespoke-palette rule (§24) are unchanged. **BANNER QUALITY (§45.4):** the poster renders with **`object-contain` over a blurred self-backdrop** (never `object-cover`/crop, never a raster hover-`scale` — both blur the poster); `PesoEventManager` keeps an uploaded poster VERBATIM when ≤2000px & under the cap (else 2000px/q0.92, white matte) — do NOT restore the destructive 1000px/q0.82 downscale; `eventRoutes.MAX_BANNER_CHARS` (3.0M) and the client constant must stay in lockstep. Banners remain base64-in-DB (§41); moving them to R2 for true retina/responsive `srcset` is the deferred §41 phase (owner decision). **The four Landing hero stats show the EXACT value — `CountUp` `suffix` is `''` (no "+"); do NOT re-add an approximation modifier.** **INFINITE LOOP (§45.5):** the carousel is a **clone-based** loop — track = `[cloneOfLast, ...events, cloneOfFirst]`, `pos` starts at 1, and landing on a clone (0 / count+1) triggers a transition-OFF JUMP to its real twin so last→first (and first→last) continue in-direction with NO rewind. The clone→real jump is **`setTimeout`-driven, NOT `transitionend`** (a re-render retargets the transform and the event never fires → runaway `pos`), and the transition is re-enabled with **`setTimeout`, NOT `requestAnimationFrame`** (rAF is paint-gated → stuck in a backgrounded tab). Do NOT revert to a modulo `translateX(-index*100%)` (that was the rewind) or to a `transitionend`/rAF snap. **Banner `src` goes through `resolveBannerSrc`** (pass-through for `data:`/`http(s)` — so an R2 URL renders verbatim — else `FILE_BASE`-prefix); the event carousel never used `/uploads` (banners are base64 `data:` URIs; only *job* `featured_image` uses `resolveJobImage`/R2).
- **The Landing Page carries ONLY factual, system-backed content and ONE contact channel (§46).** Do NOT reintroduce the hardcoded **testimonials/"Voices from the Community"** section — fabricated/placeholder reviews presented as real feedback are an unsupported claim (removed 2026-09). **"Common Questions" (FAQ) and "Visit Us In Person — Our Office" are ONE consolidated `#faq` section** — the FAQ left, the office info/Get Directions/Message Us/map-preview right (with `id="location"` on that column so both the `#faq` and `#location` nav/footer anchors resolve); do NOT re-split them. The **single landing contact channel is "Message Us"** (the office Facebook link); do NOT re-add a "Contact Us — Connect with PESO Administrators" form or the `POST /job-board/contact` route (both removed as a redundant duplicate; `contact_inquiries` is dormant/never read — leave it, §0.7). The four `FAQ_DATA` questions are kept verbatim. The green **"Your next opportunity…" CTA lives INSIDE the FAQ column** (below the accordion) — the FAQ column is `flex flex-col`, the CTA is `flex-1`, so it fills the gap beside the office card + map and the two columns bottom-align (grid stretch); do NOT move it back to a separate full-width closer section below the grid.
- **Top-header menus open on HOVER + click; the welcome greeting is a temporary once-per-session banner, NOT a header chip (§47).** The `TopHeader` avatar menu and `NotificationBell` open on hover as well as click — hover is **capability-gated** (`matchMedia('(hover: hover) and (pointer: fine)')`) with `onMouseEnter`/`onMouseLeave` on the `relative` wrapper + a ~180ms leave-close timer; do NOT remove the capability gate or the click/Escape/outside-click paths, and keep all menu contents/handlers/auth/notification logic intact. **Open/close MOTION (2026-09):** both dropdowns are ALWAYS MOUNTED and toggle via the shared `components/layout/dropdownMotion.js` (fade + slide, `origin-top` 200ms ease-out — the SAME language as the "+ Create New" menu), so they animate OUT as well as in, with a subtle per-group content stagger; a closed panel carries `inert` (keyboard/AT skip it). Do NOT revert to conditional-mount (`{open && …}`) — that loses the close animation. Hover timing is now **100% identical to "+ Create New": open IMMEDIATELY / close 180ms** (`HOVER_CLOSE_MS`; the earlier 110/320 was retuned to match Create New by owner request). The old persistent "Welcome back" header chip is GONE — the welcome now lives in `components/dashboard/DashboardGreeting.jsx` ABOVE the `Dashboard Overview` heading as the **full-width banner** (illustration + "Hello, {first}! 👋" + subtitle) — a **compact `w-fit` pill variant was tried 2026-09 and REVERTED** (owner: "looks bad"); keep the full-width banner, do NOT re-attempt the pill. It shows **once per session per user** (`sessionStorage` `pk_dash_greeted:<userId>`) then **fades out** (~7.5s), using the authed `user`'s name. **Hired celebration:** if the seeker has a referral with placement outcome `'Hired'` (the authoritative signal, §0.14, read best-effort from `GET /referrals/mine`), it shows `assets/illustrations/hired.webp` + a congratulations message instead of the normal `welcome_hero.webp` welcome. It also shows the **exact position** they were placed for (`job_title · company` from the referral data). It celebrates **once per NEW placement** (owner change 2026-09): the celebrated referral ids are tracked as a set in `localStorage pk_dash_hired_seen:<userId>`, so a newly-recorded Hired referral (a new id) celebrates again — the old once-EVER boolean `pk_dash_hired_celebrated:*` is retired (a leftover value is ignored). After a placement is celebrated the seeker gets the normal welcome again; any fetch failure falls back to the normal welcome; do NOT make it permanent or re-show it on every in-dashboard navigation, and do NOT re-add a header welcome. Its illustration is `src/assets/illustrations/welcome_hero.webp`. **Both greeting illustrations were swapped PNG→WebP (2026-09):** `welcome_hero.webp` (normal) + `hired.webp` (hired) are the imported/active assets; the `welcome-hero.png` / `hired.png` originals are RETAINED in `src/assets/illustrations/` but no longer imported (owner kept them — do NOT delete or point the imports back at the PNGs). Hover-intent timing is open 110ms / close 320ms (one `hoverTimer` ref per menu) — tune those constants, don't remove the delays. **DEV-ONLY preview toggles** (both guarded by `import.meta.env.DEV`, so they can NEVER fire in a prod build): `localStorage.setItem('pk_greeting_always','1')` forces the greeting on every dashboard mount; `localStorage.setItem('pk_greeting_force_hired','1')` forces the HIRED celebration variant (skips the `/referrals/mine` check) so it can be previewed without a real 'Hired' referral. NOTE: `sessionStorage` holds the auth JWT (`jobTrackerToken`), so `sessionStorage.clear()` LOGS THE USER OUT — to reset only the greeting gate, remove keys prefixed `pk_dash_greeted`.
- **Import Past Applications is a controlled WAY TO CREATE `usertrackedjobs` records, never a parallel application store (§49, §49.5).** Its commit INSERTs into `usertrackedjobs` — the SAME table/columns/status vocabulary the manual "add tracked application" flow uses (`importService.js:271` ≟ `trackedJobRoutes.js:95`) — and every imported row surfaces through `GET /api/applications/unified` (`applicationRoutes.js:143`, `imported` branch = `usertrackedjobs … deleted_at IS NULL`), the ONE feed behind both the Dashboard "All Your Applications" widgets/KPIs and the "My Applications" page. Validation, dedupe (within-file + vs the user's existing rows), limits (2MB/500/5-per-day/1000), preview and confirmation all run BEFORE persistence; `commit` is idempotent on `import_id` + append-only (existing rows never updated/deleted); `import_batches` (mig 049) is a counts-only audit/idempotency ledger, NOT an application store; imported-row edits/deletes go through the unchanged `/tracked-jobs` routes; referrals stay FK-bound to `job_applications`. Do NOT re-introduce a duplicate application table/model, a second read path, or the old `/tracker/upload` (it AI-validated then ran a destructive `DELETE FROM UserTrackedJobs`). Résumé analysis writes `uploaded_resumes` (UPDATE-in-place, parsed-text only) the same way (§49 Phase C); do NOT add a second résumé store. Both modules share `components/dataflow/ProcessingModal` + `StepProgress`.
- **The PUBLIC Landing-Page assistant is SEPARATE from the authenticated chatbot — never merge them (§50).** `POST /api/public-assistant/query` (`routes/publicAssistantRoutes.js`, NO auth) serves anonymous visitors; the authed Job-Seeker chatbot (`routes/chatbotRoutes.js`, `requireAuth`, per-user `chathistory`) is UNTOUCHED. They share the BACKEND AI layer (`aiClient` — the public bot uses **`chatRaw`** for tool calling; do NOT change `chat`/`chatDetailed` signatures — and `services/aiTranslate.js`) AND, as of the chatbot UI unification (2026-09, dev-history §52), a common FRONTEND layer in **`components/chat/`**: `ChatLauncher` (the shared pill: mascot + "Ask PESO Assistant" + Chat chip), `MessageBubble`, `TypingIndicator`, and `chatMotion` (one open/close transition + the `.chat-msg-in` keyframe in `index.css` — the app has NO tailwindcss-animate, so `animate-in …` classes are no-ops). These are **palette-parameterized by `variant`** (`app` = design tokens/dark-mode for the authed bot; `landing` = bespoke greens for the public bot, since LandingPage is excluded from tokens §24). So the two look like ONE product; the distinction is **access/context, not visual identity**. What stays SEPARATE: routes, prompts, tools, permissions, data scope, `chathistory`, and each bot's context-specific chrome (the authed bot's DeepL language menu + `main_menu`/`follow_up` chips vs the public bot's nav-action buttons + visitor quick-actions — deliberately NOT shared, to avoid variant-branching that hurts more than it dedups). The public assistant MUST NOT: touch `chathistory` or any per-user/auth table; expose anything beyond the public data the tool allowlist (`services/publicAssistant/publicData.js` `runTool`) returns (vacancies/categories/stats/events/office — the same rows `GET /api/job-board*` + `/api/events*` already serve); or fabricate vacancies/policies/contacts (dynamic facts come from a tool, else say so + offer "Message Us"). The server ALWAYS owns the system prompt and refuses client `system`/`tool` roles (`sanitizeMessages`) → no prompt injection; conversation is client-managed (stateless, no anonymous persistence); it is IP rate-limited + input-capped (Phase D). **Navigation buttons are DERIVED server-side (`knowledge.deriveActions`, allowlisted to NAV, ≤2), NOT a model tool** — do NOT re-add a `suggest_navigation` tool (the model chose it over answering). Frontend `components/PublicChatbot.jsx` is Landing-only (never `AppLayout`), uses the **bespoke landing palette** (not the app tokens §24) and its `onNavigate` reuses `LandingPage`'s own `scrollTo`/`setAuthMode`. It dismisses on **Escape AND an outside click** (a document `pointerdown` outside `panelRef`, attached only while open — clicks/typing/scrolling INSIDE stay interactive; NO backdrop element, so the page stays usable and the normal open/close transition plays); do NOT swap this for a full-screen backdrop that blocks the page. Office facts in the prompt mirror `LandingPage.jsx` (§46) — keep in lockstep. **App-wide `trust proxy` is now SET (§50.1):** `server.js` `app.set('trust proxy', 1)` → `req.ip` is the real client IP on Render, so ALL rate limiters key per-visitor (were one global bucket) and auth `[AUDIT]` logs the client IP; `authRoutes` `loginLimiter` raised 5→15/15min; the public route uses the DEFAULT keyGenerator (no custom XFF). Do NOT set `trust proxy` to `true` (permissive) — keep it `1` (one hop); cookies stay `secure` via `NODE_ENV`, not `req.secure`.
- **Event `event_date` is stored as a plain `YYYY-MM-DD`, never a re-sent `…T…Z` datetime (§51).** The DB pool is `timezone:'Z'`, so a stored `event_date` serializes back as a full UTC datetime; the Events edit form round-trips it, so `eventRoutes.cleanEventInput` AND `PesoEventManager.save` both `.slice(0,10)` it — otherwise a plain edit (e.g. a banner change) re-sends `…T00:00:00.000Z` into the DATE column and can shift the row out of the Landing carousel's upcoming filter (`status='Published' AND event_date >= CURDATE()`), making a still-published event vanish. Same date-fragility lesson as §49 (never let a UTC datetime hit a local DATE). **Event banner replace is ATOMIC (§51):** the Edit modal's "Change" validates the new image (type → downscale → `MAX_BANNER_CHARS` guard, kept in lockstep with `eventRoutes.MAX_BANNER_CHARS`) and swaps ONLY on success; the DB banner is untouched until Save; `persistBannerRef` uploads the new asset to R2 BEFORE the single `UPDATE` and returns URLs/keeps base64 on failure; `events.update` never touches `status`; content-addressed keys never delete the old asset — so a banner change can never invalidate/unpublish the event. Do NOT reintroduce a Remove-first-only flow or delete the old asset before the new one is confirmed.
- **The Landing Page NOW themes light/dark — it is NO LONGER "always light" (§53, SUPERSEDES §24/§45).** A `components/common/ThemeToggle` sits in the Landing header (desktop + mobile bar) and drives the EXISTING `ThemeContext` (state, `localStorage['theme']`, `.dark`-on-`<html>`, the View-Transitions toggle animation) — `ThemeProvider` already wraps the Landing (`main.jsx`), so the theme is SYNCED Landing↔app; do NOT add a separate theme mechanism for the Landing. The Landing has a **curated bespoke DARK palette via `dark:` hex variants (NOT the app tokens — the §24 token-exclusion STILL HOLDS; do NOT tokenize the Landing, that flat-monochrome revert stands)**: root `#0b1220`, cards `#111b2e`, tints/borders/text mapped, hero photo dimmed, `.dark .glass-card` in the `<style>` block. LIGHT mode is unchanged. The public chatbot's `landing` variants (`ChatLauncher`/`MessageBubble`/`TypingIndicator`) + `PublicChatbot` panel are dark-aware too. When adding NEW Landing markup, give every hardcoded light color a `dark:` counterpart (a bare Tailwind color like `bg-white` is a PREFIX of `bg-white/50`, so never `replace_all` a bare trailing-space token — it merges the next class).
- **A Landing `.reveal` that MOUNTS AFTER its data loads must be in the scroll-reveal observer's deps, or it renders INVISIBLE (§54).** `.reveal` starts at `opacity:0`; only the IntersectionObserver in `LandingPage.jsx` adds `.active {opacity:1}` on scroll-in. That `useEffect`'s deps MUST list every async list that gates a `.reveal`'s mount — `[jobs, activeFaq, searchQuery, locationQuery, events, loadingEvents]` — so the observer RE-RUNS and re-`observe()`s freshly mounted reveals. Omitting `events` left the Events carousel (mounts only after its fetch) unobserved → stuck `opacity:0` → a blank-but-clickable section (a `jobs`-vs-`events` load race, so it was intermittent). When you add a new async-loaded `.reveal` section, ADD its state to these deps. **DEBUG CAVEAT:** the Browser pane runs as a HIDDEN tab (`document.visibilityState==='hidden'`) → IntersectionObserver callbacks AND CSS transitions are SUSPENDED, so ALL `.reveal` read `opacity:0` in-pane regardless of correctness — do NOT diagnose reveal/opacity live there; confirm the CSS rule (`.reveal.active`→opacity:1, transition removed to defeat the confound) + the observer deps instead. **The Landing now shows PAST events too (§54C):** it fetches ALL published (`GET /api/events?limit=12`, NO `scope`); `eventRepository.listPublished` 'all' scope orders upcoming(soonest)→undated→past(most-recent) so a LIMIT surfaces what's next (past badged "Ended" by `eventRelativeStatus`) — do NOT re-add `scope=upcoming` on the Landing, and do NOT change the 'all' ordering to a naive `event_date ASC` (that buries upcoming under old rows). `scope='upcoming'` stays UNCHANGED — it is the public chatbot's `get_upcoming_events`, which must only name future events. A missing/broken banner falls back to the gradient (`LandingEventSlide` `onError` + `imgFailed`), never blanking the card. **Authed chatbot render parity (§54D):** `Chatbot.jsx` dropped the full-page + stacked `backdrop-blur` layers (kept the dim), `backdrop-blur-3xl→md` + `transform-gpu`, and a direct `scrollTop` (not `scrollIntoView({behavior:'smooth'})`) — do NOT re-stack backdrop-filters on the panel/controls (they re-rasterize during the open scale = the flicker). **TopHeader "Profile" is role-aware (§54E):** PESO Admin → `/peso-admin/profile` ("Organization Profile", the sidebar's authoritative target); Job Seeker → `/profile`; PESO Staff → hidden; resolved via `normalizeRole` — do NOT send all roles to the applicant-only `/profile` (the ProtectedRoute bounces a PESO Admin off it).
- **The Job Seeker vacancy-detail side panel leads with a scannable key-facts strip, not a buried sidebar card (§55).** The Public Job Board posted-vacancy slide-over (`PublicJobBoard.jsx`, `selectedJob`, opened by double-clicking a `JobCard` — desktop double-click / touch tap, `onOpen`) puts the decision-critical facts — **Salary (emphasized), Employment type+setup, Location, Positions open, Deadline** — in a responsive `DetailFact` grid directly under the title, with a status pill (Now Hiring / `filledLabel`) + posting age (`postedLabel(created_at)`) + department in a context row above it. Do NOT re-add the old sidebar **"Application Details"** card (salary/positions/deadline now live in the strip — re-adding it duplicates them) or the three generic header pill-chips. Section headings are the shared iconized pattern (`text-base` + icon + `border-b`); keep the spacing rhythm (`space-y-6`, `p-5/6/8`, `rounded-2xl`) — do NOT bloat it back to `space-y-10`/`p-10`/`text-4xl`. The redesign is **layout only**: the double-click open flow, the deep-fetch pipeline (`handleOpenDetails` → `GET /job-board/:id`), the **AI Compatibility card** (its resume-required / sign-in / score states, `matchBand`/`levelTone`, `triggerAiAdvice`), `handleStartApply`/`handleSaveToggle`/`handleMessageEmployer`, similar-jobs, and `isJobFilled`/`filledLabel` are untouched — do NOT alter them when restyling. The board is inside `AppLayout`, so it IS design-tokenized (unlike the Landing §24) — keep every new surface token-driven + dark-aware.
- **Rate limits are centralized in `middleware/rateLimiters.js`; every expensive/mutating entry point must be covered, and helmet's cross-origin config must not regress (§56).** New per-category limiters go in that shared, env-tunable (`RL_*`) module — do NOT scatter fresh ad-hoc `rateLimit(...)` calls in route files (the older auth/chatbot/public-assistant/AI-builder inline limiters predate it and are fine as-is). `server.js` mounts **`globalLimiter`** on the whole `/api` surface as a backstop (health + `OPTIONS` exempt) AND **`helmet`** — helmet's **CSP is OFF and `crossOriginResourcePolicy` MUST stay `'cross-origin'`** (this process serves JSON + public `/uploads`, NOT the app HTML; the `same-origin` default would block the Vercel frontend from loading `/uploads` images). When you add a NEW endpoint that calls the AI (DeepSeek cost), applies, uploads, or creates rows, attach the matching limiter — `aiLimiter` (`/jobs/match`, `/profile/{upload,insights/generate,match}` already have it), `applyLimiter` (`/applications`), or `writeLimiter` (`/profile/avatar`, `/messages/conversations`); do NOT remove the existing ones. Frontend `api.js` has a 60s default axios `timeout` — keep it (override per-call for a genuinely longer op). The retry/timeout/loop safeguards are the AI client (`aiClient.js` — 20s timeout + circuit breaker + single-pass failover) and the outbox workers (`max_attempts` dead-letter + backoff + batch cap); do NOT wrap either in an unbounded retry. **Privacy Policy accuracy (§56):** the Landing Privacy/Terms modals must stay truthful — the system does NOT collect government ID documents (verification removed §48), and the AI/data-processing section names the real subprocessors (DeepSeek/OpenRouter, DeepL, R2, email, Google sign-in). If a data flow or subprocessor changes, update that modal; wording still needs DPO/counsel sign-off before public launch. Full audit + deferred items: `docs/system-audit-2026-09.md`.
- **Legal text has ONE source (`components/legal/legalContent.jsx`); the SPA rewrite (`vercel.json`) must not be deleted (§57).** Privacy/Terms/Cookie content lives ONLY in `legalContent.jsx` and is rendered by BOTH the Landing signup-consent modals (`LandingPage.jsx`) AND the routed pages `/privacy`·`/terms`·`/cookies` (`components/legal/LegalPage.jsx`, wired in `App.jsx` as PUBLIC routes) via `<LegalSections>` — do NOT re-inline legal copy into a modal or page; edit the shared module so the two never drift (keep it truthful to the system — §48/§56). The standalone pages are self-contained (outside AppLayout + the Landing) and use the Landing palette (bespoke greens + `dark:` variants, NOT app tokens — §24/§53). **`job-tracker-frontend/vercel.json` provides the SPA deep-link fallback (`/(.*)`→`/index.html`); without it EVERY client route 404s on a hard hit/refresh in prod (this bit `/reset-password` from reset emails) — never remove it, and remember Vercel serves real `/assets/*` from the filesystem first so the catch-all doesn't shadow them.**
- **No hardcoded secrets; the socket path and body-size cap are bounded (§58).** Secrets come ONLY from env — do NOT reintroduce an inline fallback for `GOOGLE_CLIENT_SECRET` (`authRoutes.js`) or `JWT_SECRET` (`socketServer.js` — a public fallback key lets anyone forge a socket identity); both fail safe because `JWT_SECRET` is required app-wide. The realtime `send_message` handler (`socketServer.js`) is throttled per-socket (sliding window `SEND_MAX`/`SEND_WINDOW_MS`) with a `MAX_MESSAGE_CHARS` cap and a `data || {}` guard — keep those when editing chat, and persist the trimmed `text`, not raw `content`. `express.json`/`urlencoded` are capped at `BODY_LIMIT` (15mb) — the largest legit JSON body is a ~6.7MB base64 upload (cert/apply-résumé ≤5MB file, event banner ≤3MB); FILE uploads use multer's own `fileSize` limits, so don't raise `BODY_LIMIT` for a file path. **The leaked secrets are removed from source but still live in git history — they MUST be ROTATED in the Google/Render/Cloudflare consoles before public launch (`docs/compliance-and-security-runbook.md`); that runbook also holds the NPC-registration / retention-period / DPO-sign-off actions the LGU owns.** New modal/overlay surfaces get `role="dialog"` + `aria-modal` + Escape-to-close (the vacancy panel now does, §58).
- **The referral automation dispatch is provider-neutral; internal n8n identifiers are persisted — do NOT rename them (§59).** The `dispatch_n8n` outbox step reads **`AUTOMATION_WEBHOOK_URL`** (falls back to `N8N_WEBHOOK_URL`; timeout `AUTOMATION_DISPATCH_TIMEOUT_MS`) — point it at the Make.com webhook to cut over (owner builds the scenario from `docs/make-com-migration-guide.md`). It stays a DOWNSTREAM consumer (invariant 0.10 — referrals complete even if it's down; retry/backoff/skip + the Super-Admin Workflow Automation monitor + replay already exist). The step key `dispatch_n8n` and the activity actions `N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED` are PERSISTED in the outbox + activity log — keep them as-is (renaming orphans in-flight rows/history); only config vars + user-facing labels moved to "automation/Make." Backend architecture (§59 proposal): keep the modular monolith on Render Free tier; the ONE justified extraction is the `WORKER_MODE=web` + `worker.js` worker process, and only when `/admin/timing` profiling + a paid tier justify it — do NOT fragment into microservices (a 2nd Free service just adds cold-starts); uploads stay on R2, never the ephemeral container disk.
- **Motion is centralized in `config/motion.js`; the org account shows the PESO logo via `Avatar`; the 5-pin cap + referral automation are enforced SERVER-SIDE (§60).** New enter/exit/stagger animation reuses the shared variants in `job-tracker-frontend/src/config/motion.js` (expo-out easing aligned to `chatMotion`, reduced-motion aware) — do NOT hand-roll durations/eases per component; `framer-motion` is now actually used (Events + admin event modals via `AnimatePresence`, Messages menus/bulk-bar). **Org identity:** `components/common/Avatar.jsx` short-circuits to `assets/PESO LOGO.jpg` (object-contain, white ground) whenever `isOrgAccount(user)` (role `peso_administrator`/legacy `employer`, or an explicit `variant="org"`); this is the ONE renderer so it propagates to header/messages/profile/referral views at once — do NOT special-case the logo elsewhere, and any surface that renders the org account must pass `role` on the user object (Messages' `peerOf` now carries `role`; the messages query already selects `employer_role`/`applicant_role`). Seeker avatars are untouched (they never match `isOrgAccount`). **Messages state (migration 050 `conversation_states`, PK user_id+conversation_id):** mute/pin/manual-unread are PER-VIEWER; the **5-pin cap is enforced in a transaction** in `messageRoutes` `PATCH /:id/pin` (count-then-insert, 409 `PIN_LIMIT`) — never rely on the client for it; muted conversations are excluded from the unread count (`COALESCE(cs.is_muted,0)=0`); the roster orders pinned-first; multi-select uses the ONE batch endpoint `POST /messages/conversations/state` (participant-scoped, ≤200 ids) — do NOT send one request per row. **Seeker referral automation (migration 050 `referral_preferences`, default `manual`):** `referralService.approveReferral` reads the seeker's `mode` AFTER the endorsement commits and, for `auto_accept`/`auto_decline`, reuses `acceptReferral`/`declineReferral` on the committed row (full audit trail); it is **FAIL-SAFE to manual** on any error and the "please respond" nudge is sent only in manual mode; it only has effect when `referral_acceptance_enabled` is ON (ships dark). Preference read/write is owner-scoped GET/PUT `/profile/referral-preference` + the Account Settings "Referrals" tab (seeker-only, confirm-before-enabling automation). Both tables have zero-crash boot creates (`messageRoutes.js` / `profileRoutes.js`) so a deploy is never ahead of the migration — **owner still runs `npm run migrate` to record 050**.
- **Messages effects key on `activeConv?.id` (never the object); the employer email is the referral recipient; Make.com is the live automation (§61).** In `Messages.jsx` the conversation-history effect MUST depend on **`activeConv?.id`**, not the whole `activeConv` object — keying on the object caused a 429 request-storm (a roster refetch replaces `activeConv` with a new same-id object → effect re-ran → `triggerBadgeRefresh` → `messageUpdateTrigger++` → `fetchConversations` → loop). Keep the `AbortController` (cancel history fetch on switch/unmount) and the debounced socket-driven roster refresh; `patchConv` updates both the roster row AND the open convo (safe only because the effect is id-keyed). Do NOT re-key that effect on the object or drop the debounce. The backend limiters stay as the safeguard — never bump/remove them to "fix" a client loop. **Employer email (migration 051 `pesoadmin_job_posts.company_email`):** it is the AUTHORITATIVE referral recipient — `referralRepository.findReferralForDispatch` selects `pj.company_email AS employer_email` (+ `pj.company AS employer_name`); do NOT revert to the PESO admin's `emp.email`. It is **required before a vacancy is Open/Published** (`validateCompanyEmail`, server + form mirror), optional for a Draft; NULL on old/draft jobs just means no external recipient (referral still completes, 0.10). **Make.com is the live automation provider** via `AUTOMATION_WEBHOOK_URL`; the worker's user-facing strings say "automation (Make.com)" but the PERSISTED `dispatch_n8n` step key + `N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED` actions are unchanged (§59) — never rename them. **As of §70 the `N8N_WEBHOOK_URL` / `N8N_DISPATCH_TIMEOUT_MS` env fallbacks were REMOVED** (post-cutover) — the code reads ONLY `AUTOMATION_WEBHOOK_URL` (+ optional `AUTOMATION_DISPATCH_TIMEOUT_MS`); do NOT re-add an `|| process.env.N8N_*` fallback. The Make blueprint sends to `{{1.employer.email}}` and stores `{{1.reviewedAt}}` in the data store (not `""`). Landing `LandingEventModal` and the seeker `Events` modal share the §60 Motion/skeleton language — keep them in lockstep. `PipelineAnalyticsChart` uses a custom tooltip that filters to non-zero statuses + Total — don't revert to the default recharts tooltip (it lists every zero stage).
- **The AI Compatibility score reveal drives the number AND bar off ONE animated value; it's mount-triggered (§62).** `AnimatedScore` (`PublicJobBoard.jsx`) counts up 0→real score over ~1.4s ease-out (`SCORE_ANIM_MS`). It animates on MOUNT only — the parent resets `aiScores=null` on every open/reopen (`handleOpenDetails`) and renders it only once the verified score is present, so it re-reveals per new result/reopen without restarting on unrelated re-renders. Do NOT add a CSS width `transition` to that bar (rAF drives it; a transition desyncs it from the number), do NOT animate before the real score arrives, and keep the non-numeric ("—")/0%/reduced-motion handling. The tone/band label come from the REAL score (stable), only the number+bar count up.
- **Scroll-reveal is ONE shared primitive (`common/Reveal.jsx`), repeatable + hysteretic; analytics tooltips fade at the point, not from the left; the Landing job list is a self-contained scroll panel (§63).** **Reveal:** every posted-job card on all three surfaces (Public Board flat grid + `JobCategorySections` rows, Admin manager grid, Landing panel) wraps in `<Reveal>` — do NOT hand-roll a second observer or an inline `.reveal` for job cards. It runs **one `IntersectionObserver` per root** (viewport = a module singleton; each container root = a `WeakMap` entry) and **replays** the fade every time a card exits and re-enters, by TOGGLING the `.reveal-in` class (visual state in `index.css` `.reveal-item`/`.reveal-in`, opacity+translateY) — pure `classList`, **no React state and no remount** (do NOT convert it to state/remount to "restart" the animation). The **hysteresis is load-bearing**: reveal only at `intersectionRatio >= 0.15`, reset only when fully out, `threshold:[0,0.15]` — do NOT collapse it to a single `isIntersecting` toggle (that flickers on a few-pixel wobble). Pass **`root`** = a ref to the scroll container the cards live in: the Landing uses its internal panel; the Public Board and Admin manager use the page viewport (their grids scroll with the page) — that matches each surface's existing scroll architecture. Reduced-motion shows cards immediately with no replay. **Tooltips:** every recharts `<Tooltip>` must carry `isAnimationActive={false}` (kills the slide-from-the-left position animation) and render a custom `content` whose root is **keyed by the hovered data point** (category label, or slice/series name for a pie) so the `.chart-tooltip-in` fade (opacity + 6px translateY, 200ms ease-out — the dropdown motion language) fires once per point and holds on continuous hover; do NOT revert to the default recharts tooltip or re-enable its animation. **Landing job panel:** the posted-jobs grid lives in a fixed-height self-scrolling container (`max-h-[min(720px,72vh)]` `overflow-y-auto` `overflow-x-hidden` `custom-scrollbar`) so the page height never grows with the vacancy count — keep it a contained panel (responsive `auto-fill` grid inside, no horizontal rail), and keep that panel's ref as the `Reveal` root. The Landing reuses **`useJobFilters`** for the category taxonomy + filtering (one source; the search inputs bind to `jf.state`/`jf.set`) but renders its OWN bespoke-palette `LandingCategorySelector` + card + `LandingJobModal` — it must NOT import the token-styled `JobCard`/`CategoryChips` (§24/§53 Landing token-exclusion). `LandingJobModal` renders straight from the job object (no fetch) with the §60 Motion/backdrop and "Apply Now"→login; do NOT re-add the first-job auto-open. **Pane caveat:** the Browser preview runs hidden → `IntersectionObserver` + `requestAnimationFrame` are suspended, so reveal firing, framer-motion open/close, and `vh` sizing CANNOT be verified in-pane (confirm the CSS/observer wiring via the DOM instead; the animation itself is deploy-verified — same §54 limitation).
- **The Landing has NO keyword search; category navigation is its full-width discovery control (§65, SUPERSEDES §64).** The §64 `LandingJobSearch` keyword/location bar was REMOVED (owner IA decision) — do NOT re-add a search/filter input to the Landing (neither the board section NOR the hero). Full keyword/location/sort/advanced discovery is the **Public Job Board's** job, reached via the header **"View All Jobs →"** CTA (`setAuthMode('login')`). The hero carries two CTAs only (`scrollTo('jobs')` / `scrollTo('events')`). **`LandingCategorySelector` is a full-width `flex flex-wrap items-center gap-2.5` row** (NOT the old `overflow-x-auto` + `grid grid-flow-col auto-cols-max w-max` scroller) so the chips span the whole `max-w-7xl` container and wrap onto more rows on narrow screens — do NOT revert it to a left-concentrated horizontal scroller, and do NOT stretch chips to fill (natural size + wrap is the deliberate layout). It reuses the SAME `useJobFilters` taxonomy (`jf.categories`/`jf.state.category`/`jf.set.setCategory`) — exactly ONE matching ruleset/data source; no parallel category impl. Section IA: **Category Nav → Results Count → Filtered Jobs (the §63 scroll panel) → View All Jobs**; the `aria-live` count reads category context ("N vacancies available" / "Showing K of N vacancies in <Category>"), the empty state is "No jobs in this category yet" + a "Show all jobs" reset (`jf.reset`). The `.reveal`/§63 `Reveal` panel + the `className` prop are unchanged; Landing stays un-tokenized (bespoke palette, §24/§53). **The Public Job Board's own `jobs/CategoryChips.jsx` was given the SAME full-width `flex flex-wrap items-center gap-2.5` treatment (§71) — it too dropped the `overflow-x-auto` + `grid grid-flow-col auto-cols-max w-max` scroll track (which left dead space on the right of wide screens) and its scroll-position contract; chips keep `shrink-0` (distribute-by-wrap, never stretch). Do NOT reintroduce a horizontal-scroll track or `w-max` on either control; both read from `useJobFilters` and their filtering/styling are unchanged.**
- **Sidebar nav tooltips are ONE shared component — `components/common/SidebarTooltip.jsx` (§72) — never per-item markup.** Every role-based sidebar (`Sidebar.jsx` for Job Seeker / PESO Admin / PESO Staff / `employer`-alias, and `superadmin/SuperAdminSidebar.jsx`) wraps its NavLink in `<SidebarTooltip label description showLabel={!isExpanded}>` and carries a `desc` string per nav item — add a nav item ⇒ add its `desc`, don't hand-roll a tooltip. It PORTALS to `document.body` with `position:fixed` (coords from the item rect) so it escapes the navs' `overflow-x-hidden` and is viewport-clamped — do NOT revert to an inline absolute tooltip (it clips). Styling reuses the design-system elevated-surface tokens (`bg-raised`/`border-line`/`shadow-raised`/`rounded-xl`, `text-content`/`text-muted`) — NOT a black bubble — and the `dropdownMotion` language (fade + 6px slide, 200ms ease-out, appear+disappear); `pointer-events-none` (no click-intercept/flicker), `aria-label` on collapsed icon-only items (native `title` dropped so browser tooltips don't double). The old collapsed-only, label-only `group-hover` tooltip was replaced on both sidebars; footer actions keep their label tooltips; the mobile drawer is untouched.
- **`ChatContext` is the app's ONLY socket, keyed on `[user?.id, user?.role]`, polling-first, with capped backoff (§73).** The socket URL follows `VITE_API_URL` (same source as `api.js`), minus `/api`; in a PROD build with the var unset it falls back to `window.location.origin` — it must NEVER dial `http://localhost:5000` in production. Key the connect effect on `user?.id`/`user?.role` (stable primitives), NOT the whole `user` object — keying on the object made §68's `updateUser`/`refreshUser` rebuild the socket on every profile edit (churn + storm risk). Transports are **`['polling','websocket']`** (polling first, upgrade to WS; graceful fallback if WS is unavailable, and no raw-WS mid-handshake abort under StrictMode). Reconnection is socket.io's own capped backoff (`reconnectionAttempts:15`, `reconnectionDelayMax:15000`, …) — do NOT add a manual reconnect loop (that was the earlier messaging 429 class). Clean up fully on auth change/unmount (`removeAllListeners` + `disconnect`). Any new realtime feature adds a LISTENER here — never a second `io()`.
- **Every quota'd limit is defined ONCE in `config/quotas.js`; enforcement reads it, indicators reflect it (§66).** The catalogue (`config/quotas.js`) is the SINGLE source of truth for every usage limit, with four DISTINCT axes never conflated into a generic "storage" number: `type:'count'` (record counts; `max:null` ⇒ informational), `type:'bytes'` (storage footprint vs a soft threshold), `type:'rate'` (per-window ops, e.g. imports/day), `type:'processing'` (per-operation file-size/row ceilings, a reference max with no running usage). A NEW limit is a catalogue entry (+ its computation in `services/usageService.js`), NEVER a new hardcoded number — the enforcement modules `importService`/`certificatesRepository`/`messageRoutes` already source `require('../config/quotas').LIMITS.*`. **Only limits that ALREADY exist and are already enforced carry `enforced:true` and can reach the `blocked` state** (imports/day 5, 1000 tracked, cert library 30, pins 5, upload sizes); a NEW hard cap on a previously-uncapped resource needs an explicit owner decision — the default is **informational-only** (`max:null`+`enforced:false` ⇒ `unlimited`, shown but never blocked) so applying and the office's core posting/referral/event workflow are NEVER newly blocked (invariant 0.1, encoded in `evaluateState` — an informational/soft resource can't return `blocked`). The **backend is authoritative**: the UI (`hooks/useUsage` → `components/common/UsageMeter`/`UsagePanel`) only REFLECTS the server-computed usage from `GET /api/usage` (seeker, `req.userId`) / `GET /api/peso-admin/usage` (owner-scoped `req.effectiveOwnerId`); it never computes a limit itself. Usage counts MUST match the actual quota calc — tracked/saved counts are **Trash-excluded** (`deleted_at IS NULL`, mirroring enforcement), `imports_daily` mirrors the **rolling 24h** window, and the informational **storage meter** counts the full base64 DB footprint (incl. records a Trash soft-delete would leave), kept SEPARATE from the record counts. `usageService` sub-queries degrade to 0 (a usage read never 500s a page, 0.1) and never `JOIN userprofiles` (0.8). Surfaces: seeker Account Settings "Usage & Limits" tab, PESO Admin Overview "Office Usage & Limits" card, inline meters in the Import modal (refresh after a commit). `config/quotas.js` is pure (no `../db`) so it's unit-tested directly; usageService is source-asserted (`test/quotas.test.js`).
- **Account Settings persists to the real backend, and the Google link state is backend-authoritative (§68).** Profile-Info **Full Name** persists via a full-payload `PUT /profile` (controlled input, seeded from `GET /profile`), and a success message shows ONLY after the 2xx — do NOT reintroduce the fake `setTimeout` success or an uncontrolled `defaultValue` input; keep the FULL payload (only `name` is `COALESCE`d in the endpoint — a partial body nulls gender/dob/phone/skills, §43) and `updateUser({name})` so `users.name` (the single name source) propagates to the top-header + every `<Avatar>`. Password change re-validates length **server-side** (`< 8` → 400), not just client-side. **Linked Accounts / Google OAuth linking:** the Connected state is DERIVED from the backend (`user.oauth_provider === 'google'` from `/auth/me`), NEVER a local UI flip — after the OAuth callback the frontend re-pulls `/auth/me` via `AuthContext.refreshUser()`. The connect flow reuses the SAME OAuth client + `/auth/google/callback` (no new Google Console redirect URI): `GET /auth/google/link/start` (authed XHR) mints a short-lived **signed** `{uid,purpose:'link'}` state and returns the consent URL; the callback distinguishes a LINK from a LOGIN by the **JWT-shaped state** (a login state is a plain role word), and an EXPIRED/tampered link ticket fails to `status=error` — it must NEVER silently fall through to login. **Token handling is identity-only** (verify the `id_token`, read sub/email, DISCARD — never store Google access/refresh tokens; the separate legacy Indeed `linked_accounts` token store is unrelated). **Duplicate protection**: `google_sub` is unique (app check + `UNIQUE INDEX uq_users_google_sub`) — one Google identity → one PESO account (`status=duplicate`). **Unlink is SAFE**: `POST /auth/google/unlink` refuses when there's no local password (`NO_PASSWORD` → the UI routes to the Security tab) so a user can't lock themselves out, and it clears `oauth_provider`/`google_sub`/`google_email` only — it NEVER DELETEs the account. Google **login matches `google_sub` first**, then email (a linked account whose Google email differs still signs into the right account; every linkage-stamp UPDATE is wrapped so a unique-index race can't break login). `oauth_provider`/`google_email` ride `/auth/me`·`/login`·`/google`. Both migrations (052/053) have zero-crash boot ALTERs in `authRoutes.js` — **owner runs `npm run migrate`** to record them + apply the backfill + the unique index. Do NOT add an `oauth_provider='google'` claim for every account (that was the §68-fixed dishonest display).
- **Admin identities are consolidated: ONE PESO Administrator (`peso@kabankalancity.gov.ph`, id 30002) and ONE Super Administrator (the owner's own account, id 1) — do NOT resurrect the removed accounts or re-split ownership (§69, DATA-only, no migration).** The office's authoritative PESO admin is **id 30002**; it is also the `effectiveOwnerId` (`pesoAdminRoutes` resolves staff → lowest-id `peso_administrator`) so staff/manager ops already key to it. Three legacy PESO-owner accounts (id 16 the pre-rebrand `pwd@` office, id 17 a dev/seeker account, id 25 junk) had been demoted to `applicant` yet still owned live PESO content; `scripts/consolidate-peso-admin.js` **reassigned** their `pesoadmin_job_posts.peso_admin_id` + `conversations.peso_admin_id` (+ id 16's `messages.sender_id`) → 30002 in one transaction — **reassign, NOT delete** (those FKs are `ON DELETE CASCADE`; deleting id 16 would have cascade-destroyed its jobs → applications → referrals → threads). Historical actor refs (`referral_queue.reviewed_by`, `referral_activity_log.actor_id`, `referral_outcomes.recorded_by`) and id 17's job-seeker data were **deliberately preserved** — do NOT "finish the job" by rewriting them. The junk-named second Super Admin (id 18 `admin@hire.com`) was consolidated into id 1 via `scripts/consolidate-super-admin.js`: its `admin_audit_logs.admin_id` (NOT NULL + NO ACTION FK — would otherwise BLOCK the delete) + `system_settings.updated_by` + `referral_activity_log.actor_id` were reassigned 18→1 (same human, audit trail kept), then the row was deleted after a full pre-delete scan confirmed zero remaining references. **`peso_staff` id 210002 (Mr. Tejada) is a legitimate active co-worker, NOT stale — leave it** (it authored the 3 published events via `created_by`, which is display-only/office-wide). Backups + rollback SQL for all three scripts live outside the repo (`%TEMP%/peso-consolidation-backup/`). Every write ran backup-first, dry-run-by-default, in a transaction with before/after counts. **The Super Admin console login is now the owner's own account (id 1); `admin@hire.com` no longer exists.**
- **n8n is FULLY RETIRED — Make.com is the sole automation provider; the only n8n vestiges are PERSISTED identifiers that MUST stay (§70).** The referral automation dispatch (the `dispatch_n8n` outbox step) hands a COMPLETED referral to Make.com via `AUTOMATION_WEBHOOK_URL` (+ optional `AUTOMATION_DISPATCH_TIMEOUT_MS`, default 15000). The `N8N_WEBHOOK_URL` / `N8N_DISPATCH_TIMEOUT_MS` env fallbacks were **removed** post-cutover — `referralWorker.js`/`referralService.js` read ONLY the `AUTOMATION_*` vars, so **no code path can dispatch to the old n8n** (do NOT re-add an `|| process.env.N8N_*` fallback). **KEEP (never rename — persisted in the DB, and renaming orphans in-flight outbox rows + history + breaks the `WHERE action='N8N_DISPATCHED'` / `step='dispatch_n8n'` detection queries, §59):** the step key **`dispatch_n8n`** (`referralPipeline.js` STEPS, worker `STEP_HANDLERS`, `enqueueJob`, `referral_jobs.step`) and the action keys **`N8N_DISPATCHED`, `N8N_DISPATCH_SKIPPED`, `N8N_REPLAY`, `N8N_REPLAY_QUEUED`** (`referral_activity_log.action`, `admin_audit_logs.action`, FE `ReferralActivity`/`FailedReferralsPanel` label maps). These are provider-agnostic NAMES, not an n8n dependency. Make.com is functionally equivalent to the retired n8n workflow (webhook → Google Sheets append 7 cols → employer email, + a NEW idempotency Data-Store guard); the trigger/payload (`event:'referral.completed'` + applicant/job/employer/reviewer)/retry(outbox backoff, 5 attempts)/logging/failure-handling all live in the UNCHANGED backend, so the automation is a non-critical DOWNSTREAM consumer — an undispatched referral is an advisory sync-gap, never a failed referral (0.10). Blueprint/history: `docs/make-com-migration-guide.md`, `docs/automation-and-backend-architecture-proposal.md` (retained as migration history). The Super Admin **Workflow Automation** page (`superadmin/features/automation/WorkflowAutomation.jsx`) is already Make.com-branded; `GET/POST /admin/automation[/replay]` drive the monitor + replay.
- **The AI Chatbot's knowledge is the `SYSTEM_PROMPT` in `routes/chatbotRoutes.js` — keep it in lockstep with feature changes (§48).** It is the single source the chatbot describes the platform from; when a job-seeker-facing feature/workflow/name changes, update that prompt (and the `Chatbot.jsx` `QUICK_ACTIONS` chips if they reference it). Do NOT add a second knowledge base or duplicate intent logic — the chatbot reuses the one `/chatbot/query` route + `aiClient` + DeepL translation. Do NOT reintroduce descriptions of removed modules (MyJobs Kanban, the three separate builders, Job Seeker Verification / ID-document upload, "Top Platforms"). As of §48 it reflects: account-completion gate + 3-step Apply Wizard, My Applications, Document Builder (PDF+DOCX), referral endorse→accept→letter + outcomes, Events, notifications, Saved Vacancies, ₱ salaries, requirement-only scoring. **`SkeletonProfile` (Skeleton.jsx) mirrors the real Identity & Profile layout — keep the two in structural sync (§5.5 addendum) if the page's columns/cards change.**
- **Account suspension is enforced SERVER-SIDE (§33.1), never frontend-only** — `middleware/authMiddleware.requireAuth` rejects a Suspended account on every request (403 `code:'ACCOUNT_SUSPENDED'`, fail-OPEN on DB error) and login blocks it too; the `api.js` interceptor force-logs-out an existing session. Suspend/reactivate writes/clears the mig-046 metadata and notifies via `notificationService` + email outbox (+ best-effort SMS). Do NOT weaken this to a UI-only guard.
- **SMS channel-router dedupe bucket is per-TYPE-of-origin (§33.1, 2026-08-24):** `notificationService.maybeFanOutSms` de-dupes the fan-out on `notif:${type}:${userId}:${bucket}` — **HOUR bucket** for referral events (`REFERRAL_ISSUED` fires from the RETRYING referral worker, backoff up to 1h → the hour bucket absorbs a retry-duplicate SMS) but a **per-MINUTE bucket** for the `ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED` lifecycle events (synchronous one-shot admin actions → every deliberate suspend/reactivate must send; only an accidental same-minute double-submit de-dupes). Do NOT make referral events per-minute (a worker retry would double-send). SMS fan-out set = referral events + both lifecycle types. Notification links (referral SMS → `/referrals`; reactivation email+SMS → sign-in; **walk-in claim SMS → `/claim`**, incl. `pesoAdminRoutes.claimBaseUrl()`) come from **`utils/appUrl.js`** (env-driven `FRONTEND_URL`→`CORS_ORIGINS[0]`→localhost, ALWAYS absolute) — never hardcode a prod URL, never a relative path in an SMS, never embed a token/auto-login (auth stays enforced).
- **Smart Referral Queue ranks candidates WITHIN a vacancy, never globally (§33.2)** — use `GET /peso-admin/proactive/candidates/grouped` (grouped, paged by vacancy). The flat `/proactive/candidates` + `listCandidates` are retained but the UI uses grouped.
- **The Landing auth-modal illustration panel is a carousel of FIVE local illustrations (§33.7)** — crossfade/dots/hover-pause/reduced-motion, no animation lib. **As of 2026-09 the ACTIVE assets are WebP in `src/assets/illustrations/`** (migrated from the original Streamline Tokyo SVGs): `LandingPage.jsx` imports `Support-Team--Streamline-Tokyo.webp`, `Digital-Call-Centre--Streamline-Tokyo.webp`, `Receive-A-Notification-1--Streamline-Tokyo.webp`, `No-Messages--Streamline-Tokyo.webp`, and **`Call_manager.webp`** (which REPLACED the retired `Rewards-Someone-Top-Of-A-Podium` podium SVG; its slide var is `slideCallManager`). The four non-podium `src/components/*.svg` originals **still exist in the repo but are UNUSED** — an owner GitHub-web upload (`d2aa32f`) re-added artwork to them concurrently, and the owner chose to KEEP them (nothing imports them); the podium SVG was the only one deleted. Do NOT point the carousel imports back at `./` (the WebP are authoritative); treat the leftover `src/components/*.svg` as dormant, not the render source. The **Chatbot icon stays `JobSeekerMascot`** (do NOT re-illustrate it). The **TopHeader welcome illustration** (§33.6) stays (do NOT revert to plain text). Streamline free assets require the footer **attribution credit** — keep it unless a paid plan is confirmed.
- **PESO Staff (`peso_staff`, §31.3) is a SEPARATE least-privilege role, never a `peso_administrator` variant** — Manager-only guards exclude it by default; `pesoAdminRoutes` restricts staff to `/jobs*` deny-by-default; staff-published jobs attribute to the office Manager via `req.effectiveOwnerId` (D2). Do NOT grant staff referral/ATS/analytics/walk-in access. Access is capability-derived (`requirePermission`), not per-page.
- **Every runtime flag read via `systemSettings.get()` MUST have a `DEFINITIONS` entry in `systemSettingsService`** — `get()` THROWS on an unregistered key (so it also never surfaces in the Super Admin Settings UI, which iterates `DEFINITIONS`). This bit the office-interview flags once (§31.9). New flags this cycle: `referral_acceptance_enabled`, `vacancy_manual_fill_enabled`, `walk_in_registration_enabled` (all §7.12, default OFF, exposed via `/config/features`).
- **Vacancy closure (#11b/§31.5): when `vacancy_manual_fill_enabled` is ON, a vacancy is Filled ONLY by a PESO-confirmed status — never auto-filled from the referral count, and the cap is advisory (no 409).** An **unspecified (NULL) `positions_available`** (§31.6) is NEVER treated as 0/1: no cap, no auto-fill, never count-filled; shown as "Multiple / Not specified". `isJobFilled`/`savedJobState` read the flag via `utils/featureFlags.js`.
- **Referral acceptance (#6/§31.5): when `referral_acceptance_enabled` is ON, the admin "refer" ENDORSES → `Pending Seeker Acceptance` (no letter) → the seeker ACCEPTS to mint the letter.** ACCEPT reuses the SAME approval tail (`finalizeApprovedReferral`) — never a parallel pipeline. `deliveryState.js` SQL+JS + `Referrals.jsx deliveryState()` MUST stay in lockstep (§14) for the `awaiting_acceptance`/`declined` buckets.
- **Events (#2/§31.4): ONE extensible `peso_events` subsystem (event_type discriminator), never a Job-Fair-only table.** Publishing broadcasts `EVENT_ANNOUNCEMENT` on FIRST publish only (a `published_at` gate). Banner base64 in the DB (§0.5); list payloads include it (events are low-volume).
- **Walk-in (#7/§31.7): a walk-in is a REAL claimable `users` row (`account_origin='walk_in'`), the SAME centralized model — never a separate store.** Duplicate detection + DPA consent required; Manager-only (`walkin:manage`). Do NOT reroute through the public OTP signup path.
- **SMS (#8/§31.8) is PROPOSAL-first.** `services/smsService.js` is the swappable provider abstraction, ship-dark; do NOT wire a provider or the channel router until one is chosen. In-app+email behavior stays unchanged.
- Every UI change uses design tokens + the §24.1 interaction-state states (a review gate that folds into §16's pre-flight).
- Empty states use `common/EmptyState` (answer why-empty / what-for / what-next); searchable modules use `common/SearchDropdown` (do NOT reintroduce below-content Recent/Suggested chips) — UI addendum §14–§15.
- The worker-split / Redis infra roadmap is approved-but-deferred (§25) — surface it each session; do NOT set `WORKER_MODE=web` without the Redis adapter or worker→client real-time goes dark.
- Referral Lifecycle Sync ships behind the `referral_lifecycle_sync_enabled` system setting (§26; §7.11/§7.12).
- ONE seeker applications module: `MyApplications` (`/my-applications`) over `GET /api/applications/unified`, which COMPOSES `job_applications` + `usertrackedjobs` (never merges). Referrals stay FK-bound to `job_applications`; the unified feed is READ-ONLY. Do NOT re-add a separate "PESO Applications"/`/jobs` page or move referrals off `job_applications` (§28).
- AI re-scoring is trigger-optimized, NOT decoupled: the Resume Assistant → `parsed_text` → scoring sync is core business logic (§7.4/§18.5) and `parsed_text` persistence stays UNCONDITIONAL. The input-hash guard (§29) only skips a redundant AI CALL when inputs are byte-identical; it gates at EXECUTION (never scheduling — that was the reverted `2464403` trap) and hashes the exact scored prompt (`aiScoringService.computeScoringSignature`, no drift). Ship-dark (migs 038/039, flags default OFF). Do NOT re-add a scheduling-time résumé dirty-check.
- Document Builder is BUILT + shipped (§30, `docs/document-builder-platform-plan.md`): ONE `components/builder/DocumentBuilder` (docType prop) for résumé/cover/resignation — schema-driven forms + client **react-pdf** live preview & export (preview == export) + `docx` DOCX. Do NOT re-add the 3 separate builders, the AI/Manual modal, `?mode=`, a server Chromium renderer, or freeform rich text for the résumé (§12 keeps the structured-JSON→scoring sync). New templates/doc-types go in `components/builder/templates/` + `documentSchemas`. AI body generation goes through `services/letterBodyService` (shared; one endpoint per builder — never double-fire). Cover-letter draft is one-row-per-user (no `ON DUPLICATE KEY`), now enforced at the DB level by `UNIQUE(user_id)` (migration 047, §14) — keep the POST self-heal as belt-and-suspenders; `src/bufferPolyfill.js` must stay (photo export).
- **SMS channel (§32.1) is BUILT + provider-agnostic; production Semaphore is DEFERRED (unfunded), NOT abandoned.** ALL providers live behind `services/smsService.js` (`sendSms`/`isSmsConfigured`/`toE164PH`) — callers NEVER import a provider. `semaphore` is the production provider (wired: number WITHOUT `+`, optional `SEMAPHORE_SENDER_NAME`); `console`/`log` is the ZERO-COST DEV provider (`SMS_PROVIDER=console` → delivers to the server log so OTPs are readable). Do NOT remove/redesign the Semaphore integration or migration 044; do NOT wire SMS into any NON-referral notification (fan-out is `smsTemplates.SMS_FANOUT_TYPES` = referral events only). In-app row stays the durable deliverable (§0.11); SMS is best-effort (0.1), gated by `sms_notifications_enabled` + a verified+opted-in phone. Resume production = fund/activate Semaphore + set env + flip the flag (`docs/sms-notification-proposal.md` §6a). Every SMS notification MUST still write its in-app row.
- **Walk-In CLAIM (§32.2) links the EXISTING row, never a second profile.** `claim_token` is a peppered SHA-256 HASH (raw code shown once); `completeClaim` UPDATEs the walk-in row (email must not belong to ANOTHER account) — do NOT make it INSERT a users row. Public `/auth/claim/*` is intentionally NOT flag-gated (an issued code stays claimable). It works with SMS disabled (code-only); the phone-OTP is a 2nd factor only when a phone is on file AND SMS is configured. Staff reissue via `POST /peso-admin/walk-in/:id/reissue`.
- **Identity Verification ID is REMOVED from LIVE code (§32.4); its columns are DORMANT, not dropped.** Do NOT re-add the ID-TYPE selector, `/profile/verification/id-types`, or any read/write of `verification_id_type`/`pwd_category` as an identity field. This is SEPARATE from the still-present accessibility/password `pwd*` tokens (§11) and the dormant Job Seeker Verification approval workflow (§14) — none of those are affected.
- **Sidebar nav is grouped by workflow (§32.3) via `{ isDivider, label }` — presentational only.** Grouping never changes routes/guards/RBAC; PESO Staff stays FLAT (don't force uniform grouping). `SuperAdminSidebar` renders `{ divider }` entries as headers.
- **The COMMITTED application score is the single source of truth shown to BOTH seeker and admin (§36.4)** — the seeker's My Applications and the admin ATS both display `COALESCE(current_match_score, match_score)`. The board `POST /jobs/match` score is a CACHED PREVIEW (deterministic, temp 0), now in `services/matchScoreCache.js` and **invalidated on every résumé change** (builder save/upload/apply-time overwrite). Do NOT present the board preview as the committed score; a freshly-submitted PESO app shows a **"Calculating…"** state until the async worker writes its score. The scoring engine is deterministic + single-sourced (`scoreApplication`, one prompt, `prefer=deepseek`); a divergence means DIFFERENT INPUTS, and F1 provenance (below) makes it diagnosable.
- **Referral-decision states are SYSTEM-SET, never from the ATS status menu (§36.2):** approve → `'Referred'`, reject/decline → `'Not Referred'` (its symmetric twin; terminal; NOT in `ACTIVE_STATUSES` so excluded from live re-scoring). `ATS_SETTABLE_STATUSES` stays `Applied`/`Under Review`/`Shortlisted`. A VOIDED approved referral still reopens to `'Shortlisted'` (void ≠ reject). `'Not Referred'` is a first-class canonical stage (`STAGE_STYLE`/`ALT_STAGES`/`TERMINAL_STAGES`/`PESO_BASE` + the admin ATS filter/tone + drawer tone).
- **Every referral/application DECISION notifies the seeker, best-effort post-commit, without echoing the admin's internal reason (§36.1):** decline → `APPLICATION_DECLINED`, void → `REFERRAL_WITHDRAWN` (both registered in `NotificationBell.TYPE_META` + `CONTROLLABLE_TYPES`, §7.7). `notifyUser` never throws (0.1/0.11); the decision succeeds regardless. Rejecting a *Pending Review* staging is now also surfaced (comes with the state + notification).
- **The AI score carries PROVENANCE (§35, F1):** `scoreApplication` stamps `provenance:{provider,model,promptVersion,scoredAt}` into the persisted `ai_analysis`/`current_ai_analysis` JSON, via `aiClient.chatDetailed()` which reports the provider+model that ACTUALLY served the response (after failover — the served model can differ from the requested tier alias, e.g. `deepseek-v4-flash` for the `deepseek-chat` tier, which is exactly why it is recorded). Provenance is NOT part of the prompt or the change-detection signature, so it can NEVER trigger a spurious re-score. NO migration (rides the JSON column).
- **Audit is COMPLETE (§35–§38):** E3 verified the hot paths are index-driven (no full scans); C2 added the Events-carousel scroll affordance. Only the documented **Future** roadmap remains (worker split/Redis, Semaphore funding, security rotation, email domain auth, Tier-2 scale anchors, dev/prod DB split) — do NOT implement now.
- **The DOLE Accomplishment Report (§39) MUST reconcile with the §7.11 referral report** — same cohort: **referred** = `referral_queue.status='Approved'` dated by `reviewed_at`; **placed** = `referral_outcomes.outcome='Hired'` ONLY (0.14). If you change one report's cohort, change both, or they diverge. It is a NEW report FORMAT (aggregate + demographic + PDF), NOT a replacement for the existing referral-row CSV or the analytics dashboards. Demographics COALESCE NULL/'' → a transparent **'Not specified'** (never hidden); group by a **derived-table column**, not a COALESCE alias (TiDB `only_full_group_by`). One builder (`reportingService.buildAccomplishmentExport`), two scopes (owner-scoped PESO admin vs office-wide Super admin). **Phase B DONE (§39.5):** an **age-group** breakdown from `users.dob` (already-captured DATE column; `AGE_CASE` computes CURRENT age and guards NULL/implausible <10/>100 → 'Not specified'), so the report now breaks down by sex, education, AND age. Both matrices `GROUP BY (sex, education, age_group)`; the service margins all three. Do NOT fabricate demographics — everything is real or 'Not specified'.
- **AI compatibility scoring is REQUIREMENT-ONLY, and certificates are DE-SCORED (§40, 2026-08-25).** The score reflects ONLY the employer's STATED Requirements & Qualifications (education/experience/gender/skills/qualifications): a stated-but-unmet requirement lowers it; an UNSTATED dimension neither helps nor hurts — both directions are now explicit in `buildScoringPrompt` ("don't lower for unstated" + its symmetric twin "**do NOT raise for unrequested résumé content**"). Do NOT re-add certificate FILES as a scoring input: the Phase 2D-C cert-scoring path (`getCertificateContext`, the worker `extraContext`, the apply-time cert re-score trigger) was REMOVED — certificates are stored + admin-viewable EVIDENCE ONLY. The prompt's "certs are supporting evidence, NOT mandatory" rule STAYS (it governs certs written INSIDE the résumé, still scored via `parsed_text`). Bump `SCORING_PROMPT_VERSION` on ANY prompt change and RE-RUN `npm run eval:scoring -- --variant=requirement-strict` (the shipped-prompt mirror) BEFORE shipping — that discipline caught the REJECTED "strengths-in-summary" idea (it inflated scores). Do NOT fold a "note unrequested strengths" instruction into the scoring prompt; a strengths callout, if ever wanted, is a SEPARATE non-scoring field (deferred).
- **File uploads route through `services/storageService.js` — never write a NEW upload to local disk (§41).** The env-driven `STORAGE_DRIVER` (`local` default | `r2`) picks the backend; job featured images now use it (dev → `uploads/`, prod → Cloudflare R2). This AMENDS invariant 0.5 for job images (durable home = object storage, DB holds the reference). **Event banners now ALSO use R2 (§45.6, owner-approved 2026-09) — the ONE public-marketing binary migrated off base64.** New event banners are uploaded to R2 by `services/eventBannerStorage.persistBannerRef` (via `eventRoutes` create/update) in prod, and the existing ones migrate via `scripts/migrate-event-banners-to-r2.js` (migration 048 archives the original base64 to `peso_events.banner_image_legacy` for rollback first). base64-in-DB REMAINS the rule for the PII/document binaries — **résumés, referral letters (0.13), certificates, avatars STAY base64-in-DB** (owner decision — they already work in prod; a PII move is the proposal's deferred private-bucket + presigned-URL phase). Frontend renders any banner via the shared `resolveBannerSrc` (data:/http passthrough, else FILE_BASE) so base64 and R2 URLs both work during/after the migration. R2 config is EXCLUSIVELY env (`R2_*`), never in code, never sent to the frontend (the browser only sees the resulting public URL). Job images use a PUBLIC bucket; a future PII migration uses a PRIVATE bucket + presigned URLs. Validation/MIME/size limits stay at the ROUTE (multer memoryStorage), never in the service. Activation is env-only on Render (`docs/cloudflare-r2-setup.md`); ship-dark (unset ⇒ `local` ⇒ unchanged). **LEGACY DEAD IMAGES (traced 2026-09):** job featured images uploaded BEFORE R2 were stored as `/uploads/<key>` paths on Render's EPHEMERAL disk → the files were wiped on deploy, so those refs 404 (23 job posts; event banners were migrated, so 0). This is NOT an R2 fault — R2 is reachable and new/replacement uploads work (verified `pub-…r2.dev` returns 200). The images are UNRECOVERABLE (nothing on disk to migrate); a PESO admin re-uploading restores it (→ R2). Fixes: `jobs/JobCard.jsx`, the LandingPage job cards/detail, AND the `PesoAdminDashboard` cards now fall back to the branded placeholder on `<img onError>` (layer placeholder behind, image hides itself if it 404s) — never a broken-image icon; and owner-run `scripts/nullify-dead-local-images.js` (`--dry-run`) NULLs the dead `/uploads` refs (never touches `data:`/`http(s)` refs, deletes nothing). If NEW prod uploads ever break, check Render `STORAGE_DRIVER=r2` + the `R2_*` creds are intact (esp. after an R2 token rotation).
- **A job edit arms scoring/matching workers ONLY when a scoring-relevant field actually changed (§42.2).** `PUT /peso-admin/jobs/:id` snapshots the prior row and compares the `buildScoringPrompt` inputs — `{title, company, description, skills, qualifications, education, experience, gender}`. `applicationScoringService.enqueueForJob` fires ONLY on `scoringChanged`; `jobAlertsService`/`proactiveReferralService.enqueueForJob` ONLY on `nowPublished && (scoringChanged || becamePublished)`. A **media-only edit** (`featured_image` lives on its OWN `POST /jobs/:id/image` endpoint and is NEVER in this PUT's UPDATE) or non-scoring metadata (location/salary/deadline/positions/work_setup/category/department/accommodations) arms NOTHING — because the frontend job-edit form always re-sends the FULL form via PUT on save, an unconditional enqueue re-armed every pipeline on a mere image swap. This is the ENQUEUE-time twin of the §29 input-hash guard (which guards the AI call at EXECUTION). Same handler = same rule for PESO Admin AND PESO Staff (`req.effectiveOwnerId`); Super Admin has no job-field-edit enqueue. Do NOT re-add an unconditional `enqueueForJob` on the edit path, and do NOT add `featured_image`/metadata to the scoring set. The create path (`POST /jobs`) is unchanged.
- **Applying requires a COMPLETE profile + a résumé, enforced server-side (§43).** `services/onboardingService.evaluate(userId)` DERIVES `{profileComplete,hasResume,canApply}` from the `users` columns (`name,phone,location,gender,dob,educational_attainment`) + `uploaded_resumes.parsed_text` — NO new column/flag, so it can't be bypassed by refresh/logout and covers new AND walk-in accounts identically. `POST /applications` refuses a definitive `!canApply` with **403 `PROFILE_INCOMPLETE`** BEFORE any insert (fails OPEN on a DB `error` so a blip never blocks a legit apply); `GET /profile/onboarding` is the status read. Do NOT weaken this to a frontend-only step, and do NOT introduce a separate onboarding flag/table (the derived-from-DB state is the design). The onboarding UI (`components/onboarding/OnboardingModal.jsx`, mounted in `AppLayout`) reuses the existing `PUT /profile` with a FULL prefilled payload — never a partial patch (PUT does a full UPDATE SET; a partial body would null a walk-in's existing skills/preferences). Résumé is optional to FINISH onboarding but required to APPLY (`profileComplete` ≠ `canApply`). The required-field set must stay in sync between `onboardingService.REQUIRED_PROFILE_FIELDS` and `OnboardingModal`'s `REQUIRED`. The modal ALSO collects OPTIONAL fields in a separate "About you" step (§43.6 — languages/skills + work preferences), all via the same `PUT /profile`; do NOT make those required (only the 6 identity fields gate) and do NOT add parallel columns — they reuse the existing profile columns and mirror the Identity & Profile inputs.
- **The PESO Admin dashboard CSV export MUST stay at parity with the dashboard (§44).** Both `/peso-admin/analytics/overview` (JSON) and `/peso-admin/analytics/export` (CSV) read ONE `computeOverview(adminId, windowMonths)` — never a second copy of the SQL — so the export can't drift. The export carries every displayed reportable metric (6 KPIs incl. Registered Job Seekers + Active Local Employers, both status distributions, the 3 pending-action counts, and the monthly trend for the `?months=` window the frontend passes) and excludes only the transient recent-activity feed. When you add a dashboard panel, add it to `computeOverview` (both surfaces get it) — do NOT re-query in the export handler. The ATS (`/ats/applicants/export`, filter-aware full dataset), referral-row (`/referrals/reports/export`, date-range-aware) and DOLE accomplishment exports are already complete + backend-query-driven (not paginated) — don't touch them for export work. General export rule: an export retrieves the COMPLETE authorized dataset from the backend (owner-scoped/RBAC), respects the module's active filters/date-range, and never exports only the visible page.
