# Proactive AI Referral Workflow — Design & Implementation Blueprint

**Status:** IMPLEMENTED (P1–P4), 2026-08-02 — approved and built. Ships dark behind
`PROACTIVE_REFERRALS_ENABLED`; migrations `032`–`033` apply via `npm run migrate`.
**Panel origin:** recommendation from the System Proposal defence (2026-07-31) to add a
PESO-Administrator-initiated referral path alongside the seeker-initiated one.
This document follows the same blueprint shape as `docs/phase-2c-email-outbox-plan.md`
and `docs/phase-2d-ai-enhancements-plan.md`. Cross-referenced from `SKILL.md` §20.

---

## 0. Objective

Today a referral requires a seeker to find a vacancy, apply, and wait for PESO to
review. The panel asked to *also* let a PESO Administrator **proactively refer** an
existing applicant to a vacancy they never applied to, using data the system already
holds (resume, AI compatibility, work history, education, skills, certificates). The
system continuously scores existing applicants against Open/Published vacancies; strong
matches surface in a **Smart Referral Queue** an administrator reviews and promotes into
a real referral — with no duplicate application, full audit history, and the seeker
clearly informed.

**The whole theme:** turn the AI Match Score into a *sourcing* signal for administrators,
not just an apply-time number — WITHOUT weakening the invariant that a named administrator
approves every government referral (0.4).

## 1. The core architectural decision

**Reuse the entire existing referral pipeline by *materializing* an admin-initiated
`job_applications` row on promotion — do NOT decouple referrals from applications.**

A referral is FK-bound to `job_applications` (`referral_queue.application_id` is `UNIQUE`,
`ON DELETE CASCADE`) and hangs its resume snapshot, applicant snapshot, and score off that
row. Rather than rebuild all of that for a seeker who never applied, the Smart Referral
Queue holds lightweight *candidates*; on **promote**, one transaction materializes a
`job_applications` row (`origin='admin_referral'`), copies the seeker's latest resume
snapshot, and then calls the **unchanged `approveReferral`** — which enforces the vacancy
cap (0.12), mints the letter (0.13), and drives delivery through the outbox worker.

**Model A (chosen)** — a dedicated `proactive_referral_candidates` table, so no phantom
"applications" are created for seekers until an admin actually acts. (Model B — staging
straight into `referral_queue` — was rejected because its `UNIQUE`+FK on `application_id`
forces an application row per candidate up front.)

This made ~70% of the feature reuse: candidate generation + reverse AI scoring already
existed in the Job-Alerts funnel (`jobAlertsService`/`jobMatchWorker`); the referral
pipeline, letter, outbox, outcomes, and audit are untouched.

## 2. Approved decisions (from the design review)

1. **Candidate model:** A — dedicated `proactive_referral_candidates` table.
2. **Workspace name:** "Smart Referral Queue" (`/peso-admin/smart-referrals`).
3. **Threshold:** default **75**, a Super-Admin **system setting** (`proactive_referral_threshold`,
   bounded 50–95) read per call — strict, because a proactive referral is a government action.
4. **Trigger scope:** **on-publish only** first; seeker-edit re-match behind its own sub-flag
   (P4), off by default.
5. **Duplicate safety:** add a **guarded** `UNIQUE(job_id, applicant_id)` on `job_applications`
   (migration 033) on top of the app-level guards.
6. **Eligibility/consent basis:** candidate pool limited to seekers who have submitted
   **≥1 application** (existing application = intent/consent signal).

## 3. Impact assessment (the areas reviewed)

- **Database:** additive migrations 032 (candidate table, match outbox, `job_applications`
  `origin`/`referred_by`/`referred_at`) and 033 (guarded `UNIQUE`). Enum `origin` created with
  both values; future values append-only (§13).
- **Referral states:** `referral_queue` lifecycle UNCHANGED. New states live only on the
  candidate: `Suggested → Dismissed | Promoted` (Promoted = materialized + referred).
- **AI evaluation:** reuse `aiScoringService.scoreApplication({userId, job})` in reverse
  (job vs seeker's `parsed_text`) through `aiClient` (failover + breaker). Real-or-`NULL`
  (0.2). Candidate generation (cheap SQL) + candidate cap bound AI spend.
- **Workers/queues:** new `proactiveReferralWorker` drains `proactive_match_jobs` (a 6th
  outbox of the existing shape — atomic claim/backoff/dead-letter/reclaim, §7.5). Flag-gated.
- **Notifications/email:** promotion rides the existing referral worker; its notify + email
  steps read `origin` and use distinct "PESO proactively referred you" copy. Only through
  `notificationService` / the P2C HTTP-backed outbox (0.11).
- **RBAC:** the queue + promote/dismiss endpoints are `PESO_ADMINISTRATOR`-only (router
  guard) AND owner-scoped (`peso_admin_id = req.userId`) — an admin can only refer to their
  own vacancies.
- **Seeker dashboard:** a "Referred by PESO" badge on My Referrals (`origin='admin_referral'`).
- **Employer processing:** UNCHANGED — same referral letter via the same outbox.
- **Duplicate prevention:** candidate-gen excludes already-applied/decided; candidate
  `UNIQUE(job_id, applicant_id)`; `referral_queue.application_id` UNIQUE; the materialized
  row makes the existing apply-gate block a later duplicate apply; DB `UNIQUE(job_id,
  applicant_id)` (033).
- **Audit:** promotion logs `ADMIN_INITIATED` in `referral_activity_log` (visible to the
  seeker), recording the AI match and that no application was submitted.
- **API:** `GET /peso-admin/proactive/candidates`, `POST …/:id/approve`, `POST …/:id/dismiss`,
  `POST /peso-admin/proactive/rescan/:jobId`; `GET /admin/proactive` (monitor); `/admin/health`
  gains a `proactiveReferral` probe.
- **UI/UX:** `SmartReferralQueue.jsx` (ranked cards, Refer-with-confirm, Dismiss, pagination);
  Super Admin `ProactiveReferrals.jsx` monitor; sidebar + routes.
- **Performance/scalability:** candidate cap + worker batch + on-publish-only default keep AI
  spend bounded; matching never blocks publishing (fire-and-forget, 0.1).

## 4. Phased implementation (all shipped)

| Phase | Commit | Scope |
|---|---|---|
| **P1** | `0128cc8` | Migration 032; `proactiveReferralRepository` (outbox + candidate-gen with the ≥1-application gate) + `proactiveReferralService.matchJob` + `proactiveReferralWorker`; on-publish triggers; settings `proactive_referral_threshold`(75)/`proactive_candidate_cap`(50); `/admin/health` probe. |
| **P2** | `808abd1` | Queue endpoints; the materialize-application→`approveReferral` transaction with compensation; duplicate guard + apply-gate reuse; `SmartReferralQueue.jsx` + nav + route. |
| **P3** | `f481452` | `origin` selected in `findReferralById`/`listForApplicant`; origin-aware notification + email copy; `ADMIN_INITIATED` audit entry; "Referred by PESO" seeker badge. |
| **P4** | `15d087e` | Migration 033 (guarded `UNIQUE`); seeker-edit re-match (`enqueueForSeeker`, double-gated by `PROACTIVE_REMATCH_ON_EDIT`, bounded); Super Admin monitor (`GET /admin/proactive` + `ProactiveReferrals.jsx`). |

## 5. Testing

`test/proactiveReferral.test.js` (source-only, AI mocked, never `require('../db')`, §13) — 6
guards: `findJobForMatching` real column aliasing + owner select; candidate-gen
eligibility/dedup/cost gates; upsert never resurrects a decided candidate; `openJobsForSeeker`
bounds/exclusions; migration 032 dedup UNIQUEs + `origin` enum; migration 033 `UNIQUE`. Full
suite `npm test` = 13/13.

## 6. Migrations, env & settings

- **Migrations:** `032_proactive_referrals.sql`, `033_job_applications_unique.sql` — additive.
  033 is GUARDED: run its documented read-only dedup pre-check first; a UNIQUE-add on TiDB is
  non-destructive if a dup exists. Apply with `npm run migrate` (announces the prod host).
- **Env flags:** `PROACTIVE_REFERRALS_ENABLED` (master — worker dormant unless `"true"`),
  `PROACTIVE_REMATCH_ON_EDIT` (seeker-edit re-match sub-flag, off by default),
  `PROACTIVE_POLL_MS`/`PROACTIVE_BATCH_SIZE`/`PROACTIVE_STUCK_MS` (worker tuning, safe defaults).
- **System settings (§7.12, per-call):** `proactive_referral_threshold` (75, bounded 50–95),
  `proactive_candidate_cap` (50). Also honour env `PROACTIVE_REFERRAL_THRESHOLD`/`PROACTIVE_CANDIDATE_CAP`.

## 7. Deployment & rollback

- Merge dark → `npm run migrate` (032, then 033 after the dedup check) → flip
  `PROACTIVE_REFERRALS_ENABLED=true` → watch `/admin/proactive` + Platform Health backlog →
  leave on. **Deployed 2026-08-02** (Render worker started; flags on).
- **Rollback:** `PROACTIVE_REFERRALS_ENABLED=false` stops the matcher and hides the queue with
  no code deploy; additive tables/columns stay (never drop on live TiDB, 0.7). A promoted
  referral is a normal referral — void it through the existing flow if needed.

## 8. Invariants respected

0.1 (publish/edit never fails on matching; every enqueue fire-and-forget) · 0.2 (real-or-NULL
score) · 0.3 (DB is the job store — a 6th outbox, no new mechanism) · **0.4 (a named admin
approves every referral — the promote action IS the approval)** · 0.11 (notifications via
`notificationService`, email via the P2C outbox) · 0.12 (vacancy cap via `approveReferral`) ·
0.13 (durable letter) · 0.16-spirit (full audit trail incl. `ADMIN_INITIATED`) · §7.5 (one
async pattern) · §7.12 (tunables are per-call system settings).
