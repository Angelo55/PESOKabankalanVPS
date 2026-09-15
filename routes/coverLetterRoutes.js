const express = require('express');
const router = express.Router();
const aiClient = require('../services/aiClient');
const { generateBody, coverLetterPrompt } = require('../services/letterBodyService');
const { renderCoverLetterToBuffer } = require('../services/letterPdfService');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

// Standard production-grade rate limiting
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { status: 'error', message: 'AI capacity reached. Please try again later.' } });
const pdfLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { status: 'error', message: 'PDF export limit reached.' } });

// ==========================================
// 1. DRAFT MANAGEMENT SERVICES
// ==========================================

// Hydrate the draft. `cover_letter_drafts.user_id` is only a NON-UNIQUE (FK) index,
// so a historical bug (INSERT ... ON DUPLICATE KEY UPDATE with no unique key to
// conflict on) left many rows per user — and the old non-change-driven builder even
// re-saved EMPTY drafts on each revisit, so a user's newest row can be blank while
// their real letter sits in an older row. So: scan the most recent rows and return
// the newest one that actually has body content, falling back to the newest row if
// none do. This RECOVERS work lost to the dup-row bug and stays correct going forward
// (the POST self-heals to a single row). Was: unordered drafts[0] → stale/empty draft.
router.get('/draft', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT draft_data FROM cover_letter_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
            [req.userId]
        );
        const parse = (r) => {
            try { return typeof r.draft_data === 'string' ? JSON.parse(r.draft_data) : r.draft_data; }
            catch { return null; }
        };
        const parsed = rows.map(parse).filter(Boolean);
        const meaningful = parsed.find((d) => d && typeof d.body === 'string' && d.body.trim() !== '');
        res.status(200).json({ status: 'success', data: meaningful || parsed[0] || null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch draft' });
    }
});

// ONE draft per user. `ON DUPLICATE KEY UPDATE` cannot be trusted here (no UNIQUE
// key on user_id), so we manage the single row explicitly like the résumé/resignation
// drafts do: update in place when exactly one row exists, insert on the first save,
// and COLLAPSE historical duplicates (delete-all + insert) so a polluted user
// self-heals to a single row on their next save. All scoped to req.userId.
router.post('/draft', requireAuth, async (req, res) => {
    const { letterData } = req.body;
    try {
        const payload = JSON.stringify(letterData);
        const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM cover_letter_drafts WHERE user_id = ?', [req.userId]);
        if (c === 1) {
            await db.query('UPDATE cover_letter_drafts SET draft_data = ? WHERE user_id = ?', [payload, req.userId]);
        } else {
            if (c > 1) await db.query('DELETE FROM cover_letter_drafts WHERE user_id = ?', [req.userId]);
            await db.query('INSERT INTO cover_letter_drafts (user_id, draft_data) VALUES (?, ?)', [req.userId, payload]);
        }
        res.status(200).json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save draft' });
    }
});

// ==========================================
// 2. OPENROUTER AI SERVICES
// ==========================================

// Cover-letter drafting call. Now provider-agnostic via aiClient (kept the name
// for its callers): DRAFT tier — gpt-4o-mini on OpenRouter, deepseek-chat as the
// automatic failover — so a draft survives a single provider's outage.
const callOpenRouter = async (prompt) => {
    const raw = await aiClient.chat({
        messages: [{ role: "user", content: prompt }],
        tier: aiClient.TIER.DRAFT,
        prefer: 'openrouter',
    });
    return raw.trim();
};

// --- Generation & Optimization Endpoint ---
router.post('/generate-body', requireAuth, aiLimiter, async (req, res) => {
    const { data } = req.body;

    if (!data) return res.status(400).json({ status: 'error', message: 'Payload data is missing.' });

    try {
        // Shared generation service (same prompt as before) — see services/letterBodyService.js.
        const generatedText = await generateBody(coverLetterPrompt(data));
        res.status(200).json({ status: 'success', generatedText });
    } catch (error) {
        console.error("Cover letter generation error:", error.response?.data || error.message);
        res.status(500).json({
            status: 'error',
            message: error.response?.data?.error?.message || error.message || 'Failed to generate cover letter.'
        });
    }
});

// --- Translation Endpoint ---
router.post('/translate', requireAuth, aiLimiter, async (req, res) => {
    const { letterData, targetLanguage } = req.body;
    
    if (!letterData || !letterData.body) {
        return res.status(400).json({ status: 'error', message: 'Body text missing for translation.' });
    }

    const prompt = `Translate the following cover letter body into ${targetLanguage}. Maintain the professional tone and formatting perfectly. Return ONLY the translated text.
    
    Text to translate:
    ${letterData.body}`;

    try {
        const translatedBody = await callOpenRouter(prompt);
        const translatedData = { ...letterData, body: translatedBody, language: targetLanguage };
        res.status(200).json({ status: 'success', translatedData });
    } catch (error) {
        console.error("OpenRouter Translation Error:", error.response?.data || error.message);
        res.status(500).json({ 
            status: 'error', 
            message: error.response?.data?.error?.message || error.message || 'Translation failed.' 
        });
    }
});

// ==========================================
// 3. PDF EXPORT (self-hosted pdfkit — no external service)
// ==========================================

// Streams a generated cover-letter PDF back to the client. Rendered in-memory so
// a render error still returns JSON instead of a half-written file (was
// PDFMonkey: an external create-then-poll round-trip that 500'd on any outage).
router.post('/generate-pdf', requireAuth, pdfLimiter, async (req, res) => {
    const { letterData } = req.body;

    if (!letterData || !String(letterData.body || '').trim()) {
        return res.status(400).json({ status: 'error', message: 'The letter body is empty — draft the letter before exporting.' });
    }

    try {
        const buffer = await renderCoverLetterToBuffer(letterData);
        const safeName = (letterData?.applicant?.name || 'Cover').replace(/[^a-zA-Z0-9]/g, '_');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Cover_Letter.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (error) {
        console.error('Cover letter PDF error:', error.message);
        return res.status(500).json({ status: 'error', message: 'Failed to generate PDF.' });
    }
});

module.exports = router;