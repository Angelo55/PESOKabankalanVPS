/**
 * PUBLIC JOB BOARD — the only router that serves unauthenticated visitors.
 *
 * WHAT: the vacancy list and detail pages anyone can browse without an account,
 * the landing-page statistics, and the per-job screening questions.
 *
 * WHEN: every visit to the landing page and the public board, signed in or not.
 *
 * ── FILLED VACANCIES STAY VISIBLE ──────────────────────────────────────────
 * The list includes postings with status Open, Published AND Filled. A filled
 * vacancy is shown with an honest "Vacancy Filled" label rather than vanishing,
 * because a posting that silently disappears reads as a broken link to someone
 * who bookmarked it. Every payload carries `referred_count` so the client can
 * make that judgement with isJobFilled() / filledLabel().
 *
 * ── LANDING PAGE STATISTICS ────────────────────────────────────────────────
 * `/stats` returns four fields, each mapping to exactly ONE tile:
 *
 *   jobs      Available Opportunities   live postings
 *   users     Registered Job Seekers    active applicant accounts
 *   hires     Successful Referrals      referral_outcomes WHERE outcome='Hired'
 *   partners  Active Local Employers    distinct companies on live postings
 *
 * `hires` deserves care if it comes up in questioning. It used to count
 * APPROVED referrals — that is, letters that had been generated and emailed. A
 * referral the employer ignored was therefore published to the public as a
 * successful placement: a government employment figure computed from "we sent a
 * PDF". Since migration 023 it counts referrals actually recorded as resulting
 * in a hire. The number is smaller and it is defensible.
 *
 * ── DEGRADATION ────────────────────────────────────────────────────────────
 * Every statistic goes through safeQuery, which returns a default if its query
 * fails. One broken panel shows a zero; it does not 500 the landing page a
 * visitor is using to look for work.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { createTtlCache } = require('../utils/ttlCache');

// Landing-page stats are platform-wide and change slowly, but are hit on every visit
// (measured ~1–2s: five COUNT/DISTINCT aggregations). A short shared TTL cache serves
// them instantly to everyone; STATS_CACHE_TTL_MS default 60s bounds staleness.
const statsCache = createTtlCache({ ttlMs: Number(process.env.STATS_CACHE_TTL_MS) || 60000, max: 1 });

// Safe query helper to prevent crashes if a table is temporarily missing
const safeQuery = async (queryText, params, defaultResponse) => {
    try {
        const [rows] = await db.query(queryText, params);
        return rows;
    } catch (error) {
        console.warn(`[SafeQuery Warning] Skipping query: ${error.message}`);
        return defaultResponse;
    }
};

// Idempotent, self-healing schema guard. Mirrors migration 013 so the discovery
// and apply-wizard features work even if `npm run migrate` has not been run.
// Each statement is wrapped so a benign "already exists" never breaks boot.
let jobBoardSchemaReady = null;
const ensureJobBoardSchema = () => {
    if (db.isPostgres) return Promise.resolve(); // schema owned by postgres/schema.sql
    if (jobBoardSchemaReady) return jobBoardSchemaReady;
    jobBoardSchemaReady = (async () => {
        const stmts = [
            `ALTER TABLE pesoadmin_job_posts ADD COLUMN IF NOT EXISTS category VARCHAR(100) NULL DEFAULT NULL`,
            `ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS applicant_snapshot TEXT NULL`,
            `ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS cover_letter_text TEXT NULL`,
            `ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS cover_letter_url VARCHAR(512) NULL DEFAULT NULL`,
            `CREATE TABLE IF NOT EXISTS job_application_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                job_id INT NOT NULL,
                question_text VARCHAR(500) NOT NULL,
                question_type ENUM('text','textarea','select','boolean') NOT NULL DEFAULT 'text',
                options TEXT NULL,
                is_required BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS job_application_answers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                application_id INT NOT NULL,
                question_id INT NOT NULL,
                answer_text TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        for (const stmt of stmts) {
            try { await db.query(stmt); } catch (e) { /* already applied */ }
        }
    })();
    return jobBoardSchemaReady;
};
// Kick it off at load; also awaited inside routes that depend on it.
ensureJobBoardSchema();

// ==========================================
// 1. PUBLIC ROUTE: Landing Page Statistics
// ==========================================
// ==========================================
// 1. PUBLIC ROUTE: Landing Page Statistics
// ==========================================
router.get('/stats', async (req, res) => {
	try {
		const cachedStats = statsCache.get('board-stats');
		if (cachedStats) return res.status(200).json({ status: 'success', data: cachedStats, cached: true });

		const [jobs] = await safeQuery(
			`SELECT COUNT(*) AS count FROM pesoadmin_job_posts WHERE status IN ('Open', 'Published')`,
			[], [{ count: 0 }]
		);
		// NOTE: the Registered Job Seekers count is intentionally NOT exposed here.
		// Per the PESO Office (Sir Tejada), that figure is no longer public. The
		// underlying user data is untouched; the count is still available behind
		// auth via /admin/metrics for operational use.
		// "Successful Referrals" means PEOPLE WHO GOT THE JOB.
		//
		// This counted approved referral_queue rows, i.e. letters that had been
		// generated and emailed. A referral the employer ignored was therefore
		// published to the public as a success -- a government placement figure
		// computed from "we sent a PDF". Migration 023 made the real answer
		// recordable; this is where it becomes the number on display.
		//
		// The figure will drop sharply the first time this deploys, because the
		// 27 historical referrals have no recorded outcome and are not being
		// invented as hires. That is a correction, not a regression: the smaller
		// number is the one PESO can defend.
		const [hires] = await safeQuery(
			`SELECT COUNT(*) AS count FROM referral_outcomes WHERE outcome = 'Hired'`,
			[], [{ count: 0 }]
		);
		// Active Local Employers: distinct hiring organizations among LIVE postings.
		const [partners] = await safeQuery(
			`SELECT COUNT(DISTINCT company) AS count FROM pesoadmin_job_posts
			 WHERE status IN ('Open', 'Published') AND company IS NOT NULL AND company <> ''`,
			[], [{ count: 0 }]
		);
		// Referral Letters Issued: approved referrals. Distinct from `hires`
		// (outcome = 'Hired') on purpose — this counts official endorsements the
		// office generated, NOT placements. Keeping the two separate is the same
		// delivery-vs-outcome line invariant 0.14 draws; never conflate them.
		const [referrals] = await safeQuery(
			`SELECT COUNT(*) AS count FROM referral_queue WHERE status = 'Approved'`,
			[], [{ count: 0 }]
		);

		const stats = {
			jobs: jobs?.count || 0,
			hires: hires?.count || 0,
			partners: partners?.count || 0,
			referrals: referrals?.count || 0
		};
		statsCache.set('board-stats', stats);
		res.status(200).json({ status: 'success', data: stats });
	} catch (error) {
		console.error("Landing Stats Error:", error);
		res.status(500).json({ status: 'error', message: 'Failed to fetch platform statistics.' });
	}
});

// NOTE: the public POST /contact "Contact Us" inquiry route was REMOVED (Landing Page
// cleanup, §46). It backed a hardcoded landing contact form that duplicated the office
// "Message Us" channel and whose stored rows (contact_inquiries) were never read anywhere.
// The single contact channel is now "Message Us" (the office Facebook link) in the
// consolidated Common Questions + Visit Us section. The dormant contact_inquiries table is
// left in place (physical schema is frozen on live TiDB, §0.7) — do not reintroduce this route.

// ==========================================
// 3. PUBLIC ROUTE: Standard Job Grid Fetch
//    Supports optional discovery params: search, category, job_type,
//    work_setup, location, sort. All parameterized. No params => the original
//    behavior (every Open/Published job, newest first) so existing callers are
//    unaffected.
// ==========================================
router.get('/', async (req, res) => {
    try {
        const { search, category, job_type, work_setup, location, sort } = req.query;

        // 'Filled' postings stay on the board so seekers see an honest
        // "positions filled" state instead of a silently vanished job; the Apply
        // path is blocked for them both client- and server-side.
        const where = [`(status = 'Open' OR status = 'Published' OR status = 'Filled')`];
        const params = [];

        if (search && String(search).trim()) {
            const term = `%${String(search).trim()}%`;
            where.push(`(title LIKE ? OR company LIKE ? OR department LIKE ? OR description LIKE ?)`);
            params.push(term, term, term, term);
        }
        if (category && String(category).trim()) {
            // Match the first-class category OR fall back to legacy department text.
            where.push(`(COALESCE(NULLIF(category, ''), department) = ?)`);
            params.push(String(category).trim());
        }
        if (job_type && String(job_type).trim()) {
            where.push(`job_type = ?`);
            params.push(String(job_type).trim());
        }
        if (work_setup && String(work_setup).trim()) {
            where.push(`work_setup = ?`);
            params.push(String(work_setup).trim());
        }
        if (location && String(location).trim()) {
            where.push(`location LIKE ?`);
            params.push(`%${String(location).trim()}%`);
        }

        // Whitelist sort options -- never interpolate user input into ORDER BY.
        const sortMap = {
            newest: 'created_at DESC',
            oldest: 'created_at ASC',
            deadline: 'deadline IS NULL, deadline ASC',
            az: 'title ASC',
            za: 'title DESC'
        };
        const orderBy = sortMap[sort] || sortMap.newest;

        // referred_count powers the vacancy indicator: a job is effectively
        // filled when referred_count >= positions_available, even if the status
        // flag has not caught up (e.g. legacy rows approved before the cap).
        //
        // Explicit column list (was `pj.*`): the grid cards + client-side
        // filters use these fields, and the two LONGTEXT detail-only columns
        // (`responsibilities`, `additional_instructions`) are DELIBERATELY
        // excluded — they are shown only in the detail drawer, which fetches
        // them separately via GET /job-board/:id (the "deep fetch"). Keeping
        // them out of the list keeps the grid payload small on wide result sets.
        const [jobs] = await db.query(
            `SELECT pj.id, pj.peso_admin_id, pj.title, pj.company, pj.description,
                    pj.job_type, pj.work_setup, pj.location, pj.status, pj.created_at,
                    pj.department, pj.qualifications, pj.skills, pj.education, pj.experience,
                    pj.salary_range, pj.deadline, pj.positions_available,
                    pj.accessibility_accommodations, pj.moderation_status,
                    pj.featured_image, pj.category,
                    (SELECT COUNT(*)
                     FROM referral_queue rq
                     JOIN job_applications ja ON rq.application_id = ja.id
                     WHERE ja.job_id = pj.id AND rq.status = 'Approved') AS referred_count
             FROM pesoadmin_job_posts pj WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
            params
        );
        res.status(200).json(jobs);
    } catch (error) {
        console.error("Fetch Public Jobs Error:", error);
        res.status(500).json({ status: 'error', message: 'Database retrieval failed.' });
    }
});

// ==========================================
// 3b. PUBLIC ROUTE: Category list with counts (for category rows & filters)
// ==========================================
router.get('/categories', async (req, res) => {
    try {
        const rows = await safeQuery(
            `SELECT COALESCE(NULLIF(category, ''), department) AS name, COUNT(*) AS count
             FROM pesoadmin_job_posts
             WHERE (status = 'Open' OR status = 'Published')
               AND COALESCE(NULLIF(category, ''), department) IS NOT NULL
               AND COALESCE(NULLIF(category, ''), department) <> ''
             GROUP BY name
             ORDER BY count DESC, name ASC`,
            [], []
        );
        res.status(200).json({ status: 'success', data: rows });
    } catch (error) {
        console.error("Fetch Categories Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch categories.' });
    }
});

// NOTE: A public `GET /:id/similar` used to live here. It returned random
// vacancies (ORDER BY RAND()) and stapled on a FABRICATED `match_percentage`
// (Math.random) — a violation of invariant 0.2 and contrary to SKILL §17, which
// records that the fabricated "N% Match" was removed in favour of a neutral
// `recommendation_reason`. It had no consumer (the board uses the authed,
// résumé-driven `GET /jobs/:id/similar` in jobRoutes.js, cached), so it was
// removed as dead code carrying a fabricated score. Do not reintroduce it.

// ==========================================
// 4b. PUBLIC ROUTE: Job-specific Additional Questions (for the Apply wizard)
//     Declared BEFORE '/:id' so it is not shadowed by the catch-all detail route.
// ==========================================
router.get('/:id/questions', async (req, res) => {
    try {
        await ensureJobBoardSchema();
        const questions = await safeQuery(
            `SELECT id, question_text, question_type, options, is_required, sort_order
             FROM job_application_questions
             WHERE job_id = ?
             ORDER BY sort_order ASC, id ASC`,
            [req.params.id], []
        );
        const shaped = questions.map(q => ({
            ...q,
            is_required: !!q.is_required,
            options: (() => { try { return q.options ? JSON.parse(q.options) : []; } catch { return []; } })()
        }));
        res.status(200).json({ status: 'success', data: shaped });
    } catch (error) {
        console.error("Fetch Job Questions Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch application questions.' });
    }
});

// ==========================================
// 5. PUBLIC ROUTE: Deep Fetch For Side Panel
// ==========================================
router.get('/:id', async (req, res) => {
    try {
        const [jobs] = await db.query(`
            SELECT pj.*,
                   ep.company_name as emp_company, ep.business_description, ep.industry, ep.company_size, ep.website,
                   u.email as contact_email,
                   (SELECT COUNT(*)
                    FROM referral_queue rq
                    JOIN job_applications ja ON rq.application_id = ja.id
                    WHERE ja.job_id = pj.id AND rq.status = 'Approved') AS referred_count
            FROM pesoadmin_job_posts pj
            LEFT JOIN pesoadmin_profiles ep ON peso_admin_id = ep.user_id
            LEFT JOIN users u ON peso_admin_id = u.id
            WHERE pj.id = ?
        `, [req.params.id]);

        if (jobs.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Job not found.' });
        }
        
        res.status(200).json({ status: 'success', data: jobs[0] });
    } catch (error) {
        console.error("Complete Job Detail Fetch Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch complete job details.' });
    }
});

// ==========================================
// 6. PROTECTED ROUTE: Job Application Submit
// ==========================================
router.post('/:jobId/apply', requireAuth, async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const [jobDetails] = await db.query('SELECT company, title as job_title FROM pesoadmin_job_posts WHERE id = ?', [jobId]);
        
        if (jobDetails.length === 0) return res.status(404).json({ status: 'error', message: 'Job not found.' });

        const job = jobDetails[0];

        await db.query(`
            INSERT INTO Applications (user_id, company_name, job_title, platform_source, application_status) 
            VALUES (?, ?, ?, 'PESO Kabankalan', 'Applied')
        `, [req.userId, job.company, job.job_title]);

        res.status(200).json({ status: 'success', message: 'Application submitted successfully.' });
    } catch (error) {
        console.error("Apply Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to submit application.' });
    }
});

module.exports = router;