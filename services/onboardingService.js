/**
 * Post-registration onboarding / account-completion gate (2026-09).
 *
 * A job seeker must complete the mandatory identity + DOLE profile fields AND have a
 * résumé on file before they can APPLY to a vacancy (owner decision). The state is
 * DERIVED from the DB on every check — never a cached/bypassable flag — so it persists
 * across sessions and cannot be defeated by a refresh, logout, or reopening the app.
 * The `POST /applications` endpoint is the authoritative enforcement point behind the
 * disabled Apply button (business-logic layer, not merely a frontend step).
 *
 * Backward-compatible: no new column, no migration. It reads the SAME `users` columns
 * the existing `PUT /profile` already writes + the SAME `uploaded_resumes.parsed_text`
 * the AI scorer reads, so both newly-registered AND walk-in accounts fall through the
 * identical gate with no special-casing.
 *
 * RÉSUMÉ policy: optional to FINISH onboarding (reach the dashboard), but REQUIRED to
 * apply — so `profileComplete` and `canApply` are distinct.
 */

const db = require('../db');

// The mandatory identity + DOLE fields (owner decision, 2026-09): identity for the
// referral letter (name / phone / location-address) + DOLE demographic reporting
// (gender / dob / educational_attainment, §39). All are `users` columns writable via
// the existing PUT /profile. Skills, preferences, career goals stay OPTIONAL.
const REQUIRED_PROFILE_FIELDS = ['name', 'phone', 'location', 'gender', 'dob', 'educational_attainment'];

const FIELD_LABELS = {
	name: 'Full name',
	phone: 'Contact number',
	location: 'Address / location',
	gender: 'Sex',
	dob: 'Date of birth',
	educational_attainment: 'Educational attainment',
};

const isFilled = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const missingList = () => REQUIRED_PROFILE_FIELDS.map((k) => ({ key: k, label: FIELD_LABELS[k] }));

/**
 * Derive the account-completion state for one user.
 * @returns {Promise<{profileComplete:boolean, hasResume:boolean, canApply:boolean,
 *                     missing:{key:string,label:string}[], required:string[], error?:boolean}>}
 * On a DB error it returns `error:true` (indeterminate) so callers can fail OPEN for
 * the primary action rather than hard-blocking on a transient blip.
 */
async function evaluate(userId) {
	const base = { profileComplete: false, hasResume: false, canApply: false, missing: missingList(), required: REQUIRED_PROFILE_FIELDS };
	if (!userId) return base;
	try {
		const [rows] = await db.query(
			'SELECT name, phone, location, gender, dob, educational_attainment FROM users WHERE id = ? LIMIT 1',
			[userId]
		);
		const u = rows[0];
		if (!u) return base;

		const missing = REQUIRED_PROFILE_FIELDS.filter((f) => !isFilled(u[f])).map((k) => ({ key: k, label: FIELD_LABELS[k] }));
		const profileComplete = missing.length === 0;

		// A résumé is "on file" when uploaded_resumes holds extracted text. Both a PDF
		// upload AND a résumé-builder save sync into uploaded_resumes.parsed_text (§6),
		// and it is exactly what the AI scorer reads — the correct apply-readiness signal.
		let hasResume = false;
		try {
			const [r] = await db.query(
				"SELECT 1 FROM uploaded_resumes WHERE user_id = ? AND parsed_text IS NOT NULL AND TRIM(parsed_text) <> '' LIMIT 1",
				[userId]
			);
			hasResume = r.length > 0;
		} catch (_) { hasResume = false; }

		return { profileComplete, hasResume, canApply: profileComplete && hasResume, missing, required: REQUIRED_PROFILE_FIELDS };
	} catch (error) {
		console.error(`[Onboarding] evaluate failed for user ${userId}: ${error.message}`);
		return { ...base, error: true };
	}
}

module.exports = { evaluate, REQUIRED_PROFILE_FIELDS, FIELD_LABELS };
