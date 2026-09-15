const os = require('os');
const applicationScoringRepository = require('../repositories/applicationScoringRepository');
const applicationScoringService = require('./applicationScoringService');
const { scoreApplication, getApplicantResume, computeScoringSignature } = require('./aiScoringService');

/**
 * Application re-scoring worker (Enhancement B).
 *
 * The single-step twin of services/emailWorker.js — in-process poll loop, the DB
 * is the job store (no broker, no setTimeout, invariant 0.3), atomic conditional
 * claim (TiDB has no SKIP LOCKED, §7.5), backoff/dead-letter/stuck-reclaim. Its
 * one step is "score": recompute the applicant↔job compatibility and write it to
 * the LIVE columns.
 *
 * ── IT NEVER TOUCHES THE APPLY-TIME SCORE ───────────────────────────────────
 * `match_score` / `ai_analysis` are immutable (the referral decision's source of
 * truth, §7.4). This worker writes only `current_match_score` / `current_ai_analysis`
 * / `scored_at`, and it NEVER stages a referral (invariant 0.4 — a named admin
 * approves each one). It changes the ranking, nothing else.
 *
 * ── NULL IS RESPECTED (invariant 0.2) ───────────────────────────────────────
 * scoreApplication returns NULL when there is no resume, the AI is down, or the
 * output is a hallucination. On NULL we KEEP the previous live score and complete
 * the job — never write a fabricated number a ranking would act on.
 *
 * GATED BY APPLICATION_SCORING_ENABLED: dormant unless set to "true", so the
 * feature ships dark and flips on when validated (same posture as the email worker).
 *
 * ── REAL-TIME RANKING NUDGE (hybrid polling) ────────────────────────────────
 * After a re-score COMMITS, we best-effort emit `scores_updated` to the owning
 * PESO administrator's room (`user_<peso_admin_id>`), exactly as referralWorker
 * pushes `referral_issued`. The payload is a TRIGGER, never data — it carries no
 * scores or applicant rows; the Applicant Pipeline refetches from the owner-scoped
 * DB endpoint (the DB stays the single source of truth, invariant 0.3). The emit
 * is wrapped and never throws: a dropped socket costs immediacy, not correctness,
 * because the pipeline's slow poll (90s) is the eventual-consistency backstop.
 * `io` may be undefined (e.g. tests) — every emit is guarded.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-scoring`;

const POLL_INTERVAL_MS = Number(process.env.SCORING_POLL_MS) || 10000;
const BATCH_SIZE = Number(process.env.SCORING_BATCH_SIZE) || 3;
const STALE_LOCK_SECONDS = Math.max(60, Math.round((Number(process.env.SCORING_STUCK_MS) || 300000) / 1000));

// Ship-dark input-hash guard (migration 038). DEFAULT OFF (strict === 'true', so a
// trailing space can't enable it by accident, §13) — until the migration is applied
// and the flag is set, the worker's behaviour is byte-identical to before (no hash
// read, no hash write, always scores). When ON, a re-score whose scoring INPUTS are
// unchanged since the last SUCCESSFUL score is completed WITHOUT an AI call: scoring
// is deterministic (temp 0, §21), so the result is provably identical. The guard is
// at EXECUTION, never at scheduling, so it can NEVER swallow a real re-score — a real
// content change changes the hash and it scores. Rollback = flip the flag (no deploy).
const INPUT_HASH_GUARD = process.env.SCORING_INPUT_HASH_GUARD === 'true';

let running = false;
let ticking = false;
let timer = null;

/** Exponential backoff, capped at one hour (same shape as the other workers). */
function backoffSeconds(attempts) {
	const seconds = 60 * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(seconds, 3600);
}

/**
 * Best-effort real-time nudge to the owning admin that a fresh live score has
 * landed. A trigger only (no scores in the payload). Never throws — a socket
 * failure must not affect the scoring outcome (invariant 0.1); the 90s pipeline
 * poll is the backstop.
 */
function emitScoresUpdated(io, application) {
	if (!io || !application?.peso_admin_id) return;
	try {
		io.to(`user_${application.peso_admin_id}`).emit('scores_updated', {
			jobId: application.job_id,
			applicationId: application.application_id,
			at: Date.now(),
		});
	} catch (error) {
		console.error('[ScoringWorker] scores_updated push failed (score WAS persisted):', error.message);
	}
}

async function processJob(job, io) {
	const claimed = await applicationScoringRepository.claim(job.id, WORKER_ID);
	if (!claimed) return; // another worker took it, or its state changed

	try {
		const application = await applicationScoringRepository.findApplicationForScoring(job.application_id, INPUT_HASH_GUARD);

		if (!application) {
			// The application was deleted under us — nothing to score. Not retryable.
			await applicationScoringRepository.completeWithoutScore(job.id, 'application no longer exists');
			return;
		}

		// Finalized/ineligible guard (race). The application may have been REFERRED
		// (status → 'Referred', or an Approved referral) in the window between when this
		// re-score was armed and now. A referral is a finalized business record — its
		// apply-time score is the permanent history and it is NEVER re-scored. Skip
		// without an AI call. (The enqueue paths already exclude these; this closes the
		// race where approval lands after the job was queued.)
		if (application.is_referred || !applicationScoringRepository.ACTIVE_STATUSES.includes(application.status)) {
			await applicationScoringRepository.completeWithoutScore(job.id, `skipped — finalized/ineligible (status=${application.status}, referred=${!!application.is_referred})`);
			console.log(`[ScoringWorker] Application ${job.application_id} skipped — finalized/ineligible (status=${application.status}).`);
			return;
		}

		// ── Change-detection guard (ship-dark, migration 038) ───────────────
		// Skip the AI call when the scoring INPUTS are provably unchanged since the
		// last SUCCESSFUL score. Because scoring is deterministic (temp 0 + JSON mode,
		// §21), identical inputs yield an identical score — so keeping the current live
		// score is CORRECT, not stale, and we avoid a wasted DeepSeek call. The signature
		// is derived from the exact assembled prompt (buildScoringPrompt), so it captures
		// every scoring-relevant field (résumé + the job's skills/qualifications/
		// experience/education/title/description) and can never drift from what is scored.
		// A résumé edit OR a job edit changes the hash → it scores.
		// resumeText is fetched ONCE here and passed into scoreApplication (no double read).
		let inputSignature = null;
		let resumeText = null;
		if (INPUT_HASH_GUARD) {
			resumeText = await getApplicantResume(application.applicant_id);
			inputSignature = computeScoringSignature({ resume: resumeText, job: application });
			if (inputSignature && inputSignature === application.last_scored_input_hash) {
				await applicationScoringRepository.completeWithoutScore(job.id, 'skipped — scoring inputs unchanged (deterministic, hash match)');
				console.log(`[ScoringWorker] Application ${job.application_id} skipped — scoring inputs unchanged (no AI call).`);
				return;
			}
		}

		const score = await scoreApplication({ userId: application.applicant_id, job: application, resumeText });

		if (!score) {
			// No resume / AI down / hallucination — keep the previous live score.
			await applicationScoringRepository.completeWithoutScore(job.id, 'no score (NULL) — previous score kept');
			console.log(`[ScoringWorker] Application ${job.application_id}: no score, previous kept.`);
			return;
		}

		// inputSignature is null when the guard is off → markScored omits the hash column
		// (safe pre-migration). When on, it records THIS score's inputs so the next re-arm
		// can skip an identical recompute.
		await applicationScoringRepository.markScored(job.id, job.application_id, score, inputSignature);
		console.log(`[ScoringWorker] Application ${job.application_id} re-scored → ${score.overall}%.`);

		// Hybrid polling: nudge the owning admin's open pipeline to refetch now,
		// so the new ranking surfaces without waiting for the 90s poll. Trigger only.
		emitScoresUpdated(io, application);

		// Responsiveness (office-requested): if the live score now clears the referral
		// threshold, surface this candidate in the AI-Recommended queue for REVIEW.
		// Staging only — a named admin still approves every referral (invariant 0.4).
		await applicationScoringService.considerStaging(application, score);
	} catch (error) {
		const attemptsUsed = job.attempts + 1; // claim() already incremented the stored value

		if (attemptsUsed >= job.max_attempts) {
			await applicationScoringRepository.fail(job.id, error.message);
			console.error(`[ScoringWorker] Application ${job.application_id} DEAD after ${attemptsUsed} attempts: ${error.message}`);
		} else {
			const delay = backoffSeconds(attemptsUsed);
			await applicationScoringRepository.reschedule(job.id, delay, error.message);
			console.warn(`[ScoringWorker] Application ${job.application_id} attempt ${attemptsUsed}/${job.max_attempts} failed: ${error.message}. Retrying in ${delay}s.`);
		}
	}
}

async function tick(io) {
	if (ticking || !running) return;
	ticking = true;
	try {
		const reclaimed = await applicationScoringRepository.reclaimStuck(STALE_LOCK_SECONDS);
		if (reclaimed > 0) console.warn(`[ScoringWorker] Reclaimed ${reclaimed} stuck job(s).`);

		const jobs = await applicationScoringRepository.findDue(BATCH_SIZE);
		for (const job of jobs) {
			if (!running) break;
			await processJob(job, io);
		}
	} catch (error) {
		// A tick failing must NEVER kill the loop.
		console.error('[ScoringWorker] Tick failed:', error.message);
	} finally {
		ticking = false;
	}
}

function startApplicationScoringWorker(io) {
	if (process.env.APPLICATION_SCORING_ENABLED !== 'true') {
		console.log('[ScoringWorker] Disabled (APPLICATION_SCORING_ENABLED is not "true").');
		return;
	}
	if (running) return;
	running = true;
	console.log(`[ScoringWorker] Started as ${WORKER_ID} (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}).`);
	// Observability for the §29 change-detection guard: makes "is it actually on?" visible in
	// the boot log (a trailing space in SCORING_INPUT_HASH_GUARD would show OFF here, §13).
	console.log(`[ScoringWorker] input-hash guard ${INPUT_HASH_GUARD ? 'ON' : 'OFF'} (SCORING_INPUT_HASH_GUARD).`);
	tick(io);
	timer = setInterval(() => tick(io), POLL_INTERVAL_MS);
	if (timer.unref) timer.unref();
}

function stopApplicationScoringWorker() {
	running = false;
	if (timer) { clearInterval(timer); timer = null; }
	console.log('[ScoringWorker] Stopped.');
}

module.exports = { startApplicationScoringWorker, stopApplicationScoringWorker, WORKER_ID };
