/**
 * PESO ADMINISTRATOR WORKSPACE — vacancy management and the ATS.
 *
 * WHAT: everything an administrator does with their own postings — create and
 * edit vacancies, upload featured images, manage screening questions, work the
 * Applicant Tracking System, change application statuses, and stream the exact
 * resume an applicant submitted.
 *
 * WHEN: every screen behind "Job Publication Management" and "Applicant
 * Pipeline", plus the operational "Dashboard" analytics
 * (GET /analytics/overview, consumed by PesoAdminOverview.jsx).
 *
 * MOUNTED TWICE: at /api/peso-admin and, as a deprecated alias, /api/employer.
 * The alias exists only so older clients keep working and should be removed once
 * the frontend has fully moved over. Do not build new endpoints against it.
 *
 * ── OWNER-SCOPING IS THE SECURITY MODEL ────────────────────────────────────
 * requireRole() only answers "is this person a PESO administrator?". It does NOT
 * answer "is this THEIR vacancy?". Every query in this file therefore also
 * filters `peso_admin_id = req.userId`. Without that, any administrator could
 * read another office's applicants — including their resumes, which contain a
 * citizen's full employment history and contact details.
 *
 * ── APPLICANT LIST PERFORMANCE ─────────────────────────────────────────────
 * The ATS list selects COALESCE(avatar_thumb, avatar_url), never the full-size
 * column. Avatars are base64 data URIs averaging ~319KB; on a 7-applicant
 * vacancy the full-size version cost ~2.2MB for one page of faces. The thumb is
 * ~15KB, and the COALESCE means rows predating thumbnails still show a picture.
 *
 * ── RESUME RETRIEVAL ───────────────────────────────────────────────────────
 * Resumes are streamed from application_resumes (the immutable per-application
 * snapshot), owner-scoped. The client fetches with the Authorization header and
 * opens the result as a blob URL, because a plain window.open() cannot attach a
 * bearer token. That is why the download path looks more involved than a link.
 *
 * ── THE VACANCY REOPEN RULE ────────────────────────────────────────────────
 * On PUT, if a posting is 'Filled' but its new positions_available exceeds the
 * number of approved referrals, it automatically reopens to 'Open'. Raising the
 * vacancy count IS the reopen gesture -- an administrator who adds a position
 * should not also have to remember to flip the status back.
 */

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { requireRole, requirePermission, ROLE_KEYS } = require('../middleware/rbac');
const systemSettings = require('../services/systemSettingsService');
const walkInService = require('../services/walkInService');
const { appUrl } = require('../utils/appUrl');
const { notifyUser, notifyAllJobSeekers } = require('../services/notificationService');
const adminAudit = require('../services/adminAuditService');
const { sendCsv } = require('../utils/csv');
const { getPageParams } = require('../utils/pagination');
const applicantProfileService = require('../services/applicantProfileService');
const applicationScoringService = require('../services/applicationScoringService');
const certificatesRepository = require('../repositories/certificatesRepository');
const jobAlertsService = require('../services/jobAlertsService');
const proactiveReferralService = require('../services/proactiveReferralService');
const { classifyDuplicates, messageFor } = require('../services/duplicatePostingService');

const router = express.Router();

// A pragmatic email shape check — the authoritative recipient must at least be a
// well-formed address. Mirrors the client-side rule so the two agree.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate the employer email for a vacancy. Returns an error string, or null when OK.
 * Enforcement = REQUIRED ON PUBLISHED: a live vacancy (Open/Published) can receive
 * referrals, so it must carry a valid recipient; a Draft may omit it (but a value,
 * if given, must still be well-formed).
 */
function validateCompanyEmail(companyEmail, status) {
	const email = (companyEmail || '').trim();
	const isLive = ['Open', 'Published'].includes(status);
	if (!email) {
		return isLive
			? 'An employer email is required to publish a vacancy — it is where the referral notification is delivered.'
			: null;
	}
	if (!EMAIL_RE.test(email) || email.length > 255) {
		return 'Please enter a valid employer email address.';
	}
	return null;
}

/**
 * Data-less, io-wide nudge that the PUBLIC JOB BOARD's list changed (a vacancy was
 * published, edited, or had its status changed). The board silently refetches the
 * fresh list from the DB — this carries no payload, writes no row, and raises no
 * toast (mirrors 'scores_updated'). Best-effort: a socket hiccup must never fail the
 * job mutation that triggered it (invariant 0.1). The board's low-frequency
 * visibility poll backstops any missed emit and covers anonymous visitors.
 */
function emitJobBoardUpdate(io, reason) {
	try { if (io) io.emit('job_board_updated', { reason: reason || 'changed', at: Date.now() }); }
	catch (e) { console.error('[JobBoard] update emit failed (non-blocking):', e.message); }
}

/**
 * Fetches an admin's OWN currently-live postings and classifies how likely `draft`
 * duplicates one (R1). Owner-scoped, read-only, best-effort — a failure returns "no
 * duplicate" rather than blocking the create flow (invariant 0.1). Shared by the
 * pre-submit check and the create response.
 */
async function assessDuplicatePosting(adminId, draft) {
	try {
		if (!['Open', 'Published'].includes(draft.status)) return { level: null, matches: [], message: null };
		const [existing] = await db.query(
			`SELECT id, title, company, location, job_type, status
			 FROM pesoadmin_job_posts
			 WHERE peso_admin_id = ? AND status IN ('Open','Published')${draft.excludeId ? ' AND id <> ?' : ''}`,
			draft.excludeId ? [adminId, draft.excludeId] : [adminId]
		);
		const assessment = classifyDuplicates(draft, existing);
		return { ...assessment, message: messageFor(assessment, draft.title) };
	} catch (e) {
		console.error('[Jobs] duplicate assessment failed (non-blocking):', e.message);
		return { level: null, matches: [], message: null };
	}
}

/**
 * POST /peso-admin/jobs/duplicate-check
 * Pre-submit duplicate assessment for the Create/Edit modal, so the UI can show a
 * confirm dialog (Exact/High) or a warning (Possible) BEFORE publishing. Never
 * blocks — the administrator decides. Owner-scoped.
 */
router.post('/jobs/duplicate-check', async (req, res) => {
	const { title, company, location, job_type, status = 'Open', excludeId } = req.body || {};
	const assessment = await assessDuplicatePosting(req.userId, { title, company, location, job_type, status, excludeId });
	res.status(200).json({ status: 'success', data: assessment });
});

// Apply authentication middleware to all employer routes
router.use(requireAuth);
// Both the PESO Manager (peso_administrator) AND the limited PESO Staff
// (peso_staff, job-publication co-worker) can REACH this router — but staff is
// then restricted to the vacancy-management endpoints only (guard below).
router.use(requireRole(ROLE_KEYS.PESO_ADMINISTRATOR, ROLE_KEYS.PESO_STAFF));

// DENY-BY-DEFAULT for PESO Staff. Staff may use ONLY the Job Publication
// endpoints (`/jobs*`, excluding the Manager-only question authoring); every
// other endpoint on this router — ATS, referral decisions, analytics, the
// proactive queue, the office profile — stays Manager-only. Because it is
// deny-by-default, a NEW Manager-only endpoint added later is automatically
// closed to staff without any extra guarding. Managers pass straight through.
router.use((req, res, next) => {
    if (req.userRole !== ROLE_KEYS.PESO_STAFF) return next();
    const p = req.path || '';
    const isJobPublication = /^\/jobs(\/|$)/.test(p) && !/\/questions(\/|$)/.test(p);
    if (isJobPublication) return next();
    return res.status(403).json({
        status: 'error',
        message: 'PESO Staff accounts are limited to the Job Publication Manager.'
    });
});

// EFFECTIVE OWNER for vacancy operations (D2 — attribute staff jobs to the Manager).
// A Manager owns their own vacancies (unchanged). A Job-Publication Staff member
// operates on the PESO Manager's vacancy set, so staff-published jobs land in the
// Manager's owner-scoped ATS / referral pipeline with NO ownership break. Computed
// once per request; the AUDIT actor stays req.userId (who actually did it).
// NOTE (single-office assumption): staff are attributed to the office's PESO
// Administrator — the first peso_administrator (the office Manager). A multi-Manager
// office would add a per-staff manager link; documented in
// docs/office-interview-requirements-analysis.md (§9, D2).
router.use(async (req, res, next) => {
    if (req.userRole !== ROLE_KEYS.PESO_STAFF) { req.effectiveOwnerId = req.userId; return next(); }
    try {
        // Stored role value for a PESO Administrator is 'employer' (migration 003);
        // accept the canonical spelling too for forward safety.
        const [rows] = await db.query(
            "SELECT id FROM users WHERE role IN ('employer', 'peso_administrator') ORDER BY id ASC LIMIT 1"
        );
        req.effectiveOwnerId = rows.length ? rows[0].id : req.userId;
    } catch (e) {
        req.effectiveOwnerId = req.userId; // never orphan the operation
    }
    next();
});

// GET /api/peso-admin/usage — the office's live usage across quota'd resources
// (vacancies, referrals, events, applicant records — all informational; message
// pins + upload ceilings are enforced). Owner-scoped to req.effectiveOwnerId so
// PESO Staff (attributed to the Manager) see the office totals. Read-only.
// Manager-only by construction: PESO Staff are denied every non-/jobs path above.
const usageService = require('../services/usageService');
router.get('/usage', async (req, res) => {
    try {
        const resources = await usageService.computeAdminUsage(req.effectiveOwnerId, req.userId);
        res.json({ status: 'success', scope: 'admin', resources });
    } catch (e) {
        console.error('[usage] admin usage failed:', e);
        res.status(500).json({ status: 'error', message: 'Could not load usage.' });
    }
});

// --- Featured image upload (PESO Admin job postings) ----------------------
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const storageService = require('../services/storageService');

// Featured images flow through the centralized, environment-aware storageService
// (local uploads/ in dev, Cloudflare R2 in production) instead of the ephemeral local
// disk. multer holds the file in MEMORY; the route hands the buffer to
// storageService.save(). Validation (size + MIME allow-list) stays here.
const jobImageUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 8 * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		const allowed = ['image/jpeg', 'image/png', 'image/webp'];
		if (!allowed.includes(file.mimetype)) {
			return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
		}
		cb(null, true);
	}
});

// =======================================================
// MODULE 0: EMPLOYER PROFILE MANAGEMENT
// =======================================================

// GET: Fetch the PESO Organization Profile for the signed-in administrator.
// SELECT ep.* still returns the dormant legacy employer columns; the frontend
// simply ignores them (see migration 026). account_email comes from the users
// row so the office's login address is always shown even before a profile row
// exists.
router.get('/profile', async (req, res) => {
    try {
        const [profile] = await db.query(
            `SELECT ep.*, u.email as account_email
             FROM pesoadmin_profiles ep
             RIGHT JOIN users u ON ep.user_id = u.id
             WHERE u.id = ?`,
            [req.userId]
        );

        // Return empty profile structure if one doesn't exist yet
        res.status(200).json({
            status: 'success',
            data: profile[0] && profile[0].id ? profile[0] : { user_id: req.userId }
        });
    } catch (error) {
        console.error("Fetch PESO Organization Profile Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve profile.' });
    }
});

// PUT: Upsert the PESO Organization Profile.
//
// This handles ONLY the PESO office identity — office information, address,
// contact + social, mission/vision, and the single Authorized Officer
// (signatory). The legacy employer-specific columns (nature_of_business,
// industry, years_in_operation, company_size, recruitment_*) are intentionally
// NOT bound here: on UPDATE they are left untouched (dormant, not cleared), and
// on INSERT they fall to their column default. Employer profile management is
// deferred to a future dedicated Employer role and stays out of this workflow
// (migration 026).
router.put('/profile', async (req, res) => {
    try {
        const {
            company_name, business_description, website, office_hours,
            office_address, city, province, postal_code,
            office_phone, office_email, facebook_url,
            representative_name, representative_position, representative_email, representative_phone,
            mission, vision,
        } = req.body;

        const [existing] = await db.query('SELECT id FROM pesoadmin_profiles WHERE user_id = ?', [req.userId]);

        if (existing.length > 0) {
            await db.query(`
                UPDATE pesoadmin_profiles SET
                    company_name=?, business_description=?, website=?, office_hours=?,
                    office_address=?, city=?, province=?, postal_code=?,
                    office_phone=?, office_email=?, facebook_url=?,
                    representative_name=?, representative_position=?, representative_email=?, representative_phone=?,
                    mission=?, vision=?
                WHERE user_id=?
            `, [
                company_name, business_description, website, office_hours,
                office_address, city, province, postal_code,
                office_phone, office_email, facebook_url,
                representative_name, representative_position, representative_email, representative_phone,
                mission, vision,
                req.userId
            ]);
        } else {
            await db.query(`
                INSERT INTO pesoadmin_profiles(
                    user_id, company_name, business_description, website, office_hours,
                    office_address, city, province, postal_code,
                    office_phone, office_email, facebook_url,
                    representative_name, representative_position, representative_email, representative_phone,
                    mission, vision
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                req.userId, company_name, business_description, website, office_hours,
                office_address, city, province, postal_code,
                office_phone, office_email, facebook_url,
                representative_name, representative_position, representative_email, representative_phone,
                mission, vision
            ]);
        }

        res.status(200).json({ status: 'success', message: 'Organization profile updated successfully.' });
    } catch (error) {
        console.error("Update PESO Organization Profile Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to update profile.' });
    }
});

// =======================================================
// MODULE 1: EMPLOYER DASHBOARD (JOB CRUD OPERATIONS)
// =======================================================

// GET: Fetch all jobs posted by the authenticated employer
router.get('/jobs', async (req, res) => {
    try {
        // referred_count lets the dashboard show vacancy usage (e.g. "2/3 referred").
        const [jobs] = await db.query(
            `SELECT pj.*,
                    (SELECT COUNT(*)
                     FROM referral_queue rq
                     JOIN job_applications ja ON rq.application_id = ja.id
                     WHERE ja.job_id = pj.id AND rq.status = 'Approved') AS referred_count
             FROM pesoadmin_job_posts pj
             WHERE pj.peso_admin_id = ? ORDER BY pj.created_at DESC`,
            [req.effectiveOwnerId]
        );
        res.status(200).json({ status: 'success', data: jobs });
    } catch (error) {
        console.error("Fetch Jobs Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve jobs.' });
    }
});

// POST: Create a new job posting
router.post('/jobs', async (req, res) => {
	try {
		try { await db.query(`ALTER TABLE pesoadmin_job_posts ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL DEFAULT NULL`); } catch (e) {}
		try { await db.query(`ALTER TABLE pesoadmin_job_posts ADD COLUMN IF NOT EXISTS company_email VARCHAR(255) NULL`); } catch (e) {}
		const { title, company, company_email, department, category, location, job_type, work_setup, status, positions_available, salary_range, deadline, education, experience, skills, qualifications, gender, description, accessibility_accommodations } = req.body;

		// Employer email — the authoritative recipient for the referral notification
		// (migration 051). Validated if present; REQUIRED before a vacancy goes live
		// (Open/Published), optional for a Draft. A Draft can't receive referrals.
		const emailErr = validateCompanyEmail(company_email, status);
		if (emailErr) return res.status(400).json({ status: 'error', message: emailErr });
		const companyEmail = (company_email || '').trim() || null;

		// R1 — similarity-based duplicate assessment (Exact / High / Possible), checked
		// BEFORE the insert so the new row can't match itself. Never blocks: reposting a
		// role after the first was Filled is legitimate, and the frontend already ran this
		// via /jobs/duplicate-check and got the administrator's confirmation. Returned in
		// the response as a backstop for any client that skipped the pre-check.
		const duplicateAssessment = await assessDuplicatePosting(req.effectiveOwnerId, { title, company, location, job_type, status });

		const [result] = await db.query(
			`INSERT INTO pesoadmin_job_posts (peso_admin_id, title, company, company_email, department, category, location, job_type, work_setup, status, positions_available, salary_range, deadline, education, experience, skills, qualifications, gender, description, accessibility_accommodations)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[req.effectiveOwnerId, title, company, companyEmail, department, category || null, location, job_type, work_setup, status, positions_available, salary_range, deadline || null, education, experience, skills || null, qualifications || null, gender || null, description, accessibility_accommodations]
		);

		// Announce live vacancies to every job seeker's bell. Fire-and-forget:
		// the service swallows its own failures, the posting already succeeded.
		if (['Open', 'Published'].includes(status)) {
			await notifyAllJobSeekers(req.app.get('io'), {
				type: 'NEW_JOB',
				title: 'New job posted',
				body: `${title}${company ? ` at ${company}` : ''} is now open for applications on the Public Job Board.`,
				link: '/job-board'
			});
			jobAlertsService.enqueueForJob(result.insertId);
			// Proactive AI Referral (Phase 1): score existing applicants against this
			// new vacancy for the Smart Referral Queue. Fire-and-forget (0.1).
			proactiveReferralService.enqueueForJob(result.insertId);
			// Live-refresh the Public Job Board for anyone currently browsing it.
			emitJobBoardUpdate(req.app.get('io'), 'created');
		}

		// Audit trail. Never throws (see adminAuditService) — the posting stands
		// even if the log write fails.
		adminAudit.record({
			adminId: req.userId,
			action: adminAudit.AUDIT_ACTIONS.JOB_CREATED,
			targetEntity: 'pesoadmin_job_posts',
			targetId: result.insertId,
			details: `Created vacancy "${title}" (${status}, ${positions_available || 1} position(s)).`
		});

		res.status(201).json({
			status: 'success', message: 'Job created successfully.', job_id: result.insertId,
			// Structured assessment (level + matches + message); `duplicateWarning` kept
			// for backward compatibility with any client reading the string form.
			duplicateAssessment,
			duplicateWarning: duplicateAssessment.message,
		});
	} catch (error) {
		console.error("Create Job Error:", error);
		res.status(500).json({ status: 'error', message: 'Failed to create job.' });
	}
});

// PUT: Update an existing job posting
router.put('/jobs/:id', async (req, res) => {
    try {
        const [check] = await db.query(
            'SELECT id, status, title, company, description, skills, qualifications, education, experience, gender FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?',
            [req.params.id, req.effectiveOwnerId]
        );
        if (check.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized to edit this job.' });
        const prev = check[0]; // pre-update snapshot for worker-trigger change detection (below)

        try { await db.query(`ALTER TABLE pesoadmin_job_posts ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL DEFAULT NULL`); } catch (e) {}
        try { await db.query(`ALTER TABLE pesoadmin_job_posts ADD COLUMN IF NOT EXISTS company_email VARCHAR(255) NULL`); } catch (e) {}
        const { title, company, company_email, department, category, location, job_type, work_setup, status, positions_available, salary_range, deadline, education, experience, skills, qualifications, gender, description, accessibility_accommodations } = req.body;

        // Employer email — authoritative referral recipient (migration 051). Validated
        // if present; required before a vacancy is live (Open/Published), optional for Draft.
        const emailErr = validateCompanyEmail(company_email, status);
        if (emailErr) return res.status(400).json({ status: 'error', message: emailErr });
        const companyEmail = (company_email || '').trim() || null;

        // REOPEN RULE: a posting auto-flips to 'Filled' when its last position is
        // referred. If the admin raises the vacancy count back above the number of
        // approved referrals (and did not explicitly pick another status), the
        // posting reopens automatically -- matching "increase the count to refer
        // more" without requiring a second edit.
        let finalStatus = status;
        try {
            if (status === 'Filled') {
                const capacity = Math.max(1, Number(positions_available) || 1);
                const [[{ approvedCount }]] = await db.query(
                    `SELECT COUNT(*) AS approvedCount
                     FROM referral_queue rq
                     JOIN job_applications ja ON rq.application_id = ja.id
                     WHERE ja.job_id = ? AND rq.status = 'Approved'`,
                    [req.params.id]
                );
                if ((approvedCount || 0) < capacity) finalStatus = 'Open';
            }
        } catch (reopenError) {
            console.error(`[PesoAdmin] Reopen check skipped: ${reopenError.message}`);
        }

        await db.query(
            `UPDATE pesoadmin_job_posts SET title=?, company=?, company_email=?, department=?, category=?, location=?, job_type=?, work_setup=?, status=?, positions_available=?, salary_range=?, deadline=?, education=?, experience=?, skills=?, qualifications=?, gender=?, description=?, accessibility_accommodations=? WHERE id=?`,
            [title, company, companyEmail, department, category || null, location, job_type, work_setup, finalStatus, positions_available, salary_range, deadline || null, education, experience, skills || null, qualifications || null, gender || null, description, accessibility_accommodations, req.params.id]
        );
        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.JOB_UPDATED,
            targetEntity: 'pesoadmin_job_posts',
            targetId: req.params.id,
            // Records the AUTO-REOPEN too, so a status the admin did not type is
            // still explainable after the fact.
            details: `Updated vacancy "${title}" (status: ${finalStatus}${finalStatus !== status ? ` — auto-reopened from ${status}` : ''}, ${positions_available || 1} position(s)).`
        });

        // ── Worker-trigger change detection (event-level precision) ─────────────
        // Arm the AI scoring / proactive-match / job-alert pipelines ONLY when a field
        // that actually PARTICIPATES in scoring/matching changed — exactly the inputs
        // buildScoringPrompt() reads (title, company, description, skills, qualifications,
        // education, experience, gender). A media-only edit (featured_image is a SEPARATE
        // endpoint, POST /jobs/:id/image — never in this UPDATE) or a non-scoring metadata
        // edit (location / salary / deadline / positions / setup / category / department /
        // accommodations) leaves these identical, so NO worker is armed. This is the
        // enqueue-time twin of the §29 input-hash guard ("don't recompute an unchanged
        // score"), which the frontend's always-full-form PUT made necessary: saving a job
        // after only swapping its image re-sends every field, and previously that re-armed
        // every pipeline. Same handler serves PESO Admin AND PESO Staff (via
        // effectiveOwnerId), so the rule is identical for both roles.
        const norm = (v) => String(v ?? '').trim();
        const scoringFields = { title, company, description, skills, qualifications, education, experience, gender };
        const scoringChanged = Object.entries(scoringFields).some(([k, v]) => norm(prev[k]) !== norm(v));
        // A FRESH publish (Draft/Closed/Filled → Open/Published) is itself a meaningful
        // event — the vacancy becomes newly visible + refer-able — so alert + proactively
        // match it once even if no requirement text changed.
        const nowPublished = ['Open', 'Published'].includes(finalStatus);
        const becamePublished = nowPublished && !['Open', 'Published'].includes(prev.status);

        // Enhancement D (job alerts) + Proactive (Phase 1): re-match only when the vacancy
        // is published AND its requirements changed OR it was just published. Dedup
        // (job_alerts_sent / proactive_referral_candidates UNIQUE) still guards; we simply
        // no longer enqueue on a no-op / media-only re-save. Fire-and-forget (0.1).
        if (nowPublished && (scoringChanged || becamePublished)) {
            jobAlertsService.enqueueForJob(req.params.id);
            proactiveReferralService.enqueueForJob(req.params.id);
        }

        // Enhancement B: re-evaluate ACTIVE applicants ONLY when a scoring-relevant field
        // changed — a media/metadata-only edit cannot change any compatibility score, so it
        // must not arm the scoring worker. Debounced + active-only downstream; fire-and-forget
        // (a scheduling hiccup must never fail the job update, 0.1).
        if (scoringChanged) {
            applicationScoringService.enqueueForJob(req.params.id);
        }

        // Edit / close / reopen / fill-count change all alter what the board shows —
        // nudge browsers to refetch the live list (title, status, positions remaining).
        emitJobBoardUpdate(req.app.get('io'), 'updated');

        res.status(200).json({
            status: 'success',
            message: finalStatus !== status
                ? 'Job updated and reopened — the vacancy count now exceeds the referrals issued.'
                : 'Job updated successfully.'
        });
    } catch (error) {
        console.error("Update Job Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to update job.' });
    }
});

// DELETE: Delete a job posting
router.delete('/jobs/:id', async (req, res) => {
    try {
        // Select the title BEFORE deleting — after the row is gone the audit entry
        // could only name an id, which is unreadable in the trail.
        const [check] = await db.query('SELECT id, title FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?', [req.params.id, req.effectiveOwnerId]);
        if (check.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized to delete this job.' });

        await db.query('DELETE FROM pesoadmin_job_posts WHERE id = ?', [req.params.id]);

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.JOB_DELETED,
            targetEntity: 'pesoadmin_job_posts',
            targetId: req.params.id,
            details: `Deleted vacancy "${check[0].title}".`
        });

        res.status(200).json({ status: 'success', message: 'Job deleted successfully.' });
    } catch (error) {
        console.error("Delete Job Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to delete job.' });
    }
});

// POST: Set / replace a job posting's featured image (owner-scoped)
router.post('/jobs/:id/image', (req, res, next) => {
	jobImageUpload.single('image')(req, res, (err) => {
		if (err) return res.status(400).json({ status: 'error', message: err.message });
		next();
	});
}, async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ status: 'error', message: 'No image file was provided.' });
		}

		const [rows] = await db.query(
			'SELECT featured_image FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?',
			[req.params.id, req.effectiveOwnerId]
		);
		if (rows.length === 0) {
			return res.status(403).json({ status: 'error', message: 'You are not authorized to edit this posting.' });
		}

		const ext = (path.extname(req.file.originalname || '').toLowerCase()) || '.jpg';
		const key = `job-featured/job-${req.params.id}-${Date.now()}${ext}`;
		const publicPath = await storageService.save(key, req.file.buffer, req.file.mimetype);
		await db.query('UPDATE pesoadmin_job_posts SET featured_image = ? WHERE id = ?', [publicPath, req.params.id]);

		// Best-effort cleanup of the previously stored image (local or R2).
		await storageService.remove(rows[0].featured_image);

		res.status(200).json({ status: 'success', message: 'Featured image updated.', featured_image: publicPath });
	} catch (error) {
		console.error('Job Image Upload Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to update the featured image.' });
	}
});

// DELETE: Remove a job posting's featured image (owner-scoped)
router.delete('/jobs/:id/image', async (req, res) => {
	try {
		const [rows] = await db.query(
			'SELECT featured_image FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?',
			[req.params.id, req.effectiveOwnerId]
		);
		if (rows.length === 0) {
			return res.status(403).json({ status: 'error', message: 'You are not authorized to edit this posting.' });
		}

		const previous = rows[0].featured_image;
		await db.query('UPDATE pesoadmin_job_posts SET featured_image = NULL WHERE id = ?', [req.params.id]);

		await storageService.remove(previous);

		res.status(200).json({ status: 'success', message: 'Featured image removed.' });
	} catch (error) {
		console.error('Job Image Remove Error:', error);
		res.status(500).json({ status: 'error', message: 'Failed to remove the featured image.' });
	}
});

// =======================================================
// MODULE 1b: JOB-SPECIFIC ADDITIONAL QUESTIONS
// =======================================================

// Ensures the questions table exists (idempotent). Mirrors migration 013.
const ensureQuestionsTable = async () => {
	if (db.isPostgres) return; // schema owned by postgres/schema.sql
	try {
		await db.query(`CREATE TABLE IF NOT EXISTS job_application_questions (
			id INT AUTO_INCREMENT PRIMARY KEY,
			job_id INT NOT NULL,
			question_text VARCHAR(500) NOT NULL,
			question_type ENUM('text','textarea','select','boolean') NOT NULL DEFAULT 'text',
			options TEXT NULL,
			is_required BOOLEAN NOT NULL DEFAULT TRUE,
			sort_order INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`);
	} catch (e) {}
};

// GET: list a job's additional questions (owner-scoped)
router.get('/jobs/:id/questions', async (req, res) => {
	try {
		await ensureQuestionsTable();
		const [check] = await db.query('SELECT id FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?', [req.params.id, req.userId]);
		if (check.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized to view this job.' });

		const [questions] = await db.query(
			`SELECT id, question_text, question_type, options, is_required, sort_order
			 FROM job_application_questions WHERE job_id = ? ORDER BY sort_order ASC, id ASC`,
			[req.params.id]
		);
		const shaped = questions.map(q => ({
			...q,
			is_required: !!q.is_required,
			options: (() => { try { return q.options ? JSON.parse(q.options) : []; } catch { return []; } })()
		}));
		res.status(200).json({ status: 'success', data: shaped });
	} catch (error) {
		console.error("Fetch Questions Error:", error);
		res.status(500).json({ status: 'error', message: 'Failed to fetch questions.' });
	}
});

// PUT: replace the full set of a job's additional questions (owner-scoped)
router.put('/jobs/:id/questions', async (req, res) => {
	try {
		await ensureQuestionsTable();
		const [check] = await db.query('SELECT id FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?', [req.params.id, req.userId]);
		if (check.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized to edit this job.' });

		const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];

		// Replace-all inside a transaction: wipe existing then re-insert in order.
		// Without the transaction a mid-loop insert failure would leave the job
		// with zero questions (the DELETE having already committed).
		const connection = await db.getConnection();
		try {
			await connection.beginTransaction();
			await connection.query('DELETE FROM job_application_questions WHERE job_id = ?', [req.params.id]);

			let order = 0;
			for (const q of questions) {
				const text = (q.question_text || '').toString().trim();
				if (!text) continue;
				const type = ['text', 'textarea', 'select', 'boolean'].includes(q.question_type) ? q.question_type : 'text';
				const options = Array.isArray(q.options) ? JSON.stringify(q.options.filter(o => (o ?? '').toString().trim())) : null;
				const isRequired = q.is_required === false ? 0 : 1;
				await connection.query(
					`INSERT INTO job_application_questions (job_id, question_text, question_type, options, is_required, sort_order)
					 VALUES (?, ?, ?, ?, ?, ?)`,
					[req.params.id, text.slice(0, 500), type, type === 'select' ? options : null, isRequired, order++]
				);
			}

			await connection.commit();
		} catch (txError) {
			await connection.rollback();
			throw txError;
		} finally {
			connection.release();
		}

		res.status(200).json({ status: 'success', message: 'Questions updated.' });
	} catch (error) {
		console.error("Update Questions Error:", error);
		res.status(500).json({ status: 'error', message: 'Failed to update questions.' });
	}
});

// =======================================================
// MODULE 2: ATS PIPELINE LOGIC (APPLICATION TRACKING)
// =======================================================

// Referral state carried on every applicant row so the ATS renders the correct
// button on load in EVERY view — the regression this fixes: the cross-job "All
// Applicants" view had no per-vacancy referral map, so an already-referred
// applicant still showed a live "Refer" button (the server's UNIQUE index still
// blocked the duplicate on click, but the initial UI lied about the state).
//
// Correlated subqueries (not JOINs) so an applicant row is never duplicated when
// more than one referral_queue row exists for it (e.g. a Voided one and a newer
// one); ORDER BY rq.id DESC takes the LATEST, matching "current referral state".
// Mirrors the status + reference_number pairing of referralRepository.listByJob.
// References `ja` (job_applications), so both consumers must alias it as `ja`.
const REFERRAL_STATE_COLUMNS = `
    (SELECT rq.status FROM referral_queue rq
       WHERE rq.application_id = ja.id ORDER BY rq.id DESC LIMIT 1) AS referral_status,
    (SELECT rl.reference_number FROM referral_letters rl
       JOIN referral_queue rq2 ON rl.queue_id = rq2.id
       WHERE rq2.application_id = ja.id ORDER BY rq2.id DESC LIMIT 1) AS referral_reference`;

// GET: Fetch Jobs specifically optimized for the ATS Pipeline Dropdown
// ── Walk-In Job Seeker registration (#7) ────────────────────────────────────
// Manager capability (walkin:manage); PESO Staff are already blocked from any
// non-/jobs endpoint by the deny-by-default guard. Ships behind the runtime flag.
async function walkInEnabled() {
	const raw = await systemSettings.get('walk_in_registration_enabled');
	return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

router.post('/walk-in/duplicate-check', requirePermission('walkin:manage'), async (req, res) => {
	try {
		if (!(await walkInEnabled())) return res.status(403).json({ status: 'error', message: 'Walk-in registration is not currently available.' });
		const { name, email, phone } = req.body || {};
		const duplicates = await walkInService.findPotentialDuplicates({ name, email, phone });
		res.status(200).json({ status: 'success', data: duplicates });
	} catch (error) {
		console.error('[WalkIn] duplicate-check failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Could not check for existing accounts.' });
	}
});

// The seeker-facing claim page URL — where a walk-in enters their code. Uses the shared
// env-driven appUrl helper (FRONTEND_URL → CORS_ORIGINS[0] → localhost), so it is ALWAYS
// an absolute, tappable link in both local dev and production — never a bare relative
// path (which made the walk-in SMS "link" unusable when FRONTEND_URL was unset locally).
function claimBaseUrl() {
	return appUrl('/claim');
}

router.post('/walk-in', requirePermission('walkin:manage'), async (req, res) => {
	try {
		if (!(await walkInEnabled())) return res.status(403).json({ status: 'error', message: 'Walk-in registration is not currently available.' });
		const result = await walkInService.createWalkInSeeker({ ...req.body, staffId: req.userId });
		if (result.duplicates) {
			// Not an error — staff must choose "attach to existing" or resubmit with force.
			return res.status(200).json({ status: 'duplicates', message: 'Possible existing accounts found. Review, or resubmit to create anyway.', data: result.duplicates });
		}

		// Optionally text the claim link to the seeker (best-effort, in-person code
		// stays the primary channel). Reported back so the UI can confirm it.
		let smsSent = false;
		if (req.body?.sendSms && result.phone) {
			const r = await walkInService.textClaimLink({ userId: result.userId, name: req.body?.name, phone: result.phone, claimCode: result.claimCode, claimUrl: claimBaseUrl() });
			smsSent = !!r?.queued;
		}

		res.status(201).json({ status: 'success', message: 'Walk-in applicant registered.', data: { ...result, smsSent, claimUrl: claimBaseUrl() } });
	} catch (error) {
		const status = error.status || 500;
		if (status === 500) console.error('[WalkIn] create failed:', error.message);
		res.status(status).json({ status: 'error', message: status === 500 ? 'Could not register the walk-in applicant.' : error.message });
	}
});

// Unclaimed walk-ins, for the Manager's reissue list (no raw codes exposed).
router.get('/walk-in/unclaimed', requirePermission('walkin:manage'), async (req, res) => {
	try {
		if (!(await walkInEnabled())) return res.status(403).json({ status: 'error', message: 'Walk-in registration is not currently available.' });
		res.status(200).json({ status: 'success', data: await walkInService.listUnclaimed() });
	} catch (error) {
		console.error('[WalkIn] list unclaimed failed:', error.message);
		res.status(500).json({ status: 'error', message: 'Could not load unclaimed walk-in applicants.' });
	}
});

// Reissue a fresh claim code for an unclaimed walk-in (recover a lost/expired code).
router.post('/walk-in/:id/reissue', requirePermission('walkin:manage'), async (req, res) => {
	try {
		if (!(await walkInEnabled())) return res.status(403).json({ status: 'error', message: 'Walk-in registration is not currently available.' });
		const userId = parseInt(req.params.id, 10);
		if (!Number.isInteger(userId)) return res.status(400).json({ status: 'error', message: 'Invalid applicant id.' });

		const result = await walkInService.reissueClaim({ userId, staffId: req.userId });

		let smsSent = false;
		if (req.body?.sendSms && result.phone) {
			const r = await walkInService.textClaimLink({ userId: result.userId, name: req.body?.name, phone: result.phone, claimCode: result.claimCode, claimUrl: claimBaseUrl() });
			smsSent = !!r?.queued;
		}

		res.status(200).json({ status: 'success', message: 'A fresh claim code has been issued.', data: { ...result, smsSent, claimUrl: claimBaseUrl() } });
	} catch (error) {
		const status = error.status || 500;
		if (status === 500) console.error('[WalkIn] reissue failed:', error.message);
		res.status(status).json({ status: 'error', message: status === 500 ? 'Could not reissue the claim code.' : error.message });
	}
});

router.get('/ats/jobs', async (req, res) => {
    try {
        const query = `
            SELECT pj.id, pj.title, pj.location, pj.status, 
                   COUNT(ja.id) as applicants_count
            FROM pesoadmin_job_posts pj
            LEFT JOIN job_applications ja ON pj.id = ja.job_id
            WHERE pj.peso_admin_id = ?
            GROUP BY pj.id
            ORDER BY pj.created_at DESC
        `;
        const [jobs] = await db.query(query, [req.userId]);
        res.status(200).json({ status: 'success', data: jobs });
    } catch (error) {
        console.error("Fetch ATS Jobs Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve ATS jobs.' });
    }
});

// GET: Fetch Live Applicants for a specific job in the ATS Pipeline
router.get('/ats/jobs/:jobId/applicants', async (req, res) => {
    try {
        const [jobCheck] = await db.query('SELECT id FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?', [req.params.jobId, req.userId]);
        if (jobCheck.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });

        // Uses COALESCE to guarantee 'name' and 'email' exist, preventing frontend crashes
        const query = `
            SELECT ja.id as application_id, ja.status, ja.match_score, ja.applied_at, ja.resume_url,
                   ja.current_match_score, ja.scored_at,
                   u.id as user_id,

                   -- Thumbnail, not the full-size avatar. Inlining avatar_url
                   -- cost ~2.2MB on a 7-applicant job (avg 319KB each); the
                   -- thumb is ~15KB. COALESCE falls back to the original for
                   -- rows uploaded before thumbnails existed, so no applicant
                   -- silently loses their photo during the transition.
                   COALESCE(u.avatar_thumb, u.avatar_url) AS avatar_url,

                   -- Identity ID-TYPE removed (2026-08-23) — no longer selected or
                   -- surfaced. Columns left dormant (§0.7).
                   COALESCE(u.name, 'Unknown Applicant') AS name,
                   COALESCE(u.email, 'No Email Provided') AS email,
                   EXISTS(SELECT 1 FROM application_resumes ar WHERE ar.application_id = ja.id) AS has_resume,
                   ${REFERRAL_STATE_COLUMNS}
            FROM job_applications ja
            JOIN users u ON ja.applicant_id = u.id
            WHERE ja.job_id = ?
            ORDER BY ${atsOrderBy(req.query.sort)}
        `;
        const [applicants] = await db.query(query, [req.params.jobId]);
        res.status(200).json({ status: 'success', data: applicants });
    } catch (error) {
        console.error("Fetch Applicants Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve applicants.' });
    }
});

// GET: Stream the resume PDF an applicant submitted with a specific application.
// Owner-scoped: the requesting PESO admin must own the job the application belongs to.
router.get('/ats/applications/:applicationId/resume', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ar.file_data, ar.file_key, ar.file_name, ar.mime_type
             FROM application_resumes ar
             JOIN job_applications ja ON ja.id = ar.application_id
             JOIN pesoadmin_job_posts pj ON pj.id = ja.job_id
             WHERE ar.application_id = ? AND pj.peso_admin_id = ?`,
            [req.params.applicationId, req.userId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No resume is on file for this application.' });
        }
        const row = rows[0];
        const safeName = (row.file_name || 'resume.pdf').replace(/["\r\n]/g, '');
        res.setHeader('Content-Type', row.mime_type || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        // Prefer the object-store copy (file_key); fall back to legacy base64 (file_data).
        if (row.file_key) {
            const obj = await storageService.getPrivate(row.file_key);
            if (obj.contentLength) res.setHeader('Content-Length', obj.contentLength);
            obj.stream.on('error', (streamErr) => {
                console.error('Resume stream error:', streamErr.message);
                if (!res.headersSent) res.status(500).end(); else res.destroy();
            });
            obj.stream.pipe(res);
        } else if (row.file_data) {
            res.send(Buffer.from(row.file_data, 'base64'));
        } else {
            res.status(404).json({ status: 'error', message: 'No resume is on file for this application.' });
        }
    } catch (error) {
        console.error("Fetch Application Resume Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve the resume.' });
    }
});

/**
 * GET /ats/applications/:applicationId/profile
 * Unified Applicant Profile (Enhancement A) — one owner-scoped view of the whole
 * applicant (submitted package + current profile + AI results) for the pipeline
 * drawer. Owner-scope + snapshot/live policy live in applicantProfileService.
 */
router.get('/ats/applications/:applicationId/profile', async (req, res) => {
    try {
        const profile = await applicantProfileService.getApplicantProfile(req.params.applicationId, req.userId);
        if (!profile) {
            return res.status(404).json({ status: 'error', message: 'Application not found, or it belongs to a job you did not publish.' });
        }
        res.status(200).json({ status: 'success', data: profile });
    } catch (error) {
        console.error("Applicant Profile Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to load the applicant profile.' });
    }
});

/**
 * GET /ats/applications/:applicationId/certificates/:certId
 * Streams one supporting certificate (Enhancement C), owner-scoped: only the admin
 * who owns the job the application targets can retrieve it. Same blob-fetch pattern
 * as the resume.
 */
router.get('/ats/applications/:applicationId/certificates/:certId', async (req, res) => {
    try {
        const cert = await certificatesRepository.findApplicationCertificateForStream(
            req.params.applicationId, req.params.certId, req.userId
        );
        if (!cert) {
            return res.status(404).json({ status: 'error', message: 'Certificate not found.' });
        }
        const buffer = Buffer.from(cert.content_base64, 'base64');
        const safeName = (cert.file_name || 'certificate').replace(/["\r\n]/g, '');
        res.setHeader('Content-Type', cert.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        res.send(buffer);
    } catch (error) {
        console.error("Fetch Certificate Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve the certificate.' });
    }
});

// The PESO office's real recruitment workflow (standardized 2026-08-04):
//   Applied → Under Review → Shortlisted → Referred.
// The administrator MANUALLY sets the first three in the ATS. 'Referred' is set by the
// SYSTEM when the official referral letter is issued (referralService.approveReferral)
// and reverted only by voiding — so it is intentionally NOT manually settable here (a
// 'Referred' with no letter would be a false record). 'Interview'/'Hired'/'Rejected'
// were deprecated. Shared by the single + bulk paths so they cannot drift.
const ATS_SETTABLE_STATUSES = ['Applied', 'Under Review', 'Shortlisted'];
// The full set an application can DISPLAY (settable + the system-set 'Referred').
const ATS_STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Referred'];

// Per-status, seeker-facing notification copy. One place so single + bulk never diverge
// and every transition gives the job seeker a clear, specific update.
function statusNotificationBody(status, jobTitle) {
    switch (status) {
        case 'Under Review':
            return `Your application for "${jobTitle}" is now under review — our team is evaluating it.`;
        case 'Shortlisted':
            return `Good news — you've been shortlisted for "${jobTitle}". Please monitor for further updates.`;
        case 'Applied':
            return `Your application for "${jobTitle}" has been received.`;
        default:
            return `Your application for "${jobTitle}" is now "${status}".`;
    }
}

// PUT: Update Application Status in the ATS Pipeline
router.put('/ats/applications/:applicationId/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!ATS_SETTABLE_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status. Applications become "Referred" by issuing a referral, not from this menu.' });
        }

        const authQuery = `
            SELECT ja.id, ja.applicant_id, pj.title AS job_title FROM job_applications ja
            JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
            WHERE ja.id = ? AND pj.peso_admin_id = ?
        `;
        const [authCheck] = await db.query(authQuery, [req.params.applicationId, req.userId]);

        if (authCheck.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized.' });

        await db.query('UPDATE job_applications SET status = ? WHERE id = ?', [status, req.params.applicationId]);

        // Tell the applicant their application moved. notifyUser never throws.
        await notifyUser(req.app.get('io'), {
            userId: authCheck[0].applicant_id,
            type: 'APPLICATION_STATUS',
            title: 'Application status updated',
            body: statusNotificationBody(status, authCheck[0].job_title),
            // The seeker's real PESO application pipeline — NOT /jobs, which is the
            // private external-job tracker and never contained this application.
            link: '/my-applications'
        });

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.APPLICATION_STATUS_CHANGED,
            targetEntity: 'job_applications',
            targetId: req.params.applicationId,
            details: `Moved applicant to "${status}" on vacancy "${authCheck[0].job_title}".`
        });

        res.status(200).json({ status: 'success', message: `Applicant moved to ${status}.` });
    } catch (error) {
        console.error("Update Status Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to update applicant status.' });
    }
});

/**
 * PUT /ats/applications/bulk/status
 * Moves several applications to one status in a single request.
 *
 * Ownership is enforced by INTERSECTION, not by trusting the payload: the UPDATE
 * itself joins to pesoadmin_job_posts and filters peso_admin_id, so ids belonging
 * to another office simply do not match and are reported as skipped. A caller
 * cannot touch another administrator's applicants by posting their ids.
 *
 * Notifications are best-effort per applicant AFTER the write, so one failed
 * notification never rolls back a status change that already happened.
 */
router.put('/ats/applications/bulk/status', async (req, res) => {
    try {
        const { applicationIds, status } = req.body;
        if (!ATS_SETTABLE_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status. Applications become "Referred" by issuing a referral, not from this menu.' });
        }
        const ids = (Array.isArray(applicationIds) ? applicationIds : [])
            .map(n => Number.parseInt(n, 10))
            .filter(Number.isInteger);
        if (ids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No applications selected.' });
        }

        // Resolve exactly which of the requested ids this administrator owns.
        const [owned] = await db.query(
            `SELECT ja.id, ja.applicant_id, pj.title AS job_title
             FROM job_applications ja
             JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
             WHERE pj.peso_admin_id = ? AND ja.id IN (?)`,
            [req.userId, ids]
        );

        if (owned.length === 0) {
            return res.status(403).json({ status: 'error', message: 'None of the selected applications belong to you.' });
        }

        const ownedIds = owned.map(r => r.id);
        await db.query('UPDATE job_applications SET status = ? WHERE id IN (?)', [status, ownedIds]);

        const io = req.app.get('io');
        for (const row of owned) {
            await notifyUser(io, {
                userId: row.applicant_id,
                type: 'APPLICATION_STATUS',
                title: 'Application status updated',
                body: statusNotificationBody(status, row.job_title),
                link: '/my-applications'
            });
        }

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.APPLICATION_STATUS_CHANGED,
            targetEntity: 'job_applications',
            targetId: null,
            details: `Bulk-moved ${ownedIds.length} application(s) to "${status}". Ids: ${ownedIds.join(', ')}.`
        });

        res.status(200).json({
            status: 'success',
            message: `${ownedIds.length} applicant${ownedIds.length === 1 ? '' : 's'} moved to ${status}.`,
            data: { updated: ownedIds.length, skipped: ids.length - ownedIds.length }
        });
    } catch (error) {
        console.error("Bulk Status Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to update applicant statuses.' });
    }
});

/**
 * PUT /jobs/bulk/status
 * Bulk close / archive / publish vacancies from the management grid.
 *
 * Only statuses an administrator may set DIRECTLY are accepted. 'Filled' is
 * excluded on purpose: it is set by the referral-approval transaction when the
 * last vacancy slot is consumed, and letting it be typed here would let the
 * board claim a posting is full when no referral issued it (§0.12/§0.14).
 */
const BULK_JOB_STATUSES = ['Open', 'Published', 'Draft', 'Closed'];

router.put('/jobs/bulk/status', async (req, res) => {
    try {
        const { jobIds, status } = req.body;
        if (!BULK_JOB_STATUSES.includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: `Invalid status. Allowed: ${BULK_JOB_STATUSES.join(', ')}. "Filled" is set automatically when the last position is referred.`
            });
        }
        const ids = (Array.isArray(jobIds) ? jobIds : [])
            .map(n => Number.parseInt(n, 10))
            .filter(Number.isInteger);
        if (ids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No vacancies selected.' });
        }

        const [result] = await db.query(
            'UPDATE pesoadmin_job_posts SET status = ? WHERE peso_admin_id = ? AND id IN (?)',
            [status, req.effectiveOwnerId, ids]
        );

        if (result.affectedRows === 0) {
            return res.status(403).json({ status: 'error', message: 'None of the selected vacancies belong to you.' });
        }

        adminAudit.record({
            adminId: req.userId,
            action: adminAudit.AUDIT_ACTIONS.JOB_STATUS_BULK_CHANGED,
            targetEntity: 'pesoadmin_job_posts',
            targetId: null,
            details: `Bulk-set ${result.affectedRows} vacancy(ies) to "${status}". Ids: ${ids.join(', ')}.`
        });

        // Several vacancies changed status at once — refresh the public board list.
        emitJobBoardUpdate(req.app.get('io'), 'bulk_status');

        res.status(200).json({
            status: 'success',
            message: `${result.affectedRows} vacanc${result.affectedRows === 1 ? 'y' : 'ies'} set to ${status}.`,
            data: { updated: result.affectedRows }
        });
    } catch (error) {
        console.error("Bulk Job Status Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to update vacancy statuses.' });
    }
});

/**
 * Builds the WHERE clause + params for a cross-vacancy applicant query.
 *
 * Always anchored on `pj.peso_admin_id = ?` so every caller is owner-scoped by
 * construction — the filters below can only ever NARROW that set, never widen it.
 */
function buildApplicantFilter(userId, { search, status, jobId, minScore }) {
    const where = ['pj.peso_admin_id = ?'];
    const params = [userId];

    if (status && ATS_STATUSES.includes(status)) {
        where.push('ja.status = ?');
        params.push(status);
    }
    const parsedJobId = Number.parseInt(jobId, 10);
    if (Number.isInteger(parsedJobId)) {
        where.push('ja.job_id = ?');
        params.push(parsedJobId);
    }
    if (search && String(search).trim()) {
        // Escape LIKE wildcards so a literal % typed in the search box does not
        // silently match everything.
        const term = `%${String(search).trim().replace(/[%_\\]/g, m => `\\${m}`)}%`;
        where.push('(u.name LIKE ? OR u.email LIKE ? OR pj.title LIKE ?)');
        params.push(term, term, term);
    }
    // Enhancement B: minimum AI match filter — ranks on the LIVE score, falling
    // back to the apply-time score. A floor excludes unscored applicants.
    const parsedMin = Number.parseInt(minScore, 10);
    if (Number.isInteger(parsedMin) && parsedMin > 0) {
        where.push('COALESCE(ja.current_match_score, ja.match_score) >= ?');
        params.push(parsedMin);
    }

    return { whereSql: where.join(' AND '), params };
}

// Enhancement B: whitelisted ATS sort → ORDER BY. Match sorts rank by the LIVE
// score (fallback apply-time) and push unscored applicants to the bottom. Unknown
// falls back to most-recent; caller input is never interpolated into SQL.
const ATS_SORT_SQL = {
    recent:     'ja.applied_at DESC',
    oldest:     'ja.applied_at ASC',
    match_desc: 'COALESCE(ja.current_match_score, ja.match_score) IS NULL ASC, COALESCE(ja.current_match_score, ja.match_score) DESC',
    match_asc:  'COALESCE(ja.current_match_score, ja.match_score) IS NULL ASC, COALESCE(ja.current_match_score, ja.match_score) ASC',
};
const atsOrderBy = (sort) => ATS_SORT_SQL[sort] || ATS_SORT_SQL.recent;

/**
 * GET /ats/applicants
 * Every applicant across ALL of this administrator's vacancies.
 *
 * WHY: the ATS was scoped to one vacancy at a time, so finding a citizen meant
 * first remembering which posting they applied to. This is the "search everyone"
 * view. Server-side paginated (Phase 1 fast-follow) + owner-scoped filters, so a
 * large office never pulls an unbounded result set. Returns { data, total, page,
 * limit }; the CSV export below deliberately stays UNpaginated (same filters).
 */
router.get('/ats/applicants', async (req, res) => {
    try {
        const { whereSql, params } = buildApplicantFilter(req.userId, req.query);
        const { limit, page, offset } = getPageParams(req.query, { defaultLimit: 10, maxLimit: 100 });

        const [applicants] = await db.query(
            `SELECT ja.id AS application_id, ja.status, ja.match_score, ja.applied_at,
                    ja.current_match_score, ja.scored_at,
                    ja.job_id,
                    u.id AS user_id,
                    COALESCE(u.avatar_thumb, u.avatar_url) AS avatar_url,
                    COALESCE(u.name, 'Unknown Applicant') AS name,
                    COALESCE(u.email, 'No Email Provided') AS email,
                    pj.title AS job_title,
                    EXISTS(SELECT 1 FROM application_resumes ar WHERE ar.application_id = ja.id) AS has_resume,
                    ${REFERRAL_STATE_COLUMNS}
             FROM job_applications ja
             JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
             JOIN users u ON ja.applicant_id = u.id
             WHERE ${whereSql}
             ORDER BY ${atsOrderBy(req.query.sort)}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total
             FROM job_applications ja
             JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
             JOIN users u ON ja.applicant_id = u.id
             WHERE ${whereSql}`,
            params
        );

        res.status(200).json({ status: 'success', data: applicants, total: Number(total), page, limit });
    } catch (error) {
        console.error("Fetch All Applicants Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve applicants.' });
    }
});

/**
 * GET /ats/applicants/export
 * The applicant list as CSV, honouring the same filters as the view above so the
 * file matches exactly what the administrator is looking at.
 */
router.get('/ats/applicants/export', async (req, res) => {
    try {
        const { whereSql, params } = buildApplicantFilter(req.userId, req.query);

        const [rows] = await db.query(
            `SELECT COALESCE(u.name, 'Unknown Applicant') AS name,
                    COALESCE(u.email, '') AS email,
                    pj.title AS job_title, pj.company AS company,
                    ja.status, ja.match_score, ja.applied_at
             FROM job_applications ja
             JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
             JOIN users u ON ja.applicant_id = u.id
             WHERE ${whereSql}
             ORDER BY ja.applied_at DESC`,
            params
        );

        const header = ['Applicant Name', 'Email', 'Position', 'Organization', 'Status', 'AI Match Score', 'Date Applied'];
        const body = rows.map(r => [
            r.name, r.email, r.job_title, r.company, r.status,
            r.match_score === null || r.match_score === undefined ? 'Not scored' : r.match_score,
            r.applied_at ? new Date(r.applied_at) : '',
        ]);

        const stamp = new Date().toISOString().slice(0, 10);
        return sendCsv(res, `peso-applicants-${stamp}.csv`, header, body);
    } catch (error) {
        console.error("Export Applicants Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to export applicants.' });
    }
});

// =======================================================
// MODULE: OPERATIONAL DASHBOARD ANALYTICS
// =======================================================
// Command-center metrics for the signed-in PESO administrator's own postings.
//
// Every panel is computed by an INDEPENDENT query wrapped in `safe()`, so a
// single failing aggregation degrades that one figure to a zero/empty default
// instead of 500-ing the whole dashboard an administrator opened to monitor the
// office (the safeQuery-degrades-a-panel convention, §5/§12).
//
// Owner-scoping (§0.8 / this file's header): job, application and referral
// figures all filter `peso_admin_id = req.userId`. The TWO registration counts
// (job seekers, employers) are platform-wide by nature and reuse the exact
// definitions the public landing page uses (jobBoardRoutes /stats), so the same
// number never reads differently on two screens.
//
// Placement truth (§0.14): "Successful Hires" counts referral_outcomes rows with
// outcome = 'Hired', NEVER approved referrals — an emailed letter is not a job.
// Shared operational-dashboard computation — used by BOTH GET /analytics/overview (JSON,
// for the dashboard) AND GET /analytics/export (CSV), so the exported figures can NEVER
// drift from what the dashboard displays (export PARITY by construction). Owner-scoped to
// `adminId`; the two registration counts (job seekers, employers) are platform-wide and
// reuse the landing page's definitions (jobBoardRoutes /stats). Placement truth (§0.14):
// "Successful Hires" counts referral_outcomes.outcome='Hired'.
async function computeOverview(adminId, windowMonths) {
    const safe = async (fn, fallback) => {
        try { return await fn(); } catch (e) {
            console.error('[PesoAdmin analytics]', e.message);
            return fallback;
        }
    };
    const scalar = async (sql, params, fallback = 0) => safe(async () => {
        const [rows] = await db.query(sql, params);
        return rows[0]?.c ?? fallback;
    }, fallback);
    const rowsOf = async (sql, params) => safe(async () => {
        const [rows] = await db.query(sql, params);
        return rows;
    }, []);

    // Zero-filled trend window (calendar months incl. the current one) so a quiet month
    // renders as a gap. Governs the TREND SERIES only; the summary cards stay current-state
    // totals — mixing period-scoped and current-state figures in one row is the kind of
    // inconsistency the dashboard audit removed.

    const months = [];
    const now = new Date();
    for (let i = windowMonths - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            label: d.toLocaleString('en-US', { month: 'short' }),
            applications: 0,
            hires: 0,
        });
    }
    const monthIndex = new Map(months.map(m => [m.key, m]));
    const rangeStart = `${months[0].key}-01`;
    const bucketFor = (raw) => {
        if (!raw) return null;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return null;
        return monthIndex.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) || null;
    };

    try {
        const [
            activeVacancies, totalJobSeekers, totalEmployers, applicationsReceived,
            referralLettersGenerated, successfulHires,
            vacancyStatus, applicationStatus,
            pendingReferrals, newApplications, failedReferrals,
            appDates, hireDates, recentActivity,
        ] = await Promise.all([
            // ── Summary cards ────────────────────────────────────────────────
            scalar(
                `SELECT COUNT(*) AS c FROM pesoadmin_job_posts
                 WHERE peso_admin_id = ? AND status IN ('Open','Published')`, [adminId]),
            scalar(
                `SELECT COUNT(*) AS c FROM users
                 WHERE role = 'applicant' AND (account_status = 'Active' OR account_status IS NULL)`, []),
            // "Employers" = distinct organisations with LIVE postings — the exact
            // definition the public landing page uses for "Active Local Employers"
            // (jobBoardRoutes /stats), so the two screens never disagree. (Counting
            // employer *accounts* would both diverge from the landing and be
            // near-meaningless while the Employer role is unimplemented.)
            scalar(
                `SELECT COUNT(DISTINCT company) AS c FROM pesoadmin_job_posts
                 WHERE status IN ('Open','Published') AND company IS NOT NULL AND company <> ''`, []),
            scalar(
                `SELECT COUNT(*) AS c FROM job_applications ja
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ?`, [adminId]),
            scalar(
                `SELECT COUNT(*) AS c FROM referral_queue rq
                 JOIN job_applications ja ON rq.application_id = ja.id
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND rq.status = 'Approved'`, [adminId]),
            scalar(
                `SELECT COUNT(DISTINCT ro.queue_id) AS c FROM referral_outcomes ro
                 JOIN referral_queue rq ON ro.queue_id = rq.id
                 JOIN job_applications ja ON rq.application_id = ja.id
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND ro.outcome = 'Hired'`, [adminId]),

            // ── Distributions ───────────────────────────────────────────────
            rowsOf(
                `SELECT status, COUNT(*) AS count FROM pesoadmin_job_posts
                 WHERE peso_admin_id = ? GROUP BY status`, [adminId]),
            rowsOf(
                `SELECT ja.status, COUNT(*) AS count FROM job_applications ja
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? GROUP BY ja.status`, [adminId]),

            // ── Pending administrative action ───────────────────────────────
            scalar(
                `SELECT COUNT(*) AS c FROM referral_queue rq
                 JOIN job_applications ja ON rq.application_id = ja.id
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND rq.status = 'Pending Review'`, [adminId]),
            scalar(
                `SELECT COUNT(*) AS c FROM job_applications ja
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND ja.status = 'Applied'`, [adminId]),
            scalar(
                `SELECT COUNT(*) AS c FROM referral_jobs rj
                 JOIN referral_queue rq ON rj.queue_id = rq.id
                 JOIN job_applications ja ON rq.application_id = ja.id
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND rj.status = 'failed'`, [adminId]),

            // ── Monthly employment trends (bucketed in JS, 6-month window) ───
            rowsOf(
                `SELECT ja.applied_at FROM job_applications ja
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND ja.applied_at >= ?`, [adminId, rangeStart]),
            rowsOf(
                `SELECT COALESCE(ro.outcome_at, ro.recorded_at) AS hired_at
                 FROM referral_outcomes ro
                 JOIN referral_queue rq ON ro.queue_id = rq.id
                 JOIN job_applications ja ON rq.application_id = ja.id
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 WHERE pj.peso_admin_id = ? AND ro.outcome = 'Hired'`, [adminId]),

            // ── Recent activity feed (latest applications to this admin) ─────
            rowsOf(
                `SELECT ja.id, ja.status, ja.applied_at,
                        COALESCE(u.name, 'A job seeker') AS applicant_name,
                        pj.title AS job_title
                 FROM job_applications ja
                 JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                 JOIN users u ON ja.applicant_id = u.id
                 WHERE pj.peso_admin_id = ?
                 ORDER BY ja.applied_at DESC LIMIT 8`, [adminId]),
        ]);

        for (const r of appDates) { const b = bucketFor(r.applied_at); if (b) b.applications += 1; }
        for (const r of hireDates) { const b = bucketFor(r.hired_at); if (b) b.hires += 1; }

        return {
            cards: {
                activeVacancies, totalJobSeekers, totalEmployers,
                applicationsReceived, referralLettersGenerated, successfulHires,
            },
            vacancyStatus,        // [{ status, count }] — this admin's postings
            applicationStatus,    // [{ status, count }] — apps on this admin's jobs
            monthly: months,      // [{ key, label, applications, hires }]
            windowMonths,         // echo of the applied trend window (3/6/12)
            pendingActions: { pendingReferrals, newApplications, failedReferrals },
            recentActivity,       // [{ id, status, applied_at, applicant_name, job_title }]
        };
    } catch (error) {
        console.error('[PesoAdmin analytics] overview computation failed:', error.message);
        throw error;
    }
}

const ANALYTICS_WINDOWS = [3, 6, 12];
const resolveAnalyticsWindow = (raw) => { const n = Number.parseInt(raw, 10); return ANALYTICS_WINDOWS.includes(n) ? n : 6; };

router.get('/analytics/overview', async (req, res) => {
    try {
        const data = await computeOverview(req.userId, resolveAnalyticsWindow(req.query.months));
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to compute dashboard analytics.' });
    }
});

/**
 * GET /analytics/export
 * The dashboard as a flat CSV the office can hand to DOLE without re-keying.
 *
 * Deliberately a LABEL/VALUE/CONTEXT sheet rather than a wide table: the
 * dashboard mixes single figures, distributions and a monthly series, and
 * flattening them into one shape keeps the file readable in Excel and stable if
 * a new metric is added. The `Context` column carries the qualifier that makes
 * each number defensible on its own ("Confirmed placements", not just "Hires").
 */
router.get('/analytics/export', async (req, res) => {
    try {
        const windowMonths = resolveAnalyticsWindow(req.query.months);
        const d = await computeOverview(req.userId, windowMonths);
        const c = d.cards || {};
        const p = d.pendingActions || {};

        // FULL parity with the on-screen dashboard: all six summary KPIs, the pending-action
        // counts, both status distributions, and the monthly trend series for the SAME window
        // the dashboard shows (?months=). A flat Metric/Value/Context sheet stays Excel-readable
        // and stable as metrics are added, and can't drift (both read one computeOverview()).
        const rows = [
            ['Active Job Vacancies', c.activeVacancies, 'Open and published postings'],
            ['Registered Job Seekers', c.totalJobSeekers, 'Active job-seeker accounts (platform-wide)'],
            ['Active Local Employers', c.totalEmployers, 'Distinct organisations with live postings (platform-wide)'],
            ['Applications Received', c.applicationsReceived, 'Across all of your vacancies'],
            ['Referral Letters Generated', c.referralLettersGenerated, 'Approved referrals'],
            ['Successful Hires', c.successfulHires, 'Confirmed placement outcomes (not letters sent)'],
            ['Referrals Awaiting Review', p.pendingReferrals, 'Pending administrative action'],
            ['New Applications to Screen', p.newApplications, 'Pending administrative action'],
            ['Referral Letters Needing Retry', p.failedReferrals, 'Pending administrative action'],
        ];
        for (const r of (d.vacancyStatus || [])) rows.push([`Vacancies — ${r.status || 'Unknown'}`, r.count, 'Vacancy status distribution']);
        for (const r of (d.applicationStatus || [])) rows.push([`Applications — ${r.status || 'Unknown'}`, r.count, 'Application status distribution']);
        for (const m of (d.monthly || [])) {
            rows.push([`Applications (${m.key})`, m.applications, `Monthly employment trend — last ${windowMonths} months`]);
            rows.push([`Hires (${m.key})`, m.hires, `Monthly employment trend — last ${windowMonths} months`]);
        }

        const stamp = new Date().toISOString().slice(0, 10);
        return sendCsv(res, `peso-dashboard-summary-${stamp}.csv`, ['Metric', 'Value', 'Context'], rows);
    } catch (error) {
        console.error('[PesoAdmin analytics] export failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to export dashboard summary.' });
    }
});

// =======================================================
// SMART REFERRAL QUEUE (Proactive AI Referral, Phase 2)
// AI-ranked candidates the admin can proactively refer WITHOUT the seeker
// applying. All owner-scoped (the service filters by peso_admin_id) and PESO-admin
// -only (router guards above). Promotion reuses the vacancy-capped approveReferral
// pipeline; a named admin approving here satisfies invariant 0.4.
// =======================================================

// GET the queue GROUPED BY VACANCY, ranked within each vacancy (paged by vacancy).
// This is what the Smart Referral Queue renders — a candidate is only ranked against
// others for the SAME job, never globally across unrelated postings.
router.get('/proactive/candidates/grouped', async (req, res) => {
    try {
        const { page, limit } = getPageParams(req.query);
        const result = await proactiveReferralService.listCandidateGroups(req.userId, { page, limit });
        res.status(200).json({ status: 'success', ...result });
    } catch (error) {
        console.error('[Proactive] List candidate groups failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Could not load recommended candidates.' });
    }
});

// GET the ranked queue (paged, filter by ?jobId). Flat list — retained for callers
// that want a single ungrouped page.
router.get('/proactive/candidates', async (req, res) => {
    try {
        const { page, limit } = getPageParams(req.query);
        const jobId = req.query.jobId ? Number(req.query.jobId) : null;
        const result = await proactiveReferralService.listCandidates(req.userId, { page, limit, jobId });
        res.status(200).json({ status: 'success', ...result });
    } catch (error) {
        console.error('[Proactive] List candidates failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load recommended candidates.' });
    }
});

// POST approve → create the administrator-initiated referral.
router.post('/proactive/candidates/:id/approve', async (req, res) => {
    try {
        const result = await proactiveReferralService.promoteCandidate({
            candidateId: Number(req.params.id), adminId: req.userId, remarks: req.body?.remarks || null,
        });
        res.status(200).json({ status: 'success', message: 'Referral created and queued for delivery.', data: result });
    } catch (error) {
        if (error.name === 'ServiceError') {
            return res.status(error.statusCode || 400).json({ status: 'error', message: error.message, ...(error.data || {}) });
        }
        console.error('[Proactive] Approve failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to create the referral.' });
    }
});

// POST dismiss → remove from the queue (kept so it is never re-suggested).
router.post('/proactive/candidates/:id/dismiss', async (req, res) => {
    try {
        await proactiveReferralService.dismissCandidate({
            candidateId: Number(req.params.id), adminId: req.userId, reason: req.body?.reason || null,
        });
        res.status(200).json({ status: 'success', message: 'Recommendation dismissed.' });
    } catch (error) {
        if (error.name === 'ServiceError') {
            return res.status(error.statusCode || 400).json({ status: 'error', message: error.message });
        }
        console.error('[Proactive] Dismiss failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to dismiss the recommendation.' });
    }
});

// POST rescan → re-arm proactive matching for one of this admin's vacancies.
router.post('/proactive/rescan/:jobId', async (req, res) => {
    try {
        const [own] = await db.query('SELECT id FROM pesoadmin_job_posts WHERE id = ? AND peso_admin_id = ?', [req.params.jobId, req.userId]);
        if (own.length === 0) return res.status(403).json({ status: 'error', message: 'Unauthorized for this vacancy.' });
        await proactiveReferralService.enqueueForJob(Number(req.params.jobId));
        res.status(202).json({ status: 'success', message: 'Re-scan queued. New matches will appear shortly.' });
    } catch (error) {
        console.error('[Proactive] Rescan failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to queue a re-scan.' });
    }
});

module.exports = router;
