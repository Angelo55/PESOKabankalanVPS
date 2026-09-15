const pool = require('../db');
const certificatesRepository = require('../repositories/certificatesRepository');

/**
 * Unified Applicant Profile (Enhancement A).
 *
 * Composes ONE owner-scoped view of an applicant for the PESO Administrator's
 * pipeline — so a reviewer sees the whole person (submitted package + live
 * profile + AI results) from a single request instead of stitching five screens.
 *
 * ── SNAPSHOT vs LIVE (the design contract) ──────────────────────────────────
 * An application is a SUBMITTED PACKAGE. The `applicant_snapshot` (personal info
 * as typed in the Apply Wizard), the per-application `ai_analysis` (compatibility
 * at apply time), `match_score`, and the resume in application_resumes are the
 * IMMUTABLE record of what the applicant actually applied with. The broader
 * `profile` block is the applicant's CURRENT profile and is labelled as such in
 * the UI, so a reviewer is never misled about what was submitted.
 *
 * ── OWNER-SCOPED (invariant §12) ────────────────────────────────────────────
 * Authorization is expressed as a JOIN: an administrator can only load an
 * applicant to a job THEY published. A stranger's application returns null → 404,
 * never disclosing that it exists.
 *
 * ── userprofiles (invariant 0.8) ────────────────────────────────────────────
 * userprofiles can hold MULTIPLE rows per user. We never blind-join it; we pick
 * the single RICHEST row with the exact deterministic ordering the profile GET
 * uses, so the AI resume analysis can't silently read from the wrong row.
 *
 * ── No base64 in the aggregate ──────────────────────────────────────────────
 * Documents are listed as metadata + a stream URL; the bytes are fetched on
 * demand through the existing owner-scoped resume route (a bearer token can't
 * ride window.open, so the client blob-fetches). Never ship megabytes of base64
 * inside this JSON.
 */

/** Parse a JSON column defensively — a malformed blob yields null, never a throw. */
function safeParse(value) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'object') return value;
	try { return JSON.parse(value); } catch { return null; }
}

async function getApplicantProfile(applicationId, employerId, conn = pool) {
	// 1. Application record + ownership, in one query. No row = not owned/not found.
	const [appRows] = await conn.query(`
		SELECT
			ja.id AS application_id, ja.job_id, ja.applicant_id, ja.status,
			ja.match_score, ja.ai_analysis, ja.ai_scored_at, ja.applied_at,
			ja.current_match_score, ja.current_ai_analysis, ja.scored_at,
			ja.applicant_snapshot,
			pj.title AS job_title, pj.company AS company_name,
			EXISTS(SELECT 1 FROM application_resumes ar WHERE ar.application_id = ja.id) AS has_resume
		FROM job_applications ja
		JOIN pesoadmin_job_posts pj ON pj.id = ja.job_id
		WHERE ja.id = ? AND pj.peso_admin_id = ?
	`, [applicationId, employerId]);

	if (appRows.length === 0) return null;
	const app = appRows[0];

	// 2. Live profile from users.
	const [userRows] = await conn.query(`
		SELECT id, name, email, phone, location, gender, dob, availability,
		       educational_attainment, languages, skills, preferred_roles,
		       experience_level, career_goals,
		       COALESCE(avatar_thumb, avatar_url) AS avatar_url, created_at
		FROM users WHERE id = ?
	`, [app.applicant_id]);
	const user = userRows[0] || {};

	// 3. userprofiles RICHEST row (invariant 0.8) — AI resume analysis lives here.
	const [profRows] = await conn.query(`
		SELECT skills, preferred_roles, experience_level, career_goals,
		       ai_profile_data, ai_insights_data, is_ai_profile_visible
		FROM userprofiles
		WHERE user_id = ?
		ORDER BY (ai_profile_data IS NOT NULL) DESC,
		         (ai_insights_data IS NOT NULL) DESC,
		         CHAR_LENGTH(COALESCE(ai_profile_data, '')) DESC
		LIMIT 1
	`, [app.applicant_id]);
	const prof = profRows[0] || {};

	// Supporting certificates (Enhancement C) — metadata only; bytes stream on
	// demand through the owner-scoped route, like the resume.
	const certificates = await certificatesRepository.listForApplication(app.application_id);

	// Respect the applicant's own visibility choice for their AI resume analysis.
	const aiVisible = prof.is_ai_profile_visible === undefined || prof.is_ai_profile_visible === null
		? true
		: Boolean(prof.is_ai_profile_visible);

	return {
		application: {
			id: app.application_id,
			job_id: app.job_id,
			status: app.status,
			job_title: app.job_title,
			company_name: app.company_name,
			applied_at: app.applied_at,
			// Apply-time score — IMMUTABLE, the referral decision's source of truth (§7.4).
			match_score: app.match_score,
			ai_scored_at: app.ai_scored_at,
			// LIVE score (Enhancement B) — recalculated as the applicant's resume /
			// profile / certificates change; this is what the pipeline ranks by. NULL
			// until the first background re-score.
			current_match_score: app.current_match_score,
			scored_at: app.scored_at,
		},
		// What the applicant SUBMITTED (immutable personal-info snapshot).
		submitted: safeParse(app.applicant_snapshot) || {},
		// AI compatibility breakdowns for THIS application (job ↔ resume): the
		// immutable apply-time snapshot and the live recalculation. The admin sees both.
		aiCompatibility: safeParse(app.ai_analysis),
		liveCompatibility: safeParse(app.current_ai_analysis),
		// The applicant's CURRENT profile (labelled "current profile" in the UI).
		profile: {
			// The applicant's USER id — REQUIRED so the client seeds the deterministic
			// generated-avatar fallback by `user-<id>` (avatarSeedFor), matching every other
			// surface. Without it, a NULL-avatar applicant's drawer face was seeded by NAME
			// and diverged from the id-seeded face shown everywhere else (§ avatar-seed fix).
			id: user.id || app.applicant_id || null,
			name: user.name || null,
			email: user.email || null,
			phone: user.phone || null,
			location: user.location || null,
			gender: user.gender || null,
			dob: user.dob || null,
			availability: user.availability || null,
			educational_attainment: user.educational_attainment || null,
			languages: user.languages || null,
			skills: user.skills || prof.skills || null,
			preferred_roles: user.preferred_roles || prof.preferred_roles || null,
			experience_level: user.experience_level || prof.experience_level || null,
			career_goals: user.career_goals || prof.career_goals || null,
			avatar_url: user.avatar_url || null,
			member_since: user.created_at || null,
		},
		// AI Resume Analysis outputs — only if the applicant left them visible.
		aiResumeVisible: aiVisible,
		resumeInsights: aiVisible ? safeParse(prof.ai_insights_data) : null,
		aiResumeProfile: aiVisible ? safeParse(prof.ai_profile_data) : null,
		documents: {
			hasResume: Boolean(Number(app.has_resume)),
			// Stream endpoint (owner-scoped, blob-fetched by the client).
			resumeUrl: `/peso-admin/ats/applications/${app.application_id}/resume`,
			certificates: certificates.map((c) => ({
				id: c.id,
				title: c.title,
				category: c.category,
				file_name: c.file_name,
				mime_type: c.mime_type,
				byte_size: c.byte_size,
				url: `/peso-admin/ats/applications/${app.application_id}/certificates/${c.id}`,
			})),
		},
	};
}

module.exports = { getApplicantProfile };
