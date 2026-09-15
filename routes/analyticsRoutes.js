const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

// GET: Generate Dashboard Analytics
router.get('/summary', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;

        // Platform Ranking Aggregation (Top 10)
        // We group by the 'platform_source' column or 'company_name' if platform isn't tracked yet
        const [platforms] = await db.query(`
            SELECT IFNULL(company_name, 'Other') as name, COUNT(*) as value
            FROM applications
            WHERE user_id = ? 
            GROUP BY company_name
            ORDER BY value DESC
            LIMIT 10`, [userId]);

        res.json({
            platformData: platforms
        });
    } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).json({ error: "Failed to aggregate analytics" });
    }
});

/**
 * Curated competency dictionary for labour-market skill demand.
 *
 * WHY A DICTIONARY RATHER THAN FREE-TEXT TOKENISING: naive word counting over
 * job descriptions surfaces noise ("the", "work", "must") and splits synonyms
 * ("MS Office" vs "Microsoft Office") into separate rows. A curated list keyed
 * to competencies PESO actually reports on produces stable, meaningful buckets.
 *
 * WHY IT SCANS MORE THAN `skills`: that dedicated column is populated on only a
 * small minority of live postings (1 of 16 at time of writing), so restricting
 * the scan to it would report almost nothing. Matching across title /
 * description / qualifications / education / experience extracts demand signal
 * from whatever the admin actually filled in.
 *
 * Patterns match case-insensitively on word boundaries, and each posting counts
 * AT MOST ONCE per competency — so a number reads honestly as "N job postings
 * mention this", never as raw keyword frequency.
 */
const COMPETENCIES = [
    { name: 'Communication',      patterns: ['communication', 'communicate', 'interpersonal', 'verbal'] },
    { name: 'Customer Service',   patterns: ['customer service', 'customer support', 'client service', 'customer relations', 'frontline'] },
    { name: 'Computer Literacy',  patterns: ['computer literate', 'computer literacy', 'computer skills', 'basic computer', 'tech savvy'] },
    { name: 'Microsoft Office',   patterns: ['microsoft office', 'ms office', 'excel', 'word processing', 'powerpoint', 'spreadsheet'] },
    { name: 'Driving',            patterns: ['driving', 'driver', "driver's license", 'professional license', 'motorcycle'] },
    { name: 'Sales & Marketing',  patterns: ['sales', 'marketing', 'promotion', 'merchandising'] },
    { name: 'Administrative',     patterns: ['administrative', 'clerical', 'encoding', 'filing', 'records management', 'bookkeeping'] },
    { name: 'Teamwork',           patterns: ['teamwork', 'team player', 'collaborative', 'collaboration'] },
    { name: 'Leadership',         patterns: ['leadership', 'supervisory', 'supervisor', 'team lead', 'management'] },
    { name: 'Problem Solving',    patterns: ['problem solving', 'analytical', 'critical thinking', 'troubleshoot'] },
    { name: 'Technical / IT',     patterns: ['programming', 'developer', 'software', 'network', 'database', 'information technology', 'bsit', 'web development'] },
    { name: 'Healthcare',         patterns: ['nursing', 'caregiver', 'medical', 'health worker', 'first aid'] },
    { name: 'Food Service',       patterns: ['food service', 'cooking', 'culinary', 'barista', 'waiter', 'kitchen'] },
    { name: 'Construction Trade', patterns: ['carpentry', 'masonry', 'welding', 'electrician', 'plumbing', 'construction'] },
    { name: 'Security',           patterns: ['security guard', 'security', 'safety officer'] },
];

// Word-boundary match, so "sales" cannot fire inside "wholesaler".
const mentions = (haystack, pattern) => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
};

/**
 * GET /api/analytics/skill-demand
 * Most in-demand competencies across CURRENTLY LIVE vacancies.
 *
 * Recomputed per request from `pesoadmin_job_posts`, so it tracks postings being
 * created, edited, filled or closed with no cache to invalidate. Filled/closed
 * vacancies are excluded — they no longer represent demand.
 */
router.get('/skill-demand', requireAuth, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 15);

        const [posts] = await db.query(`
            SELECT title, skills, qualifications, description, education, experience, category
            FROM pesoadmin_job_posts
            WHERE status IN ('Open', 'Published')
        `);

        const counts = new Map(COMPETENCIES.map(c => [c.name, 0]));

        for (const post of posts) {
            const haystack = [
                post.title, post.skills, post.qualifications,
                post.description, post.education, post.experience, post.category,
            ].filter(Boolean).join(' ').toLowerCase();

            if (!haystack.trim()) continue;

            for (const comp of COMPETENCIES) {
                // `some` => one posting counts once per competency, however many
                // of that competency's synonyms it happens to contain.
                if (comp.patterns.some(p => mentions(haystack, p))) {
                    counts.set(comp.name, counts.get(comp.name) + 1);
                }
            }
        }

        const skills = [...counts.entries()]
            .map(([name, count]) => ({ name, count }))
            .filter(s => s.count > 0)
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, limit);

        res.status(200).json({
            status: 'success',
            data: {
                skills,
                totalPostings: posts.length,
                // Lets the UI explain a sparse chart honestly rather than looking broken.
                postingsWithSkillText: posts.filter(p => (p.skills || '').trim()).length,
            },
        });
    } catch (error) {
        console.error('[Analytics] skill-demand failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to compute skill demand.' });
    }
});

/**
 * GET /api/analytics/pipeline
 * Career KPIs for the signed-in job seeker's own application pipeline.
 *
 * Scoped to `usertrackedjobs` — the seeker's private tracker, which is what the
 * dashboard Kanban shows — and excludes trashed rows so these figures always
 * agree with the board.
 */
router.get('/pipeline', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT status, date_applied, last_updated
             FROM usertrackedjobs WHERE user_id = ? AND deleted_at IS NULL`,
            [req.userId]
        );

        const total = rows.length;
        const lower = (s) => String(s || '').toLowerCase();

        const interviews = rows.filter(r => lower(r.status).includes('interview')).length;
        const hired = rows.filter(r => ['hired', 'accepted'].includes(lower(r.status))).length;
        const rejected = rows.filter(r => lower(r.status) === 'rejected').length;
        // "Active" = still in play: neither a terminal win nor a terminal loss.
        const active = rows.filter(r => !['hired', 'accepted', 'rejected', 'withdrawn'].includes(lower(r.status))).length;

        const pct = (n) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);

        // Last 6 calendar months including the current one, zero-filled so quiet
        // months render as gaps in the trend rather than disappearing.
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                label: d.toLocaleString(undefined, { month: 'short' }),
                count: 0,
            });
        }
        const index = new Map(months.map(m => [m.key, m]));

        for (const r of rows) {
            // date_applied is a VARCHAR here; fall back to last_updated when it
            // is unparseable rather than silently dropping the application.
            const raw = r.date_applied || r.last_updated;
            const d = raw ? new Date(raw) : null;
            if (!d || Number.isNaN(d.getTime())) continue;
            const bucket = index.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            if (bucket) bucket.count += 1;
        }

        res.status(200).json({
            status: 'success',
            data: {
                total, interviews, hired, rejected, active,
                interviewRate: pct(interviews),    // reached an interview stage
                conversionRate: pct(hired),        // application -> offer
                responseRate: pct(total - active), // employer engaged at all
                monthly: months,
            },
        });
    } catch (error) {
        console.error('[Analytics] pipeline failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to compute pipeline analytics.' });
    }
});

module.exports = router;