const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { applyLimiter } = require('../middleware/rateLimiters');
/**
 * JOB APPLICATION SUBMISSION — the busiest workflow in the system.
 *
 * WHAT: `POST /api/applications` is what happens when a job seeker finishes the
 * Apply Wizard. It is the junction where the application, the resume snapshot,
 * the AI score, the referral pipeline and the notification system all meet.
 *
 * WHEN: once per (job, applicant). A second submission is refused.
 *
 * ── ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER ──────────────────────────
 *  1. VACANCY GATE      refuse non-Open/Published postings and count-filled
 *                       jobs. The disabled button in the UI is convenience;
 *                       THIS is the enforcement.
 *  2. INSERT            the row in job_applications. Everything after this
 *                       point is secondary.
 *  3. RESUME SNAPSHOT   an immutable per-application PDF copy in
 *                       application_resumes (base64). The administrator must
 *                       always retrieve exactly what was submitted, even if the
 *                       seeker edits their resume afterwards.
 *  4. TEXT EXTRACTION   parsed into uploaded_resumes.parsed_text BEFORE
 *                       scoring, because parsed_text is what the scorer reads.
 *                       Skipping this silently starves the AI of input.
 *  5. AI SCORE          scoreApplication() -> {overall, skills, education,
 *                       experience} or NULL.
 *  6. REFERRAL STAGING  if the score clears REFERRAL_AI_THRESHOLD, stage a
 *                       'Pending Review' referral for the admin's queue.
 *  7. NOTIFY            tell the owning PESO administrator.
 *
 * ── THE RULE THAT GOVERNS STEPS 3-7 ────────────────────────────────────────
 * NONE of them may fail the application. Each is wrapped independently, logged
 * on failure, and skipped. A citizen must be able to apply for work even if the
 * AI provider is down, the mail server is unreachable, the snapshot write fails,
 * or the notification cannot be delivered. This is the system's first
 * invariant, and this route is where it matters most.
 *
 * A NULL AI score is a NORMAL outcome, not an error: it means "not scored" and
 * routes the applicant to manual review. A fabricated score would be worse than
 * none, because it silently misroutes a real person's application.
 *
 * ── WHY THE SNAPSHOT IS BASE64 IN THE DATABASE ─────────────────────────────
 * Render's filesystem is ephemeral. A resume written to disk is gone at the next
 * deploy, and the administrator would be left with an application referencing a
 * document that no longer exists.
 */

const { scoreApplication } = require('../services/aiScoringService');
const matchScoreCache = require('../services/matchScoreCache');
const { referralService } = require('../services/referralService');
const { renderResumeToBuffer } = require('../services/resumePdfService');
const { notifyUser } = require('../services/notificationService');
const certificatesRepository = require('../repositories/certificatesRepository');
const applicationScoringService = require('../services/applicationScoringService');
const onboardingService = require('../services/onboardingService');

// Optional PDF text extraction for uploaded resumes (feeds the AI scorer).
// pdfTextService handles both pdf-parse v1 and v2 APIs and never crashes the
// server if the library is missing -- extraction just degrades to skipped.
const { extractPdfText, isPdfExtractAvailable } = require('../services/pdfTextService');
const systemSettings = require('../services/systemSettingsService');

const router = express.Router();
router.use(requireAuth);

// ==========================================
// JOB SEEKER: MY PESO APPLICATIONS (the real vacancy-application lifecycle)
// ==========================================
/**
 * GET /api/applications/mine
 * The signed-in job seeker's own applications to PESO vacancies, with their live
 * ATS status (Applied → Under Review → Shortlisted → Referred) and referral state.
 *
 * This is DISTINCT from /api/tracked-jobs (the seeker's PRIVATE external-job
 * tracker in usertrackedjobs) — this reads job_applications, the actual PESO
 * submissions. It is the data behind the read-only "My PESO Applications" pipeline
 * board and its analytics, and the surface the APPLICATION_STATUS notification now
 * deep-links to.
 *
 * Owner-scoped by applicant_id. Referral fields come from correlated subqueries so
 * a duplicate letter row can never multiply an application into several rows;
 * userprofiles is never joined (invariant 0.8). No PII beyond the seeker's own.
 */
router.get('/mine', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                ja.id            AS application_id,
                ja.status        AS application_status,
                ja.origin,
                ja.match_score,
                ja.current_match_score,
                ja.applied_at,
                pj.id            AS job_id,
                pj.title         AS job_title,
                pj.company       AS company_name,
                pj.location      AS job_location,
                pj.status        AS job_status,
                (SELECT rq.id FROM referral_queue rq
                   WHERE rq.application_id = ja.id ORDER BY rq.id DESC LIMIT 1) AS referral_id,
                (SELECT rq.status FROM referral_queue rq
                   WHERE rq.application_id = ja.id ORDER BY rq.id DESC LIMIT 1) AS referral_status,
                (SELECT rl.reference_number FROM referral_letters rl
                   JOIN referral_queue rq2 ON rl.queue_id = rq2.id
                   WHERE rq2.application_id = ja.id ORDER BY rq2.id DESC LIMIT 1) AS referral_reference,
                (SELECT ro.outcome FROM referral_outcomes ro
                   JOIN referral_queue rq3 ON ro.queue_id = rq3.id
                   WHERE rq3.application_id = ja.id ORDER BY rq3.id DESC LIMIT 1) AS referral_outcome
            FROM job_applications ja
            JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
            WHERE ja.applicant_id = ?
            ORDER BY ja.applied_at DESC, ja.id DESC
        `, [req.userId]);

        res.status(200).json({ status: 'success', data: rows });
    } catch (error) {
        console.error('Fetch My PESO Applications Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to load your PESO applications.' });
    }
});

/**
 * GET /api/applications/unified
 * THE single presentation-layer source of truth for the Job Seeker's "My Applications"
 * page, the Dashboard's Pipeline Analytics + My Recent widget, and its KPI cards.
 *
 * It COMPOSES (does not merge) the two underlying stores, each row `source`-tagged, so
 * every application — however it originated — is shown and counted from one feed:
 *   • source 'peso'     → job_applications (real PESO vacancy submissions, board- or
 *                          admin-referral-originated). Carries the live ATS status, AI
 *                          compatibility, and referral state/reference/letter. READ-ONLY
 *                          here (status is admin-driven; the referral pipeline is FK-bound
 *                          to job_applications.id and stays the authoritative record).
 *   • source 'imported' → usertrackedjobs (the seeker's private external + spreadsheet-
 *                          imported records). User-EDITABLE (status/delete via /tracked-jobs).
 *
 * Deliberately additive: /applications/mine and /tracked-jobs are UNCHANGED (imported-row
 * edits still POST/PATCH there), so nothing that already works regresses. Owner-scoped;
 * no userprofiles join (0.8); referral fields via correlated subqueries so a duplicate
 * letter row can never multiply an application.
 */
router.get('/unified', async (req, res) => {
    try {
        const [pesoRows, trackedRows] = await Promise.all([
            db.query(`
                SELECT
                    ja.id            AS application_id,
                    ja.status        AS application_status,
                    ja.origin,
                    ja.match_score,
                    ja.current_match_score,
                    ja.applied_at,
                    pj.id            AS job_id,
                    pj.title         AS job_title,
                    pj.company       AS company_name,
                    pj.location      AS job_location,
                    pj.status        AS job_status,
                    (SELECT rq.id FROM referral_queue rq
                       WHERE rq.application_id = ja.id ORDER BY rq.id DESC LIMIT 1) AS referral_id,
                    (SELECT rq.status FROM referral_queue rq
                       WHERE rq.application_id = ja.id ORDER BY rq.id DESC LIMIT 1) AS referral_status,
                    (SELECT rl.reference_number FROM referral_letters rl
                       JOIN referral_queue rq2 ON rl.queue_id = rq2.id
                       WHERE rq2.application_id = ja.id ORDER BY rq2.id DESC LIMIT 1) AS referral_reference,
                    (SELECT ro.outcome FROM referral_outcomes ro
                       JOIN referral_queue rq3 ON ro.queue_id = rq3.id
                       WHERE rq3.application_id = ja.id ORDER BY rq3.id DESC LIMIT 1) AS referral_outcome
                FROM job_applications ja
                JOIN pesoadmin_job_posts pj ON ja.job_id = pj.id
                WHERE ja.applicant_id = ?
            `, [req.userId]),
            db.query(`
                SELECT id, company, job_title, status, date_applied, application_source, is_pinned, color_label
                FROM usertrackedjobs
                WHERE user_id = ? AND deleted_at IS NULL
            `, [req.userId]),
        ]);

        const peso = (pesoRows[0] || []).map((r) => ({
            uid: `peso-${r.application_id}`,
            source: 'peso',
            origin: r.origin || 'seeker',
            application_id: r.application_id,
            job_id: r.job_id,
            company: r.company_name,
            job_title: r.job_title,
            location: r.job_location,
            status: r.application_status,
            applied_at: r.applied_at,
            match_score: r.current_match_score != null ? r.current_match_score : r.match_score,
            referral_id: r.referral_id,
            referral_status: r.referral_status,
            referral_reference: r.referral_reference,
            referral_outcome: r.referral_outcome,
            has_referral_letter: !!r.referral_reference,
            editable: false,
        }));

        const imported = (trackedRows[0] || []).map((r) => ({
            uid: `ext-${r.id}`,
            source: 'imported',
            origin: 'external',
            tracked_id: r.id,
            company: r.company,
            job_title: r.job_title,
            location: null,
            status: r.status || 'Applied',
            applied_at: r.date_applied,
            match_score: null,
            referral_id: null,
            referral_status: null,
            referral_reference: null,
            referral_outcome: null,
            has_referral_letter: false,
            application_source: r.application_source || null,
            is_pinned: !!r.is_pinned,
            color_label: r.color_label || null,
            editable: true,
        }));

        // Personal pin + colour label (migration 037), the SINGLE store for both sources,
        // keyed by the unified uid. Best-effort: if the table isn't there yet (pre-migrate)
        // the page still works, just without pins/labels — never 500 a read (0.1).
        const prefs = {};
        try {
            const [prows] = await db.query('SELECT app_uid, is_pinned, color_label FROM application_preferences WHERE user_id = ?', [req.userId]);
            for (const p of prows) prefs[p.app_uid] = { is_pinned: !!p.is_pinned, color_label: p.color_label || null };
        } catch (e) { /* table missing pre-migration — degrade to no prefs */ }

        const applyPref = (row) => {
            const p = prefs[row.uid];
            row.is_pinned = p ? p.is_pinned : false;
            row.color_label = p ? p.color_label : null;
            return row;
        };
        peso.forEach(applyPref);
        imported.forEach(applyPref);

        const data = [...peso, ...imported].sort((a, b) => {
            const ta = a.applied_at ? new Date(a.applied_at).getTime() : 0;
            const tb = b.applied_at ? new Date(b.applied_at).getTime() : 0;
            return tb - ta;
        });

        res.status(200).json({ status: 'success', data, counts: { peso: peso.length, imported: imported.length, total: data.length } });
    } catch (error) {
        console.error('Fetch Unified Applications Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to load your applications.' });
    }
});

/**
 * PATCH /api/applications/:uid/preferences
 * Personal pin + colour label for ANY application on the unified My Applications board
 * (PESO or imported), keyed by the unified uid ('peso-<id>' | 'ext-<id>'). Upserts into
 * application_preferences (migration 037) — a personal marker that NEVER touches the
 * application/referral record. True PATCH semantics (only provided keys change); colour
 * validated against the palette allow-list; owner-scoped by user_id.
 */
const APP_PREF_COLORS = new Set(['red', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'gray']);
const APP_UID_RE = /^(peso|ext)-\d+$/;
router.patch('/:uid/preferences', async (req, res) => {
    const { uid } = req.params;
    if (!APP_UID_RE.test(uid)) return res.status(400).json({ status: 'error', message: 'Invalid application reference.' });

    const body = req.body || {};
    const hasPin = Object.prototype.hasOwnProperty.call(body, 'is_pinned');
    const hasColor = Object.prototype.hasOwnProperty.call(body, 'color_label');
    if (!hasPin && !hasColor) return res.status(400).json({ status: 'error', message: 'Nothing to update.' });
    if (hasColor && body.color_label !== null && !APP_PREF_COLORS.has(body.color_label)) {
        return res.status(400).json({ status: 'error', message: 'Unknown colour label.' });
    }

    // Only the keys present in the body are written on update (true PATCH — pin and colour
    // never clobber each other); the insert seeds the row with safe defaults.
    const sets = [];
    const updateVals = [];
    if (hasPin) { sets.push('is_pinned = ?'); updateVals.push(body.is_pinned ? 1 : 0); }
    if (hasColor) { sets.push('color_label = ?'); updateVals.push(body.color_label || null); }

    try {
        await db.query(
            `INSERT INTO application_preferences (user_id, app_uid, is_pinned, color_label)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ${sets.join(', ')}`,
            [req.userId, uid, hasPin ? (body.is_pinned ? 1 : 0) : 0, hasColor ? (body.color_label || null) : null, ...updateVals]
        );
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('Update application preferences error:', error);
        res.status(500).json({ status: 'error', message: 'Could not save your preference.' });
    }
});

// ==========================================
// JOB SEEKER: SUBMIT JOB APPLICATION
// ==========================================
router.post('/', applyLimiter, async (req, res) => {
    try {
        // 1. Hyper-resilient ID extraction (Catches job_id, jobId, or id)
        const jobId = req.body.job_id || req.body.jobId || req.body.id;
        const applicantId = req.userId;

        if (!jobId) {
            return res.status(400).json({ status: 'error', message: 'Missing Job ID. The frontend did not send the job identifier.' });
        }

        // ── Account-completion gate (onboarding, 2026-09) ───────────────────────
        // A seeker must have completed the mandatory identity/DOLE profile fields AND
        // have a résumé on file before applying. Derived server-side (never a bypassable
        // flag) — the authoritative enforcement behind the disabled Apply button. A
        // definitive "incomplete" is refused with a machine-readable code; an indeterminate
        // check (DB blip → error) fails OPEN so a hiccup never blocks a legitimate apply.
        const onboarding = await onboardingService.evaluate(applicantId);
        if (!onboarding.canApply && !onboarding.error) {
            return res.status(403).json({
                status: 'error',
                code: 'PROFILE_INCOMPLETE',
                message: !onboarding.profileComplete
                    ? 'Please complete your profile (identity details) before applying to a vacancy.'
                    : 'Please add your résumé before applying to a vacancy.',
                missing: onboarding.missing,
                needsResume: !onboarding.hasResume,
                profileComplete: onboarding.profileComplete,
            });
        }

        // 1b. Ensure wizard columns/tables exist (idempotent, mirrors migration 013).
        if (!db.isPostgres) try {
            await db.query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS applicant_snapshot TEXT NULL`);
            await db.query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS cover_letter_text TEXT NULL`);
            await db.query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS cover_letter_url VARCHAR(512) NULL DEFAULT NULL`);
            await db.query(`CREATE TABLE IF NOT EXISTS job_application_answers (
                id INT AUTO_INCREMENT PRIMARY KEY, application_id INT NOT NULL, question_id INT NOT NULL,
                answer_text TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
            // Immutable per-application resume snapshot. Stored as base64 in the DB
            // (durable across restarts, mirrors the avatar_url convention) so the
            // PESO admin can always retrieve exactly what the applicant submitted.
            await db.query(`CREATE TABLE IF NOT EXISTS application_resumes (
                application_id INT PRIMARY KEY,
                file_name VARCHAR(255) NULL,
                mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
                file_data LONGTEXT NOT NULL,
                source VARCHAR(50) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        } catch (e) {}

        // Wizard payload (all optional -- a bare { job_id } still works).
        const personalInfo = req.body.personal_info && typeof req.body.personal_info === 'object' ? req.body.personal_info : null;
        const resumeUrl = req.body.resume_url || req.body.resume_choice || null;
        const coverLetterText = req.body.cover_letter_text || null;
        const coverLetterUrl = req.body.cover_letter_url || null;
        const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
        const updateProfile = req.body.update_profile === true || req.body.update_profile === 'true';

        // Resume snapshot inputs (see the resume-persistence block below).
        //   resume_source: 'upload' | 'builder'
        //   resume_file_base64 / resume_file_name: present only for 'upload'
        const resumeSource = req.body.resume_source || null;
        const resumeFileBase64 = typeof req.body.resume_file_base64 === 'string' ? req.body.resume_file_base64 : null;
        const resumeFileName = req.body.resume_file_name || 'resume.pdf';

        // For an uploaded PDF, extract its text into uploaded_resumes BEFORE scoring
        // so the AI scores THIS resume (the scorer reads uploaded_resumes by user_id).
        if (resumeSource === 'upload' && resumeFileBase64 && isPdfExtractAvailable()) {
            try {
                const buffer = Buffer.from(resumeFileBase64, 'base64');
                const parsed = await extractPdfText(buffer);
                const parsedText = (parsed.text || '').trim();
                const [existingAi] = await db.query('SELECT id FROM uploaded_resumes WHERE user_id = ?', [applicantId]);
                if (existingAi.length > 0) {
                    await db.query('UPDATE uploaded_resumes SET parsed_text = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [parsedText, resumeFileName, applicantId]);
                } else {
                    await db.query('INSERT INTO uploaded_resumes (user_id, file_name, parsed_text) VALUES (?, ?, ?)', [applicantId, resumeFileName, parsedText]);
                }
                // G3.3: applying with an uploaded PDF overwrote parsed_text → this user's
                // board match previews (for every job) are now stale. Invalidate them so a
                // later board open recomputes against the résumé actually applied with.
                matchScoreCache.invalidateUser(applicantId);
            } catch (parseErr) {
                console.error(`[Application] Uploaded resume text extraction failed (application continues): ${parseErr.message}`);
            }
        }

       // 2. Verify Job Exists (full row -- the AI needs the description to score against)
        const [job] = await db.query('SELECT * FROM pesoadmin_job_posts WHERE id = ?', [jobId]);
        if (job.length === 0) {
            return res.status(404).json({ status: 'error', message: 'This job posting is no longer available.' });
        }
        const employerId = job[0].peso_admin_id;

        // 2b. VACANCY GATE: a posting that is no longer accepting candidates
        //     (closed, or every position already consumed by an approved referral)
        //     must refuse new applications server-side -- the disabled Apply
        //     button on the board is UX, not enforcement.
        if (!['Open', 'Published'].includes(job[0].status)) {
            return res.status(400).json({
                status: 'error',
                message: job[0].status === 'Filled'
                    ? 'All available positions for this job have been filled. Applications are closed.'
                    : 'This job posting is no longer accepting applications.'
            });
        }
        try {
            // Skip the count-based apply gate when the headcount is UNSPECIFIED (NULL —
            // never treated as full) or when vacancy closure is PESO-verified
            // (vacancy_manual_fill, #11b) — in both cases the vacancy stays open to
            // applications until PESO confirms it Filled via its status.
            const raw = await systemSettings.get('vacancy_manual_fill_enabled');
            const manualFill = raw === true || raw === 'true' || raw === 1 || raw === '1';
            const unspecified = job[0].positions_available == null;
            if (!manualFill && !unspecified) {
                const capacity = Math.max(1, Number(job[0].positions_available) || 1);
                const [[{ approvedCount }]] = await db.query(
                    `SELECT COUNT(*) AS approvedCount
                     FROM referral_queue rq
                     JOIN job_applications ja ON rq.application_id = ja.id
                     WHERE ja.job_id = ? AND rq.status = 'Approved'`,
                    [jobId]
                );
                if ((approvedCount || 0) >= capacity) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'All available positions for this job have been filled. Applications are closed.'
                    });
                }
            }
        } catch (capacityError) {
            // Referral tables missing on a fresh install -- treat as no slots used.
            console.error(`[Application] Vacancy check skipped: ${capacityError.message}`);
        }

        // 3. Prevent Duplicate Applications
        const [existing] = await db.query('SELECT id FROM job_applications WHERE job_id = ? AND applicant_id = ?', [jobId, applicantId]);
        if (existing.length > 0) {
            return res.status(400).json({ status: 'error', message: 'You have already applied for this position.' });
        }

        // 3b. Validate REQUIRED additional questions are answered (server-side).
        const [questions] = await db.query(
            'SELECT id, question_text, is_required FROM job_application_questions WHERE job_id = ?',
            [jobId]
        ).catch(() => [[]]);
        if (questions && questions.length > 0) {
            const answerMap = new Map(
                answers.map(a => [Number(a.question_id), (a.answer_text ?? '').toString().trim()])
            );
            const missing = questions.filter(q => q.is_required && !answerMap.get(Number(q.id)));
            if (missing.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: `Please answer all required questions: ${missing.map(m => m.question_text).join(', ')}`
                });
            }
        }

        // 4. REAL AI COMPATIBILITY SCORE (DeepSeek).
        //    Replaces the Math.random() "simulation" that previously wrote a
        //    fabricated 75-99 into every application.
        //
        //    GRACEFUL DEGRADATION: scoreApplication() returns NULL if the resume
        //    is missing, the AI is down, or the response is nonsense. NULL means
        //    "not scored" -- the application still succeeds, and it routes to
        //    manual review. An applicant must NEVER be blocked from applying
        //    because a third-party AI is unavailable.
        // AI scoring is DECOUPLED from this request when the scoring worker is enabled:
        // enqueue it (right after the insert) and return immediately, so the applicant
        // NEVER waits on a DeepSeek call. The worker fills the apply-time score
        // (match_score, immutable, via COALESCE in markScored) + the live score and
        // stages any AI recommendation (considerStaging). When the worker is OFF
        // (APPLICATION_SCORING_ENABLED != 'true'), fall back to the original synchronous
        // score so behaviour is unchanged — aiScore drives the insert columns + the
        // staging block below, both already guarded on `aiScore` being set.
        const scoringAsync = process.env.APPLICATION_SCORING_ENABLED === 'true';
        const aiScore = scoringAsync ? null : await scoreApplication({ userId: applicantId, job: job[0] });

        // 5. Insert into ATS Table (with wizard snapshot + documents)
        const [insertResult] = await db.query(
            `INSERT INTO job_applications
                (job_id, applicant_id, status, match_score, ai_analysis, ai_scored_at, applicant_snapshot, resume_url, cover_letter_text, cover_letter_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                jobId,
                applicantId,
                'Applied',
                aiScore ? aiScore.overall : null,
                aiScore ? JSON.stringify(aiScore) : null,
                aiScore ? new Date() : null,
                personalInfo ? JSON.stringify(personalInfo) : null,
                resumeUrl,
                coverLetterText,
                coverLetterUrl
            ]
        );

        // 5a. Persist answers to the job's additional questions. Isolated so a
        //     failure here never voids the (already valid) application.
        if (answers.length > 0) {
            try {
                for (const a of answers) {
                    const qid = Number(a.question_id);
                    if (!qid) continue;
                    await db.query(
                        `INSERT INTO job_application_answers (application_id, question_id, answer_text) VALUES (?, ?, ?)`,
                        [insertResult.insertId, qid, (a.answer_text ?? '').toString()]
                    );
                }
            } catch (answerError) {
                console.error(`[Application] Failed to persist some answers: ${answerError.message}`);
            }
        }

        // 5a2. Persist the immutable resume snapshot (base64) for this application so
        //      the PESO admin can retrieve exactly what was submitted. Isolated: a
        //      failure here must never void the (already valid) application.
        try {
            let resumeBuffer = null;
            let storedName = resumeFileName;
            if (resumeSource === 'upload' && resumeFileBase64) {
                resumeBuffer = Buffer.from(resumeFileBase64, 'base64');
            } else if (resumeSource === 'builder') {
                const [drafts] = await db.query('SELECT resume_data FROM resumes WHERE user_id = ?', [applicantId]);
                if (drafts.length > 0 && drafts[0].resume_data) {
                    const data = typeof drafts[0].resume_data === 'string' ? JSON.parse(drafts[0].resume_data) : drafts[0].resume_data;
                    resumeBuffer = await renderResumeToBuffer(data);
                    storedName = `${(data.personal?.name || 'Resume').replace(/[^a-zA-Z0-9]/g, '_')}_Resume.pdf`;
                }
            }
            if (resumeBuffer && resumeBuffer.length > 0) {
                await db.query(
                    `INSERT INTO application_resumes (application_id, file_name, mime_type, file_data, source)
                     VALUES (?, ?, 'application/pdf', ?, ?)
                     ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_data = VALUES(file_data), source = VALUES(source)`,
                    [insertResult.insertId, storedName, resumeBuffer.toString('base64'), resumeSource]
                );
            }
        } catch (resumeErr) {
            console.error(`[Application] Resume snapshot persistence failed (application still succeeded): ${resumeErr.message}`);
        }

        // 5b. SUPPORTING CERTIFICATES (Enhancement C). Snapshot the applicant's
        //      attached certificates into application_certificates (durable base64),
        //      validated + capped. Isolated exactly like the resume snapshot: an
        //      invalid/oversized certificate is skipped with a log, never voiding
        //      the (already valid) application (invariant 0.1).
        let storedCerts = 0;
        try {
            const certs = Array.isArray(req.body.certificates)
                ? req.body.certificates.slice(0, certificatesRepository.MAX_PER_APPLICATION)
                : [];
            for (const cert of certs) {
                // Library selection (C.2): snapshot from the applicant's OWN library
                // by id (owner-scoped), copying the bytes so the application package
                // stays immutable even if the library entry later changes.
                const libId = Number.parseInt(cert?.user_certificate_id, 10);
                if (Number.isInteger(libId) && !cert?.base64) {
                    const lib = await certificatesRepository.findUserCertificate(applicantId, libId);
                    if (!lib) { console.warn(`[Application] Skipped library certificate ${libId}: not found or not owned.`); continue; }
                    await certificatesRepository.saveApplicationCertificate({
                        applicationId: insertResult.insertId,
                        userCertificateId: lib.id,
                        title: lib.title,
                        category: lib.category,
                        fileName: lib.file_name,
                        mimeType: lib.mime_type,
                        base64: lib.content_base64,
                        parsedText: lib.parsed_text || null,
                    });
                    storedCerts += 1;
                    continue;
                }

                // Fresh upload.
                const problem = certificatesRepository.validateCertificate({ mimeType: cert?.mime_type, base64: cert?.base64 });
                if (problem) {
                    console.warn(`[Application] Skipped an invalid certificate: ${problem}`);
                    continue;
                }
                await certificatesRepository.saveApplicationCertificate({
                    applicationId: insertResult.insertId,
                    userCertificateId: null,
                    title: cert.title || cert.file_name,
                    category: cert.category || null,
                    fileName: cert.file_name || 'certificate',
                    mimeType: cert.mime_type,
                    base64: cert.base64,
                });
                storedCerts += 1;
            }
        } catch (certErr) {
            console.error(`[Application] Certificate snapshot failed (application still succeeded): ${certErr.message}`);
        }

        // Certificates are stored as ADMIN-VIEWABLE EVIDENCE ONLY — they do NOT influence
        // the AI compatibility score (the separate certificate scoring path was removed by
        // product decision, 2026-08-25). No re-score is armed for them; the résumé's own
        // content is the sole scoring input. The snapshot above still lets the admin view
        // the attached certificates in the ATS applicant drawer.
        if (storedCerts > 0) console.log(`[Application] Stored ${storedCerts} supporting certificate(s) as evidence (not scored) for application ${insertResult.insertId}.`);

        // 5aa. Optional: mirror the edited personal info back to the applicant's
        //      profile (only when they explicitly opted in). Snapshot otherwise
        //      stays application-scoped and the profile is untouched.
        if (updateProfile && personalInfo) {
            try {
                const allowed = ['name', 'phone', 'gender', 'dob', 'location', 'availability', 'educational_attainment', 'languages', 'skills'];
                const sets = [];
                const vals = [];
                for (const key of allowed) {
                    if (personalInfo[key] !== undefined && personalInfo[key] !== null && String(personalInfo[key]).trim() !== '') {
                        sets.push(`${key} = ?`);
                        vals.push(personalInfo[key]);
                    }
                }
                if (sets.length > 0) {
                    vals.push(applicantId);
                    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
                }
            } catch (profileError) {
                console.error(`[Application] Profile write-back failed (application still succeeded): ${profileError.message}`);
            }
        }

        // Decoupled apply-time scoring: enqueue immediately (delay 0) so the worker
        // scores this application off the request path within a poll cycle (~10s) —
        // filling the apply-time + live score and staging any recommendation via
        // considerStaging. Fire-and-forget; nothing in the response depends on it.
        // (When the worker is disabled, aiScore above is the sync path and the staging
        // block below runs inline exactly as before.)
        if (scoringAsync) {
            applicationScoringService.enqueueForApplication(insertResult.insertId, 0);
        }

        // 5b. AI-RECOMMENDED REFERRAL (human-approve model).
        //     If the real score clears the threshold, STAGE a referral for PESO
        //     review -- status 'Pending Review'. This sends NOTHING. It surfaces
        //     the applicant in the admin's AI-Recommended queue for one-click
        //     approval.
        //
        //     Wrapped so it can NEVER fail the application. A staging error is
        //     logged and swallowed; the applicant is already applied.
        //     The threshold is now a SYSTEM SETTING a Super Administrator can
        //     change without a redeploy. systemSettingsService resolves it as
        //     database row -> REFERRAL_AI_THRESHOLD -> 60, so behaviour is
        //     unchanged until somebody deliberately overrides it.
        //
        //     NOTE: the previous inline default here was 85 while .env sets 60,
        //     so the two disagreed. It never mattered because the env var has
        //     always been present — but on a host without it the referral queue
        //     would silently have filled far more slowly than intended. The
        //     service now owns the single default.
        //
        //     Read inside the try/catch below: a settings lookup failure must
        //     not fail the application either.
        const AI_THRESHOLD = await systemSettings.get('referral_ai_threshold');

        let aiReferralStaged = false;
        if (aiScore && aiScore.overall >= AI_THRESHOLD) {
            try {
                await referralService.stageAiRecommendation({
                    applicationId: insertResult.insertId,
                    matchScore: aiScore.overall,
                    aiAnalysis: aiScore
                });
                aiReferralStaged = true;
                console.log(`[Application] Staged AI referral for application ${insertResult.insertId} (score ${aiScore.overall}%).`);
            } catch (stagingError) {
                console.error(`[Application] AI referral staging failed (application still succeeded): ${stagingError.message}`);
            }
        }

        // 6. Emit Real-Time Socket Event + durable bell notifications for the
        //    hiring admin. notifyUser never throws (secondary concern).
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${employerId}`).emit('new_application_received', {
                jobTitle: job[0].title,
                applicantId: applicantId
            });
        }

        let applicantName = personalInfo?.name || null;
        if (!applicantName) {
            try {
                const [[applicantRow]] = await db.query('SELECT name FROM users WHERE id = ?', [applicantId]);
                applicantName = applicantRow?.name || 'A job seeker';
            } catch (e) { applicantName = 'A job seeker'; }
        }

        await notifyUser(io, {
            userId: employerId,
            type: 'NEW_APPLICATION',
            title: 'New job application',
            body: `${applicantName} applied for ${job[0].title}.`,
            link: '/peso-admin/ats'
        });

        if (aiReferralStaged) {
            await notifyUser(io, {
                userId: employerId,
                type: 'AI_RECOMMENDATION',
                title: 'AI-recommended applicant',
                body: `${applicantName} scored ${aiScore.overall}% for ${job[0].title} and is staged for referral review.`,
                link: '/referrals/recommended'
            });
        }

        res.status(201).json({ status: 'success', message: 'Application submitted successfully!' });
    } catch (error) {
        console.error("Application Submission Error:", error);
        // 🚨 CRITICAL FIX: EXPOSE THE EXACT SQL ERROR TO THE FRONTEND
        res.status(500).json({ 
            status: 'error', 
            message: `Server Error: ${error.message}` 
        });
    }
});

module.exports = router;