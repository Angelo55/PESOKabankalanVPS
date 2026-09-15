/**
 * Centralized quota & usage catalogue — the SINGLE source of truth for every
 * usage limit surfaced in the UI and enforced at the API (task: "usage/limit
 * indicator system"). A number is defined ONCE here and consumed by:
 *   - the enforcement modules (importService, certificatesRepository, messageRoutes)
 *     via the flat CONSTANTS below, so a cap can't drift between code paths;
 *   - services/usageService.js, which attaches live per-user usage to each entry;
 *   - GET /api/usage and GET /api/peso-admin/usage;
 *   - the frontend indicators (hooks/useUsage.js + components/common/UsageMeter).
 *
 * DESIGN (owner decisions, 2026-09):
 *   - Informational-only for resources that have NO limit today (job applications,
 *     saved vacancies, admin vacancies/referrals/events/applicants). We NEVER newly
 *     block a primary action (invariant 0.1); those show a live count with max=null.
 *   - The storage figure is an informational SOFT-WARN meter (aggregate base64
 *     footprint). It warns as it grows but never blocks an upload — a résumé needed
 *     to apply can never be refused by a storage cap.
 *   - Only limits that ALREADY exist and are already enforced carry `enforced:true`
 *     and a `blocked` state (imports/day, 1000 tracked, cert library, pins, sizes).
 *
 * FOUR distinct axes (never conflated into one generic "storage" number):
 *   type:'count'      running record count (used/max; max=null ⇒ informational).
 *   type:'bytes'      running storage footprint (used bytes vs a soft threshold).
 *   type:'rate'       per-window operation count (e.g. imports/day).
 *   type:'processing' a per-operation ceiling (file size / row count) — a reference
 *                     max, NOT a running total (`used` is null).
 */

const MB = 1024 * 1024;

// ── Flat CONSTANTS (the authoritative numbers; enforcement modules import these) ──
const LIMITS = {
	// Import Past Applications (services/importService.js)
	IMPORT_FILE_BYTES: 2 * MB,
	IMPORT_ROWS: 500,
	IMPORTS_PER_DAY: 5,
	TRACKED_APPLICATIONS: 1000, // active usertrackedjobs per user (Trash-excluded)

	// Supporting certificates (repositories/certificatesRepository.js)
	CERTIFICATE_FILE_BYTES: 5 * MB,
	CERTIFICATES_PER_APPLICATION: 8,
	CERTIFICATE_LIBRARY: 30,

	// Résumé + avatar uploads (routes/resumeRoutes.js, routes/profileRoutes.js)
	RESUME_FILE_BYTES: 5 * MB,
	AVATAR_DATA_URI_CHARS: 700000,

	// PESO Admin uploads (routes/pesoAdminRoutes.js, routes/eventRoutes.js)
	JOB_IMAGE_BYTES: 8 * MB,
	EVENT_BANNER_CHARS: 3_000_000,

	// Messaging (routes/messageRoutes.js) — applies to seekers AND admins
	PINNED_CONVERSATIONS: 5,

	// Storage soft-warn threshold (informational only — never blocks)
	STORAGE_SOFT_BYTES: 50 * MB,
};

const DEFAULT_WARN_RATIO = 0.85;

/**
 * The catalogue. Each entry is STATIC metadata; live `used`/`state` are attached
 * per user by usageService.evaluate(). `scope` gates which /usage endpoint returns it.
 */
const RESOURCES = [
	// ───────────────────────── Job Seeker ─────────────────────────
	{
		key: 'peso_applications', scope: 'seeker', category: 'Records', type: 'count',
		label: 'Job Applications', unit: 'applications', max: null, enforced: false,
		help: 'PESO job applications you have submitted. No limit.',
	},
	{
		key: 'tracked_applications', scope: 'seeker', category: 'Records', type: 'count',
		label: 'Tracked Applications', unit: 'records', max: LIMITS.TRACKED_APPLICATIONS,
		warnRatio: DEFAULT_WARN_RATIO, enforced: true, trashAware: true,
		help: 'Applications you track (added or imported). Items in Trash do not count until purged.',
	},
	{
		key: 'saved_vacancies', scope: 'seeker', category: 'Records', type: 'count',
		label: 'Saved Vacancies', unit: 'saved', max: null, enforced: false, trashAware: true,
		help: 'Vacancies you have bookmarked. No limit.',
	},
	{
		key: 'active_referrals', scope: 'seeker', category: 'Records', type: 'count',
		label: 'My Referrals', unit: 'referrals', max: null, enforced: false,
		help: 'Referrals PESO has issued or endorsed for you. No limit.',
	},
	{
		key: 'certificate_library', scope: 'seeker', category: 'Records', type: 'count',
		label: 'Certificate Library', unit: 'certificates', max: LIMITS.CERTIFICATE_LIBRARY,
		warnRatio: DEFAULT_WARN_RATIO, enforced: true,
		help: `Certificates saved to your portfolio (max ${LIMITS.CERTIFICATE_LIBRARY}).`,
	},
	{
		key: 'imports_daily', scope: 'seeker', category: 'Requests', type: 'rate',
		label: 'Imports Today', unit: 'imports', window: 'day', max: LIMITS.IMPORTS_PER_DAY,
		warnRatio: DEFAULT_WARN_RATIO, enforced: true,
		help: `Application imports allowed per day (max ${LIMITS.IMPORTS_PER_DAY}). Resets daily.`,
	},
	{
		key: 'stored_data', scope: 'seeker', category: 'Storage', type: 'bytes',
		label: 'Stored Data', unit: 'bytes', max: LIMITS.STORAGE_SOFT_BYTES,
		warnRatio: 0.8, enforced: false, soft: true,
		help: 'Approximate database footprint of your résumé snapshots, certificates, and avatar. A guideline, not a hard cap.',
	},

	// Per-operation upload ceilings (reference maxes — no running usage).
	{
		key: 'resume_upload', scope: 'seeker', category: 'Uploads', type: 'processing',
		label: 'Résumé Upload', unit: 'bytes', max: LIMITS.RESUME_FILE_BYTES, enforced: true,
		help: 'Maximum size of a résumé file (PDF or DOCX).',
	},
	{
		key: 'import_file', scope: 'seeker', category: 'Uploads', type: 'processing',
		label: 'Import File', unit: 'bytes', max: LIMITS.IMPORT_FILE_BYTES, enforced: true,
		secondary: { label: 'Rows per import', value: LIMITS.IMPORT_ROWS, unit: 'rows' },
		help: `Maximum size of an import file (CSV/XLSX), up to ${LIMITS.IMPORT_ROWS} rows.`,
	},
	{
		key: 'certificate_file', scope: 'seeker', category: 'Uploads', type: 'processing',
		label: 'Certificate File', unit: 'bytes', max: LIMITS.CERTIFICATE_FILE_BYTES, enforced: true,
		secondary: { label: 'Per application', value: LIMITS.CERTIFICATES_PER_APPLICATION, unit: 'files' },
		help: `Maximum size per certificate (up to ${LIMITS.CERTIFICATES_PER_APPLICATION} per application).`,
	},

	// ───────────────────────── PESO Admin ─────────────────────────
	{
		key: 'vacancies', scope: 'admin', category: 'Records', type: 'count',
		label: 'Vacancies Posted', unit: 'vacancies', max: null, enforced: false,
		help: 'Job vacancies published by your office. No limit — posting is never restricted.',
	},
	{
		key: 'referrals_issued', scope: 'admin', category: 'Records', type: 'count',
		label: 'Referrals Issued', unit: 'referrals', max: null, enforced: false,
		help: 'Approved referrals for your vacancies. No limit.',
	},
	{
		key: 'events', scope: 'admin', category: 'Records', type: 'count',
		label: 'Events & Job Fairs', unit: 'events', max: null, enforced: false,
		help: 'Events and announcements your office has created. No limit.',
	},
	{
		key: 'applicant_records', scope: 'admin', category: 'Records', type: 'count',
		label: 'Applicant Records', unit: 'applicants', max: null, enforced: false,
		help: 'Applications received across your vacancies. No limit.',
	},

	// Uploads (reference maxes)
	{
		key: 'job_image', scope: 'admin', category: 'Uploads', type: 'processing',
		label: 'Job Featured Image', unit: 'bytes', max: LIMITS.JOB_IMAGE_BYTES, enforced: true,
		help: 'Maximum size of a vacancy featured image (JPG/PNG/WEBP).',
	},
	{
		key: 'event_banner', scope: 'admin', category: 'Uploads', type: 'processing',
		label: 'Event Banner', unit: 'bytes', max: LIMITS.EVENT_BANNER_CHARS, enforced: true, approxBytes: true,
		help: 'Maximum size of an event banner image.',
	},

	// ───────────────────────── Both ─────────────────────────
	{
		key: 'pinned_conversations', scope: 'both', category: 'Records', type: 'count',
		label: 'Pinned Conversations', unit: 'pins', max: LIMITS.PINNED_CONVERSATIONS,
		warnRatio: 1, enforced: true,
		help: `Conversations you can pin to the top (max ${LIMITS.PINNED_CONVERSATIONS}).`,
	},
];

const RESOURCE_BY_KEY = RESOURCES.reduce((m, r) => { m[r.key] = r; return m; }, {});

function resourcesForScope(scope) {
	return RESOURCES.filter((r) => r.scope === scope || r.scope === 'both');
}

/**
 * Derive a display state for a resource given its live usage.
 *   'reference' — a per-operation ceiling with no running usage (processing type).
 *   'unlimited' — informational, no cap (max == null).
 *   'blocked'   — an ENFORCED cap that is reached (used >= max). Only enforced limits block.
 *   'warn'      — at/over the warn threshold (or at/over an informational soft cap).
 *   'normal'    — below the warn threshold.
 */
function evaluateState(resource, used) {
	if (resource.type === 'processing') return 'reference';
	if (resource.max == null) return 'unlimited';
	const max = resource.max;
	const warnRatio = resource.warnRatio ?? DEFAULT_WARN_RATIO;
	if (resource.enforced && used >= max) return 'blocked';
	if (used >= max * warnRatio) return 'warn';
	return 'normal';
}

module.exports = {
	MB,
	LIMITS,
	DEFAULT_WARN_RATIO,
	RESOURCES,
	RESOURCE_BY_KEY,
	resourcesForScope,
	evaluateState,
};
