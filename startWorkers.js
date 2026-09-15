/**
 * Shared background-worker bootstrap — the SINGLE place the six outbox workers
 * (§18.1) are wired up, so the web entrypoint (server.js) and the dedicated
 * worker entrypoint (worker.js) start/stop identical sets and can never drift.
 *
 * ── WHY THIS EXISTS (SKILL §25, roadmap item 2) ─────────────────────────────
 * Today everything runs in ONE process (server.js starts the API + these workers).
 * When the budget allows the worker-process split, the web service sets
 * WORKER_MODE=web (server.js then runs the API only) and a separate Render
 * Background Worker service runs `node worker.js` (these workers only). This module
 * is what makes that a one-flag change instead of a rewrite.
 *
 * ── `io` IS OPTIONAL ────────────────────────────────────────────────────────
 * Pass the live Socket.IO server (web/single process) so a finished re-score /
 * referral / notification can nudge the right user's room in real time. Pass null
 * (dedicated worker process — no HTTP, no io) and every emit safely no-ops: each
 * worker guards its emit (`if (!io) return`), the DB stays the single source of
 * truth (invariant 0.3), and real-time simply degrades to the existing poll
 * backstops (90s Applicant-Pipeline poll §18.9, bell refetch) until Redis bridges
 * the two processes (SKILL §25, roadmap item 3). Nothing is lost, only immediacy.
 */

const { startReferralWorker, stopReferralWorker } = require('./services/referralWorker');
const { startEmailWorker, stopEmailWorker } = require('./services/emailWorker');
const { startNotificationDigest, stopNotificationDigest } = require('./services/notificationDigest');
const { startApplicationScoringWorker, stopApplicationScoringWorker } = require('./services/applicationScoringWorker');
const { startJobMatchWorker, stopJobMatchWorker } = require('./services/jobMatchWorker');
const { startProactiveReferralWorker, stopProactiveReferralWorker } = require('./services/proactiveReferralWorker');
const { startSmsWorker, stopSmsWorker } = require('./services/smsWorker');

/**
 * Start all seven outbox workers. `io` may be null (see file header).
 *
 * ── WHY ONLY TWO WORKERS RECEIVE `io` (audit A2, intentional) ────────────────
 * Only the referral and application-scoring workers push a client socket event
 * (`referral_issued` / `scores_updated`), so only they take `io`. The other five
 * emit NOTHING to a browser and are correctly started without it:
 *   - emailWorker / notificationDigest / smsWorker — deliver to email / SMS, no client.
 *   - jobMatchWorker (job alerts) — its result is a DURABLE notification row; the
 *     live push (if any) is best-effort and poll-backstopped, so it uses the single
 *     notification writer directly, not a socket here.
 *   - proactiveReferralWorker — only POPULATES the Smart Referral Queue table, which
 *     the admin fetches on visit; it has nothing to push. (A real-time nudge here
 *     would be a deliberate future enhancement, and would wire `io` at that point.)
 * Passing `io` to a worker that never emits would be misleading dead code, so we don't.
 */
function startAllWorkers(io = null) {
	startReferralWorker(io);
	startEmailWorker();
	startNotificationDigest();
	// io lets a completed re-score nudge the owning admin's Applicant Pipeline to
	// refetch in real time (hybrid polling); the 90s poll is the backstop.
	startApplicationScoringWorker(io);
	startJobMatchWorker();
	startProactiveReferralWorker();
	// 7th outbox worker (§18.1) — drains sms_outbox via the swappable smsService
	// provider. Self-gates: dormant unless a provider is configured (SMS ships dark).
	startSmsWorker();
}

function stopAllWorkers() {
	stopReferralWorker();
	stopEmailWorker();
	stopNotificationDigest();
	stopApplicationScoringWorker();
	stopJobMatchWorker();
	stopProactiveReferralWorker();
	stopSmsWorker();
}

module.exports = { startAllWorkers, stopAllWorkers };
