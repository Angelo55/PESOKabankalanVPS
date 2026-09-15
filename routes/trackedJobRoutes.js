const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const multer = require('multer');
const xlsx = require('xlsx');

// Configure Multer to store the uploaded file in memory
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.use(requireAuth);

const TABLE_NAME = 'usertrackedjobs';

// ==========================================
// STANDARD CRUD ROUTES (STRICTLY ISOLATED)
// ==========================================

// Palette keys the UI knows how to render. Validated server-side so a bad
// client can only ever store a known key (or clear it) — the column feeds a
// className lookup on the frontend, never raw CSS.
const COLOR_LABELS = ['red', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

router.get('/', async (req, res) => {
    try {
        // Pinned first, then newest. The Kanban groups by status client-side, so
        // this ordering lands as "pinned to the top of its own column" — pinning
        // never moves a card between stages.
        // deleted_at IS NULL keeps trashed applications out of the board; they
        // live on in Trash until restored or purged (migration 018).
        const [jobs] = await db.query(
            `SELECT * FROM ${TABLE_NAME} WHERE user_id = ? AND deleted_at IS NULL
             ORDER BY is_pinned DESC, id DESC`,
            [req.userId]
        );
        res.status(200).json(jobs);
    } catch (error) {
        console.error("GET Jobs Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

// Per-user organisation preferences (pin / colour label) for a pipeline card.
// PATCH semantics: only keys present in the body are written, so the pin toggle
// and colour picker never clobber each other. Ownership enforced by user_id.
router.patch('/:id/preferences', async (req, res) => {
    try {
        const { is_pinned, color_label } = req.body;
        const sets = [];
        const params = [];

        if (is_pinned !== undefined) {
            sets.push('is_pinned = ?');
            params.push(is_pinned ? 1 : 0);
        }

        if (color_label !== undefined) {
            const value = color_label === null || color_label === '' ? null : String(color_label);
            if (value !== null && !COLOR_LABELS.includes(value)) {
                return res.status(400).json({ status: 'error', message: 'Unknown colour label.' });
            }
            sets.push('color_label = ?');
            params.push(value);
        }

        if (sets.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update.' });
        }

        params.push(req.userId, req.params.id);
        const [result] = await db.query(
            `UPDATE ${TABLE_NAME} SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Application record not found.' });
        }

        res.status(200).json({ status: 'success', message: 'Preferences updated.' });
    } catch (error) {
        console.error("PATCH Preferences Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

router.post('/', async (req, res) => {
    const job = req.body;
    try {
        const [result] = await db.query(
            `INSERT INTO ${TABLE_NAME} 
            (user_id, company, job_title, job_description, job_type, work_setup, industry, status, date_applied, application_source, link, interview_stage, interview_dates, interview_notes, expected_salary, offered_salary, contact_name, notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.userId, job.company || '', job.job_title || '', job.job_description || '', job.job_type || 'Full-Time', 
                job.work_setup || 'On-site', job.industry || '', job.status || 'Applied', job.date_applied || new Date(), 
                job.application_source || '', job.link || '', job.interview_stage || '', job.interview_dates || '', 
                job.interview_notes || '', job.expected_salary || '', job.offered_salary || '', job.contact_name || '', job.notes || ''
            ]
        );
        res.status(201).json({ status: 'success', id: result.insertId });
    } catch (error) {
        console.error("POST Job Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

// Bulk status update for the seeker's imported/tracked applications (My Applications
// card board, multi-select). One atomic UPDATE, owner-scoped + trash-aware. MUST be
// declared before '/:id' and '/:id/status' or 'bulk' would be captured as an :id.
router.put('/bulk/status', async (req, res) => {
    const { ids, status } = req.body || {};
    const list = (Array.isArray(ids) ? ids : []).map(n => parseInt(n, 10)).filter(Number.isInteger);
    if (list.length === 0) return res.status(400).json({ status: 'error', message: 'No applications selected.' });
    if (!status || typeof status !== 'string') return res.status(400).json({ status: 'error', message: 'A status is required.' });
    try {
        const [result] = await db.query(
            `UPDATE ${TABLE_NAME} SET status = ? WHERE user_id = ? AND id IN (?) AND deleted_at IS NULL`,
            [status, req.userId, list]
        );
        res.status(200).json({ status: 'success', data: { updated: result.affectedRows } });
    } catch (error) {
        console.error('Bulk tracked-job status error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to update the selected applications.' });
    }
});

router.put('/:id', async (req, res) => {
    const jobId = req.params.id;
    const job = req.body;
    try {
        await db.query(
            `UPDATE ${TABLE_NAME} SET 
            company = ?, job_title = ?, job_description = ?, job_type = ?, work_setup = ?, industry = ?, status = ?, date_applied = ?, application_source = ?, link = ?, interview_stage = ?, interview_dates = ?, interview_notes = ?, expected_salary = ?, offered_salary = ?, contact_name = ?, notes = ? 
            WHERE id = ? AND user_id = ?`,
            [
                job.company, job.job_title, job.job_description, job.job_type, job.work_setup, job.industry, job.status, job.date_applied, job.application_source, job.link, job.interview_stage, job.interview_dates, job.interview_notes, job.expected_salary, job.offered_salary, job.contact_name, job.notes,
                jobId, req.userId
            ]
        );
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error("PUT Job Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

router.put('/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await db.query(`UPDATE ${TABLE_NAME} SET status = ? WHERE id = ? AND user_id = ?`, [status, req.params.id, req.userId]);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error("PUT Status Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query(`DELETE FROM ${TABLE_NAME} WHERE id = ? AND user_id = ?`, [req.params.id, req.userId]);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error("DELETE Job Error:", error.message);
        res.status(500).json({ status: 'error', message: `Database Error: ${error.message}` });
    }
});

// ==========================================
// EXCEL / CSV IMPORT PIPELINE WITH VALIDATION
// ==========================================

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (rawData.length === 0) {
            return res.status(400).json({ status: 'error', message: 'The uploaded spreadsheet is empty.' });
        }

        // 🚨 BULLETPROOF FIX: Normalize all headers to lowercase and trim spaces
        const normalizedData = rawData.map(row => {
            const normalizedRow = {};
            for (const key in row) {
                if (row.hasOwnProperty(key)) {
                    normalizedRow[key.toString().toLowerCase().trim()] = row[key];
                }
            }
            return normalizedRow;
        });

        // --- NEW: INTELLIGENT STRUCTURE VALIDATION PHASE ---
        // Verify the spreadsheet actually contains job tracking columns before touching the DB
        const isValidStructure = normalizedData.some(row => {
            const company = row['company'] || row['company name'] || row['employer'] || row['organization'];
            const jobTitle = row['job title'] || row['title'] || row['position'] || row['role'];
            return company && jobTitle;
        });

        if (!isValidStructure) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'The uploaded spreadsheet does not match the expected job application tracking format. Please upload a valid Excel tracker containing "Company" and "Job Title" columns.' 
            });
        }
        // --------------------------------------------------

        const [existingJobs] = await db.query(`SELECT company, job_title FROM ${TABLE_NAME} WHERE user_id = ?`, [req.userId]);
        const existingSet = new Set(existingJobs.map(j => `${(j.company || '').toLowerCase().trim()}|${(j.job_title || '').toLowerCase().trim()}`));

        let addedCount = 0;
        let duplicateCount = 0;
        let invalidCount = 0;

        for (const row of normalizedData) {
            // Check against the normalized lowercase headers
            const company = row['company'] || row['company name'] || row['employer'] || row['organization'];
            const jobTitle = row['job title'] || row['title'] || row['position'] || row['role'];
            const status = row['status'] || row['application status'] || 'Applied';
            
            let dateApplied = new Date();
            if (row['date applied'] || row['date']) {
                const parsedDate = new Date(row['date applied'] || row['date']);
                if (!isNaN(parsedDate.getTime())) dateApplied = parsedDate;
            }

            if (!company || !jobTitle) {
                invalidCount++;
                continue;
            }

            const uniquenessKey = `${company.toString().toLowerCase().trim()}|${jobTitle.toString().toLowerCase().trim()}`;
            if (existingSet.has(uniquenessKey)) {
                duplicateCount++;
                continue;
            }

            await db.query(
                `INSERT INTO ${TABLE_NAME} (user_id, company, job_title, status, date_applied) VALUES (?, ?, ?, ?, ?)`,
                [req.userId, company.toString(), jobTitle.toString(), status.toString(), dateApplied]
            );

            existingSet.add(uniquenessKey); 
            addedCount++;
        }

        res.status(200).json({
            status: 'success',
            message: 'Import complete.',
            stats: { added: addedCount, duplicates: duplicateCount, invalid: invalidCount }
        });

    } catch (error) {
        console.error("Excel Parsing Error:", error.message);
        res.status(500).json({ status: 'error', message: `Import Error: ${error.message}` });
    }
});

module.exports = router;