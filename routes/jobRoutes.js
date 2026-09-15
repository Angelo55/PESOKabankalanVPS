const express = require('express');
const router = express.Router();
const db = require('../db');
const aiClient = require('../services/aiClient');
const { scoreApplication } = require('../services/aiScoringService');
const { createTtlCache } = require('../utils/ttlCache');
const matchScoreCache = require('../services/matchScoreCache');
const requireAuth = require('../middleware/authMiddleware');
const { aiLimiter } = require('../middleware/rateLimiters');

// Board AI-match preview cache now lives in services/matchScoreCache.js (get/set by
// userId+jobId) so the résumé-change sites can invalidate a user's previews the moment
// their résumé changes (G3.3) — a stale preview was the board-vs-pipeline divergence.
// Scoring is temperature 0 (deterministic), so a cached score stays correct until the
// résumé/job changes; the TTL bounds staleness.
// Explore-Similar-Jobs recommendation cache (per user+job). The recommendation is
// résumé-driven and changes slowly, so caching skips a ~1.2s DeepSeek call on every
// repeat job-open (measured hotspot). Only successful AI results are cached — never
// the degraded fallback — so a transient AI outage self-heals on the next open.
const similarCache = createTtlCache({ ttlMs: Number(process.env.SIMILAR_CACHE_TTL_MS) || 600000, max: 2000 });

const safeQuery = async (queryText, params, defaultResponse) => {
    try {
        const [rows] = await db.query(queryText, params);
        return rows;
    } catch (error) {
        console.warn(`[SafeQuery Warning] Skipping query: ${error.message}`);
        return defaultResponse;
    }
};

// =======================================================
// 1. PERSONAL APPLICATION TRACKING (KANBAN ATS)
// =======================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const [jobs] = await db.query('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC', [req.userId]);
        res.status(200).json({ status: 'success', data: jobs });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch jobs' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    const { company, position, status, location, salary, notes } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO applications (user_id, company, position, status, location, salary, notes, applied_date) VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())',
            [req.userId, company, position, status || 'Applied', location, salary, notes]
        );
        res.status(201).json({ status: 'success', job: { id: result.insertId, company, position, status } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to create job' });
    }
});

router.put('/:id/status', requireAuth, async (req, res) => {
    const { status } = req.body;
    try {
        await db.query('UPDATE applications SET status = ? WHERE id = ? AND user_id = ?', [status, req.params.id, req.userId]);
        res.status(200).json({ status: 'success', message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to update status' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        await db.query('DELETE FROM applications WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        res.status(200).json({ status: 'success', message: 'Job deleted' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to delete job' });
    }
});


// =======================================================
// 2. AI COMPATIBILITY & SIMILAR JOB RECOMMENDATIONS
// =======================================================

// 🚨 ARCHITECTURAL FIX: Query the new dedicated AI Persistence Layer
const getApplicantResume = async (userId) => {
    // Attempt 1: Check the new dedicated uploaded_resumes table
    const dedicatedTable = await safeQuery(
        'SELECT parsed_text FROM uploaded_resumes WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1', 
        [userId], []
    );
    if (dedicatedTable.length > 0 && dedicatedTable[0].parsed_text) return dedicatedTable[0].parsed_text;

    // Attempt 2: Fallback to legacy resumes table
    const legacyTable = await safeQuery(
        'SELECT parsed_text FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', 
        [userId], []
    );
    if (legacyTable.length > 0 && legacyTable[0].parsed_text) return legacyTable[0].parsed_text;

    return null; // Resume missing or not parsed
};

// Generate DeepSeek AI Match Score
router.post('/match', aiLimiter, requireAuth, async (req, res) => {
    const { jobId } = req.body;
    
    try {
        // Cache check FIRST: scoring is deterministic (temp 0), so a cached score is a
        // correct score until the résumé/job changes. Returning here skips BOTH the
        // résumé read and the job read on a repeat open (the common case).
        const cachedScore = matchScoreCache.get(req.userId, jobId);
        if (cachedScore) {
            return res.status(200).json({ status: 'success', data: cachedScore, cached: true });
        }

        const applicantResume = await getApplicantResume(req.userId);

        if (!applicantResume || applicantResume.trim().length === 0) {
            return res.status(200).json({
                status: 'resume_required',
                message: 'A parsed resume is required to perform AI matching and generate compatibility scores.'
            });
        }

        const [job] = await db.query('SELECT * FROM pesoadmin_job_posts WHERE id = ?', [jobId]);
        if (job.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Job posting not found.' });
        }

        // B1 (Tier-1 recalibration): the board scores through the SAME core as
        // apply-time / re-scoring — one prompt, one validator, one shape — so the board
        // estimate and the stored score are computed from identical inputs (job
        // skills/qualifications/experience/education included), not a thinner board-only
        // prompt that measurably lost ~15 pts of band accuracy in the eval. scoreApplication
        // returns a VALIDATED score or NULL (never a fabricated fallback — the old inline
        // path returned raw parsed JSON with no range check); NULL surfaces as the same
        // "temporarily unavailable" state as before.
        //
        // Pass the résumé we already fetched so scoreApplication doesn't re-read it (it
        // would otherwise call the same getApplicantResume internally — a duplicate query).
        const score = await scoreApplication({ userId: req.userId, job: job[0], resumeText: applicantResume });
        if (!score) {
            return res.status(200).json({
                status: 'ai_unavailable',
                message: 'The AI compatibility service is temporarily unavailable. Please try again shortly.'
            });
        }
        matchScoreCache.set(req.userId, jobId, score);
        res.status(200).json({ status: 'success', data: score });

    } catch (error) {
        console.error("AI Match Pipeline Error:", error);
        res.status(500).json({ status: 'error', message: 'An internal error occurred during AI analysis.' });
    }
});


// Explore Similar Jobs Recommendation Engine
router.get('/:id/similar', requireAuth, async (req, res) => {
    try {
        const applicantResume = await getApplicantResume(req.userId);
        
        if (!applicantResume || applicantResume.trim().length === 0) {
            return res.status(200).json({ 
                status: 'resume_required', 
                message: 'A parsed resume is required to generate personalized job recommendations.' 
            });
        }

        const simKey = `${req.userId}:${req.params.id}`;
        const cachedSimilar = similarCache.get(simKey);
        if (cachedSimilar) return res.status(200).json({ status: 'success', data: cachedSimilar, cached: true });

        const [allJobs] = await db.query("SELECT * FROM pesoadmin_job_posts WHERE status IN ('Open', 'Published') AND id != ?", [req.params.id]);
        if (allJobs.length === 0) return res.status(200).json({ status: 'success', data: [] });

        // 🧠 DEEPSEEK SIMILARITY EXECUTION
        const jobsContext = allJobs.map(j => `ID: ${j.id} | Title: ${j.title} | Company: ${j.company}`).join('\n');
        
        const aiPrompt = `You are a Career AI. Based on the resume, select the top 3 most suitable job IDs from the Active Jobs list.
Return ONLY a valid JSON array of IDs (e.g., [12, 45, 8]) with NO markdown or extra text.

Resume:
${applicantResume.substring(0, 2000)}

Active Jobs:
${jobsContext}`;

        try {
            const aiRaw = await aiClient.chat({
                messages: [{ role: "user", content: aiPrompt }],
                temperature: 0.2,
                tier: aiClient.TIER.CHAT,
                prefer: 'openrouter',
            });

            const aiContent = aiRaw.trim().replace(/```json/g, '').replace(/```/g, '');
            const recommendedIds = JSON.parse(aiContent);

            if (Array.isArray(recommendedIds)) {
                // The AI SELECTS relevant jobs from the resume; it does not score
                // each one. Stapling on a per-card compatibility percentage here
                // was a FABRICATION (invariant 0.2) and directly contradicted the
                // real /jobs/match score shown on the detail view — a job the AI
                // rated a "Low Match" would surface as "98% Match" on its card,
                // because that number was literally Math.random(). We tag the
                // REASON the card is shown instead, never an invented score.
                const recommendedJobs = allJobs
                    .filter(j => recommendedIds.includes(j.id))
                    .map(j => ({ ...j, recommendation_reason: 'profile' }));
                similarCache.set(simKey, recommendedJobs); // cache only the real AI result
                return res.status(200).json({ status: 'success', data: recommendedJobs });
            }
        } catch (aiError) {
            console.error("DeepSeek Similar Jobs Failure:", aiError.message);
        }

        // AI unavailable: fall back to recent live vacancies. These are NOT
        // resume-matched, so they are tagged 'related' rather than 'profile' so
        // the card cannot overclaim personalisation it did not perform.
        const fallback = allJobs.slice(0, 3).map(j => ({ ...j, recommendation_reason: 'related' }));
        res.status(200).json({ status: 'success', data: fallback });

    } catch (error) {
        console.error("Similar Jobs Engine Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to generate similar job recommendations.' });
    }
});

module.exports = router;