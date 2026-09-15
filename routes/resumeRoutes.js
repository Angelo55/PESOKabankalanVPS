const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const aiClient = require('../services/aiClient');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const applicationScoringService = require('../services/applicationScoringService');
const proactiveReferralService = require('../services/proactiveReferralService');
const matchScoreCache = require('../services/matchScoreCache');
const { streamResume } = require('../services/resumePdfService');

// Dependencies for External Resume Uploads
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB Limit
// pdfTextService handles both pdf-parse v1 and v2 APIs; missing lib degrades.
const { extractPdfText, isPdfExtractAvailable } = require('../services/pdfTextService');


const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, 
    max: 20, 
    message: { status: 'error', message: 'AI capacity reached. Please try again in an hour.' }
});

router.use('/assets', express.static(path.join(__dirname, '../templates')));

router.get('/templates', requireAuth, (req, res) => {
    try {
        const templatesDir = path.join(__dirname, '../templates');
        if (!fs.existsSync(templatesDir)) {
            fs.mkdirSync(templatesDir, { recursive: true });
            return res.status(200).json({ status: 'success', data: [] }); 
        }

        const baseUrl = `${req.protocol}://${req.get('host')}/api/resume/assets`;
        const files = fs.readdirSync(templatesDir);
        const templates = files
            .filter(file => file.match(/\.(png|jpe?g|webp)$/i))
            .map(file => {
                const id = file.replace(/\.[^/.]+$/, ""); 
                const name = id.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); 
                return { id, name, img: `${baseUrl}/${file}` };
            });

        res.status(200).json({ status: 'success', data: templates });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch template assets' });
    }
});

router.get('/draft', requireAuth, async (req, res) => {
    try {
        const [drafts] = await db.query('SELECT resume_data FROM resumes WHERE user_id = ?', [req.userId]);
        if (drafts.length > 0 && drafts[0].resume_data) {
            const data = typeof drafts[0].resume_data === 'string' ? JSON.parse(drafts[0].resume_data) : drafts[0].resume_data;
            return res.status(200).json({ status: 'success', data });
        }
        res.status(200).json({ status: 'success', data: null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch resume draft' });
    }
});

router.post('/draft', requireAuth, async (req, res) => {
    const { resumeData, rescore } = req.body;
    try {
        const jsonString = JSON.stringify(resumeData);
        const [existing] = await db.query('SELECT id FROM resumes WHERE user_id = ?', [req.userId]);
        
        // 1. Save JSON for the Frontend Builder
        if (existing.length > 0) {
            await db.query('UPDATE resumes SET resume_data = ? WHERE user_id = ?', [jsonString, req.userId]);
        } else {
            await db.query('INSERT INTO resumes (user_id, resume_data) VALUES (?, ?)', [req.userId, jsonString]);
        }

        // 🚨 CRITICAL FIX: Synchronize the structured JSON with the AI Engine's Plain Text Table
        let parsedText = '';
        if (resumeData.personal) {
            parsedText += `NAME: ${resumeData.personal.name || ''}\nEMAIL: ${resumeData.personal.email || ''}\nPHONE: ${resumeData.personal.phone || ''}\nSUMMARY: ${resumeData.personal.summary || ''}\n\n`;
        }
        if (Array.isArray(resumeData.experience)) {
            parsedText += `EXPERIENCE\n`;
            resumeData.experience.forEach(exp => {
                // Real payload uses role/dates; legacy drafts may use title/startDate/endDate.
                const role = exp.role || exp.title || '';
                const dates = exp.dates || [exp.startDate, exp.endDate].filter(Boolean).join(' - ');
                parsedText += `${role} at ${exp.company || ''} (${dates})\n${exp.description || ''}\n\n`;
            });
        }
        if (Array.isArray(resumeData.education)) {
            parsedText += `EDUCATION\n`;
            resumeData.education.forEach(edu => {
                const year = edu.year || edu.graduationDate || '';
                parsedText += `${edu.degree || ''} from ${edu.school || ''} (${year})\n\n`;
            });
        }
        if (resumeData.skills) {
            // Real payload sends skills as a string; tolerate an array of strings/objects.
            const skillsText = typeof resumeData.skills === 'string'
                ? resumeData.skills
                : (Array.isArray(resumeData.skills)
                    ? resumeData.skills.map(s => (typeof s === 'string' ? s : (s && s.name) || '')).filter(Boolean).join(', ')
                    : '');
            if (skillsText.trim()) parsedText += `SKILLS\n${skillsText.trim()}`;
        }

        // Persist the extracted text to the AI-ready table
        const builderText = parsedText.trim();
        const [existingAiResume] = await db.query('SELECT id FROM uploaded_resumes WHERE user_id = ?', [req.userId]);
        if (existingAiResume.length > 0) {
            await db.query('UPDATE uploaded_resumes SET parsed_text = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [builderText, 'PESO_Kabankalan_Builder.pdf', req.userId]);
        } else {
            await db.query('INSERT INTO uploaded_resumes (user_id, file_name, parsed_text) VALUES (?, ?, ?)', [req.userId, 'PESO_Kabankalan_Builder.pdf', builderText]);
        }

        // Re-score gating is now CLIENT-AUTHORITATIVE (§18.5 refinement, 2026-08-07).
        // The builder computes an "AI-relevant fingerprint" from the actual edit —
        // summary + experience + education + skills, the only fields the scorer reads —
        // and sends `rescore: false` when ONLY cosmetic fields changed (template, photo,
        // language, contact info). Those still persist here, but re-scoring the live
        // compatibility scores would be pure waste, so we skip the enqueue.
        //
        // This is SAFE where the old server-side content dirty-check was not (that one
        // was reverted for swallowing real re-scores): the decision is made from the
        // real form diff on the client, and `rescore` DEFAULTS TO TRUE when absent —
        // so any content change, any legacy caller, or any missing flag still re-scores.
        // A genuine content edit can never be silently swallowed.
        if (rescore !== false) {
            // A résumé content change → refresh the live compatibility scores on the
            // applicant's active applications (debounce+dedupe collapse rapid saves).
            applicationScoringService.enqueueForUser(req.userId);
            // G3.3: the résumé changed → the board's cached match PREVIEWS for this user are
            // now stale (computed against the old résumé). Invalidate them so the next board
            // open recomputes against the current résumé (the divergence fix).
            matchScoreCache.invalidateUser(req.userId);
            // Proactive re-match against open vacancies (P4, off unless PROACTIVE_REMATCH_ON_EDIT).
            proactiveReferralService.enqueueForSeeker(req.userId);
        }

        res.status(200).json({ status: 'success', message: 'Draft saved and synchronized with AI Engine successfully.' });
    } catch (error) {
        console.error("Draft Sync Error:", error);
        res.status(500).json({ error: 'Failed to save resume draft' });
    }
});

router.post('/optimize', requireAuth, aiLimiter, async (req, res) => {
    const { section, rawText } = req.body;
    try {
        const prompt = `You are an expert resume writer. Optimize the following ${section} section for ATS algorithms and professional impact. Keep it concise, action-oriented, and grammatically perfect.

CRITICAL INSTRUCTION: Return ONLY the raw optimized text. Do not include any introductory phrases, conversational filler, AI meta-commentary, or quotation marks:

${rawText}`;

        const raw = await aiClient.chat({
            messages: [{ role: "system", content: prompt }],
            temperature: 0.2,
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
    const { resumeData, targetLanguage } = req.body;
    try {
        const prompt = `You are a strict data localization engine. Translate the following JSON object into ${targetLanguage}.

CRITICAL RULES:
1. ONLY translate the string values (e.g., job titles, descriptions, summaries, skills).
2. DO NOT translate the JSON keys under any circumstances.
3. PRESERVE ALL ARRAYS EXACTLY AS THEY ARE. Do not summarize or count arrays.
4. Return ONLY valid JSON format. No markdown blocks, no conversational text.

Data to translate:
${JSON.stringify(resumeData)}`;

        const raw = await aiClient.chat({
            messages: [{ role: "system", content: prompt }],
            temperature: 0.1,
            tier: aiClient.TIER.CHAT,
            prefer: 'deepseek',
            extra: { response_format: { type: "json_object" } },
        });

        let translatedText = raw.trim();
        const jsonMatch = translatedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI did not return a recognizable JSON object.");

        let translatedData;
        try {
            translatedData = JSON.parse(jsonMatch[0]);

            // --- CRITICAL DEFENSIVE GUARD: DEEP MERGE ---
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

            const safeTranslatedData = mergeTranslation(resumeData, translatedData);
            
            // Explicitly force the IDs to survive in case the AI destroyed them
            if (Array.isArray(safeTranslatedData.experience)) {
                safeTranslatedData.experience = safeTranslatedData.experience.map((exp, idx) => ({
                    ...exp, id: resumeData.experience[idx]?.id || Date.now() + idx
                }));
            }
            if (Array.isArray(safeTranslatedData.education)) {
                safeTranslatedData.education = safeTranslatedData.education.map((edu, idx) => ({
                    ...edu, id: resumeData.education[idx]?.id || Date.now() + idx
                }));
            }

            safeTranslatedData.language = req.body.targetLanguage;
            res.status(200).json({ status: 'success', translatedData: safeTranslatedData });
        } catch (parseError) {
            return res.status(500).json({ status: 'error', message: 'The AI returned invalid formatting. Please try again.' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Translation service failed to process the document.' });
    }
});

router.post('/generate', requireAuth, async (req, res) => {
    const { resumeData } = req.body;

    if (!resumeData || !resumeData.personal) {
        return res.status(400).json({ status: 'error', message: 'Resume data is required.' });
    }

    try {
        const safeName = (resumeData.personal?.name || 'Untitled').replace(/[^a-zA-Z0-9]/g, '_');

        // Self-hosted generation. The PDF streams straight back -- no PDFMonkey,
        // no template dashboard, no polling loop. What renders is exactly what
        // resumePdfService.js draws, and it reads experience/education directly
        // from the payload the frontend already sends.
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_Resume.pdf"`);

        streamResume(resumeData, res);
    } catch (error) {
        console.error('[Resume] Generation failed:', error.message);
        // If headers were already sent, the stream is mid-flight -- just end it.
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: `PDF generation failed: ${error.message}` });
        } else {
            res.end();
        }
    }
});
// ==========================================
// 🚨 NEW: EXTERNAL PDF FILE UPLOAD
// ==========================================
router.post('/upload', requireAuth, upload.single('resume'), async (req, res) => {
    if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    if (!isPdfExtractAvailable()) return res.status(500).json({ status: 'error', message: 'pdf-parse library is missing on the server.' });

    try {
        // 1. Extract raw text from the uploaded PDF
        const pdfData = await extractPdfText(req.file.buffer);
        const extractedText = pdfData.text;

        // 2. Persist to the AI-ready table
        const uploadedText = extractedText.trim();
        const [existingAiResume] = await db.query('SELECT id FROM uploaded_resumes WHERE user_id = ?', [req.userId]);
        if (existingAiResume.length > 0) {
            await db.query('UPDATE uploaded_resumes SET parsed_text = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [uploadedText, req.file.originalname, req.userId]);
        } else {
            await db.query('INSERT INTO uploaded_resumes (user_id, file_name, parsed_text) VALUES (?, ?, ?)', [req.userId, req.file.originalname, uploadedText]);
        }

        // Enhancement B: a résumé (re)upload is a scoring-input change → ALWAYS refresh
        // the live compatibility scores on the applicant's active applications. (Résumé
        // dirty-checking was dropped — see the builder route; profile-save suppression stays.)
        applicationScoringService.enqueueForUser(req.userId);
        // G3.3: résumé (re)upload → invalidate this user's stale board match previews.
        matchScoreCache.invalidateUser(req.userId);
        // Proactive re-match against open vacancies (P4, off unless PROACTIVE_REMATCH_ON_EDIT).
        proactiveReferralService.enqueueForSeeker(req.userId);

        res.status(200).json({ status: 'success', message: 'Resume uploaded and processed successfully.' });
    } catch (error) {
        console.error("PDF Upload Parsing Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to process and parse the PDF document.' });
    }
});

module.exports = router;