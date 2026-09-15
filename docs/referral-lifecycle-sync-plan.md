# Synchronized Referral Lifecycle — Design & Implementation Blueprint

**Status:** IMPLEMENTED, 2026-08-05 — approved and built. Ships behind the runtime
flag `referral_lifecycle_sync_enabled` (Super-Admin system setting, default OFF).
Migration `036_referral_outcome_history.sql` applied to prod TiDB. Cross-referenced
from `SKILL.md` §7.11 / §18.5 and `docs/session-continuation-2026-08-02.md`.

**Panel origin:** a request to make the referral lifecycle *consistent and
synchronized* end-to-end — the seeker should see the same referral state the office
does, be notified when it changes, and be able to report what they hear from the
employer, without any duplicate or conflicting records.

---

## 0. The audit that reframed the request

Three surfaces the request named turned out NOT to be on the referral axis at all —
they are the seeker's **private, manually-managed external-job tracker**, which has
no link to PESO vacancy applications or referrals:

| Surface | Component | Reads | Table | What it is |
|---|---|---|---|---|
| "Application Pipeline Analytics" | `Analytics.jsx` | `GET /applications` | `applications` | Private self-entered job-hunt log (FusionCharts) |
| "My Applications" (Kanban) | `MyJobs.jsx` (`/jobs`) | `GET /tracked-jobs` | `usertrackedjobs` | Private manual tracker of EXTERNAL jobs |
| Seeker Dashboard | `Dashboard.jsx` | `/tracked-jobs` + `/analytics/pipeline` | `usertrackedjobs` | KPIs over that private tracker |

Applying to a PESO vacancy inserts only into `job_applications` — it never mirrors
into `usertrackedjobs`/`applications`. And **no endpoint exposed the seeker's own
`job_applications`**, so a seeker had zero visibility into their PESO application
lifecycle until a referral appeared in "My Referrals".

**Two rulings were taken before implementation:**
1. **Build a seeker PESO pipeline** (not inject "Referred" into the private tracker) —
   matches "single source of truth / no redundant data."
2. **Admin-official / seeker-suggests** for outcomes — a seeker report never enters the
   official placement statistics until an administrator confirms it (invariant 0.14).

---

## 1. What shipped

### Workstream A — Seeker PESO Application Pipeline (always-on; a pure visibility fix)
- **`GET /api/applications/mine`** (`routes/applicationRoutes.js`) — owner-scoped
  `job_applications` + job + referral state + outcome, via correlated subqueries (no
  JOIN multiplication, no `userprofiles` — 0.8). Distinct from `/api/tracked-jobs`.
- **`components/MyPesoApplications.jsx`** at `/my-applications` — a READ-ONLY 4-column
  pipeline board (Applied → Under Review → Shortlisted → **Referred**) + metric cards
  (Total / In review / Referred / Hired). Status is system-driven, so there is no
  drag-and-drop. A Referred card shows the outcome, reference number, and a link to the
  referral. Silent refresh on mount, tab re-focus, and the outcome socket trigger.
- Sidebar entry "PESO Applications" (`Building2`), distinct from "My Applications".
- **Deep-link fix:** the `APPLICATION_STATUS` notification now links to
  `/my-applications` (it previously pointed at `/jobs`, the private tracker that never
  contained the application). "Referred" transition is automatic —
  `referralService.approveReferral` already sets `job_applications.status='Referred'`
  in its transaction (§18.5).

### Workstream B — Outcome sync + collaborative model (flag-gated)
- **Confirmed defect fixed:** `referralRepository.listForApplicant` now `LEFT JOIN
  referral_outcomes` and selects `outcome/outcome_at/notes`, so "My Referrals" shows the
  real recorded outcome instead of a permanent "Awaiting outcome".
- **Official write (admin) —** `referralService.recordOutcome` unchanged for the official
  `referral_outcomes` row (still the ONLY thing the DOLE report + landing tile count,
  0.14). When the flag is on it additionally: appends an `is_official=1`
  `referral_outcome_history` row, notifies the seeker (`REFERRAL_OUTCOME`), and emits
  `referral_outcome_updated`. All secondary effects are wrapped (0.1).
- **Seeker suggestion —** `POST /api/referrals/:id/outcome/suggest` +
  `referralService.suggestOutcome`: owner-scoped to the applicant, appends an
  `is_official=0` history row, logs `OUTCOME_SUGGESTED`, notifies the issuing admin, and
  emits. **Never calls `setOutcome`** — a suggestion cannot move official statistics.
  Route is flag-gated (403 when off).
- **Structured ledger —** migration `036` `referral_outcome_history` (queue_id, outcome,
  outcome_at, previous_outcome, notes, changed_by, changed_by_role, is_official,
  created_at). Read via `GET /api/referrals/:id/outcome/history` (same access rules as
  `/activity`). The human-readable `referral_activity_log` timeline is unchanged and
  still records `OUTCOME_RECORDED` / `OUTCOME_SUGGESTED` always.
- **Register UX —** the admin `OutcomeModal` fetches the ledger, surfaces the latest
  pending seeker suggestion in a banner with a one-click "Use this report" prefill; Save
  runs the ordinary official path (the administrator stays the author, 0.4-spirit).
- **My Referrals UX —** seekers get a "Report update" action opening `SuggestOutcomeModal`
  (gated by the flag); the copy is explicit that PESO confirms it before it counts.
- **Real-time —** `ChatContext` adds one `referral_outcome_updated` listener →
  `outcomeRefreshTrigger`; My Referrals and the new pipeline refetch silently. One socket,
  one owner. The DB stays source of truth (0.3); a missed push costs immediacy only.

### Runtime feature flag
- `referral_lifecycle_sync_enabled` — `systemSettingsService` boolean, env fallback
  `REFERRAL_LIFECYCLE_SYNC_ENABLED`, default **false**, read per call (§7.12). Exposed to
  the client via `GET /api/config/features` → `AuthContext.features`. Gates: the seeker
  suggestion endpoint + UI, the admin confirm affordance, outcome-change notifications,
  the structured history writes, and the socket sync. When OFF, outcome recording behaves
  exactly as before (official write + activity log only); the pipeline view and outcome
  visibility remain (pure improvements).

---

## 2. Notification type
New muteable type **`REFERRAL_OUTCOME`** wired in both required places (§7.7):
`CONTROLLABLE_TYPES` (`notificationRoutes.js`) and `TYPE_META` (`NotificationBell.jsx`);
links to `/referrals` for both parties.

## 3. Invariants respected
0.1 (secondary effects wrapped; the official write commits first) · 0.3 (DB is the store;
no new worker — outcome recording is synchronous) · 0.4 (the administrator authors the
official outcome; the seeker only suggests) · **0.14 (a seeker suggestion NEVER enters
`referral_outcomes`; official stats are admin-only)** · 0.11 (notifications only via
`notificationService`) · 0.16-spirit (every transition is auditable — activity log +
structured ledger with actor/role/prev→new) · §7.5 (one async pattern; nothing new here
is async) · §7.12 (the tunable is a per-call system setting).

## 4. Files
**Backend:** `migrations/036_referral_outcome_history.sql`; `services/systemSettingsService.js`
(+flag); `routes/configRoutes.js` (new) + `server.js` mount; `repositories/referralRepository.js`
(listForApplicant outcome cols; appendOutcomeHistory / listOutcomeHistory / findPendingSuggestion);
`services/referralService.js` (recordOutcome+io/notify/history; suggestOutcome; getOutcomeHistory;
isLifecycleSyncEnabled); `routes/referralRoutes.js` (io into recordOutcome; suggest + history routes);
`routes/notificationRoutes.js` (`REFERRAL_OUTCOME`); `routes/applicationRoutes.js` (`GET /mine`);
`routes/pesoAdminRoutes.js` (deep-link → `/my-applications`).
**Frontend:** `context/AuthContext.jsx` (features); `context/ChatContext.jsx` (outcome trigger);
`components/MyPesoApplications.jsx` (new); `components/Referrals.jsx` (suggest modal + pending-suggestion
banner + suggest action + socket refetch); `components/layout/NotificationBell.jsx` (TYPE_META);
`components/Sidebar.jsx` (nav); `App.jsx` (route).
**Tests:** `test/referralOutcomeSync.test.js` — 7 source-only guards (outcome cols; official vs
suggestion; the 0.14 no-`setOutcome` boundary; owner-scope; flag gate; `/mine` reads the right table;
migration shape). `npm test` = 36/36.

## 5. Deployment & rollback
- Merge → `npm run migrate` (036 additive; applied) → flip
  `REFERRAL_LIFECYCLE_SYNC_ENABLED=true` (or set the Super-Admin setting) when validated →
  watch. **Scrub trailing spaces** on the Render env value (`true ` disables a flag, §13).
- **Rollback:** set the flag OFF — the seeker-suggest channel and outcome notifications go
  dormant with no code deploy; the additive table stays (never dropped on live TiDB, 0.7).

## 6. Deferred / not done (deliberate)
- The private tracker (`MyJobs.jsx` / `Analytics.jsx`, FusionCharts) is untouched — per
  ruling 1, "Referred" was NOT injected there.
- A seeker's *pending suggestion* is not yet shown on their own My Referrals row (they see a
  success toast + the activity trail); adding a per-row "you reported X — awaiting
  confirmation" badge would need a suggestion column on `/referrals/mine`. Low priority.
- Seeker PESO-pipeline analytics are metric cards + the board; a richer historical chart
  (recharts) can follow if the office wants trend lines.
