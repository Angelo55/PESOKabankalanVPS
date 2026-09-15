# PESO Kabankalan — Office-Interview Requirements: Architecture Impact Analysis & Phased Roadmap

**Status:** ANALYSIS / PLANNING ONLY — no code changed yet.
**Author date:** 2026-08-23.
**Source:** PESO Kabankalan Office interviews (Mr. Tejada — publication staff; Ma'am Elma — PESO Manager).
**Scope guard:** Nothing outside the ten numbered requirements below is to be modified, refactored,
renamed, deleted, or redesigned. Everything currently working stays working. Each item states
whether it is *frontend-only*, *backend-only*, *DB*, or *cross-system*, plus its regression surface.

This doc is the pre-implementation contract. Read it against `SKILL.md §0–§16`,
`references/development-history.md §17–§30`, and the UI addendum. Referenced invariants (0.x) are
from `SKILL.md §0`.

**Decisions resolved (2026-08-23):**
- **D1 = Remove the whole "Description & Accommodations" section as written.** `description` becomes
  **optional server-side** so scoring degrades gracefully; both fields leave the form. (Accepted trade-off:
  weaker AI signal + empty public detail body on new jobs. Existing jobs keep their stored values.)
- **D2 = Attribute staff-published jobs to the Manager** (`peso_admin_id` = Manager; add `created_by` for
  audit). Owner-scoping stays intact; smallest blast radius.
- **NEW requirement #11 added** — AI Matching Logic refinement + Vacancy Lifecycle de-automation (see §11).
  This **modifies invariant 0.12** (count-based auto-fill) by explicit office decision, and repoints the AI
  scoring inputs. It supersedes the "vacancy cap math untouched" line in the guardrail.

---

## 0. Grounding facts verified against the current code (not just the docs)

| Fact | Evidence | Why it matters |
|---|---|---|
| RBAC is **role-level**; `ROLE_PERMISSIONS` exists but nothing enforces it | `middleware/rbac.js:48–71` (map) + `requireRole` at `:94` | A "publication staff" capability model must either add a role or *start* enforcing permissions. |
| `users.role` is an **ENUM** | `migrations/000_baseline_schema.sql:14` | A new staff role = an **append-only enum migration** (§13), plus `rbac.js` + `src/utils/roles.js` + role-write validation. |
| All PESO-admin routes gated as one bucket | `App.jsx:181` `allowedRoles={['employer']}` | Splitting Job-Publication-only access needs per-route/per-permission gating, not one bucket. |
| Job ownership is **per-individual** | `pesoAdminRoutes.js` (`peso_admin_id = req.userId`), ATS/referrals/analytics all owner-scoped | Multi-staff publishing breaks the Manager's pipeline unless ownership becomes **office-level** or attributed to the Manager. **Central design fork.** |
| `#1` fields bound server-side | `pesoAdminRoutes.js:261,271,323,348` bind `department, work_setup, description, accessibility_accommodations` | Frontend-only removal → `undefined` bind → mysql2 error. `#1` is **cross-system**. |
| `description` feeds AI scoring + public detail + is `required` | `aiScoringService.js:85` (`${job.description}`); `PesoAdminDashboard.jsx:678` (`required`) | Removing it **degrades the ONE scoring engine's inputs** (§7.4) and the public detail. Decision point. |
| Notifications are **not channel-based** | `services/notificationService.js` writes DB row + socket only; email is a separate path (`mailService`/`email_outbox`) | `#8`'s "channel router" is a real (but additive) refactor, not a config flip. |
| Landing "Registered Job Seekers" is public | `jobBoardRoutes.js:114–115,151` returns `users`; `LandingPage.jsx:1105` renders the tile | `#3` = drop the tile + stop exposing the count publicly; keep it behind auth. |
| No events / walk-in / SMS tables; `users` has no phone column | `migrations/` grep | `#2`, `#7`, `#8` are **greenfield + additive**. |
| Referral status ENUM = `Pending AI, Pending Review, Approved, Rejected, Voided` | `migrations/024_referral_void.sql:37–43` | `#6` (seeker acceptance) = **append** a new state + gate letter issuance behind it. |

---

## 1. Job Publication Manager — field removals + publication-staff access

### 1a. Field removals (Department, Work Setup, Description & Accommodations, Additional Questions)

**Change type:** CROSS-SYSTEM (frontend form + backend bind + AI-input consequence). Not frontend-only.

| Field to remove | Frontend | Backend | DB | Consequence |
|---|---|---|---|---|
| Department | `PesoAdminDashboard.jsx:569–572` | destructure+bind `department` (`:261,271,323,348`) | keep `pesoadmin_job_posts.department` column (frozen, §0.7) | Low. Column stays, stops being written (default to `null`). |
| Work Setup | `:609–616` | bind `work_setup` | keep column, default `null` | Low. Verify board/detail don't hard-require it for display. |
| **Description** | `:671–679` (`required`) | bind `description` | keep column | **⚠ Feeds AI scoring (`aiScoringService.js:85`) + public board detail.** Removing it lowers scoring signal quality and empties the detail body. **See Decision D1.** |
| Accessibility Accommodations | `:680–686` | bind `accessibility_accommodations` | keep column | Low–med. Legitimate a11y feature (§11) but explicitly requested for removal. Board detail may render it — verify. |
| Additional Questions | `:691–696` (`JobQuestionsEditor`) + `questions` state + save call | `POST/PUT /peso-admin/jobs/:id/questions` (replace-all txn), `GET /job-board/:id/questions`, ApplyWizard step 3 | keep `job_questions` table | **⚠ ApplyWizard has a 3-step flow whose step 3 is "Additional Questions" (§7.2).** Removing authoring must gracefully no-op the wizard step (empty question set → skip), not crash it. |

**Files affected:** `PesoAdminDashboard.jsx` (form sections), `pesoAdminRoutes.js` (make the four fields
optional — default `undefined`→`null`, do **not** drop columns), `ApplyWizard.jsx` (already handles
empty question sets? verify — likely renders nothing, safe), public board detail component (verify it
tolerates empty description/accommodations).
**DB/migrations:** none required (columns kept per §0.7; they simply stop being populated).
**API contracts:** `POST/PUT /peso-admin/jobs` — the four keys become optional. `/questions` endpoints
stay but the authoring UI is gone; existing jobs with questions keep them (don't purge).
**RBAC:** none.
**Notifications:** none.
**Interacting workflows:** AI compatibility scoring (description), public board detail render,
ApplyWizard step 3, duplicate-check (`duplicatePostingService` doesn't use these fields — safe).
**Regression risks:** (1) undefined-bind crash if backend not updated in lockstep — **must ship FE+BE
together**; (2) empty `description` on new jobs weakens scores; (3) ApplyWizard step-3 empty-state;
(4) `required` attribute on the description textarea must be removed or the form won't submit.

### 1b. Publication-staff account (Mr. Tejada) — see the consolidated RBAC design in §9.

`#1`'s "controlled publishing workflow" is the same requirement as `#9` (Co-Worker RBAC). Designed once
in §9; do not build a second subsystem. Job-Publication-Staff gets **Job Publication Manager + (optionally)
Event Announcements** and nothing else.

---

## 2. Upcoming Job Fair / Event Announcements (extensible event subsystem)

**Change type:** CROSS-SYSTEM, **greenfield + additive** (new table, routes, UI, one notification type).

**Design principle:** build a generic `announcements` (or `peso_events`) subsystem with an `event_type`
discriminator (`job_fair`, `recruitment_drive`, `seminar`, `general`…), not a hard-coded Job Fair table.

**DB (new migration — additive):**
```
peso_events (
  id, created_by (FK users.id), event_type ENUM(...append-only...),
  title, description, venue, event_date, start_time, end_time,
  registration_info TEXT, banner_image_base64 LONGTEXT NULL,   -- durable base64 (§0.5/0.13)
  status ENUM('Draft','Published','Cancelled','Completed') DEFAULT 'Draft',
  published_at, created_at, updated_at
)
```
Banner stored as **base64 in the DB** (invariant 0.5 — Render's disk is ephemeral), same pattern as
letters/certs. Keep it optional and size-bounded.

**API (new router `routes/eventRoutes.js`, mounted `/api/events`):**
- `GET /api/events` — public, published-only (landing/board can surface upcoming events).
- `GET /api/events/:id` — public detail.
- `POST/PUT/DELETE /api/events` — authorized staff (RBAC per §9; permission `events:manage`).
- `POST /api/events/:id/publish` — transitions Draft→Published and **fires the notification** (below).

**Notifications:** add ONE new type `EVENT_ANNOUNCEMENT` → deep link `/events` (or `/job-board` with an
events tab). On publish, call `notifyAllJobSeekers(io, {type:'EVENT_ANNOUNCEMENT', ...})` — the existing
single-writer broadcast (`notificationService.js:103`), so it's mute-aware and one round-trip.
Register the type in `NotificationBell.jsx` `TYPE_META` **and** `notificationRoutes.js` `CONTROLLABLE_TYPES`
(§7.7 contract). This automatically becomes SMS-eligible once `#8` lands (channel router).

**Frontend:** a staff-facing Event Manager (create/edit/list — reuse the card system + `EmptyState`),
a public/seeker Events surface (list + detail), and an entry in the seeker navigation. New lazy route(s)
in `App.jsx`. Follow UI addendum §5 (cards), §14 (empty states), §24.1 (tokens).

**RBAC:** `events:manage` permission (Manager + Job-Publication-Staff if authorized, per §9).
**Interacting workflows:** notification broadcast, landing/board display, the future SMS channel.
**Regression risks:** low (all additive). Watch: broadcast volume (reuse the existing bulk INSERT…SELECT,
never a per-user loop); enum discriminator must be append-only; banner size cap to avoid bloating payloads.

---

## 3. Landing Page — remove Registered Job Seekers statistic

**Change type:** CROSS-SYSTEM but tiny (frontend tile + stop public exposure). Data untouched.

**Files/endpoints:**
- `LandingPage.jsx:1105` — remove the `{ key: 'users', label: 'Registered Job Seekers' }` tile (and the
  count-up wiring / grid slot). `platformStats.users` (`:675`) can stay in state or be dropped from the
  destructure — either way, stop rendering it.
- `jobBoardRoutes.js:114–115,151` — **stop returning `users`** in the public `/stats` payload (remove the
  count query + the `users:` field) so it's no longer publicly exposed. Keep `jobs`, `hires`, `partners`,
  `referrals`.
- **Authenticated alternative already exists:** `/admin/metrics` returns `users.job_seekers` (§11) — the
  Super Admin / PESO dashboards already surface the count behind auth. No new endpoint needed. Optionally
  add it to the PESO operational dashboard if the office wants it there.

**DB/migrations:** NONE — do **not** touch user/account data (explicit constraint).
**RBAC / Notifications:** none.
**Interacting workflows:** landing stat tiles map 1:1 to `/stats` fields (§9 of SKILL) — removing one field
is safe as long as the frontend no longer reads it (it won't). `notifyAllJobSeekers` still works (unrelated).
**Regression risks:** minimal. Verify no other public consumer reads `stats.users` (grep: only LandingPage).
Keep the landing grid visually balanced after dropping a tile (3 tiles instead of 4).

---

## 4. Landing Page / Home button for authenticated users

**Change type:** FRONTEND-ONLY. No API, no auth requests, no backend (explicit constraint).

**Design:** add a "Home / Landing" control (e.g., a `Home` lucide icon button) to the **shared** header
architecture so all authenticated roles get it consistently:
- `components/layout/TopHeader.jsx` — the seeker + PESO-admin desktop bar (`hidden md:flex`). Add the Home
  button next to `ThemeToggle`/`NotificationBell`. It `navigate('/')` (the public `LandingPage`, which is
  already reachable at `/` and does not force logout).
- `components/Sidebar.jsx` mobile bar — mirror it for phones (TopHeader is desktop-only).
- Super Admin: `SuperAdminLayout` has **no TopHeader** (§9) — add the same button to `SuperAdminSidebar`
  (footer or header) so the Super Admin also gets it. This is the "any other authenticated role" clause.

**"Return to previous authenticated area":** `/` renders `LandingPage` for everyone. From there, the
existing role-aware CTA / the browser back button returns them. To make "→ back to my area" explicit and
consistent, the LandingPage can show a "Back to Dashboard" affordance **when a user is authenticated**
(read `useAuth()`; route to the role's home: seeker `/`→dashboard, PESO `/peso-admin/dashboard`, Super
`/admin/dashboard`). Pure client routing — no API.

**Files affected:** `TopHeader.jsx`, `Sidebar.jsx` (mobile bar), `SuperAdminSidebar.jsx`,
optionally `LandingPage.jsx` (authenticated "Back to Dashboard" affordance).
**RBAC / DB / Notifications / API:** NONE.
**Interacting workflows:** `markVisitedLink` runs on route change (TopHeader effect) — navigating to `/`
is fine. `LandingPage` is currently under `ProtectedRoute allowedRoles={['applicant','employer','admin']}`?
No — `/` is public (`App.jsx:144`). Verify `/` stays public and renders for an authenticated session
without a redirect loop.
**Regression risks:** low. Ensure the button doesn't trigger a logout or re-auth; ensure `/` doesn't
redirect authenticated users away (check the `/` route element logic at `App.jsx:144`).

---

## 5. Mascot + chatbot visual — "person seeking/obtaining employment"

**Change type:** FRONTEND-ONLY (asset + component). Scoped to Landing + Chatbot visuals.

**Constraint reminder:** `GebbieMascot.jsx` and `LandingPage.jsx` are the **two deliberately
theme-excluded** files (§24 — landing tokenization was tried and rejected). Any new mascot must keep the
landing's bespoke palette and stay out of the token migration.

**Approach evaluation (pick lightest sufficient — do NOT add a heavy animation framework):**

| Option | Bundle impact | Smoothness | A11y | Verdict |
|---|---|---|---|---|
| **Inline SVG + CSS keyframes** | ~0 KB (inline) | Good for idle loops | Full control (`role="img"`, `aria-label`, reduced-motion) | **Recommended default.** Matches the existing Gebbie rig (class-based CSS animation, all under `prefers-reduced-motion`). |
| Lightweight animated SVG (SMIL/CSS) | ~0 KB | Good | Good | Fine; keep animations in the reduced-motion block. |
| Lottie (`lottie-web`/`lottie-react`) | +50–150 KB + JSON | Excellent | Needs manual a11y | Only if a rich character animation is truly required. Heavier than the brief wants. |
| CSS-only | ~0 KB | Limited | Good | Good for accents. |
| Illustration libs (unDraw/Humaaans SVG) | per-asset | Static/simple | Good | Good source for a "job-seeker" illustration; export a single optimized SVG. |

**Recommendation:** replace Gebbie with an **inline optimized SVG of a person actively job-seeking**
(e.g., a figure with a résumé/briefcase/laptop, or shaking hands on hire), animated with the **existing
CSS-keyframe rig** (`.mascot-*` classes, all registered in the `prefers-reduced-motion` block). Zero new
dependency, low bundle, mobile-smooth, design-system consistent.

**Chatbot visual language:** give the chatbot launcher/header the **same illustration family** (a small
avatar/icon derived from the same SVG or a matching flat-icon), so mascot ↔ chatbot read as one brand.
`Chatbot.jsx`/`ChatWidget.jsx` currently use Gebbie + the PESO green (already tokenized, §24) — swap the
launcher glyph to the new family; keep the token styling.

**Files affected:** replace/retire `GebbieMascot.jsx` (or add a new `JobSeekerMascot.jsx` and swap
imports in `LandingPage.jsx` + `Chatbot.jsx`/`ChatWidget.jsx`), CSS keyframes in `index.css`
(reduced-motion block). Note `GebbieMascot` is **shared** (Landing + Chatbot, uses `useId` for gradient
ids — UI addendum §9) — swap both consumers together.
**RBAC / DB / API / Notifications:** NONE.
**Regression risks:** low. Keep `useId` for unique SVG gradient ids (two instances on one page collide
otherwise); keep every animation in the reduced-motion block (WCAG 2.3.3, §10); don't reintroduce a heavy
framework; preserve the landing's bespoke (non-token) palette.

---

## 6. Smart Referral Queue — Job Seeker acceptance step

**Change type:** CROSS-SYSTEM (referral lifecycle state + backend transitions + notifications + UI).
**Must integrate with the existing referral architecture — no parallel workflow** (explicit constraint).

### The conflict to resolve
Today, `approveReferral` (`referralService.js`) immediately writes the queue row, **mints the letter, and
enqueues the outbox** (`generate_pdf → send_email → …`, §7.5). For a *proactive* referral, the admin's
"Refer" in the Smart Referral Queue promotes → materializes an application → `approveReferral` → letter
goes out. So the seeker currently has **no say** — the requirement is exactly to insert consent **before
the letter is issued**.

### Proposed lifecycle (append, don't replace)
Add ONE state to `referral_queue.status` (append-only enum migration, §13):
```
Pending AI → Pending Review → [Pending Seeker Acceptance] → Approved → (outcomes…) / Rejected / Voided
```
- **Admin endorses** (Smart Referral Queue "Refer", or ATS refer): create the referral row in
  **`Pending Seeker Acceptance`** — reserve the reference number if needed, but **do NOT enqueue the outbox
  and do NOT mint/send the letter yet.** The vacancy slot handling must be decided (see D3): either reserve
  the slot at endorsement or only at seeker-acceptance.
- **Seeker notified:** new muteable type `REFERRAL_ENDORSEMENT` (or reuse `REFERRAL_ISSUED` with distinct
  copy) → deep link to a new seeker "My Endorsements/Referrals to review" surface. Wire into `TYPE_META` +
  `CONTROLLABLE_TYPES`.
- **Seeker reviews → Accept / Decline:** new owner-scoped endpoints
  `POST /referrals/:id/accept` and `POST /referrals/:id/decline` (seeker-only, filtered by the referral's
  applicant). Accept transitions `Pending Seeker Acceptance → Approved` **inside a transaction that then
  enqueues the outbox** (the current `approveReferral` tail becomes the accept path). Decline transitions to
  `Rejected` (or a new `Declined`) with the slot released.
- **Referral proceeds** exactly as today from `Approved` onward (letter, outcomes, DOLE) — unchanged.

### Where the code changes
- `services/referralService.js` — split `approveReferral` so the **letter/outbox tail** runs on
  **seeker-accept**, not on admin-endorse. Admin-endorse becomes "stage for acceptance." Keep the vacancy
  cap check (0.12) at the correct point (D3).
- `services/proactiveReferralService.js` (`promoteCandidate`) — promote into `Pending Seeker Acceptance`
  instead of straight to Approved/sent.
- `referralRepository` — state transitions + the two new queries; delivery-state CASE (`DELIVERY_STATE_CASE`)
  and `deliveryState()` in `Referrals.jsx` must both learn the new state (they MUST stay in lockstep — §14).
- Frontend: seeker acceptance UI (a new review card / action on My Referrals); Smart Referral Queue shows
  "Awaiting seeker acceptance" instead of "Referred"; admin Register shows the new state.
- `migrations/0XX` — enum append `'Pending Seeker Acceptance'` (+ optional `'Declined'`),
  `accepted_at`/`declined_at`/`decision_by` columns, additive.

**RBAC:** seeker accept/decline endpoints are **applicant-owner-scoped** (not admin). Admin endorse stays
Manager-only (referral decisions are NOT delegated to Job-Publication-Staff — §9).
**Notifications:** `REFERRAL_ENDORSEMENT` (to seeker on endorse); existing `REFERRAL_ISSUED` (to seeker on
accept→letter); admin gets a `REFERRAL_UPDATE` on accept/decline. All via `notificationService`.
**Interacting workflows:** vacancy cap (0.12), Applicant Pipeline status coupling (`approveReferral` sets
ATS `'Referred'`, §18.5 — must now happen on ACCEPT, not endorse, or add an intermediate ATS state),
Referral Register delivery-state filter, outcomes, DOLE reporting, the referral outbox worker.
**Regression risks (high — this is the deepest change):**
1. **Double-issue / conflicting state** — the whole point. The append-state + "outbox only after accept"
   guarantees a letter is never sent on endorse. Guard with the existing `referral_queue.application_id`
   UNIQUE + vacancy cap.
2. **ATS status coupling** — `'Referred'` is currently set at approve; if approve moves to accept-time, the
   pipeline shows the applicant as not-yet-referred during the acceptance window. Decide the intermediate
   ATS label.
3. **`deliveryState()` ↔ `DELIVERY_STATE_CASE` drift** (§14) — update both.
4. **Vacancy slot timing (D3)** — reserving at endorse can deadlock the cap if seekers sit on decisions;
   reserving at accept risks two endorsements racing for one slot. Pick one, enforce in the txn.
5. Proactive promote's **compensating transaction** (§20.4) must still clean up on failure.
6. Ship behind a **system-setting flag** (like `referral_lifecycle_sync_enabled`, §7.12) so it can roll back
   without a deploy.

---

## 7. Walk-In Job Seeker Registration (staff-encoded applicants)

**Change type:** CROSS-SYSTEM, largely additive but touches the **identity model** — highest-design item
with `#6`. **Requirement: walk-in and online seekers share the SAME centralized data model** (no separate
record system).

### Core model decision (D4): staged/claimable Job Seeker account
Create walk-in seekers as **real `users` rows with `role='applicant'`** (same table, same profile, same
`job_applications`/resume architecture) but marked as **staff-encoded / unclaimed** so they can be *claimed*
later. Add (additive migration):
```
users:  account_origin ENUM('self','walk_in') DEFAULT 'self',
        claim_status ENUM('n/a','unclaimed','claimed') DEFAULT 'n/a',
        encoded_by (FK users.id) NULL,      -- which staff created it
        claim_token / claimed_at NULL,
        phone / mobile VARCHAR NULL          -- also needed by #8 (shared)
```
A walk-in row has **no password / no verified email initially** (OTP signup, §7.9, is bypassed for
staff-encoding — a different creation path than public registration). It participates in everything a normal
seeker does (profile, resume snapshot, applications, referrals, scoring) because it IS a normal seeker row.

### Account claiming (later)
When the walk-in seeker gets a Gmail / online access: a **claim flow** links the existing row to real auth
(Google OAuth or set-password + OTP), flips `claim_status → claimed`, and merges nothing (it was one row all
along). Duplicate detection (below) prevents a second row being created at claim time.

### Sub-concerns the brief lists — proposed handling
| Concern | Approach |
|---|---|
| Account creation | New staff endpoint `POST /peso-admin/walk-in` (RBAC `walkin:manage`) → creates the seeker row via a shared service, **not** the public OTP path. |
| Temporary/staged accounts | `account_origin='walk_in'`, `claim_status='unclaimed'`; fully functional, just unclaimed. |
| Duplicate detection | Before insert, match on name + phone + (optional) email against existing seekers; surface likely matches to staff (reuse the `duplicatePostingService` Jaccard idea, or a simple normalized match). Staff confirms "new" vs "attach to existing." |
| Existing Job Seeker matching | Same matcher; if found, staff encodes the application against the existing row instead of creating one. |
| Resume encoding/upload | Reuse the existing resume architecture: PDF upload → `pdfTextService` → `uploaded_resumes.parsed_text`; or the structured builder JSON. Per-application snapshot into `application_resumes` (base64, §7.3) exactly like online applies. |
| Application creation | Reuse `job_applications` (+ vacancy gate, snapshot, scoring). A staff-encoded apply is `origin='admin_referral'`-like or a new `origin='walk_in'` value (append the enum, §20.3 has `origin ENUM('seeker','admin_referral')`). |
| Identity verification | The government ID **type** field (`verification_id_type`, §11) still applies; the decommissioned identity-approval workflow (§0.9) is NOT reintroduced. |
| Future account claiming | Claim flow above; `claim_token` emailed/SMSed when contact becomes available. |
| Audit logs | Every walk-in creation + claim writes `admin_audit_logs` via `adminAuditService` (new actions `WALKIN_CREATED`, `WALKIN_CLAIMED`). |
| Consent / privacy | Capture a consent flag at encoding time (Data Privacy Act — the office is collecting PII on someone's behalf); store consent + timestamp; surface a privacy notice in the staff form. **Do not store PII in `/uploads`** (§0 conventions). |

**Files/endpoints:** new `routes/walkInRoutes.js` (or under `pesoAdminRoutes`), a shared
`services/walkInService.js` that reuses profile/resume/application services; frontend staff form
(multi-step: personal → contact → skills/qual → resume → application). Reuses ApplyWizard-style pieces where
possible without forking them.
**DB:** additive `users` columns + one `origin` enum append; no new parallel tables for the person.
**RBAC:** `walkin:manage` (Manager + authorized staff — Ma'am Elma's staff, per §9).
**Notifications:** on claim, notify the seeker; SMS-eligible once `#8` lands (many walk-ins have no email —
this is the direct motivation for `#8`).
**Interacting workflows:** OTP signup (bypassed for this path — do not weaken the public path),
`normalizeRole` (walk-ins are `applicant`), scoring, referrals, vacancy cap, DOLE.
**Regression risks:** (1) must NOT weaken public OTP signup (separate creation path); (2) duplicate rows if
matching is skipped — enforce a soft match + staff confirmation; (3) unclaimed rows appearing in public
counts/metrics — decide whether `walk_in`/`unclaimed` rows count in `/admin/metrics` (they should, but be
deliberate); (4) claim flow must not create a duplicate; (5) consent/privacy compliance is a real legal
requirement, not optional.

---

## 8. SMS notification fallback — channel-based notification architecture

**Change type:** CROSS-SYSTEM refactor (additive) + external provider. **Evaluate before implementing**
(explicit constraint — do not wire SMS blindly).

### Target architecture (the brief's ask)
```
Notification Event → Notification Service → Channel Router → { In-App (always) , Email (if verified email) , SMS (if verified phone) }
```
Today `notificationService` = In-App only; email is a **separate** path (`mailService`/`email_outbox`).
The refactor makes `notificationService` the **event entry point** that fans out to channels **without
duplicating business logic per method** (the brief's explicit requirement). In-app stays the durable
deliverable (row first, §0.11); email/SMS are best-effort side channels chosen by the seeker's
**available + verified** contact info.

### Provider abstraction (required)
`services/smsService.js` behind a uniform interface `{ name, send(to, body), getStatus(id) }`, provider
selected by env — mirrors how `mailService` already does an ordered provider chain (§8, §19.3). So the
provider can change later with no caller rewrite.

### Provider evaluation (Philippines context — decision D5, do not pick blindly)
| Provider | Notes | Cost signal | Fit |
|---|---|---|---|
| **Semaphore** (PH-local) | PH-focused, sender-name support, simple HTTP API | ~₱0.50–1.00/SMS credit | Strong local fit; likely lowest friction for a Kabankalan office. |
| **Twilio** | Global, robust status callbacks, retries | ~$0.02–0.05/SMS to PH + number rental | Best DX/reliability; higher cost, needs a sender/number. |
| **Vonage/Infobip/etc.** | Global | varies | Alternatives if Semaphore/Twilio don't fit. |
| **Movider / iTexMo** (PH) | PH SMS gateways | low, local | Budget local options. |

Must evaluate per provider: **cost/message, rate limits, delivery-status callbacks, retry handling,
failed-message handling, opt-in/consent, phone verification, templates, audit logging** (the brief's list).

### DB (additive)
```
users.phone / phone_verified_at / sms_opt_in            -- consent + verification
sms_outbox (id, user_id, to_number, template_key, body, status ENUM('pending','processing','sent','failed'),
            provider, provider_message_id, attempts, next_run_at, created_at)  -- mirrors email_outbox (§18.3)
```
Drain with an `smsWorker` following the **same outbox pattern** (§7.5/§18.1 — the 7th worker; atomic claim,
backoff, dead-letter, stuck-reclaim). **Do not invent a new async mechanism** (§0.5 / §7.5).

### Consent / verification / templates / audit
- **Opt-in + phone verification** (OTP to the phone) before any non-transactional SMS — reuse the OTP
  discipline (§7.9: `crypto.randomInt`, TTL, attempt caps).
- **Templates** keyed (`REFERRAL_ISSUED`, `EVENT_ANNOUNCEMENT`, `APPLICATION_STATUS`…) so message bodies are
  centralized, not inline.
- **Delivery status + retries** via the outbox + provider status callback; dead-letter surfaces on a Super
  Admin monitor (like Email Delivery, §18.3).
- **Audit** every send in the outbox; PII-safe logging (no full message with PII in plain logs).

**Files/endpoints:** `services/smsService.js`, `services/smsWorker.js`, `repositories/smsOutboxRepository.js`,
channel router inside/beside `notificationService.js`, Super Admin SMS monitor, seeker phone-verify UI.
**RBAC:** seeker manages own phone/opt-in; Super Admin monitors delivery.
**Notifications:** every existing `notifyUser`/`notifyAllJobSeekers` call becomes channel-aware **without
changing call sites** (the router reads the recipient's verified channels). This is the key design win.
**Interacting workflows:** referral notify step (worker), event publish, application status, walk-in claim,
the email outbox (parallel sibling), notification mute preferences (SMS respects the same mutes + its own
opt-in).
**Regression risks:** (1) never let an SMS failure fail the primary action (0.1) — outbox + best-effort;
(2) don't double-send (email AND SMS AND in-app) unless intended — router picks per availability;
(3) consent/DPA compliance; (4) cost blowups — rate-limit + candidate caps; (5) refactor must be **flag-gated**
and must not regress the current in-app + email behavior when SMS is off.

---

## 9. PESO Staff / Co-Worker RBAC (the consolidated model for #1b + #9)

**Change type:** CROSS-SYSTEM (RBAC core + a role migration + per-route/permission gating + sidebar
filtering). **Derive from the existing RBAC architecture — do NOT hard-code permissions into frontend pages**
(explicit constraint).

### Recommended model: new role + *activate* the dormant permission layer
1. **Add a role** `PESO_STAFF` (stored `peso_staff`) via an **append-only enum migration** on `users.role`
   (§13). Update `middleware/rbac.js` (`ROLE_KEYS`, `ROLE_LABELS`, `ROLE_ALIASES`, `ROLE_PERMISSIONS`) and
   `src/utils/roles.js` in lockstep (they must agree — `rbac.js:26`).
2. **Turn on permission checks.** `ROLE_PERMISSIONS` already exists but nothing enforces it. Add a
   `requirePermission('jobs:manage')`-style guard (or extend `requireRole` usage) so routes gate on
   *capability*, not just role bucket. Manager keeps the full PESO set; Staff gets a **narrow** set.

| Role | Permissions (proposed) | Portal surfaces |
|---|---|---|
| **PESO Manager** (`peso_administrator`, unchanged) | `jobs:manage`, `applicants:manage`, `referrals:decide`, `recruitment:communicate`, `employment_analytics:view`, `events:manage`, `walkin:manage`, `staff:manage` | Everything it has today (Applicant Pipeline, Smart Referral Queue, Referral Register, Operational Dashboard) + staff management. **Unchanged behavior.** |
| **Job Publication Staff** (`peso_staff`) | `jobs:manage`, (optional) `events:manage` | **Job Publication Manager only** (create/edit/publish vacancies) + Event Announcements if authorized. **No** Applicant Pipeline, Smart Referral Queue, Referral Register, settings, referral decisions. |

3. **Frontend gating from RBAC, not per-page hacks:** `ProtectedRoute` currently gates all PESO routes as
   `['employer']` (`App.jsx:181`). Split so `/peso-admin/jobs` (+ events) allows `['employer','peso_staff']`
   while `/peso-admin/ats`, `/peso-admin/smart-referrals`, referral routes stay Manager-only. The Sidebar
   filters nav items by the user's permission set (one source of truth), so Staff simply doesn't see the
   modules they can't use.

### The ownership fork (D2) — must resolve before building
Jobs are owned by `peso_admin_id = req.userId`, and ATS/referrals/vacancy-cap/analytics are **owner-scoped**.
If Staff (Tejada) publishes jobs under their own id, the **Manager won't see applicants** for those jobs.
Options:
- **(A) Office-level ownership** — treat PESO as one office; broaden owner-scoping from "this user" to "this
  office" (all PESO staff share the vacancy/ATS/referral scope). Cleanest long-term; touches every
  owner-scoped query — **higher blast radius**, must be careful not to regress the single-Manager case.
- **(B) Attribute staff-published jobs to the Manager** — Staff creates jobs but `peso_admin_id` is set to
  the Manager (or a shared office account), with a separate `created_by` for audit. Smaller change; keeps
  owner-scoping intact; Staff is effectively an encoder for the Manager's queue. **Recommended for a small
  office with one Manager.**

**Files:** `middleware/rbac.js`, `src/utils/roles.js`, new `requirePermission`, `App.jsx` (route gating),
`Sidebar.jsx`/nav (permission-filtered items), `superadmin/roleAdminService` (must allow assigning the new
role — validate the RAW token, §0.15), and a migration for the enum append.
**DB:** enum append on `users.role`; optional `pesoadmin_job_posts.created_by` (option B).
**RBAC:** the whole point. **Notifications:** none directly.
**Interacting workflows:** every owner-scoped PESO query (D2), role administration (Super Admin),
`normalizeRole` (must map the new role), the ATS/referral/vacancy invariants (0.12).
**Regression risks (high):** (1) `normalizeRole` maps unknown → JOB_SEEKER (0.15) — the new role MUST be in
`ROLE_ALIASES` or a `peso_staff` token silently becomes a seeker; (2) owner-scoping (D2) — the #1 way to
break the Manager's pipeline; (3) role-write validation (0.15/0.16) — assigning the role must be audited
inside the txn; (4) don't grant Staff any referral-decision permission (explicit).

---

## 11. AI Matching Logic refinement + Vacancy Lifecycle de-automation (office decision)

**Change type:** CROSS-SYSTEM. Two related but separable pieces — an **AI-input change** (pairs with #1) and
a **vacancy-lifecycle change** (pairs with #6). **This deliberately modifies invariant 0.12** (auto-fill),
per the PESO Office's actual workflow.

### 11a. AI Match Score inputs = the accredited employer's stated Job-Publication-Manager data only
The office confirmed: certificates and *unspecified* qualifications are **not** consistently referral
requirements, so the scorer must not treat them as mandatory. Authoritative inputs become the structured
Job Publication Manager fields only:
- **Core Information** (title, company, category) — note Department is removed by #1.
- **Logistics & Compensation** (employment type, location, salary, positions, deadline) — Work Setup removed by #1.
- **Requirements & Qualifications** (education, experience, skills, qualifications).
- **Gender** — NEW supported qualification field (accredited employers commonly specify it).

**What changes in code:**
- `services/aiScoringService.js` — `buildScoringPrompt` (§29.2) currently feeds `description` (removed by #1),
  `skills`, `qualifications`, `experience`, `education`. Refine so: (a) it uses the structured fields above as
  the authoritative criteria; (b) the prompt **explicitly instructs** that unlisted/unspecified requirements
  and certificates are NOT mandatory — absence must not penalize the candidate; the model scores against what
  the employer *stated*. (c) Add **Gender** to the criteria when the job specifies one.
- **Certificate context** (`applicationScoringService.getCertificateContext`, §18.6 C.3) — keep it as
  **optional supporting evidence**, but the prompt must stop implying certs are required. Do NOT rip out cert
  context (that would regress C.3); just reweight it as non-mandatory. **Re-measure with the eval harness**
  (`npm run eval:scoring`, §21) before/after — this is a scoring-behavior change and §21's discipline
  (measure → change → re-measure) applies. Because scoring is deterministic (temp 0) + hash-guarded (§29),
  a prompt change invalidates the stored `last_scored_input_hash` baselines — that's fine (they re-score once).

**Gender field — greenfield on BOTH sides (verified: no `gender` column anywhere):**
- Job side: additive `pesoadmin_job_posts.gender` (or `gender_requirement`) + a field in the Job Publication
  Manager form (coordinate with #1's form edits — same modal) + bind in `pesoAdminRoutes` INSERT/UPDATE.
  Values likely `Any / Male / Female` (append-safe if enum; VARCHAR simpler).
- **Seeker side:** matching on gender needs the *seeker's* gender too — there is currently **no gender field
  on `users`/profile**. Additive `users.gender` + a profile field, fed into the scorer's candidate context.
  **Sensitivity note:** gender-based matching is legally/ethically loaded; keep it as a *stated employer
  requirement* input only (mirroring accredited-employer practice), never a hidden filter, and document it.

**Files:** `aiScoringService.js`, `applicationScoringService.js` (cert weighting), `PesoAdminDashboard.jsx`
(Gender field), `pesoAdminRoutes.js` (bind gender), `Profile.jsx` (seeker gender), `scripts/eval-fixtures.json`
(add gender/no-cert cases), migrations (additive `gender` on jobs + users).
**RBAC/Notifications:** none. **Regression risks:** (1) scoring-behavior drift — gate with the eval harness;
(2) don't remove cert context (C.3 regression) — only reweight; (3) gender data is sensitive — deliberate,
documented, employer-stated only; (4) the input-hash guard baselines re-compute once (expected).

### 11b. Vacancy lifecycle — closure is PESO-verified, never auto-inferred
The office confirmed a vacancy is filled/closed **only after PESO contacts the employer and verifies it** —
never from application counts, referral counts, or AI scores. This **changes invariant 0.12's auto-fill**.

**Current behavior to change:**
- `referralService.js:224–226` — the approval that consumes the last slot **auto-sets `status='Filled'`**
  (+ logs `JOB_FILLED`). → **Remove the automatic flip.** Approval still records the referral; it no longer
  closes the vacancy.
- `referralService.js:~548–555` — the reopen rule (`Filled && approvedNow < capacity → reopen`) becomes moot
  once auto-fill is gone; keep manual reopen only.
- `jobs/JobCard.jsx:32–37` `isJobFilled` — currently `referred_count >= positions_available` (**count wins**).
  → **Key "Filled" on the confirmed `status` only** (`Filled`/`Closed`), NOT the referred count. `savedJobState`
  (`:62`) and `filledLabel` consumers follow.
- **Vacancy cap (0.12):** `approveReferral` currently 409s past capacity. The office wants continued referrals
  when the employer confirms still-open. → The cap becomes **advisory, not a hard block**: show "N of M
  referred" as information; allow referrals to continue unless the vacancy is **confirmed Filled/Closed**.
  (Decision D6 below: soft-warn vs no-block.)

**New capability:** an explicit PESO action to **confirm vacancy filled / employer no longer accepting** →
sets `status='Filled'` (or `Closed`) with who/when/note (audit). This is the ONLY path to Filled now.
- Endpoint: `POST /peso-admin/jobs/:id/confirm-filled` (and a "reopen"/"still-open" counterpart), owner-scoped,
  Manager permission (`referrals:decide`/`jobs:manage`), audited.
- Optional: a `vacancy_confirmations` record or reuse job status + `filled_confirmed_by/at/note` columns
  (additive).

**Architecture principle (the office's framing):** **AI = candidate↔job compatibility; PESO-verified employer
communication = vacancy availability.** These become two independent axes (mirrors the 0.14 delivery-vs-outcome
separation). The board's "Vacancy Filled" and the admin's "Filled – All Positions Referred" both mean
*PESO-confirmed*, not *count-reached*.

**Files:** `referralService.js` (drop auto-fill), `jobs/JobCard.jsx` (status-based `isJobFilled`),
`referralRepository` (cap check → advisory), `pesoAdminRoutes.js` (confirm-filled endpoint), Job Publication
Manager + ATS UI (confirm-filled control + "N of M referred, still open" indicator), public board label logic.
**DB:** additive `filled_confirmed_by/at/note` (or a `vacancy_confirmations` table); no enum change (Filled
already exists).
**RBAC:** confirm-filled = Manager only (NOT Job-Publication-Staff — it's a referral/employer decision).
**Notifications:** optionally notify on confirm-filled; not required.
**Interacting workflows:** the vacancy cap (0.12), auto-fill/reopen (§7.8), `isJobFilled`/`filledLabel`/
`savedJobState` (§7.2, used across board + saved + ATS), the Apply gate (§7.8 refuses non-Open/count-filled —
must now refuse only on confirmed-Filled/Closed, not count), the proactive matcher, #6 (acceptance).
**Regression risks (high — core invariant change):**
1. **Removing the hard cap** means referrals can exceed `positions_available` — intended, but every place that
   assumed the cap held (Apply gate, `isJobFilled`, "FULL" chips, filled ribbons) must switch to
   status-based logic in lockstep or the board/ATS will show contradictory states.
2. Legacy jobs currently auto-Filled by the old rule stay Filled — fine (manual reopen available); don't
   mass-revert.
3. Ship behind a **system-setting flag** so the old count-based behavior can be restored without a deploy.
4. Coordinates tightly with #6 (both touch the referral→vacancy relationship) — sequence them together.
5. DOLE/landing "Successful Referrals" is `outcome='Hired'` (0.14) — unaffected by cap changes; keep it that way.

---

## 10. Phased roadmap (low-risk UI → DB/RBAC/notification → complex cross-system)

Ordered so each phase ships independently, nothing half-built blocks the office, and the risky
identity/RBAC/lifecycle work comes after the safe wins. Every phase is flag-gated where it changes behavior.

### Phase 0 — Confirm & decide (no code)
- Resolve **Decisions D1–D5** below.
- Confirm current `users.role` enum members and `pesoadmin_job_posts` column list (read-only).
- Confirm ApplyWizard tolerates an empty question set; confirm no public consumer other than LandingPage
  reads `stats.users`.

### Phase 1 — Low-risk, frontend-first (fast, reversible)
- **#3** Remove Registered-Job-Seekers tile + stop returning `users` in `/stats` (tiny BE change). *FE + 1 BE line.*
- **#4** Home/Landing button across TopHeader + mobile bar + SuperAdminSidebar (+ optional authed "Back to
  Dashboard" on Landing). *FE only.*
- **#5** New job-seeker mascot (inline SVG + CSS rig) + matching chatbot glyph. *FE only.*
- **#1a** Remove the four Job-Publication fields — **shipped FE+BE together** (make the four body keys
  optional server-side so binds don't break; D1 resolved = remove as written, `description` optional). *Cross-system but small.*
- **#11a (form part)** Add the **Gender** field to the same Job Publication Manager modal + `pesoadmin_job_posts.gender`
  + seeker `users.gender` (additive migrations) + bind in routes. *Cross-system, additive.* (The scorer-prompt
  half of #11a goes in Phase 1.5 because it's a measured scoring-behavior change.)

### Phase 1.5 — AI scoring input refinement (measured)
- **#11a (scoring part)** Repoint `buildScoringPrompt` to the structured employer fields, mark certs/unspecified
  quals non-mandatory (reweight, don't remove C.3), add Gender to criteria. **Gate with the eval harness**
  (`npm run eval:scoring`) — measure before/after per §21. Input-hash baselines re-compute once (§29). *Backend.*

### Phase 2 — RBAC foundation (enables #1b, #2, #7)
- **#9 / #1b** PESO Staff role + activate permission enforcement + route/sidebar gating + role-admin support.
  Resolve **D2 (ownership)** first. Ship behind careful testing; Mr. Tejada's account created as `peso_staff`.
  *Cross-system; the keystone for the rest.*

### Phase 3 — Event/Announcement subsystem
- **#2** `peso_events` table + `/api/events` + staff Event Manager + public Events surface +
  `EVENT_ANNOUNCEMENT` notification type (broadcast via the existing single writer). Gated on the `events:manage`
  permission from Phase 2. *Cross-system, additive.*

### Phase 4 — Referral acceptance lifecycle + vacancy de-automation (sequence together)
- **#6** Append `Pending Seeker Acceptance` state; split `approveReferral` so the letter/outbox runs on
  **seeker-accept**; seeker accept/decline endpoints + UI; keep `deliveryState()` ↔ `DELIVERY_STATE_CASE` in
  lockstep; flag-gated (§7.12). Resolve **D3 (slot timing)**.
- **#11b** Remove auto-fill (`referralService.js:224–226`); make `isJobFilled` status-based not count-based
  (`JobCard.jsx:32–37`); cap becomes advisory (D6); add the PESO **confirm-filled** endpoint + UI; switch the
  Apply gate to confirmed-status. Flag-gated. *Core-invariant change (0.12) — do WITH #6 since both touch the
  referral→vacancy relationship. Deepest work; last of the referral changes.*

### Phase 5 — Walk-in registration
- **#7** Additive `users` columns (origin/claim/phone/encoded_by) + `walkInService` reusing profile/resume/
  application services + staff form + claim flow + audit + consent. Resolve **D4**. *Cross-system, reuses the
  centralized model.* Depends on Phase 2 (RBAC `walkin:manage`).

### Phase 6 — Channel-based notifications + SMS
- **#8** Channel router in `notificationService` + `smsService` provider abstraction + `sms_outbox` + `smsWorker`
  (7th outbox worker) + phone verify/opt-in + Super Admin SMS monitor. Resolve **D5 (provider)**. Flag-gated;
  in-app + email behavior unchanged when SMS is off. *Largest additive refactor; last because #7 (walk-ins with
  no email) is its main consumer.*

**Dependency graph:** Phase 1 independent · Phase 2 gates 3/5 · Phase 4 independent of 2/3 but sequence after
RBAC for review bandwidth · Phase 5 needs Phase 2 · Phase 6 benefits from Phase 5 (walk-in phone numbers) and
should land after the event type exists (Phase 3) so events are SMS-eligible.

---

## Decisions (D1–D6)

- **D1 — Description field. ✅ RESOLVED: remove the whole section as written**; `description` made optional
  server-side so scoring degrades gracefully.
- **D2 — Job ownership under multi-staff (#9). ✅ RESOLVED: attribute staff jobs to the Manager** (option B;
  add `created_by` for audit). Gates Phase 2.
- **D6 — Vacancy cap after de-automation (#11b).** With auto-fill removed, past `positions_available` should
  the system **(a)** allow referrals freely (no block, pure info "N of M referred"), or **(b)** soft-warn the
  admin but allow on confirm? *Recommend (b) — a soft warning preserves awareness without blocking the office's
  "keep referring while the employer is still hiring" workflow.* Needed for Phase 4.
- **D3 — Vacancy slot timing (#6).** Reserve the slot at admin-endorse, or only at seeker-accept? *Recommend
  reserve-at-accept with an endorsement guard, to avoid slots frozen by undecided seekers.*
- **D4 — Walk-in account model (#7).** Real `users` row (staged/claimable) — recommended — vs a separate
  staging table merged later. *Recommend staged claimable `users` row (one centralized model, the brief's ask).*
- **D5 — SMS provider (#8).** Semaphore (PH-local, cheap) vs Twilio (robust, pricier) vs other. *Recommend a
  short spike on Semaphore first given the Kabankalan context; keep the provider behind the abstraction so it's
  swappable.*

---

## Explicitly NOT touching (guardrail)

Per the critical constraint, none of the following change unless a requirement above explicitly names them:
the referral outbox worker mechanics, letter generation/durability (0.13), OTP public signup (§7.9), the
Document Builder (§30), the input-hash guard *mechanism* (§29 — its baselines merely re-compute after the #11a
prompt change), the Super Admin subsystem beyond adding the new role to role-administration, the theme token
system (§24), the unified applications feed (§28), the DiceBear avatar system, existing notification
types/deep-links, and all DB column names (frozen, §0.7 — new work is additive migrations only).

**In scope by explicit request (supersedes any "untouched" reading above):** the AI scoring **prompt/inputs**
(#11a, measured via §21's eval harness), the **vacancy cap + auto-fill (invariant 0.12)** and
`isJobFilled`/`filledLabel` semantics (#11b), and the referral **lifecycle states** (#6). These are changed
deliberately, flag-gated, and re-measured.
```
