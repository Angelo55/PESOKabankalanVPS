#!/usr/bin/env node
/**
 * AI COMPATIBILITY EVAL HARNESS — calibration step 1 (measure before you change).
 *
 * Runs a chosen PROMPT VARIANT over the labeled cases in scripts/eval-fixtures.json
 * and reports how close the model's compatibility score is to the human-expected
 * outcome: MAE on the overall %, band accuracy, and false-positive / false-negative
 * counts against a "suitable" threshold. Run the SAME harness for the baseline and
 * (later) the recalibrated prompt to get an apples-to-apples before/after.
 *
 * This file is SELF-CONTAINED — it does NOT import or modify the production scorer
 * (services/aiScoringService.js), so building/running it changes nothing about live
 * scoring. The `baseline` variant is a faithful MIRROR of the current production
 * prompt as of the 2026-08 audit; the recalibration step will replace the real
 * prompt AND add a `recalibrated` variant here so both run through this harness.
 *
 * USAGE
 *   node scripts/eval-scoring.js --mock                 # dry run, NO AI calls (uses
 *                                                        # each case's illustrative
 *                                                        # mockResponse) — proves the
 *                                                        # harness end to end, free.
 *   node scripts/eval-scoring.js                        # LIVE baseline — real AI calls
 *                                                        # (needs OPENROUTER_API_KEY or
 *                                                        # DEEPSEEK_API_KEY). Run on
 *                                                        # staging/local, never a prod
 *                                                        # write path. Costs tokens.
 *   node scripts/eval-scoring.js --variant=recalibrated # (after the recalibration lands)
 *   node scripts/eval-scoring.js --fixtures=path.json   # custom fixtures
 *
 * npm run eval:scoring [-- --mock]
 */

// Load .env FIRST so a standalone run picks up the AI keys the server normally gets
// via dotenv in server.js. Without this, aiClient sees no provider and every case
// comes back "No AI provider configured" even though the keys are in .env.
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const arg = (name, def) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split('=').slice(1).join('=') : def;
};
const variant = arg('variant', 'baseline');
const fixturesPath = path.resolve(arg('fixtures', path.join(__dirname, 'eval-fixtures.json')));

// ── Prompt variants ──────────────────────────────────────────────────────────
// `baseline` is a faithful mirror of services/aiScoringService.js as of the 2026-08
// audit (same instruction, same 3000-char truncation, same job context, same JSON
// shape). Do NOT "improve" it here — the whole point is that it reflects what
// production does today. New variants (e.g. `recalibrated`) are added alongside.
const PROMPT_VARIANTS = {
	baseline: ({ resume, job, extraContext }) => `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
Return ONLY a strict JSON object with NO markdown formatting, backticks, or additional text.
{
    "overall": <number 0-100>,
    "skills": "<High/Medium/Low>",
    "education": "<High/Medium/Low>",
    "experience": "<High/Medium/Low>",
    "summary": "<one sentence, max 200 characters, explaining the score>"
}

Resume:
${String(resume || '').substring(0, 3000)}
${extraContext ? `\nSupporting certificates (additional evidence — TESDA/licences/training):\n${String(extraContext).substring(0, 1500)}\n` : ''}
Job Description:
${job.title} at ${job.company}
${job.description || ''}
Requirements: ${job.required_experience || 'Not specified'}
Education: ${job.educational_requirements || 'Not specified'}`,

	// `board` is a faithful mirror of routes/jobRoutes.js /match — the prompt behind
	// the number shown on the Public Job Board. It is DELIBERATELY thinner than
	// `baseline`: job context is title + company + description ONLY (no requirements,
	// no education, no skills/qualifications), and there is no summary field. Compare
	// `board` vs `baseline` to see how much the board's missing job context costs — a
	// key input to whether B1 (unify the two prompts) is the fix.
	board: ({ resume, job }) => `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
Return ONLY a strict JSON object with NO markdown formatting, backticks, or additional text.
{
    "overall": <number 0-100>,
    "skills": "<High/Medium/Low>",
    "education": "<High/Medium/Low>",
    "experience": "<High/Medium/Low>"
}

Resume:
${String(resume || '').substring(0, 3000)}

Job Description:
${job.title} at ${job.company}
${job.description || ''}`,

	// `recalibrated` mirrors the Tier-1 services/aiScoringService.js prompt: same
	// scoring instruction (no rubric change), full job context (skills + qualifications
	// + experience + education), larger résumé budget. Run with its params (temp 0 +
	// json mode) via VARIANT_PARAMS. This is the "after" to baseline/board's "before".
	recalibrated: ({ resume, job, extraContext }) => `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
Return ONLY a strict JSON object with NO markdown formatting, backticks, or additional text.
{
    "overall": <number 0-100>,
    "skills": "<High/Medium/Low>",
    "education": "<High/Medium/Low>",
    "experience": "<High/Medium/Low>",
    "summary": "<one sentence, max 200 characters, explaining the score>"
}

Resume:
${String(resume || '').substring(0, 8000)}
${extraContext ? `\nSupporting certificates (additional evidence — TESDA/licences/training):\n${String(extraContext).substring(0, 1500)}\n` : ''}
Job Description:
${job.title} at ${job.company}
${job.description || ''}
Required skills: ${job.skills || 'Not specified'}
Qualifications: ${job.qualifications || 'Not specified'}
Experience: ${job.required_experience || job.experience || 'Not specified'}
Education: ${job.educational_requirements || job.education || 'Not specified'}`,

	// `employer-criteria` mirrors the Phase-1.5 (#11a) services/aiScoringService.js prompt:
	// recalibrated PLUS explicit rules that ONLY the employer's STATED requirements count
	// (certificates and unspecified qualifications are NOT mandatory) and the stated gender
	// preference. The "after" to recalibrated's "before" for the office-workflow change.
	'employer-criteria': ({ resume, job, extraContext }) => `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
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
- Certificates, licences, and training are SUPPORTING evidence, NOT mandatory. Treat them as required ONLY if the employer explicitly lists them; their absence must not by itself reduce the score.
- "Qualifications" may be broad or empty; unspecified qualifications are NOT mandatory criteria — weigh only what the employer actually stated.
- If a preferred gender is stated, weigh it as a stated employer preference. If the résumé does not indicate the candidate's gender, treat it as unknown and do NOT penalize.

Resume:
${String(resume || '').substring(0, 8000)}
${extraContext ? `\nSupporting certificates (additional evidence — TESDA/licences/training):\n${String(extraContext).substring(0, 1500)}\n` : ''}
Job Description:
${job.title} at ${job.company}
${job.description || ''}
Required skills: ${job.skills || 'Not specified'}
Qualifications: ${job.qualifications || 'Not specified'}
Experience: ${job.required_experience || job.experience || 'Not specified'}
Education: ${job.educational_requirements || job.education || 'Not specified'}
Preferred gender: ${(job.gender && String(job.gender).trim()) ? String(job.gender).trim() : 'Any / no preference'}`,

	// `requirement-strict` mirrors the SHIPPED 2026-08-25 services/aiScoringService.js prompt:
	// employer-criteria PLUS the symmetric "do NOT raise the score for unrequested résumé
	// content" rule. Certificates are no longer a scoring input. (A summary-strengths idea
	// was tested here and REJECTED — every wording inflated strong matches / dropped band
	// accuracy in the eval, so it is NOT in the prompt.) The "after" to employer-criteria.
	'requirement-strict': ({ resume, job }) => `You are an expert ATS AI. Evaluate compatibility between this resume and job posting.
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
Job Description:
${job.title} at ${job.company}
${job.description || ''}
Required skills: ${job.skills || 'Not specified'}
Qualifications: ${job.qualifications || 'Not specified'}
Experience: ${job.required_experience || job.experience || 'Not specified'}
Education: ${job.educational_requirements || job.education || 'Not specified'}
Preferred gender: ${(job.gender && String(job.gender).trim()) ? String(job.gender).trim() : 'Any / no preference'}`,
};

// Per-variant AI params — the recalibrated variant is evaluated with the SAME params
// production will use (temp 0 + JSON mode), while baseline/board keep today's temp 0.2.
const VARIANT_PARAMS = {
	baseline: { temperature: 0.2 },
	board: { temperature: 0.2 },
	recalibrated: { temperature: 0, extra: { response_format: { type: 'json_object' } } },
	'employer-criteria': { temperature: 0, extra: { response_format: { type: 'json_object' } } },
	'requirement-strict': { temperature: 0, extra: { response_format: { type: 'json_object' } } },
};

// ── Scoring helpers (mirror of the production parse + the frontend band) ──────
function bandOf(score, t) {
	if (!Number.isFinite(score)) return 'Estimating';
	if (score >= t.strong) return 'Strong Match';
	if (score >= t.good) return 'Good Match';
	if (score >= t.moderate) return 'Moderate Match';
	return 'Low Match';
}

function parseScore(raw) {
	if (!raw) return null;
	try {
		const cleaned = String(raw).trim().replace(/```json/g, '').replace(/```/g, '');
		const match = cleaned.match(/\{[\s\S]*\}/); // tolerate stray prose around the JSON
		const parsed = JSON.parse(match ? match[0] : cleaned);
		const overall = Number(parsed.overall);
		if (!Number.isFinite(overall) || overall < 0 || overall > 100) return null;
		return { overall: Math.round(overall), skills: parsed.skills, education: parsed.education, experience: parsed.experience };
	} catch {
		return null;
	}
}

async function callAi(prompt, params = {}) {
	const aiClient = require('../services/aiClient');
	if (!aiClient.isAiConfigured()) {
		throw new Error('No AI provider configured (set OPENROUTER_API_KEY or DEEPSEEK_API_KEY), or use --mock.');
	}
	const prefer = process.env.AI_SCORING_PREFER === 'deepseek' ? 'deepseek' : 'openrouter';
	return aiClient.chat({
		messages: [{ role: 'user', content: prompt }],
		temperature: params.temperature ?? 0.2,
		tier: aiClient.TIER.CHAT,
		prefer,
		...(params.extra ? { extra: params.extra } : {}),
	});
}

const pad = (s, n) => String(s ?? '—').padEnd(n);

// ── Run ──────────────────────────────────────────────────────────────────────
(async () => {
	const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
	const t = fx.bandThresholds || { strong: 75, good: 55, moderate: 35 };
	const suitableT = Number(fx.suitableThreshold) || 60;
	const tol = Number(fx.toleranceOverall) || 12;
	const build = PROMPT_VARIANTS[variant];
	if (!build) {
		console.error(`Unknown variant '${variant}'. Available: ${Object.keys(PROMPT_VARIANTS).join(', ')}`);
		process.exit(2);
	}

	console.log(`\nAI Compatibility Eval  ·  variant='${variant}'  ·  mode=${MOCK ? 'MOCK (no AI calls)' : 'LIVE'}  ·  ${path.basename(fixturesPath)}`);
	if (MOCK) console.log('NOTE: MOCK numbers come from each case\'s illustrative `mockResponse` — scaffolding, NOT real model output. Run without --mock on staging for the real baseline.');
	console.log('');

	const rows = [];
	let absErrSum = 0, bandHits = 0, fp = 0, fn = 0, scored = 0, noScore = 0;

	for (const c of fx.cases) {
		const prompt = build({ resume: c.resume, job: c.job, extraContext: c.extraContext || null });
		let raw = null;
		if (MOCK) {
			raw = c.mockResponse;
		} else {
			try { raw = await callAi(prompt, VARIANT_PARAMS[variant] || {}); }
			catch (e) { console.error(`  [${c.id}] AI error: ${e.message}`); }
		}
		const res = parseScore(raw);
		const pred = res ? res.overall : null;
		const predBand = res ? bandOf(pred, t) : 'No score';
		const expOverall = c.expected?.overall ?? null;
		const expBand = c.expected?.band || (expOverall != null ? bandOf(expOverall, t) : '—');
		const delta = (pred != null && expOverall != null) ? pred - expOverall : null;
		const pass = pred != null && delta != null && Math.abs(delta) <= tol;

		if (pred == null) {
			noScore++;
		} else {
			scored++;
			if (expOverall != null) absErrSum += Math.abs(delta);
			if (predBand === expBand) bandHits++;
			const predSuitable = pred >= suitableT;
			if (predSuitable && c.expected?.suitable === false) fp++;
			if (!predSuitable && c.expected?.suitable === true) fn++;
		}

		rows.push({
			id: c.id, exp: expOverall, expBand, pred: pred ?? '—', predBand,
			delta: delta == null ? '—' : (delta > 0 ? `+${delta}` : `${delta}`),
			result: pred == null ? 'NO-SCORE' : (pass ? 'ok' : 'OFF'),
		});
	}

	console.log(pad('CASE', 29) + pad('EXP', 5) + pad('EXP BAND', 15) + pad('PRED', 6) + pad('PRED BAND', 15) + pad('Δ', 6) + 'RESULT');
	console.log('-'.repeat(87));
	for (const r of rows) {
		console.log(pad(r.id, 29) + pad(r.exp, 5) + pad(r.expBand, 15) + pad(r.pred, 6) + pad(r.predBand, 15) + pad(r.delta, 6) + r.result);
	}
	console.log('-'.repeat(87));

	const mae = scored ? (absErrSum / scored).toFixed(1) : '—';
	const bandAcc = scored ? `${((bandHits / scored) * 100).toFixed(0)}%` : '—';
	console.log(`\nSummary — ${scored}/${fx.cases.length} scored (${noScore} no-score):`);
	console.log(`  MAE (overall)      : ${mae}     ${scored ? '(mean absolute error vs expected %)' : ''}`);
	console.log(`  Band accuracy      : ${bandAcc}`);
	console.log(`  False positives    : ${fp}     (scored suitable, expert says not)`);
	console.log(`  False negatives    : ${fn}     (scored not-suitable, expert says suitable)`);
	console.log(`  Off-tolerance cases: ${rows.filter((r) => r.result === 'OFF').length}   (|Δ| > ${tol})`);
	console.log(`\nThresholds: bands strong>=${t.strong}/good>=${t.good}/moderate>=${t.moderate}; suitable>=${suitableT}; tolerance +/-${tol}.\n`);
})().catch((e) => { console.error('Eval failed:', e); process.exit(1); });
