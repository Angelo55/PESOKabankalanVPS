# Referral Management — Review & Enhancement Plan

**Status:** proposal, nothing implemented
**Reviewed:** 2026-07-23, against commit `7199925`
**Scope:** `referral_queue` · `referral_letters` · `referral_jobs` · `referral_activity_log`,
`services/referral*.js`, `repositories/referralRepository.js`, `routes/referralRoutes.js`,
`Referrals.jsx` · `AiRecommendedPanel.jsx` · `FailedReferralsPanel.jsx` · `ReferralActionButton.jsx`

---

## 0. What the review found, in one paragraph

The referral *pipeline* is well built. The transactional outbox, the conditional-claim
worker, the vacancy cap under `FOR UPDATE`, the human-approval gate, the dead-letter
path — all of that is sound and is doing its job in production. What does not exist
is referral **management**. The system can issue a letter and prove it was emailed;
it cannot tell you whether anyone was hired, cannot show an administrator the audit
trail it is diligently writing, cannot produce the report PESO owes DOLE, and stores
the signed government document itself on a filesystem that Render erases on every
deploy. The gap is not in the machinery. It is in everything that happens after the
email is sent, plus one storage decision that quietly puts the existing records at risk.

---

## 1. Production baseline (read-only probe, live TiDB, 2026-07-23)

Grounding the plan in what the module has actually done rather than what it can do.

| Signal | Value |
|---|---|
| `referral_queue` by status | **Approved: 27**. Zero `Pending AI`, zero `Pending Review`, zero `Rejected` |
| `referral_letters` | 27, all `Sent`, all have a `pdf_path` |
| `referral_jobs` (outbox) | 27, all `completed` / `done` |
| Activity log | `REFERRAL_APPROVED` 27 · `PDF_GENERATED` 27 · `EMAIL_SENT` 27 · `NOTIFICATION_SENT` 27 · `N8N_DISPATCHED` **25** · `DELIVERY_FAILED` 7 · `JOB_FILLED` 4 · `DELIVERY_RETRIED` 2 · `AI_RECOMMENDED` **1** |
| Letter files on disk | **42** vs 27 rows in the database |

Four numbers in that table are the whole story:

- **`AI_RECOMMENDED` = 1 against 27 approvals.** The AI-Recommended queue — its own
  sidebar entry, its own panel, its own endpoint — has mediated ~4% of referrals.
  Everything else was approved straight from the ATS.
- **`Rejected` = 0, ever.** The reject path is fully implemented and has never once
  been used.
- **`N8N_DISPATCHED` = 25, not 27.** Two referrals completed without reaching n8n and
  nothing anywhere surfaces that.
- **42 files, 27 rows.** The document store has already drifted from the database.

---

## 2. Findings

Ordered by consequence, not by effort.

### F1 — Referral letters are stored on an ephemeral filesystem · **Critical**

`referral_letters.pdf_path VARCHAR(500)` points into `storage/referrals/`, and
`GET /api/referrals/:id/letter` serves it with `fs.existsSync` + `fs.createReadStream`.

Render's filesystem does not survive a deploy. Every redeploy destroys all 27 signed
letters while leaving 27 database rows insisting they exist. This directly violates
architecture invariant **0.5 — durable binaries live in the DB as base64**, which the
codebase already honours for the *application* resume snapshot in `application_resumes`.
The referral letter — the document that actually carries a government signature — is
the one binary that did not get that treatment.

The route already anticipates the failure:

> "The letter file is missing from storage."

That string exists because someone foresaw exactly this. And the 42-vs-27 file drift
shows the store is unmanaged today even before a deploy wipes it.

**Fix:** a `referral_letter_files` table holding the PDF as base64, written inside the
same transaction that records `PDF_GENERATED`. Keep `pdf_path` as a fallback read for
already-generated letters, backfill what still exists on disk, then stop writing it.
Same expand → migrate → contract shape as migration 019.

### F2 — The lifecycle ends at "email sent" · **Critical**

`referral_queue.status` is `ENUM('Pending AI','Pending Review','Approved','Rejected')`.
`Approved` is terminal. Nothing models what happens next, which is the part PESO is
actually mandated to care about: did this citizen get the job?

The consequence has already leaked into the product. The landing page counts
**"Successful Referrals" as approved `referral_queue` rows** — so a referral that was
emailed and then ignored by the employer is being reported to the public as a success.
That is not a cosmetic problem; it is the headline placement metric of a government
employment office being computed from "we sent a PDF".

**Fix:** an outcome dimension, appended to the enum (TiDB allows appending only) or
better as a separate `referral_outcomes` table so the approval state and the placement
state stay independently queryable:

`Issued → Employer Acknowledged → Interview Scheduled → Hired / Not Hired / Withdrawn / No Response`

with `outcome_at`, `outcome_by`, and a free-text `outcome_notes`. Recorded manually by
the administrator (realistic — employers phone PESO, they do not use a portal), with an
optional applicant-side self-report that lands as unconfirmed until an admin confirms it.
Then repoint the landing-page `hires` tile at `Hired`, which is what that word means.

### F3 — The audit trail is written but unreadable · **High**

`referral_activity_log` faithfully records nine action types across 121 rows. No
endpoint exposes it and no screen renders it. For a workflow whose entire defensibility
argument is "a named administrator approved every one" (invariant 0.4), the evidence
is write-only.

**Fix:** `GET /api/referrals/:id/activity` (owner-scoped, same access rules as the
letter route) and a timeline on the referral detail. Add an `ip_address` and
`user_agent` column while touching it. Consider append-only enforcement — no UPDATE or
DELETE path should exist in code.

### F4 — AI-Recommended queue is nearly unused · **High**

1 staged recommendation against 27 approvals. Either `REFERRAL_AI_THRESHOLD` is set so
high that almost nothing qualifies, or administrators simply work in the ATS and never
visit the queue. Both are worth knowing and neither is currently observable.

**Fix:** instrument before redesigning. Log every scoring decision and its distance
from the threshold, then look at the distribution before changing the number. If the
threshold is fine and the queue is just in the wrong place, the answer is to surface
recommendations *inside* the ATS row where the work already happens, rather than
maintaining a separate destination nobody opens.

### F5 — Rejection is implemented and never used · **Medium**

Zero rejections in the entire history. A reviewer who declines an applicant currently
just... does not approve, leaving the record indistinguishable from one nobody looked
at. That is a real audit gap: "considered and declined" and "never reviewed" must not
look the same in a government process.

**Fix:** find out whether the button is missing, unclear, or deliberately avoided before
building anything. If it is being avoided because a rejection feels final, a
`Deferred`/`On Hold` state may be the honest thing the workflow is missing.

### F6 — No pagination anywhere · **Medium**

`listForEmployer` has no `LIMIT`; search, filter and sort in `Referrals.jsx` are all
client-side over the full array. Correct and fast at 27 rows. At a few thousand it
ships the entire referral history — names, employers, reference numbers — on every
page load.

**Fix:** server-side pagination plus server-side search/status/date filtering. Keep the
existing client-side controls as the interaction model; move the work behind them.

### F7 — No reporting or export · **Medium**

PESO reports upward to DOLE. There is no CSV export, no date-range report, no
per-employer placement summary, no monthly referral volume. Today this is done by
reading the screen.

**Fix:** a Reports tab — date range + status + employer filters, CSV and PDF output,
built on the same query layer as F6. This becomes genuinely valuable only once F2
exists, because a placement report without outcomes is just a mail log.

### F8 — No void or cancellation path · **Medium**

Once approved, a referral can only be retried. There is no way to void one issued to
the wrong applicant, or where the employer withdrew the vacancy. The reference number
is permanently consumed and the vacancy slot stays occupied.

**Fix:** a `Voided` state with a mandatory reason, which releases the vacancy slot
inside the same transaction that voids it (mirroring how approval consumes one). Never
delete — void, and keep the record.

### F9 — No document lifecycle management · **Low**

42 files, 27 rows: 15 orphans with no owner and no cleanup. No regeneration path if a
letter is generated with bad data, no versioning, no retention policy for what is
personally identifiable information about citizens' employment.

**Fix:** largely dissolves once F1 moves letters into the database. What remains is a
regeneration action (new version, old one retained, both in the audit log) and a stated
retention policy.

### F10 — Silent n8n dispatch gap · **Low**

25 dispatched of 27 completed. `dispatch_n8n` dead-letters after 5 attempts and the
referral is considered done regardless — which is correct per invariant 0.10, n8n must
never be able to hold up a referral. But nothing reports the gap, so nobody knows two
referrals never reached the downstream system.

**Fix:** surface undispatched-but-complete referrals on the admin dashboard as an
advisory count. Not an error — an observation.

---

## 3. Proposed phases

Sequenced so each phase is independently shippable and the risky one goes first.

### Phase 1 — Protect what exists *(do this before anything else)*

- **F1** letters to base64 in the database, backfill from disk, keep `pdf_path` readable
- **F3** audit-trail endpoint + timeline UI
- **F10** undispatched advisory count

Rationale: F1 is the only finding where waiting costs data. The 27 existing letters are
one deploy away from being gone, and they are the legal artifacts of 27 real citizens'
job placements. Everything else on this list can wait; this cannot.

### Phase 2 — Close the lifecycle

- **F2** outcome tracking, and repoint the landing-page `hires` tile to real hires
- **F8** void path with vacancy-slot release
- **F5** investigate rejection, add `Deferred` if that is the real gap

This is the phase that turns the module from a letter generator into a referral
management system. Everything in Phase 3 is more valuable after it lands.

### Phase 3 — Scale and report

- **F6** server-side pagination, search, filtering
- **F7** reports and export
- **F4** AI-recommendation instrumentation, then a decision on placement

### Phase 4 — Polish

- **F9** regeneration, versioning, retention policy
- Bulk actions (approve/reject several applicants against one vacancy)
- Saved filter views

---

## 4. Explicitly not proposed

- **Moving orchestration into n8n.** Invariant 0.10. n8n stays a downstream consumer.
- **Auto-sending referrals.** Invariant 0.4. The human approval gate is the point.
- **A second async mechanism.** Anything asynchronous added here uses the existing
  outbox + worker (invariant 0.3, §7.5).
- **Reintroducing Job Seeker Verification.** Decommissioned 2026-08-01 — §14.
- **Renaming referral DB columns.** Invariant 0.7, live TiDB.

---

## 5. Open questions for PESO

These change the design and I cannot answer them from the code:

1. **Who learns the outcome, and how?** If employers phone the office, outcome capture
   is an admin form. If they would use a portal, F2 is a much larger piece of work.
2. **What does DOLE actually require in the report?** F7's shape should be driven by
   the real reporting obligation, not guessed.
3. **Is the AI threshold deliberately high?** Determines whether F4 is a tuning change
   or an information-architecture change.
4. **How long must referral letters be retained?** Drives F9's retention policy and
   whether base64-in-DB needs an archival tier.
