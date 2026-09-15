# AI Processing Workflow — execution flow, log guide & optimization notes

Operational reference for the two AI-driven background pipelines and the log lines
they emit. Written to answer, during testing, "what just happened and is it normal?"

Cross-references: `SKILL.md` §7.4 (scoring engine), §7.5 (outbox pattern), §18.1
(worker roster), §18.5 (re-scoring), §20 (proactive referrals), §22 (performance).

---

## 1. The two pipelines (don't confuse them)

Both are transactional-outbox workers (a DB table drained by an in-process poll loop,
§7.5). They are **separate** and answer different questions:

| Pipeline | Question | Outbox table | Worker | Writes |
|---|---|---|---|---|
| **Application re-scoring** | "Refresh the LIVE compatibility score of a seeker's *own* active applications." | `application_scoring_jobs` | `applicationScoringWorker` | `job_applications.current_match_score` |
| **Proactive matching** | "Which *existing applicants* (who never applied here) are strong matches for this vacancy?" | `proactive_match_jobs` | `proactiveReferralWorker` | `proactive_referral_candidates` (Smart Referral Queue) |

They share ONE scoring engine — `aiScoringService.scoreApplication()` (§7.4, real-or-NULL,
never fabricated) — used in two directions: re-scoring scores a seeker's applications
against their jobs; proactive scores a job against many seekers' résumés.

---

## 2. Worked example — decoding your log excerpt

```
[Scoring]   Re-score armed for 6 active application(s) of user 6.        (A)
[Proactive] Seeker 6 evidence changed → re-armed match for 9 open job(s). (B)
[Scoring]   Re-score armed for 6 active application(s) of user 6.        (A again)
[Proactive] Seeker 6 evidence changed → re-armed match for 9 open job(s). (B again)
[SLOW 2974ms] GET /api/peso-admin/ats/applicants?...&search=88 -> 304    (C)
[ProactiveWorker] Job 270002: 0 candidate(s) surfaced.                    (D)
[ScoringWorker]   Application 1 re-scored → 50%.                          (E)
```

### (A) `[Scoring] Re-score armed …` — QUEUE SCHEDULING (not AI yet)
Emitted by `applicationScoringService.enqueueForUser(userId)`. **Trigger:** the seeker
changed a scoring input — a **résumé** save (builder) or **upload**, or a **certificate**
attach. It ENQUEUES a re-score row for each of that seeker's ACTIVE applications
(`enqueueForUserActiveApplications`), debounced ~90s. **No AI runs here** — it only writes
outbox rows. "6 active applications" = the seeker has 6 applications in an active ATS state
(see §4).

> **A profile-field save (name/phone/skills) does NOT arm re-scoring** — the scorer reads
> only résumé `parsed_text` + certs + the job, never `users` profile columns (SKILL §18.5).
> If you see (A) after editing a profile, a résumé/cert was also touched.

### (B) `[Proactive] Seeker N evidence changed → re-armed match …` — QUEUE SCHEDULING
Emitted by `proactiveReferralService.enqueueForSeeker(userId)`, fired by the **same** résumé/
cert change, **only when `PROACTIVE_REMATCH_ON_EDIT=true`** (double-gated by
`PROACTIVE_REFERRALS_ENABLED`). A stronger résumé might newly qualify the seeker for jobs
they *didn't* apply to, so it re-arms proactive matching for their OPEN, not-yet-applied
vacancies (`openJobsForSeeker`, capped 25). Again **no AI here** — it enqueues
`proactive_match_jobs` rows. "9 open jobs" = the bounded set they haven't applied to / been
decided on (see §5).

**Why A and B fire back-to-back:** one résumé change is an input to BOTH pipelines — it
changes the seeker's own application scores (A) AND their proactive eligibility (B). Two
independent subsystems reacting to one event. Expected.

### (C) `[SLOW …ms] GET …/ats/applicants` — a slow HTTP request (unrelated to the workers)
From `requestTiming` middleware (§22.4), logged when a request exceeds `SLOW_REQUEST_MS`
(1000). `-> 304` = the admin's Applicant Pipeline refetched and the server returned Not
Modified. On Render free tier a ~3s first hit is cold-start + query latency, not the AI
workers. It's a read; it schedules no scoring.

### (D) `[ProactiveWorker] Job N: X candidate(s) surfaced.` — WORKER EXECUTION result
`proactiveReferralWorker` drained one `proactive_match_jobs` row: it generated candidates,
AI-scored the shortlist, kept those ≥ threshold, and upserted them. `0 surfaced` is
common and usually correct — see §6.

### (E) `[ScoringWorker] Application N re-scored → P%.` — WORKER EXECUTION + DB UPDATE
`applicationScoringWorker` drained one `application_scoring_jobs` row: ran the AI engine and
wrote `current_match_score = P`. This is the only line here that represents an actual AI call
completing and a live score being persisted.

---

## 3. Log-line taxonomy (queue vs worker vs DB vs frontend)

| Log line | Layer | Meaning |
|---|---|---|
| `[Scoring] Re-score armed for N …` | **Queue scheduling** | rows enqueued into `application_scoring_jobs` (no AI) |
| `[Proactive] Seeker N evidence changed → …` | **Queue scheduling** | rows enqueued into `proactive_match_jobs` (no AI) |
| `[ScoringWorker] Application N re-scored → P%` | **Worker + DB write** | AI ran; `current_match_score` written |
| `[ScoringWorker] Application N: no score, previous kept` | **Worker** | AI returned NULL (no résumé / down / hallucination) — previous score kept (0.2) |
| `[ScoringWorker] Application N skipped — finalized/ineligible` | **Worker** | app became Referred mid-flight; skipped, no AI (§18.5) |
| `[ProactiveWorker] Job N: X candidate(s) surfaced` | **Worker + DB write** | proactive match ran; X candidates upserted |
| `[SLOW …ms] GET/POST …` | **HTTP** | a request breached the slow threshold; nothing to do with the queues |
| `scores_updated` / `referral_issued` (socket) | **Frontend refresh** | best-effort real-time nudge so a UI refetches; DB is source of truth |

There is **no dedicated log line for a frontend refresh** — those happen client-side off the
socket nudges above; the server only logs the emit indirectly.

---

## 4. How ACTIVE applications are selected for re-scoring
`applicationScoringRepository` uses `ACTIVE_STATUSES = ['Applied','Under Review','Shortlisted']`.
An application is re-scorable only if its status is in that set AND it is **not finalized**
(no Approved referral / not `Referred`). A **Referred** application is a finalized business
record — its apply-time score is frozen history and it is never re-scored (§18.5). The worker
re-checks this at run time (`is_referred` guard) to close the race where a referral is approved
after the re-score was queued.

## 5. How OPEN vacancies are selected for proactive matching
`openJobsForSeeker(userId, cap=25)`: `pesoadmin_job_posts` with status `Open`/`Published`, that
the seeker has **not applied to**, and is **not already Dismissed/Promoted** for. Capped so one
résumé edit can't fan out to every vacancy.

## 6. Why a proactive job reports `0 candidate(s) surfaced`
`0` is normal and usually correct. Candidate generation (`generateCandidates`) is a cheap SQL
funnel that only considers seekers who: are active applicants, **have a parsed résumé**, have
**already applied to ≥1 job** (the consent/intent basis), have **not** applied to *this* job,
and were **not** already dismissed/promoted for it. Then each survivor is AI-scored and only
those **≥ `proactive_referral_threshold` (75, §20)** are kept. So `0` means one of: no eligible
seekers for that vacancy, or none scored ≥ 75. It is not an error. (Also note: candidates are
owner-scoped to the vacancy's admin, so the platform total can exceed any one admin's queue —
§20.4.)

## 7. How the final AI Compatibility Score is determined
`aiScoringService.scoreApplication()` (§7.4, §21): reads the seeker's résumé `parsed_text`
(+ any PDF certificate text as extra context), plus the job's title/skills/qualifications/
experience/education; prompts DeepSeek via the unified `aiClient` (OpenRouter↔DeepSeek failover
+ circuit breaker) at **temperature 0 + JSON mode** so the result is reproducible; validates the
`overall` is a number in 0–100. Returns `{overall, skills, education, experience, summary}` or
**NULL** on any failure — never a fabricated number. The worker writes `overall` to
`current_match_score`; on NULL it keeps the previous score.

## 8. Debounce & dedupe — how duplicate work is prevented
- **Debounce:** an enqueue sets `next_run_at = now + SCORING_DEBOUNCE_SECONDS` (~90s), so a
  burst of edits within the window collapses into one run.
- **Dedupe:** the outbox has a UNIQUE key per unit of work (`application_scoring_jobs` per
  `application_id`; `proactive_match_jobs` per `job_id`), and enqueue is `INSERT … ON DUPLICATE
  KEY UPDATE` that **re-arms the existing pending row** rather than adding a second. So even
  though the LOG line prints on every arm, the underlying row is coalesced.
- **Atomic claim:** the worker claims a row with a conditional `UPDATE … WHERE status='pending'`
  (TiDB has no `SKIP LOCKED`), so two workers/ticks never double-process one row.

## 9. Is the repeated logging redundant work? (verdict)
**The repeated *log lines* are mostly cosmetic; the repeated *work* is largely already
coalesced.** Seeing (A)+(B) twice means the trigger fired twice for one user action — see the
optimization below. But because of debounce + the UNIQUE-key upsert, two arms within ~90s
update the SAME pending rows and produce **one** AI run per application/job. So correctness and
cost are already protected; the noise is the issue, not double-billing.

The one genuine inefficiency your log shows is the **duplicated trigger** (A/B appearing twice
per save) — a résumé save path firing the enqueue twice. That schedules redundant *queue
writes* (cheap) and doubles the log noise (confusing), though the debounce still collapses the
actual AI work.

---

## 10. Optimization opportunities (correctness & business logic preserved)

Ordered by ROI. None change the scoring result, the eventual-consistency guarantees, or the
outbox pattern.

1. **De-duplicate the trigger (the "appears twice" cause).** A résumé save currently arms
   re-scoring/re-match more than once per user action (two identical (A)+(B) pairs). Fix at the
   source: ensure the résumé builder-save and upload paths call `enqueueForUser` / `enqueueForSeeker`
   **once** per request (guard against a double-invoke / double-submit), or coalesce per request.
   Impact: halves the queue writes and the log noise; **no** change to AI runs (debounce already
   collapses them). *Lowest-risk, highest clarity gain.*
2. **Downgrade the "armed" logs to debug, add a coalesce counter.** Print the arm lines only
   when `LOG_LEVEL=debug`, or once per debounce window with a count ("armed 6 apps; 0 new, 6
   re-armed"). Turns a wall of repeated lines into one meaningful line. Operational clarity only.
3. **Skip a re-score when the scoring inputs are unchanged.** If a résumé save didn't change
   `parsed_text` (and no cert changed), the score cannot change — so skip the enqueue. (Note:
   SKILL §18.5 records that an over-aggressive dirty-check was reverted once because it swallowed
   real re-scores; re-introduce this **narrowly** — compare a hash of `parsed_text` — and keep a
   test that a genuine résumé change still re-scores.)
4. **Batch the proactive re-arm.** `enqueueForSeeker` loops `enqueueMatch` per open job (up to
   25 single-row upserts). Replace with one multi-row `INSERT … ON DUPLICATE KEY UPDATE`. Fewer
   round-trips per edit; identical outcome.
5. **Cool-down proactive re-match.** On-edit proactive matching re-scores a seeker against up to
   25 vacancies each time; for a seeker editing repeatedly this is the largest AI-cost driver.
   Add a per-seeker cool-down (e.g. skip if re-armed in the last N minutes) or keep it
   `PROACTIVE_REMATCH_ON_EDIT=false` and rely on on-publish matching. Bounds AI spend.
6. **Investigate the slow `/ats/applicants` (C) separately.** It's an HTTP read, not the workers.
   If it stays >1s under load, capture a fresh `/admin/timing` snapshot (§22.8) before tuning —
   likely cold-start; a `search=` filter path may also benefit from an index review.

**What NOT to change:** the outbox pattern, temperature-0 determinism, real-or-NULL scoring, the
90s debounce as the coalescing mechanism, or the finalized-referral exclusion — these are the
correctness guarantees (§0.2, §7.5, §18.5).
