/**
 * Application re-scoring API (Enhancement B).
 *
 * The thin layer callers use to ask "this applicant's evidence changed — refresh
 * the live compatibility scores on their active applications". It only ENQUEUES
 * (dedupe + debounce in the repository); the actual AI work happens in
 * services/applicationScoringWorker.js off the request path.
 *
 * ── NEVER FAILS THE PRIMARY ACTION (invariant 0.1) ──────────────────────────
 * A profile save or a resume upload must succeed even if scheduling a re-score
 * fails. Every method here swallows its own errors and logs — the caller fires
 * and forgets.
 *
 * ── DEBOUNCE ────────────────────────────────────────────────────────────────
 * Edits arrive in bursts (a user fixes three profile fields, re-uploads a resume).
 * We schedule the re-score a quiet-period out (SCORING_DEBOUNCE_SECONDS, default
 * 90s) and dedupe per application, so a flurry of edits collapses into one AI call
 * per application instead of one per keystroke.
 */

const applicationScoringRepository = require('../repositories/applicationScoringRepository');
const systemSettings = require('./systemSettingsService');
const { referralService } = require('./referralService');
const { notifyUser } = require('./notificationService');

const debounceSeconds = () => Number(process.env.SCORING_DEBOUNCE_SECONDS) || 90;

/**
 * Re-arm live re-scoring for every ACTIVE application of one applicant. Call after
 * a resume/profile change. Non-fatal.
 */
async function enqueueForUser(userId) {
	if (!userId) return 0;
	try {
		const armed = await applicationScoringRepository.enqueueForUserActiveApplications(userId, debounceSeconds());
		if (armed > 0) console.log(`[Scoring] Re-score armed for ${armed} active application(s) of user ${userId}.`);
		return armed;
	} catch (error) {
		console.error(`[Scoring] Could not enqueue re-score for user ${userId}:`, error.message);
		return 0;
	}
}

/**
 * Enqueue scoring for one specific application. Non-fatal. `delaySeconds` defaults to
 * the debounce window (re-score after an edit); pass 0 for APPLY-TIME scoring, which
 * must run on the next poll (~10s) rather than 90s out, so the applicant's score
 * appears promptly after their (now instant) submit.
 */
async function enqueueForApplication(applicationId, delaySeconds = null) {
	if (!applicationId) return;
	try {
		await applicationScoringRepository.enqueue(applicationId, delaySeconds == null ? debounceSeconds() : delaySeconds);
	} catch (error) {
		console.error(`[Scoring] Could not enqueue scoring for application ${applicationId}:`, error.message);
	}
}

/**
 * Re-arm live re-scoring for every ACTIVE application to one JOB. Call when a
 * vacancy's scoring-relevant fields change, so its candidates are re-evaluated
 * against the new criteria. Non-fatal.
 */
async function enqueueForJob(jobId) {
	if (!jobId) return 0;
	try {
		const armed = await applicationScoringRepository.enqueueForJobActiveApplications(jobId, debounceSeconds());
		if (armed > 0) console.log(`[Scoring] Re-score armed for ${armed} active application(s) of job ${jobId} (posting changed).`);
		return armed;
	} catch (error) {
		console.error(`[Scoring] Could not enqueue re-score for job ${jobId}:`, error.message);
		return 0;
	}
}

/**
 * After a re-score, surface a newly-eligible candidate for referral REVIEW if the
 * live score has crossed the AI threshold. This is what makes staging responsive to
 * evidence changes (a stronger resume now qualifies) instead of
 * only firing once at apply time — the throughput improvement the office asked for,
 * WITHOUT lowering the quality bar.
 *
 * IT STAGES, IT DOES NOT APPROVE. stageAiRecommendation writes a 'Pending Review'
 * row (idempotent — a no-op when a referral already exists) that appears in the
 * AI-Recommended queue; a named administrator still approves every referral
 * (invariant 0.4). Never throws — staging is secondary to the score itself (0.1).
 */
async function considerStaging(application, score) {
	try {
		if (!application || !score || typeof score.overall !== 'number') return;
		const threshold = Number(await systemSettings.get('referral_ai_threshold'));
		if (!Number.isFinite(threshold) || score.overall < threshold) return;

		const result = await referralService.stageAiRecommendation({
			applicationId: application.application_id,
			matchScore: score.overall,
			aiAnalysis: score,
		});

		if (result?.staged && application.peso_admin_id) {
			// io is null (the worker has no socket): notifyUser writes the durable bell
			// row and skips the best-effort live push. It never throws.
			await notifyUser(null, {
				userId: application.peso_admin_id,
				type: 'AI_RECOMMENDATION',
				title: 'New AI-recommended applicant',
				body: `An updated applicant now scores ${score.overall}% for "${application.title}". Review them in the AI-Recommended queue.`,
				link: '/referrals/recommended',
			});
			console.log(`[Scoring] Application ${application.application_id} crossed the threshold (${score.overall}%) → staged for review.`);
		}
		return result;
	} catch (error) {
		console.error(`[Scoring] Could not stage referral for application ${application?.application_id}:`, error.message);
	}
}

/** Backlog snapshot for GET /admin/health. */
async function getHealth() {
	const h = await applicationScoringRepository.health();
	return { enabled: process.env.APPLICATION_SCORING_ENABLED === 'true', ...h };
}

module.exports = { enqueueForUser, enqueueForApplication, enqueueForJob, considerStaging, getHealth };
