/**
 * publicAssistant/publicData — the read-only, PUBLIC data layer behind the visitor
 * assistant's tools, plus the tool dispatcher (runTool). db-backed (so, unlike
 * knowledge.js, NOT unit-tested — requiring ../db connects to prod TiDB, §13).
 *
 * Every function returns ONLY public data (the same postings/events an anonymous visitor
 * already sees via GET /api/job-board and GET /api/events) and NEVER touches a per-user
 * table, an auth column, or free SQL. The model may call ONLY the tools in
 * knowledge.TOOL_SCHEMAS; runTool() is the single allowlisted entry point.
 */
const db = require('../../db');
const eventRepository = require('../../repositories/eventRepository');
const { OFFICE } = require('./knowledge');

const clampLimit = (n, def, max) => {
    const v = Number.parseInt(n, 10);
    return Number.isInteger(v) && v > 0 ? Math.min(v, max) : def;
};

const safe = async (queryText, params, fallback) => {
    try { const [rows] = await db.query(queryText, params); return rows; }
    catch (e) { console.warn(`[publicAssistant] query skipped: ${e.message}`); return fallback; }
};

/** Current public vacancies (Open/Published/Filled), public columns only. */
async function searchVacancies({ keyword, category, location, limit } = {}) {
    const where = [`(status = 'Open' OR status = 'Published' OR status = 'Filled')`];
    const params = [];
    if (keyword && String(keyword).trim()) {
        const t = `%${String(keyword).trim().slice(0, 60)}%`;
        where.push(`(title LIKE ? OR company LIKE ? OR department LIKE ? OR skills LIKE ?)`);
        params.push(t, t, t, t);
    }
    if (category && String(category).trim()) {
        where.push(`(COALESCE(NULLIF(category, ''), department) = ?)`);
        params.push(String(category).trim().slice(0, 100));
    }
    if (location && String(location).trim()) {
        where.push(`location LIKE ?`);
        params.push(`%${String(location).trim().slice(0, 100)}%`);
    }
    const n = clampLimit(limit, 5, 5);
    const rows = await safe(
        `SELECT id, title, company, location, job_type, work_setup, salary_range, status,
                COALESCE(NULLIF(category, ''), department) AS category
         FROM pesoadmin_job_posts
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ${n}`,
        params, []
    );
    return {
        count: rows.length,
        vacancies: rows.map((r) => ({
            title: r.title,
            company: r.company || 'PESO Kabankalan',
            location: r.location || null,
            category: r.category || null,
            job_type: r.job_type || null,
            work_setup: r.work_setup || null,
            salary: r.salary_range || null,
            filled: r.status === 'Filled',
            link: `/job-board?job=${r.id}`,
        })),
    };
}

/** Job categories that currently have open vacancies, with counts. */
async function getVacancyCategories() {
    const rows = await safe(
        `SELECT COALESCE(NULLIF(category, ''), department) AS name, COUNT(*) AS count
         FROM pesoadmin_job_posts
         WHERE (status = 'Open' OR status = 'Published')
           AND COALESCE(NULLIF(category, ''), department) IS NOT NULL
           AND COALESCE(NULLIF(category, ''), department) <> ''
         GROUP BY name ORDER BY count DESC, name ASC LIMIT 30`,
        [], []
    );
    return { categories: rows.map((r) => ({ name: r.name, count: Number(r.count) || 0 })) };
}

/** The public landing figures (same definitions as GET /api/job-board/stats). */
async function getPlatformStats() {
    const one = async (q, d) => (await safe(q, [], [{ count: d }]))[0]?.count ?? d;
    const [jobs, hires, partners, referrals] = await Promise.all([
        one(`SELECT COUNT(*) AS count FROM pesoadmin_job_posts WHERE status IN ('Open','Published')`, 0),
        one(`SELECT COUNT(*) AS count FROM referral_outcomes WHERE outcome = 'Hired'`, 0),
        one(`SELECT COUNT(DISTINCT company) AS count FROM pesoadmin_job_posts WHERE status IN ('Open','Published') AND company IS NOT NULL AND company <> ''`, 0),
        one(`SELECT COUNT(*) AS count FROM referral_queue WHERE status = 'Approved'`, 0),
    ]);
    return {
        open_opportunities: Number(jobs) || 0,
        successful_hires: Number(hires) || 0,
        active_local_employers: Number(partners) || 0,
        referral_letters_issued: Number(referrals) || 0,
    };
}

/** Upcoming published events/announcements (banner omitted — the assistant only needs text). */
async function getUpcomingEvents({ limit } = {}) {
    const n = clampLimit(limit, 5, 5);
    let rows = [];
    try { rows = await eventRepository.listPublished({ scope: 'upcoming', limit: n }); }
    catch (e) { console.warn(`[publicAssistant] events skipped: ${e.message}`); }
    return {
        count: rows.length,
        events: rows.map((r) => ({
            title: r.title,
            type: r.event_type || 'event',
            date: r.event_date || null,
            venue: r.venue || null,
            time: [r.start_time, r.end_time].filter(Boolean).join(' – ') || null,
        })),
    };
}

function getOfficeContact() {
    return { ...OFFICE, message_us: OFFICE.facebook };
}

/**
 * The ONE allowlisted tool entry point — DATA tools only (navigation is derived on the
 * backend, not a model tool; see knowledge.deriveActions). Unknown names return an error
 * object (never throw) so the model gets a usable tool result and can recover gracefully.
 */
async function runTool(name, args = {}) {
    switch (name) {
        case 'search_vacancies': return searchVacancies(args);
        case 'get_vacancy_categories': return getVacancyCategories();
        case 'get_platform_stats': return getPlatformStats();
        case 'get_upcoming_events': return getUpcomingEvents(args);
        case 'get_office_contact': return getOfficeContact();
        default: return { error: `unknown tool: ${name}` };
    }
}

module.exports = {
    runTool,
    searchVacancies, getVacancyCategories, getPlatformStats, getUpcomingEvents, getOfficeContact,
};
