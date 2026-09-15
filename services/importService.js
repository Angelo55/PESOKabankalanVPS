/**
 * importService — the "Import Past Applications" data pipeline (Phase B of
 * docs/data-processing-modules-proposal.md).
 *
 * Deterministic (no AI): parse CSV/XLSX → resolve columns → normalize rows → validate →
 * dedupe (within the file AND against the user's existing tracked applications) → return a
 * preview summary; then commit ONLY the valid, non-duplicate rows into `usertrackedjobs`
 * inside one transaction, recording an `import_batches` audit row for idempotency + history.
 *
 * The BACKEND is authoritative: `commit` re-parses/re-validates/re-dedupes and never trusts
 * a client blob. Limits (file size, rows, per-day, per-user total) are enforced here.
 *
 * Reuses the existing `xlsx` (SheetJS) dependency and the existing `usertrackedjobs` table —
 * no parallel storage, no raw-CSV retention.
 */
const XLSX = require('xlsx');
const pool = require('../db');
const { LIMITS: QUOTAS } = require('../config/quotas');

// Numbers are defined ONCE in config/quotas.js (the quota catalogue); this keeps
// the enforcement in lockstep with the /usage indicators. Shape unchanged so
// existing references (importService.LIMITS.MAX_FILE_BYTES, …) keep working.
const LIMITS = Object.freeze({
    MAX_FILE_BYTES: QUOTAS.IMPORT_FILE_BYTES,     // 2 MB
    MAX_ROWS: QUOTAS.IMPORT_ROWS,                 // per import
    MAX_IMPORTS_PER_DAY: QUOTAS.IMPORTS_PER_DAY,  // per user / 24h
    MAX_TOTAL_TRACKED: QUOTAS.TRACKED_APPLICATIONS, // active usertrackedjobs per user
});

// Incoming header (normalized) → canonical field. First match wins.
const HEADER_SYNONYMS = {
    company: ['company', 'employer', 'company name', 'organization', 'organisation'],
    job_title: ['job title', 'title', 'position', 'role', 'job', 'job role'],
    date_applied: ['date applied', 'applied on', 'applied', 'date', 'application date', 'applied date'],
    status: ['status', 'stage', 'application status', 'application stage'],
    job_type: ['job type', 'type', 'employment type', 'work type'],
    work_setup: ['work setup', 'setup', 'location type', 'arrangement', 'work arrangement'],
    application_source: ['source', 'application source', 'platform', 'via', 'applied via', 'job board'],
    link: ['link', 'url', 'job link', 'posting', 'posting url', 'job url'],
    notes: ['notes', 'note', 'remarks', 'comments', 'comment'],
    expected_salary: ['expected salary', 'salary', 'desired salary', 'salary expectation'],
    industry: ['industry', 'sector', 'field'],
};

// Canonicalize a free-text status to the app's tracked-application set.
const STATUS_CANON = {
    applied: 'Applied', 'to apply': 'Applied', wishlist: 'Applied',
    'under review': 'Under Review', reviewing: 'Under Review', review: 'Under Review', 'in review': 'Under Review', screening: 'Under Review',
    interview: 'Interview', interviewing: 'Interview', 'interview scheduled': 'Interview',
    shortlisted: 'Shortlisted', 'short listed': 'Shortlisted',
    rejected: 'Rejected', declined: 'Rejected', 'not selected': 'Rejected', unsuccessful: 'Rejected', withdrawn: 'Rejected',
    accepted: 'Accepted', offer: 'Accepted', offered: 'Accepted', hired: 'Accepted', 'offer accepted': 'Accepted',
};
const DEFAULT_STATUS = 'Applied';

const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

// Build a { canonicalField: sourceHeaderKey } map from the sheet's headers.
function resolveColumns(headerKeys) {
    const normalized = headerKeys.map((k) => ({ raw: k, norm: normHeader(k) }));
    const resolver = {};
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        const hit = normalized.find((h) => synonyms.includes(h.norm));
        if (hit) resolver[field] = hit.raw;
    }
    return resolver;
}

// Format a Date as YYYY-MM-DD using LOCAL components — NEVER toISOString(), which shifts to
// UTC and lands a day early for UTC+8 (Philippines). date_applied is a display-only varchar.
const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Coerce many date shapes to YYYY-MM-DD; returns '' if blank, null if unparseable.
function coerceDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : fmtLocalDate(value);
    const s = String(value ?? '').trim();
    if (!s) return '';
    // Already ISO-ish (Y-M-D) → take the parts verbatim (no Date round-trip, no tz shift).
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1970 && d.getFullYear() < 2100) {
        return fmtLocalDate(d);
    }
    return null; // present but unparseable → row warning
}

function canonStatus(value) {
    const s = normHeader(value);
    if (!s) return { status: DEFAULT_STATUS, defaulted: true };
    if (STATUS_CANON[s]) return { status: STATUS_CANON[s], defaulted: false };
    return { status: DEFAULT_STATUS, defaulted: true };
}

const clip = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/** Parse a CSV/XLSX buffer → array of plain-object rows (SheetJS handles both). */
function parseBuffer(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
}

const dedupeKey = (r) => `${(r.company || '').toLowerCase()}|${(r.job_title || '').toLowerCase()}|${r.date_applied || ''}`;

function normalizeRow(raw, resolver) {
    const get = (field) => (resolver[field] ? raw[resolver[field]] : '');
    const dateRaw = get('date_applied');
    const date = coerceDate(dateRaw);
    const { status, defaulted } = canonStatus(get('status'));
    const warnings = [];
    if (date === null) warnings.push(`Unreadable date "${String(dateRaw).slice(0, 20)}" — left blank`);
    if (defaulted && String(get('status')).trim()) warnings.push(`Unknown status "${String(get('status')).slice(0, 20)}" — set to Applied`);
    return {
        row: {
            company: clip(get('company'), 255),
            job_title: clip(get('job_title'), 255),
            job_type: clip(get('job_type'), 100),
            date_applied: date === null ? '' : date,
            status,
            work_setup: clip(get('work_setup'), 50),
            application_source: clip(get('application_source'), 100),
            industry: clip(get('industry'), 100),
            expected_salary: clip(get('expected_salary'), 100),
            link: clip(get('link'), 2000),
            notes: clip(get('notes'), 2000),
        },
        warnings,
    };
}

/** Existing dedupe keys for a user's active tracked applications. */
async function existingKeys(userId, conn = pool) {
    const [rows] = await conn.query(
        `SELECT company, job_title, date_applied FROM usertrackedjobs WHERE user_id = ? AND deleted_at IS NULL`,
        [userId]
    );
    const set = new Set();
    for (const r of rows) set.add(dedupeKey({ company: r.company, job_title: r.job_title, date_applied: r.date_applied || '' }));
    return { set, count: rows.length };
}

class ImportError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

/**
 * Validate + preview an uploaded buffer. Read-only. Returns the summary + the valid rows
 * (the client shows them and passes them back to commit; commit re-checks authoritatively).
 */
async function preview({ userId, buffer, fileName }) {
    if (!buffer || !buffer.length) throw new ImportError(400, 'The file is empty.');
    if (buffer.length > LIMITS.MAX_FILE_BYTES) throw new ImportError(413, 'The file is too large (max 2 MB).');

    let rawRows;
    try { rawRows = parseBuffer(buffer); }
    catch { throw new ImportError(422, 'Could not read that file. Please upload a valid .csv or .xlsx.'); }

    if (!rawRows.length) throw new ImportError(422, 'No rows found in the file.');
    if (rawRows.length > LIMITS.MAX_ROWS) {
        throw new ImportError(422, `Too many rows (${rawRows.length}). Import up to ${LIMITS.MAX_ROWS} at a time.`);
    }

    const resolver = resolveColumns(Object.keys(rawRows[0] || {}));
    if (!resolver.company || !resolver.job_title) {
        throw new ImportError(422, 'Could not find a Company and a Job Title column. Include at least those two.');
    }

    const { set: existing, count: existingCount } = await existingKeys(userId);
    const seen = new Set();
    const valid = [];
    const invalid = [];
    const duplicates = [];

    rawRows.forEach((raw, i) => {
        const line = i + 2; // 1-based + header row
        const { row, warnings } = normalizeRow(raw, resolver);
        if (!row.company || !row.job_title) {
            invalid.push({ line, reasons: [!row.company && 'Missing company', !row.job_title && 'Missing job title'].filter(Boolean) });
            return;
        }
        const key = dedupeKey(row);
        if (existing.has(key) || seen.has(key)) { duplicates.push({ line, company: row.company, job_title: row.job_title }); return; }
        seen.add(key);
        valid.push({ ...row, _warnings: warnings });
    });

    const remainingCapacity = Math.max(0, LIMITS.MAX_TOTAL_TRACKED - existingCount);
    const willImport = Math.min(valid.length, remainingCapacity);
    const cappedOut = valid.length - willImport;

    return {
        summary: {
            totalRows: rawRows.length,
            valid: valid.length,
            duplicates: duplicates.length,
            invalid: invalid.length,
            willImport,
            cappedOut,
            existingCount,
            capacity: LIMITS.MAX_TOTAL_TRACKED,
        },
        rows: valid.slice(0, willImport),      // only rows that fit the cap
        invalidSample: invalid.slice(0, 20),
        duplicateSample: duplicates.slice(0, 20),
    };
}

/**
 * Commit confirmed rows. Idempotent on (user_id, import_id). Re-validates + re-dedupes
 * against CURRENT data, enforces the daily + total limits, inserts in one transaction, and
 * records the batch. `rows` come from a preview but are never trusted blindly.
 */
async function commit({ userId, importId, fileName, rows }) {
    if (!importId || typeof importId !== 'string') throw new ImportError(400, 'Missing import id.');
    if (!Array.isArray(rows)) throw new ImportError(400, 'No rows to import.');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Idempotency: a prior commit of this import_id returns its recorded summary.
        const [[prior]] = await conn.query(
            `SELECT total_rows, valid_rows, duplicate_rows, invalid_rows, imported_rows
               FROM import_batches WHERE user_id = ? AND import_id = ? LIMIT 1`,
            [userId, importId]
        );
        if (prior) {
            await conn.commit();
            return { alreadyImported: true, imported: prior.imported_rows, summary: prior };
        }

        // Daily rate limit.
        const [[rate]] = await conn.query(
            `SELECT COUNT(*) AS n FROM import_batches WHERE user_id = ? AND created_at >= (NOW() - INTERVAL 1 DAY)`,
            [userId]
        );
        if (rate.n >= LIMITS.MAX_IMPORTS_PER_DAY) {
            throw new ImportError(429, `Daily import limit reached (${LIMITS.MAX_IMPORTS_PER_DAY}/day). Try again tomorrow.`);
        }

        // Re-dedupe against current data (FOR UPDATE would be heavy; a fresh read is enough
        // because the unique (user_id, import_id) guards the batch itself).
        const { set: existing, count: existingCount } = await existingKeys(userId, conn);
        let capacity = Math.max(0, LIMITS.MAX_TOTAL_TRACKED - existingCount);

        const seen = new Set();
        const toInsert = [];
        for (const r of rows) {
            const company = clip(r.company, 255);
            const job_title = clip(r.job_title, 255);
            if (!company || !job_title) continue;
            const norm = {
                company, job_title,
                job_type: clip(r.job_type, 100),
                date_applied: clip(r.date_applied, 50) || '',
                status: clip(r.status, 50) || DEFAULT_STATUS,
                work_setup: clip(r.work_setup, 50),
                application_source: clip(r.application_source, 100),
                industry: clip(r.industry, 100),
                expected_salary: clip(r.expected_salary, 100),
                link: clip(r.link, 2000),
                notes: clip(r.notes, 2000),
            };
            const key = dedupeKey(norm);
            if (existing.has(key) || seen.has(key)) continue;
            if (capacity <= 0) break;
            seen.add(key); capacity -= 1;
            toInsert.push(norm);
        }

        for (const r of toInsert) {
            await conn.query(
                `INSERT INTO usertrackedjobs
                    (user_id, company, job_title, job_type, date_applied, status, link, notes,
                     work_setup, industry, application_source, expected_salary)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, r.company, r.job_title, r.job_type, r.date_applied, r.status, r.link, r.notes,
                    r.work_setup, r.industry, r.application_source, r.expected_salary]
            );
        }

        await conn.query(
            `INSERT INTO import_batches
                (user_id, import_id, file_name, total_rows, valid_rows, duplicate_rows, invalid_rows, imported_rows)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, importId, clip(fileName, 255), rows.length, rows.length, 0, 0, toInsert.length]
        );

        await conn.commit();
        return { alreadyImported: false, imported: toInsert.length };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

module.exports = { preview, commit, LIMITS, ImportError };
