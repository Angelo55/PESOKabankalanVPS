# PESO Kabankalan Employment System

A government employment platform for the **Public Employment Service Office
(PESO) of Kabankalan City, Negros Occidental**.

It connects job seekers with local vacancies, scores applicant↔job compatibility
with AI, and automates the generation and email delivery of **official PESO
referral letters** under human approval — then tracks whether each referral
actually resulted in a hire.

> **Naming note.** The repository is `PESO-Kabankalan`. The backend folder is
> still `job-tracker-backend` for historical reasons: the project began as a
> generic job tracker and was progressively refactored into the PESO domain. That
> folder name is kept because renaming it would break deployment configuration for
> no user-visible gain.

> **Deployed (2026-08-02).** Frontend on **Vercel** (`peso-kabankalan.vercel.app`),
> backend on **Render** (`peso-kabankalan-backend.onrender.com`), one TiDB Serverless
> DB. Cross-origin wiring (CORS, socket, OAuth) and email transport are **env-driven**
> — see `docs/session-continuation-2026-08-02.md` and `SKILL.md` §19 for the full
> deployment + env-var reference.

---

## Table of contents

- [What it does](#what-it-does)
- [User roles](#user-roles)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Core modules](#core-modules)
- [AI-powered features](#ai-powered-features)
- [Integrations](#integrations)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Database migrations](#database-migrations)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Operational scripts](#operational-scripts)
- [Screenshots](#screenshots)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## What it does

| | |
|---|---|
| **Public job board** | Browse PESO vacancies without an account. Filled postings stay visible with an honest label instead of vanishing. |
| **Verified registration** | Email ownership is proven by a time-limited OTP before an account is created. |
| **AI resume analysis** | Uploads are parsed, career history extracted, and a Unified Profile plus career insights generated. |
| **AI compatibility scoring** | Each application is scored against the vacancy. The score is a ranking aid for administrators, never an automatic decision. |
| **Applicant Tracking System** | PESO administrators work applicants through a pipeline, per vacancy. |
| **Referral automation** | Approved referrals generate an official letter on PESO letterhead, emailed to the job seeker, with the whole lifecycle recorded. |
| **Placement outcomes** | Administrators record what actually happened — hired, not hired, no response — which is what the platform's success figures are computed from. |
| **Reporting** | Monthly counts, applicant lists and placement rates, exportable as CSV for DOLE reporting. |
| **Platform governance** | A Super Administrator manages accounts, roles, moderation, system settings and platform health, with a full audit trail. |

---

## User roles

The system has **three** roles.

| Role | Stored value | Portal | What they do |
|---|---|---|---|
| **Job Seeker** | `applicant` | `AppLayout` | Browse and apply, build documents, track applications, chat, receive referrals |
| **PESO Administrator** | `peso_administrator` | `AppLayout` | Post vacancies, work the ATS, approve referrals, record outcomes |
| **Super Administrator** | `admin` | `SuperAdminLayout` | Accounts and roles, moderation, audit trail, settings, platform health |

### "Employer" is not a fourth role

The word *Employer* appears in three places, and in all of them it means
**PESO Administrator**:

- `ROLE_ALIASES.employer → PESO_ADMINISTRATOR` in `middleware/rbac.js`, so older
  rows and tokens keep working
- the `/api/employer` API alias, kept for older clients
- `/employer/*` frontend redirects

There is no separate employer account type and no employer self-service portal.
Vacancies are posted **by PESO staff on behalf of** local employers, which is how
a Public Employment Service Office actually operates — the office is the
intermediary, and employers report hires back to it by email. What is sometimes
called the "employer recruitment workflow" is the PESO Administrator workflow
described under [Core modules](#core-modules).

> **Never compare `user.role` to a raw string.** Always `normalizeRole()` first.
> Testing against `'employer'` silently matches nothing, because the stored value
> is `peso_administrator`. This has caused real, shipped bugs.

---

## Architecture

```
Browser — React 19 + Vite
   │  axios (single instance, attaches the JWT)
   │  socket.io-client (ONE connection, owned by ChatContext)
   ▼
Express API — server.js mounts every router under /api
   │
   ├── routes/        HTTP only: parse, authorize, respond
   ├── services/      business rules and transaction boundaries
   ├── repositories/  SQL
   │
   ├── referralWorker.js   in-process background worker, polls ~5s
   └── socketServer.js     realtime chat + notification push
   ▼
TiDB (MySQL-compatible) via a mysql2 pool
   │
   └── Make.com — downstream consumer only, never an orchestrator
       (via AUTOMATION_WEBHOOK_URL; replaced the retired self-hosted n8n, 2026-09)
```

**Layering rule.** Routes never contain SQL. Services never write HTTP responses.

### Design principles

1. **Never fail the primary action for a secondary concern.** An applicant can
   apply even if the AI, email, notifications and the snapshot write all fail.
2. **The AI returns a real result or `NULL` — never a guess.** `NULL` means "not
   scored" and routes to manual review.
3. **The database is the job store.** No workflow state in memory or in an
   external orchestrator. Background work uses a transactional outbox, so once an
   action commits, its follow-up is guaranteed to be attempted.
4. **A human approves every referral.** The letter carries a government
   signature.
5. **Durable binaries live in the database as base64.** The hosting filesystem is
   ephemeral.
6. **Ownership is checked on every endpoint.** Authentication is not
   authorization; frontend route guards are UX only.

---

## Technology stack

### Frontend
- **React 19** + **Vite** + **React Router**
- **Tailwind CSS**, `lucide-react`
- **`@dicebear/core` + `@dicebear/collection`** — generated avatars
  *(the package is `collection`, not `@dicebear/styles`)*
- `axios` (the only HTTP client), `socket.io-client`
- `recharts` / `apexcharts` / `chart.js` for dashboards, `framer-motion`

### Backend
- **Node.js + Express**
- `socket.io` (realtime), `multer` (memory storage), `jsonwebtoken` + `bcryptjs`
- **`pdfkit`** — referral letters rendered in-process, no third-party PDF service
- `nodemailer` — Gmail SMTP
- `pdf-parse` **v2** — accessed *only* through `services/pdfTextService.js`,
  which bridges the v1 and v2 APIs

### Database
- **TiDB** (MySQL wire-compatible) via a `mysql2` pool

> TiDB is **not** MySQL. It has no `SKIP LOCKED` (the worker uses conditional
> atomic `UPDATE`s instead), and enum values may only be **appended** —
> reordering or removing rewrites the column and is unsafe on a live table.

### Hosting
- **Render** — note the **ephemeral filesystem**, which is why durable artifacts
  live in the database rather than on disk.

---

## Core modules

### Registration & authentication
Two-step signup: the form stages a pending registration and emails a 6-digit
code; **no account row is created until the code is verified**. Codes come from
`crypto.randomInt`, are stored as peppered SHA-256, expire in 10 minutes, and are
rate-limited per address *and* per IP. Google sign-in skips the OTP because
Google has already proven the address. Existing accounts are never asked to
verify.

### Profile & avatars
Every user always has a picture. Resolution is `avatar_thumb` → `avatar_url` → a
deterministic **DiceBear "micah"** avatar generated from the user id. Users may
upload a photo or pick from a gallery; a chosen avatar is stored through the same
endpoint an upload uses, so nothing downstream can tell them apart.

### Public job board & Apply Wizard
Vacancies are browsable without an account. A three-step wizard (Personal Info →
Resume → Additional Questions) submits an application, which triggers a resume
snapshot, text extraction, AI scoring, referral staging and an administrator
notification — each independently failure-tolerant.

### Applicant Tracking System — the recruitment workflow
Per vacancy, a PESO Administrator:

1. **Posts a vacancy** — title, description, skills, qualifications,
   `positions_available`, screening questions, featured image
2. **Reviews applicants** — AI match score, the exact resume submitted, profile
3. **Moves them through the pipeline** — status changes notify the applicant
4. **Messages** the applicant directly
5. **Approves a referral** — enforced against the vacancy cap
6. **Records the outcome** once the employer reports back

### Referral management
The largest subsystem.

- **Approval** writes four rows in one transaction and arms an outbox job. The
  vacancy cap is enforced under `SELECT … FOR UPDATE`, so two administrators
  cannot both consume the last position.
- **The worker** advances one step per commit:
  `generate_pdf → send_email → notify → dispatch_n8n → done`, with exponential
  backoff and dead-lettering after 5 attempts. (`dispatch_n8n` is the persisted
  step name for the Make.com automation dispatch — kept unchanged after the n8n→Make
  cutover so in-flight rows and history stay valid, §59/§70.)
- **Letters** are stored in the database as base64 and served through an
  authenticated route — never from a public directory, because a referral names
  a citizen and the employer they were endorsed to.
- **Outcomes** (`Issued → Employer Acknowledged → Interview Scheduled → Hired /
  Not Hired / Withdrawn / No Response`) are recorded by an administrator, because
  employers report hires by email to the office.
- **Cancellation** voids a referral with a mandatory reason, releases the vacancy
  slot and reopens the posting — while keeping the record.
- **Reports** produce monthly counts, applicant lists and placement rates, with
  CSV export.
- **Audit trail** records every event with actor and timestamp, visible to the
  job seeker as well as to staff.

### Notifications & messaging
A bell backed by a database table, written through a single service that writes
the row first and pushes over socket.io second, and never throws into the caller.
Applicant↔administrator chat shares that one socket connection.

### Super Administrator portal
Platform metrics, account management, **guarded role administration**, job
moderation, a searchable **audit trail**, **system settings** changeable without
a redeploy, and **platform health** (database latency, mail and AI configuration,
referral-worker state, letters not yet stored durably).

---

## AI-powered features

| Feature | What the AI does | If it is unavailable |
|---|---|---|
| **Resume analysis** | Parses an uploaded resume into structured career history and skills | The upload still succeeds; insights are simply absent |
| **Career insights** | Generates guidance from the parsed profile | Panel is hidden; not an error state |
| **Compatibility scoring** | Scores applicant↔vacancy across skills, education and experience | Score is `NULL`; the application still succeeds and routes to manual review |
| **Document builders** | Improves resume, cover-letter and resignation drafts | The builder still works; the improve step is skipped |
| **Translation** | DeepL, inside the builders and chatbot | Original text is kept |
| **Site chatbot** | Answers questions about the platform | Widget reports it is unavailable |

**Every AI surface has a defined degraded state.** A fabricated score would be
worse than no score, because it silently misroutes a real person's application.

---

## Integrations

| Service | Used for | Failure behaviour |
|---|---|---|
| **OpenRouter → `deepseek/deepseek-chat`** | Resume parsing, scoring, builders, chatbot | Logged skip, `NULL` result |
| **DeepSeek API (direct)** | Some legacy routes | Same |
| **DeepL** | Translation in builders and chatbot | Original text kept |
| **Gmail SMTP** (`nodemailer`) | OTP codes, referral letters, password resets, security alerts | Referral mail retries with backoff then dead-letters. **OTP is the one exception** — an undelivered code cannot be entered, so it surfaces as an error |
| **Google OAuth** | Sign-in | Password sign-in unaffected |
| **Make.com** (hosted; `AUTOMATION_WEBHOOK_URL`) | Downstream logging and employer notification. Replaced the retired self-hosted n8n (2026-09) | **Cannot affect a referral.** It is the last step; the letter is already generated, sent and notified. Referrals that never reach it are surfaced as an advisory |

> GitHub OAuth was removed. PDFMonkey and Coresignal are superseded — do not
> build on them.

---

## Getting started

### Prerequisites
- **Node.js 18+** and npm
- Access to a **TiDB** (or MySQL 8) database
- A Gmail account with an **app password** for SMTP
- *(optional)* A **Make.com** scenario for downstream referral automation (see
  `docs/make-com-migration-guide.md`); unset = the dispatch step is a no-op success

### Install

```bash
git clone https://github.com/Angelo55/PESO-Kabankalan.git
```

```bash
cd PESO-Kabankalan && npm install
```

```bash
cd job-tracker-frontend && npm install
```

### Configure

Create `.env` in the repository root — see
[Environment configuration](#environment-configuration).

### Apply migrations

```bash
npm run migrate
```

> The runner prints its target host on startup. **Read that line** — it is
> usually production.

### Run

```bash
npm run dev
```

```bash
cd job-tracker-frontend && npm run dev
```

| Service | Port |
|---|---|
| Backend (nodemon) | **5000** |
| Frontend (Vite dev) | **5173** |
| Frontend preview | **4300** |

> Preview is **4300**, not Vite's default 4173, which falls inside a Windows
> reserved port range.

### Required asset

`assets/letterhead/letterhead.png` must be present — the official PESO
letterhead, header and footer with a **blank middle**. If it is missing, letters
silently fall back to a text-only header. A correct letter is ~397KB; a fallback
is ~2.9KB, so file size is the tell.

---

## Environment configuration

| Variable | Required | Purpose |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SSL` | **Yes** | TiDB connection |
| `JWT_SECRET` | **Yes** | Signs session tokens; also peppers OTP hashes |
| `EMAIL_USER` | **Yes** | Gmail address for outbound mail |
| `EMAIL_APP_PASSWORD` *or* `EMAIL_PASS` | **Yes** | Gmail app password — either name works |
| `OPENROUTER_API_KEY` | Recommended | AI gateway |
| `DEEPSEEK_API_KEY` | Optional | Direct DeepSeek, used by some routes |
| `DEEPL_API_KEY` | Optional | Translation |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Optional | Google sign-in |
| `FRONTEND_URL` | Optional | Links in outbound email |
| `REFERRAL_AI_THRESHOLD` | Optional | Score needed to stage a referral (default 60) |
| `REFERRAL_WORKER_ENABLED` / `_INTERVAL_MS` / `_BATCH_SIZE` / `_STALE_SECONDS` | Optional | Worker tuning |
| `OTP_TTL_MINUTES` / `OTP_RESEND_COOLDOWN_SECONDS` / `OTP_MAX_SENDS` / `OTP_MAX_ATTEMPTS` | Optional | Signup verification |
| `ALLOWED_SIGNUP_EMAIL_DOMAINS` | Optional | Comma-separated allow-list; blank = any |
| `PESO_SIGNATORY_NAME` / `_TITLE` / `_ROLE` | Optional | Printed on every referral letter |
| `AUTOMATION_WEBHOOK_URL` | Optional | Make.com automation webhook. Unset = the dispatch step is a no-op success. (`AUTOMATION_DISPATCH_TIMEOUT_MS` optional, default 15000. The old `N8N_WEBHOOK_URL` / `N8N_DISPATCH_TIMEOUT_MS` were removed after the 2026-09 cutover, §70.) |

### Settings that moved to the database

`REFERRAL_AI_THRESHOLD`, `OTP_TTL_MINUTES` and `ALLOWED_SIGNUP_EMAIL_DOMAINS` are
now **system settings** a Super Administrator can edit without a redeploy.
Resolution order is **database row → environment variable → hardcoded default**,
so an unset override changes nothing and deleting one restores the previous
behaviour.

> `.env` is gitignored, but **it exists in this repository's git history**. The
> repo is private. **Rotate every secret before it is ever made public.**

---

## Database migrations

Numbered SQL files in `migrations/`, applied in order and tracked in
`schema_migrations`.

```bash
npm run migrate
```

| # | Adds |
|---|---|
| 000–018 | Baseline schema, referral module, role normalization, job-board extras, preferences, soft-delete |
| 019 | `avatar_thumb`, `verification_id_type` |
| 020 | `email_verifications`, `users.email_verified_at` — OTP signup |
| 021 | `referral_letter_files` — durable base64 letters |
| 022 | `referral_letter_archive` — regeneration history |
| 023 | `referral_outcomes` — placement tracking |
| 024 | `referral_queue.status += 'Voided'` + void columns |
| 025 | `system_settings` |

### Rules
- **Migrations own the schema.** New DDL never goes in `initDB()`.
- **Enum values are append-only.** Writing a value the enum lacks raises
  `WARN_DATA_TRUNCATED` and rolls back the *enclosing transaction* — this has
  already caused a production 500.
- **`CREATE TABLE IF NOT EXISTS` silently skips a table that already exists with
  a different shape.** Verify against `INFORMATION_SCHEMA`.
- **Never test a write path against production.**

---

## Project structure

```
.
├── server.js                   # bootstrap, route mounting, socket.io, worker
├── db.js                       # TiDB pool
├── middleware/                 # authMiddleware (JWT), rbac.js (roles)
├── routes/                     # one router per domain — HTTP only
├── services/                   # business rules and transactions
│   ├── referralService.js      #   approval, void, outcomes, reports
│   ├── referralWorker.js       #   the background delivery worker
│   ├── otpService.js           #   signup verification
│   ├── aiScoringService.js     #   compatibility scoring
│   ├── notificationService.js  #   the ONLY notification writer
│   ├── adminAuditService.js    #   the ONLY audit writer
│   ├── roleAdminService.js     #   guarded role changes
│   └── systemSettingsService.js
├── repositories/               # all referral SQL
├── migrations/                 # numbered, applied in order
├── scripts/                    # migrate + operational one-offs
├── assets/letterhead/          # official artwork — MUST stay tracked
├── docs/                       # user manual, system guide, referral review
└── job-tracker-frontend/
    └── src/
        ├── api.js              # the ONLY axios instance
        ├── App.jsx             # routes + AppLayout
        ├── components/
        │   ├── common/Avatar.jsx   # the ONLY component rendering a face
        │   └── layout/TopHeader.jsx
        ├── superadmin/         # Super Admin subsystem, feature-based
        │   └── features/{overview,accounts,moderation,reports,
        │                  settings,audit,health,automation,email}/
        ├── context/            # Auth, Notification, Chat
        └── utils/              # avatar.js, roles.js
```

---

## Development workflow

1. **Branch** — `git checkout -b feature/<name>` from `main`
2. **Read the architecture reference** —
   `.claude/skills/peso-kabankalan-ai-system-architect/SKILL.md`. It records the
   invariants and the incidents behind them.
3. **Build** in the right layer: routes → services → repositories.
4. **Migrate** if you touched schema — numbered file, append-only enums.
5. **Verify**
   ```bash
   npm run build --prefix job-tracker-frontend
   ```
   ```bash
   node --check <changed-backend-file>
   ```
6. **Commit** with a message explaining *why*, not just what.
7. **Push and open a pull request.**

### Before you ship

- Does an AI, email or notification failure still let the primary action succeed?
- Is the endpoint owner-scoped, not just role-guarded?
- Does every new UI surface have a defined empty and degraded state?
- Did you compare a role to a raw string anywhere? Use `normalizeRole()`.
- Are you *writing* a role or enum value? Validate the **raw input** —
  `normalizeRole()` maps anything unknown to Job Seeker rather than rejecting it.

---

## Operational scripts

```bash
node scripts/backfill-referral-letters.js --dry-run
```
Imports letters that exist only on the ephemeral filesystem into the database.
Re-runnable; skips files under 1KB as likely corrupt.

```bash
node scripts/regenerate-referral-letters.js --stale --dry-run
```
Rebuilds letters, **archiving the superseded copy first**. Keeps the original
approval date and **sends nothing** — regeneration repairs the system's record,
not the recipient's copy.

Both support `--dry-run`. Use it first.

---

## Screenshots

Place images in `docs/screenshots/` using these filenames. See
[`docs/screenshots/README.md`](docs/screenshots/README.md) for the capture guide.

| File | Shows |
|---|---|
| `01-landing.png` | Landing page with live platform statistics |
| `02-registration-otp.png` | Two-step signup with the OTP screen |
| `03-job-board.png` | Public job board with AI compatibility |
| `04-apply-wizard.png` | The three-step Apply Wizard |
| `05-seeker-dashboard.png` | Job Seeker dashboard with AI career insights |
| `06-profile-avatars.png` | Profile & Identity with the avatar gallery |
| `07-ats.png` | Applicant Pipeline with match scores |
| `08-referral-register.png` | Referral register with delivery and outcome |
| `09-referral-letter.png` | A generated letter on official letterhead |
| `10-referral-reports.png` | Reports and CSV export |
| `11-audit-trail.png` | Referral activity timeline |
| `12-superadmin-overview.png` | Platform overview |
| `13-superadmin-settings.png` | System settings and platform health |
| `14-messages.png` | Messages Hub |

> **Redact before committing.** Screenshots of the ATS, referral register and
> account matrix contain real citizens' names, email addresses and home
> addresses. Blur them, or capture with test data.

---

## Documentation

| Document | Audience |
|---|---|
| **This README** | Developers and evaluators — setup, architecture, workflow |
| [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) | **End users** — step-by-step per role, FAQs, troubleshooting |
| [`docs/system-guide.md`](docs/system-guide.md) | Technical reference for the proposal and defence — what/how/when/why per subsystem |
| [`docs/referral-management-enhancement.md`](docs/referral-management-enhancement.md) | The referral review, findings and remaining roadmap |
| `.claude/skills/peso-kabankalan-ai-system-architect/SKILL.md` | The architecture contract — invariants and the incidents behind them |

Most modules also carry a file-header comment explaining what they do, when they
run, and which past defect shaped them.

---

## Contributing

1. **Read `SKILL.md` first.** The invariants are not style preferences — each was
   written after a production defect.
2. **Keep the layering.** SQL in a route file is a review-blocking smell.
3. **One writer per concern.** Notifications go through `notificationService`,
   audit entries through `adminAuditService`, faces through `Avatar`, HTTP
   through `src/api.js`. Do not add a second path.
4. **Degrade, don't fail.** Wrap secondary work so the primary action survives.
5. **Explain *why* in comments**, especially where a choice looks strange — it is
   usually strange because something broke.
6. **Never run a write path against production** while testing. Test the pure
   function, or wrap it in a rolled-back transaction.

### Known gaps

Documented honestly in `docs/referral-management-enhancement.md` and §14 of
`SKILL.md`. In brief: Job Seeker Verification was **decommissioned (2026-08-01)**
by product decision — do not reintroduce it (the referral-letter ID-type field is
separate and stays); list pagination is not implemented (fine at current volume); the
AI-Recommended queue mediates only ~4% of referrals and needs score-distribution
data before its threshold is tuned; and no letter retention policy is set.

---

## License & ownership

Built for the **Public Employment Service Office, City Government of Kabankalan,
Negros Occidental**, in compliance with DOLE guidelines under Republic Act
No. 8759 and Republic Act No. 10691.
