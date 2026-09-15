# Employer Role Integration — Implementation Plan

**Status:** Approved design, not yet implemented.
**Origin:** Adviser recommendation to evolve PESO Kabankalan into a centralized,
role-based employment platform with a dedicated Employer role.

---

## 0. The core insight (read this first)

This is **not** adding a new role — it is **un-conflating** two roles the system
already fused. The platform began as a job-tracker where an "employer" posted
jobs, was refactored into PESO, and in that refactor **"employer" was merged into
"PESO Administrator."** Verified in the live code and data:

- `middleware/rbac.js`: `ROLE_ALIASES = { employer → peso_administrator, ... }`
- Live data: **all 22 job postings owned by 7 `peso_administrator` accounts.**

So the adviser is asking us to **split the role the system already merged.** Much
vestigial "employer" scaffolding still exists to build on (the `/api/employer`
route alias, the `moderation_status` column on job posts, the `peso_admin_id`
FK = "poster"), but everything currently assumes poster == moderator == referrer
are the same person.

> **Honesty caveat:** this cannot be done "without disrupting current
> functionality." Today the PESO admin *is* the employer. The moment we split
> them, the current "PESO posts jobs" flow changes and existing PESO-admin
> posting capability is removed and reassigned. Better to be explicit than to
> pretend it is purely additive.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Who issues the official referral letter? | **PESO stays the issuer (Model A)** — employer shortlists → PESO approves & signs → employer reports placement. Preserves the referral engine and PESO's placement-reporting role (invariant 0.4). |
| 2 | Can PESO post on an employer's behalf (walk-in / phoned-in jobs)? | **Yes** — `employer_id` is NULLable (NULL = "PESO posted on behalf"). Matches real PESO ops and gives the 22 legacy posts a valid home with no forced migration. |
| 3 | How are employer accounts created? | **Self-register → Pending → PESO verifies.** Scalable; needs the verification module built first. |

**Still open (not blocking Phase 0):**
- Do any of the 7 existing `peso_administrator` accounts get reclassified as
  employers, or do all their 22 posts become "PESO-on-behalf"? (Demo-data story.)
- Does AI still pre-stage candidates to PESO's queue, or is referral staging now
  *only* employer-initiated? (Model A works either way.)

---

## 2. Role model & RBAC

`users.role` is a free VARCHAR (no enum), so the value needs **no schema
migration** — but the code changes are exacting.

| Role | Stored value | Loses | Gains |
|---|---|---|---|
| Job Seeker | `applicant` | — | — |
| **Employer** | `employer` *(new)* | — | `company:manage`, `jobs:manage-own`, `applicants:review-own`, `interviews:manage`, `messages:candidates`, `referrals:request`, `placement:report` |
| PESO Administrator | `peso_administrator` | **`jobs:post`** | `employers:verify`, `jobs:moderate`, `applicants:monitor` (read-only), `placements:record`; **keeps** `referrals:approve` |
| Super Administrator | `admin` | — | — |

**Mandatory first tasks (highest bug risk):**
1. **Delete `ROLE_ALIASES.employer → peso_administrator`** in `rbac.js`. Until
   gone, the new role collides with every existing PESO-admin path.
2. **Audit every role-string comparison** (`=== 'employer'`,
   `=== 'peso_administrator'`, `.includes('admin')`) across backend + frontend.
   One such bug was already found and fixed in the Messages header this session;
   there will be more.
3. **Review `normalizeRole()`'s fail-open** (unknown role → Job Seeker). Register
   `EMPLOYER` atomically in `rbac.js` **and** frontend `roles.js` in one change,
   or an employer silently degrades into a job seeker.

---

## 3. Data model — all additive (expand→migrate→contract; invariant 0.7 frozen columns)

| Migration | Change | Notes |
|---|---|---|
| `020_employer_foundation` | `employer_profiles` (user_id PK, company_name, industry, address, contact_person/phone, website, `logo_thumb`, `verification_status ENUM('Pending','Verified','Rejected','Suspended')`) | Reuses the existing org-profile machinery (`PesoAdminProfile` / `/api/peso-admin/profile`), repointed from PESO admins to employers. Logo uses the client-side thumbnail pipeline. |
| `020` | `employer_verifications` (id, employer_id, document_thumb + full, status, reviewed_by, remarks, submitted_at, reviewed_at) | **Fresh, self-contained** — deliberately does NOT touch the orphaned `job_seeker_verifications` (invariant 0.9). |
| `021_job_ownership` | `pesoadmin_job_posts` + `employer_id INT NULL` | NULL = "PESO posted on behalf." 22 legacy posts keep NULL — no forced migration. Table name stays (frozen); it is now a misnomer — document it. |
| `021` | Formalize existing `moderation_status`: `'Pending'|'Approved'|'Rejected'|'Flagged'` | Employer posts start **Pending** (dark until PESO approves); PESO-on-behalf default **Approved**. |
| `022_placement_loop` | `referral_queue` + `placement_status ENUM('Pending','Hired','Not Hired','No Show')`, `placement_reported_at`, `placement_reported_by` | Closes the loop — the DOLE placement KPI. |
| `022` | `application_interviews` (application_id, scheduled_at, location, mode, notes, created_by) | Separate from the seeker's private `usertrackedjobs.interview_*` (different table, different owner). |

---

## 4. Master workflow (three actors → modules)

```
EMPLOYER      self-registers → [Pending] ─────────────────┐
PESO ADMIN    reviews docs → Verify/Reject ───────────────┘→ [Verified]
EMPLOYER      posts vacancy → [Moderation: Pending]
PESO ADMIN    moderates → Approve ─────────────────────────→ LIVE on Public Job Board
JOB SEEKER    applies (Apply Wizard, unchanged) ───────────→ EMPLOYER's ATS (+ AI match score)
EMPLOYER      reviews, schedules interview, messages, updates status
EMPLOYER      "Request Referral" for shortlisted candidate ─┐
PESO ADMIN    approves → [existing outbox pipeline] ────────┘→ signed letter emailed to seeker (0.4 intact)
JOB SEEKER    receives referral (My Referrals, unchanged)
EMPLOYER      "Report Hiring Outcome" → Hired / Not Hired / No Show
PESO ADMIN    placement recorded → analytics / DOLE reporting
```

The **entire referral engine** (transactional outbox, PDF, email, audit,
retry/dead-letter) is untouched. Model A adds exactly two touchpoints: an
employer-initiated `referrals:request` staging path (parallel to today's
`stageAiRecommendation`) and a `placement:report` endpoint.

---

## 5. Module-by-module impact

| Module | Today | After |
|---|---|---|
| Onboarding | Job-seeker signup only | + Employer signup → *pending* gate (can log in, cannot post) |
| **Employer Verification** *(NEW)* | — | Employer submits PH business docs (DTI/SEC/Mayor's permit); PESO queue: verify/reject/suspend; gates posting |
| Company Profile | PESO admin "Organization Profile" | Repointed to Employer; PESO admins (gov staff) lose it |
| Job Publication Mgr | PESO admin authors jobs | → **Employer** authors own; PESO version becomes **Moderation Queue** + limited "post on behalf" form |
| Public Job Board | `company` text | Verified-employer identity + logo + **"Verified Employer"** badge |
| Apply Wizard | → PESO ATS | → **Employer** ATS (owner-scoped by `employer_id`); AI score surfaces to employer |
| ATS | PESO, per-vacancy | Re-owned to **Employer**; PESO gets **read-only oversight** (applicant monitoring) |
| **Interview Scheduling** *(NEW)* | Only on seeker's private tracker | Employer schedules on the real application → notifies seeker → shows on timeline |
| Referral Mgmt | AI → PESO approves | Employer **requests** → PESO **approves & issues** → employer **reports placement** |
| AI Compatibility | Stages to PESO queue | Same engine; **employer** sees the band; PESO keeps AI-Recommended as a matchmaking tool |
| Messaging | applicant↔peso_admin | Primary: applicant↔**employer**; PESO read-only oversight (peer-by-ID header already generalized) |
| Notifications | — | New types (§7) via single-writer service |
| Resume Analysis | per-application snapshot | **Unchanged** — employer ATS reads existing snapshot + parse |
| Analytics | Seeker + PESO | + **Employer** funnel; + PESO **aggregate placement** stats (government KPI) |

---

## 6. Portals — sidebars & dashboards

**Employer sidebar:** Dashboard · Company Profile · Job Vacancies (own) ·
Applicant Pipeline (own ATS) · Interviews · Referral Requests · Communications ·
Analytics.
**Employer dashboard:** active vacancies · applicants to review · interviews
scheduled · referrals requested/issued · placements · funnel KPIs (reuse
`MetricCard` + the analytics patterns already built).

**PESO Admin sidebar (revised):** Oversight Dashboard · **Employer Verification**
· **Job Moderation** · Applicant Monitoring (read-only) · AI Recommended
(matchmaking) · Referral Register (approve/issue) · **Placement Reports** ·
Analytics · Communications (oversight). *"Post Vacancy" removed.*

**Job Seeker portal:** unchanged (referral card reflects the employer
relationship).

The existing role-switched `Sidebar.jsx` + `AppLayout` slots a 4th role in
cleanly.

---

## 7. Notifications matrix (single-writer `notificationService`)

| Event | Recipient | Type | Deep link |
|---|---|---|---|
| Employer verified / rejected | Employer | `EMPLOYER_VERIFICATION` | `/employer/profile` |
| Vacancy approved / rejected | Employer | `JOB_MODERATION` | `/employer/jobs` |
| New employer awaiting verification | PESO Admin | `VERIFICATION_PENDING` | `/peso-admin/verify-employers` |
| New posting awaiting moderation | PESO Admin | `MODERATION_PENDING` | `/peso-admin/moderation` |
| New applicant | **Employer** (was PESO) | `NEW_APPLICATION` | `/employer/ats` |
| Interview scheduled | Job Seeker | `INTERVIEW_SCHEDULED` | `/jobs` |
| Referral requested | PESO Admin | `REFERRAL_REQUEST` | `/referrals/recommended` |
| Referral issued | Job Seeker + Employer | `REFERRAL_ISSUED` | `/referrals` |
| Placement reported | PESO Admin | `PLACEMENT_REPORTED` | `/peso-admin/placements` |

---

## 8. Phased delivery (each phase ships independently; demo never bricks)

| Phase | Scope | Done when |
|---|---|---|
| **0 — Plumbing** | Add `EMPLOYER` role, remove alias, audit role checks; migrations 020–022 (schema only) | Role resolves everywhere; no behavior change; build green |
| **1 — Identity** | Employer self-register + pending gate + PESO verification queue | Employer registers, PESO verifies; jobs still PESO-owned |
| **2 — Vacancies** | Employer job manager + PESO moderation queue | Verified employer posts; PESO approves; appears on board |
| **3 — ATS** | Re-own applicant review/status/interviews/messaging to employer; PESO oversight | Employer manages own applicants end-to-end |
| **4 — Referral loop** | Employer request-referral → PESO issue → employer report-placement → analytics | A placement flows from application to recorded outcome |
| **5 — Polish** | Per-role dashboards, sidebars, analytics, badges | Each role has a coherent portal |

**Recommended start: Phase 0** — pure additive plumbing that de-risks everything
after it.

---

## 9. Invariants preserved

0.1 (never fail primary action) · **0.4 (a named PESO human approves every
referral letter — Model A keeps this)** · 0.7 (frozen columns — all additive) ·
0.9 (don't build on the orphaned seeker-verification — employer verification is
fresh) · single-writer notifications · owner-scoping · expand→migrate→contract ·
the client-side thumbnail pipeline for employer logos.
