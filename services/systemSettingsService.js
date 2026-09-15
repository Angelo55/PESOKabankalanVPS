/**
 * SYSTEM SETTINGS — runtime configuration a Super Administrator controls.
 *
 * WHAT: a typed, validated, cached key/value store over the system_settings
 * table (migration 025).
 *
 * ── RESOLUTION ORDER, ALWAYS ───────────────────────────────────────────────
 *   1. the database row, if an administrator has set one
 *   2. the environment variable
 *   3. the hardcoded default
 *
 * That order is what makes this migration a no-op until somebody deliberately
 * changes something: every setting keeps its current effective value, and
 * DELETING a row restores the previous behaviour rather than leaving you to
 * guess what the value used to be.
 *
 * ── WHY THERE IS A CACHE ───────────────────────────────────────────────────
 * `signupEnabled` is read on every registration attempt and
 * `referralAiThreshold` on every application. A database round trip per read
 * would put a query on two of the hottest paths in the system to fetch a value
 * that changes a few times a year. The cache is invalidated on write, and has a
 * short TTL so a second server instance picks up a change without a restart.
 *
 * ── VALIDATION LIVES HERE, NOT IN THE ROUTE ────────────────────────────────
 * setting_value is TEXT, so the database will accept anything. A threshold of
 * "abc" would silently become NaN and every application would compare false —
 * the referral queue would simply stop filling, with no error anywhere. Each
 * definition below therefore carries its own parse and validate step, and an
 * invalid write is refused with a message an administrator can act on.
 */

const db = require('../db');

class SettingsError extends Error {
	constructor(status, message) {
		super(message);
		this.name = 'SettingsError';
		this.status = status;
	}
}

const asInt = (raw) => {
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
};

/**
 * The catalogue. Adding a setting means adding an entry here and nothing else —
 * the endpoints, validation and UI all read from this.
 *
 * `envVar` is the fallback source. `label` and `help` are what the Super Admin
 * screen renders, so they are written for a non-technical reader.
 */
const DEFINITIONS = {
	referral_ai_threshold: {
		label: 'AI referral threshold',
		help: 'Minimum AI match score before an applicant is auto-suggested for referral review. Default 60. Bounded 50–80 to protect recommendation quality — improve staging SPEED via the background workers, not by lowering this bar.',
		type: 'number',
		unit: '%',
		envVar: 'REFERRAL_AI_THRESHOLD',
		fallback: 60,
		parse: asInt,
		// Bounded 50–80 (not 0–100): the threshold guards recommendation quality, so
		// an administrator cannot quietly flood the queue with low-confidence matches
		// or set it so high nothing ever qualifies. A stored value outside this range
		// is ignored and the 60 default applies (see get()).
		validate: (v) => (v >= 50 && v <= 80 ? null : 'Enter a value between 50 and 80. This bar protects recommendation quality; make staging faster via the workers instead of lowering it.'),
	},
	signup_enabled: {
		label: 'Allow new registrations',
		help: 'Turn off to temporarily stop new job seekers from creating accounts. Existing accounts are unaffected.',
		type: 'boolean',
		envVar: null,
		fallback: true,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	allowed_signup_domains: {
		label: 'Restrict signup email domains',
		help: 'Comma-separated, e.g. "gmail.com". Leave blank to accept any email address.',
		type: 'string',
		envVar: 'ALLOWED_SIGNUP_EMAIL_DOMAINS',
		fallback: '',
		parse: (raw) => String(raw ?? '').trim(),
		validate: (v) => (v.length <= 500 ? null : 'That is too long.'),
	},
	otp_ttl_minutes: {
		label: 'Verification code lifetime',
		help: 'How long a signup verification code stays valid.',
		type: 'number',
		unit: 'minutes',
		envVar: 'OTP_TTL_MINUTES',
		fallback: 10,
		parse: asInt,
		validate: (v) => (v >= 3 && v <= 60 ? null : 'Enter between 3 and 60 minutes.'),
	},
	notification_digest_enabled: {
		label: 'Daily notification digest',
		help: 'Email each user a once-a-day summary of their unread notifications. Off by default; rides the durable email outbox.',
		type: 'boolean',
		envVar: null,
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	job_alert_ai_threshold: {
		label: 'Job-alert AI threshold',
		help: 'Minimum AI match score before a seeker is alerted about a new vacancy. Higher = fewer, stronger alerts.',
		type: 'number',
		unit: '%',
		envVar: 'JOB_ALERT_AI_THRESHOLD',
		fallback: 70,
		parse: asInt,
		validate: (v) => (v >= 0 && v <= 100 ? null : 'Enter a number between 0 and 100.'),
	},
	job_alert_max_per_day: {
		label: 'Job-alert daily cap per seeker',
		help: 'Maximum immediate job-alert emails a single seeker can receive per day (the digest is unaffected).',
		type: 'number',
		envVar: 'JOB_ALERT_MAX_PER_DAY',
		fallback: 5,
		parse: asInt,
		validate: (v) => (v >= 0 && v <= 50 ? null : 'Enter between 0 and 50.'),
	},
	job_alert_candidate_cap: {
		label: 'Job-alert candidate cap',
		help: 'Maximum seekers AI-scored per newly published vacancy. Bounds the AI cost of matching.',
		type: 'number',
		envVar: 'JOB_ALERT_CANDIDATE_CAP',
		fallback: 50,
		parse: asInt,
		validate: (v) => (v >= 1 && v <= 500 ? null : 'Enter between 1 and 500.'),
	},
	job_alert_default_frequency: {
		label: 'Job-alert default frequency',
		help: 'How new seekers receive alerts until they choose otherwise: "immediate", "daily" (a once-a-day digest), or "off".',
		type: 'string',
		envVar: null,
		fallback: 'daily',
		parse: (raw) => String(raw ?? '').trim().toLowerCase(),
		validate: (v) => (['immediate', 'daily', 'off'].includes(v) ? null : 'Use immediate, daily, or off.'),
	},
	proactive_referral_threshold: {
		label: 'Proactive referral AI threshold',
		help: 'Minimum AI match score before an existing applicant is surfaced in the Smart Referral Queue for a vacancy they did not apply to. Set higher than the ordinary referral threshold — a proactive referral is a government action, so the bar is deliberately strict. Default 75.',
		type: 'number',
		unit: '%',
		envVar: 'PROACTIVE_REFERRAL_THRESHOLD',
		fallback: 75,
		parse: asInt,
		validate: (v) => (v >= 50 && v <= 95 ? null : 'Enter a value between 50 and 95. Keep this bar strict — a proactive referral is issued on the seeker\'s behalf.'),
	},
	proactive_candidate_cap: {
		label: 'Proactive referral candidate cap',
		help: 'Maximum existing applicants AI-scored per vacancy when building the Smart Referral Queue. Bounds the AI cost of proactive matching.',
		type: 'number',
		envVar: 'PROACTIVE_CANDIDATE_CAP',
		fallback: 50,
		parse: asInt,
		validate: (v) => (v >= 1 && v <= 500 ? null : 'Enter between 1 and 500.'),
	},
	referral_lifecycle_sync_enabled: {
		label: 'Synchronized referral lifecycle',
		help: 'Turns on the end-to-end referral-outcome sync: the seeker sees the real outcome in My Referrals, is notified of every change, can report an outcome they heard from the employer (a suggestion an administrator confirms — it never counts until then), and both sides stay in step in real time. Off by default; flip on when validated. A seeker suggestion NEVER enters the official placement statistics until an administrator confirms it.',
		type: 'boolean',
		// Runtime flag with an env fallback (REFERRAL_LIFECYCLE_SYNC_ENABLED) so it
		// can ship dark on Render and be flipped from the Super Admin settings screen
		// without a redeploy. Read PER CALL (§7.12) — never captured at module load.
		envVar: 'REFERRAL_LIFECYCLE_SYNC_ENABLED',
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	referral_acceptance_enabled: {
		label: 'Job Seeker referral acceptance',
		help: 'When ON, a PESO "refer" ENDORSES the applicant and the official letter is issued only after the Job Seeker reviews the referral and ACCEPTS it (they may also decline). When OFF, approval is immediate exactly as before. Off by default; flip on when validated.',
		type: 'boolean',
		envVar: 'REFERRAL_ACCEPTANCE_ENABLED',
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	vacancy_manual_fill_enabled: {
		label: 'PESO-verified vacancy closure',
		help: 'When ON, a vacancy is marked Filled ONLY when PESO confirms it (via the job status) — never automatically from the referral count — so the office can keep referring while the employer is still hiring. When OFF, a vacancy auto-fills once its stated positions are all referred. Off by default.',
		type: 'boolean',
		envVar: 'VACANCY_MANUAL_FILL_ENABLED',
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	walk_in_registration_enabled: {
		label: 'Walk-In applicant registration',
		help: 'When ON, PESO staff can encode applicants who visit the office in person (no online account) into the Job Seeker records, with a claim code so the applicant can claim the account later. Manager access only. Off by default.',
		type: 'boolean',
		envVar: 'WALK_IN_REGISTRATION_ENABLED',
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
	sms_notifications_enabled: {
		label: 'SMS notifications',
		help: 'When ON, referral events (referral issued / endorsed) also send an SMS to Job Seekers who have VERIFIED their mobile number and opted in — reaching walk-in and rural seekers who have no email. In-app + email delivery are unchanged. Requires an SMS provider to be configured (SMS_PROVIDER + its key); off, or with no provider, nothing is texted. Off by default.',
		type: 'boolean',
		envVar: 'SMS_NOTIFICATIONS_ENABLED',
		fallback: false,
		parse: (raw) => raw === true || raw === 'true' || raw === '1' || raw === 1,
		validate: () => null,
	},
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cache = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

function invalidate() {
	cache = null;
	cachedAt = 0;
}

async function loadRows() {
	if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

	try {
		const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
		cache = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
		cachedAt = Date.now();
	} catch (error) {
		// Table missing (migration 025 not yet applied) or database unreachable.
		// Fall back to env + defaults rather than breaking registration and
		// application scoring, which is what reads these.
		console.warn('[Settings] Falling back to environment defaults:', error.message);
		cache = {};
		cachedAt = Date.now();
	}

	return cache;
}

/** Effective value of one setting, following the resolution order. */
async function get(key) {
	const def = DEFINITIONS[key];
	if (!def) throw new SettingsError(400, `Unknown setting: ${key}`);

	const rows = await loadRows();

	if (rows[key] !== undefined && rows[key] !== null) {
		const parsed = def.parse(rows[key]);
		if (parsed !== null && !def.validate(parsed)) return parsed;
		// A stored value that no longer validates is ignored rather than trusted.
		console.warn(`[Settings] Stored value for ${key} is invalid; using fallback.`);
	}

	if (def.envVar && process.env[def.envVar] !== undefined) {
		const parsed = def.parse(process.env[def.envVar]);
		if (parsed !== null && !def.validate(parsed)) return parsed;
	}

	return def.fallback;
}

/** Every setting with its effective value and metadata, for the settings screen. */
async function getAll() {
	const rows = await loadRows();

	return Promise.all(
		Object.entries(DEFINITIONS).map(async ([key, def]) => ({
			key,
			label: def.label,
			help: def.help,
			type: def.type,
			unit: def.unit || null,
			value: await get(key),
			// Lets the UI say "using the system default" versus "set by an
			// administrator", so nobody wonders whether a blank field is applied.
			isOverridden: rows[key] !== undefined && rows[key] !== null,
			fallback: def.fallback,
		}))
	);
}

/** Validates and stores one setting. Returns the new effective value. */
async function set(key, rawValue, adminId) {
	const def = DEFINITIONS[key];
	if (!def) throw new SettingsError(400, `Unknown setting: ${key}`);

	const parsed = def.parse(rawValue);
	if (parsed === null) throw new SettingsError(400, `${def.label}: that value is not valid.`);

	const problem = def.validate(parsed);
	if (problem) throw new SettingsError(400, `${def.label}: ${problem}`);

	await db.query(`
		INSERT INTO system_settings (setting_key, setting_value, updated_by)
		VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)
	`, [key, String(parsed), adminId || null]);

	invalidate();
	return get(key);
}

/** Removes an override, restoring the environment/default value. */
async function reset(key) {
	if (!DEFINITIONS[key]) throw new SettingsError(400, `Unknown setting: ${key}`);
	await db.query('DELETE FROM system_settings WHERE setting_key = ?', [key]);
	invalidate();
	return get(key);
}

module.exports = { get, getAll, set, reset, invalidate, DEFINITIONS, SettingsError };
