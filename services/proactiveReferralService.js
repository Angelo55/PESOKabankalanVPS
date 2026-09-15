const pool = require('../db');
const proactiveReferralRepository = require('../repositories/proactiveReferralRepository');
const referralRepository = require('../repositories/referralRepository');
const systemSettings = require('./systemSettingsService');
const { scoreApplication, getApplicantResume, computeScoringSignature } = require('./aiScoringService');
const { referralService, ServiceError } = require('./referralService');

/**
 * Proactive AI Referral business logic (Phase 1 — the matcher).
 *
 * Turns an Open/Published vacancy into a bounded, deduped shortlist of strong
 * candidates for the Smart Referral Queue, WITHOUT the seeker applying:
 *   candidate generation (cheap SQL, seekers with >=1 application) → AI score the
 *   shortlist → threshold → upsert into proactive_referral_candidates.
 *
 * It only SUGGESTS. Nothing is referred here — an administrator reviews the queue
 * and promotes a candidate in Phase 2, at which point a real referral is created
 * (a named admin still approves every referral, invariant 0.4). Publishing never
 * waits on this (it enqueues, 0.1); the AI returns a real score or NULL (0.2 — a
 * NULL candidate is simply skipped); the threshold + candidate cap are per-call
 * system settings (§7.12).
 */

// ── Enqueue on publish (non-fatal) ──────────────────────────────────────────

async function enqueueForJob(jobId) {
	if (!jobId) return;
	try { await proactiveReferralRepository.enqueueMatch(jobId); }
	catch (error) { console.error(`[Proactive] Could not enqueue match for job ${jobId}:`, error.message); }
}

// ── Matching (called by the worker) ─────────────────────────────────────────

async function matchJob(jobId) {
	const job = await proactiveReferralRepository.findJobForMatching(jobId);
	if (!job) return { matched: 0, reason: 'job not found' };
	if (!['Open', 'Published'].includes(job.status)) return { matched: 0, reason: `not published (${job.status})` };

	const [threshold, cap] = await Promise.all([
		systemSettings.get('proactive_referral_threshold'),
		systemSettings.get('proactive_candidate_cap'),
	]);
	const floor = Number(threshold) || 75;

	// Ship-dark change-detection guard (migration 039). DEFAULT OFF (strict === 'true',
	// §13). When on, a candidate whose scoring INPUTS (résumé + this job's fields) are
	// unchanged since the last score for this (job, applicant) pair is skipped WITHOUT an
	// AI call — scoring is deterministic (temp 0, §21), so the existing suggestion is still
	// correct. Gated at EXECUTION (before the AI call), so it can never drop a real re-score.
	const hashGuard = process.env.PROACTIVE_INPUT_HASH_GUARD === 'true';

	const candidates = await proactiveReferralRepository.generateCandidates(jobId, {
		jobLocation: job.location || '', cap, includeHash: hashGuard,
	});

	let matched = 0;
	let skippedUnchanged = 0; // guard short-circuits (no AI call) — for the per-run summary below
	for (const cand of candidates) {
		let score = null;
		let inputHash = null;
		try {
			if (hashGuard) {
				// Fetch the résumé ONCE, hash the exact scoring inputs (extraContext is null
				// for proactive — no application, no certs), and skip if unchanged since the
				// candidate's last score. Otherwise score, reusing the résumé (no double read).
				const resumeText = await getApplicantResume(cand.user_id);
				inputHash = computeScoringSignature({ resume: resumeText, job, extraContext: null });
				if (inputHash && cand.last_scored_input_hash && inputHash === cand.last_scored_input_hash) {
					skippedUnchanged += 1;
					continue; // inputs unchanged → keep the existing suggestion, no AI call
				}
				score = await scoreApplication({ userId: cand.user_id, job, resumeText });
			} else {
				score = await scoreApplication({ userId: cand.user_id, job });
			}
		}
		catch (e) { score = null; }
		// 0.2: no resume / AI down / hallucination → NULL → skip, never a fake 0.
		if (!score || typeof score.overall !== 'number') continue;
		if (score.overall < floor) continue;

		const reason = (score.summary && String(score.summary).trim())
			? String(score.summary).trim()
			: `Strong AI match (${score.overall}%) for ${job.title} based on the seeker's resume and profile.`;

		const isNew = await proactiveReferralRepository.upsertCandidate({
			jobId, applicantId: cand.user_id, score: score.overall, aiAnalysis: score, reason, inputHash,
		});
		if (isNew) matched += 1;
	}

	// Per-run observability for the §29 change-detection guard: ONE summary line per
	// matchJob — never per candidate (a job with many unchanged candidates would spam
	// the log, which is why the individual skip stays a silent `continue`). scored +
	// skipped always sum to the candidate count. Quiet when there was nothing to score.
	if (candidates.length > 0) {
		const scored = candidates.length - skippedUnchanged;
		console.log(`[ProactiveWorker] job ${jobId}: ${candidates.length} candidate(s) — ${scored} scored, ${skippedUnchanged} skipped (unchanged), ${matched} new suggestion(s).`);
	}
	return { matched };
}

// ── Smart Referral Queue: review + promote (P2) ─────────────────────────────

/** Paged, ranked, owner-scoped list of suggested candidates for the queue UI. */
async function listCandidates(adminId, { page = 1, limit = 10, jobId = null } = {}) {
	const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
	const safePage = Math.max(parseInt(page, 10) || 1, 1);
	const offset = (safePage - 1) * safeLimit;
	const [data, total] = await Promise.all([
		proactiveReferralRepository.listCandidatesForAdmin(adminId, { limit: safeLimit, offset, jobId }),
		proactiveReferralRepository.countCandidatesForAdmin(adminId, { jobId }),
	]);
	return { data, total, page: safePage, limit: safeLimit };
}

/**
 * VACANCY-GROUPED queue for the Smart Referral Queue UI. Candidates are grouped by the
 * posted vacancy and RANKED WITHIN each vacancy (a candidate is only ever compared to
 * others for the SAME job), and pagination is BY VACANCY so a job's ranking is never
 * split across pages. Returns { groups:[{ job_id, job_title, company,
 * positions_available, candidate_count, candidates:[ranked] }], total, page, limit }.
 */
async function listCandidateGroups(adminId, { page = 1, limit = 10 } = {}) {
	const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
	const safePage = Math.max(parseInt(page, 10) || 1, 1);
	const offset = (safePage - 1) * safeLimit;

	const [vacancies, total] = await Promise.all([
		proactiveReferralRepository.listVacancyGroupsPage(adminId, { limit: safeLimit, offset }),
		proactiveReferralRepository.countVacancyGroups(adminId),
	]);

	const jobIds = vacancies.map((v) => v.job_id);
	const candidates = await proactiveReferralRepository.listCandidatesForJobs(adminId, jobIds);

	// Bucket candidates by job (already ranked by score within job by the query).
	const byJob = new Map();
	for (const c of candidates) {
		if (!byJob.has(c.job_id)) byJob.set(c.job_id, []);
		byJob.get(c.job_id).push(c);
	}

	const groups = vacancies.map((v) => ({
		job_id: v.job_id,
		job_title: v.job_title,
		company: v.company,
		positions_available: v.positions_available,
		candidate_count: Number(v.candidate_count) || 0,
		candidates: byJob.get(v.job_id) || [],
	}));

	return { groups, total, page: safePage, limit: safeLimit };
}

/** Dismiss a recommendation (owner-scoped). Keeps the row so it is never re-suggested. */
async function dismissCandidate({ candidateId, adminId, reason }) {
	const cand = await proactiveReferralRepository.findCandidateForAdmin(candidateId, adminId);
	if (!cand) throw new ServiceError('Recommendation not found, or it is for a job you did not publish.', 404);
	if (cand.status !== 'Suggested') throw new ServiceError(`This recommendation was already ${cand.status.toLowerCase()}.`, 409);
	await proactiveReferralRepository.markDismissed(candidateId, adminId, reason);
	return { dismissed: true };
}

/**
 * Promote a recommendation into a real referral. This is the administrator's
 * explicit approval — invariant 0.4 is satisfied here, not by the AI. It:
 *   1. materializes an admin-initiated job_applications row (origin='admin_referral')
 *      + copies the seeker's latest resume snapshot + marks the candidate Promoted
 *      (one transaction), then
 *   2. runs the EXISTING approveReferral pipeline on that row — which enforces the
 *      vacancy cap (0.12), mints the letter (0.13), and queues delivery via the
 *      outbox worker (letter email + n8n + REFERRAL_ISSUED).
 * On any failure of step 2 (e.g. the vacancy is full → 409) it COMPENSATES: the
 * orphan application is deleted and the candidate returns to the queue, so a full
 * vacancy never strands a half-made referral.
 */
async function promoteCandidate({ candidateId, adminId, remarks }) {
	const cand = await proactiveReferralRepository.findCandidateForAdmin(candidateId, adminId);
	if (!cand) throw new ServiceError('Recommendation not found, or it is for a job you did not publish.', 404);
	if (cand.status !== 'Suggested') throw new ServiceError(`This recommendation was already ${cand.status.toLowerCase()}.`, 409);

	// UNIFIED PATH (canonical referral): if the seeker ALREADY has an application for
	// this vacancy, do NOT create a second one — refer through that existing application.
	// The Smart Referral Queue is only a recommendation surface; the referral is always
	// issued against the one application row (uq_job_applicant / 0.12). This replaces the
	// old hard 409, so a candidate the seeker has since applied to is resolved in one
	// click instead of erroring. approveReferral is idempotent, so if that application was
	// already referred this simply clears the stale candidate out of the queue.
	const existing = await proactiveReferralRepository.findExistingApplication(cand.job_id, cand.applicant_id);
	if (existing) {
		// Approve through the unchanged pipeline first. If it throws (e.g. vacancy full →
		// 409) the candidate is left 'Suggested' untouched — nothing to compensate.
		const result = await referralService.approveReferral({
			applicationId: existing.id, adminId, remarks: remarks || undefined,
		});
		// Only now retire the candidate from the queue (never re-suggested).
		try { await proactiveReferralRepository.markPromoted(candidateId, adminId, existing.id); }
		catch (e) { console.error(`[Proactive] markPromoted (via existing app) failed for candidate ${candidateId}:`, e.message); }
		// Provenance: the recommendation came from AI, but the seeker had applied — record
		// both facts (non-fatal, 0.1) without pretending no application existed.
		try {
			await referralRepository.logActivity({
				queueId: result.referralId, actorId: adminId, action: 'ADMIN_INITIATED',
				detail: `Referred from the Smart Referral Queue via the applicant's EXISTING application (AI compatibility ${cand.match_score ?? 'N/A'}%). No duplicate application was created — the single canonical referral was issued against their own submission.`,
			});
		} catch (logErr) {
			console.error(`[Proactive] Provenance log (via existing) failed for referral ${result.referralId}:`, logErr.message);
		}
		return {
			promoted: true, applicationId: existing.id, candidateId,
			referralId: result.referralId, referenceNumber: result.referenceNumber,
			viaExistingApplication: true,
		};
	}

	// Step 1 — materialize (atomic).
	const connection = await pool.getConnection();
	let applicationId;
	try {
		await connection.beginTransaction();
		const [applicantSnapshot, resumeSnap] = await Promise.all([
			proactiveReferralRepository.latestApplicantSnapshot(cand.applicant_id, connection),
			proactiveReferralRepository.latestResumeSnapshot(cand.applicant_id, connection),
		]);
		applicationId = await proactiveReferralRepository.createAdminInitiatedApplication({
			jobId: cand.job_id, applicantId: cand.applicant_id, matchScore: cand.match_score,
			aiAnalysis: cand.ai_analysis, applicantSnapshot, adminId,
		}, connection);
		if (resumeSnap) await proactiveReferralRepository.copyResumeSnapshot(applicationId, resumeSnap, connection);
		await proactiveReferralRepository.markPromoted(candidateId, adminId, applicationId, connection);
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}

	// Step 2 — approve through the existing referral pipeline.
	try {
		const result = await referralService.approveReferral({
			applicationId, adminId,
			remarks: remarks || 'Proactive referral: PESO endorsed this candidate based on AI compatibility with the vacancy.',
		});

		// Provenance in the referral's own audit trail (visible to the seeker too),
		// so this referral is forever distinguishable from a seeker-applied one.
		// Non-fatal — the referral already stands (0.1).
		try {
			await referralRepository.logActivity({
				queueId: result.referralId,
				actorId: adminId,
				action: 'ADMIN_INITIATED',
				detail: `Proactive referral: a PESO administrator initiated this referral on the applicant's behalf based on an AI compatibility match of ${cand.match_score ?? 'N/A'}%. The applicant did not submit an application.`,
			});
		} catch (logErr) {
			console.error(`[Proactive] Provenance log failed for referral ${result.referralId}:`, logErr.message);
		}

		return {
			promoted: true, applicationId, candidateId,
			referralId: result.referralId, referenceNumber: result.referenceNumber,
		};
	} catch (error) {
		// Compensation — undo the materialized application (cascades its resume) and
		// return the candidate to the queue.
		try {
			await proactiveReferralRepository.deleteApplication(applicationId);
			await proactiveReferralRepository.revertToSuggested(candidateId);
		} catch (cleanupErr) {
			console.error(`[Proactive] Compensation after failed promote (candidate ${candidateId}, app ${applicationId}) failed:`, cleanupErr.message);
		}
		throw error;
	}
}

// ── Seeker-edit re-match (P4, behind its own sub-flag) ──────────────────────

/**
 * Re-arm proactive matching for a seeker's OPEN, not-yet-applied vacancies after
 * their resume/profile/certificates change — so a stronger profile can newly qualify
 * them for jobs they never applied to. OFF by default: gated by BOTH the master flag
 * (no point enqueuing when the worker is dormant) AND its own PROACTIVE_REMATCH_ON_EDIT
 * sub-flag, because it is heavier than on-publish matching (one edit touches many
 * jobs). Bounded by openJobsForSeeker's cap. Fire-and-forget, non-fatal (0.1).
 */
async function enqueueForSeeker(userId) {
	if (process.env.PROACTIVE_REFERRALS_ENABLED !== 'true' || process.env.PROACTIVE_REMATCH_ON_EDIT !== 'true') return;
	if (!userId) return;
	try {
		const jobIds = await proactiveReferralRepository.openJobsForSeeker(userId, 25);
		for (const jobId of jobIds) await proactiveReferralRepository.enqueueMatch(jobId);
		if (jobIds.length) console.log(`[Proactive] Seeker ${userId} evidence changed → re-armed match for ${jobIds.length} open job(s).`);
	} catch (error) {
		console.error(`[Proactive] Could not enqueue seeker re-match for ${userId}:`, error.message);
	}
}

// ── Monitor / health ────────────────────────────────────────────────────────

async function getHealth() {
	const c = await proactiveReferralRepository.counts();
	return { enabled: process.env.PROACTIVE_REFERRALS_ENABLED === 'true', pending: c.pending, failed: c.failed, suggested: c.suggested };
}

/** Richer snapshot for the Super Admin monitor page. */
async function getStatus() {
	const counts = await proactiveReferralRepository.counts();
	return {
		enabled: process.env.PROACTIVE_REFERRALS_ENABLED === 'true',
		rematchOnEdit: process.env.PROACTIVE_REMATCH_ON_EDIT === 'true',
		counts,
	};
}

module.exports = { enqueueForJob, enqueueForSeeker, matchJob, listCandidates, listCandidateGroups, dismissCandidate, promoteCandidate, getHealth, getStatus };
