const os = require('os');
const proactiveReferralRepository = require('../repositories/proactiveReferralRepository');
const proactiveReferralService = require('./proactiveReferralService');

/**
 * Proactive AI Referral worker (Phase 1).
 *
 * Drains the proactive_match_jobs outbox: for each Open/Published vacancy it runs the
 * matching pipeline (candidate generation → AI score → threshold → upsert candidates)
 * via proactiveReferralService.matchJob, then advances the row. Same outbox mechanics
 * as the other workers (atomic claim, backoff, dead-letter, stuck-reclaim, §7.5). It
 * only POPULATES the Smart Referral Queue — it never creates a referral (that is an
 * administrator's explicit action in Phase 2, invariant 0.4).
 *
 * GATED BY PROACTIVE_REFERRALS_ENABLED: dormant unless set to "true", so the feature
 * ships dark. AI cost is bounded by the candidate cap (system setting), not this loop.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-proactive`;

const POLL_INTERVAL_MS = Number(process.env.PROACTIVE_POLL_MS) || 20000;
const BATCH_SIZE = Number(process.env.PROACTIVE_BATCH_SIZE) || 2;
const STALE_LOCK_SECONDS = Math.max(60, Math.round((Number(process.env.PROACTIVE_STUCK_MS) || 600000) / 1000));

let running = false;
let ticking = false;
let timer = null;

function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

async function processJob(job) {
	const claimed = await proactiveReferralRepository.claim(job.id, WORKER_ID);
	if (!claimed) return;

	try {
		const { matched } = await proactiveReferralService.matchJob(job.job_id);
		await proactiveReferralRepository.markDone(job.id, matched);
		console.log(`[ProactiveWorker] Job ${job.job_id}: ${matched} candidate(s) surfaced.`);
	} catch (error) {
		const attemptsUsed = job.attempts + 1; // claim() already incremented the stored value
		if (attemptsUsed >= job.max_attempts) {
			await proactiveReferralRepository.fail(job.id, error.message);
			console.error(`[ProactiveWorker] Job ${job.job_id} DEAD after ${attemptsUsed} attempts: ${error.message}`);
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await proactiveReferralRepository.reschedule(job.id, delay, error.message);
			console.warn(`[ProactiveWorker] Job ${job.job_id} attempt ${attemptsUsed}/${job.max_attempts} failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick() {
	if (ticking || !running) return;
	ticking = true;
	try {
		const reclaimed = await proactiveReferralRepository.reclaimStuck(STALE_LOCK_SECONDS);
		if (reclaimed > 0) console.warn(`[ProactiveWorker] Reclaimed ${reclaimed} stuck job(s).`);

		const jobs = await proactiveReferralRepository.findDue(BATCH_SIZE);
		for (const job of jobs) {
			if (!running) break;
			await processJob(job);
		}
	} catch (error) {
		console.error('[ProactiveWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

function startProactiveReferralWorker() {
	if (process.env.PROACTIVE_REFERRALS_ENABLED !== 'true') {
		console.log('[ProactiveWorker] Disabled (PROACTIVE_REFERRALS_ENABLED is not "true").');
		return;
	}
	if (running) return;
	running = true;
	console.log(`[ProactiveWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);
	// Observability for the §29 change-detection guard (read per-call in matchJob; logged here
	// at boot so "is it actually on?" is visible — a trailing space would show OFF, §13).
	console.log(`[ProactiveWorker] input-hash guard ${process.env.PROACTIVE_INPUT_HASH_GUARD === 'true' ? 'ON' : 'OFF'} (PROACTIVE_INPUT_HASH_GUARD).`);
	tick();
	timer = setInterval(tick, POLL_INTERVAL_MS);
	if (timer.unref) timer.unref();
}

function stopProactiveReferralWorker() {
	running = false;
	if (timer) { clearInterval(timer); timer = null; }
	console.log('[ProactiveWorker] Stopped.');
}

module.exports = { startProactiveReferralWorker, stopProactiveReferralWorker, WORKER_ID };
