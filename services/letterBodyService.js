const aiClient = require('./aiClient');

/**
 * Shared document-body generation for the letter builders (cover letter + resignation).
 *
 * ONE AI call path so the generation wiring is not duplicated per route: the DRAFT
 * tier (gpt-4o-mini on OpenRouter, deepseek-chat as automatic failover, so a draft
 * survives a single provider outage), and doc-specific prompt builders. Both
 * `/cover-letter/generate-body` and `/resignation/generate-body` call generateBody()
 * — the "single reusable document-generation service" the builders share.
 *
 * Returns the generated body text (paragraphs only — no header/date/signature).
 */
async function generateBody(prompt) {
	const raw = await aiClient.chat({
		messages: [{ role: 'user', content: prompt }],
		tier: aiClient.TIER.DRAFT,
		prefer: 'openrouter',
	});
	return raw.trim();
}

// Kept byte-identical to the original inline cover-letter prompt so generation output
// does not change for existing users.
function coverLetterPrompt(data) {
	return `You are an expert executive recruiter writing a highly professional cover letter.
    Generate ONLY the body paragraphs (no header, no signature, no date).

    Candidate Name: ${data?.applicant?.name || 'Applicant'}
    Target Position: ${data?.target?.position || 'Target Position'} at ${data?.target?.company || 'Target Company'}
    Experience/Achievements: ${data?.context?.experienceSummary || 'N/A'} | ${data?.context?.keyAchievements || 'N/A'}
    Relevant Skills: ${data?.context?.skills || 'N/A'}
    Why Interested: ${data?.context?.whyInterested || 'N/A'}
    Tone: ${data?.context?.tone || 'Professional'}

    Make it compelling, ATS-friendly, and perfectly tailored. Do not hallucinate skills. Do not include AI disclaimers.`;
}

function resignationPrompt(data) {
	const e = data?.employee || {};
	const m = data?.employment || {};
	const det = data?.details || {};
	return `You are an expert HR professional writing a formal, professional resignation letter.
    Generate ONLY the body paragraphs (no header, no date, no signature block).

    Employee Name: ${e.name || 'Employee'}
    Position: ${m.position || 'my position'} at ${m.company || 'the company'}
    Manager: ${m.managerName || 'the manager'}
    Last Day of Work: ${det.lastDay || 'the agreed final date'}
    Reason for Leaving: ${det.reason || 'a personal career decision'}
    Tone: ${det.tone || 'Professional & Grateful'}

    Include, in order: a clear statement of resignation from the stated position, the last working day,
    brief and sincere gratitude for the opportunity, and a professional offer to help with the transition.
    Keep it concise, courteous, and legally safe. Do not include AI disclaimers or meta-commentary.`;
}

module.exports = { generateBody, coverLetterPrompt, resignationPrompt };
