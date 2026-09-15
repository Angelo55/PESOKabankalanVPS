const os = require('os');
const jobAlertsRepository = require('../repositories/jobAlertsRepository');
const jobAlertsService = require('./jobAlertsService');

/**
 * AI job-alert worker (Enhancement D).
 *
 * Drains the job_alert_jobs outbox: for each newly published vacancy it runs the
 * matching pipeline (candidate generation → AI score → threshold → deliver) via
 * jobAlertsService.matchJob, then advances the row. Same outbox mechanics as the
 * other workers (atomic claim, backoff, dead-letter, stuck-reclaim, §7.5). It also
 * fires the once-a-day digest (runDigestIfDue) on its tick — a DB marker paces it.
 *
 * GATED BY JOB_ALERTS_ENABLED: dormant unless set to "true", so the feature ships
 * dark. Matching AI cost is bounded by the candidate cap + per-day cap (system
 * settings), not this loop.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-jobmatch`;

const POLL_INTERVAL_MS = Number(process.env.JOB_ALERT_POLL_MS) || 15000;
const BATCH_SIZE = Number(process.env.JOB_ALERT_BATCH_SIZE) || 2;
const STALE_LOCK_SECONDS = Math.max(60, Math.round((Number(process.env.JOB_ALERT_STUCK_MS) || 600000) / 1000));

let running = false;
let ticking = false;
let timer = null;

function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

async function processJob(job) {
	const claimed = await jobAlertsRepository.claim(job.id, WORKER_ID);
	if (!claimed) return;

	try {
		const { matched } = await jobAlertsService.matchJob(job.job_id);
		await jobAlertsRepository.markDone(job.id, matched);
		console.log(`[JobMatchWorker] Job ${job.job_id}: ${matched} seeker(s) matched/alerted.`);
	} catch (error) {
		const attemptsUsed = job.attempts + 1; // claim() already incremented the stored value
		if (attemptsUsed >= job.max_attempts) {
			await jobAlertsRepository.fail(job.id, error.message);
			console.error(`[JobMatchWorker] Job ${job.job_id} DEAD after ${attemptsUsed} attempts: ${error.message}`);
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await jobAlertsRepository.reschedule(job.id, delay, error.message);
			console.warn(`[JobMatchWorker] Job ${job.job_id} attempt ${attemptsUsed}/${job.max_attempts} failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick() {
	if (ticking || !running) return;
	ticking = true;
	try {
		const reclaimed = await jobAlertsRepository.reclaimStuck(STALE_LOCK_SECONDS);
		if (reclaimed > 0) console.warn(`[JobMatchWorker] Reclaimed ${reclaimed} stuck job(s).`);

		const jobs = await jobAlertsRepository.findDue(BATCH_SIZE);
		for (const job of jobs) {
			if (!running) break;
			await processJob(job);
		}

		// Once-a-day digest for seekers on the "daily" frequency (paced by a marker).
		await jobAlertsService.runDigestIfDue();
	} catch (error) {
		console.error('[JobMatchWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

function startJobMatchWorker() {
	if (process.env.JOB_ALERTS_ENABLED !== 'true') {
		console.log('[JobMatchWorker] Disabled (JOB_ALERTS_ENABLED is not "true").');
		return;
	}
	if (running) return;
	running = true;
	console.log(`[JobMatchWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);
	tick();
	timer = setInterval(tick, POLL_INTERVAL_MS);
	if (timer.unref) timer.unref();
}

function stopJobMatchWorker() {
	running = false;
	if (timer) { clearInterval(timer); timer = null; }
	console.log('[JobMatchWorker] Stopped.');
}

module.exports = { startJobMatchWorker, stopJobMatchWorker, WORKER_ID };
