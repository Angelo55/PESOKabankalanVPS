# Development Stop-Point — PESO Kabankalan Referral System (2026-08-02)

**Branch:** `main` (all committed + pushed) · **Repo:** `github.com/Angelo55/PESO-Kabankalan`
· **HEAD:** `7724af0` · **Migrations on disk AND applied through `035`** · **Local ⇄ remote:** in
sync, nothing unpushed. Working tree clean except `job-tracker-frontend/.env` (local config/flags —
intentionally not committed).
> _Later-session addendum (2026-08-03 → 2026-08-04): the `adf64d3` stop-point below was extended by the
> Performance-P1 cleanup (`f5d31a6`), the Saved Vacancies bookmark-manager refactor
> (`9c9d42c`, migration 034), the **centralized theme-token system + full app migration**
> (`2a9d741`→`d9e4daa`; SKILL §24), the theme-fix + landing pass (`55781ce`, `97f080b`), the
> logo refresh (`1664ce6`, `2319d71`), and the **2026-08-04 work** — P1-tail cleanup, scoring
> dirty-check, the Save-Profile hang fix, and the **Infrastructure Optimization roadmap + worker-split
> prep** (`a35bbf6`→`e61b360`; SKILL §25), and the **application-specific re-scoring + standardized
> 4-status ATS** (`b7616c2`, migration 035; SKILL §18.5/§14) — see §3E/§3F/§3G/§3H. All deploy-verified by the owner._
>
> _**2026-08-05 addendum (LATEST — current HEAD `28ea153`, migrations applied through `036`):** the
> **Referral Lifecycle Synchronization** feature (`1b382cb`, migration 036, flag
> `referral_lifecycle_sync_enabled` — owner-enabled in prod): seeker sees + is notified of referral
> outcomes, admin-official/seeker-suggests collaborative model, seeker **PESO Applications** pipeline
> (`/applications/mine`, `MyPesoApplications.jsx`), `GET /api/config/features`; then the **R1–R4
> duplicate-perception fixes** and **R1 redesign** (similarity classifier + confidence levels,
> `services/duplicatePostingService.js`, `/jobs/duplicate-check`), the **real-time hardening**
> (bell backstop poll, socket polling fallback, messaging `triggerBadgeRefresh`), and the
> **AI-workflow operator guide** (`28ea153`). Full record: **SKILL §26**;
> `docs/referral-lifecycle-sync-plan.md`, `docs/ai-processing-workflow.md`. Audit finding: NO
> duplicate referral records existed — the canonical model was already enforced; the "duplicates"
> were two same-titled postings. **`WORKER_MODE` confirmed UNSET on Render** (single-service; workers
> share `io` → worker real-time reaches clients). `npm test` = 43. **Doc split (2026-08-05, `7c5739c`+):
> SKILL.md §17–§26 moved to `.claude/skills/peso-kabankalan-ai-system-architect/references/development-history.md`**
> (same section numbers; SKILL.md §0–§16 stay the core). When resuming, read **§18–§26 in that history doc**._
>
> _**2026-08-07 addendum (frontend-only UX, no migrations/backend change):** two post-`28ea153`
> phases. (1) **Frontend sync fixes** — memoised `notify` + `refreshNotifications` no-op skip +
> memoised context values (killed focus-triggered dashboard re-renders); board now refetches off the
> NEW_JOB notification (bell poll OR socket) so it never lags the notification. (2) **"Building with
> Good UX"** — reusable Empty State system (`common/EmptyState`, `GettingStartedGuide` seeker GAM,
> success variant) across ~24 surfaces, and the **unified Search Dropdown** (`common/SearchDropdown` +
> `hooks/useRecentSearches`) that REPLACED the below-content Recent/Suggested chips (deleted
> `RecentSearches.jsx`) — centralised in `jobs/JobFilterBar` for Board/Manager/Saved, embedded in
> ATS + Referral Register. Also: resume autosave is change-driven (dirty-check + client `rescore`
> flag, `test/resumeRescoreGating.test.js`), `npm test` = 46. Full records: **development-history §27**
> + UI addendum **§14–§15**. All `npm run build`-clean; interactive behaviours need a logged-in session._
>
> _**2026-08-07 addendum #2 — Application-lifecycle consolidation (development-history §28):** the five
> overlapping seeker surfaces are now ONE authoritative **My Applications** (`/my-applications`) over
> **`GET /api/applications/unified`**, which COMPOSES `job_applications` (PESO, referral-bound,
> read-only) + `usertrackedjobs` (imported, editable) — presentation-layer, NO table merge, NO
> migration. `hooks/useUnifiedApplications` (canonical stage + KPIs) feeds the page, the Dashboard
> chart/KPIs/recent widget. `/jobs` redirects; "PESO Applications" nav removed; `MyJobs.jsx` +
> `MyPesoApplications.jsx` DELETED. Referrals UNTOUCHED (still FK-bound to `job_applications`; guard
> test asserts `/unified` never writes it). Standardized with the shared `Pagination` +
> `useClientPagination` + a layout-aware skeleton. `npm test` = **47**. Do NOT reintroduce a separate
> PESO/`/jobs` applications page or move referrals off `job_applications`._
>
> _**2026-08-07 addendum #3 — Card-based My Applications + complete lifecycle + shared bulk toolbar
> (development-history §28.4–§28.5):** (1) analytics restored the FULL lifecycle — `useUnifiedApplications`
> maps both sources onto MAIN (Applied→Under Review→Shortlisted→Referred→Interview Scheduled→
> Interviewed→Final Interview→Final Interviewed→Hired) + ALT (Responded/Pending/Rejected/Withdrawn/
> No Response); a SINGLE status colour system (`STAGE_STYLE`/`statusHex`/`statusBadgeClass`/`statusRank`/
> `EXTERNAL_STATUSES`) feeds the chart, cards AND the Dashboard table. (2) My Applications is a CARD board
> reusing the Saved Vacancies toolkit; multi-select + bulk status (`PUT /tracked-jobs/bulk/status`) + bulk
> delete are IMPORTED-only; pin + colour on ALL cards via **migration 037 `application_preferences`
> (APPLIED)** + `PATCH /applications/:uid/preferences`. Default grid 4-col / 12 per page. (3) The
> Dashboard "All Your Applications" table was RESTORED over the unified feed (editable imported / read-only
> PESO) with real-time refetch. (4) The bulk toolbar is now the SHARED `BulkActionBar` + `BulkDeleteButton`
> (`common/AdminUI`) across Saved Vacancies + My Applications; the `SelectionBar` shell was retired
> (`SelectCheckbox` stays). `npm test` = **51**; migrations applied through **037**. Do NOT reintroduce a
> second bulk toolbar or a per-file status colour map._
>
> _**2026-08-08 addendum #4 — AI re-score change-detection guard (dev-history §29) + Document Builder blueprint:**
> (1) BOTH AI-scoring workers now short-circuit a redundant DeepSeek call when scoring inputs are
> byte-identical since the last SUCCESSFUL score — safe because scoring is deterministic (temp 0). Shared
> `aiScoringService.buildScoringPrompt`/`computeScoringSignature` (SHA-256 of the whitespace-normalized
> prompt → no drift from what's scored). Application worker = migration **038**
> (`job_applications.last_scored_input_hash`, flag `SCORING_INPUT_HASH_GUARD`); proactive matcher =
> migration **039** (`proactive_referral_candidates.last_scored_input_hash`, flag
> `PROACTIVE_INPUT_HASH_GUARD`). **APPLIED + both flags set `true` in prod (2026-08-08) → guards LIVE,
> owner-verified** (Render `skipped — inputs unchanged`, no DeepSeek call); both workers boot-log
> `input-hash guard ON` (`e31e826`). Guards at EXECUTION not scheduling (never swallows a real re-score — the
> reverted `2464403` trap); `parsed_text` sync + apply-time immutability + referral pipeline untouched.
> `npm test` = **67**. Rollback = flip a flag off (no deploy). (2) Planning only: `docs/document-builder-platform-plan.md`
> — unify the 3 doc builders into one framework (Template Gallery + live **react-pdf** preview + remove the
> AI/Manual intermediate modal); its §12 binds all builder work to preserve the Resume→scoring sync. Nothing
> committed this session (uncommitted on `main`)._
>
> _**2026-08-08 addendum #5 — Unified Document Builder SHIPPED (dev-history §30, UI addendum §16) + the §29
> guards are now COMMITTED:** the blueprint was BUILT through all 5 phases and pushed to `main` (HEAD
> `ee0da67`). ONE `components/builder/DocumentBuilder` (docType prop) replaces the 3 wizards: Template Gallery
> → editor (schema-driven forms + live **react-pdf** A4 preview) → **PDF + DOCX** export; the AI/Manual modal
> and `?mode=` are removed (Dashboard → gallery directly); the 3 old builders deleted. react-pdf client-side
> (preview == export; `src/bufferPolyfill.js` for photo export); `docx` for Word; both route-lazy. **§12 held**
> (résumé structured-JSON + `/resume/draft` rescore flag unchanged → scoring/ATS sync intact). Two fixes:
> **cover-letter draft dup-row bug** (`cover_letter_drafts.user_id` non-unique → `ON DUPLICATE KEY` inserted
> 325 rows/10 users; POST now self-heals to one row, GET returns newest non-empty — recovers lost letters, NO
> migration) and **resignation "Generate Body with AI"** via the shared `services/letterBodyService` (one
> endpoint per builder — never double-fires). `npm test` = **74**; build clean. The §29 hash-guard migrations
> **038/039 are now APPLIED** (2026-08-08; guards still inert until the flags are set). Commits: `d186069`+`60ee140`
> (builder+Buffer), `ee0da67` (fixes), `15082e8` (docs)._
>
> _**2026-08-23 addendum #6 — OFFICE-INTERVIEW REQUIREMENTS, Phases 1–6 (LATEST, current HEAD `dd8a7e3`,
> PUSHED to origin/main; migrations 040–043 APPLIED + deploy-verified via public `/job-board/stats`).**
> Full record: **development-history §31**; blueprint `docs/office-interview-requirements-analysis.md`; SMS
> proposal `docs/sms-notification-proposal.md`. Delivered from the PESO office interviews (Tejada, Ma'am
> Elma): **Phase 1** landing "Registered Job Seekers" stat removed + shared **`/home` button** + JPM field
> removals (Department/Work Setup/Description&Accommodations/Additional Questions) + **job-seeker mascot**
> (retired "Gebbie"). **§1.5** Gender job field (mig 040) + AI scoring-input refinement (employer-stated
> authoritative, certs non-mandatory; eval 100% band held). **Phase 2 PESO Staff `peso_staff` RBAC** (#1b/#9,
> no migration — VARCHAR role): least-privilege co-worker role, deny-by-default guard (staff → `/jobs*`
> only), `effectiveOwnerId` attributes staff jobs to the Manager, new `requirePermission`. **Phase 3 Events
> subsystem** (#2, mig 041 `peso_events`, `EVENT_ANNOUNCEMENT` broadcast). **Phase 4 referral acceptance**
> (#6, mig 042, flag `referral_acceptance_enabled`: endorse→`Pending Seeker Acceptance`→seeker ACCEPT mints
> the letter, `REFERRAL_ENDORSEMENT`) + **vacancy de-automation** (#11b, flag `vacancy_manual_fill_enabled`:
> no auto-fill, advisory cap, status-based `isJobFilled`) + **Positions "Not Specified"** (NULL headcount).
> **Phase 5 walk-in registration** (#7, mig 043, flag `walk_in_registration_enabled`: staff encode a
> visitor as a claimable real `users` row, duplicate detection + DPA consent, `walkin:manage` Manager-only).
> **Phase 6 SMS** (#8): PROPOSAL + `services/smsService.js` provider abstraction (ship-dark; provider TBD —
> owner selecting one). **Settings-flag FIX** (`dd8a7e3`): the 3 new flags were missing from
> `systemSettingsService.DEFINITIONS` → `get()` threw → they never showed in Super Admin Settings / never
> turned on / broke `/config/features` — now registered. **D6 soft-warn** on `ReferralActionButton`.
> `npm test` = **97**. All flags default OFF (prior behavior preserved); enable in Super Admin → Settings.
> **Deferred:** walk-in account-CLAIM endpoint; SMS provider wiring (send/outbox/worker/channel router)._
>
> _**2026-08-23 addendum #7 — TWO follow-up cycles, LATEST STATE (current HEAD `b828a4d`, PUSHED,
> migrations applied through `046`, `npm test` 118):**_
> _**(A) Office-interview FOLLOW-UPS (dev-history §32, migs 044/045 APPLIED):** SMS notification channel
> BUILT — provider-agnostic `services/smsService.js` (Semaphore wired + `console` zero-cost DEV provider
> + Twilio stub), 7th outbox worker (`sms_outbox`), `phoneVerifyService` (`phone_verifications`), channel
> router folded into `notificationService` (referral events only, gated `sms_notifications_enabled` +
> verified/opted-in phone), `/admin/sms` monitor, seeker opt-in card. **Production Semaphore DEFERRED —
> account Pending + UNFUNDED (~₱560/1,000 custom top-up is the cheap resume path; resume via
> `docs/sms-notification-proposal.md` §6a); dev uses `SMS_PROVIDER=console`. Twilio ruled out for PH
> (trial caller-ID verification blocked).** Walk-In account CLAIM (mig 045; hashed code + expiry, public
> `/claim` links the EXISTING row, staff reissue, works SMS-disabled). Sidebar navigation regrouped by
> workflow. Identity-Verification-ID REMOVED (code/UI only; columns dormant)._
> _**(B) Refinement pass + Landing carousel (dev-history §33, mig 046 APPLIED + owner-verified):**
> **account SUSPENSION now enforced SERVER-SIDE** (mig 046 — `requireAuth` + login reject a Suspended
> account, 403 `ACCOUNT_SUSPENDED`, `api.js` interceptor force-logs-out; suspend captures reason/end-date
> + notifies in-app/email/best-effort-SMS; `SuspendDialog` + Status/Sort filters). **Smart Referral Queue
> GROUPED BY VACANCY** (`/peso-admin/proactive/candidates/grouped`, ranked within each job, paged by
> vacancy). Email/SMS Delivery pagination+search. Events skeleton. Collapsed-sidebar tooltip fix.
> **TopHeader welcome ILLUSTRATION** + **Landing mascot → 5-slide Streamline Tokyo CAROUSEL** (local SVGs
> in `src/components/`); **Chatbot icon REVERTED to `JobSeekerMascot`**; Streamline free assets used WITH
> a footer attribution credit. Committed in 6 atomic commits `715bcd1`→`b828a4d`._
>
> _**2026-08-24 addendum #8 — SMS follow-ups (LATEST, current HEAD `6b27031`, PUSHED, migrations
> unchanged at `046`, `npm test` 122; dev-history §33.10):** all on `main`, Semaphore still
> deferred/untouched. **(1) TextBee real-delivery DEV provider** (`a4e4027`) added behind the SAME
> `smsService` abstraction (textbee.dev; Android phone as gateway) — env-only `SMS_PROVIDER=textbee` +
> `TEXTBEE_API_KEY` [+ optional `TEXTBEE_DEVICE_ID`]; NO sender name (the device is the endpoint);
> owner-verified sending real SMS. Keys live ONLY in `.env`/Render. **(2) Account-lifecycle SMS made
> consistent** (`2e4015c`): `ACCOUNT_REACTIVATED` now fans out to SMS like suspension, and the fan-out
> dedupe is per-MINUTE for `ACCOUNT_*` (synchronous admin actions) vs per-HOUR for referral events
> (retrying worker) — fixed suspension SMS being suppressed on a same-hour retry. **(3) Actionable
> auth-gated links** via new `utils/appUrl.js` (env-driven, always absolute): referral SMS → `/referrals`,
> reactivation email+SMS → sign-in, **walk-in claim SMS → absolute `/claim` link + code + open/enter
> instruction** (`claimBaseUrl()` now uses `appUrl`; fixed a relative-`/claim` local bug). No link carries a
> token/auto-login. Skill docs (SKILL §32/§33 + dev-history §33.10 + SMS proposal) updated + pushed
> (`6b27031`). Semaphore resume path unchanged (`docs/sms-notification-proposal.md` §6a)._
>
> _**2026-08-24 addendum #9 — Landing auth-modal polish + SESSION HANDOFF (LATEST, current HEAD
> `ae609b1` + this docs commit, PUSHED, migrations `046`, `npm test` 122; dev-history §33.7):** two
> frontend-only auth-modal refinements, no backend/routing/migration change. (1) **Illustration side
> cleanup** (`04a6402`) — removed the contextual speech bubble/caption (+ dead `GEBBIE_MESSAGES`/
> `getGebbieMessage`/state/effect) and the decorative animated background (`gebbie-aurora` wash, pink
> `#ffb84d`/violet `gebbie-orb` glows, `gebbie-float` dots, white slide card); replaced with a restrained
> static soft surface (`bg-gradient-to-b from-[#f6f8f7] to-[#eef2f0]`). The 5-slide Streamline Tokyo SVG
> carousel now IS the full visual content of the panel (fills it, `object-contain`, no distortion);
> crossfade + dots + hover-pause + reduced-motion retained. (2) **Backdrop-click dismissal** (`ae609b1`) —
> the overlay closes on an outside click via `e.target === e.currentTarget` (inside-content clicks never
> close; X button + animations unaffected). Both live-verified in the DOM. Skill docs (SKILL/dev-history
> §33.7 + this addendum + memory) brought fully current for the handoff._
>
> _**2026-08-24 addendum #10 — cover_letter_drafts UNIQUE(user_id) hardening (LATEST, HEAD `7ff05b5`,
> PUSHED, migrations applied through `047`, `npm test` 124; dev-history §33.11):** closed the last parked
> optional item (§14). **Migration 047** adds `UNIQUE(user_id)` on `cover_letter_drafts` — STEP 1 dedups
> each user to the SAME row the GET returns today (newest non-empty JSON `$.body`, else newest) via TiDB
> `_tidb_rowid` (the table has NO primary key), idempotent; STEP 2 `ADD UNIQUE INDEX
> uq_cover_letter_drafts_user (user_id)` (FK index left in place). Verified: dedup exercised in a
> ROLLED-BACK txn against prod (253 removed / 10 kept / every letter preserved), then applied + owner-verified
> (unique index present, 0 dups). **TiDB gotcha learned:** `ADD INDEX IF NOT EXISTS` is an `ER_PARSE_ERROR`
> here — the first apply failed on STEP 2 (STEP 1 had already committed the dedup), fixed to plain
> `ADD UNIQUE INDEX` (matches mig 033) and re-ran. The POST self-heal in `routes/coverLetterRoutes.js` stays
> as belt-and-suspenders (do NOT revert to `ON DUPLICATE KEY UPDATE`). Commits `4552b08` (migration + test),
> `7ff05b5` (skill docs)._
>
> _**2026-08-24 addendum #11 — Landing Page PESO Events & Job Fairs carousel (LATEST, HEAD `082bfbd` +
> this docs commit, PUSHED, migrations UNCHANGED at `047`, `npm test` 127; dev-history §34):** the public
> LandingPage now surfaces upcoming events in a **two-row horizontal-scrolling shelf**, placed right after
> the Local Employment Board (`#jobs`) with an "Events" nav link (desktop/mobile/footer). Each card shows
> the **ACTUAL uploaded `banner_image`** (same poster the seeker `Events.jsx` renders) with a date pill +
> type badge; skeleton/empty/fetch-failure states; a lazy detail modal via `GET /events/:id` (backdrop/Esc/X
> close). REUSE, no duplication: reads the SAME `peso_events` + `banner_image` via the SAME public
> `GET /api/events`; `eventRepository.listPublished` gained optional `{ scope:'upcoming', limit }` (banner
> always included, bounded 1..50) and the earlier banner-free `listPublishedLite`/`LITE_COLUMNS` was REMOVED;
> no-param callers (seeker module) unchanged. Layout is deliberately minimal — no arrows/dots/autoplay/snap,
> no per-card reveal; `grid-rows-[repeat(2,auto)]` so a sparse 2nd row collapses. Bespoke-palette landing
> components (LandingPage excluded from tokens, §24). No migration/records/upload path. `.claude/launch.json`
> gained a local `backend-dev` (API-only `dev:web`) verification helper (gitignored, not committed). Commit
> `082bfbd` (backend+frontend+tests)._
>
> _**2026-08-24 addendum #12 — Landing Page discovery-first section reorder (LATEST, HEAD `acf732e` +
> this docs commit, PUSHED, migrations UNCHANGED at `047`, `npm test` 127; dev-history §34.1):** moved the
> `#features` marketing block ("What the platform does for you" / "One portal, from resume to referral")
> from BEFORE the Local Employment Board to AFTER the Events carousel, so the order is now **stats →
> `#jobs` → `#events` → `#features` → `#ai-assistant`** — search-driven discovery content sits directly
> under the stat tiles. Pure JSX relocation; `#features` content, the hero search → `filteredJobs` → `#jobs`
> wiring, and every other section unchanged (nav has no Features link). Commit `acf732e`._
>
> _**2026-08-24 addendum #13 — Root-to-top AUDIT + first improvement increment (LATEST, HEAD = tip of
> `main`, PUSHED, migrations UNCHANGED at `047`, `npm test` 130; dev-history §35, audit
> `docs/system-audit-2026-08-24.md`):** an 8-phase engineering+UX audit of the implemented system (P0..Future
> matrix, roadmap items excluded — **no P0 found**), then the highest-value low-risk increment: **F1** AI-score
> **provenance** (`aiClient.chatDetailed()` reports the real serving provider+model; `scoreApplication` stamps
> `{provider,model,promptVersion,scoredAt}` into the JSON-persisted score — NO migration; NOT in the prompt/
> signature so no spurious re-score; verified live `deepseek`/`deepseek-v4-flash`/`tier1-2026-08`). **F2**
> surfaced the AI `summary` rationale ("Why this score" on the board; provenance line in the admin drawer).
> **B1** sub-score colours track High/Med/Low. **D1** debounced the tab-focus refetch waterfall
> (notif/chat/ATS, 20s min-refetch guard — polls/socket backstop untouched). **F3** documented the AI
> reproducibility boundary (`docs/system-guide.md` §5). Scoring engine/NULL-contract/hash-guard/apply-time
> immutability all UNCHANGED. Remaining audit items (C1/D2/A2/G3) are P2/P3, not done._
>
> _**2026-08-24 addendum #14 — audit increment cont'd: C1 done, D2 declined (dev-history §35.5):** **C1**
> shipped a reusable `src/hooks/useFocusTrap.js` (focus-trap + restore, WCAG 2.4.3; focuses SYNCHRONOUSLY —
> rAF is paused when the tab is hidden) applied to the seeker `EventModal` + landing `LandingEventModal`
> (verified live). **D2 DECLINED** — lazy-loading LandingPage saves only ~26 kB gzip on the entry and
> conflicts with the deliberate `App.jsx` decision to keep it eager (no landing-page flash); **LandingPage
> stays eager**. Remaining: A2 + G3 (P3). Commit `3ede788` (C1) + this docs commit._
>
> _**2026-08-25 addendum #15 — AUDIT COMPLETE (LATEST, HEAD `4aed58a`, PUSHED, migrations `047`, `npm test`
> 140; dev-history §35.6–§38).** The remaining audit items are done and the root-to-top audit is closed:
> **C1 extended** to the auth overlay + `ApplicantProfileDrawer` (same `useFocusTrap`; auth overlay verified
> live). **A2** — documented the intentional worker-`io` asymmetry (only referral+scoring workers emit, so
> only they take io; no functional change). **G3 (owner-verified end-to-end on a real registered job seeker):**
> **G3.1** declining an applicant (`rejectReferral`, Pipeline/AI-Recommended, single+bulk) now notifies the
> seeker (`APPLICATION_DECLINED`) — plus the void→seeker `REFERRAL_WITHDRAWN`; **G3.2** declining system-sets
> the app to **'Not Referred'** (twin of approve→'Referred', terminal, excluded from re-scoring; first-class
> stage); **G3.3** the 75(board)→30(pipeline) gap TRACED — engine deterministic + single-sourced, seeker+admin
> already share `COALESCE(current_match_score,match_score)`; the divergence was the CACHED board PREVIEW vs the
> committed score for different résumé states → reconciled by `services/matchScoreCache.js` invalidated on every
> résumé change + a "Calculating…" chip (NO scoring logic changed). **E3** — read-only EXPLAIN/index pass:
> every hot query index-driven, zero full scans, no code change. **C2** — Events-carousel scroll affordance
> (edge-fades on overflow + thin scrollbar; not a carousel pattern). Commits `2cac2f7`→`4aed58a`._
>
> _**2026-08-25 addendum #16 — NEW FEATURE: DOLE PESO Accomplishment Report (LATEST, HEAD `70a1339`, PUSHED,
> migrations `047`, `npm test` 148; dev-history §39).** Post-audit feature work. The DOLE accomplishment-report
> FORMAT the existing §7.11 referral report doesn't produce: period AGGREGATE counts (registered · vacancies/
> positions solicited · referred · placed) by **sex** + **educational attainment**, as an official **PDF** +
> sectioned **CSV**. RECONCILES with §7.11 (same cohort — `referral_queue.status='Approved'` by `reviewed_at`,
> placed = `outcome='Hired'` only, 0.14; verified live: referred 48 / placed 7 / 14.6% of-all, 100% of-known).
> `reportingRepository` (demographics → 'Not specified', derived-table GROUP BY to dodge TiDB
> `only_full_group_by`, no `JOIN userprofiles`) + `reportingService` (both denominators + `toCsv` BOM/
> `csvField` + `buildAccomplishmentExport`) + `reportPdfService` (pdfkit, page-break-aware, NOT the single-page
> letterhead). `GET /referrals/reports/accomplishment` (PESO admin, owner-scoped) + `GET /admin/reports/
> accomplishment` (Super admin, office-wide); shared `common/AccomplishmentReport` wired into `ReferralReports`
> + `PlatformReports`. NO migration. **Phase B deferred** (capture DOB/age + stronger sex/education prompts —
> age not reported today). Commit `70a1339`._
>
> _**2026-08-25 addendum #17 — Certificate-scoring removal + requirement-only scoring rule + ProactiveWorker
> summary log (LATEST; dev-history §40; `npm test` 151; NO migration).** Office-workflow clarification: PESO
> scores STRICTLY against the employer's STATED Requirements & Qualifications, and certifications are NOT a
> separate matching criterion. (1) The **separate certificate SCORING path (Phase 2D-C / §18.6 C.3) was
> REMOVED** — certificate FILES stay stored + admin-viewable EVIDENCE ONLY (Apply Wizard upload + Portfolio
> library UNCHANGED) but no longer feed the AI score and no longer arm a re-score (`getCertificateContext` +
> the worker `extraContext` feed + the apply-time cert re-score trigger all deleted). The prompt's "certs are
> supporting evidence, NOT mandatory" rule STAYS (it governs certs INSIDE the résumé, still scored via
> `parsed_text`). (2) `buildScoringPrompt` gained the **symmetric "do NOT RAISE the score for unrequested
> résumé content"** rule → the score reflects ONLY the stated Requirements & Qualifications;
> `SCORING_PROMPT_VERSION`→`req-strict-2026-08-25`. Eval-confirmed neutral (`requirement-strict` variant:
> MAE 6.4→7.9, band 100%, 0 FP/FN). (3) A "surface unrequested strengths in the `summary`" idea was TESTED +
> REJECTED (inflated scores in the eval); a separate non-scoring strengths field is a DEFERRED option (owner:
> leave it). (4) `[ProactiveWorker]` now logs a per-RUN summary line. Local `.env` got the two §29 guard flags
> to exercise them locally (untracked)._
>
> _**2026-09 addendum #18 — Cloudflare R2 storage layer for job images + centralized storageService
> (LATEST; dev-history §41; `npm test` 158; NO migration; ship-dark).** Fixes the ONE genuinely
> disk-dependent upload path — job featured images (`multer.diskStorage`→`uploads/job-featured/`→
> `express.static`, in `pesoAdminRoutes`+`adminRoutes`) — that worked locally but vanished in prod
> (Render's ephemeral disk). New **`services/storageService.js`**: env-driven `STORAGE_DRIVER`
> (`local` default → `uploads/`; `r2` → Cloudflare R2 via lazy-required `@aws-sdk/client-s3`), creds
> EXCLUSIVELY from env (`R2_*`), never to the frontend. Both handlers → `memoryStorage` +
> `storageService.save/remove`; validation preserved (8MB + JPG/PNG/WEBP); frontend UNCHANGED
> (`resolveJobImage` already used full URLs). `server.js` boot-logs `[Storage] driver=…`. **Owner
> decision:** avatars/résumés/event banners/certificates/referral letters STAY base64-in-DB (they
> work in prod; the phased migration is deferred). Invariant 0.5 amended for job images only.
> Activation is env-only on Render — guide `docs/cloudflare-r2-setup.md`; decision doc
> `docs/cloud-storage-proposal.md`._
>
> _**2026-09 addendum #19 — UI skeleton alignment + job-update worker-trigger precision (LATEST;
> dev-history §42; `npm test` 163; NO migration).** (1) Shared **`SkeletonCompactCard`/
> `SkeletonCompactCardGrid`** (`components/Skeleton.jsx`) mirror the Saved Vacancies / My Applications
> compact card + 240px grid EXACTLY → no CLS; both modules point at it; the media-band `SkeletonJobCard`/
> `SkeletonCardGrid` (Public Board / PESO Dashboard) are untouched (UI addendum §5.5). (2) **Worker-trigger
> precision:** `PUT /peso-admin/jobs/:id` now arms scoring/proactive/job-alert workers ONLY when a
> `buildScoringPrompt` field changed (title/company/description/skills/qualifications/education/experience/
> gender) — a media-only image edit (`featured_image` = the SEPARATE `POST /jobs/:id/image` endpoint) or
> non-scoring metadata (location/salary/deadline/positions/…) arms NOTHING. Enqueue-time twin of the §29
> input-hash guard; identical for PESO Admin + Staff (`effectiveOwnerId`). Root cause: the job-edit form
> always re-PUTs the FULL form on save, and the PUT enqueued unconditionally. `test/jobUpdateWorkerTriggers.test.js`._
>
> _**2026-09 addendum #20 — Post-registration onboarding + account-completion gate (LATEST; dev-history §43;
> `npm test` 168; NO migration).** A job seeker must complete **name, phone, location, gender, dob,
> educational_attainment** AND have a **résumé on file** before **Apply** unlocks (résumé optional to finish
> onboarding, required to apply; owner decision; gate applies to EVERYONE at apply-time). State is DERIVED by
> `services/onboardingService.evaluate()` from the `users` columns + `uploaded_resumes.parsed_text` — NO new
> column/flag, so refresh/logout can't bypass it and new + walk-in accounts share one gate. Server-enforced:
> `POST /applications` → 403 `PROFILE_INCOMPLETE` before any insert (fails OPEN on a DB error); status via
> `GET /profile/onboarding`. Frontend: `AuthContext.onboarding`/`openOnboarding` + `components/onboarding/
> OnboardingModal.jsx` (mounted once in AppLayout; auto-opens for incomplete seekers + force-opened by a gated
> Apply; reuses `PUT /profile` with a FULL prefilled payload so no field is wiped). Removed the empty Profile
> Activity + Response Tracker sections. `test/onboardingGate.test.js`._
>
> _**2026-09 addendum #21 — Optional "About you" onboarding step (LATEST; dev-history §43.6).** Extended
> `OnboardingModal` with a 5th step (between Identity and Résumé) collecting OPTIONAL fields at setup:
> **Languages Spoken** + **Core Skillsets** (comma-separated textareas mirroring Identity & Profile) and
> **Work Preferences** (preferred_roles / experience_level / availability / career_goals — same inputs as
> the profile "Career Preferences" section; selects gain a `Select…` option). ALL OPTIONAL — the gate stays
> the 6 identity fields, skipping preserves completion. NO new columns/model (the modal already round-trips
> every profile column; `saveProfile` → `persist({validateRequired,next})`); single source of truth via the
> same `PUT /profile`. Also fixed the earlier AuthContext TDZ white-screen (commit `aa250b5`). Build clean;
> `npm test` 168._
>
> _**2026-09 addendum #22 — PESO Admin export audit + dashboard-CSV parity (dev-history §44;
> `npm test` 172).** Audited all four PESO Admin exports; only the dashboard summary
> (`/peso-admin/analytics/export`) was incomplete — 4 of 6 KPIs + 2 distributions from its OWN duplicated
> SQL, missing Registered Job Seekers, Active Local Employers, the 3 pending-action counts, and the monthly
> trend series, and it ignored `?months=`. Fixed by extracting a shared `computeOverview(adminId,
> windowMonths)` that BOTH `/analytics/overview` (JSON) and `/analytics/export` (CSV) call → parity by
> construction; the export now carries every displayed metric for the SAME trend window (frontend passes
> `?months=<trendMonths>`). ATS (`/ats/applicants/export`), referral-row (`/referrals/reports/export`), and
> DOLE accomplishment exports were already complete (backend queries, owner-scoped, not paginated) — untouched.
> `test/dashboardExportParity.test.js`. R2 activation confirmed DONE in prod (memory standing-reminders item 5)._
>
> _**2026-09 addendum #23 — Landing/Dashboard UX series (§45–§48) + data-processing module refactor (§49) (
> HEAD `f426e74`; migrations applied through `049`; `npm test` 172).** Several cycles the addenda skipped:
> **§45** Landing Events single-event infinite-loop carousel + PHP currency centralization, **§45.4–§45.6** banner
> quality + true infinite loop + **event banners base64→R2 (owner-ran, verified; mig 048 applied)**; **§46** Landing
> content-integrity cleanup (testimonials removed, FAQ+Visit Us consolidated, redundant Contact Us form + dead
> `POST /job-board/contact` route removed, CTA moved into the FAQ column); **§47** top-header HOVER dropdowns
> (avatar + bell, capability-gated) + welcome greeting relocated to a temporary once-per-session `DashboardGreeting`
> banner (full-width; compact pill tried + REVERTED) with a per-placement **HIRED** celebration variant; **§48**
> `SkeletonProfile` structural skeleton + AI Chatbot `SYSTEM_PROMPT` realignment. **§49 (this session's substantive
> work): the Import Past Applications + Analyze My Resume refactor — Phases A–D** (dev-history §49; blueprint
> `docs/data-processing-modules-proposal.md`): **A** shared `components/dataflow/ProcessingModal` + `StepProgress`;
> **B** deterministic Import pipeline (mig **049** `import_batches`, `services/importService.js`, `POST
> /profile/import/preview` + `/import/commit`, `ImportPastApplicationsModal`) that REPLACED the destructive
> `/tracker/upload`; **C** hardened Analyze My Resume (`services/resumeText.js` — PDF via `pdfTextService`, DOCX via
> the new **`mammoth`** dep; `/profile/upload` persists parsed text to `uploaded_resumes`; `AnalyzeResumeModal`);
> **D** shared `services/resumeAnalyzer.js` + `scripts/eval-resume-analysis.js` (`npm run eval:resume`). **§49.5
> integration invariant VERIFIED (owner-raised):** imported records write `usertrackedjobs` and surface via `GET
> /api/applications/unified` — the SAME store/schema/status model/read feed as manual tracked jobs and both the
> Dashboard "All Your Applications" widgets and the "My Applications" page; validation/dedupe/limits run BEFORE
> persistence, `import_batches` is a counts-only audit ledger (not an application store), commit is append-only,
> edits stay on `/tracked-jobs`. No parallel/duplicate application model. See SKILL still-live rule "Import Past
> Applications is a controlled WAY TO CREATE `usertrackedjobs` records, never a parallel application store."_
>
> _**2026-09 addendum #24 — Public Visitor-Support Chatbot on the Landing Page (§50) (dev-history §50;
> `npm test` 192; NO migration).** A dedicated PUBLIC AI assistant for anonymous visitors, SEPARATE from the
> authenticated Job-Seeker chatbot (`routes/chatbotRoutes.js`, untouched). Phases A–E: **A** `aiClient.chatRaw()`
> (full assistant message incl. `tool_calls`, via a shared `runCompletion`; `chat`/`chatDetailed` unchanged) +
> `translateResponse`→`services/aiTranslate.js` (both bots share it). **B** `POST /api/public-assistant/query`
> (NO auth) — `services/publicAssistant/knowledge.js` (public prompt, tool schema, caps, `sanitizeMessages`,
> `deriveActions`, fallback) + `publicData.js` (read-only PUBLIC data + one allowlisted `runTool`); per-IP
> burst 20/15m + daily 60/day, bounded ≤3-round tool loop, NO `chathistory`/no anonymous persistence. **Nav is
> derived server-side (`deriveActions`), NOT a model tool.** **C** `components/PublicChatbot.jsx` in
> `LandingPage.jsx` (floating launcher + panel + 8 quick actions + a11y; landing palette; `onNavigate` reuses
> `scrollTo`/`setAuthMode`) — verified in-browser end to end; fixed a `liveRef` Fast-Refresh stall. **D**
> hardening (raw-array bound + `language` clamp). **E** docs. **Follow-up DONE (§50.1): app-wide Express
> `trust proxy`** now `app.set('trust proxy', 1)` in `server.js` → ALL rate limiters key per-visitor (were one
> global bucket on Render) + auth audit logs the client IP; `authRoutes` `loginLimiter` raised 5→15/15min for
> shared-LAN tolerance; the public route reverted to the default keyGenerator. Verified express-rate-limit
> accepts it + cookies unaffected (`secure` is NODE_ENV-gated)._
>
> _**2026-09 addendum #25 — Event edit: atomic banner Replace + `event_date` re-save fix (dev-history §51;
> `edd693f`; NO migration; `npm test` 192).** Owner report: changing an event's banner on edit could make a
> still-published event VANISH from the Landing Page. Root cause was NOT the banner — it was `event_date`: the
> edit form round-trips the stored value, which serializes as a full UTC datetime (DB pool `timezone:'Z'`), and
> EVERY save re-sent that `…T00:00:00.000Z` into the DATE column, risking a shift out of the Landing carousel's
> upcoming filter (`event_date >= CURDATE()`). Fixed by normalizing `event_date`→YYYY-MM-DD server-side
> (`eventRoutes.cleanEventInput`) + client-side (`PesoEventManager.save`). Also added a proper **"Change"**
> (atomic replace) beside "Remove" in the Edit modal — validates the new image and swaps ONLY on success (keeps
> the current banner on a bad/oversized/cancelled pick); transaction-safe (R2 upload before the single UPDATE;
> old value/asset retained on failure; `events.update` never touches `status`). Confirmed the backend NEVER
> deletes/unpublishes on a banner edit + the slide renders a gradient for a null banner. PESO Admin + Staff share
> the one `PesoEventManager` + `events:manage` path. Authed modal → owner runtime-verifies._
>
> _**2026-09 addendum #26 — Chatbot UI unification (dev-history §52; frontend-only; `npm test` 192).**
> Owner review: the public + authenticated chatbots were duplicated frontend implementations. Kept SEPARATE at
> the context level (routes/prompts/tools/permissions — already correct §50) but UNIFIED the UI via a new
> `components/chat/` layer — `ChatLauncher` (shared pill: mascot + "Ask PESO Assistant" + Chat chip), `chatMotion`
> (one open/close transition + `.chat-msg-in` keyframe in index.css — the app has NO tailwindcss-animate, so
> `animate-in …` was a no-op), `MessageBubble`, `TypingIndicator` — all palette-parameterized by `variant`
> (`app` tokens vs `landing` greens). Public launcher is now the shared pill (was a circular FAB); the authed
> bot's message animation is fixed (was a no-op). Composer + QuickActions stay per-context (auth language
> menu/interaction chips vs public nav-actions/quick-actions) — deliberately not shared. Backend AI layer was
> already shared (aiClient + aiTranslate). Commits `accc431` (Phase 1) + the Phase 2 docs commit. Public side
> verified in-browser; authed is login-gated → owner runtime-verifies (verbatim extraction, visuals unchanged)._
>
> _**2026-09 addendum #27 — Landing Page Light/Dark toggle + bespoke dark palette (LATEST; dev-history §53;
> frontend-only; `npm test` 192).** A `components/common/ThemeToggle` in the Landing header (desktop + mobile)
> reuses the EXISTING `ThemeContext` (state, `localStorage['theme']` persistence, `.dark`-on-`<html>`,
> View-Transitions toggle animation) — `ThemeProvider` already wraps the Landing (`main.jsx`), so the theme is
> SYNCED Landing↔app; NO duplicate theme logic. **SUPERSEDES §24/§45 "Landing is always-light":** added a
> curated bespoke DARK palette via `dark:` hex variants (NOT app tokens — the §24 token-exclusion STILL HOLDS;
> do NOT tokenize the Landing) across every surface (root `#0b1220`, cards `#111b2e`, tints/borders/text, hero
> photo dimmed, `.dark .glass-card`), plus the public chatbot's landing variants + panel. Light mode unchanged.
> Verified: toggle flips + persists; full-page scan = 0 light surfaces in dark (down from 49); build clean._
>
> _**2026-09 addendum #28 — UI/UX optimization pass: events blank-section fix + chatbot perf + Profile routing
> (LATEST; dev-history §54; `ccbfc5e`; `npm test` 192).** Three owner-reported items. **(A) Landing "Events &
> Job Fairs" rendered BLANK-but-clickable** — ROOT CAUSE was the scroll-reveal `.reveal` stuck at `opacity:0`:
> the IntersectionObserver effect's deps omitted `events`, so the late-mounting Events carousel (mounts only
> after the async fetch resolves) was never `observe()`d when `events` won the load race vs `jobs` — never
> `.active`, permanently invisible. Fix = add `events`/`loadingEvents` to the observer deps (the SAME re-observe
> pattern the job board already uses in that file). **(B)** banner `<img> onError` → branded-gradient fallback,
> so a broken/404/invalid R2/data-URI banner never blanks a card. **(C)** Landing now shows **ALL** published
> events, ordered upcoming-first→undated→past via `listPublished` 'all' scope (a LIMIT no longer buries the next
> event); relabeled "Upcoming PESO Events" → "PESO Events & Job Fairs"; `scope='upcoming'` UNCHANGED (still the
> chatbot's `get_upcoming_events`). **(D)** authed `Chatbot.jsx` render parity with the public bot — dropped the
> full-page + ~7 stacked `backdrop-blur` passes, `3xl→md` + `transform-gpu`, direct `scrollTop` auto-scroll,
> real `.chat-msg-in`. **(E)** TopHeader Profile role-aware: PESO Admin → `/peso-admin/profile` "Organization
> Profile" (was the applicant-only `/profile` that bounced them). **Verify caveat:** the Browser pane runs as a
> HIDDEN tab (`visibilityState:'hidden'`) → IntersectionObserver callbacks AND CSS transitions are suspended, so
> `.reveal`/opacity CANNOT be verified live in-pane (all reveals read opacity:0 there regardless); confirmed
> `.reveal.active`→`opacity:1` in the built CSS instead. Do NOT trust in-pane reveal/IO checks._
>
> _**2026-09 addendum #29 — Job Seeker vacancy-detail side panel redesign (LATEST; dev-history §55; `650abfc`;
> build clean).** Owner UI/UX feedback: the posted-vacancy side panel (opened by double-clicking a `JobCard` on
> the Public Job Board → `PublicJobBoard.jsx` `selectedJob` slide-over) felt compressed, hard to scan, and
> unbalanced. **Layout/hierarchy ONLY — no change to data, handlers, the double-click open flow, AI scoring,
> apply/save/inquire, similar-jobs, or filled logic.** Restructured around a scannable **key-facts strip**
> (Salary emphasized, Employment+setup, Location, Positions open, Deadline) via a new module-level `DetailFact`
> cell placed directly UNDER the title — replacing the buried sidebar "Application Details" card (REMOVED, no
> duplication) + the three header pill-chips. Added a status pill (Now Hiring / `filledLabel`) + posting age
> (`postedLabel(created_at)`, available since the detail route is `SELECT pj.*`) + department in a context row.
> Title `text-4xl`→`2xl/3xl`; consistent iconized section headings + tighter rhythm (`space-y-6`, `p-5/6/8`,
> `rounded-2xl`). Sticky header actions + the AI Compatibility card kept verbatim. Login-gated → build-verified;
> owner runtime-verifies the logged-in panel. Board is in `AppLayout` so it IS tokenized (dark-aware)._
>
> _**2026-09 addendum #30 — System audit: abuse-protection + AI-cost rate limits + legal/privacy accuracy
> (LATEST; dev-history §56; `4ffb377`; `npm test` 192; report `docs/system-audit-2026-09.md`).** Verify-before-change
> pass across requests/usage/abuse-protection + legal/compliance. **Verified already-correct + KEPT:** AI client
> 20s timeout + circuit breaker + single-pass failover; the 7 outbox workers' `max_attempts` dead-letter +
> backoff + batch cap; existing auth/chatbot/public-assistant/AI-builder limiters; Privacy+Terms modals (RA
> 8759/10691/10173); testimonials already removed (§46); Streamline attribution; NO external scripts/fonts/CDN/
> tracking cookies; DiceBear local; one strictly-necessary auth cookie. **Fixed:** new **`middleware/rateLimiters.js`**
> (shared env-tunable `RL_*` factory) — app-wide `/api` **`globalLimiter`** backstop (300/min/IP, health+OPTIONS
> exempt) in `server.js` + tight `aiLimiter`/`applyLimiter`/`writeLimiter` on the previously-unprotected cost
> endpoints (`/applications`, `/jobs/match`, `/profile/{upload,insights/generate,match,avatar}`,
> `/messages/conversations`); app-wide **`helmet`** (CSP OFF; `crossOriginResourcePolicy: 'cross-origin'` REQUIRED
> so Vercel can load `/uploads`); 60s frontend axios `timeout`; Privacy Policy accuracy (removed the false
> "government ID documents" claim §48, disclosed real subprocessors + cookie notice — needs DPO sign-off).
> **Deferred (owner/legal, in the report):** body-size limit, Socket.IO throttle, standalone `/privacy` routes,
> NPC registration/retention, WCAG re-audit, pre-public secret rotation._
>
> _**2026-09 addendum #31 — Standalone legal pages + SPA deep-link fix (LATEST; dev-history §57; `fa5d2f6`;
> frontend-only; build clean; verified live).** The §56 "standalone routed legal pages" follow-up. NEW
> **`components/legal/legalContent.jsx`** = ONE source for the Privacy/Terms/Cookie text; the Landing
> signup-consent modals AND the new routed pages both render it via `<LegalSections>`, so they CAN'T drift (§56).
> NEW **`components/legal/LegalPage.jsx`** routed at **`/privacy`·`/terms`·`/cookies`** in `App.jsx` (PUBLIC,
> self-contained, dark-aware, Landing palette) + a new Cookie Policy (written to the ACTUAL cookie/storage usage —
> one strictly-necessary `httpOnly` session cookie, no trackers → no consent banner). Footer links now point to
> these real URLs (+ Cookie Policy); signup-consent links keep the in-flow modals (deduped to `<LegalSections>`).
> **Also NEW `job-tracker-frontend/vercel.json` SPA rewrite — fixed a LATENT prod bug:** a hard hit/refresh on any
> deep route (`/reset-password` from reset emails, `/job-board`, …) returned a Vercel 404 (no fallback); the
> catch-all `/(.*)`→`/index.html` now makes ALL routes resolve (verified live: those + the 3 legal pages all 200,
> `/privacy` renders fully). Real `/assets/*` keep filesystem precedence. Do NOT delete `vercel.json`._
>
> _**2026-09 addendum #32 — Remaining audit items: socket throttle, body-size, hardcoded-secret removal, panel
> a11y (LATEST; dev-history §58; `64da8e6`; `npm test` 192; build clean).** The code-doable remainder of §56's
> deferred list. **`socketServer.js`:** the realtime `send_message` path was UNBOUNDED — added a per-socket
> sliding-window throttle (`SEND_MAX` 20 / `SEND_WINDOW_MS` 10s, env-tunable) + a `MAX_MESSAGE_CHARS` 4000 cap +
> a `data || {}` empty/malformed guard (persist the trimmed `text`). **Removed TWO hardcoded secrets:** the leaked
> `GOOGLE_CLIENT_SECRET` fallback (`authRoutes.js`) + the socket `'fallback_secret_key'` JWT fallback
> (`socketServer.js` — a public key could forge a socket identity); env-only now (`JWT_SECRET` required app-wide,
> fails safe). **`server.js`:** `express.json`/`urlencoded` `50mb`→`15mb` (`BODY_LIMIT`; largest legit JSON body ≈
> 6.7MB base64 — cert/apply-résumé ≤5MB or event banner ≤3MB; FILE uploads use multer, not this). **WCAG:** the
> vacancy-detail slide-over (`PublicJobBoard.jsx`) got `role="dialog"`/`aria-modal`/`aria-label` + Escape-to-close.
> **Operational remainder → `docs/compliance-and-security-runbook.md`:** the leaked secrets must be ROTATED in the
> Google/Render/Cloudflare consoles (removed from source, still in git history), + NPC registration, a concrete
> retention period, and DPO/counsel sign-off on the legal wording — all owned by the LGU, not code. A FULL WCAG
> 2.1 AA pass is still a dedicated follow-up._
>
> _**2026-09 addendum #33 — Automation n8n → Make.com migration: proposal + Option 2 (LATEST; dev-history §59;
> `bed7af8`/`e24d55a`; `npm test` 192; build clean).** Owner wants to retire self-hosted n8n for Make.com
> (no n8n-Cloud budget), one-for-one. AUDIT: **n8n is a SINGLE downstream webhook** — the referral pipeline's
> `dispatch_n8n` step (`referral.completed` → Google Sheet log + employer notify); the backend ALREADY has retry
> caps/backoff/dead-letter-skip/replay/graceful-degradation (invariant 0.10). Deliverables: proposal
> `docs/automation-and-backend-architecture-proposal.md` (migrate the one scenario; keep the modular monolith on
> Free tier; extract the `WORKER_MODE` worker process only when profiled + paid) + click-by-click Make build guide
> `docs/make-com-migration-guide.md` (webhook → Data-Store idempotency → Sheets add [7 cols] → employer email →
> mark-processed → 200; grounded in `My workflow 2.json`; notes n8n `$json.body.*`→Make top-level `{{1.…}}` and
> that the n8n email node currently hardcodes the recipient to the OWNER's address). **Option 2 SHIPPED:** the
> dispatch reads provider-neutral **`AUTOMATION_WEBHOOK_URL`** (fallback `N8N_WEBHOOK_URL`; timeout
> `AUTOMATION_DISPATCH_TIMEOUT_MS`) — `referralWorker.js` + `referralService.js`; UI relabeled n8n→Make.com
> (`WorkflowAutomation.jsx`, `FailedReferralsPanel.jsx`); **internal `dispatch_n8n`/`N8N_DISPATCHED`/`N8N_DISPATCH_SKIPPED`
> identifiers KEPT** (persisted — renaming orphans rows/history). Cutover = set `AUTOMATION_WEBHOOK_URL` to the Make
> URL on Render (owner builds the scenario). `My workflow 2.json` is an untracked reference in the repo root._
>
> _**2026-09-14 addendum #34 — §60→§63 catch-up: refinement passes + motion/discovery UI (dev-history §60–§63;
> migrations applied through 051; `npm test` 210).** Five phases since §59, all owner-verified/pushed. **§60**
> (`efa9f2b`+`b5a644e`, mig 050) coordinated refinement: shared **Motion** config (`config/motion.js`,
> `framer-motion` now used), Events skeletons + `AnimatePresence`, seeker **referral automation**
> (`referral_preferences` manual|auto_accept|auto_decline, enforced FAIL-SAFE in `referralService.approveReferral`),
> **Messages Hub** (sidebar "Communications"→"Messages"; `conversation_states` mute/pin≤5/manual-unread + batch
> endpoints, 5-pin cap server-side), and the **org PESO logo** via `Avatar.isOrgAccount`. **§61**
> (`83a3b86`…`0cce505`, mig 051) employer email + Messages **429 loop fix** (history effect keyed on
> `activeConv?.id` + `AbortController`) + Make.com cutover finalized + Landing event motion + analytics tooltip
> filter. **§62** (`6872108`) AI Compatibility **synchronized 0→score reveal** (`AnimatedScore`, one rAF value
> drives number+bar, mount-triggered). **§63** (`53b3c53`/`73c2cae`/`ae4f07f`/`eb67857`/`4e4e362`, frontend-only,
> NO migration) analytics tooltip motion (dropdown language, no slide-from-left; `isAnimationActive={false}` +
> per-point-keyed `.chart-tooltip-in`) + a shared repeatable **scroll-reveal** `components/common/Reveal.jsx` (one
> IO per root — viewport singleton + `WeakMap` of container observers; toggles `.reveal-in` on enter/exit with
> `[0,0.15]` hysteresis, no state/remount; `root` ref = viewport for Board/Admin, panel for Landing) + the Landing
> posted-jobs as a **self-contained scroll panel** (`max-h-[min(720px,72vh)]` overflow-y-auto custom-scrollbar,
> `useJobFilters`-driven, bespoke `LandingCategorySelector` + `LandingJobModal`, first-job auto-open removed;
> Landing still NOT tokenized §24/§53). See SKILL.md dev-history §60–§63 + still-live rules._
>
> _**2026-09-14 addendum #35 — Landing job search relocated into the board section (dev-history §64; `001cc07`,
> frontend-only, NO migration; `npm test` 210).** IA follow-up to §63: the Landing search moved OUT of the hero
> (now two CTAs — Explore Local Jobs → `#jobs`, Events & Job Fairs → `#events`) into a new **`LandingJobSearch`**
> module at the top of the "Local Employment Board" section — keyword + location inputs (leading icon, per-field
> clear `×`, `sr-only` labels, focus ring) + a Clear-all reset, `role="search"`, bound to `jf.state`/`jf.set`
> (the SAME `useJobFilters` — no second search). Section flow is now Search → category Controls → Results
> Count/State (`aria-live`: "N vacancies available" / "Showing K of N vacancies for '…'") → Matching Results
> (the §63 panel); empty state gains a "Clear filters" reset; results update live, no navigation.
> `LandingCategorySelector` gained an optional `className`. See SKILL.md dev-history §64 + the §64 still-live rule._
>
> _**▶ NEXT SESSION STARTS HERE (2026-09):** HEAD is at the tip of `main` (the §64 Landing-search-relocation commit
> `001cc07`; newest work = §60→§64, addenda #34–#35 just above — §63 = analytics tooltip motion + the shared
> repeatable `Reveal` scroll-reveal + the Landing self-contained job-discovery panel; §64 = the Landing search
> moved into the board section as a contextual module), migrations applied through **051**,
> `npm test` **210**; all PUSHED, tree clean except the intentionally-untracked `job-tracker-frontend/.env`. Older
> pointer text below is retained for the §55–§59 chain. (the §59 docs commit — §59 = the
> n8n→Make.com automation migration proposal + Option 2 provider-neutral `AUTOMATION_WEBHOOK_URL`; earlier §58 = the
> audit-remainder code pass: socket throttle, body-size 15mb, hardcoded-secret removal, vacancy-panel a11y; its
> operational remainder — secret rotation, NPC registration, retention period, DPO sign-off — is in
> `docs/compliance-and-security-runbook.md`), all
> PUSHED, working tree clean except the intentionally-untracked `job-tracker-frontend/.env` (and the two
> untracked reference CSVs `Resume_datasets.csv` / `job_past_applicatons_datasets.csv`, NOT the feature schema —
> see §49). Migrations applied through **049**. Backend dep **`mammoth`** (Render `npm install`s on deploy).
> `npm test` **192**. Nothing is mid-flight; the root-to-top audit is COMPLETE (§35–§38), and the **newest work
> is §59** — the automation **n8n → Make.com migration** (`bed7af8` proposal + `e24d55a` Option 2): n8n is ONE
> downstream webhook (referral `dispatch_n8n`); shipped a provider-neutral **`AUTOMATION_WEBHOOK_URL`** (fallback
> `N8N_WEBHOOK_URL`) + UI relabel (internal identifiers kept), a proposal, and a click-by-click Make build guide
> (see §59 still-live rule). Cutover = point `AUTOMATION_WEBHOOK_URL` at the Make webhook on Render. Prior §58 =
> the code-doable remainder of §56's audit (`64da8e6`): a per-socket `send_message` throttle + content
> cap (`socketServer.js`), removal of the hardcoded `GOOGLE_CLIENT_SECRET` + socket JWT fallbacks (env-only),
> `express.json` `50mb`→`15mb` (`BODY_LIMIT`), and vacancy-panel dialog semantics + Escape (see §58 still-live
> rule). Its operational remainder (rotate the leaked secrets, NPC registration, retention period, DPO sign-off)
> is in `docs/compliance-and-security-runbook.md`. Prior §57 = standalone legal pages + SPA deep-link fix
> (`fa5d2f6`, frontend-only): `/privacy`·`/terms`·`/cookies` routed pages backed by a shared
> `components/legal/legalContent.jsx` (ONE source, modals + pages both render it), plus a `vercel.json` SPA
> rewrite that also FIXED a latent prod 404 on every deep route (`/reset-password`, `/job-board`, …) — verified
> live (§57.1 also verified the reset-password link end-to-end + a 500→400 fix). Prior §56 = a verify-before-change system audit
> (`4ffb377`): app-wide `helmet` + a shared `middleware/rateLimiters.js` (global `/api` backstop + tight
> `aiLimiter`/`applyLimiter`/`writeLimiter` on the previously-unprotected AI-cost endpoints), a 60s frontend axios
> timeout, and Privacy Policy accuracy fixes (see §56 still-live rule + report `docs/system-audit-2026-09.md`;
> existing AI-timeout/worker/limiter controls were verified + kept). Prior §55 =
> the Job Seeker vacancy-detail side panel redesign (`650abfc`, frontend-only): the Public Job Board posted-vacancy
> slide-over restructured around a scannable key-facts strip (`DetailFact`) + status pill + posting age; layout
> only, all handlers/AI/apply untouched (see §55 still-live rule).
> Prior §54 = UI/UX optimization pass (`ccbfc5e`): the Landing Events section blank-render fix (a scroll-reveal
> observer-deps race — see §54A + the verify caveat above), a banner-failure gradient fallback, the Landing now
> showing ALL published events (upcoming-first ordering; `scope='upcoming'` kept for the chatbot), authed-chatbot
> render parity, and role-aware TopHeader Profile routing. Prior §53 = Landing light/dark toggle (reuses
> ThemeContext, SUPERSEDES §24 "always-light" but do NOT tokenize the Landing); §52 = chatbot UI unification;
> §51 = event-edit banner/date fix; §50/§50.1 = the Public Visitor-Support Chatbot (Phases A–E) + `trust proxy`,
> SEPARATE from the authed chatbot. (§43 = onboarding gate; §44 = export parity; §45–§48 = Landing/Dashboard UX;
> §49 = data-processing refactor.) Nothing flagged is outstanding.
> **Documented Future roadmap remains:** production Semaphore (unfunded — §6a; dev uses
> `SMS_PROVIDER=console` or `textbee`), pre-public security rotation (`GOOGLE_CLIENT_SECRET` fallback + `.env`
> in git history) + email domain auth, the infra/worker-split roadmap (SKILL §25), Tier-2 scale anchors, and
> the dev/prod DB split. See memory `2026-08-02-stop-point` + `standing-reminders-deferred-work`._

> ## ▶ HOW TO RESUME IN A NEW SESSION
> Ask: **"load the local SKILL.md and its related documentation."** That means
> `.claude/skills/peso-kabankalan-ai-system-architect/SKILL.md` **plus** the `docs/*.md`
> in the cross-reference map (§9) — including `references/development-history.md` (SKILL §17 onward,
> split out 2026-08-05; currently through **§64**). **Read THIS file's NEWEST addendum (currently
> #35 = §64 Landing search relocation; #34 = §60→§63, the refinement/motion/discovery series) + SKILL.md §0–§16 (incl. the always-loaded dev-history
> index + still-live rules at the end) + the history doc's recent sections (currently §31–§63) first** — they carry the full
> context of everything below, so you can resume immediately without restating work. The history doc grows;
> always read from its newest section back, not a fixed range.

This is the authoritative stop-point for the whole 2026-08-02 development cycle. It supersedes
the earlier deployment-only draft of this file.

---

## 1. Local source is authoritative + fully synchronized (verified)
- `HEAD == origin/main == adf64d3`; `git log origin/main..HEAD` is empty (nothing unpushed).
- Working tree clean except the local `.env` (env config, not code — correctly untracked in spirit).
- **Migrations on disk through `034`** (`032_proactive_referrals`, `033_job_applications_unique`, `034_saved_jobs_snapshot`),
  both **applied** to prod TiDB via `npm run migrate`.
- **Tests green** — `npm test` = 24 (`node --test`, source-only, AI mocked, never `require('../db')`).
- Deployment carries no code the local repo lacks. The only prod-only state is **env vars**
  (Render/Vercel dashboards) and **DNS** — documented in §5.

## 2. Deployment topology (live)
- **Frontend:** Vercel — `https://peso-kabankalan.vercel.app`.
- **Backend:** Render — `https://peso-kabankalan-backend.onrender.com` (free tier: hibernates
  when idle; blocks outbound SMTP → HTTP email; injects `PORT`).
- **DB:** one **TiDB Serverless**, shared by local dev AND prod (no separate dev DB).
- Cross-origin, wired entirely through env vars (§5). Verified: backend returns
  `access-control-allow-origin: https://peso-kabankalan.vercel.app`.

## 3. What this cycle delivered (all committed + pushed)
Grouped by theme; each row cross-references the authoritative doc/section.

### 3A. Deployment + production hardening + HTTP email — SKILL §19, `resilience-hardening.md`
| Commit | Change |
|---|---|
| `baccd03` | Hybrid Socket.IO + slow-poll (90s) refresh for the Applicant Pipeline (§18.9, `applicant-pipeline-polling.md`) |
| `ed83c4b`·`9fdd9f8`·`e0a80e2` | Env-driven **socket URL / CORS / Google-OAuth URL** (`VITE_API_URL`, `FRONTEND_URL`) — cross-origin enablers |
| `c02cfc8`·`9098958` | Rebrand "Hi-Re" → "PESO Kabankalan"; GitHub repo rename references |
| `ad0331a`·`f385450`·`93d65da` | **HTTP email** providers (Brevo primary + Resend) — Render blocks SMTP (§19.3) |

### 3B. Proactive AI Referral Workflow (P1–P4) — SKILL §20, `proactive-ai-referral-plan.md`
| Commit | Change |
|---|---|
| `0128cc8` | Migration `032`; matcher (`proactiveReferralWorker`) + Smart Referral Queue schema (dark) |
| `808abd1` | Smart Referral Queue UI + **promote → materialize application → `approveReferral`** (compensating txn) |
| `f481452` | Seeker-facing distinction (origin-aware notification + email + "Referred by PESO" badge) |
| `15d087e` | Hardening: migration `033` guarded `UNIQUE`, seeker-edit re-match sub-flag, Super-Admin monitor |
| `4116ea1`·`30ce0c5` | Fixes: `latestResumeSnapshot` order-by; monitor counts only actionable candidates |

### 3C. AI Compatibility scoring — SKILL §7.4 + §21, `scripts/eval-scoring.js`
| Commit | Change |
|---|---|
| `c200944` | Public board shows the **numeric `overall` %** as primary (band label secondary + progress bar) |
| `653d0ce`·`07e0438`·`c403452` | **Eval harness** (`npm run eval:scoring`) + fixtures + `board`/`baseline`/`recalibrated` variants |
| `8c935f0`·`30ce0c5` | **Tier-1 recalibration**: unify board+apply prompt, feed job skills/qualifications, temp 0 + JSON mode; relabel one fixture |

### 3D. Performance audit (P0 + P1 first pass) — SKILL §22, `middleware/requestTiming.js`
| Commit | Change |
|---|---|
| `a9f77d6` | Async apply-time scoring, board `/match` cache, `initDB` cold-start skip, **timing middleware + `GET /admin/timing`** |
| `adf64d3` | Killed per-request DDL on `GET /api/profile` (**3.5s→350ms**), cached `/jobs/:id/similar` + `/job-board/stats` |

### 3E. Post-stop-point work (2026-08-03) — SKILL §22.7, §23
| Commit | Change |
|---|---|
| `f5d31a6` | **Performance-P1 cleanup** (low-ROI tail): `/job-board` list explicit columns (dropped 2 detail-only LONGTEXT), `/match` double-résumé-fetch removed (optional `resumeText` + cache-check-first), frontend `globalUpdateTrigger` split into `messageUpdateTrigger`/`applicationUpdateTrigger`, dead public `/job-board/:id/similar` (fabricated Math.random match %) removed. Build + 24/24 tests. |
| `9c9d42c` | **Saved Vacancies → lightweight bookmark manager** (migration **034**). Removed the redundant `POST /jobs/match` AI call + duplicate detail drawer; an ACTIVE saved job now deep-links to `/job-board?job=<id>` (board = single source of truth for details/AI/apply), and closed/filled/expired/removed jobs show an in-place tombstone. `GET /saved-jobs` switched INNER→LEFT JOIN so admin-hard-deleted vacancies surface as tombstones (via migration-034 `saved_jobs` snapshot columns) instead of vanishing; minimal columns; `last_checked_at`. Single-item Remove now soft-deletes (Trash) for consistency. `PublicJobBoard` gained `?job=`/`?category=` deep-link support. Enhancements: status badges, status tabs w/ counts, Browse Similar, last-checked. **User-verified in UI** (deep-link + tombstones). Full detail: SKILL §23. |

### 3F. Theme system — centralized design tokens + full app migration (2026-08-03) — SKILL §24
**Phase 1** (`2a9d741`): centralized CSS-variable design tokens in `index.css` mapped in
`tailwind.config` (`bg-surface/base/raised/sunken`, `text-content/muted/subtle`, `border-line`,
`text-accent-text`, `bg-accent`, shadows) that flip under `.dark`; a redesigned charcoal/slate
DARK palette (no pure black, off-white text, softened borders); a single `ThemeContext`
(covers seeker, PESO-admin AND Super Admin — fixed the Super-Admin gap) mounted in `main.jsx`;
theme toggle **relocated from the sidebar to the TopHeader** (+ sidebar mobile bar + Super-Admin
sidebar footer); a **premium switch** (View-Transitions circular reveal → 260ms cross-fade
fallback, animated sun↔moon, instant under reduced-motion); pre-paint script kills FOUC.
**Phase 2** — a UI/UX consistency AUDIT found the "uniform black interactive text" was a
half-migrated palette (near-black legacy greens `#1a4a38`/`#003631` used as interactive text),
NOT a broken token layer. Fix = migrate every app surface onto tokens, done in 8 batches
(`63e9441` → `d9e4daa`). **Whole application shell now token-driven; ZERO non-intentional
gray/legacy-green remain.** §24.1 interaction-state standard is now a MANDATORY review gate.
Brand surfaces `Chatbot`/`ChatWidget` also migrated (`f907a0b`). `LandingPage` was tokenized
(`96b37b8`) then **REVERTED** (`f5e70bf`) — the token accent flattened its bespoke marketing palette
to dull monochrome (owner confirmed on the deploy). **TWO files stay excluded:** `GebbieMascot`
(mascot artwork) and `LandingPage` (bespoke marketing page — tokenization tried & rejected, do not repeat). |

### 3G. Theme-fix + LandingPage pass + logo (2026-08-03, deploy-verified) — SKILL §24
| Commit | Change |
|---|---|
| `55781ce` | **CRITICAL token fix:** renamed colour token `base` → `canvas`. A `base` colour made Tailwind emit a `text-base` COLOUR utility that collided with the built-in `text-base` FONT-SIZE, silently painting `text-base` elements the surface colour (invisible). This is what made the LandingPage tagline + FAQ unreadable; latent app-wide. `bg-base`→`bg-canvas` (10 spots). **NEVER name a token after a core utility** (§24). |
| `97f080b` | **LandingPage: Visit Our Office** section (static map preview + Get-Directions/Open-in-Maps/Message-Us to Google Maps coords `10.008007,122.803436`, NO embedded tiles → perf-safe; nav + footer links). **Job-card readability:** white title/company scrim strengthened (`from-black/85 via-black/45` + drop-shadow) so it's WCAG-readable over any featured image, at rest. LandingPage is self-contained light (`bg-[#f8f9ff]`), so it renders correctly in both themes. |
| `1664ce6`·`2319d71` | **Logo refresh:** replaced `src/assets/PESO LOGO.jpg` with the new official seal, then downscaled 193KB→**25.6KB** (247×256, q85). Same filename → no import changes (Sidebar + LandingPage); Vite re-hashes. Do NOT re-add a `NEW PESO LOGO.jpg`. Referral-letter letterhead (`assets/letterhead/letterhead.png`) is separate + unaffected. |

### 3H. 2026-08-04 — P1 tail, scoring dirty-check, profile-hang fix, infra roadmap+prep (deploy-verified) — SKILL §18.5, §22.7, §25
| Commit | Change |
|---|---|
| `a35bbf6`·`f16bd99` | **Performance-P1 CLOSED.** Confirmed chart bundles ARE route-lazy (recharts in its own ~384KB lazy chunk, not the entry); removed DEAD `DynamicAnalytics.jsx` + 3 unused chart libs (apexcharts/react-apexcharts/chart.js/react-chartjs-2 — recharts is the only live one); login `SELECT *`→explicit columns. `/auth/login` ~2.3s is cold-start+bcrypt, NOT code. **No P1 code remains.** |
| `2464403`·`b040c3a` | **Scoring re-score audit + dirty-check.** The subsystem is sound (event-driven, deduped via UNIQUE `application_id`, ~90s debounce, atomic claim); "bulk" = the editing seeker's OWN N active apps, NOT a global re-eval. Fix: profile save no longer re-scores (scorer reads only résumé `parsed_text`+certs+job, never `users` fields); résumé builder/upload now content-checked (skip if `parsed_text` unchanged). |
| `26dfbda` | **Save-Profile hang FIXED** (regression from `2464403`): the re-score cleanup had also deleted the handler's `res.status(200).json(...)` success line, so a successful `PUT /profile` never responded → infinite spinner. Restored the 200; added `timeout:30000` to the Profile.jsx save call as a belt-and-suspenders. |
| `e5cb3a7`·`0f7a1a3`·`e61b360` | **Infrastructure Optimization roadmap (SKILL §25)** — deferred but APPROVED, on the active roadmap. **Worker-split CODE PREPPED ($0):** `startWorkers.js` (shared wiring), `worker.js` (headless entrypoint, `npm run worker`), `WORKER_MODE` gate in `server.js` — today's single-service deploy UNCHANGED (flag unset). Cost table w/ owner's real numbers: Starter web $7 · dedicated worker +$7 · Redis Essentials ~$8 · horizontal scaling per-instance (NOT included w/ Starter). Owner postponing paid infra ~1 week; SOFTWARE FIRST. |

## 4. Verified working functionality
- **Proactive referral** end-to-end (user-validated): match → Smart Referral Queue → admin **Refer**
  → materialized application + résumé snapshot → vacancy-capped referral + letter → seeker gets a
  *distinct* notification/email → employer letter → dashboard badge + audit trail.
- **Scoring recalibration** measured via the eval harness: `recalibrated` MAE **4.7 → 3.6**, band
  accuracy **100%**, 0 false pos/neg; board prompt gap (71%→86%) closed by unification.
- **Performance** measured via `/admin/timing`: `GET /api/profile` **3618ms → 350ms**; stats/similar/
  match caches confirmed (fast repeat hits; ~2s p95 tails are cache-miss AI calls, cached after).
- Email delivers on Render via the HTTP provider (password-reset validated).
- Real-time pipeline: `scores_updated` socket + 90s backstop poll; `APPLICATION_SCORING_ENABLED=true`.
- **Theme system (owner-verified on deploy):** toggle in the TopHeader works across seeker/PESO-admin/
  Super-Admin; dark palette readable; the `text-base` collision fix confirmed (LandingPage tagline +
  FAQ now readable in both themes). **Saved Vacancies** bookmark refactor verified (deep-link +
  tombstones). **LandingPage** Visit-Our-Office section + job-card readability shipped.

## 5. Required env (per platform; all optional have safe defaults)
**Render (backend):** `FRONTEND_URL=https://peso-kabankalan.vercel.app`, `APPLICATION_SCORING_ENABLED=true`,
`PROACTIVE_REFERRALS_ENABLED=true`, `PROACTIVE_REMATCH_ON_EDIT=true`,
`GOOGLE_REDIRECT_URI=…/api/auth/google/callback`, `BREVO_API_KEY` (+ `BREVO_FROM_EMAIL` verified sender),
`RESEND_API_KEY`, DB_*/JWT/AI keys. **Never set `PORT`; scrub trailing spaces** (`true ` disables a flag).
Perf knobs (defaults fine): `DB_INIT_ON_BOOT` (off), `MATCH_CACHE_TTL_MS`, `SIMILAR_CACHE_TTL_MS`,
`STATS_CACHE_TTL_MS`, `SLOW_REQUEST_MS`, `SCORING_*`, `PROACTIVE_*`.
**Vercel (frontend):** `VITE_API_URL=https://peso-kabankalan-backend.onrender.com/api`, `VITE_PIPELINE_POLL_MS` (90000).

## 6. Roadmap — Phase 1 / 2 / 3

### ✅ Phase 1 — COMPLETED, tested, validated (this cycle + prior)
Deployment cutover (Vercel + Render, cross-origin, HTTP email); hybrid real-time pipeline;
numeric board score; **AI scoring Tier-1 recalibration + eval harness**; **Proactive AI Referral
Workflow (P1–P4)**; **Performance audit P0 + P1 first pass** (profile DDL, caches, async apply,
timing). All behind flags where noted; all measured.

### 🟡 Phase 2 — APPROVED / PENDING (planned, not yet built)
1. **Production email domain auth** — buy a domain, verify (Brevo/Resend), SPF/DKIM/DMARC + branded
   `no-reply@domain`. **Env + DNS only, no code.** *Depends on: a purchased domain.*
2. ~~**Performance P1 remaining**~~ **MOSTLY DONE (2026-08-02):** `/job-board` list now selects
   explicit columns (dropped the two detail-only LONGTEXT fields; `admin/*` used no `SELECT *`);
   `/match`'s double `getApplicantResume` removed (optional `resumeText` + cache-check-first); the
   frontend `globalUpdateTrigger` split into `messageUpdateTrigger`/`applicationUpdateTrigger`; and the
   dead fabricated-score public `/job-board/:id/similar` removed. Build + 24/24 tests green (SKILL §22.7).
   *Still open (low ROI): confirm chart bundles are route-lazy; login bcrypt ~2.3s — only if `/admin/timing` flags them.*
3. ~~**Proactive C.2** — certificate library re-select in the Apply Wizard.~~ **DONE (verified
   in code 2026-08-02)** — full CRUD + owner-scoped streaming at `/profile/certificates`
   (`certificatesRepository`), `CertificateLibrary.jsx` mounted as Profile → Portfolio, and the
   Apply Wizard "From your library" picker snapshots picks as `user_certificate_id` on submit
   (`ApplyWizard.jsx`). Nothing left to build; a manual re-select smoke test is all that remains.
4. **AI scoring Tier-2 (scale anchors)** — spread the top end (strong matches anchor at ~85). Deferred:
   only if real labelled cases prove a systematic miss (SKILL §21). *Depends on: real eval fixtures.*
5. **Security rotation before public** — remove hardcoded `GOOGLE_CLIENT_SECRET` fallback
   (`authRoutes.js:71`), rotate `.env` secrets in git history. *Open background task.*

### 🔵 Phase 3 — Infrastructure Optimization (DEFERRED but APPROVED, 2026-08-04) — full detail + cost table in **SKILL §25**
Order: software first (DONE — P0/P1 + scoring dirty-check) → cheapest-highest-ROI hardware → scale-out only when `/admin/timing` under real concurrency proves need. Cost (verify live Render pricing): Starter web **$7/mo**, dedicated worker **+$7/mo**, Redis **$0–10/mo** (free tier to start).
1. **Render Starter upgrade evaluation** — highest ROI/$ (kills cold starts + 5× vCPU, no code). **User postponing ~1 week (budget)**; software stays the priority meanwhile.
2. **Worker parallelization** — move AI-heavy workers (scoring, jobMatch, proactive) to a 2nd Render
   service. Workers are already run-anywhere (§7.5) → deploy/wiring change, NOT a rewrite.
   **Incremental without Redis is possible** (worker→client real-time nudges degrade to the existing
   90s poll backstops until Redis lands; correctness unaffected). *Do before more hardware.*
3. **Redis** — shared cache + Socket.IO adapter, add AFTER the worker split (restores worker→client
   real-time + enables multi-instance). *Depends on: #2 / scale.*
4. **Horizontal worker scaling** — multiple worker instances draining the same outbox (atomic claim
   already makes it safe; needs Redis). Only when one worker can't keep up.
5. **Long-term infra roadmap** — dyno sizing review, separate dev/prod DB (still shared prod TiDB),
   CDN/asset tuning, cost review as traffic grows.
4. **Separate dev/prod DB** — local currently shares prod TiDB (declined this cycle). Recommended
   before heavier feature work.
5. **Socket-health surface** (worker→admin), **AI-Recommended threshold instrumentation** (SKILL §14),
   **Reports/Analytics server-side pagination** (SKILL §18.8).

**Phase dependencies:** Phase 2 items are independent of each other except Tier-2 (needs real fixtures).
Phase 3 #2 depends on #1; #3 depends on #1–#2 being exhausted.

## 7. Outstanding issues · risks · technical debt
- **SECURITY (highest):** hardcoded `GOOGLE_CLIENT_SECRET` fallback in `authRoutes.js:71` + `.env` in
  git history — rotate before the repo goes public. *Open task chip.*
- **Login ~2.3s** — bcrypt-12 on Render's free CPU (not an architectural fix; leave rounds at 12).
- **AI first-open latency** (~2s on cache miss for `/match` and `/similar`) — inherent to DeepSeek;
  cached after first open; correct as-is.
- **Cache staleness** — board match/similar caches are in-process, TTL-bounded (~10m); a résumé edit
  isn't reflected in the board *preview* until the TTL lapses (apply-time/pipeline scores unaffected).
- **`db.js initDB()`** — legacy, now skipped by default (`DB_INIT_ON_BOOT`); still "pending retirement".
- **Inline schema DDL in handlers** — removed from profile GET; a few other handlers still do smaller
  versions (grep `ALTER TABLE`/`CREATE TABLE` in `routes/` if an endpoint shows slow).
- **No separate dev DB** — never run write-path tests against prod TiDB (SKILL §13).

## 8. Validation & testing status
- `npm test` = **24 passing** (`node --test`): delivery-state buckets, application-scoring column
  drift, job-alerts guards, proactive (column/eligibility/dedup/upsert/UNIQUE/counts), scoring-prompt
  (skills/qualifications, temp 0 + JSON, board unify, markScored COALESCE), ttlCache. **AI always mocked.**
- Frontend `npm run build` clean. `node --check` clean on edited backend files.
- Eval harness (`npm run eval:scoring [--variant=baseline|board|recalibrated] [--mock]`) for scoring
  before/after; `/admin/timing` (Super Admin, `?reset=1`) for latency before/after.
- **Prod-safe rule:** read-only probes + rolled-back txns only; never a write path against prod TiDB.

## 9. Cross-reference map (the connected knowledge base)
| Topic | Authoritative source |
|---|---|
| Architecture, invariants, conventions (core) | `SKILL.md` §0–§16 (always-loaded core) |
| Development history — dated phase records §17 onward (currently through §44) | `.claude/skills/peso-kabankalan-ai-system-architect/references/development-history.md` (split from SKILL.md 2026-08-05) |
| Deployment topology + HTTP email | `SKILL.md` §19 · `docs/resilience-hardening.md` |
| Proactive AI Referral Workflow | `SKILL.md` §20 · `docs/proactive-ai-referral-plan.md` |
| AI compatibility scoring + Tier-1 recalibration | `SKILL.md` §7.4 + §21 · `scripts/eval-scoring.js`, `scripts/eval-fixtures.json` |
| Hybrid real-time pipeline (Socket.IO + poll) | `SKILL.md` §18.9 · `docs/applicant-pipeline-polling.md` |
| Performance audit (P0/P1) + roadmap | `SKILL.md` §22 · `middleware/requestTiming.js` (`GET /admin/timing`) |
| Email outbox (Phase 2C) | `docs/phase-2c-email-outbox-plan.md` |
| AI enhancements (Phase 2D: A–D) | `docs/phase-2d-ai-enhancements-plan.md` |
| Saved Vacancies bookmark refactor (migration 034) | `SKILL.md` §23 |
| Theme system (design tokens, `base`→`canvas` gotcha, exclusions) | `SKILL.md` §24 |
| AI re-scoring pipeline (triggers, dirty-check, profile-doesn't-score) | `SKILL.md` §18.5 · `services/applicationScoringWorker.js` |
| AI re-score change-detection input-hash guard (both workers, ship-dark, migs 038/039) | dev-history `§29` · `services/aiScoringService.js` (`computeScoringSignature`) |
| Document Builder platform (unified framework + template gallery + live react-pdf preview) | `docs/document-builder-platform-plan.md` (planning; §12 = Resume→scoring sync constraint) |
| Infrastructure Optimization roadmap (worker split, Redis, costs) | `SKILL.md` §25 · `startWorkers.js` + `worker.js` (prepped) |
| Referral Lifecycle Synchronization (outcome sync, seeker suggestions, PESO pipeline, R1 redesign, real-time hardening) | `SKILL.md` §26 · `docs/referral-lifecycle-sync-plan.md` |
| AI processing workflow (log guide, debounce/dedupe, optimizations) | `SKILL.md` §26.5 · `docs/ai-processing-workflow.md` |
| AI re-score change-detection input-hash guard (both workers, ship-dark) | development-history **§29** · migrations 038/039 |
| Unified Document Builder (framework, react-pdf preview/export, DOCX, gallery, nav) + cover-letter draft & resignation-AI fixes | SKILL.md **§7.6** · development-history **§30** · UI addendum **§16** · `docs/document-builder-platform-plan.md` · `services/letterBodyService.js` |
| Office-interview requirements — Phases 1–6 impact analysis + phased roadmap | `SKILL.md` §31 · `docs/office-interview-requirements-analysis.md` |
| PESO Staff / Co-Worker RBAC (`peso_staff`, deny-by-default, `effectiveOwnerId`) | dev-history **§31.3** · `middleware/rbac.js` (`requirePermission`) |
| Events / Announcements subsystem (`peso_events`, `EVENT_ANNOUNCEMENT`) | dev-history **§31.4** · `routes/eventRoutes.js` · `repositories/eventRepository.js` |
| Referral seeker-acceptance (#6) + vacancy de-automation (#11b) | dev-history **§31.5** · flags `referral_acceptance_enabled` / `vacancy_manual_fill_enabled` |
| Walk-In Job Seeker registration (#7) | dev-history **§31.7** · `services/walkInService.js` · flag `walk_in_registration_enabled` |
| SMS notification channel — evaluation + provider abstraction (#8, ship-dark) | dev-history **§31.8** · `docs/sms-notification-proposal.md` · `services/smsService.js` |
| Root-to-top engineering + UX AUDIT (P0..Future matrix) + increments | `docs/system-audit-2026-08-24.md` · dev-history **§35–§38** |
| AI-score provenance (F1) + reproducibility boundary (F3) | dev-history **§35** · `services/aiScoringService.js` (`chatDetailed`) · `docs/system-guide.md` §5 |
| Scoring divergence lifecycle (board preview vs committed) + board-cache invalidation | dev-history **§36.3** · `services/matchScoreCache.js` · `routes/jobRoutes.js` (`/match`) |
| Decision notifications + 'Not Referred' state (G3.1/G3.2) | dev-history **§36.1–§36.2** · `services/referralService.js` (`rejectReferral`/`voidReferral`) · `hooks/useUnifiedApplications.js` |
| Modal focus-trap (C1) | dev-history **§35.5/§35.6** · `src/hooks/useFocusTrap.js` |
| DOLE PESO Accomplishment Report (aggregate + demographic + PDF/CSV) | dev-history **§39** · `services/reportingService.js` · `repositories/reportingRepository.js` · `components/common/AccomplishmentReport.jsx` |
| Requirement-only AI scoring + certificate-scoring removal | dev-history **§40** · `services/aiScoringService.js` (`buildScoringPrompt`) · `scripts/eval-scoring.js` (`requirement-strict` variant) |
| Cloud/object storage — Cloudflare R2 for job images (env-aware `storageService`, ACTIVATED in prod) | dev-history **§41** · `services/storageService.js` · `docs/cloud-storage-proposal.md` (decision) · `docs/cloudflare-r2-setup.md` (activation guide) |
| Layout-preserving card skeletons + job-update worker-trigger precision | dev-history **§42** · UI addendum **§5.5** · `components/Skeleton.jsx` · `routes/pesoAdminRoutes.js` (`PUT /jobs/:id`) |
| Post-registration onboarding + account-completion gate (identity + résumé before Apply) | dev-history **§43**/**§43.6** · `services/onboardingService.js` · `components/onboarding/OnboardingModal.jsx` · `GET /profile/onboarding` |
| PESO Admin export parity (dashboard CSV via shared `computeOverview`) | dev-history **§44** · `routes/pesoAdminRoutes.js` (`computeOverview`, `/analytics/overview` + `/analytics/export`) · `test/dashboardExportParity.test.js` |
| Data-processing modules (Import Past Applications + Analyze My Resume, Phases A–D) — deterministic import into `usertrackedjobs` + hardened résumé pipeline; **§49.5 integration invariant: imported records flow through `GET /api/applications/unified`, NO parallel store** | dev-history **§49** · `docs/data-processing-modules-proposal.md` · `services/importService.js` · `services/resumeText.js` · `services/resumeAnalyzer.js` · `components/dataflow/ProcessingModal.jsx` · mig `049_import_batches.sql` |
| Public Visitor-Support Chatbot (Landing Page, unauthenticated) — SEPARATE from the authed chatbot; DeepSeek tool calling via `aiClient.chatRaw`; public-safe tools; server-derived nav; IP rate limits; no chat persistence | dev-history **§50** · `docs/public-visitor-chatbot-proposal.md` · `routes/publicAssistantRoutes.js` · `services/publicAssistant/knowledge.js` + `publicData.js` · `services/aiTranslate.js` · `components/PublicChatbot.jsx` · `test/publicAssistant.test.js` |
| Chatbot UI unification — shared `components/chat/` (one launcher + motion + message primitives, `variant` app/landing) across the public + authed chatbots; SEPARATE at the context level | dev-history **§52** · `components/chat/ChatLauncher.jsx` · `chatMotion.js` · `MessageBubble.jsx` · `TypingIndicator.jsx` · `components/Chatbot.jsx` · `components/PublicChatbot.jsx` |
| Landing Page Light/Dark toggle + bespoke dark palette (reuses `ThemeContext`, synced Landing↔app; NOT tokenized — §24 holds; SUPERSEDES the "always-light" stance) | dev-history **§53** · `components/LandingPage.jsx` · `components/common/ThemeToggle.jsx` · `context/ThemeContext.jsx` |
| UI/UX optimization pass — Landing Events blank-section fix (scroll-reveal observer must list `events` in its deps or a late-mounting `.reveal` stays `opacity:0`) + banner `onError` gradient fallback + Landing shows ALL published (upcoming-first `listPublished` 'all' order) + authed-chatbot render parity + role-aware TopHeader Profile | dev-history **§54** · `components/LandingPage.jsx` · `repositories/eventRepository.js` · `components/Chatbot.jsx` · `components/layout/TopHeader.jsx` · `test/eventsSubsystem.test.js` |
| Job Seeker vacancy-detail side panel redesign — scannable key-facts strip (`DetailFact`: Salary/Employment/Location/Positions/Deadline) + status pill + posting age under the title; removed the duplicated sidebar "Application Details" card; layout only (AI/apply/open-flow untouched) | dev-history **§55** · `components/PublicJobBoard.jsx` (`selectedJob` slide-over) · `components/jobs/JobCard.jsx` (double-click `onOpen`) |
| System audit — abuse-protection + AI-cost rate limits + legal/privacy accuracy (verify-before-change; shared `middleware/rateLimiters.js` + global `/api` backstop + `aiLimiter`/`applyLimiter`/`writeLimiter` on the cost endpoints, app-wide `helmet` cross-origin-safe, 60s axios timeout, Privacy Policy subprocessor/cookie accuracy; deferred items documented) | dev-history **§56** · `docs/system-audit-2026-09.md` · `middleware/rateLimiters.js` · `server.js` · `routes/{applicationRoutes,jobRoutes,profileRoutes,messageRoutes}.js` · `job-tracker-frontend/src/api.js` · `components/LandingPage.jsx` (Privacy/Terms modals) |
| Standalone legal pages `/privacy`·`/terms`·`/cookies` + SPA deep-link fix (shared `legalContent.jsx` single source for modals + pages; `vercel.json` rewrite fixed a latent prod 404 on all deep routes incl. `/reset-password`) | dev-history **§57** · `components/legal/legalContent.jsx` · `components/legal/LegalPage.jsx` · `job-tracker-frontend/vercel.json` · `App.jsx` (public routes) · `components/LandingPage.jsx` (deduped modals + footer links) |
| Remaining audit items — socket `send_message` throttle + content cap, removal of hardcoded `GOOGLE_CLIENT_SECRET`/socket-JWT fallbacks, `express.json` 50mb→15mb (`BODY_LIMIT`), vacancy-panel `role=dialog`/`aria-modal`/Escape; operational remainder (secret rotation, NPC registration, retention, DPO sign-off) in the runbook | dev-history **§58** · `socketServer.js` · `routes/authRoutes.js` · `server.js` · `components/PublicJobBoard.jsx` · `docs/compliance-and-security-runbook.md` |
| Automation n8n → Make.com migration — proposal + Option 2 (n8n = ONE downstream webhook; provider-neutral `AUTOMATION_WEBHOOK_URL` fallback `N8N_WEBHOOK_URL`; UI relabel; internal `dispatch_n8n`/`N8N_DISPATCHED` identifiers kept; Make build guide incl. Data-Store idempotency) | dev-history **§59** · `docs/automation-and-backend-architecture-proposal.md` · `docs/make-com-migration-guide.md` · `services/referralWorker.js` · `services/referralService.js` · `superadmin/features/automation/WorkflowAutomation.jsx` · `components/FailedReferralsPanel.jsx` |
| Demonstration / defence reference | `docs/system-guide.md` |
| Pre-public checklist | `docs/pre-public-checklist.md` |
| This stop-point | `docs/session-continuation-2026-08-02.md` (this file) |

## 10. Recommended next-session order + immediate priorities
1. **Load SKILL.md + docs (§9); read this file + SKILL §18–§24** (§23 Saved Vacancies, §24 theme system).
2. If launching: **Phase 2 #1 (email domain auth)** + **#5 (security rotation)** — highest-value pre-public.
3. Else, next best software work: **Phase 3 #1 (separate AI-worker process)** if concurrency is rising
   (drags Redis / roadmap #2 along because of the workers' Socket.IO emits). Phase 2 #3 (certificate
   library UI) is already DONE — see §6 Phase 2 #3.
4. Do **not** pursue hardware (Phase 3 #3) or Performance-P1-remaining until `/admin/timing` under real
   multi-user load proves a specific need. Software wins are substantially exhausted.
5. Set up a **dev/prod DB split** before any heavy schema work.
