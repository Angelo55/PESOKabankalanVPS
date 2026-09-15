const os = require('os');
const smsOutboxRepository = require('../repositories/smsOutboxRepository');
const { sendSms, isSmsConfigured } = require('./smsService');

/**
 * SMS delivery worker (Phase 6, #8) — the 7th outbox worker (§18.1).
 *
 * The single-step twin of services/emailWorker.js. Everything true of that worker is
 * true here — it runs IN-PROCESS on a poll interval, the job store IS the database
 * (no broker, no setTimeout, §0.3), claiming is an atomic conditional UPDATE so
 * multiple instances are safe, and a tick failing never kills the loop. One step:
 * send via the swappable smsService provider.
 *
 * GATED BY A CONFIGURED PROVIDER: it starts only when isSmsConfigured() (SMS_PROVIDER
 * + its key are set). With no provider the worker never starts, so any stray
 * sms_outbox row sits harmlessly pending until a provider is wired — the channel
 * ships dark by default (docs/sms-notification-proposal.md §6). WHETHER a notification
 * is enqueued for SMS at all is a separate decision made by the notificationService
 * channel router (the sms_notifications_enabled setting + a verified, opted-in phone).
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-sms`;

const POLL_INTERVAL_MS = Number(process.env.SMS_OUTBOX_POLL_MS) || 7000;
const BATCH_SIZE = Number(process.env.SMS_OUTBOX_BATCH_SIZE) || 10;
const STALE_LOCK_SECONDS = Math.max(30, Math.round((Number(process.env.SMS_OUTBOX_STUCK_MS) || 300000) / 1000));

let running = false;
let ticking = false;
let timer = null;

/**
 * Exponential backoff, capped at one hour — copied from emailWorker rather than
 * shared, so neither worker's schedule can be changed by a tweak meant for the other.
 */
function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

/** Delivers one queued SMS. `job.attempts` is the count BEFORE this attempt. */
async function processRow(job) {
	const claimed = await smsOutboxRepository.claim(job.id, WORKER_ID);
	if (!claimed) return; // another worker got it, or its state changed — not an error

	try {
		// sendSms is best-effort and NEVER throws; it returns { ok, provider, id }. We
		// treat ok:false as a retryable failure so a provider blip re-queues with backoff.
		const result = await sendSms(job.to_number, job.body);
		if (!result || !result.ok) {
			throw new Error(`provider send failed (${result?.reason || 'unknown'})`);
		}

		await smsOutboxRepository.markSent(job.id, result.provider || 'sms', result.id || null);
		console.log(`[SmsWorker] Row ${job.id} (${job.template_key}) sent via ${result.provider}.`);
	} catch (error) {
		// findDue() read attempts BEFORE claim() incremented it, so the DB now holds
		// job.attempts + 1. Mirror emailWorker's off-by-one handling.
		const attemptsUsed = job.attempts + 1;

		if (attemptsUsed >= job.max_attempts) {
			await smsOutboxRepository.fail(job.id, error.message);
			console.error(`[SmsWorker] Row ${job.id} DEAD after ${attemptsUsed} attempts: ${error.message}`);
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await smsOutboxRepository.reschedule(job.id, delay, error.message);
			console.warn(`[SmsWorker] Row ${job.id} attempt ${attemptsUsed}/${job.max_attempts} failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick() {
	if (ticking || !running) return;
	ticking = true;

	try {
		const reclaimed = await smsOutboxRepository.reclaimStuck(STALE_LOCK_SECONDS);
		if (reclaimed > 0) console.warn(`[SmsWorker] Reclaimed ${reclaimed} stuck row(s) from a previous crash.`);

		const rows = await smsOutboxRepository.findDue(BATCH_SIZE);
		for (const job of rows) {
			if (!running) break;
			await processRow(job);
		}
	} catch (error) {
		console.error('[SmsWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

/**
 * Starts the worker. No-op unless a provider is configured, so the default deploy
 * (SMS_PROVIDER unset) leaves the table dormant and the channel dark.
 */
function startSmsWorker() {
	if (!isSmsConfigured()) {
		console.log('[SmsWorker] Disabled (no SMS provider configured). SMS channel is dark.');
		return;
	}
	if (running) return;
	running = true;

	console.log(`[SmsWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);
	tick(); // drain any backlog immediately on boot
	timer = setInterval(tick, POLL_INTERVAL_MS);
	if (timer.unref) timer.unref();
}

function stopSmsWorker() {
	running = false;
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	console.log('[SmsWorker] Stopped.');
}

module.exports = { startSmsWorker, stopSmsWorker, WORKER_ID };
