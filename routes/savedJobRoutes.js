const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);



// Palette keys the UI knows how to render. Validated server-side so a bad
// client can only ever store a known key (or clear it) — the column feeds a
// className lookup on the frontend, never raw CSS.
const COLOR_LABELS = ['red', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

// 2. Fetch Saved Jobs — the lightweight bookmark list.
//    Pinned rows sort first; the rest keep newest-saved-first ordering.
//
//    LEFT JOIN (was INNER): a bookmark whose vacancy the admin HARD-deleted must
//    still surface so the UI can show a "no longer available" tombstone instead of
//    the row silently vanishing. When the job is gone every pj.* column is NULL, so
//    `job_deleted` flags it and the title/company/location fall back to the snapshot
//    captured at save time (migration 034).
//
//    Explicit MINIMAL column set (was `pj.*`): the module no longer renders a full
//    job-detail panel or runs AI here (that is the Public Job Board's job), so it
//    only needs what the cards, the status badge, the filter bar, and the
//    active/tombstone decision use — never the heavy detail/AI columns.
//
//    saved_id is the saved_jobs ROW id (what Trash operates on) and is aliased
//    because it differs from job_id (the vacancy) — two keys once easy to confuse.
router.get('/', async (req, res) => {
    try {
        // deleted_at IS NULL keeps trashed vacancies out of the live list; they
        // live on in Trash until restored or purged (migration 018).
        const query = `
            SELECT sj.id AS saved_id, sj.job_id, sj.is_pinned, sj.color_label,
                   sj.saved_at, sj.last_checked_at,
                   (pj.id IS NULL) AS job_deleted,
                   COALESCE(pj.title, sj.job_title)       AS title,
                   COALESCE(pj.company, sj.job_company)   AS company,
                   COALESCE(pj.location, sj.job_location) AS location,
                   pj.status, pj.deadline, pj.category, pj.department,
                   pj.job_type, pj.work_setup, pj.description, pj.positions_available,
                   (SELECT COUNT(*)
                    FROM referral_queue rq
                    JOIN job_applications ja ON rq.application_id = ja.id
                    WHERE ja.job_id = pj.id AND rq.status = 'Approved') AS referred_count
            FROM saved_jobs sj
            LEFT JOIN pesoadmin_job_posts pj ON sj.job_id = pj.id
            WHERE sj.user_id = ? AND sj.deleted_at IS NULL
            ORDER BY sj.is_pinned DESC, sj.saved_at DESC
        `;
        const [savedJobs] = await db.query(query, [req.userId]);
        res.status(200).json({ status: 'success', data: savedJobs });

        // "Last checked" bookkeeping — stamp AFTER responding so the write never
        // adds latency to the list, and best-effort so a failure can't 500 a read
        // (invariant 0.1). The rows returned above carry the PRIOR check time, so
        // the UI can honestly say "last checked <ago>"; this bumps it for next load.
        db.query(
            'UPDATE saved_jobs SET last_checked_at = NOW() WHERE user_id = ? AND deleted_at IS NULL',
            [req.userId]
        ).catch(err => console.warn('[SavedJobs] last_checked_at touch skipped:', err.message));
    } catch (error) {
        console.error('[SavedJobs] GET / failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve saved jobs.' });
    }
});

// 2b. Update per-user organisation preferences (pin / colour label).
//     PATCH semantics: only the keys present in the body are written, so the
//     pin toggle and the colour picker never clobber one another. Ownership is
//     enforced by the user_id in the WHERE clause.
router.patch('/:jobId/preferences', async (req, res) => {
    try {
        const { is_pinned, color_label } = req.body;
        const sets = [];
        const params = [];

        if (is_pinned !== undefined) {
            sets.push('is_pinned = ?');
            params.push(is_pinned ? 1 : 0);
        }

        if (color_label !== undefined) {
            // '' / null clears the label; anything unrecognised is rejected
            // rather than silently stored.
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

        params.push(req.userId, req.params.jobId);
        const [result] = await db.query(
            `UPDATE saved_jobs SET ${sets.join(', ')} WHERE user_id = ? AND job_id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Saved job not found.' });
        }

        res.status(200).json({ status: 'success', message: 'Preferences updated.' });
    } catch (error) {
        console.error('[SavedJobs] PATCH preferences failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to update preferences.' });
    }
});

// 3. Save a Job (INSERT IGNORE prevents crashes on double-clicks)
router.post('/', async (req, res) => {
    try {
        const { job_id } = req.body;
        if (!job_id) return res.status(400).json({ status: 'error', message: 'Missing Job ID.' });

        // Capture a minimal snapshot (title/company/location) from the vacancy at
        // save time (migration 034), so the bookmark can render a proper tombstone
        // if the job is later hard-deleted. INSERT … SELECT pulls the snapshot from
        // the job row in one statement.
        //
        // Now that (user_id, job_id) is UNIQUE (migration 018), this is a real
        // upsert: re-saving a vacancy that is sitting in Trash REVIVES that row
        // (clearing deleted_at) and REFRESHES the snapshot to the job's current
        // title/company/location, instead of inserting a second one beside it.
        const [result] = await db.query(
            `INSERT INTO saved_jobs (user_id, job_id, job_title, job_company, job_location)
             SELECT ?, pj.id, pj.title, pj.company, pj.location
             FROM pesoadmin_job_posts pj WHERE pj.id = ?
             ON DUPLICATE KEY UPDATE
                deleted_at = NULL,
                job_title = VALUES(job_title),
                job_company = VALUES(job_company),
                job_location = VALUES(job_location)`,
            [req.userId, job_id]
        );
        // The SELECT matches nothing only when the job id does not exist — there is
        // no vacancy to bookmark, so report it rather than silently no-op.
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'That vacancy no longer exists.' });
        }
        res.status(201).json({ status: 'success', message: 'Job successfully saved.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to bookmark the job.' });
    }
});

// 4. Remove a Saved Job
router.delete('/:jobId', async (req, res) => {
    try {
        await db.query('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?', [req.userId, req.params.jobId]);
        res.status(200).json({ status: 'success', message: 'Job removed from saved list.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to remove the saved job.' });
    }
});

module.exports = router;