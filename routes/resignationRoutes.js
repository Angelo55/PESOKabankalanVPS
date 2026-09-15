const express = require('express');
const router = express.Router();
const aiClient = require('../services/aiClient');
const { generateBody, resignationPrompt } = require('../services/letterBodyService');
const { renderResignationToBuffer } = require('../services/letterPdfService');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, 
    max: 20, 
    message: { status: 'error', message: 'AI capacity reached. Please try again in an hour.' }
});

router.get('/draft', requireAuth, async (req, res) => {
    try {
        const [drafts] = await db.query('SELECT letter_data FROM resignation_letters WHERE user_id = ?', [req.userId]);
        if (drafts.length > 0 && drafts[0].letter_data) {
            const data = typeof drafts[0].letter_data === 'string' ? JSON.parse(drafts[0].letter_data) : drafts[0].letter_data;
            return res.status(200).json({ status: 'success', data });
        }
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch resignation draft' });
    }
});

router.post('/draft', requireAuth, async (req, res) => {
    const { letterData } = req.body;
    try {
        const jsonString = JSON.stringify(letterData);
        const [existing] = await db.query('SELECT id FROM resignation_letters WHERE user_id = ?', [req.userId]);
        
        if (existing.length > 0) {
            await db.query('UPDATE resignation_letters SET letter_data = ? WHERE user_id = ?', [jsonString, req.userId]);
        } else {
            await db.query('INSERT INTO resignation_letters (user_id, letter_data) VALUES (?, ?)', [req.userId, jsonString]);
        }
        res.status(200).json({ status: 'success', message: 'Draft saved successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save resignation draft' });
    }
});

// --- AI Body Generation (feature parity with the Cover Letter builder) ---
// Generates the resignation body FROM the structured context, via the SAME shared
// service the cover letter uses (services/letterBodyService.js) — no duplicate AI
// wiring. Same request/response shape as /cover-letter/generate-body so the generic
// builder frontend drives both identically.
router.post('/generate-body', requireAuth, aiLimiter, async (req, res) => {
    const { data } = req.body;
    if (!data) return res.status(400).json({ status: 'error', message: 'Payload data is missing.' });

    try {
        const generatedText = await generateBody(resignationPrompt(data));
        res.status(200).json({ status: 'success', generatedText });
    } catch (error) {
        console.error('Resignation generation error:', error.response?.data || error.message);
        res.status(500).json({
            status: 'error',
            message: error.response?.data?.error?.message || error.message || 'Failed to generate resignation letter.'
        });
    }
});

router.post('/optimize', requireAuth, aiLimiter, async (req, res) => {
    const { rawText, details } = req.body;
    try {
        const prompt = `You are an expert HR professional and corporate copywriter. Refine and optimize the following resignation letter draft. 

Context Constraints:
- Position: ${details.position} at ${details.company}
- Last Day: ${details.lastDay}
- Reason for leaving: ${details.reason}
- Target Tone: ${details.tone}

CRITICAL INSTRUCTION: Return ONLY the polished letter body paragraphs. Do not include headers, dates, signature blocks, or meta-commentary:

${rawText}`;

        const raw = await aiClient.chat({
            messages: [{ role: "system", content: prompt }],
            temperature: 0.1,
            tier: aiClient.TIER.CHAT,
            prefer: 'deepseek',
        });

        let optimizedText = raw.trim();
        res.status(200).json({ status: 'success', optimizedText });
    } catch (error) {
        res.status(500).json({ error: 'AI Optimization Failed' });
    }
});

router.post('/translate', requireAuth, aiLimiter, async (req, res) => {
    const { letterData, targetLanguage } = req.body;
    try {
        const prompt = `You are a professional corporate translator. Translate the following JSON resignation letter data into ${targetLanguage}.
CRITICAL RULES:
1. ONLY translate the string values (like the body, position, reason).
2. DO NOT translate JSON keys.
3. Return ONLY valid JSON format. Do not wrap in markdown code blocks.`;

        const raw = await aiClient.chat({
            messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(letterData) }],
            temperature: 0.1,
            tier: aiClient.TIER.CHAT,
            prefer: 'deepseek',
            extra: { response_format: { type: "json_object" } },
        });

        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid JSON returned");

        let translatedData;
        try {
            translatedData = JSON.parse(jsonMatch[0]);

            // --- CRITICAL DEFENSIVE GUARD ---
            const mergeTranslation = (original, translated) => {
                if (original == null) return translated;
                if (translated == null) return original;
                
                if (Array.isArray(original)) {
                    return original.map((item, idx) => {
                        const translatedItem = Array.isArray(translated) ? translated[idx] : null;
                        return mergeTranslation(item, translatedItem);
                    });
                }
                
                if (typeof original === 'object') {
                    const merged = { ...original };
                    for (const key in original) {
                        merged[key] = mergeTranslation(original[key], translated[key]);
                    }
                    return merged;
                }
                
                if (typeof original === 'string') {
                    return (typeof translated === 'string' && translated.trim() !== '') ? translated : original;
                }
                
                return original; 
            };

            const safeTranslatedData = mergeTranslation(letterData, translatedData);
            safeTranslatedData.language = req.body.targetLanguage;
            
            res.status(200).json({ status: 'success', translatedData: safeTranslatedData });
        } catch (parseError) {
            return res.status(500).json({ status: 'error', message: 'The AI returned invalid formatting. Please try again.' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Translation failed.' });
    }
});

// Self-hosted resignation PDF (was PDFMonkey: an external create-then-poll
// round-trip that 500'd on any outage). Rendered in-memory so a render failure
// still returns JSON rather than a half-written file.
router.post('/generate', requireAuth, async (req, res) => {
    const { letterData } = req.body;

    if (!letterData || !String(letterData.body || '').trim()) {
        return res.status(400).json({ status: 'error', message: 'The letter body is empty — draft the letter before exporting.' });
    }

    try {
        const buffer = await renderResignationToBuffer(letterData);
        const safeName = (letterData.employee?.name || 'Resignation').replace(/[^a-zA-Z0-9]/g, '_');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Resignation_Letter.pdf"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (error) {
        console.error('Resignation PDF error:', error.message);
        return res.status(500).json({ status: 'error', message: 'Failed to generate PDF.' });
    }
});

module.exports = router;