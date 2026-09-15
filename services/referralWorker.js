const os = require('os');
const pool = require('../db');
const referralRepository = require('../repositories/referralRepository');
const { getNextStep, isKnownStep } = require('./referralPipeline');
const fs = require('fs');
const { generateReferralLetter, resolveLetterPath } = require('./pdfService');
const { sendMail } = require('./mailService');
const { buildReferralEmail } = require('./referralEmail');
const { notifyUser } = require('./notificationService');
const axios = require('axios');

/**
 * Referral delivery worker.
 *
 * Runs in-process, on an interval, inside the same Node app as the API.
 *
 * WHY IN-PROCESS AND NOT A SEPARATE SERVICE:
 * The job store IS the database. There is no broker, no Redis, no n8n holding
 * state. That means a worker is just "a loop that reads a table", and running
 * it inside the API process costs nothing operationally -- one deploy, one
 * container, one log stream. When load justifies it, the SAME file can be run
 * as `node worker.js` on a separate dyno with ZERO code changes, because
 * claiming is atomic at the database level. Multiple workers are already safe.
 *
 * WHY POLLING AND NOT AN EVENT/CALLBACK:
 * A callback fires once. If the process is dead at that moment, the work is
 * lost forever and nothing knows. Polling is stateless: it re-derives what
 * needs doing from durable rows, every time. It is slower and vastly harder to
 * break. For a referral letter, a 5-second latency is irrelevant; a lost letter
 * is not.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}`;

const POLL_INTERVAL_MS = Number(process.env.REFERRAL_WORKER_INTERVAL_MS) || 5000;
const BATCH_SIZE = Number(process.env.REFERRAL_WORKER_BATCH_SIZE) || 5;
const STALE_LOCK_SECONDS = Number(process.env.REFERRAL_WORKER_STALE_SECONDS) || 300;

let running = false;   // is the worker enabled
let ticking = false;   // is a tick currently in flight (prevents overlap)
let timer = null;

/**
 * Exponential backoff, capped at one hour.
 *   attempt 1 -> 60s     attempt 3 -> 240s
 *   attempt 2 -> 120s    attempt 4 -> 480s
 *
 * Capped because an unbounded curve means a job that fails 5 times is scheduled
 * days out and looks, to a PESO administrator, exactly like a job that vanished.
 */
function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

/**
 * notify -- write a durable in-app notification and push it live.
 *
 * ORDER MATTERS: the database row is written FIRST, then the socket emit. If
 * the emit fails (job seeker offline, socket server down), the notification is
 * already persisted and they will see it when they next load the app. If we
 * emitted first and the INSERT failed, the toast would flash on their screen
 * and then vanish forever, with no record it happened.
 *
 * The socket emit is deliberately NOT awaited and NOT allowed to throw. A live
 * push is a nice-to-have; the notification record is the deliverable. This is
 * graceful degradation -- Socket.IO being down must not fail a referral.
 */
async function handleNotify(job, context, io) {
	const referral = await referralRepository.findReferralById(job.queue_id);

	if (!referral) {
		throw new Error(`Referral ${job.queue_id} disappeared before it could be notified.`);
	}

	// Proactive (administrator-initiated) referrals get distinct copy so the seeker
	// understands PESO reached out on their behalf — they never applied to this job.
	const isProactive = referral.origin === 'admin_referral';
	const title = isProactive ? 'PESO referred you to an employer' : 'You have been referred';
	const body = isProactive
		? `Based on your qualifications and AI compatibility, PESO Kabankalan has proactively referred you for ${referral.job_title} at ${referral.company_name} — no application needed. Reference: ${referral.reference_number}.`
		: `PESO Kabankalan has endorsed you for ${referral.job_title} at ${referral.company_name}. Reference: ${referral.reference_number}.`;

	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();

		await referralRepository.createNotification({
			userId: referral.applicant_id,
			type: 'REFERRAL_ISSUED',
			title,
			body,
			link: '/referrals'
		}, connection);

		await referralRepository.logActivity({
			queueId: job.queue_id,
			actorId: null,
			action: 'NOTIFICATION_SENT',
			detail: `In-app notification delivered to ${referral.applicant_name} (user ${referral.applicant_id}).`
		}, connection);

		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}

	// Best-effort live push. socketServer.js already joins every authenticated
	// user to `user_${id}` on connect, so this reaches them if they are online.
	try {
		if (io) {
			io.to(`user_${referral.applicant_id}`).emit('referral_issued', {
				referralId: referral.id,
				referenceNumber: referral.reference_number,
				jobTitle: referral.job_title,
				companyName: referral.company_name,
				title,
				body
			});
		}
	} catch (error) {
		console.error('[ReferralWorker] Live push failed (notification WAS persisted):', error.message);
	}
}

/**
 * generate_pdf -- render the referral letter and record where it landed.
 *
 * IDEMPOTENCY: the DURABLE copy is the one that counts. If referral_letter_files
 * already holds this letter, skip -- regardless of what is or is not on disk,
 * because disk is no longer the source of truth. A retry after a partial
 * failure must not regenerate a letter that already exists, and the filename is
 * derived from the unique reference number, so even a full regeneration
 * produces identical content. There is no way to end up with two letters for
 * one referral.
 *
 * Both writes -- the base64 PDF and the pdf_path -- commit together with the
 * PDF_GENERATED log entry. If the transaction fails, nothing is recorded and
 * the step retries cleanly; the UI never offers a download that 404s.
 */
async function handleGeneratePdf(job) {
	const referral = await referralRepository.findReferralById(job.queue_id);

	if (!referral) {
		throw new Error(`Referral ${job.queue_id} disappeared before its letter could be generated.`);
	}

	if (!referral.reference_number) {
		throw new Error(`Referral ${job.queue_id} has no reference number. The approve transaction is broken.`);
	}

	if (await referralRepository.hasLetterFile(job.queue_id)) {
		console.log(`[ReferralWorker] Letter ${referral.reference_number} already stored. Skipping.`);
		return;
	}

	const { fileName, buffer } = await generateReferralLetter(referral);

	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();

		// The durable copy first: this is the write that must not be lost.
		await referralRepository.saveLetterFile({
			queueId: job.queue_id,
			referenceNumber: referral.reference_number,
			buffer,
			source: 'generated'
		}, connection);

		// Still recorded during the expand phase so a rollback to the previous
		// release can still find letters on disk. Drops out at contract time.
		await referralRepository.updateLetterPdfPath(job.queue_id, fileName, connection);

		await referralRepository.logActivity({
			queueId: job.queue_id,
			actorId: null,
			action: 'PDF_GENERATED',
			detail: `Referral letter ${referral.reference_number} generated (${buffer.length} bytes, stored in database).`
		}, connection);

		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

/**
 * Produces the Nodemailer attachment for a referral letter, preferring the
 * durable database copy and falling back to disk.
 *
 * Shared by send_email and (in spirit) the download route, so there is ONE
 * answer to "where do the bytes come from" and the two cannot drift.
 *
 * Throws when neither source has it. That is the correct outcome: a referral
 * email without its letter is worse than a retried one.
 */
async function resolveLetterAttachment(referral, queueId) {
	const stored = await referralRepository.findLetterFile(queueId);

	if (stored) {
		return { filename: `${referral.reference_number}.pdf`, content: stored.buffer };
	}

	if (!referral.pdf_path) {
		throw new Error(`Referral ${queueId} has no PDF. generate_pdf did not complete.`);
	}

	const absolutePath = resolveLetterPath(referral.pdf_path);

	if (!fs.existsSync(absolutePath)) {
		throw new Error(
			`Letter for ${referral.reference_number} is in neither the database nor storage. ` +
			'It predates migration 021 and its file is gone -- run scripts/backfill-referral-letters.js, ' +
			'or regenerate the letter.'
		);
	}

	console.warn(`[ReferralWorker] Letter ${referral.reference_number} served from disk (no durable copy yet).`);
	return { filename: `${referral.reference_number}.pdf`, path: absolutePath };
}

/**
 * send_email -- deliver the referral letter to the job seeker.
 *
 * AN EMAIL CANNOT BE UN-SENT. This is the only irreversible step in the
 * pipeline, and it is guarded twice:
 *
 *   1. email_status. Checked before sending. If it already reads 'Sent', we
 *      skip -- even if someone manually re-armed the job. This is the guard that
 *      makes a re-arm safe.
 *
 *   2. The step marker. Once this commits, `step` advances to 'notify' and never
 *      rewinds. A later failure retries 'notify', not this.
 *
 * The residual risk: crash AFTER Gmail accepts the message but BEFORE the
 * markLetterSent() commit. The retry would send a duplicate. This cannot be
 * closed without a transaction spanning Gmail and TiDB, which does not exist.
 * It is mitigated instead: the DB write happens IMMEDIATELY after send (tiny
 * window), and referralEmail.js is worded so a duplicate reads as a resend
 * rather than a second referral.
 *
 * A missing PDF is treated as NOT retryable -- if generate_pdf committed but
 * left no file, retrying the email 5 times will not conjure one.
 */
async function handleSendEmail(job, context, io) {
	const referral = await referralRepository.findReferralById(job.queue_id);

	if (!referral) {
		throw new Error(`Referral ${job.queue_id} disappeared before its letter could be emailed.`);
	}

	// GUARD 1: never send twice.
	if (referral.email_status === 'Sent') {
		console.log(`[ReferralWorker] Letter ${referral.reference_number} already emailed. Skipping.`);
		return;
	}

	if (!referral.applicant_email) {
		throw new Error(`Applicant ${referral.applicant_id} has no email address on file.`);
	}

	// Durable copy first, disk only as a fallback for referrals generated before
	// migration 021 that the backfill has not reached. On Render the disk branch
	// is expected to miss after any deploy -- that is precisely the failure this
	// ordering removes.
	const attachment = await resolveLetterAttachment(referral, job.queue_id);

	const { subject, text, html } = buildReferralEmail(referral);

	let messageId;

	try {
		messageId = await sendMail({
			to: referral.applicant_email,
			subject,
			text,
			html,
			attachments: [attachment]
		});
	} catch (error) {
		// Record the failure on the letter so the PESO admin sees it in the UI,
		// then rethrow so the worker's retry/backoff logic takes over.
		try {
			await referralRepository.markLetterEmailFailed(job.queue_id);
		} catch (markError) {
			console.error('[ReferralWorker] Could not mark email failed:', markError.message);
		}

		throw new Error(`SMTP delivery failed: ${error.message}`);
	}

	// The email is GONE. Commit that fact as fast as possible -- every millisecond
	// between here and the commit is the duplicate-send window.
	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();

		await referralRepository.markLetterSent(job.queue_id, connection);

		await referralRepository.logActivity({
			queueId: job.queue_id,
			actorId: null,
			action: 'EMAIL_SENT',
			detail: `Referral letter ${referral.reference_number} emailed to ${referral.applicant_email}. Message ID: ${messageId}`
		}, connection);

		await connection.commit();
	} catch (error) {
		await connection.rollback();

		// The email WENT OUT but we could not record it. This is the dangerous
		// state. Log it loudly -- a human needs to know a retry may duplicate.
		console.error(`[ReferralWorker] CRITICAL: email for ${referral.reference_number} was SENT but the database update FAILED. A retry will send a duplicate. ${error.message}`);
		throw error;
	} finally {
		connection.release();
	}

	// Tell the PESO admin who owns the posting that delivery succeeded. Runs
	// AFTER the commit and via notifyUser (which never throws), so it can
	// neither fail the step nor trigger a duplicate-send retry.
	if (referral.employer_id) {
		await notifyUser(io, {
			userId: referral.employer_id,
			type: 'REFERRAL_UPDATE',
			title: 'Referral letter delivered',
			body: `Referral ${referral.reference_number} for ${referral.applicant_name} (${referral.job_title}) was emailed to the applicant.`,
			link: '/referrals'
		});
	}
}

/**
 * dispatch_n8n -- hand a COMPLETED referral to the AUTOMATION PROVIDER for
 * side-channel work (Google Sheet logging, employer notification). The provider is
 * Make.com (AUTOMATION_WEBHOOK_URL). The self-hosted n8n it replaced (2026-09) is
 * FULLY RETIRED — the N8N_WEBHOOK_URL fallback was removed after the cutover was
 * verified (§70), so no code path can dispatch to the old n8n. The internal
 * step/action identifiers stay `dispatch_n8n` / `N8N_*` (persisted in the outbox +
 * activity log — renaming them would orphan in-flight rows and history, §59).
 *
 * This is the LAST step. By the time it runs, the letter is generated, the email
 * is sent, and the applicant is notified. The automation cannot break any of that.
 *
 * DESIGN: the automation is a consumer, not the orchestrator. If no webhook is
 * configured, this step is a no-op success -- the referral module works with no
 * automation at all. If the webhook is unreachable, the step retries with backoff,
 * then dead-letters after 5 attempts. Either way the referral itself is already done.
 *
 * This is the exact inversion of the original design, where the automation WAS the
 * pipeline and its silence killed the feature.
 */
async function handleDispatchN8n(job) {
	// The automation webhook is Make.com's, configured as AUTOMATION_WEBHOOK_URL. The
	// legacy `N8N_WEBHOOK_URL` fallback was REMOVED post-cutover (§70) — the only internal
	// n8n vestiges are the persisted step key (`dispatch_n8n`) and activity actions, LEFT
	// unchanged on purpose because they live in the outbox + activity log (renaming them
	// would orphan in-flight rows and history); only the config var + labels are Make's.
	const webhookUrl = process.env.AUTOMATION_WEBHOOK_URL;

	// No automation configured -> nothing to dispatch. Not an error. The referral is
	// complete; the downstream automation is optional.
	if (!webhookUrl) {
		console.log('[ReferralWorker] No automation webhook set (AUTOMATION_WEBHOOK_URL). Skipping dispatch (referral already complete).');
		return;
	}

	// n8n is a NON-CRITICAL downstream consumer. By the time this step runs the
	// letter is generated, the email is sent, and the applicant is notified -- the
	// referral has ALREADY fully succeeded. A transient n8n outage is worth a few
	// retries, but n8n being persistently down must NOT dead-letter the referral
	// and surface it to a PESO admin as a "Failed Referral". So on the FINAL
	// attempt we record that dispatch was skipped and let the pipeline COMPLETE.
	// This is the design contract: referrals succeed even if n8n is offline.
	const isFinalAttempt = (job.attempts + 1) >= job.max_attempts;

	const skipDispatch = async (detail) => {
		console.warn(`[ReferralWorker] automation dispatch skipped for referral ${job.queue_id} after exhausting retries: ${detail}`);
		try {
			await referralRepository.logActivity({
				queueId: job.queue_id,
				actorId: null,
				// Persisted action key kept as N8N_DISPATCH_SKIPPED (§59) — do not rename;
				// only the human-readable detail moved to "automation".
				action: 'N8N_DISPATCH_SKIPPED',
				detail: `Automation side-channel dispatch skipped (referral already complete): ${detail}`
			});
		} catch (logError) {
			console.error('[ReferralWorker] Could not log automation dispatch skip:', logError.message);
		}
	};

	const referral = await referralRepository.findReferralForDispatch(job.queue_id);

	if (!referral) {
		throw new Error(`Referral ${job.queue_id} not found for automation dispatch.`);
	}

	const payload = {
		event: 'referral.completed',
		referenceNumber: referral.reference_number,
		matchScore: referral.match_score,
		reviewedAt: referral.reviewed_at,
		applicant: {
			name: referral.applicant_name,
			email: referral.applicant_email
		},
		job: {
			title: referral.job_title,
			company: referral.company_name
		},
		employer: {
			name: referral.employer_name,
			email: referral.employer_email
		},
		reviewer: referral.reviewer_name || 'PESO Kabankalan'
	};

	// validateStatus: never let axios throw on an HTTP status -- we classify it
	// below. Network-level failures (DNS, ECONNREFUSED, timeout) still reject,
	// and axios/undici can bury the real reason in error.cause (an AggregateError)
	// leaving error.message EMPTY -- which is why this step logged 'failed: .'.
	// Normalise it so the failure is always readable in the worker log.
	let response;
	try {
		response = await axios.post(webhookUrl, payload, {
			timeout: Number(process.env.AUTOMATION_DISPATCH_TIMEOUT_MS) || 15000,
			headers: { 'Content-Type': 'application/json' },
			validateStatus: () => true
		});
	} catch (error) {
		const cause = error.cause || {};
		const code = error.code || cause.code || (Array.isArray(cause.errors) && cause.errors[0] && cause.errors[0].code);
		const detail = error.message || cause.message || (code ? `network error ${code}` : 'unknown network error');
		const reason = `automation webhook unreachable at ${webhookUrl}: ${detail}`;
		if (isFinalAttempt) return skipDispatch(reason);
		throw new Error(reason);
	}

	// The automation webhook (Make.com) returns 200 on a received event. Anything
	// else is a failure worth retrying -- the scenario may be inactive or mid-deploy.
	if (response.status < 200 || response.status >= 300) {
		const reason = `automation webhook returned HTTP ${response.status}${response.data && response.data.message ? ` (${response.data.message})` : ''}.`;
		if (isFinalAttempt) return skipDispatch(reason);
		throw new Error(reason);
	}

	await referralRepository.logActivity({
		queueId: job.queue_id,
		actorId: null,
		// Persisted action key kept as N8N_DISPATCHED (§59) — do not rename.
		action: 'N8N_DISPATCHED',
		detail: `Referral ${referral.reference_number} dispatched to the automation provider (Make.com) for reporting and employer notification.`
	});
}

const STEP_HANDLERS = {
	generate_pdf: handleGeneratePdf,
	send_email: handleSendEmail,
	notify: handleNotify,
	dispatch_n8n: handleDispatchN8n
};
// ============================================================================
// THE LOOP
// ============================================================================

async function processJob(job, io) {
	if (!isKnownStep(job.step) || !STEP_HANDLERS[job.step]) {
		// Not retryable. A missing handler is a code bug, and retrying a code bug
		// 5 times just writes the same error 5 times.
		await referralRepository.failJob(job.id, `No handler for step '${job.step}'.`);
		console.error(`[ReferralWorker] Job ${job.id} failed: no handler for step '${job.step}'.`);
		return;
	}

	const claimed = await referralRepository.claimJob(job.id, WORKER_ID);

	if (!claimed) {
		// Another worker got it, or its state changed under us. Not an error.
		return;
	}

	try {
		await STEP_HANDLERS[job.step](job, {}, io);

		const nextStep = getNextStep(job.step);

		if (nextStep) {
			await referralRepository.advanceStep(job.id, nextStep);
			console.log(`[ReferralWorker] Job ${job.id}: '${job.step}' OK -> '${nextStep}'.`);
		} else {
			await referralRepository.completeJob(job.id);
			console.log(`[ReferralWorker] Job ${job.id}: '${job.step}' OK -> pipeline complete.`);
		}
	} catch (error) {
		// attempts was already incremented by claimJob, so job.attempts is stale.
		const attemptsUsed = job.attempts + 1;

		if (attemptsUsed >= job.max_attempts) {
			await referralRepository.failJob(job.id, error.message);
			console.error(`[ReferralWorker] Job ${job.id} DEAD after ${attemptsUsed} attempts at '${job.step}': ${error.message}`);

			// The referral itself is untouched -- the decision stands, only the
			// delivery failed. A human can retry it. Recorded so someone can.
			try {
				await referralRepository.logActivity({
					queueId: job.queue_id,
					actorId: null,
					action: 'DELIVERY_FAILED',
					detail: `Step '${job.step}' failed permanently after ${attemptsUsed} attempts: ${error.message}`
				});
			} catch (logError) {
				console.error('[ReferralWorker] Could not write failure to audit log:', logError.message);
			}

			// Surface the dead-letter in the owning admin's bell so it is
			// noticed without opening the Failed Referrals queue by chance.
			try {
				const referral = await referralRepository.findReferralById(job.queue_id);
				if (referral?.employer_id) {
					await notifyUser(io, {
						userId: referral.employer_id,
						type: 'REFERRAL_UPDATE',
						title: 'Referral delivery failed',
						body: `Referral ${referral.reference_number || `#${job.queue_id}`} for ${referral.applicant_name} stalled at step '${job.step}'. You can retry it from Failed Referrals.`,
						link: '/referrals/failed'
					});
				}
			} catch (notifError) {
				console.error('[ReferralWorker] Could not notify admin of dead-letter:', notifError.message);
			}
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await referralRepository.rescheduleJob(job.id, delay, error.message);
			console.warn(`[ReferralWorker] Job ${job.id} attempt ${attemptsUsed}/${job.max_attempts} at '${job.step}' failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick(io) {
	// Overlap guard: if a tick runs long, the interval must not start a second
	// one on top of it. Claiming is atomic so it would be SAFE, but it would
	// also be pointless load.
	if (ticking || !running) return;

	ticking = true;

	try {
		const reclaimed = await referralRepository.reclaimStuckJobs(STALE_LOCK_SECONDS);

		if (reclaimed > 0) {
			console.warn(`[ReferralWorker] Reclaimed ${reclaimed} stuck job(s) from a previous crash.`);
		}

		const jobs = await referralRepository.findDueJobs(BATCH_SIZE);

		for (const job of jobs) {
			if (!running) break;
			await processJob(job, io);
		}
	} catch (error) {
		// A tick failing must NEVER kill the loop. The database could be briefly
		// unreachable; the next tick will simply try again.
		console.error('[ReferralWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

function startReferralWorker(io) {
	if (process.env.REFERRAL_WORKER_ENABLED === 'false') {
		console.log('[ReferralWorker] Disabled via REFERRAL_WORKER_ENABLED=false.');
		return;
	}

	if (running) return;

	running = true;

	console.log(`[ReferralWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);

	// Run once immediately so a restart drains the backlog without waiting.
	tick(io);

	timer = setInterval(() => tick(io), POLL_INTERVAL_MS);

	// unref() lets Node exit naturally instead of being held open by the timer.
	if (timer.unref) timer.unref();
}

function stopReferralWorker() {
	running = false;

	if (timer) {
		clearInterval(timer);
		timer = null;
	}

	console.log('[ReferralWorker] Stopped.');
}

module.exports = { startReferralWorker, stopReferralWorker, WORKER_ID };