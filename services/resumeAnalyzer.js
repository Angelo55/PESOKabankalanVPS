/**
 * resumeAnalyzer — the AI résumé extraction, factored out of routes/profileRoutes.js so
 * BOTH the live "Analyze My Resume" endpoint AND the offline validation harness
 * (scripts/eval-resume-analysis.js, Phase D) exercise the SAME analyzer. One prompt, one
 * shape — no duplicated logic.
 *
 * Given résumé text → DeepSeek (via aiClient) extracts { skills, experiences } as strict
 * JSON → shaped into the `baseProfile` the dashboard's Unified Career Profile renders.
 * Optional Coresignal company enrichment stays gated on CORESIGNAL_API_KEY (deprecated/
 * skipped when absent, §14).
 */
const aiClient = require('./aiClient');
const axios = require('axios');

const RESUME_TEXT_BUDGET = 6000;

const buildExtractionPrompt = (resumeText) => `
    You are an expert ATS extraction engine. Read the resume text below.
    Output ONLY valid JSON matching this exact structure:
    {
        "skills": [{"name": "Skill 1"}, {"name": "Skill 2"}],
        "experiences": [
            { "title": "Job Title", "company": "Company Name", "date_start": "YYYY-MM" }
        ]
    }
    Resume Text:
    ${String(resumeText || '').substring(0, RESUME_TEXT_BUDGET)}
`;

async function enrichWithCoresignal(baseProfile) {
    if (!process.env.CORESIGNAL_API_KEY) return baseProfile;
    for (const job of baseProfile.canonical_history) {
        const companyName = job.hrflow_explicit_data.company;
        if (companyName && companyName !== 'Unknown Company') {
            try {
                const coreResponse = await axios.get(
                    `https://api.coresignal.com/v1/company/search/filter?name=${encodeURIComponent(companyName)}`,
                    { headers: { Authorization: `Bearer ${process.env.CORESIGNAL_API_KEY}` } }
                );
                const companyData = coreResponse.data[0];
                if (companyData) {
                    job.coresignal_enrichment = {
                        company_industry: companyData.industry || 'Technology',
                        company_size: companyData.size || 'Unknown',
                        inferred_skills: [],
                    };
                }
            } catch (_) { /* enrichment is best-effort */ }
        }
    }
    return baseProfile;
}

/**
 * Extract a structured career profile from résumé text.
 * @returns {{ baseProfile: object, extracted: { skills, experiences } }}
 */
async function extractResumeProfile(resumeText, { userId } = {}) {
    const raw = await aiClient.chat({
        messages: [{ role: 'system', content: buildExtractionPrompt(resumeText) }],
        temperature: 0.1,
        tier: aiClient.TIER.CHAT,
        prefer: 'deepseek',
        extra: { response_format: { type: 'json_object' } },
    });

    let extracted;
    try { extracted = JSON.parse(raw); } catch { throw new Error('The AI returned malformed JSON.'); }

    const baseProfile = {
        profile_id: `AI_PROF_${userId ?? 'anon'}`,
        canonical_history: (extracted.experiences || []).map((exp) => ({
            job_title: exp.title || 'Unknown Role',
            hrflow_explicit_data: {
                company: exp.company || 'Unknown Company',
                start_date: exp.date_start || 'Unknown Date',
                skills: (extracted.skills || []).map((s) => s.name),
            },
            coresignal_enrichment: null,
        })),
    };

    await enrichWithCoresignal(baseProfile);
    return { baseProfile, extracted };
}

module.exports = { extractResumeProfile, RESUME_TEXT_BUDGET };
