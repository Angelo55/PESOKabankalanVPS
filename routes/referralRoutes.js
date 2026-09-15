const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const { requireRole, ROLE_KEYS } = require('../middleware/rbac');
const { referralService, ServiceError } = require('../services/referralService');
const referralRepository = require('../repositories/referralRepository');
const { buildAccomplishmentExport } = require('../services/reportingService');
const systemSettings = require('../services/systemSettingsService');
const { getPageParams } = require('../utils/pagination');
const fs = require('fs');
const { resolveLetterPath } = require('../services/pdfService');

const router = express.Router();

router.use(requireAuth);

/**
 * Translates a service-layer error into an HTTP response. Unknown errors are
 * logged in full and reported to the caller as a generic 500 -- internal detail
 * (SQL text, table names, stack traces) never crosses the wire.
 */
function handleError(res, error, context) {
	if (error instanceof ServiceError) {
		return res.status(error.statusCode).json({
			status: 'error',
			message: error.message,
			data: error.data || null
		});
	}

	console.error(`[Referral] ${context}:`, error);
	return res.status(500).json({ status: 'error', message: 'An unexpected error occurred.' });
}

function parseId(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * POST /api/referrals/applications/:applicationId/approve
 * PESO Administrator only.
 *
 * Returns 202 Accepted, not 200 OK. The referral IS committed -- but the letter
 * has not been generated and no email has been sent. 202 is the correct code
 * for "recorded and accepted for processing", and it keeps the frontend honest:
 * it must show "Queued", not "Sent".
 */
router.post(
	'/applications/:applicationId/approve',
	requireRole(ROLE_KEYS.PESO_ADMINISTRATOR),

	
	async (req, res) => {
		const applicationId = parseId(req.params.applicationId);
		

		if (!applicationId) {
			return res.status(400).json({ status: 'error', message: 'A valid application ID is required.' });
		}

		try {
			
			const result = await referralService.approveReferral({
				applicationId,
				adminId: req.userId,
				remarks: req.body?.remarks,
				io: req.app.get('io')
			});

			return res.status(202).json({
				status: 'success',
				message: `Referral ${result.referenceNumber} approved and queued for delivery.`,
				data: result
			});
		} catch (error) {
			return handleError(res, error, 'approveReferral');
		}
	}
);

/**
 * POST /api/referrals/applications/:applicationId/reject
 * PESO Administrator only. A reason is mandatory.
 */
router.post(
	'/applications/:applicationId/reject',
	requireRole(ROLE_KEYS.PESO_ADMINISTRATOR),
	async (req, res) => {
		const applicationId = parseId(req.params.applicationId);

		if (!applicationId) {
			return res.status(400).json({ status: 'error', message: 'A valid application ID is required.' });
		}

		try {
			const result = await referralService.rejectReferral({
				applicationId,
				adminId: req.userId,
				remarks: req.body?.remarks,
				io: req.app.get('io')
			});

			return res.status(200).json({
				status: 'success',
				message: 'Referral rejected.',
				data: result
			});
		} catch (error) {
			return handleError(res, error, 'rejectReferral');
		}
	}
);

/**
 * POST /api/referrals/applications/bulk/:decision   (decision = approve | reject)
 * PESO Administrator only. Decides several recommendations in one request.
 *
 * CRITICAL: this is a LOOP over the existing single-item service calls, NOT a new
 * bulk transaction. Each approval therefore keeps its OWN transaction and its own
 * vacancy-cap check — so if a batch would over-fill a vacancy, the referrals that
 * fit succeed and the ones past capacity come back as a per-item 409, exactly as
 * they would one at a time. Collapsing them into one transaction would either let
 * the cap be exceeded or fail the whole batch for one full vacancy; neither is
 * acceptable (§0.12). The response reports each id's outcome so the UI can drop
 * the ones that succeeded and leave the rest with their reason.
 */
router.post(
	'/applications/bulk/:decision',
	requireRole(ROLE_KEYS.PESO_ADMINISTRATOR),
	async (req, res) => {
		const decision = req.params.decision;
		if (decision !== 'approve' && decision !== 'reject') {
			return res.status(400).json({ status: 'error', message: 'Decision must be "approve" or "reject".' });
		}

		const ids = (Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [])
			.map(parseId)
			.filter(Boolean);
		if (ids.length === 0) {
			return res.status(400).json({ status: 'error', message: 'No applications selected.' });
		}
		if (decision === 'reject' && !String(req.body?.remarks || '').trim()) {
			return res.status(400).json({ status: 'error', message: 'A reason is required to reject.' });
		}

		const results = [];
		for (const applicationId of ids) {
			try {
				if (decision === 'approve') {
					const r = await referralService.approveReferral({ applicationId, adminId: req.userId, remarks: req.body?.remarks, io: req.app.get('io') });
					results.push({ applicationId, ok: true, referenceNumber: r.referenceNumber });
				} else {
					await referralService.rejectReferral({ applicationId, adminId: req.userId, remarks: req.body.remarks, io: req.app.get('io') });
					results.push({ applicationId, ok: true });
				}
			} catch (error) {
				// A per-item failure (e.g. 409 vacancy full, already decided) must not
				// abort the rest of the batch — record it and continue.
				results.push({
					applicationId,
					ok: false,
					code: error instanceof ServiceError ? error.statusCode : 500,
					message: error?.message || 'Failed.'
				});
			}
		}

		const succeeded = results.filter(r => r.ok).length;
		return res.status(succeeded > 0 ? 200 : 409).json({
			status: succeeded > 0 ? 'success' : 'error',
			message: `${succeeded} of ${ids.length} ${decision === 'approve' ? 'approved' : 'rejected'}.`,
			data: { results, succeeded, failed: ids.length - succeeded }
		});
	}
);

/**
 * GET /api/referrals/mine
 * The authenticated job seeker's own approved referrals.
 *
 * MUST be declared before GET /:id, or Express matches "mine" as an :id.
 */
router.get('/mine', async (req, res) => {
	try {
		const referrals = await referralService.listForApplicant(req.userId);
		return res.status(200).json({ status: 'success', data: referrals });
	} catch (error) {
		return handleError(res, error, 'listForApplicant');
	}
});

/**
 * GET /api/referrals
 * All referrals for jobs this PESO Administrator published, with live
 * delivery status pulled from the outbox.
 */
router.get('/', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		// Server-side pagination + search + delivery-state filter + sort (Phase 1).
		const { limit, page } = getPageParams(req.query, { defaultLimit: 10, maxLimit: 100 });
		const status = String(req.query.status || '').trim();
		const sort = String(req.query.sort || 'newest').trim();
		const q = String(req.query.q || '').trim();

		const result = await referralService.listRegisterForEmployer(req.userId, { page, limit, status, sort, q });
		return res.status(200).json({
			status: 'success',
			data: result.data,
			total: result.total,
			page,
			limit,
			statusCounts: result.statusCounts,
		});
	} catch (error) {
		return handleError(res, error, 'listForEmployer');
	}
});

/**
 * GET /api/referrals/jobs/:jobId
 * PESO Administrator only.
 *
 * Referral decisions for all applicants to one job, so the ATS can render the
 * correct button state on load instead of assuming every applicant is
 * un-referred. Returned as a list; the client keys it by application_id.
 */
router.get('/jobs/:jobId', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	const jobId = parseId(req.params.jobId);

	if (!jobId) {
		return res.status(400).json({ status: 'error', message: 'A valid job ID is required.' });
	}

	try {
		const referrals = await referralService.listByJob(jobId, req.userId);
		return res.status(200).json({ status: 'success', data: referrals });
	} catch (error) {
		return handleError(res, error, 'listByJob');
	}
});



/**
 * GET /api/referrals/recommended
 * PESO Administrator only. The AI-recommended queue: high-match applicants the
 * AI staged, awaiting human approval. Ordered by score, best first.
 */
router.get('/recommended', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const recommendations = await referralService.listPendingReviewForEmployer(req.userId);
		return res.status(200).json({ status: 'success', data: recommendations });
	} catch (error) {
		return handleError(res, error, 'listRecommended');
	}
});

/**
 * GET /api/referrals/failed
 * PESO Administrator only. Dead-lettered referrals awaiting manual attention.
 */
router.get('/failed', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const failed = await referralService.listFailedForEmployer(req.userId);
		return res.status(200).json({ status: 'success', data: failed });
	} catch (error) {
		return handleError(res, error, 'listFailed');
	}
});

/**
 * GET /api/referrals/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * PESO Administrator only, owner-scoped.
 *
 * The monthly count and placement rate DOLE asks for. Both dates optional;
 * omitting them reports on everything.
 *
 * MUST be declared before GET /:id -- otherwise Express matches "reports" as
 * an :id, the same trap /mine already documents above.
 */
router.get('/reports/summary', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const report = await referralService.buildReport({
			employerId: req.userId,
			from: req.query.from,
			to: req.query.to
		});
		return res.status(200).json({ status: 'success', data: report });
	} catch (error) {
		return handleError(res, error, 'buildReport');
	}
});

// CSV escaping moved to utils/csv.js so the ATS applicant export and the
// dashboard summary export share this exact implementation (quote everything,
// prefix = + - @ against Excel formula injection) rather than re-deriving it.
// Imported under the original name, so the call sites below are unchanged.
const { csvField } = require('../utils/csv');

/**
 * GET /api/referrals/reports/export?from=&to=
 * PESO Administrator only, owner-scoped. Returns text/csv.
 *
 * The list of names DOLE asks for. Streaming is unnecessary at this scale and
 * would complicate the auth-header download the client already uses for letters.
 */
router.get('/reports/export', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const rows = await referralService.listReportRows({
			employerId: req.userId,
			from: req.query.from,
			to: req.query.to
		});

		const header = [
			'Reference Number', 'Applicant Name', 'Applicant Email', 'Position',
			'Employer', 'Date Referred', 'AI Match Score', 'Outcome',
			'Outcome Date', 'Outcome Notes', 'Recorded By'
		];

		const lines = [header.map(csvField).join(',')];

		for (const row of rows) {
			lines.push([
				row.reference_number, row.applicant_name, row.applicant_email,
				row.job_title, row.company_name, row.issued_at, row.match_score,
				row.outcome, row.outcome_at, row.outcome_notes, row.outcome_recorded_by
			].map(csvField).join(','));
		}

		const stamp = new Date().toISOString().slice(0, 10);
		const filename = `peso-referrals-${req.query.from || 'all'}-to-${req.query.to || stamp}.csv`;

		// BOM so Excel opens UTF-8 correctly -- without it Filipino names with
		// accented characters render as mojibake.
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		return res.send('﻿' + lines.join('\r\n'));
	} catch (error) {
		return handleError(res, error, 'exportReport');
	}
});

/**
 * GET /api/referrals/reports/accomplishment?from=&to=&format=json|pdf|csv
 * PESO Administrator only, OWNER-SCOPED (this administrator's postings).
 *
 * The DOLE PESO Accomplishment Report (aggregate + demographic), distinct from the flat
 * referral-row export above. Same referred/placed cohort as /reports/summary, so the two
 * reconcile. json → the structured object (for the on-screen tables); pdf/csv → a download.
 */
router.get('/reports/accomplishment', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const format = ['pdf', 'csv'].includes(req.query.format) ? req.query.format : 'json';
		const out = await buildAccomplishmentExport({ ownerId: req.userId, from: req.query.from, to: req.query.to, format });
		if (format === 'json') return res.status(200).json({ status: 'success', data: out.body });
		res.setHeader('Content-Type', out.contentType);
		res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
		return res.send(out.body);
	} catch (error) {
		return handleError(res, error, 'accomplishmentReport');
	}
});

/**
 * GET /api/referrals/undispatched
 * PESO Administrator only, owner-scoped.
 *
 * Completed referrals that never reached n8n. Advisory: the referral is done
 * and the citizen has their letter -- only the downstream side effects are
 * missing. Surfaced because the gap was previously invisible.
 *
 * Declared before GET /:id, same reason as /mine and /reports.
 */
router.get('/undispatched', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	try {
		const rows = await referralService.listUndispatched(req.userId);
		return res.status(200).json({ status: 'success', data: rows, count: rows.length });
	} catch (error) {
		return handleError(res, error, 'listUndispatched');
	}
});

/**
 * POST /api/referrals/:id/retry
 * PESO Administrator only. Re-arms a failed referral for delivery.
 */
router.post('/:id/retry', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	const queueId = parseId(req.params.id);

	if (!queueId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const result = await referralService.retryFailedReferral({ queueId, adminId: req.userId });
		return res.status(200).json({ status: 'success', message: 'Referral re-queued for delivery.', data: result });
	} catch (error) {
		return handleError(res, error, 'retryFailedReferral');
	}
});


/**
 * PUT /api/referrals/:id/outcome
 * PESO Administrator only, owner-scoped.
 *
 * Records what actually happened after the letter went out. Employers report
 * hires by email to the office, so this is entered by whoever reads that mail.
 *
 * `outcome_at` is the date the EMPLOYER reports the event happening, which is
 * normally earlier than the moment PESO types it in. Reports use it.
 */
router.put('/:id/outcome', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	const queueId = parseId(req.params.id);

	if (!queueId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const { outcome, outcome_at: outcomeAt, notes } = req.body || {};

		const result = await referralService.recordOutcome({
			queueId,
			outcome,
			outcomeAt,
			notes,
			adminId: req.userId,
			io: req.app.get('io'),
		});

		return res.status(200).json({
			status: 'success',
			message: `Outcome recorded: ${result.outcome}.`,
			data: result
		});
	} catch (error) {
		return handleError(res, error, 'recordOutcome');
	}
});

/**
 * POST /api/referrals/:id/outcome/suggest
 * Job Seeker only (owner-scoped to the referral they were named on).
 *
 * The collaborative half of the lifecycle: the seeker reports an outcome they
 * heard from the employer. It is recorded as a SUGGESTION (referral_outcome_history,
 * is_official=0) and NEVER written to referral_outcomes, so it cannot move the
 * official placement statistics until a PESO administrator confirms it (0.14).
 * Gated by the runtime feature flag so the whole feature ships dark.
 */
router.post('/:id/outcome/suggest', async (req, res) => {
	const queueId = parseId(req.params.id);
	if (!queueId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const enabled = await systemSettings.get('referral_lifecycle_sync_enabled');
		if (!enabled) {
			return res.status(403).json({ status: 'error', message: 'Reporting a referral update is not currently available.' });
		}

		const { outcome, outcome_at: outcomeAt, notes } = req.body || {};
		const result = await referralService.suggestOutcome({
			queueId,
			outcome,
			outcomeAt,
			notes,
			seekerId: req.userId,
			io: req.app.get('io'),
		});

		return res.status(200).json({
			status: 'success',
			message: 'Thanks — PESO will confirm this update.',
			data: result,
		});
	} catch (error) {
		return handleError(res, error, 'suggestOutcome');
	}
});

/**
 * POST /api/referrals/:id/accept  &  POST /api/referrals/:id/decline
 * Job Seeker only (owner-scoped inside the service). The seeker-acceptance step of
 * the personalized referral lifecycle (#6). Gated by referral_acceptance_enabled so
 * the whole feature ships dark; ACCEPT runs the SAME approval pipeline a direct
 * approval uses (mints the letter + arms the delivery outbox).
 */
async function acceptanceEnabled() {
	const raw = await systemSettings.get('referral_acceptance_enabled');
	return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

router.post('/:id/accept', async (req, res) => {
	const referralId = parseId(req.params.id);
	if (!referralId) return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	try {
		if (!(await acceptanceEnabled())) {
			return res.status(403).json({ status: 'error', message: 'Referral acceptance is not currently available.' });
		}
		const result = await referralService.acceptReferral({ referralId, applicantId: req.userId, io: req.app.get('io') });
		return res.status(200).json({ status: 'success', message: 'Referral accepted. Your official letter is being issued.', data: result });
	} catch (error) {
		return handleError(res, error, 'acceptReferral');
	}
});

router.post('/:id/decline', async (req, res) => {
	const referralId = parseId(req.params.id);
	if (!referralId) return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	try {
		if (!(await acceptanceEnabled())) {
			return res.status(403).json({ status: 'error', message: 'Referral acceptance is not currently available.' });
		}
		const result = await referralService.declineReferral({ referralId, applicantId: req.userId, reason: req.body?.reason || null, io: req.app.get('io') });
		return res.status(200).json({ status: 'success', message: 'Referral declined.', data: result });
	} catch (error) {
		return handleError(res, error, 'declineReferral');
	}
});

/**
 * GET /api/referrals/:id/outcome/history
 * The structured outcome-transition ledger. Same access rules as the referral
 * and its activity trail: the seeker it names, the issuing administrator, or a
 * super administrator. Everyone else gets 404.
 */
router.get('/:id/outcome/history', async (req, res) => {
	const referralId = parseId(req.params.id);
	if (!referralId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const history = await referralService.getOutcomeHistory({
			referralId,
			userId: req.userId,
			role: req.userRole,
		});
		return res.status(200).json({ status: 'success', data: history });
	} catch (error) {
		return handleError(res, error, 'getOutcomeHistory');
	}
});

/**
 * POST /api/referrals/:id/void
 * PESO Administrator only, owner-scoped. A reason is mandatory.
 *
 * Cancels an approved referral and releases its vacancy slot. The record is
 * kept, never deleted -- a letter really was issued, and the trail must say so.
 */
router.post('/:id/void', requireRole(ROLE_KEYS.PESO_ADMINISTRATOR), async (req, res) => {
	const referralId = parseId(req.params.id);

	if (!referralId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const result = await referralService.voidReferral({
			referralId,
			adminId: req.userId,
			reason: req.body?.reason,
			io: req.app.get('io')
		});

		return res.status(200).json({
			status: 'success',
			message: result.reopened
				? 'Referral cancelled. The job posting is open for applications again.'
				: 'Referral cancelled and the position is available again.',
			data: result
		});
	} catch (error) {
		return handleError(res, error, 'voidReferral');
	}
});

/**
 * GET /api/referrals/:id/activity
 *
 * The audit trail. Same access rules as the referral and its letter: the job
 * seeker it names, the PESO administrator who issued it, or a super
 * administrator. Everyone else gets 404.
 *
 * Deliberately NOT restricted to administrators -- a citizen is entitled to see
 * what was done with their own referral and when.
 */
router.get('/:id/activity', async (req, res) => {
	const referralId = parseId(req.params.id);

	if (!referralId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		const activity = await referralService.getReferralActivity({
			referralId,
			userId: req.userId,
			role: req.userRole
		});
		return res.status(200).json({ status: 'success', data: activity });
	} catch (error) {
		return handleError(res, error, 'getReferralActivity');
	}
});

/**
 * GET /api/referrals/:id/letter
 * Streams the referral letter PDF.
 *
 * Letters are NOT in /uploads and are NOT publicly served. A referral letter
 * carries a citizen's name and the employer they were endorsed to; a public URL
 * would leak that to anyone who ever saw the link. Access is resolved by the
 * same rules as the referral detail: the issuing PESO administrator, the job
 * seeker it names, or a super administrator. Everyone else gets a 404.
 */
router.get('/:id/letter', async (req, res) => {
	const referralId = parseId(req.params.id);

	if (!referralId) {
		return res.status(400).json({ status: 'error', message: 'A valid referral ID is required.' });
	}

	try {
		// Reuses the access control already written. Throws 404 if unauthorized.
		const referral = await referralService.getReferralDetail({
			referralId,
			userId: req.userId,
			role: req.userRole
		});

		// DURABLE COPY FIRST (migration 021). storage/ is ephemeral on Render --
		// every deploy wipes it -- so the database is the source of truth and
		// disk is only consulted for referrals issued before 021 that the
		// backfill has not reached.
		const stored = await referralRepository.findLetterFile(referralId);

		if (stored) {
			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader('Content-Length', stored.buffer.length);
			res.setHeader('Content-Disposition', `inline; filename="${referral.reference_number}.pdf"`);
			return res.send(stored.buffer);
		}

		if (!referral.pdf_path) {
			return res.status(404).json({ status: 'error', message: 'The letter for this referral has not been generated yet.' });
		}

		const absolutePath = resolveLetterPath(referral.pdf_path);

		if (!fs.existsSync(absolutePath)) {
			return res.status(404).json({
				status: 'error',
				message: 'The letter file is missing from storage. It predates durable letter storage and its file is gone; please regenerate it.'
			});
		}

		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', `inline; filename="${referral.reference_number}.pdf"`);

		return fs.createReadStream(absolutePath).pipe(res);
	} catch (error) {
		return handleError(res, error, 'downloadLetter');
	}
});

module.exports = router;