/**
 * DEDICATED BACKGROUND-WORKER ENTRYPOINT (SKILL §25, roadmap item 2).
 *
 * ── NOT USED BY THE CURRENT SINGLE-SERVICE DEPLOY ───────────────────────────
 * server.js still runs the API + workers in one process (WORKER_MODE unset). This
 * file exists so the worker-process split is a ONE-CLICK deploy when the budget
 * allows — no rewrite:
 *   1. Create a Render **Background Worker** service from this same repo.
 *   2. Start command: `node worker.js`  (or `npm run worker`).
 *   3. On the WEB service, set `WORKER_MODE=web` so it stops running the workers.
 *   4. Give BOTH services the same env (DB_*, AI keys, the *_ENABLED flags, etc.).
 * The workers are already "run-anywhere" — they claim jobs with an atomic
 * conditional UPDATE (TiDB has no SKIP LOCKED, §7.5), so two processes draining the
 * same outbox tables can never double-process.
 *
 * ── WHAT IT RUNS ────────────────────────────────────────────────────────────
 * ONLY the six outbox workers (§18.1) — no Express, no HTTP listen. `io` is null,
 * so worker-originated real-time Socket.IO nudges (scores_updated, referral_issued,
 * notifications) safely no-op and degrade to the existing poll backstops (90s
 * pipeline poll §18.9, bell refetch) until Redis bridges the two processes
 * (roadmap item 3). The DB is the job store + single source of truth (invariant
 * 0.3), so nothing is lost — only real-time immediacy, temporarily.
 *
 * A standalone process gets no dotenv from server.js, so load it here.
 */

require('dotenv').config();

// Requiring the pool connects to TiDB (initDB is skipped unless DB_INIT_ON_BOOT, §22.3).
require('./db');
const { startAllWorkers, stopAllWorkers } = require('./startWorkers');
const { verifyMailTransport } = require('./services/mailService');

verifyMailTransport();
startAllWorkers(null); // no io in a headless worker process — emits no-op (see header)

console.log('[Worker] Dedicated worker process started (no HTTP). Draining the outbox tables; real-time emits are no-ops until Redis (SKILL §25).');

// KEEP THE PROCESS ALIVE. Every worker's poll timer is `.unref()`'d (so it never
// blocks server.js's shutdown), and this headless process has NO http server to
// hold the event loop — without an explicit ref'd handle Node would exit the instant
// startup finishes and the platform would restart-loop the worker. One ref'd no-op
// heartbeat holds the loop; the SIGINT/SIGTERM handlers below still stop it cleanly.
const keepAlive = setInterval(() => {}, 60000);

function shutdown() {
	clearInterval(keepAlive);
	stopAllWorkers();
	process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
