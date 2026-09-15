# Applicant Pipeline Auto-Refresh — Hybrid Polling + Real-Time Broadcast

**Status:** IMPLEMENTED (2026-08-01). Part of Enhancement 2D-B (AI applicant ranking
+ dynamic re-scoring). Cross-referenced from `SKILL.md` §18.9.

**MIGRATED 2026-08-01 to hybrid polling + Socket.IO broadcast.** The original design
(a fixed 45s silent poll, documented in full below) evolved — as §6 anticipated —
into the platform's standard resilience posture: **durable DB state + best-effort
Socket.IO push + a slow poll backstop**. The historical rationale is preserved
throughout this document because it explains *why* the poll interval tracks the
re-score cadence and why the DB stays the source of truth; §6 and §8 now record the
delivered hybrid rather than proposing it.

**What it is (current).** The PESO Administrator's Applicant Pipeline
(`PesoAdminATS.jsx`) keeps the ranking current **without a manual reload**, via two
cooperating paths, both of which end in the same silent, owner-scoped refetch:

1. **Real-time (fast path).** When `applicationScoringWorker` commits a new live
   score (`markScored`), it best-effort emits `scores_updated` to the owning admin's
   `user_<peso_admin_id>` room — reusing the existing Socket.IO infra (`ChatContext`
   is the sole socket owner; `socketServer.js` already joins that room). The payload
   is a **trigger only** — no scores, no applicant rows. `ChatContext` bumps
   `pipelineRefreshTrigger`; the pipeline refetches from the DB.
2. **Slow poll (resilience backstop).** A **90s** visibility-gated silent poll
   (`VITE_PIPELINE_POLL_MS`, default 90000) catches anything the socket missed — a
   dropped event, a reconnect after the tab was offline, a transient blip.

A missed push therefore costs *immediacy, never correctness*: the next poll (or a
tab-focus refetch) re-derives the same ranking from durable rows. Every refresh is
silent (no spinner, no error toast) and never disturbs the immutable apply-time score.

```js
// PesoAdminATS.jsx (essence)
const PIPELINE_POLL_MS = Number(import.meta.env.VITE_PIPELINE_POLL_MS) || 90000;

const fetchApplicants = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingApplicants(true);
    /* … build params (page/limit/sort/search/status/minScore), GET, setApplicants … */
}, [/* deps */]);

// Backstop: slow poll, paused while the tab is hidden; refetch on re-focus.
useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) fetchApplicants({ silent: true }); }, PIPELINE_POLL_MS);
    const onVisible = () => { if (!document.hidden) fetchApplicants({ silent: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
}, [fetchApplicants]);

// Fast path: a `scores_updated` push (relayed via ChatContext) triggers a refetch.
useEffect(() => {
    if (pipelineRefreshTrigger === 0) return;
    fetchApplicants({ silent: true });
}, [pipelineRefreshTrigger]);
```

```js
// applicationScoringWorker.js (essence) — emit AFTER the score commits, best-effort.
await applicationScoringRepository.markScored(job.id, job.application_id, score);
if (io && application.peso_admin_id) {
    io.to(`user_${application.peso_admin_id}`).emit('scores_updated', {
        jobId: application.job_id, applicationId: application.application_id, at: Date.now(),
    }); // wrapped: a socket failure never affects the score (invariant 0.1)
}
```

---

## 1. Why polling, not WebSockets / SSE / another real-time approach

The decision is deliberate and follows the platform's existing invariants — it is not
a shortcut.

- **The data being refreshed is worker-produced, not user-produced.** Re-scoring is a
  *background* job: an applicant edits their profile, the change is debounced ~90s,
  then the scoring worker recomputes the score and writes `current_match_score`.
  There is no synchronous "event" the admin's browser is waiting on — the freshness
  requirement is "within a minute or so", not "instant". That is a **polling-shaped**
  problem, not a real-time-shaped one.
- **The database is the source of truth (invariant 0.3).** Every background result is
  already durable in `job_applications`. Polling is *stateless*: each tick re-derives
  the current ranking from durable rows. It cannot miss an update, drift, or leave the
  UI in a phantom state if a socket drops. A callback that fires once while the tab is
  backgrounded is lost forever; a poll simply catches it on the next tick. This is the
  same reasoning that made the whole platform poll-and-drain rather than event-driven
  (see `services/referralWorker.js` header, §7.5).
- **The scoring worker has no socket handle.** `applicationScoringWorker` is started in
  `server.js` **without `io`** (unlike `referralWorker`, which takes `io` for its
  notify step). Pushing a real-time "scores updated" event today would mean threading
  `io` into the scoring worker and emitting to the owning admin's room — real work for
  a marginal latency gain (see §6 for the future hybrid path).
- **No new infrastructure, no new failure mode.** SSE needs a long-lived per-client
  streaming endpoint and connection lifecycle management; WebSockets add reconnection,
  backpressure, and room-membership bookkeeping. The platform *does* run Socket.IO
  (chat + notifications, via `ChatContext`), so real-time is *possible* — but the
  Applicant Pipeline refresh does not justify extending it. Polling is a `setInterval`
  with an `AbortController`-free `fetch`; it degrades to "slightly stale" and never to
  "broken".
- **Correctness of the immutable record is preserved either way.** The poll only reads
  the LIVE score; the apply-time score (the referral decision's source of truth, §7.4)
  is never touched. So even an over-eager or missed refresh can never corrupt history.

**In one line:** the update is eventual, worker-driven, and already durable — polling
matches the problem; real-time would be gold-plating.

## 2. Purpose of the 45-second interval

45 seconds is chosen to be **comfortably finer than the rate at which the underlying
data can actually change**, while imposing negligible load.

- Re-scores are **debounced ~90 s** (`SCORING_DEBOUNCE_SECONDS`, default 90) and the
  worker polls its queue every ~10 s (`SCORING_POLL_MS`) in small batches. So the
  *soonest* a live score changes after an edit is roughly 90–110 s. A 45 s UI poll
  guarantees the admin sees a completed re-score **within ≤45 s of it landing** —
  i.e., the UI is never more than half a re-score cycle behind. Polling faster than
  the data changes would just refetch identical rows.
- It is slow enough to be **invisible as load**: for a single municipal PESO office
  (a handful of administrators on shared terminals, §7.1), a 45 s poll of a paginated
  (10-row default) endpoint is a rounding error.
- It is **silent**: `fetchApplicants({ silent: true })` skips the spinner and the error
  toast, so a background refresh never flickers the UI or nags on a transient blip.

## 3. Impact of polling frequency (the trade-off surface)

| Dimension | Effect of a SHORTER interval | Effect of a LONGER interval |
|---|---|---|
| **Server / API traffic** | More requests/min per open pipeline. One aggregated `GET /ats/applicants` per tick — cheap, but linear in `(open admins × 60/interval)`. | Fewer requests; load approaches zero. |
| **Database** | Each tick runs the paginated list query + a `COUNT(*)` over owner-scoped joins. Indexed and 10-row-bounded, so cheap — but repeated. | Same query, less often. |
| **Background workers** | None directly — the poll only *reads*; it does not enqueue or trigger scoring. Faster polling cannot outrun the ~90 s re-score cadence, so it yields no fresher data below ~45 s. | No impact. |
| **Scalability** | Cost is `O(concurrent open pipelines / interval)`. Fine for one office; would need attention only at many simultaneous admins (see §4). | Trivially scalable. |
| **User experience** | Snappier ranking updates — but below the re-score cadence (~90 s) the extra freshness is illusory. | Staler ranking; at >60 s an admin may act on an out-of-date score between ticks. |

Key insight: **because the data source (re-scoring) is itself debounced to ~90 s,
polling faster than ~30–45 s buys latency you cannot actually observe** — you refetch
the same numbers. The interval should track the *data-change cadence*, not gut feel.

## 4. When each interval band is appropriate

- **Short (5–15 s)** — only when the refreshed data changes on that timescale AND
  users make time-critical decisions on it: live dispatch boards, trading, real-time
  moderation queues. **Not** the Applicant Pipeline: re-scores are debounced ~90 s, so
  5–15 s polling multiplies traffic 3–9× for zero observable freshness. Reserve this
  band for genuinely fast-changing, high-stakes surfaces.
- **Medium (20–30 s)** — a good fit if the office later **shortens the re-score
  debounce** (e.g. `SCORING_DEBOUNCE_SECONDS=30` for near-immediate re-evaluation), or
  during active shortlisting sessions where administrators want ranking to feel almost
  live. Pair a shorter debounce with a ~20–30 s poll so the two cadences match.
- **Long (45–60 s)** — the correct default for the **current** configuration (~90 s
  debounce, single small office). 45 s keeps the UI ≤ half a cycle behind at negligible
  cost. 60 s is acceptable and marginally cheaper; beyond 60 s the risk of acting on a
  stale score grows.

## 5. Recommended production settings for PESO Kabankalan

- **The poll is now the 90 s backstop, not the primary path.** Real-time delivery is
  the `scores_updated` push (§6); the poll only self-heals a missed event. 90 s is
  well-matched to the ~90 s re-score debounce and imposes no meaningful load.
- **Configurable without a code edit.** `VITE_PIPELINE_POLL_MS` (default 90000) tunes
  the backstop. Do **not** shorten it to chase freshness — the socket already carries
  freshness; a shorter poll only adds traffic (§3). If the socket is ever disabled,
  the poll alone still keeps the UI ≤ one interval behind.
- **Visibility-gated.** A hidden tab does not poll and refetches once on re-focus —
  the idle-open-tab waste is eliminated.
- **Tune the re-score cadence, not the poll.** If faster ranking is wanted, lower
  `SCORING_DEBOUNCE_SECONDS` first; the push then fires sooner. Changing the poll is
  ineffective — it is only the backstop now.

## 6. Hybrid polling + real-time broadcast — DELIVERED (2026-08-01)

The platform already runs Socket.IO (chat + notifications via `ChatContext`), so the
hybrid was a natural, incremental evolution — **not** a rewrite. All four steps below
are now implemented:

1. **The scoring worker has `io`.** `server.js` starts
   `startApplicationScoringWorker(io)` (it was the one worker started without it);
   `io` threads `start → tick → processJob`, exactly as `referralWorker` already did.
2. **Emit on completion.** After `markScored`, the worker best-effort emits
   `scores_updated` to `user_<peso_admin_id>` (owner scoping comes from
   `findApplicationForScoring`, which now also selects `ja.job_id` for the payload).
   The emit is wrapped and never throws — a socket failure cannot affect the score
   (invariant 0.1). Payload is a **trigger only** (jobId + applicationId + timestamp;
   never scores or applicant rows).
3. **Client listens + refetches.** `ChatContext` (the sole socket owner) adds one
   `scores_updated` listener that bumps `pipelineRefreshTrigger`; `PesoAdminATS`
   refetches *silently* on the bump — the push is the *trigger*, the existing
   `fetchApplicants` stays the *mechanism* (the DB remains the source of truth; the
   socket only shortens the delay, exactly like the notification bell). No second
   socket connection is opened (the "one socket, one owner" rule holds).
4. **Polling is the safety net.** A **90s** visibility-gated slow poll remains so a
   dropped socket or a missed event still self-heals. This is the platform's standard
   posture: durable state + best-effort push + a poll backstop.

This yields near-instant ranking updates with a fraction of the traffic, and no new
single point of failure — the poll still guarantees eventual consistency. **Event
contract:** `scores_updated`, server→client, room `user_<peso_admin_id>`, payload
`{ jobId, applicationId, at }`.

## 7. Performance considerations, monitoring, best practices

- **The refresh is read-only and owner-scoped.** It never enqueues work, never touches
  the immutable score, and returns at most one 10-row page + a count — so it cannot
  amplify load on the scoring worker or the referral pipeline.
- **Silent failure.** `{ silent: true }` swallows the spinner and error toast; a
  transient 5xx just means the next tick retries. A background refresh must never
  interrupt the administrator mid-review.
- **Monitoring.** Watch: (a) `GET /ats/applicants` request rate and p95 latency (should
  scale linearly with open pipelines, flat latency); (b) DB CPU during business hours;
  (c) the scoring-worker backlog on **Platform Health** (`/admin/health` →
  `applicationScoring` pending/failed) — a rising backlog, not the poll, is the real
  freshness risk. If request volume ever becomes material, that is the signal to adopt
  the §6 hybrid, not to shorten the interval.
- **Best practices already applied:** interval cleared on unmount (`return () =>
  clearInterval(id)`); the fetch is a `useCallback` so the poll always calls the
  current closure; a single interval per mounted component. **Recommended addition:**
  visibility-gating (§8).

## 8. Implementation notes, configuration, and roadmap

- **Interval is a named, env-configurable constant** — `PIPELINE_POLL_MS =
  Number(import.meta.env.VITE_PIPELINE_POLL_MS) || 90000` in `PesoAdminATS.jsx`. Ops
  tune it without a code edit; the default is 90 s.
- **Roadmap status:**
  1. ✅ **Named constant / env-configurable** (`VITE_PIPELINE_POLL_MS`, default 90000).
  2. ✅ **Visibility-gated** (`document.hidden` → skip; refetch on re-focus).
  3. ✅ **Hybrid real-time (§6)** — worker `io` emit + `ChatContext` listener + client
     refetch + slow poll backstop. Delivered 2026-08-01.
  4. **Align poll ↔ debounce** as a single tunable pair — still available if faster
     ranking is adopted (lower `SCORING_DEBOUNCE_SECONDS`; the push fires sooner).
- **Next (only if concurrency grows):** a dedicated `/admin` socket-health surface
  (reconnect frequency, `scores_updated` delivery success). Client-side reconnect
  logging already exists in `ChatContext`; the backstop poll makes this observability,
  not a correctness need.
- **Do not** raise the poll frequency to compensate for slow re-scoring — that is a
  *worker-throughput* concern (batch size, debounce, provider health via
  `AI_SCORING_PREFER`), addressed on the worker, not by hammering the read endpoint.

---

**Summary.** Polling every 45 s is the right choice for the current architecture:
worker-produced, already-durable, eventually-consistent data; a single small office;
and a ~90 s re-score cadence that finer polling cannot outrun. 45 s is **not** too long
for this deployment — it keeps the UI ≤ half a cycle behind at negligible cost. When
the platform grows or demands sub-30 s freshness, the documented hybrid (Socket.IO
push + slow poll backstop) is the intended evolution, reusing infrastructure that
already exists.
