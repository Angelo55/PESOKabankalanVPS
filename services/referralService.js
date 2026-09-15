const crypto = require('crypto');
const pool = require('../db');
const referralRepository = require('../repositories/referralRepository');
const { FIRST_STEP } = require('./referralPipeline');
const { normalizeRole, ROLE_KEYS } = require('../middleware/rbac');
const systemSettings = require('./systemSettingsService');
const { notifyUser } = require('./notificationService');

/**
 * Master flag for the synchronized referral lifecycle (2026). Read PER CALL
 * (§7.12) so a Super Administrator can flip it without a redeploy. When OFF,
 * outcome recording behaves exactly as it did before this feature: the official
 * write happens, but the seeker is NOT notified, no structured history row is
 * written, and the seeker-suggestion channel is refused at the route. Fail-safe
 * to OFF if settings are briefly unreadable.
 */
async function isLifecycleSyncEnabled() {
	try {
		return Boolean(await systemSettings.get('referral_lifecycle_sync_enabled'));
	} catch (error) {
		console.error('[ReferralService] lifecycle-sync flag lookup failed; treating as OFF:', error.message);
		return false;
	}
}

// Truthy for boolean settings regardless of how they were stored (real boolean,
// the string 'true'/'1', or the number 1). Guards against Boolean('false') === true.
const settingIsTrue = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * #6 — Seeker acceptance. When ON, an admin's "refer" ENDORSES the applicant into
 * 'Pending Seeker Acceptance' and the official letter is issued only after the
 * seeker ACCEPTS. When OFF, approval is immediate exactly as before. Read per call
 * (§7.12); fail-safe to OFF.
 */
async function isAcceptanceEnabled() {
	try { return settingIsTrue(await systemSettings.get('referral_acceptance_enabled')); }
	catch (error) { console.error('[ReferralService] acceptance flag lookup failed; OFF:', error.message); return false; }
}

/**
 * #11b — Vacancy de-automation. When ON, the count-based cap is ADVISORY (no 409)
 * and a posting is NEVER auto-marked Filled — only PESO's confirmation fills it.
 * When OFF, the hard cap + auto-fill behave exactly as before. Read per call; OFF-safe.
 */
async function isManualFillEnabled() {
	try { return settingIsTrue(await systemSettings.get('vacancy_manual_fill_enabled')); }
	catch (error) { console.error('[ReferralService] manual-fill flag lookup failed; OFF:', error.message); return false; }
}

/**
 * Placement outcomes (migration 023). MUST stay in sync with the ENUM on
 * referral_outcomes.outcome -- an unlisted value is rejected here with a 400
 * rather than reaching TiDB, where an out-of-range enum silently truncates and
 * rolls back the enclosing transaction (the trap that broke referral approval
 * before migration 014).
 *
 * 'Hired' is the one the landing page's "Successful Referrals" tile counts.
 */
const VALID_OUTCOMES = [
	'Issued',
	'Employer Acknowledged',
	'Interview Scheduled',
	'Hired',
	'Not Hired',
	'Withdrawn',
	'No Response'
];

/**
 * Referral business-logic layer.
 *
 * HTTP lives in routes/referralRoutes.js. SQL lives in
 * repositories/referralRepository.js. This file is the layer between them: it
 * owns the referral DECISIONS and the transactions that make them atomic.
 *
 * WHY THIS FILE HAD TO EXIST: the routes import { referralService, ServiceError }
 * from here, and applicationRoutes imports { referralService }. For a while this
 * module was accidentally a byte-for-byte copy of the repository, so both names
 * resolved to `undefined` -- every referral route threw, and handleError's
 * `error instanceof ServiceError` threw a second time on an undefined right-hand
 * side. That masked the real failure behind "Right-hand side of 'instanceof' is
 * not an object" and took down the Applicant Pipeline, AI-Recommended, Referral
 * Register, and Failed Referrals pages at once. This is the genuine service.
 */

/**
 * A domain error the HTTP layer can translate directly into a response.
 * Anything that is NOT a ServiceError is an unexpected fault: routes log it in
 * full and return a generic 500, so SQL text and stack traces never cross the
 * wire.
 */
class ServiceError extends Error {
	constructor(message, statusCode = 400, data = null) {
		super(message);
		this.name = 'ServiceError';
		this.statusCode = statusCode;
		this.data = data;
	}
}

// Reference numbers are generated INDEPENDENTLY of the primary key. TiDB caches
// blocks of auto-increment ids per node, so PKs jump (1 -> 30001) and would leak
// volume and be non-sequential anyway. A random token + the UNIQUE constraint on
// referral_letters.reference_number + retry-on-collision gives a clean,
// unguessable, human-readable citizen-facing identifier. The alphabet omits
// 0/O/1/I to stay unambiguous when read off a printed letter.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomReferenceToken(length = 8) {
	const bytes = crypto.randomBytes(length);
	let token = '';
	for (let i = 0; i < length; i++) {
		token += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
	}
	return token;
}

/**
 * A reference number no letter currently holds. The UNIQUE constraint is the
 * real guard; this pre-check just keeps the common case from ever hitting it.
 * ~10^12 possibilities means a collision across a small municipality's referral
 * volume is effectively impossible, but we still retry a handful of times.
 */
async function generateUniqueReferenceNumber(conn) {
	const year = new Date().getFullYear();

	for (let attempt = 0; attempt < 6; attempt++) {
		const candidate = `PESO-KAB-${year}-${randomReferenceToken(8)}`;
		const exists = await referralRepository.referenceNumberExists(candidate, conn);
		if (!exists) return candidate;
	}

	throw new ServiceError('Could not allocate a unique referral reference number. Please try again.', 500);
}

/**
 * The APPROVAL TAIL shared by the direct-approve path (acceptance flag OFF) and the
 * seeker-accept path (flag ON). Runs inside the caller's transaction, AFTER the
 * referral row is already set to 'Approved': mint/reuse the letter, arm the outbox
 * (delivery begins on the next worker tick), couple the ATS status to 'Referred'
 * (finalized — out of live re-scoring, §18.5), log, and — unless manual-fill is on
 * (#11b) — auto-fill the posting when the last slot is consumed. Returns the
 * reference number + fill result.
 */
async function finalizeApprovedReferral(connection, { referralId, applicationId, jobId, application, actorId, manualFill }) {
	// Reuse an existing letter (re-approval) rather than minting a duplicate.
	let letter = await referralRepository.findLetterByQueue(referralId, connection);
	let referenceNumber = letter ? letter.reference_number : null;
	if (!referenceNumber) {
		referenceNumber = await generateUniqueReferenceNumber(connection);
		await referralRepository.createLetter({ queueId: referralId, referenceNumber }, connection);
	}

	await referralRepository.enqueueJob(referralId, FIRST_STEP, connection);
	await referralRepository.setApplicationStatus(applicationId, 'Referred', connection);

	// The referral row is already 'Approved', so this count INCLUDES it.
	const vacancy = await referralRepository.lockJobVacancy(jobId, connection);
	// NULL positions_available = the employer did not state a headcount. It must
	// NEVER be treated as 0 or auto-filled — an unspecified vacancy is closed only
	// by a PESO-confirmed status.
	const unspecifiedCapacity = vacancy?.positions_available == null;
	const capacity = Math.max(1, Number(vacancy?.positions_available) || 1);
	const approvedNow = await referralRepository.countApprovedForJob(jobId, connection);

	await referralRepository.logActivity({
		queueId: referralId,
		actorId,
		action: 'REFERRAL_APPROVED',
		detail: `Referral ${referenceNumber} approved for ${application.applicant_name} -> ${application.company_name} (${application.job_title}). Queued for delivery. Slot ${approvedNow} of ${capacity}.`
	}, connection);

	// Auto-fill ONLY when manual-fill (#11b) is OFF AND the employer stated a headcount.
	// When ON, or when the count is unspecified, vacancy closure is a PESO-verified
	// action — never inferred from the referral count.
	let jobFilled = false;
	if (!manualFill && !unspecifiedCapacity && approvedNow >= capacity) {
		await referralRepository.setJobStatus(jobId, 'Filled', connection);
		jobFilled = true;
		await referralRepository.logActivity({
			queueId: referralId,
			actorId,
			action: 'JOB_FILLED',
			detail: `All ${capacity} position(s) for "${application.job_title}" are now referred. Posting marked Filled.`
		}, connection);
	}

	return { referenceNumber, jobFilled, capacity, slotsUsed: approvedNow };
}

// Nudge BOTH parties' live views (the seeker's My Referrals + the PESO office's Referral
// Register) to silently refetch after a referral's STATUS changes, so the two never see
// divergent state for the same record. Reuses the `referral_outcome_updated` event the
// frontend already subscribes to (ChatContext → outcomeRefreshTrigger). Best-effort and
// AFTER commit — the DB is the source of truth (invariant 0.3); a missed emit is covered by
// the existing visibility/poll backstops, and it must never fail the mutation.
function emitReferralUpdated(io, { applicantId = null, employerId = null, referralId = null } = {}) {
	if (!io) return;
	try {
		const payload = { referralId, at: Date.now() };
		if (applicantId) io.to(`user_${applicantId}`).emit('referral_outcome_updated', payload);
		if (employerId) io.to(`user_${employerId}`).emit('referral_outcome_updated', payload);
	} catch (_) { /* real-time is best-effort; never throw into a committed mutation */ }
}

// Valid seeker referral-automation modes (migration 050 / referral_preferences).
const REFERRAL_MODES = ['manual', 'auto_accept', 'auto_decline'];

/**
 * A job seeker's referral-automation preference. Defaults to 'manual' and is
 * FAIL-SAFE to 'manual' on any read error (missing table on a fresh deploy, DB
 * hiccup) — automation must never be assumed, so a failure leaves the referral
 * for the seeker to review by hand.
 */
async function getReferralPreference(userId, conn = pool) {
	try {
		const [rows] = await conn.query('SELECT mode FROM referral_preferences WHERE user_id = ?', [userId]);
		const mode = rows[0]?.mode;
		return REFERRAL_MODES.includes(mode) ? mode : 'manual';
	} catch (error) {
		console.error('[ReferralService] referral-preference lookup failed; treating as manual:', error.message);
		return 'manual';
	}
}

/** Persist a seeker's referral-automation preference (validated). */
async function setReferralPreference(userId, mode, conn = pool) {
	if (!REFERRAL_MODES.includes(mode)) {
		throw new ServiceError(`Invalid referral preference. Use one of: ${REFERRAL_MODES.join(', ')}.`, 400);
	}
	await conn.query(
		`INSERT INTO referral_preferences (user_id, mode) VALUES (?, ?)
		 ON DUPLICATE KEY UPDATE mode = VALUES(mode)`,
		[userId, mode]
	);
	return mode;
}

const referralService = {

	/**
	 * Approve an applicant for referral. PESO Administrator action.
	 *
	 * This is the TRANSACTIONAL OUTBOX write: the referral decision, its letter
	 * placeholder, and its delivery job are committed together or not at all. The
	 * worker takes over from `referral_jobs` on its next tick -- the HTTP request
	 * returns the moment the intent is durable, NOT when the email is sent.
	 *
	 * Handles every entry point:
	 *   - fresh approval from the Applicant Pipeline (no prior referral row),
	 *   - one-click approval from the AI-Recommended queue ('Pending Review'),
	 *   - re-approval of a previously 'Rejected' applicant.
	 *
	 * Ownership is enforced by findApplicationForReferral: an admin can only act
	 * on applications to jobs THEY published.
	 */
	async approveReferral({ applicationId, adminId, remarks, io = null }) {
		const acceptanceEnabled = await isAcceptanceEnabled();
		const manualFill = await isManualFillEnabled();
		const connection = await pool.getConnection();

		try {
			await connection.beginTransaction();

			const application = await referralRepository.findApplicationForReferral(applicationId, adminId, connection);
			if (!application) {
				throw new ServiceError('Application not found, or it belongs to a job you did not publish.', 404);
			}

			const existing = await referralRepository.findReferralByApplication(applicationId, connection);

			// Idempotency: a second approve (double-click, stale UI) must not re-queue
			// delivery or mint a second letter. Return the existing reference instead.
			if (existing && existing.status === 'Approved') {
				const letter = await referralRepository.findLetterByQueue(existing.id, connection);
				await connection.commit();
				return {
					referralId: existing.id,
					status: 'Approved',
					referenceNumber: letter ? letter.reference_number : null,
					alreadyApproved: true
				};
			}
			// Already endorsed and awaiting the seeker — a repeated "refer" is a no-op.
			if (acceptanceEnabled && existing && existing.status === 'Pending Seeker Acceptance') {
				await connection.commit();
				return {
					referralId: existing.id,
					status: 'Pending Seeker Acceptance',
					alreadyEndorsed: true,
					applicantName: application.applicant_name,
					jobTitle: application.job_title,
					companyName: application.company_name
				};
			}

			// VACANCY CAP: one approved referral consumes one position; the job row is
			// locked FOR UPDATE so concurrent approvals on the last slot serialize. When
			// manual-fill (#11b) is ON the cap is ADVISORY — PESO, not a count, decides
			// when a vacancy is filled — so the hard 409 is skipped.
			const vacancy = await referralRepository.lockJobVacancy(application.job_id, connection);
			// Unspecified headcount (NULL) is never count-capped — the employer gave no
			// number, so referrals continue until PESO confirms the vacancy is filled.
			const unspecifiedCapacity = vacancy?.positions_available == null;
			const capacity = Math.max(1, Number(vacancy?.positions_available) || 1);
			const approvedSoFar = await referralRepository.countApprovedForJob(application.job_id, connection);

			if (!manualFill && !unspecifiedCapacity && approvedSoFar >= capacity) {
				throw new ServiceError(
					`All ${capacity} available position${capacity === 1 ? '' : 's'} for "${application.job_title}" ${capacity === 1 ? 'has' : 'have'} already been referred. Increase the vacancy count on the job posting to refer more applicants.`,
					409,
					{ capacity, approved: approvedSoFar }
				);
			}

			// ── SEEKER ACCEPTANCE ON: ENDORSE ONLY ──────────────────────────────────
			// Stage the referral for the seeker's review. NO letter, NO outbox, NO ATS
			// change — the official letter is minted only once the seeker accepts.
			if (acceptanceEnabled) {
				let referralId;
				if (existing) {
					await referralRepository.updateReferralDecision({
						referralId: existing.id, status: 'Pending Seeker Acceptance', reviewedBy: adminId, remarks: remarks || null
					}, connection);
					referralId = existing.id;
				} else {
					referralId = await referralRepository.createReferral({
						applicationId, matchScore: application.match_score, status: 'Pending Seeker Acceptance', reviewedBy: adminId, remarks: remarks || null
					}, connection);
				}
				await referralRepository.logActivity({
					queueId: referralId, actorId: adminId, action: 'REFERRAL_ENDORSED',
					detail: `Referral endorsed for ${application.applicant_name} -> ${application.company_name} (${application.job_title}). Awaiting the job seeker's acceptance.`
				}, connection);
				await connection.commit();

				// ── SEEKER AUTOMATION (referral_preferences, migration 050) ─────────
				// The endorsement record + audit row are now durable. If the seeker
				// pre-chose to auto-accept or auto-decline, act on their behalf on the
				// committed referral (a full trail: endorsed → auto-accepted/declined).
				// Fail-safe: a lookup/action failure leaves it awaiting manual review.
				const mode = await getReferralPreference(application.applicant_id);

				// Only send the "please respond" nudge when a response is actually
				// needed (manual mode). Auto modes resolve immediately.
				if (mode === 'manual') {
					notifyUser(io, {
						userId: application.applicant_id,
						type: 'REFERRAL_ENDORSEMENT',
						title: 'A referral is waiting for your response',
						body: `PESO wants to refer you to ${application.company_name} for ${application.job_title}. Open My Referrals to accept or decline it.`,
						link: '/referrals'
					});
				}
				emitReferralUpdated(io, { applicantId: application.applicant_id, employerId: adminId, referralId });

				if (mode === 'auto_accept' || mode === 'auto_decline') {
					try {
						if (mode === 'auto_accept') {
							const auto = await referralService.acceptReferral({ referralId, applicantId: application.applicant_id, io });
							return {
								referralId, status: auto.status, endorsed: true, autoResolved: 'accepted',
								referenceNumber: auto.referenceNumber,
								applicantName: application.applicant_name, jobTitle: application.job_title,
								companyName: application.company_name, slotsUsed: approvedSoFar, capacity
							};
						}
						await referralService.declineReferral({ referralId, applicantId: application.applicant_id, io });
						return {
							referralId, status: 'Declined', endorsed: true, autoResolved: 'declined',
							applicantName: application.applicant_name, jobTitle: application.job_title,
							companyName: application.company_name, slotsUsed: approvedSoFar, capacity
						};
					} catch (autoErr) {
						// The endorsement stands; the seeker can still act manually.
						console.error('[ReferralService] seeker auto-preference could not be applied; left for manual review:', autoErr.message);
					}
				}

				return {
					referralId, status: 'Pending Seeker Acceptance', endorsed: true,
					applicantName: application.applicant_name, jobTitle: application.job_title,
					companyName: application.company_name, slotsUsed: approvedSoFar, capacity
				};
			}

			// ── SEEKER ACCEPTANCE OFF: IMMEDIATE APPROVAL (original behaviour) ──────
			let referralId;
			if (existing) {
				await referralRepository.updateReferralDecision({
					referralId: existing.id, status: 'Approved', reviewedBy: adminId, remarks: remarks || null
				}, connection);
				referralId = existing.id;
			} else {
				referralId = await referralRepository.createReferral({
					applicationId, matchScore: application.match_score, status: 'Approved', reviewedBy: adminId, remarks: remarks || null
				}, connection);
			}

			const fin = await finalizeApprovedReferral(connection, {
				referralId, applicationId, jobId: application.job_id, application, actorId: adminId, manualFill
			});

			await connection.commit();

			emitReferralUpdated(io, { applicantId: application.applicant_id, employerId: adminId, referralId });

			return {
				referralId,
				status: 'Approved',
				referenceNumber: fin.referenceNumber,
				applicantName: application.applicant_name,
				jobTitle: application.job_title,
				companyName: application.company_name,
				jobFilled: fin.jobFilled,
				slotsUsed: fin.slotsUsed,
				capacity: fin.capacity
			};
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/**
	 * Seeker ACCEPTS a personalized referral (#6, flag referral_acceptance_enabled).
	 * Owner-scoped by applicantId. Runs the shared approval tail — mints the official
	 * letter, arms the delivery outbox, sets the ATS status to 'Referred' — the SAME
	 * pipeline a direct approval uses (not a parallel one). Notifies the endorsing admin.
	 */
	async acceptReferral({ referralId, applicantId, io = null }) {
		const manualFill = await isManualFillEnabled();
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();

			const referral = await referralRepository.findReferralById(referralId, connection);
			if (!referral || Number(referral.applicant_id) !== Number(applicantId)) {
				throw new ServiceError('Referral not found.', 404);
			}
			if (referral.status !== 'Pending Seeker Acceptance') {
				throw new ServiceError('This referral is not awaiting your acceptance.', 409);
			}

			await referralRepository.setReferralStatus(referralId, 'Approved', connection);

			const application = {
				applicant_name: referral.applicant_name,
				company_name: referral.company_name,
				job_title: referral.job_title
			};
			const fin = await finalizeApprovedReferral(connection, {
				referralId, applicationId: referral.application_id, jobId: referral.job_id, application, actorId: applicantId, manualFill
			});

			await referralRepository.logActivity({
				queueId: referralId, actorId: applicantId, action: 'REFERRAL_ACCEPTED',
				detail: `${referral.applicant_name} ACCEPTED the referral to ${referral.company_name} (${referral.job_title}). Letter ${fin.referenceNumber} queued for delivery.`
			}, connection);

			await connection.commit();

			if (referral.employer_id) {
				notifyUser(io, {
					userId: referral.employer_id, type: 'REFERRAL_UPDATE',
					title: 'Referral accepted',
					body: `${referral.applicant_name} accepted the referral for ${referral.job_title}. The official letter is being issued.`,
					link: '/referrals'
				});
			}
			// Live-sync both views: the seeker just moved this referral to Approved; the
			// PESO office's Register must reflect it without a refresh (and vice-versa).
			emitReferralUpdated(io, { applicantId, employerId: referral.employer_id, referralId });
			return { referralId, status: 'Approved', referenceNumber: fin.referenceNumber };
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/**
	 * Seeker DECLINES a personalized referral (#6). Owner-scoped. Keeps the record
	 * (as 'Declined'), notifies the endorsing admin, and issues NO letter. The vacancy
	 * is untouched (with manual-fill, availability is a PESO decision, not a count).
	 */
	async declineReferral({ referralId, applicantId, reason = null, io = null }) {
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();

			const referral = await referralRepository.findReferralById(referralId, connection);
			if (!referral || Number(referral.applicant_id) !== Number(applicantId)) {
				throw new ServiceError('Referral not found.', 404);
			}
			if (referral.status !== 'Pending Seeker Acceptance') {
				throw new ServiceError('This referral is not awaiting your response.', 409);
			}

			await referralRepository.setReferralStatus(referralId, 'Declined', connection);
			await referralRepository.logActivity({
				queueId: referralId, actorId: applicantId, action: 'REFERRAL_DECLINED',
				detail: `${referral.applicant_name} DECLINED the referral to ${referral.company_name} (${referral.job_title}).${reason ? ` Reason: ${String(reason).slice(0, 300)}` : ''}`
			}, connection);

			await connection.commit();

			if (referral.employer_id) {
				notifyUser(io, {
					userId: referral.employer_id, type: 'REFERRAL_UPDATE',
					title: 'Referral declined',
					body: `${referral.applicant_name} declined the referral for ${referral.job_title}.`,
					link: '/referrals'
				});
			}
			emitReferralUpdated(io, { applicantId, employerId: referral.employer_id, referralId });
			return { referralId, status: 'Declined' };
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/**
	 * Reject an applicant for referral. PESO Administrator action. A reason is
	 * mandatory and is recorded on the referral and in the audit log. No letter
	 * and no delivery job are created -- a rejection sends nothing.
	 */
	async rejectReferral({ applicationId, adminId, remarks, io = null }) {
		const reason = (remarks || '').trim();
		if (!reason) {
			throw new ServiceError('A reason is required to reject a referral.', 400);
		}

		const connection = await pool.getConnection();

		try {
			await connection.beginTransaction();

			const application = await referralRepository.findApplicationForReferral(applicationId, adminId, connection);
			if (!application) {
				throw new ServiceError('Application not found, or it belongs to a job you did not publish.', 404);
			}

			const existing = await referralRepository.findReferralByApplication(applicationId, connection);

			let referralId;
			if (existing) {
				if (existing.status === 'Approved') {
					// The letter is already generated/sent. Rejecting now would be a lie
					// on the record. Block it -- an approved referral is final.
					throw new ServiceError('This applicant has already been approved and referred; it can no longer be rejected.', 409);
				}
				await referralRepository.updateReferralDecision({
					referralId: existing.id,
					status: 'Rejected',
					reviewedBy: adminId,
					remarks: reason
				}, connection);
				referralId = existing.id;
			} else {
				referralId = await referralRepository.createReferral({
					applicationId,
					matchScore: application.match_score,
					status: 'Rejected',
					reviewedBy: adminId,
					remarks: reason
				}, connection);
			}

			await referralRepository.logActivity({
				queueId: referralId,
				actorId: adminId,
				action: 'REFERRAL_REJECTED',
				detail: `Referral for ${application.applicant_name} rejected: ${reason}`
			}, connection);

			// G3.2: reflect the decision in the SEEKER's application lifecycle. Rejecting is
			// the symmetric twin of approving — where approve system-sets 'Referred', reject
			// system-sets 'Not Referred' (§18.5: 'Referred'/'Not Referred' are system-set by
			// the referral decision, never from the ATS status menu). This gives the seeker a
			// clear terminal state instead of an application stuck at 'Applied'/'Shortlisted';
			// 'Not Referred' is not in ACTIVE_STATUSES, so it is naturally excluded from live
			// re-scoring. (A voided APPROVED referral still reopens to 'Shortlisted' — unchanged.)
			await referralRepository.setApplicationStatus(applicationId, 'Not Referred', connection);

			await connection.commit();

			emitReferralUpdated(io, { applicantId: application.applicant_id, employerId: adminId, referralId });

			// G3.1: tell the seeker their application was not referred. Best-effort, post-commit
			// (notifyUser never throws, 0.1); the decision already succeeded regardless. The
			// admin's internal reason is NOT echoed to the seeker.
			if (application.applicant_id) {
				await notifyUser(io, {
					userId: application.applicant_id,
					type: 'APPLICATION_DECLINED',
					title: 'Application not referred',
					body: `After review, your application for "${application.job_title}" was not referred by PESO at this time.`,
					link: '/my-applications',
				});
			}

			return { referralId, status: 'Rejected' };
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/**
	 * Stage an AI-recommended referral for human review. Called at apply time when
	 * the real DeepSeek score clears REFERRAL_AI_THRESHOLD. This SENDS NOTHING: it
	 * writes one 'Pending Review' row so the applicant surfaces in the admin's
	 * AI-Recommended queue for one-click approval. Idempotent -- if a referral
	 * already exists for the application, it is left untouched.
	 */
	async stageAiRecommendation({ applicationId, matchScore, aiAnalysis }) {
		const connection = await pool.getConnection();

		try {
			await connection.beginTransaction();

			const existing = await referralRepository.findReferralByApplication(applicationId, connection);
			if (existing) {
				await connection.commit();
				return { staged: false, reason: 'referral already exists', referralId: existing.id };
			}

			const recommendation = (aiAnalysis && typeof aiAnalysis.summary === 'string' && aiAnalysis.summary.trim())
				? aiAnalysis.summary.trim()
				: 'Flagged by AI compatibility scoring as a strong match for this vacancy.';

			const referralId = await referralRepository.createReferral({
				applicationId,
				matchScore: (matchScore === undefined || matchScore === null) ? null : matchScore,
				status: 'Pending Review',
				reviewedBy: null,
				remarks: null
			}, connection);

			await referralRepository.setAiRecommendation(referralId, recommendation, connection);

			await referralRepository.logActivity({
				queueId: referralId,
				actorId: null,
				action: 'AI_RECOMMENDED',
				detail: `Staged for PESO review at match score ${matchScore}%. ${recommendation}`
			}, connection);

			await connection.commit();

			return { staged: true, referralId };
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/** A job seeker's own approved referrals. */
	listForApplicant(applicantId) {
		return referralRepository.listForApplicant(applicantId);
	},

	/** Every referral for jobs this PESO administrator published (unpaginated). */
	listForEmployer(employerId) {
		return referralRepository.listForEmployer(employerId);
	},

	/**
	 * The Referral Register, paginated + filtered + sorted SERVER-SIDE (Phase 1).
	 * Returns the page rows, the total matching the active filters (for the pager),
	 * and delivery-state counts across the FULL set (for the filter chips, which
	 * must show real totals regardless of the current page or search).
	 */
	async listRegisterForEmployer(employerId, { page = 1, limit = 20, status = '', sort = 'newest', q = '' } = {}) {
		const offset = (Math.max(1, page) - 1) * limit;
		const [data, total, statusCounts] = await Promise.all([
			referralRepository.listForEmployerPaged(employerId, { limit, offset, status, sort, q }),
			referralRepository.countForEmployer(employerId, { status, q }),
			referralRepository.deliveryStateCountsForEmployer(employerId),
		]);
		return { data, total, statusCounts };
	},

	/** Referral decisions for every applicant to one of this admin's jobs. */
	listByJob(jobId, employerId) {
		return referralRepository.listByJob(jobId, employerId);
	},

	/** The AI-recommended queue: 'Pending Review' referrals awaiting approval. */
	listPendingReviewForEmployer(employerId) {
		return referralRepository.listPendingReviewForEmployer(employerId);
	},

	/** Dead-lettered delivery jobs awaiting manual attention. */
	listFailedForEmployer(employerId) {
		return referralRepository.listFailedForEmployer(employerId);
	},

	/**
	 * Re-arm a dead-lettered referral. Ownership and the 'failed' guard are both
	 * enforced inside retryFailedJob's WHERE clause, so a stale UI or a referral
	 * the admin does not own results in a no-op the caller can detect.
	 */
	async retryFailedReferral({ queueId, adminId }) {
		const affected = await referralRepository.retryFailedJob(queueId, adminId);

		if (!affected) {
			throw new ServiceError('No failed referral was found to retry. It may have already been retried or completed, or it belongs to a job you did not publish.', 404);
		}

		// The retry is already durable; a failed audit write must not undo it.
		try {
			await referralRepository.logActivity({
				queueId,
				actorId: adminId,
				action: 'RETRY_REQUESTED',
				detail: 'Failed referral delivery re-armed by administrator.'
			});
		} catch (logError) {
			console.error('[ReferralService] Could not write retry to audit log:', logError.message);
		}

		return { queueId, requeued: true };
	},

	/**
	 * Completed referrals that never reached n8n. Advisory only -- see
	 * referralRepository.listUndispatchedForEmployer for why this is a report
	 * and not an alert.
	 */
	async listUndispatched(employerId) {
		return referralRepository.listUndispatchedForEmployer(employerId);
	},

	// ── Platform-wide automation monitor + replay (Super Admin) ──────────────
	// "Automation" = Make.com (AUTOMATION_WEBHOOK_URL). The persisted step/action
	// keys keep their historical `dispatch_n8n` / `N8N_*` names (§59/§70).

	/** Platform-wide automation dispatch status: config, counts, and the undispatched list. */
	async getAutomationStatus() {
		const [counts, recentUndispatched] = await Promise.all([
			referralRepository.automationCounts(),
			referralRepository.listUndispatchedAll(100),
		]);
		return {
			configured: Boolean(process.env.AUTOMATION_WEBHOOK_URL),
			counts,
			recentUndispatched,
		};
	},

	/**
	 * Re-queues the automation (Make.com) dispatch for the given referrals.
	 * enqueueJob('dispatch_n8n') — the step key keeps its persisted name (§59) —
	 * resets the single outbox row to that step, so the worker runs ONLY the
	 * dispatch and completes — it never regenerates or re-emails the letter. Ids
	 * are narrowed to real Approved referrals first, so a stale UI cannot enqueue
	 * junk. If the automation webhook is still down the replay simply retries +
	 * skips again, exactly as a fresh dispatch would; it takes effect once reachable.
	 */
	async replayN8nDispatch(queueIds, adminId) {
		const valid = await referralRepository.filterApprovedQueueIds(queueIds);
		for (const queueId of valid) {
			await referralRepository.enqueueJob(queueId, 'dispatch_n8n');
			try {
				await referralRepository.logActivity({
					queueId, actorId: adminId, action: 'N8N_REPLAY_QUEUED',
					detail: 'Automation (Make.com) dispatch re-queued by an administrator.'
				});
			} catch (logError) {
				console.error('[ReferralService] Could not log automation replay:', logError.message);
			}
		}
		const requested = Array.isArray(queueIds) ? queueIds.length : 0;
		return { requeued: valid.length, skipped: requested - valid.length };
	},

	/**
	 * Cancels an approved referral and gives its vacancy slot back.
	 *
	 * WHEN THIS IS USED: the referral went to the wrong applicant, or the
	 * employer withdrew the vacancy after the letter went out. Before this
	 * existed the only option was to retry delivery -- the slot stayed consumed
	 * and the posting could sit permanently "Filled" against a referral everyone
	 * knew was void.
	 *
	 * VOID, NEVER DELETE. A letter was generated, emailed and received by a
	 * citizen. Deleting the row would erase the fact that it happened, which is
	 * the opposite of what an audit trail is for. The reason is mandatory.
	 *
	 * THE SLOT RELEASES ITSELF. The vacancy cap counts referrals with status
	 * 'Approved' (invariant 0.12); 'Voided' is not 'Approved', so the count drops
	 * by one the moment this commits, with no separate bookkeeping. That is the
	 * payoff of the cap being count-based rather than a flag.
	 *
	 * WHAT IT DOES NOT DO: unsend the email. The citizen keeps the letter they
	 * received. Telling them it no longer stands is a conversation PESO has, not
	 * something the software can retract -- so nothing here pretends otherwise.
	 */
	async voidReferral({ referralId, adminId, reason, io = null }) {
		const trimmedReason = String(reason || '').trim();

		if (trimmedReason.length < 5) {
			throw new ServiceError('Please give a short reason for cancelling this referral.', 400);
		}
		if (trimmedReason.length > 500) {
			throw new ServiceError('Please keep the reason under 500 characters.', 400);
		}

		const connection = await pool.getConnection();

		try {
			await connection.beginTransaction();

			const job = await referralRepository.findJobForReferral(referralId, connection);

			if (!job || Number(job.peso_admin_id) !== Number(adminId)) {
				// 404 not 403 -- the existence of another office's referral is not
				// disclosed to a stranger, consistent with every other referral route.
				throw new ServiceError('Referral not found.', 404);
			}

			// Lock the job row BEFORE the count, exactly as approveReferral does, so
			// a void and a concurrent approval on the same posting serialize instead
			// of both reading a stale count and over-filling the vacancy.
			await referralRepository.lockJobVacancy(job.job_id, connection);

			const affected = await referralRepository.voidReferral({ referralId, adminId, reason: trimmedReason }, connection);

			if (!affected) {
				// The guard is in the UPDATE's WHERE clause, so this covers both
				// "never approved" and "another admin voided it a moment ago".
				throw new ServiceError('Only an approved referral can be cancelled. This one may have been cancelled already.', 409);
			}

			const capacity = Math.max(1, Number(job.positions_available) || 1);
			const approvedNow = await referralRepository.countApprovedForJob(job.job_id, connection);

			// Reopen a posting that had been auto-filled. Without this the vacancy
			// stays closed to new applicants even though a slot is genuinely free
			// again -- the bug this feature exists to prevent.
			let reopened = false;
			if (job.status === 'Filled' && approvedNow < capacity) {
				await referralRepository.setJobStatus(job.job_id, 'Open', connection);
				reopened = true;
			}

			// Reopen path for the APPLICATION (2026-08-04): a voided referral is no longer
			// finalized, so return it to an active ATS state ('Shortlisted' — it was
			// qualified enough to be referred). This re-enters it into live AI re-scoring
			// (§18.5); the apply-time historical score is untouched.
			await referralRepository.setApplicationStatus(job.application_id, 'Shortlisted', connection);

			await referralRepository.logActivity({
				queueId: referralId,
				actorId: adminId,
				action: 'REFERRAL_VOIDED',
				detail: `Referral cancelled. Reason: ${trimmedReason}`
					+ ` Slot released (${approvedNow} of ${capacity} now referred).`
					+ (reopened ? ` "${job.title}" reopened for applications.` : '')
			}, connection);

			await connection.commit();

			// G3: tell the SEEKER their approved referral was withdrawn. They were
			// notified when it was ISSUED (REFERRAL_ISSUED), so leaving them uninformed
			// on a void made their referral status go stale. Best-effort, post-commit
			// (notifyUser never throws, 0.11); the void already succeeded regardless.
			// The admin's internal reason is deliberately NOT echoed to the seeker.
			if (job.applicant_id) {
				await notifyUser(io, {
					userId: job.applicant_id,
					type: 'REFERRAL_WITHDRAWN',
					title: 'Referral withdrawn',
					body: `Your referral for "${job.title}" has been withdrawn by PESO and your application is back under review.`,
					link: '/referrals',
				});
			}

			return { referralId, voided: true, reopened, approved: approvedNow, capacity };
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},

	/**
	 * Referral report for one PESO administrator over a date range.
	 *
	 * Produces the three things DOLE asks for: a monthly count, a list of names
	 * (via exportReport), and a placement rate.
	 *
	 * ── THE PLACEMENT RATE IS REPORTED TWO WAYS, ON PURPOSE ─────────────────
	 * A single number here would be misleading in both directions:
	 *
	 *   of_all    Hired / every referral issued. Currently understates badly,
	 *             because most historical referrals have no recorded outcome and
	 *             are counted as failures they were never assessed as.
	 *   of_known  Hired / referrals with a recorded outcome. Currently overstates
	 *             wildly -- with 2 outcomes recorded and both 'Hired' it reads
	 *             100%.
	 *
	 * Publishing either alone would be indefensible, so both ship together with
	 * `unknown` exposed as its own figure. Whoever files the report can then
	 * state the denominator instead of guessing it. As outcome recording becomes
	 * routine the two converge.
	 */
	async buildReport({ employerId, from, to }) {
		const range = { from: from || null, to: to || null };

		for (const [label, value] of Object.entries(range)) {
			if (value && Number.isNaN(new Date(value).getTime())) {
				throw new ServiceError(`The "${label}" date is not a valid date.`, 400);
			}
		}
		if (range.from && range.to && new Date(range.from) > new Date(range.to)) {
			throw new ServiceError('The start date must not be after the end date.', 400);
		}

		const [totals, monthly] = await Promise.all([
			referralRepository.reportOutcomeTotals({ employerId, ...range }),
			referralRepository.reportMonthly({ employerId, ...range })
		]);

		const byOutcome = VALID_OUTCOMES.reduce((acc, name) => ({ ...acc, [name]: 0 }), {});
		let total = 0;
		for (const row of totals) {
			byOutcome[row.outcome] = Number(row.count);
			total += Number(row.count);
		}

		const hired = byOutcome['Hired'];
		// 'Issued' means nobody has followed this referral up -- it is an unknown,
		// not a negative result. Every other value is a decided outcome.
		const unknown = byOutcome['Issued'];
		const known = total - unknown;

		const pct = (numerator, denominator) =>
			denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

		return {
			range,
			total_referrals: total,
			hired,
			unknown,
			decided: known,
			by_outcome: byOutcome,
			placement_rate: {
				of_all: pct(hired, total),
				of_known: pct(hired, known),
				// Spelled out so the report can print its own denominator rather
				// than leaving the reader to infer it.
				basis: `${hired} hired of ${total} referred (${unknown} with no recorded outcome)`
			},
			monthly: monthly.map((m) => ({
				month: m.month,
				referrals: Number(m.referrals),
				hired: Number(m.hired),
				placement_rate: pct(Number(m.hired), Number(m.referrals))
			}))
		};
	},

	/** The same cohort as buildReport, row per referral, for CSV export. */
	async listReportRows({ employerId, from, to }) {
		return referralRepository.reportRows({ employerId, from: from || null, to: to || null });
	},

	/**
	 * Records the placement outcome of a referral.
	 *
	 * This is the answer to "did this citizen get the job?" -- the question the
	 * module could not answer before migration 023, and the one PESO is actually
	 * mandated to care about.
	 *
	 * Captured by an administrator, because employers report hires by EMAIL to
	 * the office rather than through any portal. `outcomeAt` is the date the
	 * employer reports, which is usually days before PESO reads the mail; DOLE
	 * reporting must use it rather than the entry timestamp.
	 *
	 * Deliberately NOT a state machine. Real referrals skip steps -- an employer
	 * commonly reports "hired" with no prior acknowledgement -- and rejecting
	 * those transitions would force staff to record events that never happened.
	 */
	async recordOutcome({ queueId, outcome, outcomeAt, notes, adminId, io = null }) {
		if (!VALID_OUTCOMES.includes(outcome)) {
			throw new ServiceError(
				`Unknown outcome. Expected one of: ${VALID_OUTCOMES.join(', ')}.`,
				400
			);
		}

		// Owner-scoped: authentication is not authorization. Reported as 404 so
		// the existence of another office's referral is never disclosed.
		const owned = await referralRepository.isReferralOwnedBy(queueId, adminId);
		if (!owned) {
			throw new ServiceError('Referral not found.', 404);
		}

		let parsedOutcomeAt = null;
		if (outcomeAt) {
			const parsed = new Date(outcomeAt);
			if (Number.isNaN(parsed.getTime())) {
				throw new ServiceError('The outcome date is not a valid date.', 400);
			}
			// A hire cannot be reported for next week. Guards against a typo in
			// the year turning one row into a permanent outlier in every report.
			if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
				throw new ServiceError('The outcome date cannot be in the future.', 400);
			}
			parsedOutcomeAt = parsed;
		}

		const previous = await referralRepository.findOutcome(queueId);
		const previousOutcome = previous?.outcome || 'Issued';

		// THE OFFICIAL WRITE — unchanged. This one row is what the DOLE placement
		// report and the public "Successful Referrals" tile count (invariant 0.14),
		// so ONLY an administrator ever reaches it.
		await referralRepository.setOutcome({
			queueId,
			outcome,
			outcomeAt: parsedOutcomeAt,
			notes,
			recordedBy: adminId
		});

		// The outcome is already durable; a failed audit write must not undo it.
		try {
			await referralRepository.logActivity({
				queueId,
				actorId: adminId,
				action: 'OUTCOME_RECORDED',
				detail: `Outcome ${previous ? `changed from ${previous.outcome} to` : 'set to'} ${outcome}`
					+ (parsedOutcomeAt ? ` (occurred ${parsedOutcomeAt.toISOString().slice(0, 10)})` : '')
					+ (notes ? `. Note: ${String(notes).slice(0, 180)}` : '.')
			});
		} catch (logError) {
			console.error('[ReferralService] Could not write outcome to audit log:', logError.message);
		}

		// ── Synchronized-lifecycle side effects (flag-gated, 2026) ──────────────
		// Structured history row + a notification to the seeker. Both are SECONDARY
		// concerns: each is wrapped so a failure here can never undo the official
		// outcome that already committed above (invariant 0.1).
		if (await isLifecycleSyncEnabled()) {
			try {
				await referralRepository.appendOutcomeHistory({
					queueId,
					outcome,
					outcomeAt: parsedOutcomeAt,
					previousOutcome,
					notes,
					changedBy: adminId,
					changedByRole: ROLE_KEYS.PESO_ADMINISTRATOR,
					isOfficial: true,
				});
			} catch (histError) {
				console.error('[ReferralService] Could not append outcome history:', histError.message);
			}

			// Notify the seeker only on a real change — recording the same value, or
			// the "no news" default with nothing prior, is not worth a bell entry.
			if (outcome !== previousOutcome) {
				try {
					const detail = await referralRepository.findReferralById(queueId);
					if (detail?.applicant_id) {
						const label = outcome === 'Issued' ? 'Awaiting outcome' : outcome;
						await notifyUser(io, {
							userId: detail.applicant_id,
							type: 'REFERRAL_OUTCOME',
							title: 'Referral outcome updated',
							body: `Your referral for ${detail.job_title} is now: ${label}.`,
							link: '/referrals',
						});
						// Best-effort real-time nudge so an open My Referrals refreshes
						// at once; the notification row is the durable deliverable.
						try {
							if (io) io.to(`user_${detail.applicant_id}`).emit('referral_outcome_updated', { referralId: queueId, at: Date.now() });
						} catch (emitError) { /* socket best-effort (0.1) */ }
					}
				} catch (notifyError) {
					console.error('[ReferralService] Could not notify seeker of outcome:', notifyError.message);
				}
			}
		}

		return { queueId, outcome, outcomeAt: parsedOutcomeAt, previousOutcome: previous?.outcome || null };
	},

	/**
	 * A JOB SEEKER reports an outcome they heard directly from the employer.
	 *
	 * This is the collaborative half of the lifecycle: employers sometimes tell the
	 * applicant before they email PESO. The seeker's report is a SUGGESTION, never
	 * the official record — it is appended to referral_outcome_history with
	 * is_official=0 and NEVER written to referral_outcomes, so it cannot move the
	 * DOLE placement rate or the public "Successful Referrals" tile until a named
	 * administrator confirms it (invariant 0.14, and 0.4's spirit — the office still
	 * owns the official fact). The administrator sees it in the Register with a
	 * one-click Confirm that runs the ordinary recordOutcome path.
	 *
	 * Owner-scoped to the applicant the referral names; anyone else gets a 404.
	 */
	async suggestOutcome({ queueId, outcome, outcomeAt, notes, seekerId, io = null }) {
		if (!VALID_OUTCOMES.includes(outcome)) {
			throw new ServiceError(`Unknown outcome. Expected one of: ${VALID_OUTCOMES.join(', ')}.`, 400);
		}
		// 'Issued' is the "no news" default, not something a seeker reports.
		if (outcome === 'Issued') {
			throw new ServiceError('Choose the update you received from the employer.', 400);
		}

		const referral = await referralRepository.findReferralById(queueId);
		// 404 (never 403): the existence of another citizen's referral is not disclosed.
		if (!referral || Number(referral.applicant_id) !== Number(seekerId)) {
			throw new ServiceError('Referral not found.', 404);
		}
		if (referral.status !== 'Approved') {
			throw new ServiceError('You can only report an update on an issued referral.', 409);
		}

		let parsedOutcomeAt = null;
		if (outcomeAt) {
			const parsed = new Date(outcomeAt);
			if (Number.isNaN(parsed.getTime())) {
				throw new ServiceError('The date is not a valid date.', 400);
			}
			if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
				throw new ServiceError('The date cannot be in the future.', 400);
			}
			parsedOutcomeAt = parsed;
		}

		const previous = await referralRepository.findOutcome(queueId);

		// The suggestion itself is the primary action here; it must be durable.
		await referralRepository.appendOutcomeHistory({
			queueId,
			outcome,
			outcomeAt: parsedOutcomeAt,
			previousOutcome: previous?.outcome || 'Issued',
			notes,
			changedBy: seekerId,
			changedByRole: ROLE_KEYS.JOB_SEEKER,
			isOfficial: false,
		});

		// Unified human-readable trail (visible to seeker + admin via /activity).
		try {
			await referralRepository.logActivity({
				queueId,
				actorId: seekerId,
				action: 'OUTCOME_SUGGESTED',
				detail: `Job seeker reported "${outcome}"`
					+ (parsedOutcomeAt ? ` (occurred ${parsedOutcomeAt.toISOString().slice(0, 10)})` : '')
					+ (notes ? `. Note: ${String(notes).slice(0, 180)}` : '.')
					+ ' Awaiting administrator confirmation.'
			});
		} catch (logError) {
			console.error('[ReferralService] Could not log outcome suggestion:', logError.message);
		}

		// Notify the issuing administrator so they can confirm it into the record.
		if (referral.employer_id) {
			try {
				await notifyUser(io, {
					userId: referral.employer_id,
					type: 'REFERRAL_OUTCOME',
					title: 'Job seeker reported a referral update',
					body: `${referral.applicant_name} reports "${outcome}" for ${referral.job_title}. Review and confirm in the Referral Register.`,
					link: '/referrals',
				});
				try {
					if (io) io.to(`user_${referral.employer_id}`).emit('referral_outcome_updated', { referralId: queueId, at: Date.now() });
				} catch (emitError) { /* socket best-effort (0.1) */ }
			} catch (notifyError) {
				console.error('[ReferralService] Could not notify admin of suggestion:', notifyError.message);
			}
		}

		return { queueId, outcome, outcomeAt: parsedOutcomeAt, suggested: true };
	},

	/**
	 * The structured outcome-transition ledger for one referral (migration 036).
	 * Same access rules as the referral itself, reused via getReferralDetail — so
	 * it can never be read by someone who cannot see the referral it describes.
	 * Visible to the seeker it names too: they are entitled to their own trail.
	 */
	async getOutcomeHistory({ referralId, userId, role }) {
		await this.getReferralDetail({ referralId, userId, role });
		return referralRepository.listOutcomeHistory(referralId);
	},

	/**
	 * Full referral detail, with access control. Visible only to the job seeker it
	 * names, the PESO administrator who issued it, or a super administrator.
	 * Everyone else is told it does not exist -- a 404, never a 403, so the
	 * existence of a citizen's referral is not disclosed to a stranger.
	 */
	async getReferralDetail({ referralId, userId, role }) {
		const referral = await referralRepository.findReferralById(referralId);
		if (!referral) {
			throw new ServiceError('Referral not found.', 404);
		}

		const isApplicant = Number(referral.applicant_id) === Number(userId);
		const isIssuer = Number(referral.employer_id) === Number(userId);
		const isSuperAdmin = normalizeRole(role) === ROLE_KEYS.SUPER_ADMINISTRATOR;

		if (!isApplicant && !isIssuer && !isSuperAdmin) {
			throw new ServiceError('Referral not found.', 404);
		}

		return referral;
	},

	/**
	 * The audit trail for one referral.
	 *
	 * The module has been writing referral_activity_log faithfully since it was
	 * built -- approvals, PDF generation, email delivery, failures, retries,
	 * outcomes, regenerations -- and nothing ever read it back. For a workflow
	 * whose defensibility rests on "a named administrator approved every one",
	 * the evidence was write-only.
	 *
	 * ACCESS: identical rules to the referral itself, reused rather than
	 * reimplemented via getReferralDetail -- so the trail can never be readable
	 * by someone who cannot see the referral it describes. Unauthorized callers
	 * get 404, never 403: the existence of a citizen's referral is not disclosed
	 * to a stranger.
	 */
	async getReferralActivity({ referralId, userId, role }) {
		await this.getReferralDetail({ referralId, userId, role });
		return referralRepository.listActivity(referralId);
	}
};

module.exports = { referralService, ServiceError, getReferralPreference, setReferralPreference, REFERRAL_MODES };
