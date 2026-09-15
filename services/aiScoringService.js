const crypto = require('crypto');
const db = require('../db');
const aiClient = require('./aiClient');

/**
 * Scoring PROMPT VERSION — stamped onto every score's provenance (F1) so a displayed
 * % is auditable and a score can be tied to the exact rubric that produced it. BUMP
 * this whenever buildScoringPrompt() changes in a way that could move scores (a new
 * rule, a new job field, a budget change). Current: the Tier-1 recalibration (§21).
 */
const SCORING_PROMPT_VERSION = 'req-strict-2026-08-25';

/**
 * DeepSeek compatibility scoring.
 *
 * Extracted from jobRoutes.js:86, which computed a real score, showed it to the
 * user, and threw it away -- while applicationRoutes.js stored Math.random()
 * instead. One implementation, one source of truth, two callers.
 *
 * CONTRACT: returns a score object, or NULL. NEVER a fabricated number.
 *
 * This matters more than it looks. jobRoutes.js:135 currently returns
 * { overall: 75, ... } when the AI fails -- a made-up score presented as an AI
 * result. If an auto-referral threshold is 85 today and someone lowers it to 75
 * tomorrow, that fallback silently starts issuing government referral letters
 * based on a hardcoded constant. An unavailable AI must produce an ABSENCE, and
 * an absence must route to a human.
 */

/** Most recent parsed resume text for a user, or null. */
async function getApplicantResume(userId) {
	try {
		const [dedicated] = await db.query(
			'SELECT parsed_text FROM uploaded_resumes WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1',
			[userId]
		);
		if (dedicated.length > 0 && dedicated[0].parsed_text) return dedicated[0].parsed_text;
	} catch (error) {
		console.warn(`[AIScoring] uploaded_resumes lookup failed: ${error.message}`);
	}

	try {
		const [legacy] = await db.query(
			'SELECT parsed_text FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
			[userId]
		);
		if (legacy.length > 0 && legacy[0].parsed_text) return legacy[0].parsed_text;
	} catch (error) {
		console.warn(`[AIScoring] resumes lookup failed: ${error.message}`);
	}

	return null;
}

/**
 * Assembles the exact compatibility-scoring prompt for one (resume, job) pair.
 *
 * Tier-1 recalibration (2026-08). SAME scoring instruction as before — no rubric
 * re-weighting, because the baseline eval showed the core scorer already scores
 * well — but fed the FULL job context every caller can provide: the job's required
 * skills + qualifications (previously dropped), plus experience/education read
 * under EITHER name. Workers alias those to required_experience/educational_
 * requirements; the apply path passes the raw experience/education columns, which
 * silently resolved to "Not specified" before this fallback. Larger résumé budget
 * so long résumés aren't cut mid-experience. This is the SINGLE prompt the board
 * uses too (jobRoutes /match, B1), so board and apply-time scores share inputs.
 *
 * SINGLE SOURCE OF TRUTH: scoreApplication() scores this string, and
 * computeScoringSignature() hashes this string — so the change-detection hash is
 * derived from the very inputs that are scored and can NEVER drift from them.
 */
function buildScoringPrompt({ resume, job, extraContext = null }) {
	const jobSkills = job.skills || 'Not specified';
	const jobQualifications = job.qualifications || 'Not specified';
	const jobExperience = job.required_experience || job.experience || 'Not specified';
	const jobEducation = job.educational_requirements || job.education || 'Not specified';
	// Gender is a STATED employer requirement (migration 040). Empty / 'Any' means
	// no preference — the scorer must treat that as non-restrictive.
	const jobGender = (job.gender && String(job.gender).trim()) ? String(job.gender).trim() : 'Any / no preference';

	return `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
Return ONLY a strict JSON object with NO markdown formatting, backticks, or additional text.
{
    "overall": <number 0-100>,
    "skills": "<High/Medium/Low>",
    "education": "<High/Medium/Low>",
    "experience": "<High/Medium/Low>",
    "summary": "<one sentence, max 200 characters, explaining the score>"
}

SCORING RULES (follow strictly):
- Score the candidate ONLY against the employer's STATED requirements listed below. Do NOT invent, assume, or expect requirements the employer did not list, and do NOT lower the score for anything the posting does not ask for.
- Do NOT raise the score for résumé content beyond the stated requirements either: skills, experience, or qualifications the employer did NOT list neither add to nor subtract from the number. The score reflects ONLY the stated Requirements & Qualifications.
- Certificates, licences, and training are SUPPORTING evidence, NOT mandatory. Treat them as required ONLY if the employer explicitly lists them; their absence must not by itself reduce the score.
- "Qualifications" may be broad or empty; unspecified qualifications are NOT mandatory criteria — weigh only what the employer actually stated.
- If a preferred gender is stated, weigh it as a stated employer preference. If the résumé does not indicate the candidate's gender, treat it as unknown and do NOT penalize.

Resume:
${String(resume || '').substring(0, 8000)}
${extraContext ? `\nSupporting certificates (additional evidence — TESDA/licences/training):\n${String(extraContext).substring(0, 1500)}\n` : ''}
Job Description:
${job.title} at ${job.company}
${job.description || ''}
Required skills: ${jobSkills}
Qualifications: ${jobQualifications}
Experience: ${jobExperience}
Education: ${jobEducation}
Preferred gender: ${jobGender}`;
}

/**
 * SHA-256 signature of the scoring INPUTS for one (resume, job) pair — the change
 * detector for the re-score worker's ship-dark input-hash guard (migration 038).
 *
 * It hashes the whitespace-normalized assembled prompt, so:
 *   - it covers EXACTLY the inputs that are scored (built from buildScoringPrompt),
 *     so a change to any scoring-relevant field (résumé, certs, or the job's
 *     skills/qualifications/experience/education/title/description) changes it;
 *   - whitespace-/formatting-only changes normalize away (the user's "ignore
 *     whitespace-only" requirement) — the résumé text's meaning is unchanged, and
 *     scoring is deterministic (temp 0), so keeping the prior score is correct;
 *   - a change to job context (a job edit) DOES change it, so the same résumé is
 *     correctly re-scored against new criteria.
 *
 * Returns NULL when there is no résumé to score (nothing to compare) — the caller
 * then never treats it as "unchanged".
 */
function computeScoringSignature({ resume, job, extraContext = null }) {
	if (!resume || String(resume).trim().length === 0) return null;
	const normalized = buildScoringPrompt({ resume, job, extraContext }).replace(/\s+/g, ' ').trim();
	return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Scores one resume against one job.
 *
 * Returns { overall, skills, education, experience } or NULL.
 *
 * NULL is returned when:
 *   - the applicant has no parsed resume  (nothing to score)
 *   - the AI is unreachable or times out   (no opinion)
 *   - the AI returns unparseable output    (no trustworthy opinion)
 *   - the score is outside 0-100           (a hallucination, not a score)
 *
 * Every one of those means "a human must look at this."
 */
async function scoreApplication({ userId, job, extraContext = null, resumeText = null }) {
	// A caller that has ALREADY loaded the parsed résumé (e.g. jobRoutes /match,
	// which fetches it for its own resume-required guard) can pass it in to avoid a
	// second identical DB read. Any caller that omits it keeps the original
	// behaviour — we fetch it here.
	const resume = (resumeText && resumeText.trim().length > 0) ? resumeText : await getApplicantResume(userId);

	if (!resume || resume.trim().length === 0) {
		console.log(`[AIScoring] User ${userId} has no parsed resume. No score.`);
		return null;
	}

	if (!aiClient.isAiConfigured()) {
		console.warn('[AIScoring] No AI provider configured. No score.');
		return null;
	}

	// The prompt is built by the SHARED buildScoringPrompt() below, so the exact
	// text scored here is also exactly what computeScoringSignature() hashes for the
	// worker's change-detection guard — the hash can never drift from what is scored.
	const prompt = buildScoringPrompt({ resume, job, extraContext });

	try {
		// Unified AI client: reasoning tier (deepseek-chat) with automatic
		// OpenRouter → DeepSeek-direct failover and a circuit breaker.
		//
		// PREFERRED PROVIDER is configurable (AI_SCORING_PREFER, read per call so a
		// change takes effect on restart without code edits). Default 'openrouter'.
		// When OpenRouter is billing-blocked (HTTP 402), set AI_SCORING_PREFER=deepseek
		// so every score goes STRAIGHT to the working provider — no wasted 402 attempt,
		// no circuit-breaker churn, and consistent scores on one provider (so the live
		// score is comparable to the apply-time one). Failover to the OTHER provider
		// still applies if the preferred one is down.
		const preferProvider = process.env.AI_SCORING_PREFER === 'deepseek' ? 'deepseek' : 'openrouter';
		// chatDetailed reports the provider + model that ACTUALLY served the response
		// (after any failover), so we can stamp the score's provenance (F1).
		const { content: raw, provider, model } = await aiClient.chatDetailed({
			messages: [{ role: 'user', content: prompt }],
			// temp 0 + JSON mode: reproducible scores (removes the run-to-run drift that
			// made a precise % look unstable) and reliable parsing.
			temperature: 0,
			tier: aiClient.TIER.CHAT,
			prefer: preferProvider,
			extra: { response_format: { type: 'json_object' } },
		});

		if (!raw) {
			console.warn('[AIScoring] AI returned an empty response. No score.');
			return null;
		}

		const cleaned = raw.trim().replace(/```json/g, '').replace(/```/g, '');
		// Extract the first {...} block so any stray prose around the JSON doesn't fail
		// the parse (belt-and-suspenders alongside response_format json mode).
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

		const overall = Number(parsed.overall);

		// A model that returns 150, or "high", or NaN, has not given us a score.
		// Do not coerce a hallucination into a number a threshold will act on.
		if (!Number.isFinite(overall) || overall < 0 || overall > 100) {
			console.warn(`[AIScoring] DeepSeek returned an invalid score (${parsed.overall}). No score.`);
			return null;
		}

		return {
			overall: Math.round(overall),
			skills: parsed.skills || 'Unknown',
			education: parsed.education || 'Unknown',
			experience: parsed.experience || 'Unknown',
			summary: typeof parsed.summary === 'string' ? parsed.summary.substring(0, 200) : null,
			// PROVENANCE (F1) — stamped so a displayed % is auditable/reproducible: which
			// provider+model actually produced it, under which prompt version, and when.
			// It rides inside the score object, which is JSON-persisted whole into
			// ai_analysis / current_ai_analysis (no migration). It is OUTPUT metadata, NOT
			// a scoring input, so it is deliberately NOT part of computeScoringSignature()
			// — a provider failover can never trigger a spurious re-score.
			provenance: {
				provider,
				model,
				promptVersion: SCORING_PROMPT_VERSION,
				scoredAt: new Date().toISOString(),
			},
		};
	} catch (error) {
		// NOTE: no fallback score. See the contract above.
		console.error(`[AIScoring] DeepSeek failed: ${error.message}. No score.`);
		return null;
	}
}

module.exports = { scoreApplication, getApplicantResume, buildScoringPrompt, computeScoringSignature, SCORING_PROMPT_VERSION };