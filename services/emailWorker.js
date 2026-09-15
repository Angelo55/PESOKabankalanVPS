const os = require('os');
const emailOutboxRepository = require('../repositories/emailOutboxRepository');
const { sendMail } = require('./mailService');

/**
 * Generic email delivery worker (Phase 2C).
 *
 * The single-step twin of services/referralWorker.js. Everything true of that
 * worker is true here — it runs IN-PROCESS on a poll interval, the job store IS
 * the database (no broker, no setTimeout, invariant 0.3), claiming is an atomic
 * conditional UPDATE so multiple instances are safe, and a tick failing never
 * kills the loop — EXCEPT that the referral pipeline is a state machine
 * (generate_pdf → send_email → notify → dispatch_n8n) while this one has exactly
 * one step: send. There is no PDF, no notification, no n8n; a row is either sent
 * or retried or dead-lettered.
 *
 * WHY NOT REUSE THE REFERRAL WORKER: referral letters carry an attachment and a
 * multi-step lifecycle and MUST stay on their own outbox (blueprint §1 boundary).
 * Conflating the two would drag attachment handling and step logic into a queue
 * that is meant to be dead simple. Two small workers over one shared table each
 * is the wrong trade.
 *
 * GATED BY EMAIL_OUTBOX_ENABLED: unset/false → the worker never starts and every
 * sender sends inline exactly as before (the flag-based rollback in blueprint
 * §10). The flag is read once at startEmailWorker(); flipping it requires the
 * env change + restart the blueprint's deploy sequence already prescribes.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-email`;

const POLL_INTERVAL_MS = Number(process.env.EMAIL_OUTBOX_POLL_MS) || 5000;
const BATCH_SIZE = Number(process.env.EMAIL_OUTBOX_BATCH_SIZE) || 10;
// Blueprint expresses the stuck timeout in ms (default 5 min); the SQL uses
// INTERVAL ? SECOND, so convert once here.
const STALE_LOCK_SECONDS = Math.max(30, Math.round((Number(process.env.EMAIL_OUTBOX_STUCK_MS) || 300000) / 1000));

let running = false;   // is the worker enabled
let ticking = false;   // is a tick currently in flight (prevents overlap)
let timer = null;

/**
 * Exponential backoff, capped at one hour — the exact shape referralWorker uses,
 * copied rather than shared so neither worker's schedule can be changed by a tweak
 * intended for the other.
 *   attempt 1 -> 60s   attempt 2 -> 120s   attempt 3 -> 240s   attempt 4 -> 480s
 */
function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

/**
 * Delivers one queued email. `job` is the row as read by findDue(), so
 * `job.attempts` is the count BEFORE this attempt; claim() increments the stored
 * value, and the failure branch adds 1 to match (see below).
 */
async function processRow(job) {
	const claimed = await emailOutboxRepository.claim(job.id, WORKER_ID);
	if (!claimed) {
		// Another worker got it, or its state changed under us. Not an error.
		return;
	}

	try {
		await sendMail({
			to: job.to_email,
			subject: job.subject,
			html: job.body_html || undefined,
			text: job.body_text || undefined,
		});

		// mailService returns only the messageId; the provider that actually
		// delivered is in its own log. Record 'primary' as a coarse marker so the
		// column is never null on success without claiming precision we don't have.
		await emailOutboxRepository.markSent(job.id, 'primary');
		console.log(`[EmailWorker] Row ${job.id} (${job.category}) sent to ${job.to_email}.`);
	} catch (error) {
		// findDue() read attempts BEFORE claim() incremented it, so job.attempts is
		// stale by one — the DB now holds job.attempts + 1. Mirror referralWorker.
		const attemptsUsed = job.attempts + 1;

		if (attemptsUsed >= job.max_attempts) {
			await emailOutboxRepository.fail(job.id, error.message);
			console.error(`[EmailWorker] Row ${job.id} DEAD after ${attemptsUsed} attempts: ${error.message}`);
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await emailOutboxRepository.reschedule(job.id, delay, error.message);
			console.warn(`[EmailWorker] Row ${job.id} attempt ${attemptsUsed}/${job.max_attempts} failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick() {
	// Overlap guard: a long tick must not start a second on top of it. Claiming is
	// atomic so it would be SAFE, but it would also be pointless load.
	if (ticking || !running) return;

	ticking = true;

	try {
		const reclaimed = await emailOutboxRepository.reclaimStuck(STALE_LOCK_SECONDS);
		if (reclaimed > 0) {
			console.warn(`[EmailWorker] Reclaimed ${reclaimed} stuck row(s) from a previous crash.`);
		}

		const rows = await emailOutboxRepository.findDue(BATCH_SIZE);
		for (const job of rows) {
			if (!running) break;
			await processRow(job);
		}
	} catch (error) {
		// A tick failing must NEVER kill the loop; the DB could be briefly
		// unreachable and the next tick simply tries again.
		console.error('[EmailWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

/**
 * Starts the worker. No-op unless EMAIL_OUTBOX_ENABLED === 'true', so the default
 * deploy (flag unset) leaves the table dormant and every sender inline — the
 * behaviour the rollback plan depends on.
 */
function startEmailWorker() {
	if (process.env.EMAIL_OUTBOX_ENABLED !== 'true') {
		console.log('[EmailWorker] Disabled (EMAIL_OUTBOX_ENABLED is not "true"). Senders send inline.');
		return;
	}

	if (running) return;

	running = true;

	console.log(`[EmailWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);

	// Run once immediately so a restart drains the backlog without waiting.
	tick();

	timer = setInterval(tick, POLL_INTERVAL_MS);

	// unref() lets Node exit naturally instead of being held open by the timer.
	if (timer.unref) timer.unref();
}

function stopEmailWorker() {
	running = false;

	if (timer) {
		clearInterval(timer);
		timer = null;
	}

	console.log('[EmailWorker] Stopped.');
}

module.exports = { startEmailWorker, stopEmailWorker, WORKER_ID };
