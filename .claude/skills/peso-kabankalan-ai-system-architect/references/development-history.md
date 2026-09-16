# PESO Kabankalan — Development History (phase records §17–§26)

REFERENCE companion to `SKILL.md`, split out 2026-08-05 to keep the always-loaded SKILL.md
body lean. `SKILL.md` §0–§16 remain the core architecture reference (invariants, workflows,
conventions, migrations, pre-flight); THIS file holds the dated, phase-by-phase development
records. **Section numbers (§17–§26) are UNCHANGED**, so every `(§NN)` cross-reference in the
codebase and other docs still resolves here.

**Load this file** when you need a phase's detail, a commit hash, or a subsystem's history —
or when SKILL.md's "Development history" pointer sends you here. For the live invariants, the
core body (§0/§12/§16) stays authoritative; the still-live rules embedded below are also
surfaced in SKILL.md's pointer so they are never lost from the always-loaded context.

## Contents
- **§17** Resilience hardening + admin/landing/UX (2026-07-28)
- **§18** Part 3 + Phase 2C + Phase 2D (2026-08-01) — §18.1 six-worker roster, §18.5 dynamic re-scoring, §18.9 hybrid polling
- **§19** Real-time pipeline + production deploy + HTTP email (2026-08-02)
- **§20** Proactive AI Referral Workflow (2026-08-02)
- **§21** AI compatibility scoring — Tier-1 recalibration + eval harness (2026-08-02)
- **§22** Performance hardening — P0/P1 (2026-08-02)
- **§23** Saved Vacancies bookmark-manager refactor (2026-08-02)
- **§24** Theme system — design tokens (2026-08-03); §24.1 interaction-state review gate
- **§25** Infrastructure Optimization roadmap (2026-08-04, deferred but approved)
- **§26** Referral Lifecycle Synchronization + real-time hardening + R1 redesign (2026-08-05)
- **§27** "Building with Good UX" — Empty States design system + unified Search Dropdown (2026-08-07)
- **§28** Job Seeker application-lifecycle consolidation — one "My Applications" over a unified feed (2026-08-07)
- **§29** AI re-scoring change-detection input-hash guard (both scoring workers, ship-dark) (2026-08-08)
- **§30** Unified Document Builder platform — SHIPPED (react-pdf preview/export, DOCX, template gallery) + cover-letter draft & resignation-AI fixes (2026-08-08)
- **§31** Office-interview requirements — Phases 1–6 + Positions-Not-Specified: PESO Staff RBAC, Events subsystem, referral acceptance + vacancy de-automation, walk-in registration, SMS proposal, settings-flag fix + D6 (2026-08-23)
- **§32** Office-interview FOLLOW-UPS — SMS channel (built, provider-agnostic, production Semaphore DEFERRED/unfunded; console dev provider), Walk-In account CLAIM (migration 045), sidebar navigation refactor, Identity-Verification-ID removal (2026-08-23)
- **§33** Refinement pass — server-side account-suspension enforcement (migration 046), Smart-Referral-Queue vacancy grouping, delivery-log pagination, Events skeleton, sidebar-tooltip fix, TopHeader welcome illustration + Landing 5-slide Streamline Tokyo carousel (Chatbot icon reverted) (2026-08-23)
- **§34** Landing Page PESO Events & Job Fairs carousel (2026-08-24)
- **§35** Root-to-top AUDIT + first improvement increment — F1 AI-score provenance, F2 rationale, B1, D1, C1 focus-trap, A2, G3 (2026-08-24)
- **§36** G3 deep-dive — decline notifications, 'Not Referred' state, board-vs-committed score-divergence trace (2026-08-24/25)
- **§37** Audit E3 — hot-path EXPLAIN + index pass (verified clean, no code change) (2026-08-25)
- **§38** Audit C2 — Events-carousel scroll affordance (AUDIT COMPLETE) (2026-08-25)
- **§39** DOLE PESO Accomplishment Report — aggregate + demographic PDF/CSV; §39.5 age-group (Phase B) (2026-08-25)
- **§40** Certificate-scoring removal + requirement-only scoring rule + ProactiveWorker summary log (2026-08-25)
- **§41** Centralized environment-aware storage + Cloudflare R2 for job images (2026-09)
- **§42** UI skeleton alignment (shared compact-card skeletons) + job-update worker-trigger precision (2026-09)
- **§43** Post-registration onboarding + account-completion gate; §43.6 optional "About you" step (2026-09)
- **§44** PESO Admin export audit + dashboard-CSV parity fix (shared computeOverview) (2026-09)
- **§45** Landing Events single-event carousel (supersedes §34/§38 shelf) + PHP currency centralization (2026-09); §45.4 banner quality + stat "+" removal; §45.5 true infinite-loop carousel; §45.6 event banner base64→R2 migration (owner-run, verified)
- **§46** Landing content-integrity cleanup — testimonials removed, FAQ + Visit Us consolidated, redundant Contact Us form + dead backend route removed (2026-09); CTA moved into the FAQ column to bottom-align with the office card + map
- **§47** Dashboard UX — top-header hover dropdowns (avatar + bell, capability-gated) + welcome-greeting relocated to a temporary once-per-session banner above "Dashboard Overview" (2026-09)
- **§48** Identity & Profile structural skeleton (`SkeletonProfile`) + AI Chatbot knowledge/UI alignment to current features (2026-09)
- **§49** Data-processing module refactor — Import Past Applications + Analyze My Resume (Phases A–D, 2026-09, HEAD `f426e74`, mig 049 applied); §49.5 integration-invariant verification: imported records write `usertrackedjobs` and flow through `GET /api/applications/unified` — no parallel application store
- **§50** Public Visitor-Support Chatbot on the Landing Page (Phases A–E, 2026-09, NO migration) — a SEPARATE unauthenticated assistant (`/api/public-assistant`) sharing the DeepSeek client via new `aiClient.chatRaw` tool-calling; public-safe tools (vacancies/events/office), server-derived navigation, IP rate limits, no chat persistence, landing-native `PublicChatbot.jsx`. The authenticated chatbot is untouched. **§50.1** app-wide Express `trust proxy` set (all limiters key per-visitor).
- **§51** Event edit — atomic banner Replace + `event_date` re-save normalization (2026-09, NO migration) — a banner edit no longer drops a still-published event off the Landing Page (event_date normalized to YYYY-MM-DD both sides); the Edit modal gains a proper "Change" (atomic replace) beside "Remove"; transaction-safe end to end; PESO Admin + Staff share one path.
- **§52** Chatbot UI unification (2026-09, frontend-only) — the public Landing assistant and the authenticated PESO Assistant now share a common frontend layer (`components/chat/`: `ChatLauncher`, `MessageBubble`, `TypingIndicator`, `chatMotion`), palette-parameterized by `variant`, so they feel like one product; they stay separate at the context/route/prompt/permission level. Public launcher is now the shared pill (was a circular FAB); animations synchronized.
- **§53** Landing Page Light/Dark toggle + bespoke dark palette (2026-09, frontend-only) — a `ThemeToggle` in the Landing header reuses the existing `ThemeContext` (state, persistence, animation), synced Landing↔app; a curated bespoke DARK palette (`dark:` variants, NOT app tokens — the §24 token-exclusion stands) was added across the Landing + public chatbot. **SUPERSEDES the §24/§45 "Landing is always-light" stance** — it now themes; still do NOT tokenize it.
- **§59** Automation: n8n → Make.com migration — proposal + Option 2 provider-neutral webhook (2026-09, `bed7af8`/`e24d55a`) — n8n is a SINGLE downstream webhook (referral `dispatch_n8n` → Sheet log + employer notify); the backend already has the retry/backoff/dead-letter/replay/degradation safeguards. Proposal (`docs/automation-and-backend-architecture-proposal.md`) + click-by-click Make build guide (`docs/make-com-migration-guide.md`, incl. a Data-Store idempotency guard, grounded in `My workflow 2.json`). Option 2 SHIPPED: dispatch reads provider-neutral **`AUTOMATION_WEBHOOK_URL`** (fallback `N8N_WEBHOOK_URL`) + UI relabel; internal `dispatch_n8n`/`N8N_DISPATCHED` identifiers KEPT (persisted). Backend proposal: keep the modular monolith on Free tier; extract the `WORKER_MODE` worker process only when profiled + paid.
- **§58** Remaining audit items — socket throttle, body-size, hardcoded-secret removal, panel a11y (2026-09, `64da8e6`) — the code-doable remainder of §56's deferred list: a per-socket `send_message` throttle + content cap (`socketServer.js`); removed the hardcoded `GOOGLE_CLIENT_SECRET` + socket `'fallback_secret_key'` fallbacks (env-only now); `express.json` `50mb`→`15mb` (`BODY_LIMIT`); vacancy panel `role=dialog`/`aria-modal`/Escape. Human/operational items (NPC registration, retention period, DPO sign-off, actual secret rotation) → `docs/compliance-and-security-runbook.md`.
- **§57** Standalone legal pages (`/privacy`·`/terms`·`/cookies`) + SPA deep-link fix (2026-09, `fa5d2f6`, frontend-only) — promoted the Landing Privacy/Terms modals to real routed/shareable/indexable pages backed by a shared `components/legal/legalContent.jsx` (ONE source; the modals + pages both render `<LegalSections>` so they can't drift, §56) via a self-contained `LegalPage.jsx` (public, dark-aware, Landing palette) + a new Cookie Policy. **Also added `vercel.json` SPA rewrite → fixed a LATENT prod bug: a hard hit/refresh on any deep route (`/reset-password` from reset emails, `/job-board`, …) returned a Vercel 404 (no fallback); now all resolve 200.** Verified live.
- **§56** System audit — abuse-protection + AI-cost rate limits + legal/privacy accuracy (2026-09, `4ffb377`) — verify-before-change pass. Existing controls (AI timeout/breaker, bounded workers, auth/builder limiters) verified + kept. Added `middleware/rateLimiters.js` (shared env-tunable `RL_*` factory: app-wide `/api` `globalLimiter` backstop + tight `aiLimiter`/`applyLimiter`/`writeLimiter` on the previously-unprotected AI-cost endpoints `/applications`, `/jobs/match`, `/profile/{upload,insights/generate,match,avatar}`, `/messages/conversations`), app-wide `helmet` (CSP off, `crossOriginResourcePolicy: cross-origin` for `/uploads`), a 60s frontend axios timeout, and Privacy Policy accuracy (removed the false "government ID documents" claim §48; disclosed real subprocessors + cookie notice). Report: `docs/system-audit-2026-09.md`.
- **§55** Job Seeker vacancy-detail side panel — hierarchy/scanability redesign (2026-09, `650abfc`, frontend-only) — the Public Job Board posted-vacancy slide-over (`PublicJobBoard.jsx` `selectedJob`, opened by double-clicking a `JobCard`) restructured around a scannable **key-facts strip** (Salary/Employment/Location/Positions/Deadline via new `DetailFact`) under the title, a status pill + posting age (`postedLabel`/`created_at`), consistent iconized section headings + tighter rhythm; removed the duplicated sidebar "Application Details" card. Layout only — AI scoring, apply/save/inquire, double-click open, filled logic untouched.
- **§54** UI/UX optimization pass (2026-09, `ccbfc5e`, no migration) — (A) the Landing "Events & Job Fairs" section rendered BLANK-but-clickable: root cause was the scroll-reveal `.reveal` stuck at `opacity:0` because the IntersectionObserver's deps omitted `events`, so the late-mounting carousel was never observed (a `jobs`-vs-`events` load race) — fixed by adding `events`/`loadingEvents` to the deps. (B) banner `onError` → gradient fallback so a broken image never blanks a card. (C) Landing now shows ALL published events, ordered upcoming-first→past (`listPublished` 'all' scope), relabeled from "Upcoming"; `scope='upcoming'` kept for the chatbot. (D) authenticated chatbot render parity — dropped full-page + stacked `backdrop-blur`, direct-scroll. (E) TopHeader "Profile" is role-aware (PESO Admin → `/peso-admin/profile` "Organization Profile").
- **§65** Landing search REMOVED + full-width category navigation (2026-09, frontend-only, no migration) — reverses §64: the keyword/location search bar is gone (Public Job Board owns keyword/advanced discovery), and `LandingCategorySelector` became a full-width `flex flex-wrap` (was a left-concentrated horizontal scroller). Flow: Board → Category Nav → Results Count → Filtered Jobs → View All Jobs. Same `useJobFilters` taxonomy; §63 scroll panel + reveal unchanged.
- **§66** Centralized quota & usage-indicator system (2026-09, `npm test` 218, no migration) — one config layer (`config/quotas.js`, single source of truth for every limit; four axes count/bytes/rate/processing) + server-authoritative usage (`services/usageService.js`, Trash-aware + rolling-24h + resilient) + two endpoints (`GET /api/usage`, `GET /api/peso-admin/usage`) + reflective UI (`hooks/useUsage`, `components/common/UsageMeter`/`UsagePanel`/`InlineUsageMeter`) on the seeker Account Settings tab, the PESO Admin overview card, and inline in the Import modal + Certificate Library + My Applications (Saved Vacancies removed in §67). Informational-only for uncapped resources (never newly blocks a primary action, 0.1); soft-warn storage meter. Enforcement (importService/certificatesRepository/messageRoutes) now sources its numbers from the catalogue.
- **§67** Three UI refinements (2026-09, frontend-only, no migration) — (1) the Saved Vacancies inline usage meter was REMOVED (only there; Certificate Library + My Applications + Import modal keep theirs); (2) the My Referrals `Referrals.jsx` `hydrating` skeleton was rebuilt to structurally mirror the loaded module — a toolbar skeleton (so the real toolbar no longer pops in) + a VIEW-AWARE body (list column-headers + `ReferralRow`-matching rows, or `ReferralTile`-matching grid cards) — eliminating layout shift; (3) the TopHeader avatar dropdown is positioned + sized RELATIVE TO THE PROFILE TRIGGER CONTAINER (`absolute right-0` + `min-w-full` so it's ≥ the trigger width and reads as attached; `w-max` only to fit the menu labels; `max-w` clamped to the viewport; name+email `w-0 min-w-full` so they truncate to the container-driven width and don't drive it) — owner revised the basis from "Full Name" to the container.
- **§68** Account Settings persistence audit + Full-Name fix + Google OAuth account linking (2026-09, **migrations 052 + 053**, `npm test` 227) — audited all 5 seeker settings sections; FIXED the Profile-Info Full-Name persistence bug (was a fake `setTimeout` success + uncontrolled input → now a controlled field + full-payload `PUT /profile` + success only after the 2xx + `updateUser` propagation); added server-side password min-length; rebuilt **Linked Accounts** into a real backend-authoritative Google **link/unlink** flow — `users.oauth_provider` (052, honest Connected state) + `google_sub`/`google_email` + UNIQUE index (053, duplicate protection); `link/start` (signed 10-min state) → same callback (link vs login by JWT-shaped state) → `settings?link=google&status=…`; safe unlink (refuses if no local password, never deletes the account); identity-only token handling; login now matches `google_sub`-first; `AuthContext.refreshUser()` re-pulls `/auth/me` so Connected is never a local flip. **Owner runs `npm run migrate`.**
- **§69** Admin account consolidation — one PESO Administrator + one Super Administrator (2026-09-14, DATA-only, no migration) — audit-first, backup-first, transactional. Reassigned live PESO ownership (jobs/conversations/messages) from legacy `applicant`-demoted accounts (16/17/25) to the sole PESO admin id 30002 (reassign-not-delete: those FKs cascade); consolidated the junk-named 2nd Super Admin id 18 `admin@hire.com` into the owner's own id 1 (reassigned its audit/settings/actor refs, then deleted). Preserved historical actor refs + id 17's seeker data; `peso_staff` 210002 kept. Scripts: `scripts/consolidate-peso-admin.js`, `cleanup-junk-org-profiles.js`, `consolidate-super-admin.js`.
- **§70** n8n retirement — Make.com is the sole automation provider (2026-09-14, `npm test` 227, no migration) — post-cutover audit + cleanup. Removed the `N8N_WEBHOOK_URL` / `N8N_DISPATCH_TIMEOUT_MS` env fallbacks from `referralWorker`/`referralService` (reads ONLY `AUTOMATION_*` now — no code path can reach the old n8n); relabelled user-facing strings + current-state docs (README/system-guide) to Make.com. KEPT the persisted identifiers (`dispatch_n8n` step + `N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED`/`N8N_REPLAY[_QUEUED]` actions — renaming orphans rows/history + breaks detection queries, §59). Equivalence (webhook → Sheets 7-col append → employer email, + idempotency guard) verified; retry/logging/failure all in the unchanged backend.
- **§71** Public Job Board category chips — full-width flex-wrap (2026-09-14, frontend-only, no migration) — `jobs/CategoryChips.jsx` swapped its left-clustering `grid-flow-col auto-cols-max w-max` + `overflow-x-auto` scroll track for a full-width `flex flex-wrap items-center gap-2.5`, so chips distribute across the whole module width (wrap on narrow screens, no scroll/clipping) instead of leaving dead space on the right of wide screens. `shrink-0` keeps natural chip size (distribute-by-wrap, not stretch); matches the Landing's `LandingCategorySelector` (§65). Retired the scroll-position contract (no track). Styling/filtering/`useJobFilters` wiring unchanged; UI addendum §8.1/§8.2 rewritten.
- **§72** Contextual sidebar navigation tooltips — ONE shared component (2026-09-15, frontend-only, no migration) — new `components/common/SidebarTooltip.jsx` shows a concise role-contextual description per nav item on hover/focus, across all sidebars. PORTAL + `position:fixed` (measured from the item rect) so it escapes the navs' `overflow-x-hidden` and is viewport-clamped; `pointer-events-none` (no flicker). Styled with the design-system elevated-surface tokens (`bg-raised`/`border-line`/`shadow-raised`/`rounded-xl`, `text-content`/`text-muted` — light+dark, not black) and the `dropdownMotion` language (fade + 6px slide, 200ms ease-out, appear+disappear); label `text-base` / description `text-sm`. Wired into `Sidebar.jsx` (Job Seeker / PESO Admin / PESO Staff / `employer` alias) + `SuperAdminSidebar.jsx` via a `desc` per item, replacing the old collapsed-only label tooltip; native `title` dropped, `aria-label` added on collapsed items. Nav logic/permissions/positioning/mobile unchanged.
- **§73** ChatContext Socket.IO lifecycle fix (2026-09-15, frontend-only, no migration) — fixed the authed socket erroring `ws://localhost:5000 … closed before the connection is established` + hardened the lifecycle. Causes: effect keyed on the whole `user` object (so §68's updateUser/refreshUser rebuilt the socket → churn/storm risk) + StrictMode disconnecting a websocket-FIRST socket mid-handshake. Fix: env-specific prod-safe URL (VITE_API_URL, never localhost in prod → falls back to `window.location.origin`); effect keyed on `[user?.id, user?.role]`; **polling-first + upgrade** (graceful WS fallback, no mid-handshake abort); controlled capped reconnection backoff (no manual loop → no 429 class); full listener teardown. `ChatContext` stays the ONLY `io()` caller; chat business logic unchanged.

---

## 17. Recent changes (2026-07-28) — resilience hardening + admin/landing/UX

Full narrative: `docs/resilience-hardening.md` (the continuation checkpoint).
Phase 2C blueprint (now implemented): `docs/phase-2c-email-outbox-plan.md`.

### Resilience & fault-tolerance (shipped: P0–P2c)
- **Email failover (P0)** — `services/mailService.js` sends via an ORDERED
  provider list (primary Gmail + optional `EMAIL_FALLBACK_*` SMTP — Brevo/SES/…),
  returning on the first success. `getMailHealth()` feeds the health page. Env:
  `EMAIL_FALLBACK_HOST/PORT/USER/PASS`, `EMAIL_FALLBACK_FROM`,
  `EMAIL_FALLBACK_SECURE`, `EMAIL_FROM`.
- **OTP de-fatalised (P0)** — see the §7.9 update: a mail outage no longer blocks
  registration; the staged signup is kept and `deliveryPending` is returned.
- **Unified AI client (P1)** — `services/aiClient.js` is now the ONLY place chat
  completions happen. Automatic OpenRouter↔DeepSeek failover (same `deepseek-chat`
  model), a per-provider circuit breaker, shared timeout, tiers (CHAT/DRAFT), an
  `extra` passthrough (e.g. `response_format`), and `getAiHealth()`. EVERY prior
  inline AI call — `aiScoringService`, `jobRoutes` (match/similar),
  `resume`/`profile`/`resignation`/`coverLetter`/`chatbot` Routes — now routes
  through it, keeping its primary via `prefer`. Env: `AI_TIMEOUT_MS`,
  `AI_BREAKER_THRESHOLD`, `AI_BREAKER_COOLDOWN_MS`.
- **PDFMonkey retired (P1)** — `services/letterPdfService.js` renders cover-letter
  & resignation PDFs with pdfkit (in-memory, streamed as a blob). See §14.
- **Platform Health page (P2a)** — `superadmin/features/health/PlatformHealth.jsx`
  at `/admin/health` (nav). Renders the `/admin/health` probe; that endpoint now
  also returns `ai: aiClient.getAiHealth()`.
- **Workflow Automation page (P2b)** — `superadmin/features/automation/
  WorkflowAutomation.jsx` at `/admin/automation`. Monitors n8n dispatch and
  REPLAYS undispatched referrals via `enqueueJob('dispatch_n8n')` (dispatch step
  ONLY — never re-sends the letter). Endpoints `GET /admin/automation`,
  `POST /admin/automation/replay` (audited `N8N_REPLAY`); service
  `referralService.getAutomationStatus/replayN8nDispatch`; repo
  `automationCounts/listUndispatchedAll/filterApprovedQueueIds`.
- **Generic email outbox (P2C)** — IMPLEMENTED, flag-gated by
  `EMAIL_OUTBOX_ENABLED` (migration `027` applied).
  The generic twin of the referral outbox: ALL attachment-less transactional email
  (password reset, contact, OTP, security alerts) enqueues into `email_outbox`
  (`repositories/emailOutboxRepository.js`) via `services/emailOutboxService.js`
  and is drained by `services/emailWorker.js` (single-step: send; claim = atomic
  conditional UPDATE, backoff in `next_run_at`, dead-letter, stuck-reclaim —
  mirrors `referralWorker`, started in `server.js`). Senders now go through
  `mailService` (P0 failover) whether inline (flag off) or queued (flag on); their
  private nodemailer transports are retired. OTP uses `sendImmediate` = enqueue +
  one inline attempt so it keeps its immediacy (blueprint §7). **Referral letters
  are OUT OF SCOPE and stay on their own `referral_jobs` outbox** — they carry a
  PDF attachment + a multi-step state machine; `email_outbox` has no attachments
  column. Admin surface: `GET /admin/email` + `POST /admin/email/resend` (audited
  `EMAIL_RESEND`), `/admin/health` gains `emailOutbox`,
  `superadmin/features/email/EmailDelivery.jsx` at `/admin/email` (nav + Platform
  Health card). Env: `EMAIL_OUTBOX_ENABLED` (master flag), `EMAIL_OUTBOX_POLL_MS`,
  `EMAIL_OUTBOX_BATCH_SIZE`, `EMAIL_OUTBOX_MAX_ATTEMPTS`, `EMAIL_OUTBOX_STUCK_MS`,
  optional `EMAIL_FROM_INBOX`. Rollback = `EMAIL_OUTBOX_ENABLED=false` + restart
  (no code deploy); the additive table stays.

### PESO Administrator dashboard & routing
- `/peso-admin/dashboard` is now the **operational dashboard**
  (`PesoAdminOverview.jsx`), backed by `GET /api/peso-admin/analytics/overview`
  (owner-scoped; "Successful Hires" = `referral_outcomes.outcome='Hired'`, never
  approvals). **Job management moved to `/peso-admin/jobs`** → "Job Publication
  Management" (`PesoAdminDashboard.jsx` — kept its filename; it is the CRUD
  screen, NOT the dashboard). Nav items "Corporate Overview", "Managed Listings",
  "Post Vacancy" are gone; `/submit` + `SubmitJob.jsx` were deleted. Charts use
  recharts with a theme-aware custom tooltip.

### PESO Organization Profile (migration 026)
- `PesoAdminProfile.jsx` reframed from an EMPLOYER profile to the PESO OFFICE
  identity. Employer columns (`nature_of_business`, `industry`, `company_size`,
  `recruitment_*`) are LEFT DORMANT (not dropped); PUT writes only office fields.

### ATS / referrals / bulk
- Cross-job ATS: `GET /peso-admin/ats/applicants` + `/ats/applicants/export`
  (CSV). ATS applicant rows carry `referral_status` + `referral_reference` (shared
  `REFERRAL_STATE_COLUMNS` subquery) so the Refer button is correct in every view.
- Bulk: `PUT /peso-admin/ats/applications/bulk/status`,
  `PUT /peso-admin/jobs/bulk/status` (ownership by intersection; 'Filled'
  excluded). Batch referrals: `POST /referrals/applications/bulk/:decision`
  (loops the single-item service so each keeps its own txn + vacancy cap).
- Similar-jobs: the fabricated random "N% Match" is GONE; cards carry a neutral
  `recommendation_reason` ('profile'|'related'). Real score stays on `/jobs/match`.
- PESO admin mutations are now AUDITED via `adminAuditService` (new actions
  JOB_CREATED/UPDATED/DELETED/JOB_STATUS_BULK_CHANGED/APPLICATION_STATUS_CHANGED,
  N8N_REPLAY). `/job-board/stats` gained `referrals` (approved count ≠ `hires`).

### Shared UI / polish
- `utils/csv.js` (shared CSV export). `components/common/AdminUI.jsx`
  (StatCard/Panel/EmptyState/BulkActionBar). `components/layout/
  NotificationBell.jsx` — extracted so the bell also shows on MOBILE (mounted in
  the Sidebar's mobile bar). Skeleton loaders replaced full-page spinners on the
  Public Job Board / Profile / My Applications / Saved Vacancies / Job Publication
  Management / dashboards. Seeker dashboard records table has multi-column sort +
  search. Toast progress bars (pause-on-hover) in `NotificationContext`.
  Standardized motion tokens in `index.css`.
- **Landing page** gained hero parallax, count-up stats, feature cards, an
  animated Career Roadmap (SVG spine draw + milestone pops), testimonials
  (PLACEHOLDER copy — replace before prod), a partner marquee, and a final CTA;
  all motion respects `prefers-reduced-motion`. ⚠️ The landing CSS lives in a JS
  template literal in `AnimationStyles` — it must contain NO backtick characters
  (a stray backtick once white-screened the page as a tagged template).

## 18. Development phase 2026-08-01 — Part 3, Phase 2C, Phase 2D (CURRENT STATE)

The authoritative record of everything shipped in the most recent phase. All on
`main` and pushed; migrations `027`–`031` applied; feature workers gated by flags
(dark by default). Blueprints: `docs/phase-2c-email-outbox-plan.md`,
`docs/phase-2d-ai-enhancements-plan.md`, `docs/resilience-hardening.md`. Polling
design: `docs/applicant-pipeline-polling.md` (§18.9). Test suite: `npm test`
(`node --test`) — 7 tests, source-only (never requires `../db`, which runs initDB
against prod, §13).

### 18.1 Background-worker roster (the outbox pattern, §7.5, is now used SIX times)
Every async feature is a transactional-outbox table drained by an in-process poll
worker (atomic conditional claim — TiDB has no SKIP LOCKED — backoff in
`next_run_at`, dead-letter, stuck-reclaim on boot). Do NOT invent a seventh mechanism.
(The sixth, `proactiveReferralWorker`, was added 2026-08-02 — see §20.)

| Worker | Table | Step(s) | Gate | Started in |
|---|---|---|---|---|
| `referralWorker` | `referral_jobs` | generate_pdf→send_email→notify→dispatch_n8n | `REFERRAL_WORKER_ENABLED≠false` | server.js (with io) |
| `emailWorker` (2C) | `email_outbox` | send | `EMAIL_OUTBOX_ENABLED=true` | server.js |
| `applicationScoringWorker` (2D-B) | `application_scoring_jobs` | score (+ consider-staging + emit `scores_updated`) | `APPLICATION_SCORING_ENABLED=true` | server.js (with io) |
| `jobMatchWorker` (2D-D) | `job_alert_jobs` | match (candidate-gen→AI→threshold→deliver) + daily digest tick | `JOB_ALERTS_ENABLED=true` | server.js |
| `proactiveReferralWorker` (§20) | `proactive_match_jobs` | match (candidate-gen→AI→threshold→upsert Smart Referral Queue) | `PROACTIVE_REFERRALS_ENABLED=true` | server.js |
| `notificationDigest` (Phase 2) | (DB marker) | daily unread-summary email via the outbox | setting `notification_digest_enabled` | server.js |

Backoff shape (60·2^(n-1), capped 1h) is COPIED per worker, never shared, so one
worker's schedule can't be changed by a tweak meant for another. `job.attempts` is
the pre-claim value; the failure branch uses `job.attempts + 1` (claim already
incremented the row) — an off-by-one here once let jobs over-retry.

### 18.2 Part 3 — scope + UX (all shipped)
- **Job Seeker Verification DECOMMISSIONED (invariant 0.9 resolved, §14):** the
  identity APPROVAL workflow is gone — `/profile/verification/{status,submit}`, the
  admin `/verifications/*` endpoints + Super Admin queue/nav/routes, the
  Pending-Verification KPI, and the profile ID-DOCUMENT upload + status badge.
  `job_seeker_verifications` / `verification_history` left DORMANT (not dropped,
  §0.7). KEPT (feeds the referral letter): the ID-TYPE selector
  (`verification_id_type`/`pwd_category`), `GET /profile/verification/id-types`,
  `verification_id_types`.
- **Notification Center (Phase 2):** `components/NotificationCenter.jsx` at
  `/notifications` (from the bell's "See all & settings"): paged history
  (`GET /notifications/history`) + per-type MUTE
  (`GET`/`PUT /notifications/preferences`, table `notification_preferences`, mig
  028). Muted `(user,type)` is suppressed at the single writer — `notificationService`
  checks `notificationPreferencesRepository.isMuted` (FAIL-OPEN — a lookup error
  never drops a notification) and a `NOT EXISTS` in `notifyAllJobSeekers`. Muted
  broadcast TOASTS are suppressed client-side via `NotificationContext.isTypeMuted`.
  Optional daily digest (`services/notificationDigest.js`, off by default).
- **WCAG 2.1 AA pass:** global `prefers-reduced-motion` + `:focus-visible` in
  `index.css`; status-select/aria labels; lime-on-white contrast fixes.
- **Pagination:** see §18.8.

### 18.3 Phase 2C — generic email outbox (durable transactional mail)
`repositories/emailOutboxRepository.js` + `services/emailOutboxService.js`
(`enqueue` fire-and-forget; `sendImmediate` = enqueue + one inline attempt for OTP)
+ `services/emailWorker.js`. Senders rewired off private nodemailer transports onto
the outbox → `mailService` (P0 failover): password reset + security alert
(`authRoutes`), contact inquiry (`jobBoardRoutes`), the orphan `emailService`, OTP
(`otpService`). Admin: `GET /admin/email`, `POST /admin/email/resend` (audited
`EMAIL_RESEND`); `/admin/health` gains `emailOutbox`; Super Admin
`superadmin/features/email/EmailDelivery.jsx` at `/admin/email`. Flag off ⇒ inline
send (identical to before) — the rollback lever. `dedupeKey` upsert = idempotent.

### 18.4 Phase 2D-A — Unified Applicant Profile
`services/applicantProfileService.js` + `GET /peso-admin/ats/applications/:id/profile`
(owner-scoped). Composes the SUBMITTED package (immutable `applicant_snapshot`,
apply-time `ai_analysis`, `match_score`, resume) + CURRENT profile (`users` + the
`userprofiles` RICHEST-row pick, invariant 0.8) + AI Resume Analysis (respects
`is_ai_profile_visible`) + certificates. No base64 in the aggregate (docs stream on
demand). `components/ApplicantProfileDrawer.jsx` — slide-over from the ATS card
"full profile" button; shows BOTH the live and apply-time compatibility scores.

### 18.5 Phase 2D-B — AI ranking + dynamic re-scoring
- **Two scores.** Apply-time `match_score`/`ai_analysis` are IMMUTABLE (the referral
  decision's source of truth, §7.4). LIVE `current_match_score`/`current_ai_analysis`/
  `scored_at` (mig 029) are recomputed off the request path and DRIVE ranking.
- **APPLICATION-SPECIFIC + finalized-referral exclusion (2026-08-04, `b7616c2`, mig 035).**
  Re-scoring is per-`application_id`, and a REFERRED application is a FINALIZED business record
  (signed letter + reference #) — **excluded from live re-scoring**, its apply-time score frozen as
  history. Enforced three ways: `ACTIVE_STATUSES=['Applied','Under Review','Shortlisted']` (no
  'Referred'); both enqueue paths AND-in `NOT_FINALIZED` (`NOT EXISTS` an Approved referral); the
  worker skips (`completeWithoutScore`, no AI) any job that became referred/ineligible mid-flight
  (`is_referred`). The ATS status is COUPLED to the referral: `approveReferral` sets `'Referred'`,
  `voidReferral` reverts to `'Shortlisted'` (reopen → re-enters scoring). A new application to a
  different vacancy is a different row and still scores. `test/applicationScoring.test.js` locks it.
- **ATS standardized to 4 statuses (`pesoAdminRoutes`):** Applied → Under Review → Shortlisted →
  Referred. Admin-settable set = the first three (`ATS_SETTABLE_STATUSES`, single + bulk); 'Referred'
  is SYSTEM-set by issuing a referral, never a dropdown option. `statusNotificationBody()` gives
  Under Review / Shortlisted specific seeker copy (Referred keeps its `REFERRAL_ISSUED` notification;
  no dup). Frontend renders 'Referred'/legacy as a read-only badge. Deprecated Interview/Hired/Rejected.
- **Triggers** (fire-and-forget, 0.1) re-arm re-scoring for a seeker's ACTIVE apps:
  résumé change (`resumeRoutes` builder + upload — **ALWAYS** re-scores; a résumé save IS a
  scoring-input change), certificate attach (apply), and a JOB EDIT re-scores that vacancy's
  active applicants (`applicationScoringService.enqueueForJob` from `PUT /peso-admin/jobs/:id`).
  Debounced ~90s (`SCORING_DEBOUNCE_SECONDS`), deduped per application (UNIQUE `application_id`),
  so rapid saves collapse anyway. **NOTE (regression fix, 2026-08-04):** `2464403` had
  DIRTY-CHECKED the résumé triggers (skip if `parsed_text` unchanged); that silently swallowed
  real re-scores and broke the expected flow, so it was REVERTED for résumé saves. **A PROFILE
  save still does NOT re-score** (the ONE kept optimization): the scorer reads only the résumé
  `parsed_text` + certs + job fields, NEVER `users` profile columns — so a name/phone/location/
  skills edit can't change any score. Do
  NOT re-add a profile-save re-score trigger. NOTE: one resume edit re-scores the editing
  seeker's OWN N active apps (each vs its own job) — that is correct, NOT a global re-eval of
  every applicant.
- **Staging is responsive (2026-08-01, reverses the earlier "never stages"):** after a
  re-score, `applicationScoringService.considerStaging` stages a 'Pending Review'
  recommendation when the LIVE score crosses `referral_ai_threshold` (idempotent;
  admin bell row via `notifyUser(null, …)`). It STAGES for review, never APPROVES —
  invariant 0.4 holds. The threshold stays 60% and is BOUNDED 50–80 (§7.12) — improve
  staging SPEED via the workers, never by lowering the bar.
- **Ranking API/UI:** ATS endpoints gain `sort` (match_desc/asc/recent/oldest) +
  `minScore`; `PesoAdminATS.jsx` shows a rank badge + BOTH score badges ("N% Live"
  green / "N% at apply" muted) and AUTO-REFRESHES via HYBRID polling — a real-time
  `scores_updated` socket push + a 90s visibility-gated backstop poll (see §18.9).
- **AI provider:** scoring goes through `aiClient` (OpenRouter↔DeepSeek failover +
  breaker). `AI_SCORING_PREFER` (default `openrouter`; set `deepseek` when OpenRouter
  is billing-blocked / HTTP 402) pins the preferred provider so scoring doesn't waste
  a failed primary call and stays consistent on one provider. `scoreApplication`
  returns a real score or NULL — never fabricated (0.2). The SHARED scoring core is
  `services/aiScoringService.scoreApplication({userId, job, extraContext})`; job
  columns are `experience`/`education` on `pesoadmin_job_posts` (NOT the legacy
  `required_experience`/`educational_requirements` from db.js initDB — a drift there
  dead-lettered every re-score; `test/applicationScoring.test.js` locks it).

### 18.6 Phase 2D-C — supporting certificates
`user_certificates` (library) + `application_certificates` (per-application snapshot),
durable base64 (mig 030). Apply Wizard: multi-upload + select from library
(`{user_certificate_id}` → server snapshots owner-scoped). Profile "Portfolio" tab =
`components/CertificateLibrary.jsx` (`/profile/certificates` CRUD). Shown in the
ApplicantProfileDrawer; owner-scoped streaming. C.3: PDF cert text feeds the LIVE
score via B's worker (`applicationScoringService.getCertificateContext`, cached to
`parsed_text`; image certs stay evidence-only). **SUPERSEDED (2026-08-25, §40): the C.3
cert-SCORING path was REMOVED — certificates are now stored + admin-viewable EVIDENCE ONLY;
they no longer feed the score and no longer arm a re-score (`getCertificateContext` deleted).
The library, snapshot, and owner-scoped streaming here all REMAIN.**

### 18.7 Phase 2D-D — AI job alerts
`jobAlertsRepository` + `services/jobAlertsService.js` + `services/jobMatchWorker.js`
(mig 031). On publish (`enqueueMatch` from POST/PUT jobs): CANDIDATE GENERATION
(cheap SQL — active + has parsed resume + opted-in + NOT already alerted, capped) →
AI-score the shortlist → threshold → deliver (immediate email via the P2C outbox, or
stage for the marker-paced daily digest). DEDUP is atomic: `recordMatch` uses
`INSERT IGNORE` on `UNIQUE(user_id, job_id)`. Per-seeker prefs (immediate/daily/off +
min score + unsubscribe token) in the Notification Center (`JobAlertSettings.jsx`);
public tokened unsubscribe. Super Admin monitor `/admin/job-alerts` + health card.
Tunables are system settings: `job_alerts_enabled`, `job_alert_ai_threshold`,
`job_alert_max_per_day`, `job_alert_candidate_cap`, `job_alert_default_frequency`.
`test/jobAlerts.test.js` locks the drift/dedup/cost guards.

### 18.8 Pagination (standardized)
- **Shared `components/common/Pagination.jsx`:** default 10 rows, selector
  10/25/50/100, First «/Prev/indicator/Next/Last », total + record range, `position`
  prop → render top AND bottom (both read the same parent state = auto-synced).
- **Server-side** (page/limit/offset/total; `utils/pagination.js` `getPageParams`,
  default 10, max 100): Applicant Pipeline (`/peso-admin/ats/applicants`), Referral
  Register (`/referrals`), User Management, Job Moderation, Audit Trail (1-based now).
- **Client-side** (`hooks/useClientPagination.js` slices an in-memory list, self-clamps
  the page): Saved Vacancies, seeker "My Referrals", Job Publication Manager.
- Not yet paged: Reports/Analytics tables (need backend paging); Notifications (uses
  infinite "Load more").

### 18.9 Applicant Pipeline auto-refresh (HYBRID polling + real-time, 2026-08-01)
`PesoAdminATS.jsx` keeps the LIVE score/ranking current without a manual reload via the
platform's standard posture — durable DB state + best-effort Socket.IO push + slow poll
backstop. FAST PATH: `applicationScoringWorker` (now started `with io`) best-effort emits
`scores_updated` to `user_<peso_admin_id>` after `markScored` commits — a TRIGGER only
(payload `{jobId, applicationId, at}`, never scores); `ChatContext` (sole socket owner)
adds one listener that bumps `pipelineRefreshTrigger`; the pipeline silently refetches
from the owner-scoped DB endpoint (DB stays source of truth, 0.3). BACKSTOP: a 90s
visibility-gated silent poll (`VITE_PIPELINE_POLL_MS`, default 90000) self-heals a missed
event/reconnect/blip and refetches on tab re-focus. All refreshes are spinner-free and
never touch the immutable apply-time score. The emit is wrapped (a socket failure never
affects the score, 0.1); `findApplicationForScoring` selects `ja.job_id` for the payload.
**Full rationale, trade-offs, WebSocket/SSE alternatives, event contract, interval
guidance, production config, and roadmap: `docs/applicant-pipeline-polling.md`.**

### 18.10 New system settings & env (read PER CALL, §7.12)
Settings: `notification_digest_enabled` (off), `job_alerts_enabled`,
`job_alert_ai_threshold`, `job_alert_max_per_day`, `job_alert_candidate_cap`,
`job_alert_default_frequency`; `referral_ai_threshold` now bounded 50–80.
Env: `EMAIL_OUTBOX_*`, `APPLICATION_SCORING_ENABLED`, `SCORING_DEBOUNCE_SECONDS`,
`SCORING_POLL_MS/BATCH_SIZE/STUCK_MS`, `JOB_ALERTS_ENABLED`, `JOB_ALERT_*`,
`AI_SCORING_PREFER`, `NOTIFICATION_DIGEST_POLL_MS`, `EMAIL_FROM_INBOX`. All optional
with safe defaults; features ship dark.

### 18.11 Testing (`npm test` = `node --test`)
`test/deliveryState.test.js` (referral delivery-state buckets), `applicationScoring.test.js`
(re-score query uses REAL job columns), `jobAlerts.test.js` (drift + dedup + candidate
guards). All read SOURCE text — never `require('../db')` (it runs initDB against prod).
Add a guard test whenever a repository query hard-codes column names.

## 19. Development phase 2026-08-02 — real-time pipeline, production hardening, HTTP email

The authoritative record of the most recent session. All on `main` and pushed to
`github.com/Angelo55/PESO-Kabankalan`. This phase took the platform from
"code-complete but only runs locally" to "deployed and functioning cross-origin on
Vercel + Render." No migrations, no schema change; all work is code + deploy config.
Full session-continuation summary: `docs/session-continuation-2026-08-02.md`.
Companion docs updated in lockstep: `docs/applicant-pipeline-polling.md` (hybrid),
`docs/resilience-hardening.md` (HTTP email + env-driven URLs).

### 19.1 Deployment topology (NEW — the platform is now actually deployed)
- **Frontend: Vercel** — `peso-kabankalan.vercel.app`. **Backend: Render** —
  `peso-kabankalan-backend.onrender.com` (the old `hi-re-backend` was RECREATED
  under the new name — Render's `.onrender.com` URL is fixed at creation and cannot
  be renamed; recreating meant re-entering every env var, but touches no code/DB).
- **GitHub repo renamed** `Hi-Re` → **`PESO-Kabankalan`** (redirects keep old clone
  URLs working; local remote + README + this file's §3 updated).
- **Same TiDB for local dev AND prod** — there is still NO separate dev database
  (a local-MariaDB split was offered and declined). Local writes hit prod data;
  respect §13 (never test a write path against prod).
- **Render free-tier facts that shaped the design:** (a) **blocks outbound SMTP**
  → HTTP email (§19.3); (b) **hibernates when idle** → intermittent 200/404 on cold
  start, and the pipeline's slow poll is the backstop (§18.9); (c) `PORT` is injected
  by Render — never set it manually.

### 19.2 Env-driven production URLs (the cross-origin enablers)
A Vercel↔Render split is cross-origin, so every URL the browser or OAuth flow needs
was moved off hardcoded `localhost` into env, with localhost fallbacks so **local dev
is unchanged**:
- **CORS + socket handshake** (`server.js`) — `ALLOWED_ORIGINS = DEV_ORIGINS ∪
  (CORS_ORIGINS csv | FRONTEND_URL)`. Both the Express `cors()` and the `socket.io`
  `cors.origin` read it. Without `FRONTEND_URL` set on Render, the Vercel origin is
  CORS-rejected and the socket never connects. **Verified in prod:** the backend
  returns `access-control-allow-origin: https://peso-kabankalan.vercel.app`.
- **Socket URL** (`ChatContext.jsx`) — was a hardcoded `io('http://localhost:5000')`
  that could NEVER connect from a deployed frontend (silently killing the hybrid
  real-time path AND chat/notification pushes in prod). Now derived from
  `VITE_API_URL` (minus `/api`), mirroring `api.js`.
- **Google OAuth login button** (`LandingPage.jsx`) — was hardcoded
  `http://localhost:5000/...`; now from `VITE_API_URL`. The backend OAuth side was
  ALREADY env-driven (`GOOGLE_REDIRECT_URI` + `FRONTEND_URL`).
- **Hybrid Applicant-Pipeline refresh (§18.9)** — this session is what MADE it real:
  `applicationScoringWorker` now starts `with io` and emits `scores_updated` to
  `user_<peso_admin_id>` after `markScored`; `ChatContext` relays it to a
  `pipelineRefreshTrigger`; `PesoAdminATS` silently refetches. The 45s poll became a
  **90s visibility-gated backstop** (`VITE_PIPELINE_POLL_MS`). Deploy note: the
  real-time half only works once `APPLICATION_SCORING_ENABLED=true` is set on Render
  (it is) AND the socket can reach the backend (the §19.2 socket-URL + CORS fixes).

### 19.3 HTTP email — surviving an SMTP-blocked host (`services/mailService.js`)
**Problem:** Render blocks outbound SMTP (ports 25/465/587), so nodemailer (Gmail +
Brevo-SMTP fallback) fails on boot with `ENETUNREACH`/timeout — no email in prod.
**Fix:** `mailService` refactored to an ordered provider chain where each provider is
a uniform `{ name, send, verify, drop }`, mixing two transport kinds:
- **HTTP providers, tried FIRST** (work over 443, which Render allows):
  - **Brevo** (`BREVO_API_KEY`, v3 `POST /v3/smtp/email`) — leads the chain. Delivers
    from a **verified SINGLE SENDER** (an individual email like a Gmail, confirmed in
    Brevo → Senders), so it reaches ANY recipient with **no domain required**. This is
    the current production sender. Sender = `BREVO_FROM_EMAIL` (defaults to
    `EMAIL_USER`) + `BREVO_FROM_NAME`. Free tier = 300 emails/day. Use the `xkeysib-…`
    API key, NOT the `xsmtpsib-…` SMTP key.
  - **Resend** (`RESEND_API_KEY`, `POST /emails`) — second. Send-only ("restricted")
    keys are normal and valid; `resendVerify` treats a "restricted to only send"
    rejection as verified. BUT Resend only delivers to arbitrary recipients from a
    **verified DOMAIN**; with the default `onboarding@resend.dev` it delivers only to
    the account owner's own email (test mode). `RESEND_FROM` sets a verified sender.
- **SMTP providers, fallback** — Gmail primary + `EMAIL_FALLBACK_*`. Work locally,
  dead on Render (kept for local dev + non-blocked hosts).
- **Attachments** (referral letters) convert to base64 for both HTTP providers via a
  shared `attachmentBase64` helper.
- **All env-gated** → local dev sets no HTTP key and uses Gmail SMTP exactly as before.
- **Validated in prod:** password-reset email delivered via the HTTP provider on
  Render.

### 19.4 Brand consolidation "Hi-Re" → "PESO Kabankalan"
Secondary brand retired in user-facing copy (chatbot persona "PESO Kabankalan
Assistant", Apply-Wizard resume label, user manual), stored labels (forward-only:
application source `'PESO Kabankalan'`, builder filename `PESO_Kabankalan_Builder.pdf`,
`resumeUrl` label — old rows keep old values, no prod backfill), and repo references.
**Deliberately KEPT** (factual/historical): `RESEARCH_PAPER.md` (a titled artifact),
the archived migration, `PESODB.vuerd.json`. The app already led with "PESO Kabankalan"
in the UI; this cleaned up the leftover "Hi-Re" tokens.

### 19.5 Known limitations, deferred work & next steps
- **Email production-grade auth is DEFERRED** — currently a Brevo single-sender (or
  Resend test mode). Before real launch: buy a domain, verify it (Brevo domain OR
  Resend domain), and set SPF/DKIM/DMARC + a branded `no-reply@domain` sender via
  `BREVO_FROM_EMAIL`/`RESEND_FROM`. No code change — env + DNS only.
- **SECURITY — rotate secrets before the repo goes public.** `.env` is in git history,
  AND `routes/authRoutes.js:71` hardcodes a real `GOOGLE_CLIENT_SECRET` fallback
  (remove it → read env only → rotate the key). Open background task.
- **Deploy cutover tail (user-side dashboard steps):** set Vercel `VITE_API_URL=
  https://peso-kabankalan-backend.onrender.com/api` + redeploy; add the new
  `GOOGLE_REDIRECT_URI` + Vercel origin in Google Cloud Console; **suspend the old
  `hi-re-backend`** so two worker sets don't poll one DB (safe — atomic claims — but
  wasteful).
- **Render free-tier cold start** — first request after idle is slow and the socket
  can't connect until the backend wakes; the 90s poll covers the pipeline. A paid
  instance or an external keep-warm ping removes it if it matters.
- **Still no separate dev DB** — local dev shares prod TiDB (declined for now).
- **Roadmap (unchanged, still open):** the §18.9 real-time hybrid could add a
  worker→admin socket-health surface; the AI-Recommended threshold instrumentation
  (§14); Reports/Analytics server-side pagination (§18.8).

## 20. Proactive AI Referral Workflow (2026-08-02) — administrator-initiated referrals

The panel-requested second referral path: instead of only reviewing seekers who APPLIED,
a PESO Administrator can **proactively refer an existing applicant to a vacancy they never
applied to**. Shipped in four phases (P1 `0128cc8`, P2 `808abd1`, P3 `f481452`, P4 `15d087e`),
dark behind `PROACTIVE_REFERRALS_ENABLED`, **deployed 2026-08-02**. Full blueprint (design,
decisions, impact, testing, rollback): `docs/proactive-ai-referral-plan.md`.

### 20.1 The one architectural decision that matters
**A referral is FK-bound to `job_applications`** (`referral_queue.application_id` UNIQUE), so a
proactive referral needs an application row. On promote, one transaction MATERIALIZES an
admin-initiated `job_applications` row (`origin='admin_referral'`, `referred_by`/`referred_at`,
apply-time score, latest resume snapshot copied) and then calls the UNCHANGED
`referralService.approveReferral` — which enforces the vacancy cap (0.12), mints the letter
(0.13), and drives delivery via the referral outbox. So ~70% is reuse; the pipeline, letter,
outbox, outcomes, and audit are untouched. **`approveReferral` was NOT modified.**

### 20.2 The matcher (reuses the Job-Alerts reverse-scoring funnel)
`proactiveReferralWorker` (6th outbox worker, §18.1) drains `proactive_match_jobs` (enqueued on
job publish/edit): CANDIDATE GENERATION (cheap SQL — active applicants **with ≥1 existing
application** = the consent/intent basis, a parsed resume, NOT already applied to this job, NOT
already dismissed/promoted, capped) → AI-score the shortlist via `aiScoringService.scoreApplication`
(real-or-NULL, 0.2) → threshold → upsert into `proactive_referral_candidates` (the Smart Referral
Queue). The upsert re-scores WITHOUT resurrecting a Dismissed/Promoted candidate. Cost bounded by
`proactive_candidate_cap`; threshold is `proactive_referral_threshold` (75, bounded 50–95) — both
Super-Admin system settings (§7.12).

### 20.3 Data model (migrations 032–033, additive)
- `proactive_referral_candidates` — the queue: `(job_id, applicant_id)` UNIQUE (dedup), status
  `Suggested→Dismissed|Promoted`, `match_score`, `ai_analysis`, `reason`, `reviewed_by`,
  `promoted_application_id`.
- `proactive_match_jobs` — the match outbox, `UNIQUE(job_id)`.
- `job_applications.origin ENUM('seeker','admin_referral')` (+ `referred_by`/`referred_at`) — every
  pre-existing row defaults to `'seeker'`. **This column is the whole seeker-facing distinction.**
- `job_applications` **`UNIQUE(job_id, applicant_id)`** (033, guarded — a UNIQUE-add on TiDB is
  non-destructive if a dup exists; run the header's dedup pre-check first).

### 20.4 Surfaces
- **Admin (owner-scoped, PESO-admin-only):** `GET/POST /peso-admin/proactive/candidates[...]`
  (list, `:id/approve`, `:id/dismiss`, `rescan/:jobId`). Frontend `SmartReferralQueue.jsx` at
  `/peso-admin/smart-referrals` — ranked cards, **Refer** with an explicit per-card confirm (it
  issues a government referral), Dismiss. Promote COMPENSATES on failure (e.g. full vacancy 409):
  the orphan application is deleted and the candidate returns to the queue.
- **Seeker distinction:** origin-aware copy in the referral worker's notify + email steps
  ("PESO proactively referred you … no application needed"; reuses the `REFERRAL_ISSUED` type +
  `/referrals` link); a **"Referred by PESO"** badge on My Referrals; an `ADMIN_INITIATED`
  `referral_activity_log` entry (visible to the seeker). `origin` is selected in
  `findReferralById` + `listForApplicant`.
- **Duplicate prevention (layered):** candidate-gen exclusions · candidate `UNIQUE(job_id,
  applicant_id)` · `referral_queue.application_id` UNIQUE · the materialized row makes the
  existing apply-gate block a later duplicate apply · DB `UNIQUE(job_id, applicant_id)` (033).
- **Ops:** `GET /admin/proactive` + Super Admin `ProactiveReferrals.jsx` (`/admin/proactive`) monitor;
  `/admin/health` gains a `proactiveReferral` backlog probe. The monitor's candidate
  counts INNER-JOIN job + applicant (`counts()`), so they tally only ACTIONABLE
  candidates — an orphan (job/user deleted; the table has no FKs) never inflates the
  count. NOTE: the platform-wide monitor count can legitimately EXCEED any one admin's
  Smart Referral Queue because the queue is owner-scoped (a candidate for another
  admin's vacancy is correct to hide from you) — that gap is not a bug.

### 20.5 Env & the seeker-edit sub-flag
- `PROACTIVE_REFERRALS_ENABLED` (master — worker dormant unless `"true"`).
- `PROACTIVE_REMATCH_ON_EDIT` (off by default) — when ON, a seeker's profile/resume change re-arms
  proactive matching for their open, not-yet-applied vacancies (`enqueueForSeeker`, DOUBLE-gated by
  both flags, bounded by `openJobsForSeeker`'s cap so one edit can't fan out to every vacancy).
- `PROACTIVE_POLL_MS`/`PROACTIVE_BATCH_SIZE`/`PROACTIVE_STUCK_MS` (worker tuning, safe defaults).
- Settings: `proactive_referral_threshold` (75), `proactive_candidate_cap` (50).

### 20.6 Tests
`test/proactiveReferral.test.js` (source-only, §13) — 6 guards: real-column aliasing + owner select,
candidate-gen eligibility/dedup/cost, no-status-resurrection upsert, `openJobsForSeeker`
bounds/exclusions, migration 032 UNIQUEs + `origin` enum, migration 033 UNIQUE. `npm test` = 13/13.

### 20.7 Invariant to hold
0.4 (a named admin approves every referral) is preserved — the AI only SUGGESTS; the administrator's
explicit **Refer** in the Smart Referral Queue is the approval. Never auto-promote a candidate.

## 21. AI compatibility scoring — Tier-1 recalibration + eval harness (2026-08-02)

Panel feedback ("the compatibility % doesn't consistently reflect actual relevance")
drove an **audit → measure → fix → re-measure** pass on the ONE scoring engine
(`aiScoringService.scoreApplication`, §7.4). The discipline mattered: we changed the
algorithm only AFTER an eval proved where the gap was, and stopped once the fix was
measured — no speculative rewrites.

### 21.1 The eval harness (measure before you change)
- **`scripts/eval-scoring.js`** (`npm run eval:scoring [-- --mock] [-- --variant=NAME]`)
  runs a named PROMPT VARIANT over labelled `(résumé, job, expected band)` cases and
  reports **MAE on the overall %, band accuracy, false-positive / false-negative** counts.
  SELF-CONTAINED — imports/modifies nothing in the live scorer, so running it is free of
  side effects. Loads `.env` itself (a standalone script doesn't get server.js's dotenv).
  `--mock` runs with NO AI calls (each case's illustrative `mockResponse`) to prove the
  harness; a live run needs `OPENROUTER_API_KEY`/`DEEPSEEK_API_KEY` and hits real AI —
  run on **staging/local**, never a prod write path. Variants: `baseline` (the old
  apply-time prompt), `board` (the old thin `/jobs/match` prompt), `recalibrated` (Tier-1).
- **`scripts/eval-fixtures.json`** — labelled cases (SYNTHETIC — no PII) spanning the
  failure modes: transferable/synonymous skills, keyword-stuffing false-positive, strong
  match, non-match, career progression, certification-driven sparse résumé, equivalent
  education. Add real anonymized cases here for a representative measure.
- **Measured result:** `board` 71% band / MAE 6.9 → `recalibrated` **100% band / MAE 3.6**,
  0 FP / 0 FN. The transferable-skills case (React → "JavaScript" role) went 72→85. One
  "miss" turned out to be a too-strict LABEL (an IT grad for IT Support is Strong, not
  Good), not a scorer error — relabelled.

### 21.2 What Tier-1 changed (consistency/robustness, NOT a rubric re-weighting)
- **B1 unify:** `routes/jobRoutes.js /match` (the board) now calls `scoreApplication`
  instead of its own thinner inline prompt — one prompt, one validator, one shape. The
  board's number now matches the apply-time number (they share inputs), and the board no
  longer passes an unvalidated/hallucinated score straight through (the old inline path
  returned raw parsed JSON with no range check).
- **B3 job context:** the prompt now feeds the job's `skills` + `qualifications` (were
  dropped) and reads experience/education under EITHER name — workers alias them, but the
  apply path passes raw `experience`/`education` columns and silently sent "Not specified"
  before. `findApplicationForScoring` now also selects `skills`/`qualifications`.
- **B4:** résumé truncation 3000 → 8000 chars (long résumés were cut mid-experience).
- **B5:** `temperature: 0` + `response_format: { type: 'json_object' }` + first-`{…}`
  extraction parse → reproducible, reliably-parsed scores (kills the run-to-run drift
  that made a precise % look unstable — which was the original reason a band hid it).
- **Guards:** `test/scoringPrompt.test.js` locks all of the above (skills+qualifications
  fed, dual-alias fallback, temp 0 + JSON mode, board calls the shared core, re-score
  lookup carries skills/qualifications).

### 21.3 DEFERRED — Tier-2 rubric re-weighting + scale anchors
NOT done, on purpose: the engine already scores well (MAE 3.6 / 100% band), so
re-weighting risks regressing a working scorer. The only known symptom is strong matches
ANCHORING around 85 (no 90s spread) — a model behaviour from the missing scale anchors,
**not a code cap** (the eval returns 90 for a textbook match; nothing limits the score).
Revisit ONLY if real anonymized cases show a systematic miss, or if the office explicitly
wants top-end differentiation (then add scale anchors as a `recalibrated-v2` variant and
re-measure first). Decision 2026-08-02: leave the top-end as-is.

### 21.4 Every % surface uses this one engine (none are random)
Apply-time `match_score`, the Pipeline "N% Live" (`current_match_score`, refreshed by
`applicationScoringWorker` on a re-score), "N% at apply" (immutable), and the
AI-Recommended `referral_queue.match_score` ALL come from `scoreApplication` — real or
NULL, never fabricated. Caveat: "at apply" is frozen at submission time (an app scored
before Tier-1 keeps its old-engine value); a "Live" score refreshes onto the recalibrated
engine on the next re-score (applicant edits profile/résumé/certs, or an admin edits the
vacancy → `enqueueForJob`).

## 22. Performance hardening — P0 (2026-08-02)

A performance/scalability audit found the perceived slowdown was ARCHITECTURAL, not
resource starvation: synchronous AI on user-facing request paths, plus Render free-tier
cold starts. P0 fixed the three biggest, no hardware, no accuracy change (AI *scheduling*,
not AI *scoring*). Roadmap P1/P2 (below) are pending; **do not recommend a bigger instance
before P1–P2 are exhausted.**

### 22.1 Apply-time AI scoring is now ASYNC (behavioural change — know this)
`POST /applications` previously **`await`ed `scoreApplication`** — the applicant's Submit
blocked on a multi-second DeepSeek call. Now, **when `APPLICATION_SCORING_ENABLED=true`**,
apply inserts the row with a NULL score and **enqueues scoring immediately** (`enqueue…(id, 0)`
→ next ~10s poll); the `applicationScoringWorker` fills the **apply-time** score and stages
any recommendation. The apply-time immutable columns are filled by a **`COALESCE` in
`markScored`** — the FIRST score of an application sets `match_score`/`ai_analysis`/
`ai_scored_at` (still NULL), every later re-score touches only the LIVE columns, so the
apply-time source of truth (§7.4) is preserved. The score surfaces in the ATS ~10s later
via the `scores_updated` socket (§18.9). **Fallback:** when the flag is OFF, apply scores
SYNCHRONOUSLY as before (no regression) — the staging + `AI_RECOMMENDATION` blocks in
`applicationRoutes` are already guarded on `aiScore` being set, so the async path (aiScore
= null) correctly skips them and the worker's `considerStaging` does the staging instead.

### 22.2 Board `/jobs/match` is cached
`utils/ttlCache.js` (tiny in-process TTL map) caches the board AI-match preview per
`${userId}:${jobId}` (`MATCH_CACHE_TTL_MS`, default 10 min). SAFE because scoring is temp 0
(deterministic, §21) — a cached score is a correct score until the résumé/job changes. A
repeat job-open is instant instead of a DeepSeek call. Known limit: a résumé edit isn't
reflected in the board PREVIEW until the TTL lapses (apply-time/pipeline scores unaffected);
cache-invalidation on edit is a P1 option.

### 22.3 Cold start — `initDB()` skipped by default
`db.js` ran a big batch of legacy `CREATE TABLE`/`ALTER TABLE` on EVERY boot (superseded by
migrations, §13). It is now **skipped unless `DB_INIT_ON_BOOT=true`**; boot just verifies DB
connectivity. Set the flag only for a fresh, never-migrated local DB.

### 22.4 Measurement — `GET /admin/timing`
`middleware/requestTiming.js` records per-route **p95/max/avg + count** (and logs
`[SLOW …ms]` over `SLOW_REQUEST_MS`, default 1000). `GET /admin/timing` (Super Admin) returns
the summary slowest-first; `?reset=1` starts a fresh window. Per-process, resets on restart.

### 22.5 New env (all optional, safe defaults)
`DB_INIT_ON_BOOT` (off), `MATCH_CACHE_TTL_MS` (600000), `SLOW_REQUEST_MS` (1000),
`SIMILAR_CACHE_TTL_MS` (600000), `STATS_CACHE_TTL_MS` (60000).

### 22.6 P1 — first pass, DATA-DRIVEN from a real `/admin/timing` snapshot (2026-08-02)
The measured baseline (after exercising the app) reranked priorities — the worst offender
was NOT in the static audit:
- 🔴 **`GET /api/profile` ~3.5s → fixed.** The handler ran a batch of `CREATE TABLE` /
  `ALTER TABLE` **schema DDL on EVERY request** (same anti-pattern as boot `initDB`, but
  per-load). Removed — migrations own the schema (§0.6). **LESSON: never put inline
  schema DDL in a request handler; grep for `ALTER TABLE`/`CREATE TABLE` in `routes/` if
  a hot endpoint is slow** (a few other handlers still do smaller versions of this —
  candidates if they show up slow).
- **`GET /jobs/:id/similar` ~1.2s/open → cached** per `${userId}:${jobId}` (`similarCache`,
  `SIMILAR_CACHE_TTL_MS`); only the real AI result is cached, never the fallback. (`SELECT *`
  left as-is — the carousel's field needs are broad and the query is cheap; the cache is the win.)
- **`GET /job-board/stats` ~1–2s → cached** platform-wide (`statsCache`, `STATS_CACHE_TTL_MS`
  60s) — five COUNT/DISTINCT aggregations served instantly to every visitor.

### 22.7 Roadmap still open (architecture before hardware)
- **P1 — DONE (2026-08-02, this cycle):** ✅ `/job-board` LIST now selects explicit columns,
  dropping only the two detail-only LONGTEXT fields (`responsibilities`, `additional_instructions`)
  — a schema probe showed those are the only heavy columns; the detail drawer fetches them via the
  `/job-board/:id` deep fetch, so the list stays correct. (The `admin/*` dashboards used NO `SELECT *`
  — already explicit/aggregated, nothing to change.) ✅ `/match`'s double `getApplicantResume` removed
  — `scoreApplication` takes an optional `resumeText`, and `/match` now checks the cache FIRST (a hit
  skips both the résumé and job reads). ✅ Frontend `globalUpdateTrigger` fan-out split into
  `messageUpdateTrigger` + `applicationUpdateTrigger` (a chat message no longer reloads the ATS; a new
  application no longer refetches the message hub; the dead `referral_issued` bump removed). ✅ The dead
  public `GET /job-board/:id/similar` (random vacancies + fabricated `Math.random` match %, invariant
  0.2) removed — no consumer; the board uses the authed résumé-driven `/jobs/:id/similar`.
- **P1 — CLOSED (2026-08-03, `a35bbf6`):** ✅ chart bundles ARE route-lazy — recharts lives in its
  own lazy `ComposedChart` chunk (~384KB), loaded only when a dashboard renders, never in the
  ~482KB entry (PesoAdminOverview + PipelineAnalyticsChart are `React.lazy`). While confirming:
  removed DEAD `DynamicAnalytics.jsx` + its unused chart libs (apexcharts/react-apexcharts/chart.js/
  react-chartjs-2 — recharts is the only live one now); login `SELECT *` → explicit columns.
  `POST /auth/login` ~2.3s is **cold-start + bcrypt-12**, NOT code — bcrypt rounds stay (security),
  cold-start is the deferred keep-warm/hardware item. **No P1 code work remains.**
- **P2 (only when concurrency grows):** move the AI-heavy workers (scoring, jobMatch, proactive)
  to a SEPARATE process/dyno so DeepSeek calls don't share CPU with the API (the workers are
  already run-anywhere, §7.5); Redis only when multi-instance.
- **P3:** hardware — last, and only after P1–P2.

### 22.8 STOP-POINT (2026-08-02) — performance audit substantially complete
Measured before/after via `/admin/timing`: `GET /api/profile` 3618ms→350ms (the DDL fix),
board/stats/similar caches confirmed. The remaining >1s items are NOT architectural: AI
first-open (~2s on a cache miss, inherent to DeepSeek, cached after) and login (~2.3s,
bcrypt-12 on the free CPU — leave the rounds). **The high-value software/architecture wins
are exhausted.** The low-ROI P1 code items (job-board list columns, `/match` double fetch,
frontend fan-out) were nonetheless cleared 2026-08-02 (§22.7) — build + 24/24 tests green.
**Do not pursue the remaining P1 tail (chart-lazy check, login bcrypt) or hardware without a
fresh `/admin/timing` snapshot under real multi-user load proving a specific need.** Full cycle
stop-point, Phase 1/2/3 roadmap, risks, and the cross-reference map:
**`docs/session-continuation-2026-08-02.md`** — load it + this file to resume with full context.

## 23. Saved Vacancies — bookmark-manager refactor (2026-08-02)

Saved Vacancies was a SECOND job-details surface: on open it ran `POST /jobs/match`
(a DeepSeek call) and rendered a full detail drawer with Apply + message-employer +
AI advice — duplicating the Public Job Board and doing redundant AI work. It is now a
**lightweight bookmark manager**; the **Public Job Board is the single source of truth**
for details, AI compatibility, employer info and Apply.

- **Open behaviour** — `savedJobState(job)` (in `jobs/JobCard.jsx`, beside
  `isJobFilled`/`filledLabel`) derives one of `active | filled | closed | expired |
  unavailable | removed`. **Active** → deep-links to `/job-board?job=<job_id>`;
  anything else → an in-place **tombstone** (no fetch, no AI) with Remove + Browse
  Similar. Availability comes from the LIST payload the server already returned — **no
  per-open request**; the board re-validates on arrival.
- **Deep-link (new)** — `PublicJobBoard.jsx` now reads `?job=<id>` (auto-open its
  existing detail drawer) and `?category=<c>` (pre-apply the filter; powers "Browse
  Similar"), consumed once via a ref then cleared from the URL. There is still **no
  standalone job-details route** — the board detail remains a modal.
- **Backend** — `GET /saved-jobs` switched **INNER→LEFT JOIN** so an admin-HARD-deleted
  vacancy (`DELETE FROM pesoadmin_job_posts`; `saved_jobs` has no cascade) still surfaces
  as a tombstone instead of vanishing; it selects a **minimal column set** (no `pj.*`, no
  AI), exposes `job_deleted` (`pj.id IS NULL`) with title/company/location falling back to
  the migration-034 snapshot, and best-effort stamps `last_checked_at` AFTER responding
  (never adds latency or 500s a read, 0.1). `POST /saved-jobs` captures/refreshes the
  snapshot via `INSERT … SELECT` from the job at save time. `/jobs/match` is UNTOUCHED —
  the module simply stopped calling it (the AI-load win).
- **Remove consistency fix** — the single-item Remove was a HARD delete while multi-select
  used the soft-delete Trash (§6.7). Both now go through `useTrashAction.moveToTrash`
  (commit-first + Undo). (The board's bookmark TOGGLE stays a direct un-bookmark — a
  different gesture.)
- **Enhancements** — derived-state **badges** on cards, **status tabs** (All/Active/Filled/
  Closed/Expired/Removed with counts), **Browse Similar** (→ board filtered by category),
  and a **"status checked <ago>"** hint from `last_checked_at`.
- **Migration 034** — additive `saved_jobs` snapshot columns + `last_checked_at` + a
  backfill for bookmarks whose job still exists. Verified: build + 24/24 tests + a
  read-only query probe (17 of 55 live bookmarks pointed to already-deleted jobs — those
  were invisible under the old INNER JOIN and now render as tombstones).

## 24. Theme system — centralized design tokens (Phase 1, 2026-08-03)

Before this the app had NO token layer: dark mode was ~1,500–2,500 inline `dark:`
utilities across 40+ files plus hundreds of hardcoded brand hex (`#1a4a38`×264,
`#4F7942`×179, `#99e742`×126…), and theme STATE lived inside `Sidebar.jsx` — so the
Super Admin shell (which uses `SuperAdminSidebar`, not `Sidebar`) could neither toggle
NOR apply a saved theme, and every load flashed light→dark (FOUC). Phase 1 introduced
the centralized system; **the page-by-page migration onto it is ongoing (Phase 2)**.

- **Tokens** (`src/index.css`) — semantic CSS variables as **space-separated RGB
  channels** under `:root` (light) and `.dark` (dark): `--surface-base/-/-raised/-sunken`,
  `--line`/`--line-strong`, `--content`/`--content-muted`/`--content-subtle`, `--accent`/
  `--accent-text`/`--accent-hover`/`--accent-contrast`/`--accent-soft`, `--focus-ring`,
  `--danger`/`--warning`/`--success`/`--info`, `--shadow-card`/`--shadow-raised`. Channels
  (not hex) so Tailwind's opacity modifier works (`bg-raised/70`). `tailwind.config.js`
  maps them to `rgb(var(--x) / <alpha-value>)` as semantic colours: **`bg-surface`,
  `bg-base`, `bg-raised`, `bg-sunken`, `text-content`, `text-muted`, `text-subtle`,
  `border-line`, `text-accent-text`, `bg-accent`, `ring-accent`, `shadow-card/raised`**.
  A component written in tokens needs **NO `dark:` variant** — the token flips under `.dark`.
- **New dark palette** — layered charcoal/slate (base `#0e1116`, surface `#171b22`, raised
  `#1e232c`; NOT pure black), soft borders (`#272d38`), off-white text (`#e6e8ec`, not
  `#fff`). Accent unified on the redesigned green: `#4F7942` fills both themes,
  `#A8D5BA` (mint) is accent TEXT/icons on dark. Retune the whole palette in ONE place.
- **`ThemeContext`** (`src/context/ThemeContext.jsx`, mounted app-wide in `main.jsx`) is the
  SINGLE owner of theme — covers seeker, PESO-admin AND Super Admin. `useTheme()` →
  `{ theme, isDark, toggle(event) }`. Applies `.dark` on `<html>` + persists `localStorage
  ['theme']`. A tiny **pre-paint script in `index.html`** applies the class before first
  paint (no FOUC) + sets `color-scheme`.
- **Toggle location** — `components/common/ThemeToggle.jsx` (animated sun↔moon morph). Lives
  in the **TopHeader** (desktop seeker/PESO-admin), the **Sidebar mobile bar** (phones —
  TopHeader is `hidden md:flex`), and the **Super Admin sidebar footer**. The sidebar body is
  navigation-only now. **Do not** re-add a theme toggle to the sidebar body.
- **Premium switch** — View Transitions API circular reveal from the toggle position where
  supported; a 260ms colour cross-fade (`html.theme-transition`, index.css) as fallback;
  INSTANT under `prefers-reduced-motion` (the global reduced-motion catch-all also zeroes it).
- **Focus ring** now token-driven (`rgb(var(--focus-ring))`) — fixed a dead
  `:root[data-theme]` / `prefers-color-scheme` mismatch (nothing set `data-theme`; the app
  toggles the `.dark` CLASS).
- **GOTCHA — never name a colour token after a core utility.** The app background token is
  `canvas` (`bg-canvas`), NOT `base`. A `base` colour makes Tailwind emit a `text-base` COLOUR
  utility that COLLIDES with the built-in `text-base` FONT-SIZE utility, silently painting any
  `text-base` element the surface colour (invisible text). This shipped in Phase 1 and made the
  LandingPage tagline + FAQ unreadable until fixed (`55781ce`, rename `base`→`canvas`). Applies to
  any future token — don't collide with `text-{sm,base,lg…}`, `font-*`, `leading-*`; verify by
  grepping the built CSS for an unexpected `.text-<name>{…color…}` rule.
- **LandingPage is self-contained light** — root `bg-[#f8f9ff] text-[#0b1c30]` (fixed hex), so it
  renders on light surfaces in BOTH themes (the dark body never bleeds through). It now carries a
  **Visit Our Office** section (static map preview + Get Directions/Open-in-Maps/Message-Us, no
  embedded tiles — perf-safe) and its job-preview cards use a strong `from-black/85` scrim so white
  title text stays readable over any image (`97f080b`).
- **Migration status — COMPLETE (Phase 2 done, 2026-08-03).** The ENTIRE application shell is
  on tokens: shared primitives (AdminUI, Pagination, Skeleton), jobs primitives (JobCard,
  JobFilterBar, CardLabels), both sidebars, TopHeader + NotificationBell, Saved Vacancies,
  Public Job Board (+ drawer), the ATS cluster (PesoAdminATS, ApplicantProfileDrawer,
  SmartReferralQueue, PesoAdminOverview), all seeker pages (Profile, Dashboard, Notification
  Center, Trash, My Applications, Messages, Apply Wizard, Referrals, the 3 builders), the whole
  Super Admin subsystem (`superadmin/features/*`), PesoAdminDashboard/Profile, the auth forms,
  and the analytics/panel widgets. A repo-wide sweep reports ZERO non-intentional
  gray/legacy-green in migrated files. Batches: primitives `63e9441`, jobs `c43e38d`, sidebars
  `47e2666`, bell+audit `0aac629`, Saved `eafbe0f`, board `4eee37c`, ATS `e5a5014`, seeker
  6a `f2d8168` / 6b `a381937`, super-admin+rest `d9e4daa`.
- **Brand surfaces (2026-08-03):** `Chatbot.jsx` + `ChatWidget.jsx` were migrated to tokens
  (`f907a0b`) — they used the standard PESO green, so they mapped cleanly. **`LandingPage.jsx`
  was tokenized (`96b37b8`) then REVERTED (`f5e70bf`):** mapping its bespoke ~15-hue marketing
  palette (teal `#003631`×99, mint/navy/rust/peach/blues/bright-green) onto the single accent
  token flattened it to dull monochrome on the deployed page — confirmed visually by the owner.
  It keeps its bespoke light-only marketing design. **TWO files remain DELIBERATELY EXCLUDED:**
  (1) `GebbieMascot.jsx` — the mascot ARTWORK (honey-amber bunny, §9); (2) `LandingPage.jsx` —
  bespoke multi-colour marketing page. Do NOT tokenize either without a fresh product decision
  (the landing tokenization was already tried and rejected — don't repeat it).
- **When touching ANY component going forward,** stay on tokens (§24.1 is the review gate):
  `bg-white dark:bg-gray-800`→`bg-surface`, `text-gray-900 dark:text-white`→`text-content`,
  `text-gray-500`→`text-muted`, `border-gray-200 dark:border-gray-700`→`border-line`,
  `#4F7942`/`#1a4a38`/`#003631`/`dark:#A8D5BA`/`#99e742`→`text-accent-text` (or `bg-accent`/
  `bg-accent-soft` for fills/tints). Do NOT reintroduce hardcoded brand hex or a raw `dark:`
  colour pair. Charts keep their theme-aware `useIsDark` hook + categorical palettes; semantic
  status colours (indigo/emerald/amber/rose/red/sky/violet/teal/slate) are NOT the accent and
  stay as-is.

### 24.1 Interaction-state standard (MANDATORY acceptance criterion, 2026-08-03)
Every interactive element must express these states through TOKENS (never a hardcoded
colour, never a bare inherited near-black):
- **Default:** `text-muted` (secondary/nav) or `text-content` (primary). Links/accents:
  `text-accent-text`.
- **Hover:** darken/tint via token — `hover:text-content` + `hover:bg-sunken`, or
  `hover:text-accent-text`; solid buttons `hover:bg-accent-hover`.
- **Active/pressed:** `active:scale-95` and/or a deeper token; nav "current page" =
  `bg-accent-soft text-accent-text` (the selected state must stay visually distinct).
- **Focus (keyboard):** `focus-visible:ring-2 focus-visible:ring-accent` (the global
  `index.css` outline is a backstop — components keep their own ring).
- **Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed` (never a grey hex).
- **Selected/current:** accent-soft surface + accent-text (nav, tabs, chips).
- **Visited:** not styled distinctly (SPA app context) — do not add `:visited` colours.

Solid buttons: `bg-accent text-accent-contrast hover:bg-accent-hover`. Semantic states use
the `danger`/`warning`/`success`/`info` tokens (never a raw `red-500`/`amber-500` for meaning).
**This is a review gate:** no new feature or edit may reintroduce a raw `dark:` colour pair,
a hardcoded brand hex, or a state that resolves to inherited black — verify against this list
before shipping any UI (folds into §16's pre-flight).

### 24.2 Audit finding — the "black interactive text" regression (2026-08-03)
The centralized layer (tokens, `tailwind.config` which EXTENDS the default palette,
`index.css` body/focus, the shells, `TopHeader`, sidebars, shared primitives) is correct and
was NOT the cause. The regression is a **half-migrated palette**: ~126 interactive-TEXT uses
of the near-black legacy greens `text-[#1a4a38]` (66×) and `text-[#003631]` (60×) across ~25
un-migrated components (Profile, PesoAdminATS, SmartReferralQueue, Referrals, Dashboard,
NotificationCenter, ApplyWizard, the superadmin feature pages, …). Those dark greens read as
near-black on white and clash with the new `#4F7942`/mint accent → "uniform black / broken
visual language." **Resolution = finish the token migration on those files** (convert
`text-[#1a4a38]`/`text-[#003631]` interactive text → `text-accent-text`), the ongoing Phase 2
work, reprioritized to interactive-colour-bearing components first. `NotificationBell` (shared,
every page) was fixed first.

## 25. Infrastructure Optimization Roadmap (DEFERRED but APPROVED — 2026-08-04)

Approved, on the active roadmap, **not yet started**. Remind the user each session until done.
Order is deliberate: **software first, then cheapest-highest-ROI hardware, then scale-out only
when `/admin/timing` under real concurrency proves the need.** Current backend = ONE Render
**free** web service (512 MB, 0.1 vCPU shared, hibernates) running the API + all six in-process
outbox workers (§18.1) + Socket.IO in a single process.

**Cost analysis — the OWNER'S actual plan, priced 2026-08-04 (verify live Render pricing before buying):**
| Item | ~Monthly cost | What it buys |
|---|---|---|
| **Render Starter (web)** | **$7** | Always-on (kills cold starts — the #1 current UX pain) + 0.5 vCPU (5×). Same 512 MB. No code change. ONE instance. |
| **Dedicated worker process** | **+$7** | A 2nd Render *Background Worker* service (Starter tier; same repo, `node worker.js`) draining the same outbox tables → AI/background CPU stops competing with the API. No free continuous-worker tier. |
| **Redis — Essentials** | **~$8** | Owner's chosen plan (`$0.011/hr` × ~730 h ≈ $8/mo). Socket.IO pub/sub adapter across processes + shared cache. A free tier (Render Key Value 25 MB / Upstash free) also works at this scale, so Redis can start at **$0**. |
| **Horizontal scaling** | **NOT included with Starter** | Starter = ONE instance. Horizontal = MULTIPLE instances, billed **per instance** (2 web = 2×$7 = $14, each extra worker +$7). REQUIRES Redis (Socket.IO adapter + no per-instance in-memory drift). Last step; not needed at current scale. |

**Totals (owner's plan):** cold-start fix only = **$7/mo** · web + worker (no Redis, real-time degrades to polls) = **$14/mo** · **full web + worker + Redis Essentials = ~$22/mo** · + each extra horizontally-scaled instance = **+$7/mo**.
**Recommendation stands:** at current traffic ~$22/mo is OVER-PROVISIONING — buy **only the $7 Starter web** now (same real-world UX as $22 at this load); add the $7 worker + $8 Redis later only when `/admin/timing` shows contention. Code is already prepped (item 2), so each is a dashboard flip. A single web + single worker + Redis handles a LOT before horizontal scaling is ever needed.

**Roadmap items (all deferred + approved):**
1. **Render Starter upgrade evaluation** — highest ROI/$ (cold-start kill). User is postponing ~1 week (budget). Fixes cold-start + CPU throttling; does NOT fix worker/API CPU-sharing or inherent DeepSeek latency.
2. **Dedicated worker-process deployment** — move the workers to a 2nd service. Run-anywhere (atomic DB claim, §7.5) → deploy/wiring, **not a rewrite**. **Incremental WITHOUT Redis:** worker-originated real-time nudges (`scores_updated`, notifications) degrade to the EXISTING poll backstops (90s pipeline poll §18.9, bell refetch) until Redis — correctness unaffected (DB source of truth, 0.3), only immediacy.
   **✅ CODE PREPPED (2026-08-04) — the deploy is now a $7/mo dashboard step, no code left:** `startWorkers.js`
   (shared `startAllWorkers(io)`/`stopAllWorkers()` — the ONE place the six workers are wired, so `server.js`
   and `worker.js` can't drift), `worker.js` (headless entrypoint, `npm run worker`), and a `WORKER_MODE`
   gate in `server.js`. **Today's single-service deploy is UNCHANGED** — flag unset ⇒ the web process runs
   the workers in-process exactly as before. To split later: create a Render **Background Worker** service
   running `node worker.js` (same repo + same env), then set `WORKER_MODE=web` on the web service.
   `worker.js` passes `io=null` so real-time emits no-op until Redis (item 3).
3. **Redis queue & caching integration** — add AFTER the worker split, to (a) restore worker→client real-time via the Socket.IO Redis adapter and (b) share cache across instances. Needed only once >1 process/instance exists.
4. **Horizontal worker scaling strategy** — multiple worker instances draining the same outbox. The atomic conditional claim (no double-processing) already makes this safe; needs Redis (adapter) + per-worker `WORKER_ID`. Only when a single worker can't keep up.
5. **Long-term infra optimization roadmap** — revisit dyno sizing, separate dev/prod DB (still shared prod TiDB), CDN/asset tuning, and cost review as traffic grows.

**Expected gains (per subsystem) once worker-split lands:** AI scoring / proactive / jobMatch —
own CPU, no contention with the API (throughput still bounded by DeepSeek latency, unchanged);
email worker — faster drain; **overall API responsiveness — the main win** (login/profile/board/
apply stay snappy during scoring bursts). Socket.IO/notifications real-time only improves once
Redis is added (or if the socket-emitting workers stay in the web process). **Highest ROI/$ right
now = the $7 Starter (cold-start).** Worker-split is future-proofing — at current traffic the
single process isn't actually CPU-contended (nothing in `/admin/timing` shows it), so hold it until
real concurrency proves it. Redis is lowest immediate ROI (only meaningful post-split / multi-instance).

### 25.1 Local dev — production-mirrored process split (2026-08-04, IMPLEMENTED, $0)
The web/worker separation is now runnable LOCALLY so dev mirrors the future paid-worker
deploy — a config change later, not a rewrite. Files: `startWorkers.js` (shared start/stop
wiring), `worker.js` (headless entrypoint), and the `WORKER_MODE` gate in `server.js`
(`RUN_WORKERS = WORKER_MODE !== 'web'`).
- `npm run dev` — all-in-one (API + workers, one process). **Default; unchanged.**
- `npm run dev:web` — `cross-env WORKER_MODE=web nodemon server.js` → **API only** (no workers).
- `npm run dev:worker` — `nodemon worker.js` → **workers only** (headless, `io=null`).
Two-terminal workflow (dev:web + dev:worker) = the exact prod topology; each process restarts/
debugs/logs independently (distinct `[Server]` / `[Worker]` / `[XxxWorker]` prefixes). The
"queue" is the TiDB outbox tables (§7.5) — the two processes never talk directly; both just
hit the same DB, so IPC is the DB (invariant 0.3). **`worker.js` MUST keep one ref'd heartbeat**
(`setInterval`): every worker poll timer is `.unref()`'d, so a headless process with no HTTP
server would otherwise EXIT the instant startup finishes (fixed `d20def0`). Do not remove it.
Prod parity: the future Render **web** service sets `WORKER_MODE=web`; the **worker** service
runs `node worker.js` — same code, same env, same outbox.

**PICK ONE WORKFLOW — never run `dev` alongside `dev:web`.** `dev` and `dev:web` BOTH run
`server.js` and bind `PORT` (5000), so running them together → `EADDRINUSE` (this is why
`dev:web` "doesn't start" when `dev` is already up — not a bug). Valid setups: (a) `npm run dev`
alone, or (b) `npm run dev:web` + `npm run dev:worker` in two terminals. Running `dev` +
`dev:worker` together "works" but DOUBLE-runs the workers (dev has them in-process, dev:worker
adds a second set) — safe (atomic claim dedups) but wasteful; use `dev:web` (not `dev`) as the
API half of the split. The two split processes coordinate ONLY through the shared TiDB outbox
(the API writes jobs, the worker drains them) — that's the real IPC, same as prod.
**No LOCAL performance gain from the split** — a dev laptop isn't CPU-constrained like Render's
0.1–0.5 vCPU, so there's no contention to relieve (a tiny two-cores-vs-one-core edge exists but is
imperceptible under dev load). The split's local value is FIDELITY + independent debug/restart, not
speed; the actual perf win is production-only on the constrained host. Default to `npm run dev` for
day-to-day; use Workflow B only to validate the split.

### 25.2 REJECTED — a 2nd Render FREE service for workers (assessed 2026-08-04)
Evaluated running the workers as a separate Render **Free** service (API stays on the current
free service) as a $0 way to cut CPU contention. **Verdict: not viable — skip it, wait for
Starter + a paid Background Worker.** Why:
- **Render Free = Web Services only.** Background Workers (and Cron/Private Services) require a
  PAID instance — there is no free worker service type. (Verify live, but this is Render's model.)
- To get "free" you'd deploy `worker.js` as a free **Web** service, which then **hibernates after
  ~15 min with no INBOUND HTTP** — and a worker gets none, so it sleeps and the outbox STOPS
  draining. A keep-warm pinger is hacky, against the spirit, and…
- **Free-hours quota:** the account's free web-service hours (~750/mo) are SHARED; two always-on
  free services blow past it and get suspended. So two free services can't both stay up 24/7.
- CPU: a split WOULD give each free service its own (throttled 0.1 vCPU) so the worker's AI work
  stops stealing the API's cycles — but the hibernation/quota problems make it UNRELIABLE, which
  defeats the purpose (background jobs that silently stop are worse than a little contention).
Net: the current single free service is actually MORE reliable for now (workers run whenever the
service is awake serving requests; stuck jobs reclaim on boot). The real win available for $0 is
the **local** process split above (25.1); the real prod win is **Starter web ($7) + paid Background
Worker ($7)** — deferred, approved (§25). Deployment comparison: (1) *single free service* = simple,
workers sleep with the app, fine at current scale; (2) *two free services* = adds hibernation +
quota failure modes for a marginal, unreliable CPU gain — **not recommended.**

**PROD FACT (owner-confirmed 2026-08-05): `WORKER_MODE` is UNSET on Render** → single-service,
workers run IN the web process and SHARE its Socket.IO `io`. So worker-emitted real-time
(`referral_issued`, `scores_updated`) reaches clients directly. If this ever changes to
`WORKER_MODE=web` (worker split) WITHOUT Redis, those worker→client pushes go dark and degrade to
the poll backstops (§26.2) — do not split without the Redis adapter (§25 item 3).

## 26. Referral Lifecycle Synchronization + real-time hardening + duplicate-posting redesign (2026-08-05)

The most recent phase. All on `main`, pushed; migration `036` applied; the feature ships behind the
runtime flag `referral_lifecycle_sync_enabled` (owner-enabled in prod). Blueprint:
`docs/referral-lifecycle-sync-plan.md`. AI-log operator guide: `docs/ai-processing-workflow.md`.
Tests: `npm test` = **43** (adds `referralOutcomeSync.test.js`, `duplicatePosting.test.js`).

### 26.1 Referral Lifecycle Synchronization (flag `referral_lifecycle_sync_enabled`, §7.11 update)
One synchronized outcome lifecycle across admin + seeker, WITHOUT weakening invariant 0.14.
- **Seeker can finally SEE the outcome.** `referralRepository.listForApplicant` (`/referrals/mine`)
  now LEFT JOINs `referral_outcomes` and selects `outcome`/`outcome_at`/`notes` — it never did, so
  My Referrals' pill was permanently "Awaiting outcome". Pure defect fix.
- **Seeker is NOTIFIED** on every official outcome change: `recordOutcome` now takes `io`, fetches
  the applicant, and calls `notifyUser` (new muteable type **`REFERRAL_OUTCOME`**, wired into
  `TYPE_META` + `CONTROLLABLE_TYPES`), plus emits `referral_outcome_updated` so both sides refetch.
- **Collaborative "admin-official / seeker-suggests" model (owner-ruled).** A seeker may report an
  outcome they heard from the employer via **`POST /referrals/:id/outcome/suggest`** (owner-scoped to
  the applicant, flag-gated). It appends an `is_official=0` row to **`referral_outcome_history`**
  (migration 036) and NEVER writes `referral_outcomes` — so a seeker-reported 'Hired' cannot enter
  the DOLE report or the landing "Successful Referrals" tile until an administrator CONFIRMS it
  (0.14 intact). Admin confirm = the normal `recordOutcome` (appends `is_official=1`). The Register
  surfaces the pending suggestion; `GET /referrals/:id/outcome/history` is the structured trail
  (same access rules as `/activity`). `referral_activity_log` stays the unified human timeline; the
  history table is the structured outcome axis + suggestion inbox.
- **Runtime flag exposure:** `referral_lifecycle_sync_enabled` is a §7.12 system setting (DB→env
  `REFERRAL_LIFECYCLE_SYNC_ENABLED`→default false), read per call; `services/referralService`
  fails safe to OFF. The client reads it via **`GET /api/config/features`** (`routes/configRoutes.js`)
  so flag-gated UI (seeker suggest, etc.) renders only when the backend honours it.

### 26.2 Seeker PESO Application Pipeline + My-Applications real-time (§9 addition)
- **New seeker surface `MyPesoApplications.jsx`** at a new route: a READ-ONLY 4-column board
  (Applied → Under Review → Shortlisted → Referred) over the seeker's REAL PESO submissions via
  **`GET /api/applications/mine`** (correlated subqueries — no fan-out; no `userprofiles` join, 0.8).
  This is DISTINCT from `/jobs` (`MyJobs.jsx` = the seeker's PRIVATE external tracker, `usertrackedjobs`)
  — that separation was the key audit finding: the private tracker is NOT the PESO referral axis.
- **Live column moves:** `ChatContext` adds `applicationStatusTrigger`, bumped on an `APPLICATION_STATUS`
  `notification_created` (Applied/Under Review/Shortlisted) or `referral_issued` (Referred); the board
  silently refetches. The `APPLICATION_STATUS` deep-link was repointed off `/jobs` to the new pipeline.

### 26.3 Real-time hardening (the two sync bugs)
- **Bell backstop (fixes "referral notification only after refresh").** The bell relied solely on
  worker-emitted `referral_issued`; a missed/degraded socket left it stale. `NotificationContext` now
  does a **visibility-gated backstop refetch** (~45s + on tab-focus, `VITE_NOTIF_POLL_MS`) — the
  §18.9 durable-state + poll-backstop posture, now applied to the bell.
- **Socket polling fallback.** `ChatContext` socket was `transports: ['websocket']` (no recovery if the
  upgrade fails / drops) → now `['websocket','polling']`, hardening ALL live events.
- **Messaging unread (fixes "badge won't clear on read").** `Messages.jsx` never refreshed the count
  after opening a conversation (which marks it read server-side in `GET /messages/:id`); it now calls
  `triggerBadgeRefresh()`, and `ChatContext` adds a focus backstop for the unread count. The sidebar
  "Communications" badge reads that same `unreadCount`, so it clears in step.

### 26.4 Duplicate-posting redesign (R1) + the "duplicate referral" audit
- **Audit verdict (read-only prod probe):** there were ZERO duplicate referral records; the canonical
  constraints ALL already exist (`referral_queue.uq_refq_application`, `job_applications.uq_job_applicant`,
  `proactive_referral_candidates.uq_proactive_candidate`). The observed "duplicates" were **two distinct
  job postings sharing a title** ("IT HELP DESK 3" ×2), the same seeker referred for each. The canonical
  one-referral-per-(seeker,vacancy) model was already enforced — so NO de-dup migration was built. R2/R4
  (badges: "Referred by PESO" + AI-score chip + reference/date) disambiguate the display; R3 made
  `promoteCandidate` refer through an EXISTING application instead of 409-ing.
- **R1 similarity detector** (`services/duplicatePostingService.js`, pure/testable): token-Jaccard title
  similarity + employer/location/type comparison → **Exact Duplicate / High Similarity / Possible
  Duplicate** (env-tunable `DUP_HIGH_SIMILARITY`/`DUP_POSSIBLE_SIMILARITY`). Replaces the old exact
  title+company match that let near-identical reposts through. **`POST /peso-admin/jobs/duplicate-check`**
  pre-check drives a confirm dialog (Exact/High) before publish + a warning toast (Possible); NEVER
  hard-blocks — a legitimate repost proceeds on confirm.

### 26.5 AI workflow operator guide (`docs/ai-processing-workflow.md`)
Decodes the scoring/proactive logs line-by-line (queue-scheduling vs worker-execution vs DB-write vs
frontend-refresh), explains why `[Scoring] Re-score armed` + `[Proactive] … re-armed` fire together
(one résumé edit feeds BOTH pipelines) and sometimes twice (a double trigger — the top optimization),
how debounce (~90s) + the UNIQUE-key upsert COALESCE repeated arms into ONE AI run (so the repeated
LOGS are noise, not double-billing), how active apps / open vacancies are selected, why `0 candidate(s)
surfaced` is normal, and 6 ranked optimizations that preserve correctness (§0.2/§7.5/§18.5).

### 26.6 Invariants held
0.1 (every new emit/enqueue best-effort, primary action never fails) · 0.2 (scoring untouched) ·
0.3 (DB source of truth; no new worker) · **0.4** (admin still approves every referral; a seeker
SUGGESTION is not an approval) · 0.11 (seeker outcome notification via `notificationService`) ·
**0.14** (seeker suggestions never enter official placement stats until admin-confirmed) · §7.12
(the flag is a per-call system setting).

## 27. "Building with Good UX" — Empty States + unified Search Dropdown (2026-08-07)

Frontend-only UX phase. All on `main`; no migrations, no backend change (the only backend
touch this session was the earlier frontend-sync fixes). Full component reference:
`references/ui-ux-and-responsive-layout.md` **§14 (Empty States)** + **§15 (Search Dropdown)**.

### 27.1 Empty State design system
Every blank list/table/dashboard/search across all three interfaces was replaced with a
purposeful empty that answers WHY empty · WHAT the module is for · WHAT to do next. New
reusable pieces: `components/common/EmptyState.jsx` (variants default/search/success ×
sizes sm/md, action buttons, floating/pop motion), `components/common/GettingStartedGuide.jsx`
(the seeker Dashboard first-run GAM — a 6-step checklist whose steps self-mark from real
signals: profile / résumé / saved / applied / referred; dismissible, auto-hides when done),
and CSS `es-float`/`es-pop` (reduced-motion-safe, index.css). **Success variant** celebrates
"caught up" states (Smart Referral Queue, AI-Recommended, Failed Referrals, Workflow
Automation). Rolled out to ~24 surfaces (seeker → PESO admin → Super Admin); monitoring
dashboards that render zeros gracefully were left as compact one-liners on purpose. Fixed a
malformed empty-state block in `MyPesoApplications` in passing.

### 27.2 Unified Search Dropdown (supersedes below-content Recent/Suggested)
Per the owner's redesign: recent history + recommendations moved OFF the page (below the bar
/ inside content) INTO a contextual overlay — `components/common/SearchDropdown.jsx`. Opens on
focus/typing; sections = Quick Filters + Recent + Suggested (empty query) → Matching Results
(typing); pick populates+runs, Enter runs raw, outside-click/Esc closes; full keyboard nav +
ARIA combobox/listbox. Centralised, NOT per-module: `jobs/JobFilterBar.jsx` now owns the whole
dropdown for its three consumers (Public Job Board, Job Publication Manager, Saved Vacancies)
via a `searchNamespace` prop; the Applicant Pipeline and Referral Register embed it directly.
Recent searches persist per-module through `hooks/useRecentSearches.js` (namespaced localStorage).
The old `RecentSearches.jsx` component was DELETED — do not reintroduce a below-content chip list.
Smart Referral Queue has no free-text search (ranked queue) → intentionally omitted.

### 27.3 Verification
`npm run build` clean across every touched chunk; backend untouched (`npm test` unaffected).
Interactive behaviours (GAM progress, dropdown recent/suggested/results/quick-filters, success
states) need a per-role logged-in session to exercise end-to-end.

## 28. Job Seeker application-lifecycle consolidation (2026-08-07)

The seeker's application UX was split across five overlapping surfaces (external-tracker
Kanban "My Applications" `/jobs`, "PESO Applications" `/my-applications`, plus the Dashboard's
Pipeline Analytics + My Recent + records table). Consolidated into ONE authoritative module
without a data migration. Blueprint decision recorded here; no migration, no backend behaviour
change beyond one additive read endpoint.

### 28.1 The constraint that shaped it
Two DIFFERENT stores back these surfaces: `job_applications` (real PESO submissions — the
referral pipeline is **FK-bound to `job_applications.id`**, so it stays the authoritative record)
and `usertrackedjobs` (private external + spreadsheet-imported tracking). A literal table merge
is unsafe (external rows have no vacancy FK; PESO rows can't leave `job_applications` without
breaking referrals/vacancy-cap/DOLE). So the consolidation is **presentation-layer**: compose
both, never merge. (Owner-confirmed approach.)

### 28.2 What shipped
- **`GET /api/applications/unified`** (`routes/applicationRoutes.js`) — composes both stores,
  each row `source`-tagged (`peso` | `imported`), owner-scoped, correlated-subquery referral
  fields, **read-only** (never mutates `job_applications`). `/applications/mine` + `/tracked-jobs`
  are UNCHANGED (additive) so imported-row edits + nothing else regress.
- **`hooks/useUnifiedApplications.js`** — the ONE client feed; exports `canonicalStage` mapping
  BOTH status vocabularies onto the COMPLETE lifecycle (see §28.4), plus derived KPIs. Every
  application surface consumes it (one metric, one home — now the feed).
- **`components/MyApplications.jsx`** at `/my-applications`, labeled **"My Applications"** — the
  single module: source badges, canonical-stage chips, source tabs, search, KPI strip; PESO rows
  show AI compatibility + referral status + letter link and are read-only; imported rows are
  editable (status/remove via the unchanged `/tracked-jobs`). Uses the SHARED `Pagination` +
  `useClientPagination` and a layout-aware skeleton (`MyApplicationsSkeleton`, composed from the
  design-system `Skeleton`).
- **Routing/nav:** `/jobs` → redirects to `/my-applications`; the "PESO Applications" nav item is
  removed; the orphaned `MyJobs.jsx` + `MyPesoApplications.jsx` are DELETED.
- **Dashboard:** KPI cards, `PipelineAnalyticsChart` (regrouped onto canonical stages), and My
  Recent Applications all read the unified feed; the redundant records table + its sort/search/
  status-edit machinery were removed and replaced with a link to the unified page.

### 28.3 Invariants held + verification
Referrals untouched (FK-bound to `job_applications`; no secondary application entity — guard test
`referralOutcomeSync.test.js` asserts `/unified` never writes `job_applications`). `/mine` guard
narrowed to its own handler. No migration; historical data intact; existing APIs unchanged.
`npm test` = **47**; `npm run build` clean. Live cross-source rendering + real-time refetch need a
logged-in session. UI-consistency note: pagination + skeleton now match the rest of the system
(reused, not reimplemented) — see UI addendum §5.4 (states) + §8.5 (pagination).

### 28.4 Complete-lifecycle analytics model (2026-08-07 follow-up)
The first cut collapsed outcomes into a 7-stage canonical set (In Review / Interview / Closed),
which LOST the granular employment-outcome statuses the old Dashboard analytics showed. Restored
by widening the canonical model — **frontend-only, no migration, referral/DOLE untouched**
(owner-chose "analytics model only"). `useUnifiedApplications` now maps BOTH sources onto the full
progressive lifecycle:

  MAIN: Applied → Under Review → Shortlisted → Referred → Interview Scheduled → Interviewed →
        Final Interview → Final Interviewed → Hired
  ALT/terminal: Responded · Pending / Waiting · Rejected · Withdrawn · No Response

Mapping: PESO base status (`PESO_BASE`) for the ATS stages; the referral OUTCOME (`OUTCOME_MAP`,
supersedes base once a letter is out — 'Issued'→stays Referred, 'Employer Acknowledged'→Responded,
'Not Hired'→Rejected, etc.) for the employer side; the external tracker's own rich vocabulary
(`EXT_MAP`) for imported rows (which already carried Interviewed/Final Interview/etc.). Exports
`MAIN_STAGES`, `ALT_STAGES`, `CANONICAL_STAGES`, `INTERVIEW_STAGES`, `TERMINAL_STAGES` + `canonicalStage`;
`PipelineAnalyticsChart` derives its palette from the shared colour system (see §28.5) so chart ↔
page ↔ KPIs can't drift. KPIs: interviews = any INTERVIEW_STAGE, active = not TERMINAL, responseRate
excludes Applied/Pending/No-Response. **PESO-referred apps reach only what `referral_outcomes` records
today (up to Interview Scheduled + terminal)** — the interview SUB-stages populate from imported rows;
enabling PESO apps to record them was the deferred Option B (append-only enum + recorder change).

### 28.5 Card-based My Applications + pin/colour/bulk + restored Dashboard table (2026-08-07)
My Applications moved from a vertical list to a **card board** reusing the Saved Vacancies toolkit
(no parallel impls): `useMultiSelect`, `SelectCheckbox`, `BulkActionBar`, `useTrashAction`
(`type:'applications'`), `PinButton`/`ColorLabelPicker`/`cardTheme`/`pinnedFirst`, `Pagination`/
`useClientPagination`, `EmptyState` + layout-aware skeleton.
- **Multi-select is IMPORTED-only** (bulk STATUS via new `PUT /tracked-jobs/bulk/status` — atomic,
  owner-scoped, trash-aware; bulk DELETE → Trash). PESO cards read-only. The checkbox must ENTER
  select mode on first tick — `onToggleSelect={(uid)=> ms.selectMode ? ms.toggle(uid) : ms.enterWith(uid)}`
  (plain `ms.toggle` never sets `selectMode`, so the `BulkActionBar` — gated on `selectMode && count>0` —
  never appeared; matches the Saved Vacancies pattern). Grid is a fixed 4-col ladder
  (`grid-cols-1 sm:2 lg:3 xl:4`); default page size **12** (`PAGE_SIZE_OPTIONS=[12,24,48,96]`, three rows).
- **Pin + colour work on EVERY card** (owner-chose all-apps) via **migration 037**
  `application_preferences (user_id, app_uid, is_pinned, color_label)` keyed by the unified uid +
  **`PATCH /api/applications/:uid/preferences`** (validated, upsert). The `/unified` feed LEFT-reads
  prefs **best-effort** (page survives pre-migrate). Pin/colour NEVER touch job_applications/referrals
  (guard: `applicationPreferences.test.js`). `pinnedFirst` floats pinned across pages. Optimistic via
  hook `mutateLocal`.
- **Single status colour system**: `STAGE_STYLE` + `statusHex`/`statusBadgeClass`/`statusRank` +
  `EXTERNAL_STATUSES` now live in `useUnifiedApplications` and are consumed by the chart (`hex`), the
  cards + the Dashboard table (`badge`) — one entry per canonical stage, add a stage here not per-file.
- **Dashboard "All Your Applications" table RESTORED** (was reduced to a link) but rebuilt over the
  unified `jobs` feed: `TrackerTable`/`sortRecords`/`filterRecords`/`compareRecords`/`SortIndicator`/
  `TRACKER_*` + persisted `tableSort`/search/stage-filter + `visibleRecords`/`statusCounts`/
  `presentStatuses` + shared `Pagination`. Status cell is an EDITABLE dropdown for imported rows
  (`handleUpdateTrackerStatus` → `/tracked-jobs`) and a READ-ONLY badge for PESO (same colour, default
  cursor). `RecentAppItem` still deep-links to `/my-applications`. KPIs stay from `computeUnifiedMetrics`.
- **Unified Bulk Actions Toolbar (UI consistency):** the old delete-only `SelectionBar` shell was
  RETIRED — Saved Vacancies AND My Applications now both render the shared `BulkActionBar` +
  new shared `BulkDeleteButton` (both in `common/AdminUI`), so the toolbar is one design language
  (bg `accent-text/10`, border `accent-text/30`, sticky, blur, `slide-in-from-top-2`). `SelectCheckbox`
  stays in `jobs/SelectionBar.jsx` (shared by 5 modules); only the toolbar component moved. Behaviour
  unchanged (same count / select-all / cancel / delete handlers). Do NOT reintroduce a second bulk toolbar.
- **Migration 037 APPLIED (owner-confirmed 2026-08-07)** — pin/colour persist. `npm test` = **51**
  (adds `applicationPreferences.test.js`); build + whole-`src` ESLint `no-undef` scan clean.

## 29. AI re-scoring change-detection guard — input-hash short-circuit (2026-08-08)

A trigger-condition optimization for the AI compatibility scorer: re-scoring now runs only on a
MEANINGFUL content change — WITHOUT decoupling the Resume Assistant → scoring sync, which is core
business logic (§7.4, §18.5), not an implementation detail. On `main` (uncommitted at authoring);
migrations `038`+`039` on disk, **NOT yet applied** (ship-dark, owner applies). `npm test` = **67**
(adds `test/scoringInputHashGuard.test.js`, `test/proactiveInputHashGuard.test.js`).

### 29.1 The problem + the trap it avoids
Both AI-scoring workers ALWAYS called DeepSeek on a re-arm, even when the scoring inputs were
byte-identical (a résumé re-uploaded unchanged; a job edit that touched no scoring field; the
always-re-score `/resume/upload` path). A server-side dirty-check was tried once (`2464403`, §18.5)
and REVERTED for silently swallowing real re-scores — because it gated **scheduling** (skip the
enqueue). This guard gates **execution** instead: a mistake costs one redundant AI call, never a
dropped score. **Correctness-preserving, not a heuristic:** scoring is DETERMINISTIC (temp 0 + JSON
mode, §21), so identical inputs yield the identical score — skipping produces the same number.

### 29.2 The shared mechanism (`services/aiScoringService.js`)
- `buildScoringPrompt({ resume, job, extraContext })` — extracted the prompt assembly;
  `scoreApplication()` now scores this exact string.
- `computeScoringSignature({ resume, job, extraContext })` — SHA-256 of the **whitespace-normalized
  assembled prompt**. Because it is built from the SAME builder, the hash captures EXACTLY the scored
  inputs and can never drift from scoring; whitespace-/formatting-only changes normalize away (the
  "ignore cosmetic changes" requirement); a job edit DOES change it (same résumé, new criteria →
  re-scores); returns NULL when there is no résumé (never treated as "unchanged").

### 29.3 Application scoring worker (migration 038, flag `SCORING_INPUT_HASH_GUARD`)
`job_applications.last_scored_input_hash CHAR(64)`. In `applicationScoringWorker.processJob`, AFTER
the finalized/ineligible guard and BEFORE the AI call: fetch the résumé once, sign, and if the
signature `=== last_scored_input_hash` → `completeWithoutScore('skipped — inputs unchanged')` (no AI
call; job completes; live score kept). Else score (reusing the résumé — no double read) and
`markScored(…, inputSignature)` records the new hash. The hash is written ONLY on a SUCCESSFUL score
(a NULL/skip never updates it — an AI outage can't poison the baseline). `findApplicationForScoring(id,
includeHash)` + `markScored(…, inputHash=null)` reference the column ONLY when supplied → **deploy-safe
before the migration**. Test: `test/scoringInputHashGuard.test.js` (9 guards).

### 29.4 Proactive matcher (migration 039, flag `PROACTIVE_INPUT_HASH_GUARD`)
`proactive_referral_candidates.last_scored_input_hash CHAR(64)`, same posture per (job, applicant) in
`proactiveReferralService.matchJob`: `generateCandidates(…, { includeHash })` exposes each existing
candidate's last hash via a correlated subquery; the loop signs each candidate's inputs (**extraContext
null** — proactive has no application/certs) and `continue`s (skip, keep the existing suggestion) on a
match; else scores (reusing the résumé) and `upsertCandidate({ …, inputHash })`. The §20 no-resurrection
invariant holds (ON DUPLICATE still never writes `status`). Test: `test/proactiveInputHashGuard.test.js`.

### 29.5 Contract integrity (unchanged across the chain)
`parsed_text` persistence stays UNCONDITIONAL (the ATS résumé view ↔ scorer input never desync); the
client `rescore` flag (§18.5) stays as the cheap FIRST gate — the input-hash is the authoritative
SECOND gate (defense-in-depth; neither can swallow a real change). Apply-time immutable columns
(COALESCE), NULL-handling (0.2), the finalized-referral exclusion (§18.5), staging (0.4), and the whole
referral pipeline are untouched. On a skip, the Applicant Pipeline / Smart Referral Queue / AI-Recommended
rankings keep the deterministically-identical score.

### 29.6 Deploy sequence (each guard independent, ship-dark) — NOW LIVE IN PROD
`npm run migrate` (applies 038 + 039), then set `SCORING_INPUT_HASH_GUARD=true` and/or
`PROACTIVE_INPUT_HASH_GUARD=true` on Render (retype — no trailing space, §13). Behaviour is
byte-identical to before until enabled. Rollback = flip the flag off (no deploy); the additive columns
stay. Env flags default OFF via strict `=== 'true'`.
**STATUS (2026-08-08): migrations 038/039 APPLIED and BOTH flags set `true` in the Render environment —
the guards are LIVE and owner-verified working.** Confirmed on Render by the log line
`[ScoringWorker] Application N … skipped — inputs unchanged` firing with NO DeepSeek call on a redundant
re-score (the definitive proof: flag on AND the guard short-circuited correctly).
**Boot-log observability (`e31e826`):** both workers now log `input-hash guard ON|OFF` at startup
(`[ScoringWorker]` reads the module-level `INPUT_HASH_GUARD`; `[ProactiveWorker]` reads
`process.env.PROACTIVE_INPUT_HASH_GUARD`) — so "is it actually on?" is answerable from the boot log; an
unexpected `OFF` means the §13 trailing-space trap. Pure observability, no behaviour change.

Files: `services/aiScoringService.js`, `repositories/applicationScoringRepository.js`,
`services/applicationScoringWorker.js`, `repositories/proactiveReferralRepository.js`,
`services/proactiveReferralService.js`, `migrations/038_scoring_input_hash.sql`,
`migrations/039_proactive_scoring_input_hash.sql`, and the two test files.

### 29.7 Also this session (planning only — no behaviour change)
The **Document Builder platform** blueprint — `docs/document-builder-platform-plan.md`: unify the three
Job Seeker builders (Resume/Cover/Resignation) into one framework with a Template Gallery + live
**react-pdf** WYSIWYG preview + streamlined nav (remove the AI/Manual intermediate modal). Its §12 is a
HARD CONSTRAINT binding all builder work to preserve this Resume→scoring sync. Not yet started; the
five-phase roadmap (Phase 0 spike → Phase 4 polish) is in the doc. **(Now BUILT — see §30.)**

## 30. Unified Document Builder platform — SHIPPED + draft/AI fixes (2026-08-08)

The blueprint (§29.7, `docs/document-builder-platform-plan.md`) was BUILT through all five phases and
shipped. On `main`, pushed (HEAD `ee0da67`; builder platform `d186069`+`60ee140`, fixes `ee0da67`).
`npm test` = **74**; frontend `npm run build` clean. UI reference: `references/ui-ux-and-responsive-layout.md` §16.

### 30.1 The unified framework (replaces the 3 wizards)
ONE schema-driven framework in **`job-tracker-frontend/src/components/builder/`** serves résumé, cover
letter, and resignation via a `docType` prop — the near-duplicate `ResumeBuilder`/`CoverLetterBuilder`/
`ResignationBuilder` (~1700 lines) were DELETED. Files:
- `DocumentBuilder.jsx` — shell: Template Gallery → editor (forms + live preview) with AI woven in → export.
- `documentSchemas.jsx` — the 3 doc definitions (sections/fields, draft endpoints, AI actions, empty state,
  résumé `aiSignature`, export); `getPath`/`setPath`.
- `SchemaForm.jsx` — renders forms from a schema (group + repeater sections, photo control, inline AI
  improve/generate + accept/redo/discard).
- `TemplateGallery.jsx` — cards (thumbnail placeholder, name, description, use case, ATS badge, Modern/
  Professional category).
- `LivePreview.jsx` — react-pdf `<PDFViewer>` + `exportPdf()`/`triggerDownload()`.
- `docxExport.js` — DOCX from the same structured data via the `docx` lib.
- `useDocumentDraft.js` — change-driven autosave (generalized from ResumeBuilder; preserves the résumé
  `rescore` flag, §12/§18.5).
- `useDocumentAI.js` — prefill / generate / improve (suggestion) / translate, per schema.
- `templates/` — react-pdf template registry: `resumeTemplates` (Modern + Professional),
  `coverLetterTemplates` + `resignationTemplates` (over the shared `letterShared.LetterDocument`), `index.js`.

**Nav:** `/builder`, `/cover-letter`, `/resignation-builder` all render `DocumentBuilder`. Dashboard doc
buttons go STRAIGHT to the gallery — the **`CreationModal` (Create with AI / Manually) + `?mode=ai|manual`
branching are removed**; AI and manual are integrated modes in one workspace. A4/US-Letter toggle, mobile
Edit/Preview toggle, change-template-mid-edit, design tokens.

**Rendering decision (Phase 0 verified GO in-browser):** `@react-pdf/renderer` client-side — the SAME
template component drives the live preview AND the PDF export (preview == export, no drift), no server
Chromium (fits Render's free tier). Both react-pdf and `docx` are route-lazy (~592 KB gz builder chunk;
main entry unchanged). **`src/bufferPolyfill.js`** (imported FIRST in `main.jsx`) sets `globalThis.Buffer`
— react-pdf decodes an embedded résumé photo `<Image>` with Node's `Buffer`, absent in the browser;
without it, exporting a résumé WITH a photo throws "Buffer is not defined". Verified: photo export → valid
PDF, zero console errors.

**§12 HARD CONSTRAINT (held):** the résumé stays structured JSON; `/resume/draft` (incl. the `rescore`
flag) is UNCHANGED, so the AI compatibility scoring / ATS sync is untouched. Templates render FROM the
model; never replace it. Do NOT re-add the 3 builders, the modal, `?mode=`, freeform rich text, or a
server renderer.

### 30.2 Fix — cover-letter draft persistence (dup-row bug)
Reported: cover-letter autosave fires but the draft doesn't restore on revisit (empty editor). Root cause
was BACKEND, pre-existing: **`cover_letter_drafts.user_id` is only a NON-UNIQUE (FK) index**, so
`INSERT ... ON DUPLICATE KEY UPDATE` never updated → every save inserted a NEW row (read-only prod probe:
**325 rows / 10 users**, one user 157), and the GET's unordered `drafts[0]` returned a stale/empty row.
The old non-change-driven builder also saved EMPTY drafts on revisit, so a user's newest row was often
blank. Fix (`routes/coverLetterRoutes.js`, **no migration**):
- **POST** manages ONE row explicitly (count → update / insert) and COLLAPSES duplicates (delete-all +
  insert) so a polluted user self-heals to a single row on their next save. No `ON DUPLICATE KEY`.
- **GET** scans the recent rows (`ORDER BY updated_at DESC LIMIT 50`) and returns the newest with a
  **non-empty body** (fallback newest) — RECOVERS work lost to the bug. Read-only-verified: affected users
  recover their real letters (1.4k–1.8k chars); a user who never wrote a body correctly returns empty.
Résumé/resignation never had this (they already use SELECT→UPDATE/INSERT). The historical dup rows are
harmless and shrink to one per user as each user next saves; a bulk purge was intentionally NOT run against
live prod. Optional future hardening: a UNIQUE(user_id) after all users self-heal.

### 30.3 Fix — resignation "Generate Body with AI" (parity via a shared service)
Resignation lacked the cover letter's generate-from-scratch. Added a **single reusable service**
`services/letterBodyService.js` (`generateBody` — unified `aiClient`, DRAFT tier + failover — plus
`coverLetterPrompt`/`resignationPrompt`). Cover letter's `/generate-body` was refactored onto it
(byte-identical output); resignation gained `POST /resignation/generate-body` using it. The resignation
schema declares `ai.generate` + a `generate:'generate'` body section + a new "Reason for leaving" field,
so the generic `SchemaForm` renders the button with ZERO component changes. **Each `/generate-body` is hit
ONLY by its own builder** (one click = one request; the shared SERVICE is code reuse, it does NOT cause
both routes to fire — the `DocumentBuilder` is mounted with one `docType`, and `useDocumentAI` posts only
`action.endpoint` from the current schema). Generate applies directly; the existing Refine (accept/discard)
and autosave are untouched (manual edits preserved).

### 30.4 Tests + invariants
`test/documentBuilderDrafts.test.js` (source-only, 7 guards): cover POST has no `ON DUPLICATE KEY` and does
count→update/insert + collapse; GET prefers the newest non-empty body; `letterBodyService` exports the
shared API and both routes reuse it; resignation exposes `/generate-body`; the resignation schema gained the
generate action + generatable body. Invariants held: 0.1 (autosave/AI degrade, never fail the primary
action), 0.2 (AI returns real-or-nothing), §12 (résumé structured-JSON → scoring sync), and "one draft per
document" (cover letter now enforced in the route).

## 31. Office-interview requirements — Phases 1–6 + Positions-Not-Specified (2026-08-23)

The PESO Kabankalan **office-interview** cycle (Mr. Tejada — publication staff; Ma'am Elma — Manager).
All on `main`, **pushed** (HEAD `dd8a7e3`; commits `f94b86b` Phases 1–4+Events, `d36bbdf` Positions,
`b8b59c9` Phase 5, `e39e46a` Phase 6, `dd8a7e3` settings-fix + D6). Migrations **040–043 APPLIED** in prod
by the owner. `npm test` = **97**. Every behavior-changing referral/vacancy feature is **flag-gated OFF by
default** (prior behavior preserved). Full blueprint + per-item impact: `docs/office-interview-requirements-analysis.md`.

**Deploy verified (public-endpoint, §13):** prod `/job-board/stats` returns `{jobs,hires,partners,referrals}`
with NO `users` field → the office-interview code is live on Render.

### 31.1 Phase 1 — landing, navigation, JPM field removals, mascot (frontend)
- Landing "Registered Job Seekers" tile REMOVED and `/job-board/stats` no longer returns `users` (Sir
  Tejada). Underlying user data untouched; the count stays behind auth via `/admin/metrics`.
- **Home button** across the shared nav: a non-redirecting **`/home`** route renders `LandingPage` for
  authenticated users (the `/` route redirects them to their dashboard, so a dedicated path was needed);
  button added to `TopHeader`, the mobile `Sidebar` bar, and `SuperAdminSidebar`; the landing shows a
  role-aware "Back to Dashboard" when authenticated. Frontend routing only, no API.
- **Job Publication Manager fields removed:** Department, Work Setup, the whole Description & Accommodations
  section, and Additional Questions. Columns are KEPT (§0.7); the questions **save** (a replace-all) was
  removed so an edit can't wipe a job's existing questions. Backend needed no change — `initialJobState`
  still carries the four keys so the payload stays complete (no undefined binds). ⚠ Removing `description`
  (D1, owner-chosen "remove as written") weakens an AI-scoring input; the scorer already reads
  `job.description || ''` so it degrades gracefully.
- **Mascot replaced:** the Gebbie bunny → a job-seeker mascot (`components/JobSeekerMascot.jsx`, inline SVG
  reusing the existing `.gebbie-*` CSS rig — class names kept to avoid touching the landing template
  literal). The landing hero component was renamed `HeroMascot`; the "Gebbie" persona name is RETIRED
  (chatbot launcher → "Ask PESO Assistant"; header → "PESO Assistant"). `GebbieMascot.jsx` deleted.

### 31.2 Phase 1.5 — Gender job field + AI scoring-input refinement (#11a, migration 040)
- **Gender** added as a JOB qualification field (`pesoadmin_job_posts.gender VARCHAR(20)`, migration 040) +
  a select in the Requirements & Qualifications section. `users.gender` ALREADY existed (seeker profile
  writes it, `profileRoutes`), so no seeker migration.
- **Scoring prompt refined** (`aiScoringService.buildScoringPrompt`): explicit rules that the employer's
  STATED requirements are authoritative; **certificates and unspecified qualifications are NOT mandatory**
  (absence must not lower the score); a stated gender is weighed as a preference (evaluated against the
  résumé — candidate gender is sourced from the résumé, NOT `users.gender`, to preserve §18.5). Cert
  context (C.3) reweighted, NOT removed **(SUPERSEDED 2026-08-25 §40 — the cert SCORING path is now fully REMOVED; certs are evidence-only)**. `pj.gender` added to `findApplicationForScoring` + the proactive
  job SELECT (board `/match` + apply-time use `SELECT *`). Measured via a new `employer-criteria` eval
  variant (`scripts/eval-scoring.js`): **100% band accuracy, 0 FP/FN preserved** (MAE 4.3→6.4 from more
  decisive extremes, not misclassification). The prompt change re-computes the §29 input-hash baselines
  once (expected).

### 31.3 Phase 2 — PESO Staff / Co-Worker RBAC (#1b/#9, NO migration)
`users.role` is VARCHAR (migration 003), so a new role is code-only.
- New role **`peso_staff`** ("PESO Staff") in `middleware/rbac.js` (ROLE_KEYS/LABELS/PERMISSIONS/ALIASES) +
  the frontend mirror `src/utils/roles.js` (normalized BEFORE `peso_administrator`, §0.15). Least privilege:
  permissions `jobs:manage` + `events:manage` only. Assignable by a Super Admin (added to
  `roleAdminService.ASSIGNABLE_ROLES`; the account-matrix badge + filter added).
- **Deny-by-default router guard** in `pesoAdminRoutes`: both roles reach the router
  (`requireRole(PESO_ADMINISTRATOR, PESO_STAFF)`), then a guard restricts `peso_staff` to `/jobs*` (excluding
  `/questions`) — every other endpoint (ATS, referrals, analytics, proactive, office profile, walk-in) is
  Manager-only automatically, so a NEW Manager endpoint is closed to staff without extra work.
- **D2 ownership:** `req.effectiveOwnerId` (Manager → self; staff → the office Manager, i.e. the first
  `peso_administrator`) is computed once per request; all job ops (list/create/edit/delete/image/bulk +
  dup-check) key on it, so staff-published vacancies land in the Manager's owner-scoped ATS/referral
  pipeline with no break. The AUDIT actor stays the real staff user. Single-office assumption documented
  (a multi-Manager office would add a per-staff manager link). Frontend: `/peso-admin/jobs` allows both
  roles; general routes (settings/notifications/board) include `peso_staff`; referral/messaging routes
  exclude them; root + ProtectedRoute redirect staff → `/peso-admin/jobs`; the staff sidebar shows only Job
  Publication Management. Guard test `test/pesoStaffRbac.test.js`.
- Also added a reusable **`requirePermission(...perm)`** guard to `rbac.js` (capability-based; used by events
  + walk-in) so access rules live in the RBAC map, not per-page.

### 31.4 Phase 3 — Events / Announcements subsystem (#2, migration 041)
Extensible `peso_events` (migration 041 — `event_type` discriminator `job_fair`/`recruitment_drive`/
`seminar`/`orientation`/`general`; **base64 banner** LONGTEXT, durable §0.5; status Draft/Published/
Cancelled/Completed). `repositories/eventRepository.js` (list payloads INCLUDE the banner so cards render
inline — events are low-volume) + `routes/eventRoutes.js` (public read; `events:manage` CRUD via
`requirePermission`). **First publish broadcasts a new `EVENT_ANNOUNCEMENT`** to every seeker via
`notifyAllJobSeekers` (a `published_at` gate prevents re-notifying on re-publish); muteable
(`CONTROLLABLE_TYPES` + `NotificationBell.TYPE_META`, deep link `/events`). Frontend: seeker `Events.jsx`
(rich cards: banner, type, date-derived status, venue, short description + detail modal) and Manager/Staff
`PesoEventManager.jsx` (CRUD + lifecycle + client-downscaled banner upload); nav for seeker + Manager +
Staff. Guard test `test/eventsSubsystem.test.js`. Mounted `/api/events` in `server.js`.
**Also surfaced on the PUBLIC Landing Page (2026-08-24, §34)** — a two-row horizontal carousel reusing the
SAME `GET /api/events` + `banner_image`; `listPublished` gained optional `{ scope:'upcoming', limit }`
(banner still always included; no duplicate image path).

### 31.5 Phase 4 — seeker referral ACCEPTANCE (#6) + vacancy DE-AUTOMATION (#11b), migration 042
Two independent flags: **`referral_acceptance_enabled`** and **`vacancy_manual_fill_enabled`** (both OFF =
today's behavior). Migration 042 APPENDS two referral states (`Pending Seeker Acceptance`, `Declined` —
append-only enum, §13).
- **#6:** `approveReferral` branches — when acceptance is ON it ENDORSES into `Pending Seeker Acceptance`
  (no letter, no outbox, no ATS change) and notifies the seeker (new muteable `REFERRAL_ENDORSEMENT`); the
  official letter is minted only when the seeker ACCEPTS. New owner-scoped `acceptReferral` /
  `declineReferral` (routes `POST /referrals/:id/accept|decline`, flag-gated); ACCEPT runs the SAME
  approval tail as a direct approval — extracted into `finalizeApprovedReferral()` so the OFF path is
  byte-identical. `listForApplicant` broadened so the seeker SEES pending/declined referrals (safe when
  OFF — those states don't exist yet). Seeker Accept/Decline UI in `Referrals.jsx` (`AcceptanceActions`).
- **#11b:** the vacancy cap becomes ADVISORY (no 409) and auto-fill is SKIPPED when manual-fill is ON — a
  vacancy is `Filled` only by a PESO-confirmed status (via the existing job edit-form status dropdown; no
  new endpoint). Frontend `isJobFilled`/`savedJobState` are flag-aware via a new synchronous
  `utils/featureFlags.js` cache (fed by `AuthContext`): under manual-fill, "Filled" keys on confirmed
  status, never the referred count.
- `services/deliveryState.js` gained `awaiting_acceptance` + `declined` buckets (SQL + JS in lockstep, §14);
  `Referrals.jsx` `deliveryState`/`STATE_META` mirror them. `/config/features` exposes both flags. Guard
  test `test/referralAcceptance.test.js`. **D6 soft-warn (later, `dd8a7e3`):** `ReferralActionButton` warns
  before referring past a job's stated headcount when manual-fill is ON (the case where the referral
  proceeds instead of a 409); no warning for an unspecified/NULL headcount; degrades silently where capacity
  isn't in scope.

### 31.6 Positions Available — "Not Specified" (`d36bbdf`, no migration)
`positions_available` is already nullable → **NULL = unspecified** (some employers give no headcount). A
JPM checkbox "Multiple / number not specified" sets NULL; shown as "Multiple / Not specified" on the JPM
card, Public Job Board detail, and job-seeker details (shared `positionsLabel()` in `jobs/JobCard.jsx`).
Lifecycle: NULL is NEVER treated as 0/1 — the referral cap + auto-fill skip it (`unspecifiedCapacity`
guard in `referralService`), the apply gate no longer blocks it (`applicationRoutes`), and
`isJobFilled`/`savedJobState`/`filledLabel` are NULL-aware (never count-filled; plural label). AI scoring is
unaffected by design — `positions_available` is capacity, never a scoring input.

### 31.7 Phase 5 — Walk-In Job Seeker registration (#7, migration 043, flag `walk_in_registration_enabled`)
Ma'am Elma: staff encode a physical visitor into the SAME centralized seeker model — a REAL `users` row
(role='applicant'), NOT a separate store. Migration 043 (additive): `account_origin`/`claim_status`/
`encoded_by`/`claim_token`/`claimed_at`/`consent_given_at`. `services/walkInService.js` creates a claimable
row (`account_origin='walk_in'`, `claim_status='unclaimed'`, unusable random bcrypt password + a UNIQUE
placeholder email when none, minted claim token, DPA consent) with **duplicate detection** (same phone/email
= strong, same name = weak) before creating a second account; audited (`WALKIN_CREATED`/`WALKIN_CLAIMED`
added to `adminAuditService`). Endpoints `POST /peso-admin/walk-in` + `/walk-in/duplicate-check`
(`walkin:manage` — Manager only; staff denied by the §31.3 guard — flag-gated). Staff form
`WalkInRegistration.jsx` (personal/contact/skills + consent + duplicate review + claim code) + Manager nav.
Guard test `test/walkInRegistration.test.js`. **Deferred follow-ups:** the account-CLAIM endpoint (seeker
links the row via the claim token) and encoding an application against a specific job at registration time.

### 31.8 Phase 6 — SMS channel: evaluation + provider abstraction (#8, proposal-first)
Per the office ("do not implement SMS blindly"), delivered the architecture + provider evaluation, NOT a
blind integration. `docs/sms-notification-proposal.md`: channel-based router (Event → notificationService →
In-App always / Email if verified / SMS if verified+opt-in — no per-channel duplication), provider eval
(**Semaphore** PH-local recommended to spike first; Twilio fallback) with cost/limits/delivery-status/
retry/consent/verification/templates/audit, the `sms_outbox` + phone-verify/opt-in data model (a 7th outbox
worker, §7.5), and a flag-gated rollout. `services/smsService.js` = the swappable provider abstraction
(`sendSms`/`isSmsConfigured`, provider chosen by `SMS_PROVIDER`; Semaphore + Twilio skeletons + an inert log
provider; `toE164PH`; never throws, §0.1) — ships DARK (unset ⇒ logged no-op), NOT wired into the send path.
**Pending (owner is choosing a provider):** the one `send()` HTTP call, the `sms_outbox`/verify migration +
`smsWorker`, the channel router in `notificationService`, and the phone-verification UI.

### 31.9 Settings-registration FIX (`dd8a7e3`) — the important bug
The three new flags (`referral_acceptance_enabled`, `vacancy_manual_fill_enabled`,
`walk_in_registration_enabled`) were read via `systemSettings.get()` but never added to the
`systemSettingsService` **`DEFINITIONS` catalogue** — and `get()` THROWS on an unregistered key. So the
flags could not appear in the Super Admin Settings screen, could never be turned on, AND `/config/features`
(which `Promise.all`s them) was rejecting → reporting ALL features off, including the existing
`referral_lifecycle_sync`. **Fix:** register all three booleans in `DEFINITIONS` (Super-Admin-readable
label/help). LESSON: every runtime flag read via `systemSettings.get()` MUST have a `DEFINITIONS` entry or
`get()` throws — registering it is also what surfaces it in the Settings UI (`getAll()` iterates
`DEFINITIONS`).

### 31.10 New system settings, flags, notification types, docs (this cycle)
- **System settings** (all §7.12, read per call, DB→env→default, default OFF): `referral_acceptance_enabled`
  (`REFERRAL_ACCEPTANCE_ENABLED`), `vacancy_manual_fill_enabled` (`VACANCY_MANUAL_FILL_ENABLED`),
  `walk_in_registration_enabled` (`WALK_IN_REGISTRATION_ENABLED`). Exposed to the client via
  `/config/features` (`referralAcceptance`/`vacancyManualFill`/`walkInRegistration`).
- **New notification types:** `EVENT_ANNOUNCEMENT` (→ `/events`), `REFERRAL_ENDORSEMENT` (→ `/referrals`).
  Both muteable + in `TYPE_META`.
- **New RBAC permissions:** `events:manage` (Manager + Staff), `walkin:manage` (Manager). New guard
  `requirePermission`.
- **New env (SMS, inert):** `SMS_PROVIDER`, `SEMAPHORE_API_KEY`, `TWILIO_*`.
- **New docs:** `docs/office-interview-requirements-analysis.md` (the 15-dimension impact analysis + phased
  roadmap), `docs/sms-notification-proposal.md`.
- **Tests added:** `pesoStaffRbac`, `eventsSubsystem`, `referralAcceptance`, `walkInRegistration` (npm test 97).

## 32. Office-interview follow-ups — SMS channel, Walk-In claim, sidebar refactor, Identity-ID removal (2026-08-23)

The follow-up cycle after §31. Four independent workstreams, committed atomically by phase on `main`
(SMS isolated in its own commit). `npm test` = **118** (adds `smsChannel`, `walkInClaim`,
`identityIdRemoval`). Frontend `npm run build` clean. Everything new ships behind a flag / dark by
default — prior behaviour is preserved. Blueprint for the SMS parts: `docs/sms-notification-proposal.md`.

### 32.1 SMS notification channel — full architecture, provider-agnostic, PRODUCTION DEFERRED
The complete SMS delivery channel behind a swappable provider abstraction (the SMS twin of the email
outbox). **Migration 044** — `sms_outbox` (7th outbox, §18.1), `phone_verifications`,
`users.phone_verified_at`/`sms_opt_in`. `services/smsService.js` is the ONLY place a provider lives:
`semaphore` (production, wired: form-encoded `POST /api/v4/messages`, number sent WITHOUT the leading
`+`, optional `SEMAPHORE_SENDER_NAME`), `twilio` (ready stub), and **`console`/`log`** — a ZERO-COST
DEV provider that "delivers" to the server log (OTP visible) so the whole workflow is testable without
credits. `smsOutboxRepository`/`smsOutboxService`/`smsWorker` mirror the email outbox exactly (atomic
claim, backoff, dead-letter, stuck-reclaim; self-gates on `isSmsConfigured()` → dormant when no
provider). `phoneVerifyService` = OTP-to-phone reusing the §7.9 discipline (peppered SHA-256, TTL,
attempt caps); opt-in requires a verified phone. **Channel router in `notificationService`**: after the
durable in-app row (§0.11), best-effort SMS fan-out for **referral events ONLY** (`REFERRAL_ISSUED`,
`REFERRAL_ENDORSEMENT` — `smsTemplates.SMS_FANOUT_TYPES`) to a recipient who is BOTH verified AND
opted-in, gated by the `sms_notifications_enabled` system setting; never throws (0.1), dedupes per hour.
Surfaces: `POST /profile/phone/verify/start|confirm` + `PUT /profile/phone/opt-in`, seeker
`components/profile/SmsAlertsCard.jsx` (Profile → Portfolio, shown when `features.smsNotifications`),
Super Admin **SMS Delivery** monitor `/admin/sms` (numbers masked) + resend + `/admin/health` `smsOutbox`
probe. `sms_notifications_enabled` registered in `systemSettingsService.DEFINITIONS` (§31.9 rule) +
exposed via `/config/features` as `smsNotifications`. A profile phone CHANGE resets
`phone_verified_at`/`sms_opt_in` (compared via `toE164PH`, so a format-only change does NOT reset).
**DEFERRED (funding, NOT code):** production Semaphore is on hold — account is Pending + unfunded
(credits ≈ ₱2,800/5,000). Kept fully intact; resume = fund/activate the account, set
`SMS_PROVIDER=semaphore`+`SEMAPHORE_API_KEY`, enable the flag (`docs/sms-notification-proposal.md` §6a).
For dev/testing now: `SMS_PROVIDER=console`. Env: `SMS_PROVIDER`, `SEMAPHORE_API_KEY`,
`SEMAPHORE_SENDER_NAME` (optional — unset until a custom LGU sender name is approved), `SMS_OUTBOX_*`,
`SMS_OTP_*`, `SMS_HTTP_TIMEOUT_MS`, `TWILIO_*`.

### 32.2 Walk-In account CLAIM — the deferred half of §31.7 (migration 045)
Completes the walk-in lifecycle: **Staff encode → claimable `users` row → seeker claims with the code →
linked to the EXISTING record (never a duplicate) → normal workflow.** **Migration 045** — claim expiry
+ reissue tracking. `users.claim_token` now stores a **peppered SHA-256 HASH** (raw readable code
`XXXX-XXX-XX` shown once); default 30-day expiry (`WALKIN_CLAIM_TTL_DAYS`). `walkInService`:
`startClaim` (validates code; if a phone is on file AND SMS is configured, texts a one-time phone OTP as
a SECOND ownership factor — else code-only), `completeClaim` (verifies the OTP when required; **email
must not belong to ANOTHER account** — the duplicate guard; sets the seeker's own email + bcrypt password
on the SAME row, `claim_status='claimed'`, `claimed_at`, clears the token; stamps `email_verified_at`),
`reissueClaim` (fresh code, invalidates the old, `WALKIN_CLAIM_REISSUED` audit), `listUnclaimed`,
`textClaimLink`. Public `POST /auth/claim/start` + `/claim/complete` (signs the seeker in — same session
contract as `/login`; deliberately NOT flag-gated so an issued code stays claimable). Manager
`GET /peso-admin/walk-in/unclaimed` + `POST /walk-in/:id/reissue`. Public `/claim` page
(`ClaimAccount.jsx`); `WalkInRegistration.jsx` shows the code + claim URL + optional "text the claim
link" + a pending-claims/reissue panel. **Works fully with SMS disabled** (no provider ⇒
`requiresPhoneOtp=false` ⇒ code-only claim). Deferred still: encoding an application against a specific
job at registration time.

### 32.3 Sidebar navigation refactor (frontend-only, no route/RBAC change)
Grouped the long flat nav into workflow sections using the existing `isDivider` mechanism (added divider
rendering to `SuperAdminSidebar.jsx`, which had none). **Job Seeker:** Overview · Jobs & Opportunities ·
Applications · Communication · Profile & Tools. **PESO Manager:** Overview · Jobs & Events (Walk-In
appears here when enabled) · Applicants & Referrals · Organization · Communication. **PESO Staff:** left
FLAT (2 items — grouping would be noise; "don't force uniformity"). **Super Admin:** Overview ·
Governance · Operations (incl. the new SMS Delivery) · Insights. Grouping is presentational; every route,
guard, and RBAC rule is unchanged (the Manager walk-in item moved inline into its group, replacing the
post-switch conditional push).

### 32.4 Identity Verification ID removed (code/UI only; DB dormant)
PESO confirmed capturing an identity ID TYPE is outside their workflow — removed everywhere in LIVE code,
DB columns/table LEFT DORMANT (not dropped, §0.7). This is the SECOND, separate removal after the Job
Seeker Verification approval workflow (§14). **Verified first:** the referral letter (`pdfService.js`)
never actually read the ID type — the "prints on the letter" note in older comments was stale, so removal
is safe. Removed: `GET /profile/verification/id-types`; the profile PUT writes to
`verification_id_type`/`pwd_category`; the two ATS `verification_id_type` selects (`pesoAdminRoutes`);
`applicantProfileService` `id_type`; `Profile.jsx` selector + `PHILIPPINE_ID_TYPES` + its state/fetch/
submit (completeness `strengthMetrics` re-weighted to sum 100); `ApplicantProfileDrawer` "ID Type" field;
vestigial `pwd_category` in the `LandingPage` auth form. LEFT UNTOUCHED (verified unrelated):
`accessibility_accommodations` (a job-post feature), `pwd`/`pwdStrength` (password), the RBAC
`verification:submit`/`verification:manage` permissions (part of the earlier decommissioned approval
workflow), and the dormant `verification_id_types` / `job_seeker_verifications` tables.

## 33. Refinement pass + Landing illustration carousel (2026-08-23)

Second cycle on 2026-08-23, **committed + pushed to `main`** in 6 atomic commits
(`715bcd1`→**`b828a4d`**); `npm test` = **118**; migration **046 APPLIED + owner-verified**.
A 7-item refinement pass (owner-specified) plus a Landing-page illustration system built with
the Streamline MCP. No unrelated business logic, referral scoring, or workflows changed.

### 33.1 Account suspension — ENFORCED SERVER-SIDE (item 4, migration 046) — the security fix
Previously `account_status='Suspended'` was only honoured by the FRONTEND — a suspended account kept
full access on its existing 7-day JWT, and login never checked status. Now:
- **`middleware/authMiddleware.js`** — after the JWT verifies, `requireAuth` does ONE PK lookup and
  rejects a Suspended account on EVERY request with `403 { code:'ACCOUNT_SUSPENDED', suspension:{…} }`.
  **Fail-OPEN on a lookup error** (a DB blip must not mass-lock everyone; the login gate is the primary
  barrier and this is defense-in-depth) and fail-open pre-migration. This one chokepoint closes the
  existing-session / direct-route / raw-API bypasses together (every protected router mounts it).
- **`routes/authRoutes.js` login** — checks status AFTER the password (never reveals account state to a
  wrong-password guess); a Suspended login returns the same 403 + notice instead of a token.
- **`api.js` interceptor** — on `ACCOUNT_SUSPENDED` (any request except `/auth/login`) it stashes the
  notice, drops the token, and redirects to `/?suspended=1` → the landing shows the notice. The login
  path is EXCLUDED so the login screen shows the notice inline (no reload).
- **Migration 046** (`users`: `suspended_at`/`suspension_reason`/`suspension_ends_at`/`suspended_by`,
  additive) — captured on suspend, CLEARED on reactivate. **No auto-reactivation** — a passed end date
  is informational; reactivation is a manual admin action.
- **`routes/adminRoutes.js` `/users/:id/status`** — accepts `reason` + optional `endsAt`, writes the
  metadata, audits with the reason, and NOTIFIES across channels (all best-effort, 0.1): in-app
  (`notifyUser` ACCOUNT_SUSPENDED / ACCOUNT_REACTIVATED), email (`buildStatusEmail` — full standardized
  notice via the outbox), and best-effort SMS (ACCOUNT_SUSPENDED added to `SMS_FANOUT_TYPES` +
  a template; only reaches a verified + opted-in phone — never a hard dependency). `/admin/users` gained
  a **status filter** + **sort** (joined_desc/asc, name_asc/desc) on top of the existing search/role.
- Frontend: `superadmin/features/accounts/SuspendDialog.jsx` (reason + optional end date; Activate stays
  one-click), status + sort selects in `UserAccounts.jsx`, the standardized notice modal + login-catch in
  `LandingPage.jsx`, `ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED` in `NotificationBell.TYPE_META` (NOT
  muteable). Test `test/smsChannel.test.js` updated for the new fan-out type.
- **Lifecycle-SMS follow-ups (2026-08-24):** (1) reactivation was missing from SMS —
  `ACCOUNT_REACTIVATED` added to `SMS_FANOUT_TYPES` so it fans out like suspension.
  (2) **Suspension SMS was suppressed on a repeat within the hour** — the fan-out dedupe
  key used an HOUR bucket, right for pipeline-double-fired referral events but wrong for
  deliberate admin actions; `maybeFanOutSms` now uses a **per-MINUTE** bucket for
  `ACCOUNT_*` types (hour bucket kept for referral events), so every real suspend/
  reactivate sends while an accidental double-submit is still de-duped. (3) **Actionable
  links** (new `utils/appUrl.js`, env-driven `FRONTEND_URL`→`CORS_ORIGINS[0]`→localhost,
  never hardcoded): referral/endorsement SMS deep-link to `/referrals`; the reactivation
  email + SMS carry a sign-in link to `/`. All links are plain app routes — no token, no
  auto-login (ProtectedRoute + server guards still enforce a session). Suspension SMS
  keeps the office-contact text (a blocked account cannot sign in, so no access link).
  (4) **Walk-in claim SMS** now carries an ABSOLUTE `/claim` link + code + an "open the
  link, enter the code to activate" instruction; `pesoAdminRoutes.claimBaseUrl()` routes
  through `appUrl('/claim')` (was a relative `/claim` fallback when `FRONTEND_URL` was
  unset locally — an unusable link). Claim generation/validation/expiry/reissue unchanged.

### 33.2 Smart Referral Queue — grouped by vacancy, ranked within vacancy (item 1)
The queue ranked candidates GLOBALLY across all of an admin's postings. Now candidates are grouped under
their specific Job Title and ranked ONLY against other candidates for that same vacancy (#1/#2/#3 per job).
New owner-scoped **`GET /peso-admin/proactive/candidates/grouped`** + repo methods
`listVacancyGroupsPage`/`countVacancyGroups`/`listCandidatesForJobs` (INNER-JOIN users so an orphan
candidate is never counted/shown) + service `listCandidateGroups`. **Pagination is BY VACANCY** so a
job's ranking never splits across pages. The flat `/proactive/candidates` endpoint + `listCandidates` are
RETAINED. `SmartReferralQueue.jsx` renders Job → ranked candidates (rank medals) and refer/dismiss update
within the group. Scoring logic untouched.

### 33.3 Delivery-log pagination + search (item 5)
`EmailDelivery.jsx` + `SmsDelivery.jsx` gained the shared `Pagination` + a search box + a status filter
(client-side over the recent window via `useClientPagination`, default 25/page), matching the other
client-paginated admin modules. No backend change.

### 33.4 Events skeleton loading (item 2)
`SkeletonEventCard` / `SkeletonEventGrid` added to the shared `components/Skeleton.jsx` (mirror the real
EventCard + responsive grid); replaced the full-page spinner in seeker `Events.jsx` and manager
`PesoEventManager.jsx`. Reduced-motion-safe, no layout shift.

### 33.5 Collapsed-sidebar tooltips (items 6/7)
Root cause: the collapsed nav item carried `overflow-hidden`, which CLIPPED its `left-14` hover tooltip —
so the seeker / PESO Admin / PESO Staff rails showed icons with no labels, while Super Admin (no
overflow-hidden) worked. Fix in `Sidebar.jsx`: remove the clip, add a tooltip to the footer Logout, add
`group-focus-visible` reveal + `title` for keyboard a11y; `SuperAdminSidebar.jsx` gained the same focus
reveal for parity. No redesign — the existing dark tooltip treatment now works everywhere.

### 33.6 TopHeader welcome illustration (item 3)
The seeker-only greeting became a compact **Welcome illustration** (`assets/illustrations/welcome.svg`,
a PESO-recolored Streamline SVG) leading, with the name kept as secondary text + the image `alt`. Pushed
left with `mr-auto` so it never disturbs other roles' right-aligned controls. Do NOT revert to text.

### 33.7 Landing illustration carousel (Streamline MCP) + Chatbot REVERT
The Streamline MCP (`claude mcp add --transport http streamline …`) was connected and used to source
illustrations. **Cleanup pass (2026-08-24):** the auth-modal illustration side was simplified for a more
professional look — the contextual speech **bubble/caption was removed** (with its dead `GEBBIE_MESSAGES`/
`getGebbieMessage`/state/effect), and the **decorative animated background** (the `gebbie-aurora` wash +
pink `#ffb84d`/violet `gebbie-orb` glows + `gebbie-float` dots + the white slide card) was **removed** in
favour of a **restrained static soft surface** (`bg-gradient-to-b from-[#f6f8f7] to-[#eef2f0]`). The 5-SVG
carousel now IS the full visual content of the panel (fills it, `object-contain`, no distortion); the
crossfade, dots, hover pause/resume, reduced-motion, and lightweight single-interval behaviour are
unchanged. Chatbot icon / TopHeader / routing untouched. **Backdrop-click dismissal added** (`ae609b1`):
the auth-modal overlay closes on an outside/backdrop click via
`onClick={(e) => { if (e.target === e.currentTarget) setAuthMode(null); }}` — the `target===currentTarget`
guard means an inside-content click never closes it (no `stopPropagation`, no propagation bugs); the X
button + entrance animations are unaffected. Live-verified (inside-click stays open; backdrop + X close).
- **Landing auth-modal mascot → a full-panel auto-carousel.** `HeroMascot` in `LandingPage.jsx` is now a
  dependency-free slideshow of **FIVE local Streamline Tokyo SVGs** in `src/components/`
  (`Support-Team`, `Digital-Call-Centre`, `Receive-A-Notification-1`, `No-Messages`,
  `Rewards-Someone-Top-Of-A-Podium`, all viewBox 0 0 400 400). _(Later migrated 2026-09: the ACTIVE
  assets are now **WebP in `src/assets/illustrations/`**, the podium swapped for `Call_manager.webp`
  — see the §33.7 still-live rule. Only the podium SVG was deleted; the other four `src/components/*.svg`
  remain in the repo but UNUSED after a concurrent owner GitHub upload the owner chose to keep.)_ It fills the modal's illustration side
  (`object-contain`, soft brand-green card background). Behaviour: opacity **crossfade** (slides mount
  ONCE, only opacity toggles → no re-fetch/re-decode/remount/layout-shift on an `aspect-square` stage),
  **pagination dots** (real `<button>`s, `aria-selected`, focus ring), **hover pause / mouse-leave
  resume**, a SINGLE autoplay interval with cleanup, **prefers-reduced-motion** disables autoplay (the
  global index.css rule collapses the crossfade to instant). No animation library.
- **Chatbot icon REVERTED** to `JobSeekerMascot` exactly as before (owner rejected an illustration for
  it). `Chatbot.jsx` unchanged from baseline. Do NOT re-illustrate the chatbot.
- **Licensing (owner decision):** Streamline FREE assets used WITH attribution — an "Illustrations by
  Streamline" credit is in the LandingPage footer. Keep it (or confirm a paid plan) if reused. Earlier
  Bangalore-set picks were rejected + deleted; only `assets/illustrations/welcome.svg` remains (§33.6).
- `.claude/launch.json` added (frontend-dev preview config).

### 33.8 What was left uncommitted (intentional)
`job-tracker-frontend/.env` (local), the two image DELETIONS `Chatbot Referrence.png` / `Public Job
Board.jpg` (owner's, not this cycle's), and the unused 6th Tokyo SVG
`Evaluate-Performance-Employee-Team--Streamline-Tokyo.svg` (untracked). `LandingPage.jsx` genuinely holds
BOTH the item-4 suspension login-notice UI and the carousel; they could not be cleanly hunk-split, so the
notice UI shipped with the landing commit (`b828a4d`) — both commit messages say so.

### 33.9 Invariants held
0.1 (every suspension notify/email/SMS best-effort — the status change never fails on a delivery error) ·
0.2/0.4 (AI scoring + the "admin approves every referral" model untouched — grouping is presentation +
read only) · 0.11 (in-app row is the durable deliverable; email/SMS are additive side channels) · §7.12
(the SMS + suspension paths honour the per-call `sms_notifications_enabled` flag). Migration 046 is
additive; `verification_id_type`/`pwd_category` columns stay dormant (not touched this cycle).

### 33.10 SMS follow-ups (2026-08-24) — TextBee dev provider + actionable links + lifecycle consistency
Post-§33 refinements to the SMS channel (§32), all committed + pushed on `main`
(`a4e4027`→`6b27031`), `npm test` **122**. Semaphore stays deferred/untouched; the provider
abstraction absorbed all of this with no notification-business-logic change.
- **TextBee dev provider** (`a4e4027`) — a TEMPORARY, low-cost real-delivery DEV provider
  (textbee.dev; an Android phone as SMS gateway) added behind the SAME `{ name, configured,
  send }` abstraction as Semaphore/console. Verified API: `POST /api/v1/gateway/send-sms`,
  header `x-api-key`, JSON `{ recipients:[E.164], message }`; it sends from the phone's own
  number so there is NO sender name (`TEXTBEE_SENDER_NAME` is IGNORED) — the **device** is the
  endpoint (optional `TEXTBEE_DEVICE_ID` in the body). Env-only (`SMS_PROVIDER=textbee` +
  `TEXTBEE_API_KEY` [+ `TEXTBEE_DEVICE_ID`]); credentials live ONLY in `.env`/Render, never in
  code/docs/bundle. Owner-verified delivering real SMS (verification + referral + lifecycle +
  walk-in claim). A `401 AUTH_INVALID` = a wrong/absent key (proven with a dummy key) — fix the
  key + restart (dotenv reads at boot; nodemon does not reload on `.env` change).
- **Account-lifecycle SMS consistency + dedupe fix** (`2e4015c`) — see §33.1: `ACCOUNT_REACTIVATED`
  added to `SMS_FANOUT_TYPES`; the fan-out dedupe key is HOUR-bucketed for referral events (retrying
  worker) but per-MINUTE for the synchronous `ACCOUNT_*` admin actions, so every deliberate suspend/
  reactivate sends. Referral dedupe stays hour-bucketed by decision (owner declined the referral-id key).
- **Actionable, auth-gated links** (`2e4015c`, `ddf1fe4`) via the env-driven `utils/appUrl.js`
  (`FRONTEND_URL`→`CORS_ORIGINS[0]`→localhost, ALWAYS absolute): referral/endorsement SMS → `/referrals`;
  reactivation email + SMS → sign-in; **walk-in claim SMS → an absolute `/claim` link + code + "open the
  link, enter the code to activate" instruction** (`pesoAdminRoutes.claimBaseUrl()` now returns
  `appUrl('/claim')`, fixing a relative-`/claim` fallback that was an unusable link locally). No link
  carries a token or auto-logs-in — ProtectedRoute + server guards still enforce a session. Suspension
  SMS keeps the office-contact text (a blocked account cannot sign in). Walk-in claim
  generation/validation/expiry/reissue unchanged.

### 33.11 cover_letter_drafts UNIQUE(user_id) hardening (2026-08-24, migration 047)
Closed the last parked item from §14 — the DB-level defense-in-depth for the cover-letter draft
dup-row bug (§30.2). `cover_letter_drafts.user_id` was only a NON-UNIQUE FK index, so the original
`INSERT ... ON DUPLICATE KEY UPDATE` silently inserted a row per save (live prod: 263 rows / 10 users;
one account had 157) and an unordered read could return a stale/empty draft. The CODE fix shipped
2026-08-08 (POST self-heals to one row, GET returns the newest MEANINGFUL draft); this adds the
`UNIQUE(user_id)` the code fix could not add while historical duplicates remained.
- **Migration 047** — two statements. **STEP 1** dedups each user to the SAME row the GET returns today
  (newest row with a non-empty JSON `$.body`, else the newest row overall), so behaviour is unchanged.
  The table has NO primary key, so rows are targeted by TiDB's implicit **`_tidb_rowid`**; the keep-set
  is the winner rowid per user (meaningful-body → `updated_at DESC` → `_tidb_rowid DESC` as a
  deterministic final tiebreak, so a perfect `updated_at` tie can never leave two survivors). The
  keep-set subquery is wrapped in a derived table so the DELETE can read its own target. Idempotent
  (after the first run each user has one row → re-run deletes nothing). **STEP 2**
  `ADD UNIQUE INDEX uq_cover_letter_drafts_user (user_id)` — the existing FK index is left in place.
- **TiDB gotcha (hard-won):** this TiDB version's parser **rejects `ADD INDEX IF NOT EXISTS`**
  (`ER_PARSE_ERROR`) — the first apply attempt failed on STEP 2 for exactly this reason (STEP 1 had
  already committed, leaving the table correctly deduped). Fixed to plain `ADD UNIQUE INDEX` (matching
  migration 033) and re-ran successfully. **Rule: do not use `IF NOT EXISTS` on `ADD {UNIQUE} INDEX`
  in a migration here** — rely on STEP-1 idempotency + the runner not recording a failed migration.
- **Verification discipline:** schema + dup magnitude confirmed with READ-ONLY probes; the destructive
  STEP-1 DELETE was exercised **inside a ROLLED-BACK transaction against prod** (§13) — 253 removed,
  10 kept, all restored on rollback — before the owner ran `npm run migrate`. Post-apply probe:
  10 rows, 0 duplicates, `uq_cover_letter_drafts_user` unique index present, 047 recorded. Every
  non-empty letter preserved (users 2/6/11/14/15/90002 kept their 1400–1784-char letters; users with
  no body anywhere kept their newest empty draft, exactly as GET falls back).
- **The POST self-heal stays** (belt-and-suspenders) — do NOT revert it to `ON DUPLICATE KEY UPDATE`.
  Guards in `test/documentBuilderDrafts.test.js` (dedup-before-ALTER order, `_tidb_rowid` usage, plain
  ADD UNIQUE INDEX). `npm test` = **124**. Commit `4552b08` (migration + test).

## 34. Landing Page — PESO Events & Job Fairs carousel (2026-08-24)

Surfaced the Events subsystem (§31.4) on the **public** Landing Page so visitors discover upcoming
job fairs/recruitment drives without signing in. NO migration, NO new records, NO new upload path —
pure presentation reuse of the existing events data. `npm test` **127**; frontend build clean.
Commit `082bfbd` (backend + frontend + tests).

### 34.1 Placement + structure
New `#events` section **immediately after the Local Employment Board (`#jobs`)**, before `#ai-assistant`
— the two "opportunities available now" surfaces sit together. Added an **"Events"** nav entry (desktop
nav + mobile menu + footer quick-links; `scrollTo('events')`). Section wraps a subtle
`bg-gradient-to-b from-[#f8f9ff] to-white` band; header mirrors the `#jobs` header (h2 + subtitle +
"View All Events →" → `setAuthMode('login')`).

**Discovery-first section order (2026-08-24, commit `acf732e`).** The `#features` marketing block
("What the platform does for you" / "One portal, from resume to referral" + feature cards) was moved
from BEFORE the Local Employment Board to AFTER the Events carousel, so the search-driven discovery
content sits directly under the platform stat tiles: **stats → `#jobs` → `#events` → `#features` →
`#ai-assistant`**. A visitor using the hero search reaches the Job Board/Events they came for without
scrolling past the explanatory marketing first. Pure JSX relocation — `#features` content, the hero
search → `filteredJobs` → `#jobs` wiring, and all other sections are unchanged; the nav has no
"Features" link so anchors are unaffected. Keep this order: explanatory/marketing content stays BELOW
the opportunity-discovery sections.

### 34.2 The two-row horizontal carousel (deliberately minimal)
A **two-row horizontal-scrolling shelf** on BOTH desktop and mobile:
`grid grid-rows-[repeat(2,auto)] grid-flow-col auto-cols-[15.5rem] gap-4 overflow-x-auto custom-scrollbar`.
Cards flow top→bottom then rightward into columns; the track scrolls sideways. **ONE pattern only** — no
arrows, dots, autoplay, or scroll-snap; no per-card reveal animation (owner: "strictly two-row, no extra
patterns/effects"). `grid-rows-[repeat(2,auto)]` (NOT `grid-rows-2`, which is `repeat(2,minmax(0,1fr))`
and would give the empty 2nd row a full 1fr of height) so a sparse list collapses the empty row to 0
(verified: 1 event → `grid-template-rows: 278px 0px`; ≥2 → `278px 278px`, horizontally scrollable).

### 34.3 Same event image, reused — no duplicate image path
Each card shows the **actual uploaded `banner_image`** (base64 JPEG) with a date pill + type badge
overlaid, falling back to a branded gradient only when an event has no image — the SAME poster the
authenticated seeker `Events.jsx` renders. This required **reversing** the earlier session's banner-free
"lite" projection: `eventRepository.listPublishedLite` + `LITE_COLUMNS` were **removed**, and `scope` +
`limit` folded into the ONE `listPublished({ scope='all', limit=null })` (banner always in `LIST_COLUMNS`;
`limit` bounded 1..50). Public `GET /api/events` forwards `?scope=upcoming&limit=N`; a no-param call (the
seeker module) is unchanged. The landing fetches `/events?scope=upcoming&limit=12`. So a Job Seeker, PESO
Admin, or PESO Staff sees the identical image everywhere, and an image uploaded by EITHER the Manager or
PESO Staff (both hold `events:manage`, one create/update path) is surfaced as-is.

### 34.4 Card, states, detail, styling
Bespoke landing components (module-level in `LandingPage.jsx`): `LandingEventCard` (image header + date
pill + type badge + relative-time badge Today/In N days/Upcoming/Ended + title/date·time/venue + "View
Details →") and `LandingEventModal` (lazy-loads the FULL record incl. banner via `GET /events/:id`;
backdrop/Esc/X close; shows date/time/venue/description/registration_info). Skeleton (two-row placeholder
grid), purposeful empty state, and graceful fetch-failure degradation (empty list, section still renders).
Styled in the LandingPage's **bespoke palette** (it is excluded from the app design tokens, §24) mirroring
the seeker `EventCard` info architecture — a deliberate second card impl, not a token-styled import.
Verified in the running app (two-row grid, horizontal scroll, real base64 banner render, no console
errors). Guard tests updated in `test/eventsSubsystem.test.js` (unified banner-included list + scope/limit
+ NO parallel image path).

## 35. Root-to-top audit + first improvement increment (2026-08-24)

An 8-phase engineering + UX audit of the *implemented* system (excluding the documented roadmap) →
`docs/system-audit-2026-08-24.md`, with a prioritized P0..Future decision matrix. **No P0 found.** The
first increment implemented the highest-value, lowest-risk items. `npm test` **130**; frontend build clean.

### 35.1 F1 — AI score provenance (auditability, NO migration)
`services/aiClient.js` gained **`chatDetailed()`** returning `{ content, provider, model }` (the provider +
model that ACTUALLY served the response, incl. the real served model version like `deepseek-v4-flash`, after
any failover); `chat()` now delegates to it, so every existing caller is byte-unchanged. `scoreApplication`
stamps **`provenance: { provider, model, promptVersion, scoredAt }`** (const `SCORING_PROMPT_VERSION =
'tier1-2026-08'`) onto the score object, which is already `JSON.stringify`-persisted whole into
`ai_analysis` / `current_ai_analysis` (so provenance rides along with **no migration**) and re-parsed by
`applicantProfileService` (`safeParse`) + returned by `/jobs/match`. Provenance is OUTPUT metadata —
deliberately NOT in `buildScoringPrompt` / `computeScoringSignature`, so a failover can NEVER change the
input hash or trigger a spurious re-score. **Verified live** (read-only scoring call): a real score recorded
`deepseek` / `deepseek-v4-flash` / `tier1-2026-08` + timestamp.

### 35.2 F2 — surface the AI rationale (explainability)
The engine already computed a one-sentence `summary` and persisted it but the seeker board never showed it.
Added a **"Why this score"** block + a subtle **"Analyzed by \<model\> · \<date\>"** provenance line to
`PublicJobBoard.jsx`. The admin `ApplicantProfileDrawer.jsx` already rendered the summary; it now also shows
the provenance line under BOTH the live and apply-time scores. **B1 fix (same panel):** sub-score colours
(`PublicJobBoard.jsx`) now track the actual High/Medium/Low value via `levelTone()` — a "Low" no longer
renders green.

### 35.3 D1 — debounce the tab-focus refetch waterfall
On every tab return, `NotificationContext`, `ChatContext`, and `PesoAdminATS` each refetched independently.
Each `visibilitychange`/poll handler now carries a **20 s min-refetch guard** (`MIN_REFETCH_MS`), so a burst
of tab switches makes at most one request per handler per window. **Debounce, NOT removal** — the interval
polls (45 s notif / 90 s pipeline, both > 20 s) and the socket real-time path are untouched, so the §18.9
backstop posture is preserved.

### 35.4 F3 — documented the reproducibility boundary
`docs/system-guide.md` §5 (the demonstration/defence reference) rewritten to answer *"is the score
reproducible/defensible?"* honestly: deterministic within a provider+model version; failover / model-version
bump is the only drift, bounded by the immutable apply-time score + the hash guard; provenance makes any
displayed % traceable. SKILL §7.4 updated for the new score-object shape.

### 35.5 C1 — modal focus-trap + restore (WCAG 2.4.3); D2 — declined
**C1 DONE:** new reusable **`src/hooks/useFocusTrap.js`** — on open remembers the opener, moves focus into
the modal (first control, else the `role="dialog"` container, which also announces the dialog to SRs), traps
Tab/Shift+Tab, and restores focus to the opener on close. Focus is moved **SYNCHRONOUSLY** (not via
`requestAnimationFrame` — rAF is paused while the tab/pane is hidden, which would leave focus outside the
dialog; this was caught during live testing). Applied to the seeker `EventModal` + landing `LandingEventModal`
(both containers gained `role="dialog" aria-modal tabIndex={-1}`); Esc/backdrop close unchanged. Verified live
on the public landing modal (focus enters the dialog on open, restores to the opener card on Esc). **Extended
(§35.6) to the two highest-traffic modals** — the landing **auth overlay** (`LandingPage`, `useFocusTrap(!!authMode)`
on the overlay, gated so it re-arms per open) and the **`ApplicantProfileDrawer`** (its `role="dialog"` container
gained `aria-modal`/`tabIndex`/ref). Auth overlay verified live: focus enters on open (onto "Close modal") and
restores to the "Sign In" trigger on close.

**D2 DECLINED (kept eager).** Lazy-loading `LandingPage` would shrink the entry bundle by ~26 kB gzip
(156.3→130.3 kB gzip; a 107 kB / 26 kB-gzip LandingPage chunk splits out) and logged-in users would never
fetch it — BUT `App.jsx` (24-27, 47-48) deliberately keeps LandingPage **eager** so the public landing has no
loading flash ("the most important first impression"). Measured + owner-decided: the modest saving does not
justify a `RouteFallback` spinner on the marketing front door. **Rule: LandingPage stays eagerly imported.**

### 35.6 A2 + G3 — worker-io clarity + referral-void notification coverage
**A2 DONE (documentation, no functional change).** Confirmed the `startWorkers.js` `io` asymmetry is
INTENTIONAL, not a bug: only the referral + application-scoring workers push a client socket event
(`referral_issued` / `scores_updated`), so only they receive `io`. The other five emit nothing to a browser —
email/digest/sms deliver off-platform; jobMatch (job alerts) produces a durable notification row (poll-backstopped);
proactive only POPULATES the Smart Referral Queue table (fetched on visit). Passing `io` to a non-emitting worker
would be misleading dead code. Documented the rationale in `startWorkers.js` so the asymmetry reads as deliberate.

**G3 DONE (notification-coverage gap fixed).** The matrix check found ONE real gap: **voiding an approved referral
did not notify the seeker** — who WAS told when it was issued (`REFERRAL_ISSUED`), so their status went stale.
(Referral *rejection* of a `Pending Review` staging is correctly silent — the seeker was never told about the
staging.) Fix: `referralService.voidReferral` now sends a best-effort, post-commit `REFERRAL_WITHDRAWN`
notification to the seeker (`notifyUser` never throws, 0.1; the void succeeds regardless). `findJobForReferral`
gained `ja.applicant_id`; the route forwards `io`; the admin's internal void reason is NOT echoed to the seeker.
New dedicated type `REFERRAL_WITHDRAWN` registered in BOTH places (§7.7): `NotificationBell.TYPE_META` (My
Referrals, amber) + `CONTROLLABLE_TYPES` (muteable). 3 guard tests in `referralOutcomeSync.test.js`; `npm test` **133**.

**Remaining audit items:** none of the actioned P0–P3 set outstanding. Tier-2 scale anchors, worker split/Redis,
Semaphore funding, security rotation, dev/prod DB split = documented Future (do not implement now).

## 36. G3 deep-dive — decision notifications, "Not Referred" state, scoring-divergence trace (2026-08-24)

Follow-up to the §35 audit's G3, from live testing. Three fixes; no scoring LOGIC changed.
`npm test` **140**. Commits `bc1d67a` (G3.1/G3.2), `1eb2b0b` (G3.3), `9e436ea` (docs). **OWNER-VERIFIED
end-to-end in local dev against a real registered job seeker (2026-08-25): G3.1 decline notification,
G3.2 'Not Referred' state, and G3.3 score reconciliation all confirmed working.** PUSHED to `main`.

### 36.1 G3.1 — notify the seeker when PESO declines (rejectReferral)
Declining an applicant (`referralService.rejectReferral`, reachable from the Applicant Pipeline
AND AI-Recommended, single + bulk) wrote only a `REFERRAL_REJECTED` audit row — the seeker was
never told. It now sends a best-effort, post-commit **`APPLICATION_DECLINED`** notification
(notifyUser never throws, 0.1; the decision succeeds regardless; internal reason NOT echoed to the
seeker). New type registered in `NotificationBell.TYPE_META` + `CONTROLLABLE_TYPES` (§7.7); both
reject routes forward `io`. (Note: rejecting a *Pending Review* staging the seeker never saw is now
also surfaced — acceptable, since it comes with the "not referred" decision + state.)

### 36.2 G3.2 — a "Not Referred" seeker state (rejectReferral)
A declined application used to keep its prior status → ambiguous. `rejectReferral` now system-sets
the application to **'Not Referred'** — the symmetric twin of approve's system-set 'Referred'
(§18.5): a terminal state, NOT in `ACTIVE_STATUSES`, so excluded from live re-scoring. 'Not Referred'
is a first-class canonical stage: `STAGE_STYLE` + `ALT_STAGES` + `TERMINAL_STAGES` + `PESO_BASE`
(seeker My Applications, orange), the ATS filter list + `statusSelectTone` read-only badge (admin),
and the applicant-drawer `STATUS_TONE`. The ATS applicant query has NO status filter, so declined
apps stay visible + filterable. (A voided APPROVED referral still reopens to 'Shortlisted' — that
path is unchanged; reject≠void.)

### 36.3 G3.3 — the 75%(board) vs 30%(pipeline) divergence: TRACED, then reconciled
**The engine is not at fault.** Determinism verified live: the same (résumé, job) scored 90/90/90
(spread 0) via `deepseek/deepseek-v4-flash`. All three paths run the ONE `scoreApplication` engine —
board `POST /jobs/match`, apply-time, and the re-score worker — with the same prompt, `prefer=deepseek`,
`SELECT *` job context, and temp 0. **Both the seeker's My Applications and the admin pipeline already
display the SAME committed score** (`COALESCE(current_match_score, match_score)`), so they are in sync
on the committed application.
The divergence was between the **board PREVIEW** (a cached what-if) and the **committed** score:
- `POST /jobs/match` caches the preview per (user, job) for 10 min and did NOT invalidate on résumé
  change (§22 staleness), while
- applying with an uploaded PDF **overwrites `uploaded_resumes.parsed_text`** (`applicationRoutes.js`),
  so the worker scores a possibly-different résumé than the one the cached preview scored.
So the seeker's 75 (cached preview, older résumé) and the admin's 30 (committed, résumé applied with)
were each correct for their own input — nothing was random or fabricated (F1 provenance now lets us
confirm any recurrence: provider+model+time per score).
**Reconciliation (no scoring logic changed):**
- Board match cache extracted to `services/matchScoreCache.js` (shared, keyed user+job) + new
  `ttlCache.delByPrefix`; a user's previews are **invalidated the moment their résumé changes** —
  wired at the résumé-builder save, résumé upload (`resumeRoutes`), and the apply-time overwrite
  (`applicationRoutes`). A stale preview can no longer outlive the input it scored.
- My Applications shows a **"Calculating…"** chip for a freshly-submitted PESO application whose async
  score hasn't landed (recency-gated ≤15 min), so the UI signals a newer score is being computed
  rather than showing nothing.

### 36.4 Invariants held / rules
- **The committed application score is the single source of truth shown to BOTH seeker and admin**
  (`COALESCE(current_match_score, match_score)`); the board `/jobs/match` score is a CACHED PREVIEW,
  now invalidated on résumé change. Do NOT present the board preview as the committed score.
- 'Referred' and **'Not Referred'** are BOTH system-set by the referral decision (approve/reject),
  never from the ATS status menu (`ATS_SETTABLE_STATUSES` stays Applied/Under Review/Shortlisted).
- Every decision notification (decline `APPLICATION_DECLINED`, void `REFERRAL_WITHDRAWN`) is
  best-effort post-commit and never echoes the admin's internal reason.

## 37. Audit E3 — hot-path EXPLAIN + index pass (2026-08-25, verified clean, no code change)

The next audit increment after §36. Read-only `EXPLAIN` + `SHOW INDEX` pass over the hottest endpoints
against prod TiDB (the §35 matrix's E3, P2). **Outcome: every hot query is index-driven — zero full
table scans, no N+1 at the query level.** No migration needed.
- ATS applicants (`WHERE job_id=?`) → `IndexRangeScan job_applications_ibfk_1(job_id)` + IndexJoin to
  users PK. Notifications bell (`WHERE user_id=? ORDER BY created_at`) → `IndexRangeScan
  idx_notif_user_read(user_id,is_read,created_at)`. The approved-referral `EXISTS` (the scoring/ATS hot
  path) → **`Point_Get uq_refq_application(application_id)`** (fastest possible). Owner job list
  (`peso_admin_id`), résumé fetch, and the outbox worker claims (`status,next_run_at`) all `IndexRangeScan`.
- Every hot WHERE/JOIN column is already indexed (`job_applications` job_id/applicant_id/PK,
  `referral_queue` application_id-UNIQUE/status, `notifications` the composite, `saved_jobs`/
  `usertrackedjobs` user_id+deleted_at, `pesoadmin_job_posts` peso_admin_id, the outbox tables
  status+next_run_at). The "explicit columns + indexed access" convention (§12) holds.
- **Non-actioned observations (deliberately not changed):** (1) a composite `(user_id, uploaded_at)` on
  `uploaded_resumes` would let the "latest résumé" query skip a tiny TopN — negligible (~1–3 rows/user),
  not worth a prod migration; (2) TiDB stats show `pseudo/partial/missing` — an `ANALYZE TABLE` sweep
  would sharpen plans as data grows (a maintenance note, not code). Confirming behaviour AT SCALE remains
  Future (needs `/admin/timing` under real concurrency, §35 matrix).
- **Audit status:** the actionable non-Future items are now exhausted (F1/F2/F3/B1/D1/C1/A2/G3 done, E3
  verified-clean, D2 declined). Only **C2** (carousel scroll-affordance polish, P3 — optional, and the
  Events carousel is deliberately minimal) and the documented **Future** set remain.

## 38. Audit C2 — Events-carousel scroll affordance (2026-08-25, the last optional item)

The final optional audit item (P3 polish). The two-row Events shelf on the landing page (the one
horizontal carousel lacking a scroll cue) now signals that it scrolls sideways:
- **`EventsShelf`** (module component in `LandingPage.jsx`) wraps the shelf with subtle **edge fades**
  that appear ONLY when there is off-screen content on that side (scroll + `ResizeObserver` driven;
  `pointer-events-none` + `aria-hidden`). Deliberately NOT a carousel pattern — no arrows/dots/autoplay/
  snap; the shelf stays strictly two-row horizontal (honouring the owner's minimalism). Keyboard users
  already reach off-screen cards via Tab (focus scrolls them into view), so this is a mouse-discoverability
  cue only.
- A visibly thin **horizontal scrollbar** (`.custom-scrollbar` gained `height`) as a native, zero-JS
  baseline affordance that works regardless of the fade.
- Verified by inspection (all three edge states traced) + the no-overflow LIVE state (both fades correctly
  opacity-0 with content that fits). The on-overflow fade toggle could not be auto-driven in the headless
  browser pane (ResizeObserver/rAF pause while the pane is hidden — same limitation seen with C1) and there
  is only 1 published event (no real overflow), so the fade's appearance is best confirmed visually once
  there are enough events. Frontend-only; build clean.

**AUDIT COMPLETE.** All actionable, non-Future items are now done: F1/F2/F3/B1/D1/C1/A2/G3.1–G3.3 shipped,
E3 verified-clean, C2 shipped, D2 declined-with-rationale. Only the documented **Future** roadmap remains
(worker split/Redis, Semaphore funding, security rotation, email domain auth, Tier-2 scale anchors,
dev/prod DB split) — do not implement now.

## 39. DOLE PESO Accomplishment Report — aggregate + demographic + PDF/CSV (2026-08-25, Phase A)

A NEW feature (post-audit): the DOLE accomplishment-report FORMAT the existing §7.11 referral report does
not produce. The existing report is a flat CSV of referral ROWS + a placement rate; this ADDS period
AGGREGATE counts (registered · vacancies/positions solicited · referred · placed) broken down by **sex** and
**educational attainment**, as an official **PDF** + a sectioned **CSV**. No migration (uses existing columns).
`npm test` **148**; committed + pushed (`70a1339`).

### 39.1 Reconciliation with the existing report (§7.11) — the correctness anchor
Same cohort, so the two reports agree: **referred** = `referral_queue.status='Approved'` dated by
`reviewed_at`; **placed** = its `referral_outcomes.outcome='Hired'` ONLY (invariant 0.14); inclusive of the
`to` date via `< DATE_ADD(to, INTERVAL 1 DAY)`. Verified against live data: referred **48** (matches the
landing "referrals" stat), placed **7** (matches "hires"), placement rate **14.6% of-all / 100% of-known** —
exactly the §7.11 understate/overstate behaviour. Every demographic breakdown sums to its total.

### 39.2 Structure
- `repositories/reportingRepository.js` — `registeredMatrix` (office-wide), `referredMatrix` (referred +
  placed + decided, owner-scopable), `solicitedTotals`. Demographics COALESCE NULL/'' into a transparent
  **'Not specified'** bucket and are grouped via a **derived table** (grouping by a COALESCE alias trips
  TiDB `only_full_group_by`). No `JOIN userprofiles` (0.8). Registration is office-wide only (a seeker
  registers to the platform, not to one administrator).
- `services/reportingService.js` — `buildAccomplishmentReport({ ownerId, from, to })` (ordered buckets, both
  placement-rate denominators, honest `notes` incl. "age-group not available — no DOB captured"), `toCsv`
  (sectioned, UTF-8 BOM, `csvField` injection-guarded), and `buildAccomplishmentExport({format})` (json|pdf|csv).
- `services/reportPdfService.js` — self-hosted **pdfkit**, page-break-aware tables + a clean report header.
  Deliberately NOT the referral-letter full-page letterhead (single-page header+footer with a blank middle,
  §13 — it would double-print on a multi-page table report).

### 39.3 Endpoints (one builder, two scopes) + UI
- **PESO admin (owner-scoped):** `GET /api/referrals/reports/accomplishment?from&to&format=json|pdf|csv`
  (`ownerId=req.userId`). **Super admin (office-wide):** `GET /api/admin/reports/accomplishment?...`
  (`ownerId=null`; adminRoutes' router-level `requireRole(SUPER_ADMINISTRATOR)` guards it).
- Shared `components/common/AccomplishmentReport.jsx` (date range → on-screen tables → PDF/CSV authed-blob
  download, design-token styled, responsive) wired into BOTH `ReferralReports.jsx` (PESO admin) and
  `PlatformReports.jsx` (Super admin) — extending the existing report surfaces, NOT a new dashboard.

### 39.4 Deferred — Phase B (follow-up)
The report shows only what is captured: `gender` (~45% filled), `educational_attainment`, with a transparent
'Not specified' bucket; **age is not reported (no DOB column)**. Phase B = capture DOB→age group + strengthen
the sex/education prompts at registration/profile, to bring the report to full DOLE fidelity. Not built.

### 39.5 Phase B — age-group breakdown + capture nudge (2026-08-25, DONE, no migration)
Completed the DOLE demographic set. **No migration** — `users.dob` (DATE) already existed and the profile
already captured it (my earlier "no DOB" note was wrong; the column probe searched "birth"/"age", not "dob").
- `reportingRepository.AGE_CASE(dobCol)` derives the CURRENT age group, **guarding bad data** (NULL or an
  implausible age <10/>100 — the DB holds a corrupt DOB giving a negative age) into 'Not specified'. Both
  matrices now carry `age_group` and `GROUP BY (sex, education, age_group)`; the service margins all THREE
  dimensions from the same 3D matrix (no extra queries).
- `reportingService.by_age_group` (brackets: Below 18 / 18-24 / 25-34 / 35-44 / 45-54 / 55-64 / 65 and above),
  added to the sectioned CSV; notes updated (age = current age from DOB; 'Not specified' now covers
  missing/implausible DOB). `reportPdfService` gained a page-break-aware "By age group" table (verified it
  repeats its header onto page 2). `AccomplishmentReport.jsx` renders the age table.
- `Profile.jsx` gained a small "helps PESO prepare its DOLE reports" nudge under the demographic fields
  (sex / DOB / education already existed) to encourage completion — capture stays optional (no forced fields).
- Verified live: age breakdown reconciles (33/48/7); the corrupt DOB lands in 'Not specified'. `npm test`
  **151**; build clean. Commit `b5e9b1e`. **The report's Phase B is now DONE — nothing deferred there.**

## 40. Certificate-scoring removal + requirement-only scoring rule + ProactiveWorker summary log (2026-08-25)

Post-§39 refinements from an office-workflow clarification: PESO scores STRICTLY against the employer's
STATED Requirements & Qualifications, and certifications are NOT a separate matching criterion. On `main`,
committed + pushed. `npm test` **151**; frontend build unaffected; the scoring change is eval-confirmed
calibration-neutral. NO migration.

### 40.1 Separate certificate SCORING path REMOVED (certificates are evidence-only now)
The Phase 2D-C "certs feed the LIVE score" path (§18.6 C.3) is gone. Certificate FILES are STILL attached
at apply time, snapshotted to `application_certificates` (durable base64), and viewable by the admin in the
ApplicantProfileDrawer + owner-scoped streaming — but they **no longer influence the AI score** and attaching
one **no longer arms a re-score**. Removed:
- `applicationScoringService.getCertificateContext` (+ its now-unused `certificatesRepository` /
  `pdfTextService` imports + its export).
- The worker's `const extraContext = getCertificateContext(...)` feed in `applicationScoringWorker` — the
  score AND the input-hash signature no longer include cert text (`computeScoringSignature({ resume, job })`).
- The apply-time `if (storedCerts > 0) enqueueForApplication(...)` cert re-score trigger in
  `applicationRoutes` — now a log ("stored as evidence, not scored"); the snapshot loop stays.

The generic `extraContext` param stays in `buildScoringPrompt`/`scoreApplication`/`computeScoringSignature`
(always null now — inert plumbing, no consumer change). Guard `test/scoringInputHashGuard.test.js` updated
(signature = `{ resume, job }`, no `extraContext`). The prompt rule "certificates are SUPPORTING evidence,
NOT mandatory" **STAYS** — it governs certs mentioned INSIDE the résumé (still scored via `parsed_text`), so a
seeker is never penalized for not listing certs. Kept as viewable EVIDENCE (owner-chosen): the Apply Wizard
cert upload + Portfolio library are unchanged. One-time input-hash re-baseline for apps that had cert context.

### 40.2 Symmetric requirement-only scoring rule ("don't-boost-for-unrequested")
`buildScoringPrompt` (`services/aiScoringService.js`) gained the SYMMETRIC twin of the existing "don't lower
for unstated" rule: **"Do NOT raise the score for résumé content beyond the stated requirements either — skills/
experience/qualifications the employer did NOT list neither add to nor subtract from the number. The score
reflects ONLY the stated Requirements & Qualifications."** So the compatibility % is driven ONLY by the
employer's STATED Requirements & Qualifications (Educational Requirements, Work Experience, Gender Preference,
Required Skills & Competencies, Additional Qualifications): a stated-but-unmet requirement lowers; an unstated
dimension neither helps nor hurts; unrequested résumé extras don't inflate. Matches how PESO's accredited
companies actually post (often few/no stated skills). `SCORING_PROMPT_VERSION` bumped `tier1-2026-08` →
`req-strict-2026-08-25` (a prompt change, §7.4 rule → one-time input-hash re-baseline).

**Eval-confirmed (measure-before-ship, §21).** New self-contained variant `requirement-strict` in
`scripts/eval-scoring.js` mirrors the shipped prompt; run `npm run eval:scoring -- --variant=requirement-strict`.
Live (deepseek, temp 0, deterministic — reproduced identically twice):

| variant | MAE | band acc | FP/FN | off-tol |
|---|---|---|---|---|
| `employer-criteria` (before) | 6.4 | 100% | 0/0 | 1 |
| `requirement-strict` (shipped) | 7.9 | 100% | 0/0 | 1 |

Band accuracy + FP/FN unchanged → your rule made explicit WITHOUT regressing the scorer.

### 40.3 A "surface unrequested strengths in the summary" idea — TESTED and REJECTED
Considered having the score `summary` mention relevant-but-UNREQUESTED seeker strengths (so a strong seeker
under a bare posting isn't overlooked — "well-balanced referring"). The eval REJECTED it: every wording
(direct, and a "decide the number FIRST, then annotate" sequencing) INFLATED strong matches to 95–100 and even
dropped band accuracy to 86% (a shallow keyword-stuffer got bumped to Good Match). Root cause is fundamental:
asking the model to enumerate extra strengths biases the number even when told not to. NOT shipped. **The goal
is already met WITHOUT it:** the Manager sees the full résumé + profile in the ApplicantProfileDrawer and the
score's `summary` rationale (§35 F2), and invariant 0.4 makes the human the decision-maker. DEFERRED future
OPTION (not built, owner: "leave it"): a SEPARATE non-scoring "additional strengths" analysis field — never
folded into the scoring prompt.

### 40.4 ProactiveWorker per-run summary log (observability)
`proactiveReferralService.matchJob` now logs ONE line per run —
`[ProactiveWorker] job N: X candidate(s) — Y scored, Z skipped (unchanged), W new suggestion(s).` — quiet on
0-candidate runs. This gives the `[ProactiveWorker]` change-detection guard the same visibility as
`[ScoringWorker]`'s per-application skip line, but as a PER-RUN aggregate: the per-candidate guard skip stays a
silent `continue` (a job with many unchanged candidates would otherwise spam the log). `scored + skipped ===
candidate count`.

### 40.5 Invariants held
0.1/0.2/0.4 (scoring still real-or-NULL; a named admin approves every referral) · §7.4 single scoring engine
unchanged in MECHANISM (only the prompt RULES + the removed cert input narrowed) · §29 input-hash guard still
gates at EXECUTION and hashes the exact scored prompt (now cert-free) · certs removal is a scope REDUCTION, not
a new async path. Local `.env` gained `PROACTIVE_INPUT_HASH_GUARD=true` + `SCORING_INPUT_HASH_GUARD=true` to
exercise the §29 guards locally (prod already has them; `.env` is untracked → no deploy impact). Files:
`services/aiScoringService.js`, `services/applicationScoringWorker.js`, `services/applicationScoringService.js`,
`services/proactiveReferralService.js`, `routes/applicationRoutes.js`, `scripts/eval-scoring.js`,
`test/scoringInputHashGuard.test.js`.

## 41. Centralized environment-aware storage + Cloudflare R2 for job images (2026-09)

Fixes the ONE genuinely disk-dependent upload path — **job featured images** — that worked on a dev
laptop but VANISHED in production (Render's ephemeral filesystem is wiped every deploy). On `main`;
`npm test` **158**; **NO migration**; ship-dark (defaults to `local` = current behaviour, safe to
deploy). Frontend UNCHANGED. Blueprints: `docs/cloud-storage-proposal.md` (decision) +
`docs/cloudflare-r2-setup.md` (the click-by-click activation guide).

### 41.1 Scope reconciliation (what was actually broken)
A full discovery (grep for `multer`/`diskStorage`/`express.static`/`/uploads`) found only ONE upload
path writes to local disk: **job featured images** — `multer.diskStorage` → `uploads/job-featured/` →
served by `express.static('/uploads')`, in BOTH `pesoAdminRoutes` and `adminRoutes` (near-identical
handlers). Everything the owner believed was "in `uploads/`" is already **base64-in-DB and WORKS in
prod**: avatars (`users.avatar_url`), résumés (`application_resumes`), event banners
(`peso_events.banner_image`), certificates, referral letters (`referral_letter_files`). **Owner
decision: those STAY base64-in-DB** (they work in prod; migrating them is the proposal's phased Phases
1–4, deferred). The `uploads/verification-ids/` path in `profileRoutes` is DEAD
(`verificationUpload.none()` accepts no files since the Identity-ID feature was removed, §32.4) — left
untouched.

### 41.2 `services/storageService.js` — the centralized abstraction
ONE place every upload-writing module goes through, so no module keeps its own filesystem assumption.
`STORAGE_DRIVER` (env only) selects the backend: **`local`** (default → writes `uploads/<key>`, returns
a server-relative `/uploads/<key>`) | **`r2`** (Cloudflare R2, S3-compatible via `@aws-sdk/client-s3`,
returns a full `${R2_PUBLIC_BASE_URL}/<key>` URL). API: `save(key, buffer, contentType)` /
`remove(ref)` / `getStatus()`. `remove()` is **driver-agnostic + best-effort, never throws** (invariant
0.1 — a failed cleanup must not fail the action); `save()` throws on a real write failure so the route
can 500 honestly. The **AWS SDK is LAZY-required** (only when R2 is used), so local dev never needs it
installed. `safeKey()` strips `..`/leading-slash (path-traversal defense in the local provider).
Credentials + bucket come **EXCLUSIVELY from env** (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL`); nothing reaches the frontend but the resulting
public URL. Job images use a **PUBLIC** R2 bucket (public marketing content); PII/document binaries,
IF ever migrated, use a **PRIVATE** bucket + presigned URLs (proposal §5).

### 41.3 Migration of the job-featured-image routes
Both handlers (`pesoAdminRoutes`, `adminRoutes`): `multer.diskStorage` → **`memoryStorage`**; the
buffer goes to `storageService.save('job-featured/job-<id>-<ts>.<ext>', req.file.buffer,
req.file.mimetype)`; `pesoadmin_job_posts.featured_image` stores the returned reference; the previous
image is cleaned up via `storageService.remove()` (handles a local path OR an R2 URL). **Validation is
preserved at the route** (8 MB limit + JPG/PNG/WEBP MIME allow-list). The frontend already resolved
full URLs (`resolveJobImage`: `src.startsWith('http') ? src : FILE_BASE + src`), so R2 URLs render with
**NO frontend change**. `express.static('/uploads')` STAYS (local dev + any legacy path).

### 41.4 Observability + activation (ship-dark)
`server.js` boot-logs `[Storage] driver=… (r2Configured=…, base=…)` (mirrors the worker boot-log
pattern), so "is R2 actually on in prod?" is answerable from the boot log. Ship-dark:
`STORAGE_DRIVER` unset ⇒ `local` ⇒ byte-identical to before ⇒ safe to deploy immediately. Activation =
create a PUBLIC R2 bucket + a scoped API token, then set `STORAGE_DRIVER=r2` + the five `R2_*` vars on
Render (retype, NO trailing space §13) — full walkthrough in `docs/cloudflare-r2-setup.md`.
`@aws-sdk/client-s3` added to deps. `test/storageService.test.js` (7 source-only guards: env-driven
driver, no hardcoded secrets, both providers, lazy SDK, routes use the service not disk, validation
preserved).

### 41.5 Invariant 0.5 amended (durable binaries)
Invariant **0.5** ("durable binaries live in the DB as base64") is **AMENDED for job featured images**:
their durable home is now **object storage (R2 in prod)** and the DB row holds the *reference*, not the
bytes. The intent (survive an ephemeral-disk wipe) is preserved and strengthened. base64-in-DB REMAINS
the rule for the PII/document binaries (**résumés, referral letters (0.13), certificates, avatars, event
banners**) until the proposal's phased migration is done. **RULE: never write a NEW upload to local disk
— route it through `storageService`.**

## 42. UI skeleton alignment + job-update worker-trigger precision (2026-09)

Two refinements (one frontend, one backend). On `main`; `npm test` **163**; frontend build clean; NO migration.

### 42.1 Layout-preserving card skeletons (frontend; UI addendum §5.5)
The Saved Vacancies + My Applications loading states no longer matched their (post-refactor) cards — Saved Vacancies borrowed the **media-band** `SkeletonCardGrid`/`SkeletonJobCard` (144px banner, 300px floor) and My Applications had a hand-rolled placeholder. Added a SHARED **compact** skeleton in `components/Skeleton.jsx`: **`SkeletonCompactCard`** (mirrors the shared `cardTheme` card EXACTLY — 40px icon tile + control dots, status/source pill, 2-line title, company line, bordered meta chips, `pt-2.5 border-t` footer; `h-full min-h-[180px] rounded-3xl border` + inner `p-4 flex flex-col`) + **`SkeletonCompactCardGrid`** (the exact `auto-fill/minmax(min(240px,100%),1fr)` grid). My Applications reuses its OWN `CARD_GRID` constant + `SkeletonCompactCard` (can't drift); Saved Vacancies uses `SkeletonCompactCardGrid` + also skeletons its filter bar + status tabs (removing a pre-existing grid jump). The media-band `SkeletonJobCard`/`SkeletonCardGrid` are UNTOUCHED (Public Board + PESO Dashboard). No CLS on load.

### 42.2 Job-update worker-trigger precision (backend) — media/metadata edits don't arm workers
**Symptom (owner-reported + verified):** editing ONLY a job's image re-armed `[ScoringWorker]`, `[ProactiveWorker]`, `[JobMatchWorker]`, and downstream `[EmailWorker]`. **Root cause:** the frontend job-edit `handleSubmit` ALWAYS re-sends the full form via **`PUT /peso-admin/jobs/:id`** (then the SEPARATE `POST /jobs/:id/image` for the image), and that PUT enqueued scoring UNCONDITIONALLY + jobAlerts/proactive whenever published — with **NO field-level change detection**. So a full-form re-save after an image swap re-armed every pipeline. The image endpoint itself never enqueues; the R2 upload fires no secondary job event; there are no DB triggers; no cache cascade. (Investigation: points 1 & 3 = YES; 2, 4, 5 = NO; 6 = same handler for Admin + Staff.)
**Fix — enqueue-time change detection in `PUT /jobs/:id`:** snapshot the prior scoring fields, then arm only on a MEANINGFUL change:
- `scoringFields = {title, company, description, skills, qualifications, education, experience, gender}` — EXACTLY what `buildScoringPrompt()` reads. `scoringChanged` = any differ (trim-normalized).
- `applicationScoringService.enqueueForJob` — only if `scoringChanged`.
- `jobAlertsService`/`proactiveReferralService.enqueueForJob` — only if `nowPublished && (scoringChanged || becamePublished)`; a fresh Draft/Closed/Filled → Open/Published is itself a meaningful event, so a first publish still matches/alerts once (dedup guards a re-publish).
- A media-only edit (`featured_image` — NEVER in this UPDATE) or non-scoring metadata (location / salary / deadline / positions / work_setup / category / department / accommodations) → **NO worker armed**.

This is the **enqueue-time twin of the §29 input-hash guard** (which already skipped the wasted AI CALL at execution — but the enqueue, worker wakeup, log noise, and jobMatch's own AI still happened). Same handler serves PESO Admin AND PESO Staff (`req.effectiveOwnerId`), so the rule is identical for both roles. Super Admin (`adminRoutes`) has no job-field-edit enqueue (its job-image endpoint, R2-migrated in §41, never armed workers). No legitimate trigger removed; the create path (`POST /jobs`) is unchanged. `test/jobUpdateWorkerTriggers.test.js` (5 guards). `npm test` **163**.

## 43. Post-registration onboarding + account-completion gate (2026-09)

A required Identity & Profile completion gate before a job seeker can APPLY. On `main`; `npm test` **168**; frontend build clean; **NO migration** (state is DERIVED). Flow: Register → Email verify → Welcome → Identity & Profile Setup (required) → Résumé (optional in onboarding, **required to apply**) → Dashboard.

### 43.1 The decision (owner)
Mandatory apply-gate fields = **name, phone, location, gender, dob, educational_attainment** (identity for the referral letter + DOLE demographics §39). **Résumé is REQUIRED to apply** (optional only to finish onboarding). The gate applies to **EVERYONE at apply-time** (existing incomplete accounts complete once before their next apply; no one is locked out of browsing — only Apply is gated).

### 43.2 Derived, backward-compatible state (no migration)
`services/onboardingService.evaluate(userId)` derives `{ profileComplete, hasResume, canApply, missing, required, error? }` from the SAME `users` columns the existing `PUT /profile` writes + `uploaded_resumes.parsed_text` (what the AI scorer reads — a PDF upload OR a builder save both populate it). No new column/flag → the "state" IS the DB, so a refresh/logout can't bypass it, and both newly-registered AND walk-in accounts fall through the identical gate with zero special-casing. `canApply = profileComplete && hasResume`. On a DB error it returns `error:true` (indeterminate) so the apply gate fails OPEN (a blip never blocks a legit apply).

### 43.3 Server-side enforcement (the authoritative layer)
- **`POST /applications`** re-checks `evaluate` right after the jobId check, BEFORE any application insert: a definitive `!canApply` → **403 `{ code:'PROFILE_INCOMPLETE', message, missing, needsResume, profileComplete }`**. This is the real gate behind the disabled Apply button (business-logic layer, not merely a frontend step).
- **`GET /profile/onboarding`** — owner-scoped status endpoint driving the frontend.

### 43.4 Frontend (extends the existing auth flow — nothing rewritten)
- **`AuthContext`** gained `onboarding` (fetched for JOB SEEKERS on session start), `refreshOnboarding`, and `onboardingOpen`/`openOnboarding`/`closeOnboarding`.
- **`components/onboarding/OnboardingModal.jsx`** — a portal modal (Welcome → Identity & Profile form → Résumé hand-off → Done), mounted ONCE in `AppLayout`, self-gating to incomplete seekers: **auto-opens** for an incomplete profile (dismissible per session) and is **force-opened** by a gated Apply. It **reuses the existing `PUT /profile`** with a FULL prefilled payload (round-trips every profile column) so an untouched field — e.g. a walk-in's existing skills/preferences — is never nulled. Required-field validation, loading/saving states, success feedback.
- **`PublicJobBoard` Apply gate** — `handleStartApply` opens onboarding instead of the wizard when `!onboarding.canApply`, with a clear message; the board refreshes onboarding on mount so a résumé added elsewhere flips the gate.
- **Walk-in**: no code change — a claimed/encoded walk-in seeker with missing dob/education hits the same derived gate + modal on login. Requirement met by construction.
- **Profile page cleanup**: removed the **Profile Activity** + **Response Tracker** sections (hardcoded-zero empties with no backend) and their now-unused icon imports.

### 43.5 Invariants / rules
Backward-compatible + additive: existing registration/login/OTP/verify/dashboard/apply-wizard/PUT-profile are UNCHANGED; the gate is a NEW first-class rule (not a "secondary concern" — a definitive incomplete legitimately refuses Apply, while an indeterminate check fails open). Résumé "on file" = `uploaded_resumes.parsed_text` non-empty (single source, matches the scorer). `test/onboardingGate.test.js` (5 guards). Files: `services/onboardingService.js`, `routes/applicationRoutes.js`, `routes/profileRoutes.js`, `src/context/AuthContext.jsx`, `src/components/onboarding/OnboardingModal.jsx`, `src/App.jsx`, `src/components/PublicJobBoard.jsx`, `src/components/Profile.jsx`.

### 43.6 Optional "About you" onboarding step (2026-09)
Extended `OnboardingModal` with a 5th step (`details`, between Identity and Résumé) that collects OPTIONAL profile fields at setup instead of leaving users to discover them later: **Personal Details** — Languages Spoken (`languages`) + Core Skillsets (`skills`), both comma-separated `<textarea>`s mirroring Identity & Profile EXACTLY (same placeholders/behaviour); **Work Preferences** — Preferred Job Roles (`preferred_roles`), Experience Level (`experience_level`), Availability (`availability`), Career Goals (`career_goals`), the same inputs/options as the profile "Career Preferences" section (the two selects gain a `Select…` empty option so an unset value stays null). ALL OPTIONAL — the completion gate is still the 6 identity fields, so skipping preserves `profileComplete`/`canApply`. **No new columns/model:** the modal already round-trips every profile column, so this is UI-only; `saveProfile` was refactored into `persist({validateRequired,next})` — the identity step validates + advances to `details`; the details step saves (no required validation) or Skip. Single source of truth (`PUT /profile` → prepopulates + remains editable in Identity & Profile). `npm test` unchanged (168); frontend build clean.

## 44. PESO Admin export audit + dashboard-CSV parity fix (2026-09)

An audit of EVERY PESO Admin export + a refactor establishing export PARITY. On `main`; `npm test` **172**; frontend build clean; NO migration.

### 44.1 Audit findings
Four PESO Admin exports, ALL backend-query-driven (none paginate the frontend view):
| Export | Endpoint | Verdict |
|---|---|---|
| Dashboard summary CSV | `/peso-admin/analytics/export` | ❌ **INCOMPLETE** (see 44.2) |
| ATS applicants CSV | `/peso-admin/ats/applicants/export` | ✅ complete — `buildApplicantFilter` honours the SAME filters as the view, FULL dataset (no LIMIT), owner-scoped |
| Referral-row CSV | `/referrals/reports/export` | ✅ complete — `listReportRows({employerId,from,to})`, date-range-aware, owner-scoped, BOM+CRLF, `csvField`-guarded |
| DOLE Accomplishment PDF/CSV | `/referrals/reports/accomplishment` | ✅ complete (§39) |

So ONLY the Dashboard export was defective — exactly the owner's report. The others already retrieve the complete authorized dataset from the backend (not the paginated view).

### 44.2 The dashboard-export defect + fix
The dashboard DISPLAYS (`/analytics/overview`) six KPIs (activeVacancies, **totalJobSeekers**, **totalEmployers**, applicationsReceived, referralLettersGenerated, successfulHires) + vacancy/application status distributions + a monthly trend series (applications + hires) + three **pending-action** counts + a recent-activity feed. The export (`/analytics/export`) computed its OWN DUPLICATED SQL and emitted only FOUR KPIs + the two distributions — MISSING Registered Job Seekers, Active Local Employers, all three pending-action counts, and the ENTIRE monthly trend series, and it ignored the `?months=` window.
**Fix — parity by construction:** extracted the whole overview computation into a shared **`computeOverview(adminId, windowMonths)`** that BOTH `/analytics/overview` (JSON) and `/analytics/export` (CSV) call, so the exported figures can NEVER again drift from what the dashboard shows. The export now flattens the FULL result into the Metric/Value/Context sheet — all six KPIs, all three pending actions, both distributions, and the monthly trend for the SAME window (the frontend `PesoAdminOverview` passes `?months=<trendMonths>` so the export matches the displayed trend range — preserving the current view). Recent activity (a transient live feed, not a summary metric) is deliberately excluded. `sendCsv` (the shared helper: header + rows, escaping) is unchanged; the export stays a flat LABEL/VALUE/CONTEXT sheet.
**Not changed (already sound, and the brief says don't touch unrelated functionality):** the ATS + referral-row + DOLE exports. `test/dashboardExportParity.test.js` (4 guards) locks: overview + export read ONE `computeOverview`, the export re-runs NO `db.query` of its own, it carries all 6 KPIs + pending + distributions + trends, and respects `?months=`. `npm test` **172**. Files: `routes/pesoAdminRoutes.js`, `src/components/PesoAdminOverview.jsx`.

## 45. Landing Events single-event carousel + PHP currency centralization (2026-09)

Frontend-only presentation cycle. Two owner requests: redesign the Landing **Events & Job Fairs** section into a premium single-event carousel, and standardize monetary display on the Philippine Peso (₱). NO migration; `npm run build` clean.

### 45.1 Events carousel redesign (supersedes the §34/§38 two-row shelf)
`LandingPage.jsx`: `EventsShelf` + `LandingEventCard` were **replaced** by `EventsCarousel` + `LandingEventSlide`.
- **One hero slide at a time**, the uploaded `banner_image` as the primary visual with a bottom legibility scrim; branded gradient fallback when an event has no banner. The whole slide is a `<button>` that opens the existing `LandingEventModal`.
- **Motion:** a `flex` track of `basis-full` slides translated by `translateX(-index*100%)` (`transition-transform duration-700`, GPU/compositor-friendly). Autoplay advances index right→left every 5.5s.
- **Autoplay management:** a single `setTimeout` keyed on `index` (so any manual nav RESETS the timer — no surprise double-advance), inert while `paused` (hover/`onMouseEnter` + `onFocusCapture`), single-event, or `prefers-reduced-motion`. The global index.css reduced-motion rule also collapses the slide transition to 0.
- **Controls:** dynamic pagination **dots** (`role="tab"`, one per published event, active = `w-7` pill, click → `go(i)`); hover-revealed prev/next **arrows** using the §7 `.reveal-on-hover` capability class — hidden at rest ONLY on `(hover:hover) and (pointer:fine)`, so **always visible on touch** (mobile-accessible) and keyboard-reachable via focus-within/visible. Touch/pointer **swipe** (40px threshold) navigates.
- **ARIA:** container `role="region" aria-roledescription="carousel"`; each slide `role="group" aria-roledescription="slide" aria-label="N of M: title"`, inactive slides `aria-hidden` + `tabIndex=-1` so focus never lands behind them.
- **Edge cases:** `single = count<=1` → static hero (no autoplay/arrows/dots); **0 events** → the section renders its existing purposeful empty state (carousel never mounted); the loading skeleton mirrors the hero frame (no CLS).
- **Preserved:** the data source (`GET /api/events?scope=upcoming&limit=12`, banner always included, §34), `LandingEventModal` (on-demand full fetch), and the LandingPage bespoke-palette exclusion from design tokens (§24). A small `usePrefersReducedMotion` hook was extracted (same idiom as `HeroMascot`).
- **Rule reversal:** the 2026-08 owner directive "strictly two-row, no arrows/dots/autoplay/snap" (§34/§38 C2, incl. the shelf edge-fade affordance) was deliberately reversed by this later owner request. Do NOT restore the two-row shelf. Addendum §4.3 + SKILL §34/§38/§45 + the still-live rule updated in lockstep.

### 45.2 Currency: the system was ALREADY PHP; centralized ₱ + icon fix
A full audit (frontend + backend) found **no USD monetary values to convert**: salary is a FREE-TEXT `salary_range` VARCHAR the admin types (e.g. "50k", "₱15,000 - ₱25,000/month") and is rendered verbatim everywhere; the backend never formats money; reports, referral letters, notifications, and analytics carry no monetary values. The only `$`-as-currency indicators were decorative **`DollarSign`** lucide icons.
- **Icons:** `DollarSign` → **`PhilippinePeso`** (lucide-react 1.21) at the `PesoAdminDashboard` salary input and the `LandingPage` job-detail salary tile; the **unused** `DollarSign` import in `PublicJobBoard.jsx` was removed. Salary placeholder → `e.g., ₱15,000 - ₱25,000 / month`.
- **Centralized formatter:** new `src/utils/currency.js` — `formatPHP(value)` (`Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' })`) + `PESO='₱'`. It is the ONE home for any FUTURE numeric monetary display; it has **no caller today** (there is no numeric money), and `salary_range` must NOT be ₱-prefixed through it (that would double the currency the admin already typed). This satisfies the "centralized approach" request without fabricating usage or altering any value/record/calculation.

### 45.3 Verification
`npm run build` clean. Carousel verified functionally in-browser (dev server) via a client-side XHR mock of `GET /events` (prod had 0 upcoming events; **no test data was written to production**, per the verification constraints): confirmed 3 dynamic dots = event count, labelled prev/next arrows, autoplay auto-advancing, `translateX` transform tracking index, forward/backward wrap-around, hover-pause holding autoplay, data-URI banners painting, and slide ARIA (`"N of M: title"`). The empty-state edge case was confirmed live against real (empty) prod data. Screenshots were unavailable this session — the preview pane returned blank/dark frames ("window may be behind another window"), an environment limitation, not a component defect; the DOM/behavior was verified programmatically instead. Authed surfaces (the PESO Admin salary input icon) were not exercised live — they need the owner's login. Not yet committed.

### 45.4 Banner/poster quality + Landing-stat "+" removal (2026-09, follow-up)
Second refinement pass on the same section. `npm run build` clean; NO migration.

**Diagnosis of the banner blur** (the owner asked whether it was CSS, image optimization, R2, browser rendering, or frontend processing):
- **R2 is NOT involved** — event banners are **base64-in-DB** (`peso_events.banner_image LONGTEXT`, §41 owner decision); R2 serves only *job* images (§41). Ruled out.
- **PRIMARY cause = destructive frontend upload processing.** The old `PesoEventManager.fileToDownscaledDataUrl(file, 1000, 0.82)` hard-downscaled EVERY poster to **1000px** wide and re-encoded **JPEG q0.82** — permanent loss. The redesigned §45.1 hero then displayed that 1000px source at ~1186px CSS, *upscaling* it → visible blur.
- **SECONDARY = carousel CSS.** `object-cover` on a fixed landscape frame cropped portrait posters and a `scale-105` hover transform interpolated the raster.

**Fixes (all in-scope; base64-in-DB unchanged):**
- **Upload (`PesoEventManager.jsx`), renamed `fileToBannerDataUrl`:** quality-preserving. If the original is ≤ `MAX_BANNER_W` (2000px) AND ≤ `MAX_BANNER_CHARS` it is stored **VERBATIM** (own bytes + format → crisp PNG text posters stay lossless, no upscale). Otherwise downscale (never up) to 2000px and re-encode JPEG at **q0.92**, stepping quality down only as far as needed to fit the cap, with a **white matte** first so a transparent PNG doesn't turn black. Backend `eventRoutes.MAX_BANNER_CHARS` raised `2_600_000 → 3_000_000` (~2.2MB image) to admit 2000px posters; the client mirrors that constant — **keep the two in lockstep**. express body limit (50mb) already ample.
- **Carousel CSS (`LandingEventSlide`):** the poster now renders with **`object-contain`** (no crop, no distortion, any aspect ratio) over a **blurred, scaled copy of itself as a backdrop** (`object-cover scale-110 blur-2xl opacity-50`) so portrait A4 posters and landscape banners both display in FULL and the frame never looks empty. Frame heightened `h-[19/24/27rem] → h-[24/30/34rem]` ("not an unnecessarily small frame"). The blur-inducing **hover `scale-105` was removed from the poster** (raster upscaling interpolates); the subtle zoom now lives only on the blurred backdrop, where softness is intended. `decoding="async"` added. The detail **modal** image also moved `object-cover max-h-56 → object-contain max-h-[60vh] bg-[#0b1c30]` so the full poster shows sharp. Skeleton heights updated to match (no CLS).
- **Verified** (mock, portrait 900×1273 poster): active slide has 2 imgs, poster `object-fit:contain`, backdrop `filter:blur(40px)`, frame 544px, poster fits by height (~384×544, downscaled = sharp) centered over the fill — no crop/distortion. Landscape banners letterbox the same way.
- **CEILING (not done — owner decision):** true "serve appropriately sized source + retina/responsive `srcset` + optimize delivery" needs event banners on **R2 with responsive variants + URL-in-list** (base64-in-DB can't do variant delivery, and the list inlines banners). That is the deferred §41 Phase for banners — it REVERSES the §41 "banners stay base64-in-DB" owner decision, so it was flagged, not implemented. **Existing banners remain at their already-degraded 1000px/q0.82 quality until re-uploaded** — the upload fix only improves NEW uploads (the loss is permanent, nothing to backfill).

**Landing stats "+" removal:** the four hero stats (Available Opportunities / Referral Letters Issued / Successful Hires / Active Local Employers) rendered via `CountUp` whose `suffix` DEFAULTED to `'+'`. Changed the default to `''` (CountUp has ONE caller, the stats tile map at `platformStats?.[s.key]`), so the exact recorded figure shows with no approximation modifier. **No query/analytics/data-source change** — the values still bind dynamically to `GET /api/job-board/stats`. Verified in-browser: all four render plain numbers, no `+`.

### 45.5 True infinite-loop carousel + storage-agnostic banner URLs (2026-09, follow-up)
Third refinement on the same carousel. `npm run build` clean; NO migration; frontend-only.

**Problem:** the §45.1 carousel used `translateX(-index*100%)` with a modulo `index`. Advancing from the last event wrapped `index` n-1 → 0, so the track ANIMATED all the way back to the start — a visible reverse/rewind at the seam (and the mirror jump first→last going back).

**Fix — clone-based infinite loop (`EventsCarousel`).** The track now renders `[cloneOfLast, ...events, cloneOfFirst]`; a real slide i lives at extended position `pos = i+1`, starting at 1. `step(±1)`/`goToReal(i)`/autoplay/swipe all move `pos` within the extended array with the transition ON. When `pos` lands on a **clone** (0 or count+1) the slide animates FORWARD onto it (identical pixels to the real twin), then a **JUMP** — transition momentarily OFF — resets `pos` to the real twin (0→count, count+1→1). So last→first continues in the same forward direction and first→last reverses seamlessly, with no rewind. Dots + slide ARIA read `realIndex = ((pos-1)%count+count)%count`, correct even on the clone frame; a dot click sets `pos = i+1`.
- **The clone→real jump is TIMER-driven (`setTimeout(SLIDE_MS+40)`), NOT `transitionend`.** `transitionend` proved unreliable here — a concurrent React re-render retargets the transform and the event never fires, so the seam would never snap and `pos` ran away unbounded (observed `-1900%`). The timer is deterministic.
- **Re-enabling the transition after the jump uses `setTimeout(30)`, NOT `requestAnimationFrame`.** rAF is gated on paint, so in a backgrounded / non-painting tab the double-rAF never ran and the carousel got STUCK with the transition disabled + `snapping` latched true (every later click ignored). A macrotask timer fires regardless; React has already committed the instant jump before it runs, so re-adding the transition class animates nothing. `snapping` (ref) guards input during the ~2-frame jump.
- **Autoplay + manual share ONE path** (`step`); autoplay keyed on `pos` (resets the timer on manual nav), off while paused (hover/focus) / single / reduced-motion. Hover-pause, focus-pause, swipe, hover-revealed arrows all preserved.
- **Edge cases:** `single = count<=1` → no clones/arrows/dots/autoplay, static hero. `count===2` → `slides=[e2,e1,e2,e1]` (pos1=e1 real-first, pos2=e2 real-last, clones at 0=e2 / 3=e1) — same seam logic. `count===0` never mounts (empty state).
- **Verified in-browser** (3-event mock, transform+dot sampled): fwd `-100→-200→-300`(last)→`-400`(clone)→snap `-100`(first)→continues `-200`; back first→`0`(leading clone)→snap `-300`(real last); dot click jumps to the right event; clicks after a seam work (re-enable fix). 1/2-event covered by construction. Screenshots still unavailable (hidden/non-painting preview pane); verified programmatically.

**Storage-agnostic banner URLs (R2-ready).** The owner asked to ensure the carousel serves banners from Cloudflare R2, not legacy `/uploads`. Finding: the event carousel **never used `/uploads`** — `resolveJobImage`/`FILE_BASE` is used ONLY for *job* `featured_image` (the Local Employment Board cards; those already pass R2 full URLs through, §41). **Event banners are base64-in-DB** (§41) rendered as `data:` URIs. So there is no legacy `/uploads` path to remove for events. Added `resolveBannerSrc(src)` (used by `LandingEventSlide` + `LandingEventModal`): pass-through for `data:` and absolute `http(s)` URLs (so an R2 URL renders verbatim if banners ever move to object storage) and `FILE_BASE`-prefix for a bare relative path (never mis-resolves against the Vercel origin). Today it is effectively a no-op (banners are data URIs), but it makes the carousel correct for EVERY backend including R2 without the deferred §41 banner-migration. Moving event banners onto R2 (which would also unlock the §45.4 retina/responsive ceiling) remains the deferred, owner-decision §41 phase — NOT done here.

### 45.6 Event banner base64→R2 migration — BUILT + dry-run-verified, owner-run (2026-09)
The owner then approved the actual move: migrate existing event banners off base64-in-DB onto Cloudflare R2 (the §41 deferred phase, now authorized). **This session BUILT and locally-verified everything; it did NOT run the prod migration or commit — the owner runs the migration on Render (where R2 creds live) and verifies, THEN the Landing series is committed** (owner's chosen order; this session has no R2 credentials — `STORAGE_DRIVER` unset locally → `local` — so it physically cannot upload to R2 or write to prod, matching the repo rule that prod writes are owner-run).

**Audit (read-only prod probe, allowed).** `peso_events` = **3 events, ALL banners base64 data URIs** (PNG 234 KB, JPEG 65 KB, PNG 1.18 MB), **zero `/uploads`/local files, zero R2 URLs**. So the described "migrate `/uploads` files" had nothing to move — the real task is **base64→R2**, a production DATA write that reverses §41 for event banners (owner-approved). It is a STORAGE-PATH migration only: no event title/description/date/venue/status/publishing is touched.

**What was built:**
- **`services/eventBannerStorage.js`** (shared by the route + the script so the key scheme can't drift): `parseDataUri` (base64 data URI → {buffer, mime, ext}), `bannerKey` (content-addressed `event-banners/<sha256[0..16]>.<ext>` — collision-safe, id-independent, dedups), and `persistBannerRef(bannerImage)` — uploads a data-URI banner to R2 when `storageService.DRIVER==='r2'`, else returns it unchanged (dev keeps base64); resilient (an R2 failure falls back to base64 so the event save never fails, 0.1). Banners are public marketing content → same PUBLIC R2 bucket as job images.
- **New-upload path:** `eventRoutes` POST/PUT now call `persistBannerRef` so NEW banners land on R2 in prod (base64 in dev) — otherwise the migration would be undone by the next upload. Size check still runs on the incoming base64 first; `undefined` (keep existing) is untouched.
- **Migration 048** — `peso_events.banner_image_legacy LONGTEXT NULL` (rollback archive).
- **`scripts/migrate-event-banners-to-r2.js`** (`npm run migrate:event-banners`) — RE-RUNNABLE, idempotent (only `banner_image LIKE 'data:%'`), rollback-preserving (archives the original base64 to `banner_image_legacy` via `COALESCE` BEFORE overwriting with the R2 URL), announces db/host/driver, **refuses a real run unless `STORAGE_DRIVER=r2` + `R2_*` configured** (else it would write local `/uploads` paths into the DB), supports `--dry-run` (read-only preview, no 048 needed) and `--rollback` (restores base64 from legacy; leaves R2 objects in place).
- **Frontend:** `resolveBannerSrc` centralized into `jobs/jobImage.js` (was inline in LandingPage) and applied at EVERY event-banner render site — `LandingPage` (carousel + modal), seeker `Events.jsx` (card + modal), `PesoEventManager` (manage list + upload preview) — so Job Seeker / PESO Admin / PESO Staff all render base64 AND R2 URLs correctly during and after the migration.

**Verified locally:** `npm run build` clean; `node --check` on the new backend files; **`--dry-run` against prod** found all 3 banners, decoded them, and computed keys (`migrated=3 skipped=0 failed=0`). The abort guard confirmed it refuses to write in the local (`driver=local`) env. NOT verified: the actual R2 upload + prod render (owner-run on Render). A stale Vite HMR console error (`onTransitionEnd is not defined`, `?v=` dep hash) appeared in the dev pane but is NOT in the source (grep clean) and NOT in the prod build (passes) — a dev-cache artifact that clears on dev-server restart.

**Owner run-book (Render, `STORAGE_DRIVER=r2` + `R2_*` set):** 1) `npm run migrate` (applies 048). 2) `node scripts/migrate-event-banners-to-r2.js --dry-run` (preview). 3) `node scripts/migrate-event-banners-to-r2.js` (migrate the 3 banners). 4) Verify the Landing carousel + Events pages (seeker/admin/staff) render from `https://<R2 public base>/event-banners/...` with no broken images / no localhost fallback. 5) On success, the base64 originals stay in `banner_image_legacy` for rollback (`--rollback`); delete them (a later contract migration) only once confident. THEN commit the full Landing series to `main`.

**COMPLETED + verified (2026-09, owner-run).** The owner ran it **locally** (not Render — the free tier has no shell) by exporting the Render R2 vars into their PowerShell session (`$env:…`), since the local checkout already points at prod TiDB — the only missing piece was R2 creds. Two lessons banked:
- **`R2_PUBLIC_BASE_URL` MUST be the bucket's PUBLIC ORIGIN (the r2.dev URL / custom domain), NOT the bucket name.** The first real run had it set to the bucket name (`peso-kabankalan-assets`), so `storageService` returned `peso-kabankalan-assets/event-banners/<hash>.<ext>` — an unreachable string, not a URL — into `banner_image`. Fixed the script: (a) **rollback broadened** to `banner_image NOT LIKE 'data:%'` (the original `LIKE 'http%'` couldn't catch the malformed bucket-name values); (b) a **guard** now ABORTS a real run unless `R2_PUBLIC_BASE_URL` starts with `http(s)://`, so a misconfig can't store broken references again. Owner rolled back → set the correct `https://pub-6ddbb555075e4c689a96973844c278d7.r2.dev` → re-ran.
- **Result:** all **3** events now serve `https://pub-6ddbb555075e4c689a96973844c278d7.r2.dev/event-banners/<sha16>.<ext>` (owner-probed: kinds all `https-url`, `has_legacy=true`); the 3 URLs return **HTTP 200** with correct bytes (234 KB PNG / 65 KB JPEG / 1.18 MB PNG); the live carousel's poster `src` is the r2.dev URL (`posterIsR2=true`, all 3 upcoming). Render's `R2_PUBLIC_BASE_URL` confirmed to be the r2.dev URL (so new in-app uploads store correct links). **The R2 secret was pasted in chat → owner rotating the R2 API token** (create new token → update Render `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` → verify an upload → delete old token; public reads/existing images unaffected by rotation). A pixel screenshot of the carousel could not be captured — the in-app preview pane wasn't compositing this environment (dark frames); verified via DOM + `curl` instead.

## 46. Landing Page content-integrity cleanup — testimonials + FAQ-contact removed, FAQ+Visit consolidated (2026-09)

Content-integrity + de-duplication pass on `LandingPage.jsx`. `npm run build` clean; NO migration; frontend + one dead backend route removed.

- **Removed the "Voices from the Community — Built for Kabankalan's Workforce" testimonials section** and its hardcoded `TESTIMONIALS` array. These were placeholder personas, not real/consented Job Seeker feedback and not backed by any data relationship — presenting them as genuine community feedback is an unsupported claim, so they're gone. Unused `Quote`/`Star` lucide imports removed with them.
- **Consolidated "Common Questions" (FAQ) + "Visit Us In Person — Our Office" into ONE section** (`#faq`). The four Common Questions are UNCHANGED (still `FAQ_DATA`, exact same four). The office info (address / hours / Facebook connect), **Get Directions**, **Message Us**, and the map-preview link now sit in the right column of the same section, with `id="location"` moved onto that column so BOTH nav anchors (`#faq`, `#location` — used by the top nav and the footer) still resolve. The standalone Visit Us section was deleted.
- **Removed the "Contact Us — Connect with PESO Administrators" form entirely** — inputs, submit button, `handleContactChange`/`handleContactSubmit`, `contactForm`/`sendingContact` state, and the `POST /api/job-board/contact` call. It duplicated the office **"Message Us"** channel (Facebook), which is now the SINGLE contact channel on the landing page. Its backend route in `jobBoardRoutes.js` (which INSERTed into `contact_inquiries` + sent a convenience outbox email) was also removed — it was dead (nothing else called it; **nothing reads `contact_inquiries`**), and its now-orphaned `emailOutboxService` require was dropped. The dormant `contact_inquiries` table is LEFT in the DB (physical schema frozen on live TiDB, §0.7) — a replaced route comment marks the removal so it isn't reintroduced.
- **Repositioned the "Your next opportunity is waiting in Kabankalan." green CTA INTO the FAQ column** (below the Common Questions accordion), NOT as a separate full-width page-closer band. The office card + map in the right column made that column taller than the FAQ list, leaving an empty gap under the FAQ; the CTA now fills it. Mechanism: the left column is `flex flex-col` and the CTA is `flex-1`, so under CSS-grid `align-items: stretch` the left column matches the right column's height and the CTA grows into the leftover space → the two columns **bottom-align** (verified at `lg` 1440px: both columns 897px). The standalone Final-CTA `<section>` was deleted. Layout only — the CTA's buttons (register + scroll-to-jobs) are unchanged; on mobile (`<lg`, stacked single column) it simply sits below the FAQ at natural height. (An earlier first attempt made it a full-width `max-w-7xl`/`pb-24` closer BELOW the whole section — corrected to the in-column placement per the owner's reference screenshot.)
- **Preserved:** all auth/registration/login, messaging, the four FAQs, office-location content, Get Directions, Message Us, and every other landing section (hero, job board, events carousel, how-it-works, partner marquee, CTA, footer). Verified in the live DOM: testimonials gone, contact form gone, `#faq` present with `#location` nested inside it, exactly 4 FAQ questions, one "Message Us" link, CTA inside the FAQ column with columns bottom-aligned, no console errors.

## 47. Dashboard UX — top-header hover dropdowns + welcome-greeting relocation (2026-09)

Frontend UX/interaction pass on the authenticated dashboard shell. `npm run build` clean; NO migration; no backend/auth/business-logic changes.

- **Hover-to-open dropdowns (TopHeader avatar menu + NotificationBell).** Both now open on **hover** as well as click, with the existing `animate-in slide-in-from-top-2` slide-down entrance. Hover is **capability-gated** — `matchMedia('(hover: hover) and (pointer: fine)')` — so a touch device never gets a phantom hover (tap/click stays the interaction; UI addendum §7 / principle 1.4). `onMouseEnter`/`onMouseLeave` sit on the `relative` WRAPPER (button + panel) with a **~180ms leave-close timer** (cleared on re-enter and on unmount) so the cursor can cross the gap into the panel without dismissing it. Click, outside-click, Escape, ALL menu contents/actions/handlers, auth (logout), notification logic (mark-read, deep-links, unread badge, 30s tick) and backend integration are **unchanged**. This relaxes the long-standing "bell opens on click, never hover" rule (§7.7 / addendum §10.1) by owner request — SKILL §7.7 + addendum §10.1 updated in lockstep.
- **Welcome greeting RELOCATED from the header to a temporary session greeting above "Dashboard Overview".** The persistent Job-Seeker "Welcome back" chip was REMOVED from `TopHeader` (its `welcomeIllustration` import + `isJobSeeker`/`firstName`/`normalizeRole`/`ROLE_KEYS` usages dropped; the header is now controls-only, still `justify-end`). New `components/dashboard/DashboardGreeting.jsx` renders ABOVE the `Dashboard Overview` `<h1>` (Dashboard.jsx): a personalized "Hello, {firstName}! 👋" banner with the illustration, shown **once per session per user** (a `sessionStorage` flag `pk_dash_greeted:<userId>` — so it does NOT reappear on in-dashboard navigation, and a different login in the same tab greets afresh), then **auto fades out** after ~7.5s (`transition-opacity`, respects `prefers-reduced-motion` via the global rule → instant for those users; `VISIBLE_MS`, owner-tuned). Name comes from the authenticated `user` (any role). Pure presentation — no backend calls.
- **Hired celebration variant (owner follow-up):** `DashboardGreeting` now shows a celebratory variant — `src/assets/illustrations/hired.png` + "You're hired, {first}! 🎉" on an emerald surface — when the seeker has a referral with placement outcome `'Hired'` (the system's authoritative "hired" signal, §0.14), read **best-effort from `GET /referrals/mine`** (`outcome === 'Hired'`); any fetch failure falls back to the normal `welcome-hero.png` welcome. The celebration is a MILESTONE shown **once EVER** per user (persistent `localStorage` `pk_dash_hired_celebrated:<userId>`, distinct from the once-per-session `pk_dash_greeted` normal gate) — after it's shown the seeker gets the normal welcome again. Same fade; reuses the existing route (no new backend). (A compact-pill layout was tried for the greeting and REVERTED — owner kept the full-width banner.)
- **Illustration + timing (owner follow-up):** the owner added the new artwork at `src/assets/illustrations/welcome-hero.png` (1254×1254 PNG); `DashboardGreeting` now imports it (placeholder `welcome.svg` retired) sized `w-20 sm:w-28 lg:w-32`. Hover timing was **retuned** after owner feedback ("feels off") from instant-open/180ms-close to proper **hover-intent: open 110ms / close 320ms** via a single `hoverTimer` ref per menu (`HOVER_OPEN_MS`/`HOVER_CLOSE_MS` in both TopHeader + NotificationBell) — a brief open delay avoids accidental pop-on-brush, the longer close delay eases travel into the panel. _(Later 2026-09: both greeting illustrations were swapped to WebP — `DashboardGreeting` now imports `welcome_hero.webp` + `hired.webp` from `src/assets/illustrations/`; the `welcome-hero.png` / `hired.png` originals are retained but no longer imported.)_
- **Verification:** `npm run build` clean; no dangling refs after the TopHeader rewrite (checked by grep — undefined refs don't fail the Vite build). The header + greeting live behind `AppLayout` (authenticated), which this session can't log into (no test creds) — runtime hover/greeting behaviour is owner-verified in a logged-in session.

## 48. Identity & Profile structural skeleton + AI Chatbot knowledge alignment (2026-09)

Two frontend/UX items. `npm run build` clean; NO migration; no backend/business-logic changes (the chatbot reuses its existing route + AI client).

- **Identity & Profile skeleton now STRUCTURALLY mirrors the page** (was a generic `SkeletonPageHeader` + `SkeletonForm sections={3}`). New **`SkeletonProfile`** in `components/Skeleton.jsx` reproduces the real `Profile.jsx` layout so nothing shifts on load: the header (title + subtitle); the 12-col grid with a **left summary card** (avatar circle + name/role + the two avatar buttons + a "Basic Information" block with two icon rows) and a **right column** = the **Profile-Strength card** (heading + progress bar + a varied set of metric chips) then the **tabbed form card** (three tab headers, an Edit button, a 2-col grid of labelled field rows, and a Save button). Same outer shell (`max-w-5xl`, `p-3 sm:p-5 lg:p-6`, `min-h-screen`) and card box model (`rounded-3xl border bg-surface/60`) as the real page. `Profile.jsx` now returns `<SkeletonProfile />` while loading; the old generic `SkeletonPageHeader`/`SkeletonForm` exports stay for other consumers.
- **AI Chatbot brought up to date with the current system.** The backend `SYSTEM_PROMPT` in `routes/chatbotRoutes.js` is the chatbot's single knowledge base; it had drifted weeks behind. Rewrote the job-seeker feature list to the CURRENT state and removed obsolete references: Dashboard now describes lifecycle KPIs + **Skill Demand** (not "Top Platforms"/"Total Tracked"); **My Applications** (one unified tracker) replaced the old "MyJobs drag-and-drop Kanban"; added the **account-completion gate** (profile fields + résumé required before Apply, §43) and the **3-step Apply Wizard**; the three separate builders collapsed into the **Document Builder** (résumé/cover/resignation, templates, PDF **and DOCX**, §30); referrals now cover the **endorse → seeker ACCEPTS → letter** acceptance flow + placement **outcomes** + seeker self-report (§26/§31.5); added **Events & Job Fairs**, the **notification bell**, **Saved Vacancies** (rename), **Import Past Applications** (rename), PHP (₱) salaries, numeric compatibility %, requirement-only scoring (certs not scored, §40); Identity & Profile now = personal details / work preferences / portfolio (NO ID-document verification, removed §14/§32.4). Frontend `Chatbot.jsx` `QUICK_ACTIONS` chips updated (the dead "drag-and-drop job pipeline" chip → "How to Apply"; plus "My Referrals" and "Build My Résumé"). No new intents/logic and no duplicate backend — the existing `/chatbot/query` route + `aiClient` + DeepL translation are reused as-is.
- **Verification:** `npm run build` clean; `node --check routes/chatbotRoutes.js` OK; residual-stale-term grep clean (only the intentional "replaced the older 'My Jobs' board" note remains). Both surfaces are behind `AppLayout` (authenticated), so runtime is owner-verified (no test creds this session).

## 49. Data-processing module refactor — Import Past Applications + Analyze My Resume (2026-09)

Blueprint `docs/data-processing-modules-proposal.md` (owner-approved defaults). Two Job-Seeker data-processing workflows rebuilt from fragile/AI-coupled one-offs into deterministic, backend-authoritative, production-grade pipelines with a **shared modal UX**. HEAD `f426e74` (tip of `main`, pushed); migration **049 APPLIED**; new backend dep **`mammoth`** (DOCX→text). `npm test` **172/0** throughout. ⚠️ The two reference CSVs (`job_past_applicatons_datasets.csv`, `Resume_datasets.csv`) are NOT the feature schema — the first is a dev employment SURVEY, the second a résumé-classification CORPUS (now the §49 Phase-D harness input); imports map to `usertrackedjobs`, résumé analysis to `uploaded_resumes` + the profile.

- **Phase A (`318f151`) — shared processing UX.** New `components/dataflow/ProcessingModal.jsx` (backdrop-click-close **guarded while busy** — `if (e.target===e.currentTarget && !busy) onClose()` — X disabled while busy, Escape guarded, `useFocusTrap`, `inert` when idle) + `StepProgress.jsx` (named steps: icon + title + subtitle + bar). Both Dashboard modals retrofitted onto it with double-submit guards.
- **Phase B (`2d6d9bb`) — deterministic Import pipeline (NO AI).** Migration **049** `import_batches` (counts only, `UNIQUE(user_id, import_id)` idempotency key + daily-rate index). New `services/importService.js`: parse CSV/XLSX (SheetJS) → resolve columns via `HEADER_SYNONYMS` → normalize (**local-tz-safe `fmtLocalDate`, NEVER `toISOString()`** — that shifts a day early for UTC+8) → canonicalize status to the tracked-board set (`STATUS_CANON`) → validate (Company + Job Title required) → dedupe within-file AND against the user's existing `usertrackedjobs` (`dedupeKey = lower(company)|lower(job_title)|date_applied`) → enforce limits (**2 MB / 500 rows / 5 imports-per-day / 1000 total tracked**). `preview()` is read-only; `commit()` re-parses/re-validates/re-dedupes (never trusts the client blob), is idempotent on `import_id`, and INSERTs in ONE transaction, recording an `import_batches` audit row. Routes `POST /profile/import/preview` + `/import/commit`. Frontend `ImportPastApplicationsModal.jsx` (select → preview → review → commit). **REPLACED the old `/tracker/upload`** — which AI-validated the file AND ran a **destructive `DELETE FROM UserTrackedJobs`** (wiped every tracked job on each import); the new pipeline is append-only.
- **Phase C (`e97399d`) — hardened Analyze My Resume.** New `services/resumeText.js` = ONE extraction path: PDF via the canonical `pdfTextService` (§12 — the old handler called `pdf-extraction` directly, a §12 violation) and **DOCX via the new `mammoth` dep (DOCX never worked before)**. `/profile/upload` gets a dedicated multer (PDF/DOCX only, 5 MB, clean 400s) and now **persists the extracted text to `uploaded_resumes` (UPDATE-in-place)** so analysis feeds AI scoring (§7.4); parsed-text only, the binary is never stored. Frontend `AnalyzeResumeModal.jsx` (select → analyze → review skills/experience → done). **Retention reality:** `uploaded_resumes` is one-row-per-user UPDATE-in-place (builder/apply/aiScorer all read the latest) → naturally bounded; the proposal's "keep 3 versions" assumed a versioning that doesn't exist, so there is NO pruning.
- **Phase D (`f426e74`) — shared analyzer + eval harness.** Extracted `services/resumeAnalyzer.js` (`extractResumeProfile`: prompt + AI + `baseProfile` shaping + optional Coresignal) so the live `/profile/upload` endpoint AND the harness run the SAME analyzer — removed the dead inline block + unused `axios` from `profileRoutes.js`. New `scripts/eval-resume-analysis.js` (`npm run eval:resume`): stratified-samples `Resume_datasets.csv` across categories → runs the real analyzer → reports extraction success / avg skills+exp / category coverage; `--dry` (no AI/no cost), `--limit`/`--scan`/`--category`. Dev tool, never touches the DB. Verified: `--dry` found 24 categories; a 2-résumé real run extracted 100% usable (HR 34 skills/7 exp, Designer 14/3).

### 49.5 Integration invariant — Import writes the SAME store the app already reads (owner-raised, VERIFIED 2026-09)

Concern raised: is the refactored Import still structurally + functionally wired into the existing application-tracking domain (Dashboard "All Your Applications" + the "My Applications" page), or did it grow a parallel store? **Verified end-to-end — it is the same store; no duplicate/isolated model.** Evidence:

- **Same table + schema + status model.** `importService.commit` → `INSERT INTO usertrackedjobs (user_id, company, job_title, job_type, date_applied, status, link, notes, work_setup, industry, application_source, expected_salary)` (`services/importService.js:271`) — the identical table + columns the manual "add tracked application" flow writes (`routes/trackedJobRoutes.js:95`, same `status || 'Applied'` default). Import writes a SUBSET; manual-only fields (job_description, interview_stage, contact_name…) default/NULL. Statuses canonicalize to the exact board vocabulary (`Applied / Under Review / Interview / Shortlisted / Rejected / Accepted`, `importService.js:42`), so an imported row sorts/filters/Kanban-groups like any other — indistinguishable downstream.
- **Same read feed powers both surfaces.** "All Your Applications" (Dashboard Pipeline Analytics + My Recent + KPIs) and the "My Applications" page both read `GET /api/applications/unified` (`routes/applicationRoutes.js:143`). Its `imported` branch is `SELECT … FROM usertrackedjobs WHERE user_id = ? AND deleted_at IS NULL` (`:173`) — the same query + soft-delete filter the tracked board uses (`trackedJobRoutes.js:35`). A freshly imported row appears in the feed on the next load with NO extra wiring; pins/labels come from the shared `application_preferences` (mig 037) keyed by the unified uid.
- **Validation runs BEFORE persistence, not as a parallel store.** Preview/dedupe/limits/confirmation are in-memory ahead of the insert; `existingKeys()` even dedupes against the very table it's about to write (`importService.js:130`), so an import can't collide with board- or prior-import-created rows. The only NEW table is `import_batches` — an audit/idempotency ledger (counts only), not an application store.
- **Existing records untouched; edits stay unified.** `commit` is append-only + idempotent (no UPDATE/DELETE of existing rows). Editing/deleting an imported row goes through the UNCHANGED `/tracked-jobs` endpoints — the same ones that edit manually-added rows. Referrals stay FK-bound to `job_applications` and are unaffected. **RULE (still-live):** Import Past Applications is another controlled *way to create `usertrackedjobs` records*, feeding the same `/applications/unified` layer — never a separate subsystem; do NOT introduce a parallel application table/model or a second read path.

## 50. Public Visitor-Support Chatbot on the Landing Page (2026-09)

Blueprint `docs/public-visitor-chatbot-proposal.md` (owner-approved defaults). A dedicated
PUBLIC AI assistant for anonymous Landing-Page visitors — SEPARATE from the authenticated
Job-Seeker chatbot (`routes/chatbotRoutes.js`, untouched) but sharing the DeepSeek engine. NO
migration; `npm test` **192**. Built A→E; each phase committed + pushed.

- **Phase A (`f2ba673`) — shared AI plumbing.** `services/aiClient.js` gained **`chatRaw()`**: the
  failover loop was refactored into a private `runCompletion` returning the FULL assistant message
  (so `tool_calls` survive — a tool reply legitimately has `content:null`); `chat()`/`chatDetailed()`
  are thin wrappers, every existing caller unchanged. `translateResponse` extracted verbatim to
  **`services/aiTranslate.js`** and reused by BOTH chatbots (one localization path, no drift).
- **Phase B (`1901f96`) — public route + tools (no UI).** `services/publicAssistant/knowledge.js`
  (PURE, unit-tested): the public system prompt (Visitor Guidance Layer — inform/guide/navigate/
  assist/escalate, NEVER invent), the DeepSeek function schema, conversation caps + `sanitizeMessages`
  (server owns the system message; client `system`/`tool` roles refused → no prompt injection), a
  non-fabricated `FALLBACK_REPLY`. `services/publicAssistant/publicData.js` (db): read-only PUBLIC
  data (vacancies/categories/stats via the same rows as `GET /api/job-board`, events via
  `eventRepository.listPublished`, office contact) behind ONE allowlisted `runTool` dispatcher — no
  per-user/auth table, no free SQL, explicit public columns. `routes/publicAssistantRoutes.js`:
  `POST /api/public-assistant/query` — NO auth, per-IP burst (20/15m) + daily (60/day) limits,
  validation, a bounded (≤3-round) tool loop over `chatRaw`, localization, `{reply, actions}`.
  Stateless — NO `chathistory`, no anonymous PII at rest. Mounted in `server.js`.
- **Answer-quality fix (`8d5c634`).** The model kept picking a `suggest_navigation` tool over
  answering. Removed navigation as a MODEL tool entirely (model now has 5 DATA tools only) and
  **derive the nav buttons DETERMINISTICALLY server-side** (`knowledge.deriveActions` — from which
  data tools ran + a keyword scan of the last user message, allowlisted to NAV, capped at 2). Prompt
  strengthened to answer substantively + list results. Result: real data-backed replies.
- **Phase C (`fbcfdea`) — Landing UI.** `components/PublicChatbot.jsx` mounted in `LandingPage.jsx`:
  floating brand-green launcher → responsive panel (mobile bottom sheet / desktop card), greeting +
  8 quick-action chips, auto-scroll, typing indicator, disabled-while-processing input, reset,
  graceful fallback. Landing-native (bespoke landing palette, NOT the app tokens §24), focus trap +
  `role=dialog` + Escape + `aria-live`, a self-contained reduced-motion-safe bubble keyframe (the
  app's `animate-in` utilities are no-ops — no `tailwindcss-animate`). Backend `actions` render as
  buttons; `onNavigate` reuses the page's own `scrollTo`/`setAuthMode` (→ `#jobs`/`#events`/`#faq`/
  `#location` or Register/Sign-in). Verified in-browser end to end. **Fix:** the `liveRef` guard now
  sets `true` in the effect SETUP (not only `false` on cleanup) — a dev Fast-Refresh remount was
  leaving it stuck `false` and silently dropping the in-flight reply.
- **Phase D (`4fe0b4b`) — hardening.** `sanitizeMessages` bounds the raw array (last 100) BEFORE
  iterating (unauth DoS guard); the route clamps the client `language` to a short alpha token before
  translation (it feeds the shared prompt). Tests +3.
- **Phase E — docs** (this record + SKILL still-live rule + proposal → SHIPPED).

### 50.1 App-wide `trust proxy` — DONE (2026-09, follow-up)

The flagged follow-up shipped. `server.js` now `app.set('trust proxy', 1)` — behind Render's one
proxy, `req.ip` is the REAL client IP, so EVERY `express-rate-limit` limiter (login/OTP/register/reset/
claim/chat/AI + the public assistant's) keys **per-visitor** instead of one global bucket, and the auth
`[AUDIT]` log records the client IP. `routes/authRoutes.js` `loginLimiter` raised **5→15 / 15min**
(per-IP now → tolerant of a shared office LAN where several PESO staff sit behind one NAT, still far
below any online brute-force threat — bcrypt + password strength are the real defense). The public
route's limiters reverted to the DEFAULT keyGenerator (the custom X-Forwarded-For parsing + `validate:
false` are gone). Verified in isolation: express-rate-limit accepts `trust proxy: 1` (a number, not the
permissive `true`) with no validator throw and resolves the forwarded client IP; **cookies unaffected**
— their `secure` flag is gated on `NODE_ENV === 'production'`, not `req.secure`. `npm test` 192.

## 51. Event edit — atomic banner Replace + event_date re-save fix (2026-09, `edd693f`)

Owner report: editing an event and changing its banner could make a still-published event VANISH
from the Landing Page, and the Edit modal only offered "Remove" (no proper Replace). NO migration;
no permission/publish/event-type/render change; PESO Admin AND PESO Staff share the one
`PesoEventManager` + `events:manage` path. `npm test` 192; frontend build clean. Two fixes:

- **The disappearance was the `event_date` re-save, not the banner.** The edit form round-trips the
  stored `event_date`, which serializes as a full UTC datetime (`2026-09-12T00:00:00.000Z`, DB pool
  `timezone:'Z'`); EVERY save (a banner change included) re-sent that raw string into the DATE
  column, risking a truncation/parse shift that drops the row out of the Landing carousel's upcoming
  filter (`status='Published' AND (event_date IS NULL OR event_date >= CURDATE())`) even though the
  record is untouched — the SAME date-fragility lesson as §49. Fixed by normalizing `event_date` to a
  plain **YYYY-MM-DD**: server-side in `eventRoutes.cleanEventInput` (`String(body.event_date).slice(0,10)`
  — defense for ANY client) AND client-side in `PesoEventManager.save`. Investigation confirmed the
  backend NEVER deletes/unpublishes an event on a banner edit (`events.update` doesn't touch `status`;
  `persistBannerRef` returns URLs unchanged + keeps base64 on R2 failure), and the Landing slide already
  renders a gradient fallback for a null banner — so the record was always safe; the date was the drop.
- **Atomic banner Replace.** The Edit modal's banner control gained a **"Change"** action beside
  "Remove": it picks + validates a new image (type → downscale-to-fit → hard `MAX_BANNER_CHARS` guard)
  and swaps the preview ONLY on success, so a bad/oversized/cancelled pick leaves the CURRENT banner
  (and the event) intact — no more Remove-first null-intermediate. End-to-end transaction safety: the
  DB banner is untouched until Save; on Save the backend `persistBannerRef` uploads the new asset to R2
  and returns the URL BEFORE the single `UPDATE`; any failure keeps the old value (or the whole save),
  so the event + its existing banner are never invalidated; content-addressed R2 keys never delete the
  old asset. Authed modal → owner runtime-verifies (no test login).

## 52. Chatbot UI unification — one launcher, one motion, shared primitives (2026-09)

Owner review: the public "PESO Kabankalan Assistant" and the authenticated "PESO Assistant Online"
were two duplicated frontend implementations. Decision: keep them SEPARATE at the context level
(routes/prompts/tools/permissions/data scope — already correct, §50) but UNIFY the UI so they feel
like one product. NO migration; frontend-only; `npm test` unaffected (192); build clean. Evaluation
finding: the **backend AI layer was already shared** (`aiClient` + `aiTranslate`, §50 Phase A); the
duplication was entirely in the two React components. Delivered in two phases (commits `accc431` +
this one):

- **Phase 1 — shared launcher + motion.** New `components/chat/ChatLauncher.jsx` — the shared pill
  (`JobSeekerMascot` logo + "Ask PESO Assistant" + accent "Chat" chip + aura + hover-lift), replacing
  the public bot's circular `MessageCircle` FAB and the authed bot's inline pill. New
  `components/chat/chatMotion.js` + `index.css` `.chat-msg-in` — ONE open/close panel transition
  (`chatPanelState`) and ONE real message-entrance keyframe, used by both. This also FIXED the authed
  bot, whose message animation was a **no-op** (`animate-in …` with no tailwindcss-animate plugin).
- **Phase 2 — shared message primitives.** `components/chat/MessageBubble.jsx` +
  `TypingIndicator.jsx` — the two repeated visual elements, extracted VERBATIM (each variant's exact
  classes preserved so neither bot changes visually) and used by both. `Chatbot.jsx` +
  `PublicChatbot.jsx` render their message loop + typing state through them.
- **Palette-parameterized by `variant`:** `app` = app design tokens + dark-mode (authed, inside
  AppLayout); `landing` = bespoke greens (public, since LandingPage is excluded from tokens §24/§45).
  Same structure/dimensions/typography/spacing/motion, different colors.
- **Deliberately NOT shared:** each bot's context-specific chrome — the authed bot's DeepL language
  menu + `main_menu`/`follow_up` interaction-state chips + per-user history/clear, vs the public bot's
  nav-action buttons + visitor quick-actions + click-outside dismissal. Forcing these into one
  component would add variant-branching that hurts maintainability more than it dedups — so the
  Composer and QuickActions stay per-context. The distinction is access/context, NOT visual identity.
- **Verification:** build clean; the PUBLIC side verified in-browser end to end (shared pill launcher,
  panel open/close, message bubbles + action button + typing all via the shared primitives, no console
  errors). The authenticated chatbot is login-gated (no test creds) → owner runtime-verifies its
  launcher/bubbles/typing after deploy; the extraction is verbatim so its visuals should be unchanged.

## 53. Landing Page Light/Dark toggle + bespoke dark palette (2026-09)

Owner request: add a Light/Dark toggle to the Landing Page, reusing the app theme system, synced
across Landing ↔ app. NO migration; frontend-only; build clean. **This SUPERSEDES the §24/§45 decision
that the Landing is "self-contained light / always light."**

- **Reuse (no duplication):** `ThemeProvider` already wraps the WHOLE app in `main.jsx`, so the Landing
  was already inside the theme context. Added the shared **`components/common/ThemeToggle`** to the
  Landing header (desktop + a mobile-bar instance). The theme state, `localStorage['theme']` persistence,
  the `.dark`-class-on-`<html>`, and the premium View-Transitions toggle animation are ALL the existing
  `ThemeContext` — so the theme is **synced Landing↔app** (sign in and the app is in the chosen theme)
  with zero new theme logic.
- **The catch + the fix:** the Landing was hardcoded light and EXCLUDED from the design tokens (§24 —
  tokenizing it was reverted for flattening the marketing palette; ~2 `dark:` classes in ~2000 lines).
  So the toggle alone would leave a half-dark page. Fix = a **curated bespoke DARK palette via `dark:`
  variants** (NOT tokens — the §24 exclusion still holds) across every surface: root ground (`#0b1220`),
  header, hero (dimmed photo `dark:opacity-25` + dark fade + light-green heading), all sections, cards
  (`#111b2e`), the `.glass-card` `<style>` rule (`.dark .glass-card`), the `#eff4ff`/`#caead6`/`#f8f9ff`
  tints, borders (`dark:border-white/10`), and all text (`#e6ebf2`/`#7fd8ba`/`#a3adbf`). Chosen to keep
  the marketing feel, not the flat monochrome that got reverted. LIGHT mode is unchanged (only `dark:`
  variants were added).
- **Public chatbot too:** the floating public assistant (landing palette) was made dark-aware for a
  consistent experience — the `ChatLauncher` / `MessageBubble` / `TypingIndicator` **landing** variants +
  the `PublicChatbot` panel/composer/input got `dark:` variants.
- **Verification:** toggle flips + persists (verified via the live `localStorage`/`.dark` state); a
  full-page computed-style scan reported **0 remaining light surfaces** in dark (including the open
  chatbot panel), down from 49; the dark hero is readable; light mode preserved. Lesson relearned: a
  bare Tailwind token (`bg-white`) is a PREFIX of its opacity variants (`bg-white/50`) — `replace_all`
  needs the full token or a following-char anchor, never a bare trailing-space match (it drops the space
  and merges the next class).

## 54. UI/UX optimization pass — events visibility, chatbot render parity, Profile routing (2026-09, `ccbfc5e`)

Owner UI/UX testing surfaced three issues (chatbot polish, admin Profile routing, "events no longer
showing"). NO migration; `npm test` 192/192; frontend build clean.

### A. Landing "Events & Job Fairs" rendered BLANK-but-clickable — ROOT CAUSE: a scroll-reveal race
The section mounted and stayed clickable but showed a blank/white area. The full pipeline was verified
healthy against LIVE prod first: API `?scope=upcoming&limit=12` returned 3 Published, future-dated events
with valid banners (base64 + an R2 URL); the carousel + slides + dots were in the DOM. The content was
present at **`opacity:0`** — the `.reveal` scroll-reveal system, NOT data/API/media/colour.
- `.reveal { opacity:0 }` until an IntersectionObserver adds `.active { opacity:1 }` on scroll-in.
- The observer effect re-queried `.reveal` on `[jobs, activeFaq, searchQuery, locationQuery]` — but NOT
  `events`. The Events carousel is a `.reveal` that mounts only AFTER the async `events` fetch resolves.
  When that landed after the observer's last run (a `jobs`-vs-`events` load race), the carousel was never
  `observe()`d → never `.active` → permanently invisible. Intermittent by nature (whichever list resolved
  last decided it), which is why an earlier DOM-only probe "saw" content (innerText/img read fine at
  opacity:0) yet the user saw white.
- **Fix:** add `events, loadingEvents` to the observer deps so it re-runs and re-observes the instant the
  carousel mounts — the SAME pattern the file already uses for the job board (its deps comment documents
  this exact failure mode). Minimal, matches precedent.
- **Verify caveat (important for future debugging):** the Browser-pane tab runs HIDDEN
  (`document.visibilityState==='hidden'`), which suspends IntersectionObserver callbacks AND CSS
  transitions — so ALL `.reveal` read `opacity:0` in-pane and a live scroll-reveal cannot be observed
  there regardless of correctness. Confirmed instead that `.reveal.active` resolves to `opacity:1` in the
  built CSS (transition removed inline to defeat the hidden-tab confound → computed opacity 1), and the
  fix is deterministic. Do NOT trust in-pane `opacity`/IO for reveal checks.

### B. A missing OR broken banner can never blank a card
`LandingEventSlide` already fell back to a branded gradient when `banner_image` was empty. Added `onError`
on the poster `<img>` (with `imgFailed` reset when the `banner` source changes) so a broken/404/invalid
R2 ref or corrupt data-URI ALSO falls back to the gradient instead of a broken-image glyph. Title/date/
venue/chips render regardless — an image failure never hides the card or the section.

### C. Landing now shows ALL published events (was upcoming-only) — owner choice
Past published events were correctly dropping off the `event_date >= CURDATE()` "upcoming" filter, which
read as "events disappeared." `eventRepository.listPublished` now, for the default 'all' scope, orders
**upcoming (soonest) → undated → past (most-recent first)** via a CASE expression, so a LIMIT surfaces
what's next instead of the oldest past rows (naive `event_date ASC` + LIMIT would have buried upcoming
events). The Landing fetch dropped `scope=upcoming` (now `?limit=12`); section relabeled "Upcoming PESO
Events" → "PESO Events & Job Fairs"; empty state + carousel aria updated; past events show badged "Ended"
(`eventRelativeStatus`). **`scope='upcoming'` is UNCHANGED** — still used by the public chatbot's
`get_upcoming_events` tool, which must only name future events. The `eventsSubsystem` test was updated to
assert the new upcoming-first ordering (kept the `event_date >= CURDATE()` + bounded-`LIMIT` assertions).

### D. Authenticated PESO Assistant — animation/render parity with the public assistant
Both chatbots already shared the motion layer (§52 `chatMotion`); the authed one felt laggier purely from
heavier rendering. In `Chatbot.jsx`: removed the full-page `backdrop-blur` behind the panel (kept the
dim), panel frost `backdrop-blur-3xl → md` + `transform-gpu` (the 3xl blur re-rasterizing during the open
scale/translate was the flicker), stripped ~6 redundant nested `backdrop-blur` passes on the already-92%-
opaque surface, switched auto-scroll from `scrollIntoView({behavior:'smooth'})` to a direct `scrollTop`
write (like the public bot), and pointed the dead `animate-in` no-op rows at the real shared
`.chat-msg-in`. Same look, far less per-frame work. Login-gated → verified via build, not runtime.

### E. TopHeader "Profile" routing — role-aware
The header's Profile item sent EVERY role to `/profile` (an applicant-only route), so a PESO Admin was
bounced by the ProtectedRoute — Profile appeared broken. Now via `normalizeRole` (matching the Sidebar):
PESO Admin → `/peso-admin/profile` labeled **"Organization Profile"** (the SAME authoritative module the
sidebar already links to — no duplicate/ambiguous route), Job Seeker → `/profile`, PESO Staff → item
hidden (no profile surface, Manager-only server-enforced). Super Admin never mounts this header.

## 55. Job Seeker vacancy-detail side panel — hierarchy/scanability redesign (2026-09, `650abfc`)

Owner UI/UX feedback: the posted-vacancy side panel (opened by double-clicking a `JobCard` on the
Public Job Board → `PublicJobBoard.jsx` `selectedJob` slide-over) felt compressed, hard to scan, and
visually unbalanced. **Layout/hierarchy ONLY — no change to data, handlers, the double-click open flow,
AI scoring pipeline, apply/save/inquire logic, similar-jobs, or filled logic.** `npm run build` clean.

- **The core fix — a "key facts" strip.** The facts a seeker actually decides on (Salary, Employment
  type + setup, Location, Positions open, Deadline) were buried in a small `Application Details` card down
  in the RIGHT sidebar. They now lead: a responsive grid (2-col mobile → 5-col desktop) of labelled cells
  directly under the title, via a new module-level **`DetailFact`** helper (icon + uppercase label + value,
  Salary emphasized). The old sidebar `Application Details` card was REMOVED (its salary/positions/deadline
  now live in the strip — no duplication) and the three generic header pill-chips were folded into it.
- **Context row + posting date.** A status pill (**Now Hiring** / **Vacancies Filled** from `filledLabel`)
  + **posting age** (new `postedLabel(created_at)` → "Posted N days ago"; `created_at` is available because
  the detail route is `SELECT pj.*`) + department sit in a compact row above the title.
- **Rhythm + typography.** Title `text-4xl`→`text-2xl/3xl`; consistent **iconized section headings**
  (`text-base` + icon + divider) across About the Job / Responsibilities / Skills / Qualifications /
  Additional Instructions / About the Employer; spacing normalized (`space-y-10`→`space-y-6`,
  `p-10`→`p-5/6/8`, `mt-16`→`mt-10`, consistent `rounded-2xl`); qualification + employer cards tightened.
- **Unchanged:** the sticky header actions (Back · Save · Inquire · Apply / Filled-lock), the AI
  Compatibility card (verbatim, still prominent in the sidebar), the deep-fetch pipeline (`handleOpenDetails`),
  and `ApplyWizard`. Theme-aware via design tokens (the board is inside `AppLayout`, so it IS tokenized —
  unlike the Landing §24). Login-gated → verified via build; owner runtime-verifies the logged-in panel.

## 56. System audit — abuse-protection + AI-cost rate limits + legal/privacy accuracy (2026-09, `4ffb377`)

A verify-before-change audit across requests/usage/abuse-protection and legal/compliance. Existing controls
were VERIFIED and LEFT INTACT; only confirmed gaps were closed. Report: `docs/system-audit-2026-09.md`.
`npm test` 192/192, build clean.

**Verified already-correct (unchanged):** AI client 20s timeout + circuit breaker + single-pass failover
(no runaway retries); the 7 outbox workers' `max_attempts` dead-letter + exp-backoff-capped-1h + per-tick
batch cap; the existing auth/chatbot/public-assistant/AI-builder limiters (keyed on the real IP via
`trust proxy`); public-assistant bounded tool loop; import per-user caps; hot-path caches. Legal: Privacy +
Terms modals (RA 8759/10691/10173); testimonials already removed (§46); Streamline attribution; NO external
scripts/fonts/CDN/tracking cookies; DiceBear generated locally; one strictly-necessary auth cookie.

**Gaps fixed:**
- **`middleware/rateLimiters.js` (NEW)** — shared, env-tunable (`RL_*`) limiter factory. **`globalLimiter`**
  is an app-wide `/api` backstop (default 300/min/IP; health + `OPTIONS` exempt) mounted in `server.js`, so
  NO endpoint is unbounded. Tight per-category limiters attached to the previously-UNPROTECTED cost
  endpoints: `applyLimiter` → `POST /applications`; `aiLimiter` → `POST /jobs/match`,
  `POST /profile/{upload,insights/generate,match}`; `writeLimiter` → `POST /profile/avatar`,
  `POST /messages/conversations`. `standardHeaders` on → clients get `RateLimit-*`.
- **`helmet` app-wide** in `server.js` — **CSP disabled on purpose** (this process serves JSON + public
  `/uploads`, never the app HTML — Vercel owns that) and **`crossOriginResourcePolicy: 'cross-origin'`**
  REQUIRED so the Vercel frontend can still load `/uploads` images (helmet's `same-origin` default would
  block them); COEP off.
- **`api.js`** — default 60s axios `timeout` (`VITE_API_TIMEOUT_MS`), so a stalled request rejects.
- **Privacy Policy (`LandingPage.jsx`)** — removed the outdated/misleading "government identification
  documents" claim (ID verification was removed §48); disclosed the real subprocessors (DeepSeek/OpenRouter,
  DeepL, Cloudflare R2, email, Google sign-in) + cross-border note + "not used for training / AI optional";
  added an accurate cookie/storage notice (no tracking cookies → no consent banner needed under the DPA).
  **Wording is accurate to the system but still needs DPO/counsel sign-off before public launch.**

**Deferred (owner/legal decisions, documented in the report, NOT changed):** blanket 50mb body limit
(tighten after a payload audit), Socket.IO send throttle, standalone `/privacy`·`/terms` routes, NPC
registration + DPO + concrete retention period, a WCAG re-audit of the new surfaces, and the already-tracked
pre-public secret rotations (`GOOGLE_CLIENT_SECRET` fallback, `.env` in git history, R2 token).

## 57. Standalone legal pages (`/privacy` · `/terms` · `/cookies`) + SPA deep-link fix (2026-09, `fa5d2f6`)

The §56 audit's "standalone routed legal pages" follow-up. Promoted the Landing Privacy/Terms modals to real,
shareable, indexable URLs, and — in the process — fixed a pre-existing production deep-link bug. Frontend-only,
build clean, verified live.

- **`components/legal/legalContent.jsx` (NEW) = ONE source of truth** for the Privacy, Terms, and (new) Cookie
  Policy text. Both the Landing **signup-consent modals** AND the new routed pages render it via the shared
  `<LegalSections>`, so the two surfaces can NEVER drift (the §56 rule — keep the modals truthful: no government-ID
  collection §48, real subprocessors disclosed). The modals were deduped to `<LegalSections sections={…}/>`
  (their shells unchanged; added `dark:text-gray-300` for dark mode).
- **`components/legal/LegalPage.jsx` (NEW)** — a self-contained public page (OUTSIDE AppLayout + the Landing)
  routed at `/privacy`, `/terms`, `/cookies` in `App.jsx` (public, no auth). Slim header (PESO seal + shared
  `ThemeToggle` + Home link), the document, sibling-doc tabs, footer; Landing-family palette (bespoke greens +
  `dark:` variants, NOT app tokens — §24/§53); sets/restores `document.title` for SEO. The **Cookie Policy** is
  new, written to the ACTUAL usage (one strictly-necessary `httpOnly` session cookie + local/session storage, no
  trackers → no consent banner under the DPA). Footer legal links now point to these routes (+ a Cookie Policy
  link); the signup-consent links keep the in-flow modals so a user never navigates away mid-signup.
- **`vercel.json` (NEW) SPA rewrite — fixes a LATENT PROD BUG.** There was NO SPA fallback: a hard hit / refresh
  on ANY client route (`/reset-password` — the link in password-reset emails! — `/job-board`, etc.) returned a
  Vercel **404**. Added `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` (Vercel serves
  real files from the filesystem FIRST, so `/assets/*` are unaffected). This makes the new legal URLs resolve
  when shared/indexed AND repairs every pre-existing deep link. **Verified live:** `/privacy` `/terms` `/cookies`
  `/reset-password` `/job-board` all now return **200** on a hard hit (were 404); `/privacy` renders h1 + all 4
  sections + tabs + the corrected content, tab-title `Privacy Policy · PESO Kabankalan`.
- **§57.1 (`2e2a428`) — reset-password link verified end-to-end + a 500→400 hardening.** Traced the whole
  chain: `POST /auth/forgot-password` (15-min JWT in `users.reset_token`, emailed as
  `${FRONTEND_URL}/reset-password?token=…` via the durable outbox, generic no-enumeration response) →
  the link (now 200 via the §57 SPA fix) → `ResetPassword.jsx` (reads `?token=`, POSTs `{ token, newPassword }`)
  → `POST /auth/reset-password` (`jwt.verify` + DB `reset_token` match → bcrypt(12), clears token). Happy path
  works. FIX: a malformed/tampered token throws `JsonWebTokenError` (not `TokenExpiredError`), which fell to the
  500 branch — now BOTH `JsonWebTokenError` and `TokenExpiredError` return a friendly **400** ("invalid or
  expired… request a new one"); 500 is reserved for a genuine error. Verified live: bogus token 500→**400**.

## 58. Remaining audit items — socket throttle, body-size, hardcoded-secret removal, panel a11y (2026-09, `64da8e6`)

The code-doable remainder of the §56 audit's deferred list. The human/operational items (NPC registration,
retention-period decision, DPO sign-off, the ACTUAL secret rotation in the Google/Render/Cloudflare consoles)
are captured turnkey in **`docs/compliance-and-security-runbook.md`** — they can't be done in code. `npm test`
192/192, build clean.

- **Socket.IO abuse protection (`socketServer.js`).** The realtime `send_message` path was UNBOUNDED (the REST
  half already had `writeLimiter`). Added a **per-socket sliding-window throttle** (`SEND_MAX` 20 / `SEND_WINDOW_MS`
  10s, env-tunable), a **content length cap** (`MAX_MESSAGE_CHARS` 4000) + an empty/malformed guard (`data || {}`
  so a garbage emit can't crash the handler); the trimmed `text` is what's persisted/broadcast.
- **Removed TWO hardcoded fallback secrets** (secret-rotation code side). The leaked `GOOGLE_CLIENT_SECRET`
  fallback (`authRoutes.js`) and the socket **`'fallback_secret_key'`** JWT fallback (`socketServer.js` — a public
  fallback key would let anyone FORGE a socket identity) now read ONLY from env. `JWT_SECRET` is already required
  app-wide (authRoutes signs with no fallback), so removing the socket fallback fails safe. The leaked values must
  still be ROTATED in the consoles (runbook §1).
- **Body-size limit `50mb`→`15mb`** (`server.js`, env `BODY_LIMIT`). The largest legitimate JSON payload is a
  base64 upload — an event banner (≤3MB) or a certificate / apply-résumé snapshot (≤5MB file ≈ ~6.7MB base64);
  FILE uploads use multer (per-route `fileSize` limits), NOT the JSON parser. ~3x smaller DoS surface, ~2x
  headroom over the largest payload.
- **WCAG (`PublicJobBoard.jsx`).** The vacancy-detail slide-over is a modal but had NO dialog semantics or
  keyboard dismissal. Added `role="dialog"` + `aria-modal="true"` + `aria-label` and **Escape-to-close** (the
  keyboard equivalent of the backdrop click, matching the other overlays). A FULL WCAG 2.1 AA pass (measured
  contrast across all states, screen-reader + focus-trap review) remains a dedicated follow-up (design skill).

## 59. Automation: n8n → Make.com migration — proposal + Option 2 provider-neutral webhook (2026-09, `bed7af8`/`e24d55a`)

Owner wants to retire self-hosted n8n (deploy/maintenance burden) for **Make.com** (no budget for n8n
Cloud), as a **one-for-one migration, not a redesign**. Audit finding: **n8n is a SINGLE downstream
webhook** — the referral pipeline's `dispatch_n8n` step (`referral.completed` → Google Sheet log +
employer notify) — and the backend already provides the retry caps / backoff / dead-letter-skip /
replay / graceful degradation (invariant 0.10) the request asked for. So the migration is small.

- **Proposal** `docs/automation-and-backend-architecture-proposal.md`: migrate the one scenario to
  Make (idempotency added IN Make), and — for Render Free tier — **keep the modular monolith**;
  extract the worker process (already engineered via `WORKER_MODE`, §25) only when `/admin/timing`
  profiling + a paid tier justify it (don't fragment into microservices; a 2nd Free service just adds
  cold-starts). Uploads already on R2 (not ephemeral disk).
- **Build guide** `docs/make-com-migration-guide.md`: click-by-click Make scenario (custom webhook →
  **Data-Store idempotency guard** → Google Sheets Add-a-Row [7 cols] → employer email → mark-processed
  → 200 response), grounded in the exported `My workflow 2.json`. Notes the payload shift (n8n
  `$json.body.*` → Make top-level `{{1.…}}`) and that the n8n email node currently hardcodes the
  recipient to the OWNER's address (decide employer.email vs owner).
- **Option 2 shipped (`e24d55a`):** the dispatch reads a provider-neutral **`AUTOMATION_WEBHOOK_URL`**
  (falls back to `N8N_WEBHOOK_URL`; timeout `AUTOMATION_DISPATCH_TIMEOUT_MS`), in
  `services/referralWorker.js` + the `configured` flag in `services/referralService.js`. User-facing
  "n8n" labels (Super-Admin Workflow Automation page, FailedReferralsPanel step label) → "Make.com /
  the automation." **Internal identifiers KEPT** (the `dispatch_n8n` outbox step key + `N8N_DISPATCHED`
  /`N8N_DISPATCH_SKIPPED` activity actions are persisted — renaming would orphan rows/history).
  Pipeline, retries, degradation contract untouched. `npm test` 192, build clean. Cutover = set
  `AUTOMATION_WEBHOOK_URL` to the Make URL on Render (owner builds the Make scenario from the guide).

## 60. Coordinated refinement pass — Motion system, Events skeletons, Messages Hub controls, seeker referral automation, org logo (2026-09, `efa9f2b` backend + `b5a644e` frontend, migration 050, `npm test` 206)

One coordinated pass across five related areas, plus a shared motion foundation. All reuse
existing components/services; no rewrites. `framer-motion@^12.42.2` was already a dependency but
**unused anywhere** — so adopting Motion was greenfield (no install). Both new tables carry
zero-crash boot creates so a deploy is never ahead of the migration (owner runs `npm run migrate`).

### 60.1 Shared Motion system (`job-tracker-frontend/src/config/motion.js`)
ONE motion language so Events / Messages / referral modals don't drift from the chatbot/header.
Exports the signature **expo-out easing** `[0.16,1,0.3,1]` (matching `components/chat/chatMotion.js`'s
`cubic-bezier`), a standard ease, a `DURATION` scale, and reusable variants — `modalOverlay`,
`modalPanel`, `fadeInUp`, `listContainer`/`listItem` (stagger), `pressable`. `prefersReducedMotion()`
+ `withReducedMotion()` collapse to plain opacity. RULE: new enter/exit/stagger reuses these — do NOT
hand-roll durations/eases per component; simple hovers/fades stay CSS.

### 60.2 Events & Job Fairs — loading skeleton + Motion enter/exit
`Events.jsx` `EventModal`: the bare `Loader2` loading branch (which flashed a blank/white panel while
the event or its media resolved) is replaced by an **`EventDetailSkeleton`** mirroring the loaded
shape (banner → title → meta → body), and the modal open/close is wrapped in `AnimatePresence` +
`motion.div` (overlay + panel variants) instead of the no-op `animate-in` classes. The admin
`PesoEventManager.jsx` create/edit modal uses the same shared variants (it's a form with data already
in memory — no blank-detail flash, so no skeleton there, just motion parity). Banner `onError`→gradient
fallback (§54) preserved.

### 60.3 Seeker referral Auto-Accept / Auto-Decline preference (server-enforced)
Migration 050 `referral_preferences` (`user_id` PK, `mode` VARCHAR default `manual`, `updated_at`),
modeled on `job_alert_preferences` (§31 migration). Modes: `manual` (default = today's behavior) |
`auto_accept` | `auto_decline`.
- **Enforcement** in `referralService.approveReferral`: AFTER the endorse path commits the
  `Pending Seeker Acceptance` record + audit row, it reads the seeker's `mode` and, for an automation
  mode, runs the existing `acceptReferral`/`declineReferral` on the committed referral (a full audit
  trail: endorsed → auto-accepted/declined). **FAIL-SAFE to manual** on any lookup/action error, and
  the "please respond" nudge is sent ONLY in manual mode. It has effect only when the system flag
  `referral_acceptance_enabled` is ON (ships dark, §42). Exported helpers `getReferralPreference` /
  `setReferralPreference` / `REFERRAL_MODES`.
- **API:** owner-scoped `GET`/`PUT /profile/referral-preference` (`profileRoutes.js`, `writeLimiter`
  on PUT) + a zero-crash boot create of the table.
- **UI:** a Job-Seeker-only "Referrals" tab in `AccountSettings.jsx` (segmented control) that fetches
  the current mode and **requires a confirm step before enabling an automation** (manual is set
  directly — turning automation off is always safe); a toast confirms persistence.

### 60.4 My Referrals / Referral Register — loading skeleton parity
`Referrals.jsx` (one role-aware component serving both surfaces) is already mature (state machine,
status pills, list/grid, empty/error states). The one consistency gap — a bare spinner while
Events/Messages now use skeletons — was closed with a row-mirroring skeleton for the `hydrating`
state. No business-logic / data-flow / real-time-trigger change (presentation only, as scoped).

### 60.5 Messages Hub — "Messages" rename + per-viewer conversation state
- Sidebar nav item **"Communications" → "Messages"** (`Sidebar.jsx`, both role menus).
- Migration 050 `conversation_states` (`user_id`,`conversation_id` PK, `is_muted`, `pinned_at`,
  `manually_unread`, `updated_at`) — per-viewer state (muting/pinning are personal). Zero-crash boot
  create in `messageRoutes.js`.
- **Backend** (`messageRoutes.js`): `/conversations` GET now LEFT JOINs the viewer's state and returns
  `is_muted` / `pinned_at` / `manually_unread` + a per-viewer `unread_count`, ordered **pinned-first**
  (`(cs.pinned_at IS NOT NULL) DESC, cs.pinned_at DESC, c.last_message_at DESC`); `/unread` excludes
  muted conversations. New endpoints: `PATCH /:id/mute`, `PATCH /:id/pin` (**5-pin cap enforced in a
  transaction** — count-then-insert, 409 `PIN_LIMIT`), and `POST /conversations/state` — a **single
  batched** mark read/unread for multi-select (participant-scoped, ≤200 ids), never one request per
  row. Opening a conversation clears `manually_unread`. Helpers `loadParticipantConversation` (every
  mutation is participant-scoped) + `upsertConversationState`.
- **UI** (`Messages.jsx`): pinned grouping, per-row + active-chat kebab menus (pin/mute/mark
  read-unread), multi-select with a responsive bulk-action bar, unread dot / mute icon / pin marker,
  All/Unread/Pinned filters, roster loading skeleton. Also fixed a latent legacy `role === 'employer'`
  search bug (now matches on `peerOf` name + job title).

### 60.6 System-wide PESO organization logo (`Avatar.jsx`)
`utils/avatar.js` gains `isOrgAccount(user)` (true for role `peso_administrator` / legacy `employer`
alias, or an explicit `variant="org"`). `Avatar` — the ONE face renderer — short-circuits the org
account to `assets/PESO LOGO.jpg` (`object-contain` on white, never face-cropped). Because it's the
single renderer, the logo propagates to the top header, Messages, Profile, and referral views at once;
**Job Seeker avatars are untouched** (they never match `isOrgAccount`). `Messages.jsx` `peerOf` now
carries `role` on the peer object so the admin side resolves to the logo (the conversation query
already selected `employer_role`/`applicant_role`).

### 60.7 Verification
`npm test` 206 (+14 source-assertion guards: pin-cap rejection, batch scoping, auto-accept/decline
enforcement, fail-safe-to-manual). Frontend build clean. Authed surfaces (Messages, Referrals,
Settings, seeker Events) need the owner's login → verified by the owner on the deployed build; a local
server was NOT started because its boot ALTERs would touch prod TiDB before the migration.

## 61. Employer email · Messages 429 fix · Make.com cutover · Landing events motion · analytics tooltip (2026-09, `83a3b86`/`2f359b7`/`4f347fe`/`0cce505`, migration 051, `npm test` 210)

Finalize/stabilize batch after the §59/§60 changes.

### 61.1 Messages 429 request-storm — root cause + fix (the critical item)
Users hit repeated **HTTP 429** on `/messages/unread`, `/messages/conversations`, `/messages/:id`
when opening/selecting a conversation. Root cause was a React loop introduced in §60: `Messages.jsx`
`fetchConversations()` added `setActiveConv(prev => data.find(...) || prev)`, which returns a **new
object reference** every fetch; the history effect keyed on the whole `activeConv` object re-ran on
that identity change → `triggerBadgeRefresh()` → `messageUpdateTrigger++` (ChatContext) → the
`[messageUpdateTrigger]` effect called `fetchConversations()` again → new `activeConv` ref → infinite
loop. `api.js` has no axios retry, so it was purely the client cycle.
- **Fix (backend limiter unchanged — it's the safeguard):** key the history effect on
  **`activeConv?.id`** (it only needs to re-run when the selected conversation changes), add an
  **`AbortController`** (cancel the in-flight history fetch on switch/unmount — no stacked requests, no
  setState-after-unmount), make `patchConv` also update the open conversation (safe under id-keying, so
  the header pin/mute stays live without a refetch), and **debounce** the socket-driven roster refresh
  so a burst of messages coalesces into one `/conversations` call. Opening a conversation is now a
  bounded one-time burst. STILL-LIVE RULE: never re-key that effect on the object, and never bump/remove
  the limiter to "fix" a client loop.

### 61.2 Employer email as the authoritative referral recipient (migration 051)
The referral automation notifies the employer by email, but no employer address existed —
`referralRepository.findReferralForDispatch` sourced `employer_email` from `emp.email` (the PESO
admin's own user, via `pj.peso_admin_id`). Migration 051 adds nullable
`pesoadmin_job_posts.company_email` (+ zero-crash boot ALTER in `pesoAdminRoutes.js`).
- **Form** (`PesoAdminDashboard.jsx`): an `type="email"` input beside Company, **required before a
  vacancy goes live (Open/Published)**, optional for a Draft (client mirror of the server rule).
- **API** (`pesoAdminRoutes.js` POST/PUT `/jobs`): `validateCompanyEmail` (required-on-Published,
  validated-if-present) → 400 otherwise; `company_email` persisted on create + update.
- **Dispatch source of truth:** `findReferralForDispatch` now selects `pj.company_email AS
  employer_email` (+ `pj.company AS employer_name`), so the payload targets the EMPLOYER, not the
  admin. Old/draft jobs with a NULL value carry no external recipient until edited — the referral
  still completes (invariant 0.10). Enforcement level ("required on Published") was the owner's choice.

### 61.3 Make.com cutover finalization (retire n8n)
The owner set `AUTOMATION_WEBHOOK_URL` on Render and tested the Make scenario. Code already dispatched
through that env var (§59). This finalization: `referralWorker.js` user-facing log/activity wording
moved from "n8n" to "automation (Make.com)"; the **persisted identifiers are KEPT** (step key
`dispatch_n8n`, activity actions `N8N_DISPATCHED` / `N8N_DISPATCH_SKIPPED`) so in-flight rows/history
aren't orphaned; `N8N_WEBHOOK_URL` remains a fallback env var. The Make blueprint (import artifact) was
updated: email recipient `angelopamalacsao@…` → `{{1.employer.email}}`, and the Data-Store `AddRecord`
`reviewedAt` slot `""` → `{{1.reviewedAt}}` (data-quality normalization). Retry/backoff/dead-letter-skip
safeguards untouched. Shutting down the self-hosted n8n instance is the owner's action; nothing in code
depends on it.

### 61.4 Landing Events animation parity
`LandingPage.jsx` `LandingEventModal` gets the §60 treatment: `AnimatePresence` + shared
`modalOverlay`/`modalPanel` variants (replacing `animate-in`) and a `LandingEventSkeleton` (palette-
neutral pulse) instead of the bare spinner — so public and internal event views feel identical. Event
data / `EventsCarousel` untouched.

### 61.5 Application Pipeline Analytics tooltip (Job Seeker)
`PipelineAnalyticsChart.jsx` is a stacked recharts ComposedChart that used the default `<Tooltip>`,
which listed EVERY status for the hovered month including all the zeros. Added a custom
`PipelineTooltip` `content` component that renders the month label + only the payload entries with
`value > 0` (each with its colour swatch) + the Total. Display-only; aggregation/stacking/colours/
metrics unchanged.

### 61.6 Verification
`npm test` 210 (+4 employer-email guards asserting the dispatch sources `pj.company_email`, not the
admin, and required-on-Published). Frontend build clean. The 429 fix is on an authed surface; proven by
code-trace (the cycle is severed at the id-keyed dependency) + build, verified by the owner on the
deployed build. A local server was not started (its boot ALTERs would touch prod schema before the
owner ran migration 051).

## 62. AI Compatibility synchronized score reveal (2026-09, `6872108`, frontend-only, NO migration)

The Job Seeker vacancy panel's AI Compatibility result snapped in as static text. New module-scope
**`AnimatedScore`** (`PublicJobBoard.jsx`) makes the numeric score and the existing progress bar
animate together from 0 → the real score.
- **Synchronized:** both the number and the bar width are derived from ONE rAF-driven value
  (`displayed`), so they advance in lockstep — never one finishing first. Consistent **~1.4s ease-out**
  (`SCORE_ANIM_MS` / `easeOutCubic`).
- **Starts only on the verified result, no fabricated intermediate:** it's a MOUNT-triggered animation.
  `handleOpenDetails` resets `aiScores = null` at the start of every open/reopen and the component is
  rendered only once the verified score has arrived (loading / resume-required / sign-in / failure
  render other branches). So it re-reveals on each new result and on an intentional panel reopen, but an
  unrelated re-render leaves it mounted and untouched (no restart).
- **No desync:** the bar's CSS `transition` was REMOVED — rAF drives the width frame-by-frame, and a CSS
  transition on top would double-animate and lag the number.
- **Edge cases:** 0% animates to 0 (no misleading fill), partial and 100% work, a non-numeric/missing
  `overall` shows "—" + empty bar with no animation, and `prefers-reduced-motion` jumps straight to the
  final value. The tone/band label come from the REAL score (stable from frame one); only the number +
  bar count up.
- **Preserved:** scoring logic, DeepSeek/API workflow, thresholds, referral logic, backend data — pure
  presentation. Build clean; verified by the owner on the deployed board.

## 63. Analytics tooltip motion + shared scroll-reveal + Landing discovery panel (2026-09, `53b3c53`/`73c2cae`/`ae4f07f`/`eb67857`/`4e4e362`, frontend-only, NO migration, `npm test` 210)

A coordinated motion/layout refinement across the analytics charts and the three posted-job surfaces.
All presentation-layer; job data, filtering, pagination, the detail panel, apply/publication flows, and
the API are untouched.

**(1) Analytics tooltips fade in at the point, matching the app's dropdown motion.** The recharts
default tooltip **slid in from the chart's left edge** and travelled to the cursor on first hover (its
built-in position animation). Fixed on all FOUR chart tooltips — the Job Seeker `PipelineAnalyticsChart`
and the three PESO Admin `PesoAdminOverview` charts (trend `ComposedChart`, vacancy `PieChart`,
application `BarChart`):
- `isAnimationActive={false}` on each `<Tooltip>` turns the position animation OFF, so recharts drops the
  tooltip straight at its own overflow-safe calculated position (no travel).
- A shared `.chart-tooltip-in` keyframe (`index.css`) supplies a subtle anchored reveal instead. It was
  first written as opacity + a small scale, then **retuned to the app's dropdown motion language** —
  opacity + a 6px `translateY` at **200ms `ease-out`**, the same timing/softness as the top-header Avatar
  dropdown and the "+ Create New" menu (`layout/dropdownMotion.js` `DROPDOWN_PANEL`).
- Each custom tooltip's root is **keyed by the active data point** (`PipelineTooltip` `key={label}`;
  `PesoAdminOverview`'s shared `ChartTooltip` `key={activeKey}` — the category `label`, or the slice/
  series name for the pie), so the fade replays once per point and stays perfectly stable on continuous
  hover (same key → node reused → no re-animation). Reduced-motion neutralises it. A true fade-OUT isn't
  added because recharts unmounts the tooltip (no node to animate) — the instant hide is standard.

**(2) One shared, reusable scroll-reveal primitive — `components/common/Reveal.jsx`.** Only the Landing
had a scroll-reveal (its inline `.reveal` + observer); the Public Job Board and Admin manager had none.
The new `Reveal` is the SINGLE implementation used by all three job-card surfaces, so easing/distance/
duration/trigger/reduced-motion stay identical:
- **Visual contract in `index.css`:** `.reveal-item` (opacity 0 + `translateY(24px)`, 0.6s transition) →
  `.reveal-item.reveal-in` (opacity 1, no translate). Colour-agnostic (opacity/transform only), so it
  works under BOTH the app design tokens and the Landing's bespoke palette. Reduced-motion shows the
  final state immediately.
- **One observer per root, not per card.** A viewport observer (root `null`) is a module singleton;
  container-rooted observers live in a `WeakMap` keyed by the root element (GC'd with the container). A
  board of dozens of cards costs ONE `IntersectionObserver`.
- **`root` prop (a ref).** By default the observer watches the page viewport — the scroll architecture of
  the Public Board and Admin manager (their grids scroll with the page). Pass a `root` ref whose element
  is a scroll container and visibility is measured against THAT container instead (used by the Landing
  panel, below). Refs commit before effects, so `root.current` is populated when the card observes.
- **Repeatable with hysteresis (the final behaviour).** Initially one-shot (add `reveal-in`, then
  `unobserve`). Per a later owner request it now **replays every time a card exits and re-enters** its
  visible area: the observer keeps watching and TOGGLES the class — pure `classList` work off the callback
  (no React state, no remount). To avoid edge-jitter, entry and exit use different boundaries: reveal only
  once `intersectionRatio >= 0.15`, reset only once fully out (`!isIntersecting`); the band between holds
  the current state (`threshold: [0, 0.15]`), so a few-pixel wobble or many cards crossing at once never
  flickers and the callback stays cheap.
- Applied by wrapping each card: Public Board flat grid + `JobCategorySections` rows, Admin manager grid,
  and the Landing panel. Multi-select/edit/pagination on the Admin cards are untouched (passive wrapper).

**(3) Landing Page → a self-contained job-discovery panel.** The height-capped 2-pane (list + detail)
became: category selector → a fixed-height self-scrolling panel of cards → detail modal → login. It
**reuses the Public Board's logic, not duplicated code** (the Landing keeps its bespoke palette — §24/§53
token-exclusion still holds, so it renders native chips/cards/modal, NOT the token-styled
`JobCard`/`CategoryChips`):
- **Shared filtering:** the section is driven by `useJobFilters(jobs)` — the SAME category taxonomy
  (`getJobCategory`) and filter ruleset the board uses (search now spans title/company/department/
  category/location/description). The hero search + location inputs bind directly to `jf.state`/`jf.set`
  (the old local search-only `filteredJobs` and the first-job auto-open were removed).
- **`LandingCategorySelector`:** a compact multi-row chip selector in the Landing palette, fed by
  `jf.categories`/`jf.state.category`/`jf.set.setCategory`; mirrors `CategoryChips`' proven row/scroll
  logic (grid-flow-col, no scroll-snap, inline buttons so chips reconcile in place). Selecting filters in
  place — no second category source.
- **Self-contained scroll PANEL (the key change):** the grid lives in a `max-h-[min(720px,72vh)]`
  `overflow-y-auto` container with its own `custom-scrollbar`, so however many vacancies are published the
  Landing's own height NEVER grows — the rows scroll INSIDE the panel (verified: ~2.5k px of cards
  contained; the `#jobs` section stays bounded). The responsive grid (`auto-fill/minmax` → 1 col on
  phones … ~3 at `max-w-7xl`) reflows without horizontal overflow (`overflow-x-hidden`); an earlier
  phone horizontal-rail iteration was replaced by this vertical panel on every breakpoint. Its `ref` is
  the `Reveal` root, so cards animate against the PANEL's viewport, not the page's.
- **`LandingJobModal`:** clicking a card opens a detail modal with the shared §60/§61 Motion + backdrop
  (the treatment `LandingEventModal` uses), rendering straight from the job object (the public `/job-board`
  feed already carries full detail — no fetch, no skeleton). "Apply Now" → `setAuthMode('login')`;
  filled/lock logic mirrors the board (`isLandingJobFilled`).

**Verification caveat (recurring):** the Browser preview pane runs as a backgrounded/hidden tab, which
suspends BOTH `IntersectionObserver` AND `requestAnimationFrame` (a manual observer fired zero callbacks;
`framer-motion` exit animations froze mid-transition; `72vh` resolved to 0). So the reveal firing, the
modal open/close animation, and the panel scrollbar are DEPLOY-verified; everything else was confirmed
structurally via the DOM/CSS (panel caps at 648px and scrolls its content internally, 3-col grid, category
filter, modal opens with the right filled state, reveal CSS toggles opacity 1↔0 both ways, clean mount
with zero console errors). Same §54 pane limitation.

## 64. Landing job search relocated into the board section as a contextual search module (2026-09, `001cc07`, frontend-only, NO migration, `npm test` 210)

An IA follow-up to §63: the Landing search sat in the HERO, disconnected from the job content and its
results. It moved DOWN into the "Local Employment Board" section (`#jobs`) and was redesigned as a proper
employment-search module. It reuses the board's own filter state — no second search implementation, no
backend/API change.
- **Hero** (`LandingPage.jsx`): the two-input search card is replaced by two CTAs — **Explore Local Jobs**
  (`scrollTo('jobs')`) and **Events & Job Fairs** (`scrollTo('events')`). The hero no longer carries
  search out of context.
- **New `LandingJobSearch` module** at the TOP of the board section, in the Landing's bespoke palette:
  keyword + location inputs (leading icon, per-field clear `×` when non-empty, `sr-only` labels, visible
  `#003631` focus ring) + a Clear-all reset (`jf.reset`, disabled when nothing is active), wrapped in a
  `role="search"` region. Inputs are bound to `jf.state`/`jf.set` (the SAME `useJobFilters` the Public
  Board uses — the §63 shared taxonomy/ruleset; do NOT fork a second matcher).
- **Section structure** now matches the asked-for flow: **Search → Controls (category) → Results
  Count/State → Matching Results.** A `aria-live="polite"` count line narrates the total — "N vacancies
  available", or "Showing K of N vacancies for '<query>'" when filtered (`jf.activeCount`/`jf.filtered`) —
  with a loading state on the initial fetch. The no-match empty state gained a "Clear filters" action
  (`jf.reset`). Results update live in the panel; no navigation/refresh.
- **`LandingCategorySelector`** gained an optional `className` (its hardcoded `mb-8` moved to caller-
  controlled spacing) so the section controls its own rhythm.
- Verified locally via the DOM (the search itself is instant/synchronous, so it IS observable in-pane
  unlike the reveal): the search region is inside `#jobs` and the hero has no search input; typing
  "service" → count "Showing 4 of 31 vacancies for 'service'" + 4 cards; per-field `×` shows; Clear resets
  to "31 vacancies available" with the input emptied; zero console errors. Keyboard/mouse/touch
  accessible. Owner verified the reveal replay (§63) on the deployed board before this.

## 65. Landing search removed + full-width category navigation (2026-09, frontend-only, NO migration)

An IA reversal of §64 (owner request). §64 had relocated the keyword/location search INTO the
board section; the owner then judged it redundant with the category navigation for the Landing's
lightweight-entry-point role. Removed the search; made category nav the primary, full-width
discovery control. `LandingPage.jsx` only; `npm run build` clean.

- **Search bar removed.** `LandingJobSearch` (the §64 keyword + location + Clear module) and its
  now-unused `Search` lucide import were deleted. The Landing no longer keyword-searches: full
  keyword/location/sort/advanced discovery is the **Public Job Board's** job, reached via the
  existing header **"View All Jobs →"** CTA (`setAuthMode('login')`). Category navigation IS the
  Landing discovery function (verified sufficient for the entry-point scenarios — browse-by-category
  + "see everything on the full board").
- **Category nav → full width.** `LandingCategorySelector` changed from a left-concentrated
  horizontal scroller (`overflow-x-auto` + `grid grid-flow-col auto-cols-max w-max` with a capped
  `gridTemplateRows`) to a **`flex flex-wrap items-center gap-2.5`** row that spans the whole
  `max-w-7xl` content container and wraps onto more rows on narrow screens — fixing the "concentrated
  on the left, empty space on the right" complaint WITHOUT stretching chips unnaturally (natural-size
  chips, deliberate spacing). Dropped the `keepInView`/`scrollIntoView` nudge (no scroller to nudge).
  Same shared taxonomy (`jf.categories` from `useJobFilters`), same "All Jobs" + count-badge chips,
  same Landing bespoke palette (§24/§53), same `role="group"`/`aria-pressed` a11y. The optional
  `className` prop (§64) stays.
- **Section flow** is now **Local Employment Board → Category Navigation → Results Count → Filtered
  Jobs → View All Jobs (→ Public Job Board)**. The `aria-live` count line reads category context
  ("N vacancies available" / "Showing K of N vacancies in <Category>", from `jf.state.category`);
  the dead `jf.state.search` "for '…'" span was removed. The no-match empty state copy moved from
  "No jobs match your search" → "No jobs in this category yet" with a "Show all jobs" reset
  (`jf.reset`). The §63 self-contained scroll PANEL + `Reveal` scroll-reveal are UNCHANGED; the
  category selector sits above the panel as before.
- **Reuse preserved:** one `useJobFilters` (no second matcher/data source), one category taxonomy;
  `activeCount` already counts a category selection, so the count line + reveal behaviour work with
  category-only filtering.
- **Verification:** `npm run build` clean; no dangling refs (grep confirms `LandingJobSearch` / bare
  `Search` gone). The category selector carries the `.reveal` class, so an in-pane screenshot is
  unreliable (the documented hidden-tab suspension of IntersectionObserver/CSS transitions, §54/§63)
  — the change is a mechanical CSS/removal validated by the build; owner runtime-verifies on the
  deployed Landing like every prior Landing change. **This SUPERSEDES the §64 still-live rule** — the
  Landing search is GONE; do NOT re-add it (to the board section OR the hero); category nav is the
  Landing discovery control, full-width flex-wrap.

## 66. Centralized quota & usage-indicator system (2026-09, `npm test` 218, NO migration)

A cross-cutting "make invisible limits visible" system: one config layer + server-authoritative
usage endpoints + reflective UI indicators across the Job Seeker and PESO Admin modules that create,
store, or process persistent data. Owner decisions (2026-09): **informational-only** for resources
with no limit today (never newly block a primary action, invariant 0.1), and a **soft-warn storage
meter** (never blocks an upload). Additive; no schema change (usage is COMPUTED). Blueprint of the
decisions lives in this record.

### 66.1 The single source of truth — `config/quotas.js`
The catalogue every limit is defined in ONCE, consumed by enforcement + the /usage endpoints + the
UI, so a number can't drift. Each resource declares `{ key, scope, category, type, label, unit, max,
warnRatio, enforced, help, ... }`; plus a flat `LIMITS` constants object and helpers
`resourcesForScope(scope)` + `evaluateState(resource, used)`.
- **FOUR distinct axes (never conflated into one generic "storage" number):** `type:'count'`
  (running record count; `max:null` ⇒ informational), `type:'bytes'` (running storage footprint vs a
  soft threshold), `type:'rate'` (per-window op count, e.g. imports/day), `type:'processing'` (a
  per-operation ceiling — file size / rows — a REFERENCE max with no running usage).
- **`enforced`** is `true` ONLY where the backend already blocks past `max` (imports/day, 1000
  tracked, cert library 30, pins 5, upload sizes) — those can reach the `blocked` state. Everything
  uncapped is `enforced:false` + `max:null` ⇒ state `unlimited` (shown, never blocked). The storage
  meter is `bytes` + `soft` + `enforced:false` ⇒ warns at the soft threshold, never blocks.
- `evaluateState` returns `reference` (processing) / `unlimited` (max null) / `blocked` (enforced &&
  used≥max) / `warn` (≥warnRatio·max, or ≥ a soft cap) / `normal`. An informational/soft resource can
  NEVER return `blocked` (invariant 0.1 encoded in the state machine).
- **Enforcement now sources from the catalogue:** `services/importService.js` `LIMITS` (shape kept so
  `importService.LIMITS.MAX_FILE_BYTES` callers are unchanged), `repositories/certificatesRepository.js`
  `MAX_FILE_BYTES`/`MAX_PER_APPLICATION`/`MAX_LIBRARY`, and `routes/messageRoutes.js` `MAX_PINNED` all
  read `require('../config/quotas').LIMITS.*` (identical numbers → behaviour-preserving).

### 66.2 Live usage — `services/usageService.js` + two endpoints
Read-only; attaches live per-user figures to the catalogue. `computeSeekerUsage(userId)` and
`computeAdminUsage(ownerId, userId)`.
- **Trash-aware, matches enforcement exactly:** tracked applications + saved vacancies count
  `deleted_at IS NULL` (Trash-excluded — mirrors importService's `MAX_TOTAL_TRACKED`); `imports_daily`
  mirrors the ROLLING 24h window (`created_at >= NOW() - INTERVAL 1 DAY`), not a calendar day.
- **Storage meter (informational)** = the DB base64 footprint of a seeker's `users.avatar_url` +
  `user_certificates.content_base64` + `application_certificates.content_base64` (joined via the
  seeker's applications) + `application_resumes.file_data` — it COUNTS everything stored (records that
  a Trash soft-delete would leave), kept deliberately SEPARATE from the Trash-excluded record counts
  (the two axes are not conflated). Reported as stored length (base64 chars ≈ 1.33× the raw file;
  labeled a guideline).
- **Resilient:** every sub-query runs through a `scalar()` helper that degrades to 0 on any error, so
  a usage read NEVER 500s a page (invariant 0.1) and a missing table (e.g. pre-migration) just yields
  0 for that figure. No `JOIN userprofiles` (invariant 0.8).
- **Endpoints:** `GET /api/usage` (`routes/usageRoutes.js`, seeker, owner-scoped by `req.userId`) +
  `GET /api/peso-admin/usage` (in `pesoAdminRoutes`, owner-scoped by `req.effectiveOwnerId` so PESO
  Staff see the office totals; Manager-only by the existing deny-by-default staff guard). Admin
  informational counts: vacancies (`pesoadmin_job_posts.peso_admin_id`), approved referrals for the
  owner's jobs, office events (`peso_events`), applicant records (applications to the owner's jobs);
  enforced: message pins + the job-image/event-banner upload ceilings.

### 66.3 Reflective UI — the indicators
The backend is authoritative; the UI only REFLECTS server-side usage (never computes a limit).
- `hooks/useUsage.js` — fetches `/api/usage` (or `/peso-admin/usage`), `{ resources, loading, error,
  refresh, byKey }`; `refresh()` after a mutation.
- `components/common/UsageMeter.jsx` — the ONE indicator for a single resource: `used / max`, a
  state-coloured bar (accent / warning / danger tokens), and a concise status ("N remaining" at warn,
  "Limit reached" at blocked, "No limit" for unlimited, "Max X MB" for a processing ceiling). Byte
  formatting (`fmtBytes`) + `compact` variant for inline use. Design-token styled + dark-aware (§24.1).
- `components/common/UsagePanel.jsx` — the comprehensive surface: groups resources by category
  (Records / Storage / Requests / Uploads) with per-group hints + loading/error states. Self-contained
  (fetches its own usage).
- **Placement:** seeker **Account Settings → "Usage & Limits" tab** (`AccountSettings.jsx`, job-seeker
  gated like the Referrals tab; excluded from the form's Save button); **PESO Admin Overview →
  "Office Usage & Limits" card** (`PesoAdminOverview.jsx`, scope `admin`); and inline **imports-today +
  tracked meters in the Import modal** (`dashboard/ImportPastApplicationsModal.jsx` — the enforced
  choke point where a block actually happens; `usage.refresh()` after a successful commit).
- **Inline meters extended (2026-09 follow-up).** A shared **`components/common/InlineUsageMeter.jsx`**
  wrapper (the hook + a compact divided card in one place, so modules don't repeat it; a `refreshKey`
  prop re-pulls usage when it changes — pass the list length so the meter follows add/remove) now
  drops a compact strip into the seeker data-owning modules: **Certificate Library** (`certificate_library`,
  the enforced 30-cap — refresh on `items.length`), **Saved Vacancies** (`saved_vacancies`, informational —
  gated to a non-empty list, refresh on `savedJobs.length`), and **My Applications** (`peso_applications` +
  the enforced `tracked_applications` 1000-cap — refresh on `apps.length`). The **Analyze Resume modal**
  was deliberately SKIPPED (its intro copy already states "max 5 MB", so a reference meter would duplicate
  it); **My Referrals**/**Messages** were left to the comprehensive panel (a shared role-aware component +
  an informational-only / already-toasted cap — low added value). The comprehensive Usage & Limits tab
  still covers everything (storage, all upload ceilings, referrals, pins). **(§67 removed the Saved
  Vacancies meter by owner request — inline meters now live on Certificate Library + My Applications
  + the Import modal only.)**

## 67. Three UI refinements — Saved-Vacancies meter removed, My Referrals skeleton rebuilt, TopHeader dropdown content-aware (2026-09, frontend-only, NO migration)

Three independent owner-requested refinements; `npm run build` clean; backend untouched.

- **(1) Saved Vacancies inline usage meter REMOVED (only there).** The `InlineUsageMeter` strip + its
  import were reverted out of `SavedJobs.jsx` for a cleaner bookmark-manager presentation; ALL save/
  unsave/filter/sort/pin/colour/multi-select/trash functionality is untouched (only the two added lines
  were removed). The meters on **Certificate Library** and **My Applications** (and the Import modal)
  STAY — do not remove them. `config/quotas.js` still defines `saved_vacancies` (it shows in the
  comprehensive Usage & Limits tab); only the inline strip on that page is gone.
- **(2) My Referrals skeleton rebuilt to structurally mirror the loaded module (`Referrals.jsx`).** The
  old `hydrating` skeleton rendered only 6 flat flex rows — no toolbar, no column headers, wrong row
  dimensions, and it ignored the active view. Now: a **toolbar skeleton** row (search + status + sort +
  view-toggle + count placeholders, matching heights) renders during `hydrating` so the real toolbar
  (gated on `!hydrating` because its list/grid toggle would flash the wrong active state) no longer pops
  in and shifts the body; and the body skeleton is **view-aware** (the cached `view` is known
  synchronously) — LIST mode echoes the `hidden md:grid` column headers + rows matching `ReferralRow`'s
  `grid-cols-[minmax(0,1fr)_150px_140px_110px_auto]` (icon `w-9 h-9 rounded-lg`, title/subtitle,
  reference, status pill, date, action buttons) with a stacked mobile meta+actions layout, while GRID
  mode renders tile skeletons matching `ReferralTile` (`p-4 rounded-2xl border`, `w-10 h-10 rounded-xl`
  icon, 2-line title, reference, status pills, `mt-auto pt-3 border-t` footer with date + actions) in
  the same `auto-fill/minmax(240px)` grid. Sits inside the same `bg-raised rounded-3xl border` card
  container; `aria-hidden`, `animate-pulse`, design tokens, reduced-motion-safe. Eliminates the
  loading→loaded layout shift + view mismatch (the §60.4 skeleton was list-only).
- **(3) TopHeader avatar dropdown is positioned + sized RELATIVE TO THE PROFILE TRIGGER CONTAINER
  (`layout/TopHeader.jsx`).** The panel was a fixed `w-56` — oversized/detached-looking for a short name.
  It first (earlier this session) went to `w-max`-driven-by-the-Full-Name, but the **owner then revised
  the basis to the trigger container** (so it reads as attached to the profile box, not driven by name
  length). Now `absolute right-0 mt-2 min-w-full w-max max-w-[min(20rem,calc(100vw-1.5rem))]`. The panel
  is `absolute` inside the `relative` profile wrapper (whose width IS the trigger button — avatar + name
  span capped at `max-w-[140px]` + chevron), so: `right-0` aligns the panel's right edge to the trigger;
  **`min-w-full` makes it AT LEAST the trigger's width** (attached, its width tracks the container as the
  trigger grows/shrinks); `w-max` ONLY guarantees the menu labels fit (so a very short trigger can't clip
  "Account Settings"); `max-w-[min(20rem,calc(100vw-1.5rem))]` clamps to the viewport (never overflows on
  small screens). The header **name AND email both carry `w-0 min-w-full`** — they contribute 0 to the
  panel's intrinsic width but fill + `truncate` to the container-driven width — so neither a short nor a
  long name makes the dropdown look disproportionate or detached. Design, motion (the shared
  `DROPDOWN_PANEL` fade+slide), hover/click/Escape behaviour, and menu items are all unchanged — only the
  positioning/sizing basis. (TopHeader is `hidden md:flex`, so this only affects ≥768px.)

### 66.4 Tests + invariants
`test/quotas.test.js` (8 guards, `config/quotas.js` is pure so required directly; everything touching
the pool asserted from SOURCE TEXT, §13): catalogue integrity + unique keys, `resourcesForScope`
includes `both`, `LIMITS` match the real enforcement numbers, `evaluateState` (only enforced blocks;
informational/soft never blocks), informational resources are `max:null`+`enforced:false`, the three
enforcement modules SOURCE from the catalogue, usageService is Trash-excluded + rolling-24h +
owner-scoped + no `userprofiles` join, and the endpoints exist owner-scoped. Updated the existing
`test/messageConversationState.test.js` pin-cap assertion for the new sourcing (still === 5, asserted
in `quotas.test`). `npm test` **210 → 218**. Invariants held: 0.1 (no new blocks; a usage read never
fails a page), 0.8 (no `userprofiles` join), and Trash semantics match the actual quota calc.
**RULE:** every quota'd limit is defined in `config/quotas.js` ONCE — enforcement reads it, the
indicators reflect it; a new limit is a catalogue entry (+ its computation in `usageService`), never a
new hardcoded number, and a NEW hard cap on a previously-uncapped resource needs an explicit owner
decision (informational-only is the default — do NOT newly block applying or the office's core
posting/referral workflow).

## 68. Account Settings persistence audit + Full-Name fix + Google OAuth account linking (2026-09, migrations 052 + 053, `npm test` 227)

An end-to-end audit of every Job Seeker Account Settings section, a critical Profile-Info persistence
fix, and a full production Google account link/unlink lifecycle. Backend `npm test` **218 → 227**;
frontend build clean. **Owner must run `npm run migrate`** (052 + 053) — the zero-crash boot ALTERs keep
the app running before that, but the backfills + the unique index come from the migrations.

### 68.1 The audit (read → edit → validate → save → persist → reload → display, per section)
| Section | Wiring | Verdict |
|---|---|---|
| **Profile Info** | GET /profile → controlled edit → full-payload `PUT /profile` (`UPDATE users … name=COALESCE(?,name)` by `req.userId`) → `updateUser` refresh | **Was BROKEN → FIXED (68.2)** |
| **Security** | `PUT /auth/update-password` (requireAuth): `bcrypt.compare` current pw, bcrypt(12) new, UPDATE, security-alert email; success after await | ✅ + **added server-side min-length 8 (68.3)** |
| **Linked Accounts** | was a static "Connected" placeholder → now a real backend-authoritative link/unlink flow | **Rebuilt (68.4–68.6)** |
| **Referrals** | GET/PUT `/profile/referral-preference` (validates `REFERRAL_MODES`, persists `referral_preferences`), enforced in `approveReferral`; success after await | ✅ working |
| **Usage & Limits** | `GET /api/usage` (server-authoritative, `config/quotas.js`), limits enforced server-side | ✅ working |

### 68.2 Full-Name persistence bug — root cause + fix (the reported issue)
`AccountSettings.jsx` Profile-Info was never wired to the backend: the input was **uncontrolled**
(`defaultValue`, edits never read) and Save ran a **fake `setTimeout` success** with NO API call. The
backend `PUT /profile` was fine all along. Fix (reusing the OnboardingModal pattern, §43): a controlled
`fullName` seeded from a mount-time `GET /profile`; on save, a **full prefilled payload** PUT (only `name`
is `COALESCE`d — the other columns are set directly, so a partial body would null gender/dob/phone/skills;
`dob` sliced to `YYYY-MM-DD` to avoid a UTC day-shift, §49/§51); **success shown only after the 2xx**
(`await` throws on any non-2xx → caught → error, never a false success); on success `updateUser({name})`
propagates to the top-header + every `<Avatar>` (context consumers, §AuthContext-3b) so `users.name` (the
single name source) reflects everywhere. Guards against saving before the profile loads (would null fields).

### 68.3 Security hardening
`PUT /auth/update-password` now re-validates the new password length server-side (`< 8` → 400) — was
frontend-only. Current-password check (bcrypt.compare) + bcrypt(12) + security-alert email unchanged.

### 68.4 Linked Accounts — honest state (migration 052)
The section previously showed "Google OAuth — Connected" for EVERY account (there was no provider
tracking). Added **`users.oauth_provider`** (`'google'` | NULL): the Google login flows now **stamp** it
(create + existing sign-in, idempotent), the migration **backfills** existing passwordless accounts to
`'google'` (the app's own heuristic — a NULL password already means "this account uses Google Sign-In"),
and it is exposed via `/auth/me` `/login` `/google`. The UI's Connected badge is now derived from
`user.oauth_provider === 'google'`, not assumed. A **zero-crash boot ALTER** in `authRoutes` guards a
deploy before migrate (the `/me`/`/login` SELECTs reference the column).

### 68.5 Google account LINK / UNLINK — full flow (migration 053)
Backend-authoritative connect/disconnect, reusing the SAME OAuth client + callback (no new Google Console
redirect URI). **Migration 053** adds `google_sub` (the Google account's stable id — the duplicate key) +
`google_email` (the connected identity, for display) + **`UNIQUE INDEX uq_users_google_sub`** (one Google
identity → one PESO account, DB-enforced). Boot ALTER guards both columns.
- **`GET /auth/google/link/start`** (authed XHR — the Bearer token can't ride a redirect): mints a
  **short-lived (10-min) signed `state` JWT** `{uid, purpose:'link'}` and returns the Google consent URL
  (`prompt=select_account`, `access_type=online` — identity only). The client then navigates the tab to it.
- **`GET /auth/google/callback`** (the SAME callback as login): distinguishes a LINK from a LOGIN by the
  JWT-shaped `state` — a login state is a plain role WORD (never a 3-segment JWT). On a link ticket:
  duplicate check (`google_sub` on another account → `status=duplicate`; the UNIQUE index is the DB
  backstop) → `UPDATE users SET oauth_provider='google', google_sub, google_email WHERE id=uid` →
  redirect `…/settings?link=google&status=success`. **Cancelled** consent → `status=cancelled`; any
  exception → `status=error`; an **EXPIRED/tampered link ticket** (JWT-shaped but fails verify) →
  `status=error` — it does NOT silently fall through to login (which could sign the user into a different
  Google account).
- **Secure token handling** — identity ONLY: verify the `id_token`, read `sub/email`, discard the tokens.
  No Google access/refresh tokens are stored (unlike the separate legacy Indeed `linked_accounts` store).
- **`POST /auth/google/unlink`** (authed): SAFE — refuses when Google is the ONLY sign-in method
  (`password IS NULL` → 400 `NO_PASSWORD`, the UI routes the user to set a password in the Security tab
  first), so it can never lock anyone out; clears `oauth_provider/google_sub/google_email` only, **never
  DELETEs the account**.
- **Login consistency** — the Google LOGIN flows now match by **`google_sub` first, then email**, so a
  linked account (whose Google email may differ from its PESO email) signs into the correct account
  instead of creating a duplicate. Login is otherwise unchanged and every linkage-stamp UPDATE is wrapped
  so a unique-index race can never break sign-in.

### 68.6 Frontend (AccountSettings Linked Accounts + AuthContext)
- **Backend-authoritative Connected state** — never an optimistic flip: on the link-return the component
  re-pulls `/auth/me` via the new **`AuthContext.refreshUser()`** (GET /auth/me → setUser).
- **Lifecycle** — Connect button → loading ("Redirecting…") → `GET /auth/google/link/start` →
  `window.location = url` → Google → return to `…/settings?link=google&status=…`; a mount effect parses
  the status (success / duplicate / cancelled / error) into the existing message UI, strips the query, and
  `refreshUser()` on success. **Disconnect** → inline confirm (Referrals-tab pattern) → `POST /unlink` →
  `updateUser` + `refreshUser` + toast; `NO_PASSWORD` → error + switch to the Security tab. Connected shows
  the Google identity (`google_email`) + green badge + Disconnect. Consistent tokens/spacing/hover/focus/
  responsive (`truncate`, `min-w-0`); no separate OAuth widget.
- `sessionStorage` (the JWT) survives the cross-origin round-trip to Google and back within the tab, so
  the session is intact on return.

### 68.7 Invariants + tests
0.1 (persistence never faked; a Google linkage-stamp failure never breaks login) · 0.6 (new DDL in
numbered migrations 052/053, not initDB) · 0.7 (additive columns; nothing renamed) · account never
deleted on unlink · one-Google-one-account (app check + UNIQUE index). `test/oauthProvider.test.js`
(9 guards: migrations, boot ALTER, stamping, exposure, link-start signed ticket + select_account +
online, callback link-branch + duplicate check + statuses, safe unlink, identity-only token handling).
Files: `routes/authRoutes.js`, `src/context/AuthContext.jsx`, `src/components/AccountSettings.jsx`,
`migrations/052_users_oauth_provider.sql`, `migrations/053_google_link_identity.sql`,
`test/oauthProvider.test.js`.


## 69. Admin account consolidation — one PESO Administrator + one Super Administrator (2026-09-14, DATA-only, NO migration)

Consolidated the administrative accounts so exactly one authoritative account exists per admin tier, driven by a full read-only audit FIRST (introspect `information_schema` FK graph + per-account row counts), then controlled data migrations (dry-run default, backup-first, single transaction, before/after counts). **No schema change** — this is a data operation via one-off scripts in `scripts/`.

### 69.1 The audit finding
There were NO duplicate `peso_administrator` accounts — the target `peso@kabankalancity.gov.ph` (id 30002) was already the sole one and already the `effectiveOwnerId`. The real staleness was hidden: **three accounts demoted to `role='applicant'` that still OWNED live PESO content** (never surfaced as "admins"):
- **id 16** `pwd@kabankalancity.gov.ph` "Kabankalan City PWD Office" — the pre-rebrand office account (10 jobs, 20 conversations, 21 messages, referral reviewer of record).
- **id 17** `angelo123@gmail.com` — a dev/test account that is ALSO a real job seeker (1 PESO job on the admin side; genuine seeker data — applications, résumés, saved jobs).
- **id 25** `adriano123456@gmail.com` — junk (1 job, 1 conversation).

Two junk org-profile rows (`pesoadmin_profiles` for 16 "CCC/Drugs", 25 "SI IAN") and a junk-named SECOND Super Admin (**id 18** `admin@hire.com` "ASDASDA") were also flagged.

### 69.2 PESO ownership reassignment — `scripts/consolidate-peso-admin.js`
Reassigned to 30002 in ONE transaction: `pesoadmin_job_posts.peso_admin_id` (12 jobs), `conversations.peso_admin_id` (24 threads — verified NO `(job,applicant)` collision since `conversations` has no unique key), and `messages.sender_id` for id 16's 21 office-authored messages only (id 17's lone message is SEEKER-side, left untouched; 25 had none). **Reassign, not delete** — those three FKs are `ON DELETE CASCADE`, so deleting id 16 would have cascade-destroyed its jobs → 34 applications → 19 referrals → 20 threads. **Preserved**: historical actor refs (`referral_queue.reviewed_by`, `referral_activity_log.actor_id`, `referral_outcomes.recorded_by` stay pointing at the legacy ids for audit truth — safe because the accounts were NOT deleted, those FKs being SET NULL), and id 17's entire job-seeker footprint. Verified: 30002 owns 37 jobs / 39 convos / 65 referrals, orphan checks all 0, table totals unchanged.

### 69.3 Junk org-profiles — `scripts/cleanup-junk-org-profiles.js`
Deleted the 2 unreferenced junk `pesoadmin_profiles` rows (user_id 16, 25) after asserting the owners are non-admin `applicant` rows and 30002 is not in scope. 30002 keeps its own profile (created on save). Backup-first.

### 69.4 Super Admin consolidation — `scripts/consolidate-super-admin.js`
The second Super Admin id 18 `admin@hire.com` was not a dummy — it held a real audit trail (settings changes, role assignments, suspensions/reactivations, n8n replays, and the owner's junk-vacancy deletions) and its `admin_audit_logs.admin_id` FK is **NOT NULL + NO ACTION**, so the account could not be deleted without first moving those rows. Consolidated into the owner's own account **id 1** (`angelopamalacsao@gmail.com`, same human): reassigned `admin_audit_logs.admin_id` (65), `system_settings.updated_by` (8), `referral_activity_log.actor_id` (7) from 18→1, then a **full pre-delete scan** (every user-referencing column) asserted zero remaining references before deleting the user row. Verified: id 18 gone, exactly 1 Super Admin remains, no dangling refs, audit history intact under id 1. **The Super Admin console login is now id 1; `admin@hire.com` no longer exists.**

### 69.5 Left as-is
`peso_staff` id 210002 (Mr. Tejada) is the active legitimate co-worker (authored the 3 published events via `peso_events.created_by`, which is display-only/office-wide) — untouched. The owner separately hard-deleted the reassigned junk vacancies through the Super Admin Job Moderation UI (their cascades dropped total jobs 37→32, applications 84→70, referrals 65→61 — expected).

### 69.6 Method / invariants
Every script: dry-run by default, backup + rollback `.sql` to `%TEMP%/peso-consolidation-backup/` BEFORE any write, guarded (aborts on any unexpected account role or reference), single transaction, explicit before/after verification. 0.1 (no primary workflow broken) · audit integrity preserved over cosmetic consistency · reassign-over-delete wherever CASCADE would destroy dependents. Files: `scripts/consolidate-peso-admin.js`, `scripts/cleanup-junk-org-profiles.js`, `scripts/consolidate-super-admin.js`.


## 70. n8n retirement — Make.com is the sole automation provider (2026-09-14, `npm test` 227, NO migration)

Post-cutover audit + cleanup of residual n8n references across the Super Admin implementation and backend, now that the self-hosted n8n → Make.com migration (§59/§61) is verified complete.

### 70.1 The finding — one live n8n code path + stale current-state docs
The referral automation dispatch (`dispatch_n8n` outbox step, `referralWorker.handleDispatchN8n`) read `process.env.AUTOMATION_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL` and `AUTOMATION_DISPATCH_TIMEOUT_MS || N8N_DISPATCH_TIMEOUT_MS`. `AUTOMATION_WEBHOOK_URL` was set (Make.com, live) and `N8N_WEBHOOK_URL` was absent, but the `N8N_*` **fallbacks were still a live execution path** — and `N8N_DISPATCH_TIMEOUT_MS=15000` was still in `.env`, so the timeout was actually resolving through the legacy var. Plus `referralService.getAutomationStatus().configured` OR-ed in `N8N_WEBHOOK_URL`. README + `docs/system-guide.md` still named n8n as the current provider.

### 70.2 Removed (active n8n dependencies)
- `referralWorker.js`: dropped `|| process.env.N8N_WEBHOOK_URL` (webhook) and `|| process.env.N8N_DISPATCH_TIMEOUT_MS` (timeout) — reads ONLY `AUTOMATION_WEBHOOK_URL` / `AUTOMATION_DISPATCH_TIMEOUT_MS` (default 15000). No code path can reach the retired n8n.
- `referralService.js`: `configured` now `Boolean(process.env.AUTOMATION_WEBHOOK_URL)` only.
- `.env`: removed the dead `N8N_DISPATCH_TIMEOUT_MS`. **Owner action on Render: remove `N8N_WEBHOOK_URL` + `N8N_DISPATCH_TIMEOUT_MS` from the service env** (harmless now — nothing reads them — but finishes the cleanup).
- User-facing/label strings → provider-neutral: `adminRoutes` replay `message`/`details`, `WorkflowAutomation.jsx` (already Make.com-branded), README + system-guide current-state sections, `superadmin/README.md`. Verified: `process.env.N8N*` is read in ZERO `.js` files.

### 70.3 Kept — persisted identifiers (NOT an n8n dependency; renaming = data corruption)
The step key **`dispatch_n8n`** and action keys **`N8N_DISPATCHED` / `N8N_DISPATCH_SKIPPED` / `N8N_REPLAY` / `N8N_REPLAY_QUEUED`** are LEFT unchanged — they're persisted in `referral_jobs.step`, `referral_activity_log.action`, `admin_audit_logs.action`, and the dispatched/undispatched detection queries (`WHERE action='N8N_DISPATCHED'`, `step='dispatch_n8n'`) depend on them (§59). They are provider-agnostic names, not a live n8n integration. Migration-history docs (`make-com-migration-guide.md`, `automation-and-backend-architecture-proposal.md`) retained as-is.

### 70.4 Equivalence verified (n8n → Make.com)
Same trigger (backend POSTs `event:'referral.completed'` + applicant/job/employer/reviewer to the webhook), same downstream (Google Sheets append — the same 7 columns — then employer-email notification, now `{{1.employer.email}}` per §61), plus a NEW idempotency Data-Store guard and an explicit 200 webhook-response so the backend's retry/undispatched logic stays meaningful. Retry (outbox exponential backoff, 5 attempts, final-attempt SKIP not dead-letter), logging (`N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED`), and failure handling (non-critical downstream, 0.10) all live in the UNCHANGED backend. Files: `services/referralWorker.js`, `services/referralService.js`, `routes/adminRoutes.js`, `.env`, `README.md`, `docs/system-guide.md`, `job-tracker-frontend/src/superadmin/README.md`.


## 71. Public Job Board category chips — full-width flex-wrap (2026-09-14, frontend-only, NO migration)

**Problem:** the Public Job Board's `jobs/CategoryChips.jsx` used `grid grid-flow-col auto-cols-max w-max` inside `overflow-x-auto` — a column-major track sized to its CONTENT width, so on wide screens the chips clustered on the LEFT and left a large empty gap on the right (the module felt unbalanced). This is the same imbalance §65 fixed on the Landing's `LandingCategorySelector`.

**Fix (layout only):** replaced the scroll track with a full-width `flex flex-wrap items-center gap-2.5`. Chips now flow left-to-right across the ENTIRE `max-w-7xl` module content width and wrap onto new rows; on narrow screens they wrap to more rows (no `overflow-x`, so no horizontal scroll and no clipping). Each chip keeps `shrink-0` so it renders at natural size and the balance comes from DISTRIBUTION-by-wrapping, not from stretching individual buttons (an `auto-fit` grid that stretched chips was explicitly not wanted). Now matches the Landing (§65) so the two category controls read the same.

**Removed as newly-dead:** the scroll-position machinery — `keepInView`/`scrollIntoView` on the clicked chip, and the "no scroll-snap + inline-buttons-so-the-track-doesn't-reset" contract (UI addendum §8.2) — since there is no scroll track anymore, selecting a chip can never move the viewport.

**Unchanged (consistency + logic):** `chipClass`/`badgeClass` verbatim (spacing, pill sizing, `text-sm font-bold` typography, Deep-Green active state, hover borders, focus ring, gold count badge); the `items` list, `onSelect`, and the `useJobFilters` wiring (`jf.categories`/`jf.state.category`/`jf.set.setCategory`, "All Jobs" reset, click-active-to-clear) — filtering behaviour, vacancy queries, and `JobCategorySections`/`JobCard` rendering are untouched. `PublicJobBoard.jsx` only had its layout comment corrected. Verified via `vite build` (clean `PublicJobBoard` chunk); authed board = owner-visual-verified on their session. Files: `job-tracker-frontend/src/components/jobs/CategoryChips.jsx`, `job-tracker-frontend/src/components/PublicJobBoard.jsx`. Docs: UI addendum §8.1/§8.2 rewritten. **Supersedes the CategoryChips horizontal-scroll design; the §63/§65 notes that the Landing "mirrors CategoryChips' row/scroll logic" are historical — both controls are now flex-wrap.**


## 72. Contextual sidebar navigation tooltips — ONE shared component (2026-09-15, frontend-only, NO migration)

Every sidebar nav item now shows a concise, role-contextual **description** on hover OR keyboard focus ("what this module is for"), across all role interfaces, via a single reusable component — not per-item tooltip markup.

### 72.1 The component — `components/common/SidebarTooltip.jsx`
Wraps one nav item; on hover/focus it shows `description` (and the `label` too, as a bold title line, only when the rail is COLLAPSED and the label is otherwise hidden). **Rendered in a PORTAL to `document.body` with `position: fixed`**, coordinates measured from the item's `getBoundingClientRect()` — this ESCAPES the sidebars' `overflow-x-hidden` nav (which would clip a normal absolute tooltip) and lets it be CLAMPED to the viewport (vertically centred on the item, opens to the right, flips left only if the right would overflow). `pointer-events-none` so it never intercepts a nav click or flickers as the cursor moves within the item; `onFocus`/`onBlur` give keyboard parity; an unmount effect clears the pending hide timer.

### 72.2 Styling + motion — reuses the design system (owner refinement)
Initially shipped as a dark bubble; refined to the SAME elevated-surface tokens as the TopHeader avatar menu / "+ Create New" dropdown: `bg-raised` + `border border-line` + `shadow-raised` + `rounded-xl`, text in `text-content` (label / expanded description) and `text-muted` (collapsed secondary line) — themes correctly in light AND dark, never pure black. Motion matches `dropdownMotion.js`: fade + a subtle 6px slide over **200ms ease-out** on BOTH appear and disappear (mount → double-rAF → shown; hide keeps it mounted ~210ms for the exit), reduced-motion aware. Text size settled at **label `text-base` / description `text-sm`** (bumped up twice at the owner's request for readability), bubble `max-width 300px`.

### 72.3 Wiring
`Sidebar.jsx` (Job Seeker, PESO Admin, PESO Staff, and the `employer` alias → PESO Admin menu) and `superadmin/SuperAdminSidebar.jsx` each got a `desc` string per nav item and now wrap their NavLink in `<SidebarTooltip label description showLabel={!isExpanded}>`. This REPLACED the old collapsed-only, label-only inline `group-hover` tooltip on both. The native `title` was dropped (so the browser tooltip can't double with ours) and an `aria-label` added on collapsed (icon-only) items to keep the accessible name. **"Employer" has no separate sidebar** — `normalizeRole` maps `employer`→`PESO_ADMINISTRATOR`, so it gets that menu + its tooltips. Footer actions (logout/settings/theme/home) keep their existing label tooltips (they're actions, not modules); the mobile drawer is unchanged (touch — no hover; labels already shown). Role-based nav logic, permissions, positioning, and responsive behaviour are all unchanged. Files: `job-tracker-frontend/src/components/common/SidebarTooltip.jsx` (new), `Sidebar.jsx`, `superadmin/SuperAdminSidebar.jsx`.

## 73. ChatContext Socket.IO lifecycle fix (2026-09-15, frontend-only, NO migration)

Fixed the authed chat/notification socket erroring with `WebSocket connection to 'ws://localhost:5000/socket.io/…' failed: WebSocket is closed before the connection is established`, and hardened the whole connection lifecycle. `ChatContext` remains the app's ONLY `io()` caller.

### 73.1 Root causes (traced, not suppressed)
1. **Effect keyed on the whole `user` object** (`[user]`) — so `updateUser()`/`refreshUser()` (which replace the user object, §68) and every profile edit tore down and rebuilt the socket → churn + duplicate/transient connections (the request-storm risk).
2. **`<React.StrictMode>`** (main.jsx) double-invokes the effect; cleanup `disconnect()`ed a still-connecting socket. With **websocket-FIRST** transport that aborts a raw WS handshake → the browser's "closed before established" warning.
3. **Localhost fallback** shipped only in dev (VITE_API_URL unset); prod was already env-driven, but a prod build with the var missing could in principle dial localhost.

### 73.2 The fix
- **Env-specific, prod-safe URL**: follows `VITE_API_URL` (same source as `api.js`), minus `/api`; if unset in a PROD build it falls back to `window.location.origin`, **NEVER `http://localhost:5000`** (only dev uses the localhost default).
- **Keyed on `[user?.id, user?.role]`** (stable primitives) — a profile edit no longer reconnects the socket; only a real login/logout/account-switch does.
- **Polling-first + upgrade** (`transports: ['polling','websocket']`) — graceful WS-unavailable fallback (stays on polling), and the WS upgrade happens AFTER StrictMode settles, so no mid-handshake abort / warning.
- **Controlled reconnection with capped backoff** (`reconnection:true`, `reconnectionAttempts:15`, `reconnectionDelay:1000`, `reconnectionDelayMax:15000`, `randomizationFactor:0.5`, `timeout:20000`) — socket.io owns retries; NO manual reconnect loop (that was the earlier 429 class of bug). `connect_error` logs + lets the backoff run; `reconnect_failed` fails gracefully (durable-state + visibility/poll backstops keep the UI correct until reload).
- **Full teardown** on auth change/unmount: `removeAllListeners()` + `io.removeAllListeners()` + `disconnect()` + `setSocket(null)`.

All chat/notification business logic (listeners, triggers, badge) is unchanged. Backend socket server + CORS were already correct (dev + `CORS_ORIGINS`/`FRONTEND_URL` env origins, both transports). Verified: `vite build` clean; app boots with zero console errors and NO socket attempt while unauthenticated; authed socket = owner-verified on their session. File: `job-tracker-frontend/src/context/ChatContext.jsx`.

## 74. VPS + Supabase production cutover — deploy, TiDB→PG data migration, $5 fix, object storage, domain email, SMS (2026-09-16)

This repo (`github.com/Angelo55/PESOKabankalanVPS`, checkout `C:\PESOKabankalanVPS\job-tracker-backend`) went from "the app connects to Supabase" to **live production** at https://pesokabankalan.tech carrying the real data. SEPARATE line from the original Vercel+Render+TiDB system.

### 74.1 Deploy (AWS EC2 + Nginx + PM2 + Supabase)
- EC2 `t3.small`, Ubuntu 22.04, `ap-southeast-1` (co-located with Supabase), Elastic IP `56.10.113.135`. Nginx (Let's Encrypt HTTPS + HTTP→HTTPS redirect, `deploy/nginx.conf.example`) reverse-proxies `/api`+`/socket.io` to `127.0.0.1:5000` (same-origin). PM2 runs a SINGLE `peso-app` (server.js + workers in-process sharing `io` — §25; `ecosystem.config.js` collapsed from the peso-api/peso-worker split, which WITHOUT Redis made worker→client real-time go dark). Runbook: `deploy/vps-runbook.md`. Google OAuth redirect URI added for the domain.
- DB: `DB_CLIENT=postgres` + Supabase **session-pooler** `DATABASE_URL` (the direct `db.<ref>` host is IPv6-only on the free tier → use the pooler). `db.js` boot log now reports the real masked DATABASE_URL target on the pg path (was printing the stale TiDB `DB_HOST`).

### 74.2 Full TiDB→Supabase DATA migration (full-replace)
Schema was already ported (`postgres/schema.sql`, 58 tables) → DATA-only. `scripts/etl-tidb-to-supabase.js` (`--dry-run`/`--execute`): introspects the target for tables/column-types/FK edges, topo-orders the load, coerces MySQL→PG (boolean 0/1→t/f, zero-dates→NULL, json objects→text), loads SOURCE∩TARGET columns (warns on source-only), truncates under `session_replication_role='replica'`, resets identity sequences to MAX(id), and **neutralizes migrated outbox rows** (`referral_jobs`/`email_outbox`/`sms_outbox`/`proactive_match_jobs`/`job_alert_jobs`/`application_scoring_jobs` → `status='migrated'`) so live workers never re-send the original system's referrals. Source = read-only `SRC_DB_*`; target = `DATABASE_URL`. Result: ~11,976 rows, all counts matched, FKs clean, sequences correct, 52 signed letters intact (base64 in `referral_letter_files`, linked by `queue_id`), Super Admin (`id=1`, google-linked) carried over. Full-replace WIPED the prior test data (intended). SAFETY: the destructive truncate+load is owner-run; stop `peso-app` first so workers don't act on migrating outbox rows.

### 74.3 Worker `$5` bug (Postgres type inference) — FIXED (`ea21930`)
`could not determine data type of parameter $5` dead-lettered ProactiveWorker + JobMatchWorker. Cause: the shared reverse-scoring funnel ordered by `u.location LIKE CONCAT('%', ?, '%')` — a bare param to Postgres's variadic-`any` CONCAT is untypeable (MySQL infers loosely). Fix: `LIKE ?` with a `%…%` value in `proactiveReferralRepository` + `jobAlertsRepository` (cross-dialect). Verified live on Supabase. See §13 gotchas.

### 74.4 Phase 2 object storage (Supabase Storage)
`services/storageService.js` gained a `supabase` driver (S3-compatible, shares the S3 path with `r2`) + private objects (`savePrivate`/`getPrivate`/`removePrivate`). Buckets via `scripts/provision-supabase-storage.js` (`avatars` public, `resumes` private). Résumé snapshots → private bucket via `application_resumes.file_key` (migration 054; `file_data` kept as base64 fallback), streamed back ONLY through the owner-scoped ATS route; avatars (raster) → public URL, SVG picks stay inline. Gated on a non-`local` driver (no-op until prod `STORAGE_DRIVER=supabase` + Supabase S3 keys). Frontend unchanged (`resolveAvatarSrc` passes URLs through). Owner decision: existing migrated base64 stays base64; only NEW uploads offload.

### 74.5 Email (Brevo domain sender) + SMS (TextBee)
- **Email**: prod sets `BREVO_API_KEY` + `BREVO_FROM_EMAIL=mail@pesokabankalan.tech`. Domain authenticated in Brevo via name.com DNS (brevo-code TXT + `brevo1/brevo2._domainkey` DKIM CNAMEs + DMARC; no SPF yet — DKIM+DMARC suffices). Brevo LEADS the chain; Gmail SMTP + `EMAIL_FALLBACK_*` are backups. Boot log `[Mail] Provider 'brevo-http' verified.`, test delivered from the domain. name.com gotcha: the Host field takes the SUBDOMAIN ONLY (auto-appends the domain).
- **SMS**: `SMS_PROVIDER=textbee` + `TEXTBEE_API_KEY`/`TEXTBEE_DEVICE_ID`, `sms_notifications_enabled`=true. Referral events only, to a verified+opted-in phone; in-app row always writes (0.11). Semaphore (paid PH) is the later option.

### 74.6 Cleanups
- `nullify-dead-local-images.js` made dialect-aware (`DATABASE()`→driver branch) + run — nulled 2 dead `/uploads/job-featured/*` refs the migration carried over (files weren't migrated; cards fall back to the branded placeholder).
- `verification_id_types` deduped 9469→13 (13 gov ID types × ~728 re-seed dups from the old boot-time `INSERT IGNORE` without a unique key) + `UNIQUE(name)` added (live + `postgres/schema.sql`).

### 74.7 Operations & logging
- **Logs live on the box** (no Render/Vercel dashboard): backend = `pm2 logs peso-app`
  (files `~/.pm2/logs/peso-app-*.log`), web = `/var/log/nginx/{access,error}.log`, OS =
  `journalctl`. Web dashboards remain for the DB (**Supabase → Logs**) and email
  (**Brevo → Transactional → Logs**). In-app: `/admin → Platform Health / Audit / SMS /
  Email`. A Render-style web UI is available via `pm2 plus` (free). Full map + a
  symptom→log cheat sheet: **`docs/observability-and-logs.md`**.
- **PM2 log rotation ENABLED** (2026-09-16): `pm2 install pm2-logrotate` with
  `max_size=10M`, `retain=14` — so PM2 logs can't fill the 20 GB disk (Nginx already
  rotates via Ubuntu logrotate).

**Deferred (roadmap `docs/post-launch-roadmap.md`):** worker-split + Redis for real-time; Semaphore SMS funding; a persistent staging env (blocked by Supabase's 2-project free limit — use local Docker Postgres or the migration dry-run); offloading existing base64 PII to storage.

