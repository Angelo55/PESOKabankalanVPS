/**
 * MESSAGES HUB — applicant <-> PESO administrator conversations.
 *
 * WHAT: the REST half of chat. Conversation list, message history, read
 * receipts and unread counts. The realtime half (delivery, typing, live push)
 * lives in socketServer.js; both read and write the same tables, so a message
 * is identical whether it arrived over a socket or on a page refresh.
 *
 * WHEN: opening the Messages Hub, and whenever the socket reports activity.
 *
 * ── WHY BOTH PARTICIPANTS ARE RETURNED ─────────────────────────────────────
 * The conversation query selects the name, role and avatar of BOTH sides, and
 * the client decides which one is "the other person" by comparing user IDs
 * (see peerOf() in Messages.jsx).
 *
 * It is done by ID because the obvious alternative broke: code that tested
 * `user.role === 'employer'` never matched, since the stored role is
 * 'peso_administrator' and 'employer' is only a legacy alias. The result was a
 * PESO administrator seeing THEIR OWN name as the person they were talking to.
 * ID comparison is symmetric and has no role-string dependency at all.
 *
 * ── THUMBNAILS, NOT FULL AVATARS ───────────────────────────────────────────
 * The roster renders every conversation at once. Avatars are base64 data URIs
 * averaging ~319KB, so selecting the full-size column here cost megabytes per
 * page load. These queries select COALESCE(avatar_thumb, avatar_url): the small
 * variant when it exists, falling back to the original for rows uploaded before
 * thumbnails did — so nobody silently loses their picture.
 *
 * ── NOTIFICATIONS ──────────────────────────────────────────────────────────
 * Sending a message also writes a DEDUPLICATED bell notification: one unread
 * NEW_MESSAGE row per sender is refreshed rather than stacking a row per
 * message. Without that, a ten-message exchange produced ten unread badges for
 * the same conversation.
 */

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/authMiddleware');
const { writeLimiter } = require('../middleware/rateLimiters');

const router = express.Router();
router.use(requireAuth);

// ==========================================
// 1. AUTO-SCHEMA UPDATER (Zero-Crash Architecture)
// ==========================================
const initializeMessageTables = async () => {
    if (db.isPostgres) return; // schema owned by postgres/schema.sql
    try {
        try { await db.query('ALTER TABLE conversations ADD COLUMN job_id INT DEFAULT NULL'); } catch (e) {}
        try { await db.query('ALTER TABLE conversations ADD COLUMN last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'); } catch (e) {}
        try { await db.query('ALTER TABLE messages ADD COLUMN is_read BOOLEAN DEFAULT FALSE'); } catch (e) {}
        // Per-viewer conversation state (mute / pin / manual-unread). Canonical
        // schema lives in migration 050; created here too so a deploy is never
        // ahead of the migration (zero-crash pattern). Idempotent.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS conversation_states (
                    user_id         INT NOT NULL,
                    conversation_id INT NOT NULL,
                    is_muted        TINYINT(1) NOT NULL DEFAULT 0,
                    pinned_at       DATETIME NULL,
                    manually_unread TINYINT(1) NOT NULL DEFAULT 0,
                    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, conversation_id),
                    INDEX idx_conv_state_user_pinned (user_id, pinned_at)
                )
            `);
        } catch (e) {}
    } catch (error) {
        console.error("Messages Table Init Error:", error.message);
    }
};
initializeMessageTables();

// Max conversations a user may pin at once. Enforced server-side (transactional
// count) so it holds no matter which client issues the request. Sourced from the
// central quota catalogue (config/quotas.js) so it matches the /usage indicator.
const MAX_PINNED = require('../config/quotas').LIMITS.PINNED_CONVERSATIONS;

/**
 * Confirm the viewer is one of the two participants of a conversation. Returns
 * the conversation row (peso_admin_id, applicant_id) or null. Every state
 * mutation goes through this — a user can only touch their own conversations.
 */
async function loadParticipantConversation(conversationId, userId, conn = db) {
    const [rows] = await conn.query(
        'SELECT id, peso_admin_id, applicant_id FROM conversations WHERE id = ?',
        [conversationId]
    );
    if (rows.length === 0) return null;
    const conv = rows[0];
    if (conv.peso_admin_id !== userId && conv.applicant_id !== userId) return null;
    return conv;
}

/** Upsert one viewer's conversation_states row, setting only the given fields. */
async function upsertConversationState(userId, conversationId, fields, conn = db) {
    const cols = Object.keys(fields);
    const insertCols = ['user_id', 'conversation_id', ...cols];
    const placeholders = insertCols.map(() => '?').join(', ');
    const insertVals = [userId, conversationId, ...cols.map((c) => fields[c])];
    const updates = cols.map((c) => `${c} = VALUES(${c})`).join(', ');
    await conn.query(
        `INSERT INTO conversation_states (${insertCols.join(', ')}) VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE ${updates}`,
        insertVals
    );
}

// ==========================================
// 2. FETCH UNREAD NOTIFICATION COUNT
// ==========================================
router.get('/unread', async (req, res) => {
    try {
        // Muted conversations are excluded from the global bell count — muting a
        // conversation is exactly "stop badging me about it".
        const query = `
            SELECT COUNT(m.id) as unread_count
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            LEFT JOIN conversation_states cs ON cs.conversation_id = c.id AND cs.user_id = ?
            WHERE (c.peso_admin_id = ? OR c.applicant_id = ?)
              AND m.sender_id != ?
              AND m.is_read = FALSE
              AND COALESCE(cs.is_muted, 0) = 0
        `;
        const [[{ unread_count }]] = await db.query(query, [req.userId, req.userId, req.userId, req.userId]);
        res.status(200).json({ status: 'success', unreadCount: unread_count || 0 });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch unread counts.' });
    }
});

// ==========================================
// 3. FETCH ALL CONVERSATIONS
// ==========================================
router.get('/conversations', async (req, res) => {
    try {
        const query = `
            SELECT c.id, c.peso_admin_id, c.applicant_id, c.job_id, c.last_message_at,
                   u1.name AS employer_name,
                   u2.name AS applicant_name,
                   -- Identity of BOTH participants, so the chat header can show
                   -- whoever the viewer is NOT. Thumbnails (not full avatars):
                   -- the roster renders every conversation at once, so inlining
                   -- ~319KB images here would be megabytes per page load.
                   COALESCE(u1.avatar_thumb, u1.avatar_url) AS employer_avatar,
                   COALESCE(u2.avatar_thumb, u2.avatar_url) AS applicant_avatar,
                   u1.role AS employer_role,
                   u2.role AS applicant_role,
                   COALESCE(pj.title, 'Direct Inquiry') AS job_title,
                   -- Per-viewer state (mute / pin / manual-unread) + this viewer's
                   -- unread message count, so the roster can badge, pin and sort.
                   COALESCE(cs.is_muted, 0) AS is_muted,
                   cs.pinned_at AS pinned_at,
                   COALESCE(cs.manually_unread, 0) AS manually_unread,
                   (SELECT COUNT(*) FROM messages m
                      WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.is_read = FALSE) AS unread_count
            FROM conversations c
            INNER JOIN users u1 ON c.peso_admin_id = u1.id
            INNER JOIN users u2 ON c.applicant_id = u2.id
            LEFT JOIN pesoadmin_job_posts pj ON c.job_id = pj.id
            LEFT JOIN conversation_states cs ON cs.conversation_id = c.id AND cs.user_id = ?
            WHERE c.peso_admin_id = ? OR c.applicant_id = ?
            ORDER BY (cs.pinned_at IS NOT NULL) DESC, cs.pinned_at DESC, c.last_message_at DESC
        `;
        const [conversations] = await db.query(query, [req.userId, req.userId, req.userId, req.userId]);
        res.status(200).json({ status: 'success', data: conversations });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    }
});

// ==========================================
// 4. FETCH SPECIFIC HISTORY (AND MARK AS READ)
// ==========================================
router.get('/:conversationId', async (req, res) => {
    try {
        const [conv] = await db.query('SELECT peso_admin_id, applicant_id FROM conversations WHERE id = ?', [req.params.conversationId]);
        if (conv.length === 0) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
        
        if (conv[0].peso_admin_id !== req.userId && conv[0].applicant_id !== req.userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
        }

        const [messages] = await db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [req.params.conversationId]);

        // 🚨 Clear the unread badge when the user opens the chat — both the real
        // message flag AND any manual "mark as unread" the viewer had set.
        await db.query('UPDATE messages SET is_read = TRUE WHERE conversation_id = ? AND sender_id != ?', [req.params.conversationId, req.userId]);
        await upsertConversationState(req.userId, Number(req.params.conversationId), { manually_unread: 0 });

        res.status(200).json({ status: 'success', data: messages });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    }
});

// ==========================================
// 5. INITIALIZE CHAT (Bi-Directional Auto-Resolve)
// ==========================================
router.post('/conversations', writeLimiter, async (req, res) => {
    try {
        const { applicant_id, peso_admin_id, job_id } = req.body; 
        
        let finalApplicantId = applicant_id;
        let finalPesoAdminId = peso_admin_id;

        if (!finalPesoAdminId && job_id) {
            const [job] = await db.query('SELECT peso_admin_id FROM pesoadmin_job_posts WHERE id = ?', [job_id]);
            if (job.length > 0) finalPesoAdminId = job[0].peso_admin_id;
        }

        if (!finalApplicantId) finalApplicantId = req.userId;
        if (!finalPesoAdminId ) finalPesoAdminId  = req.userId;

        if (!finalApplicantId || !finalPesoAdminId ) return res.status(400).json({ status: 'error', message: 'Could not resolve chat participants.' });

        let findQuery = 'SELECT id FROM conversations WHERE peso_admin_id = ? AND applicant_id = ?';
        let params = [finalPesoAdminId , finalApplicantId];
        
        if (job_id) {
            findQuery += ' AND job_id = ?';
            params.push(job_id);
        } else {
            findQuery += ' AND job_id IS NULL';
        }

        const [existing] = await db.query(findQuery, params);
        if (existing.length > 0) return res.status(200).json({ status: 'success', conversationId: existing[0].id });

        const [result] = await db.query(
            'INSERT INTO conversations (peso_admin_id, applicant_id, job_id) VALUES (?, ?, ?)',
            [finalPesoAdminId , finalApplicantId, job_id || null]
        );

        res.status(201).json({ status: 'success', conversationId: result.insertId });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    }
});

// ==========================================
// 6. BATCH MARK READ / UNREAD (multi-select)
// ==========================================
// One controlled request for a whole selection — never one request per row.
// action 'read'   → messages.is_read = TRUE for incoming + clear manual-unread.
// action 'unread' → set the per-viewer manual-unread flag (messages stay as they
//                   are; "unread" here is a roster affordance, not un-reading text).
router.post('/conversations/state', writeLimiter, async (req, res) => {
    const { conversationIds, action } = req.body || {};
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
        return res.status(400).json({ status: 'error', message: 'conversationIds required.' });
    }
    if (!['read', 'unread'].includes(action)) {
        return res.status(400).json({ status: 'error', message: "action must be 'read' or 'unread'." });
    }
    // Sanitize to integers and cap the batch to a sane size.
    const ids = [...new Set(conversationIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
    if (ids.length === 0) return res.status(400).json({ status: 'error', message: 'No valid conversation ids.' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        // Scope to conversations the viewer actually participates in — a batch can
        // never touch a stranger's conversation.
        const placeholders = ids.map(() => '?').join(',');
        const [owned] = await conn.query(
            `SELECT id FROM conversations WHERE id IN (${placeholders}) AND (peso_admin_id = ? OR applicant_id = ?)`,
            [...ids, req.userId, req.userId]
        );
        const ownedIds = owned.map((r) => r.id);
        if (ownedIds.length === 0) { await conn.rollback(); return res.status(200).json({ status: 'success', updated: 0 }); }

        const ownedPlaceholders = ownedIds.map(() => '?').join(',');
        if (action === 'read') {
            await conn.query(
                `UPDATE messages SET is_read = TRUE WHERE conversation_id IN (${ownedPlaceholders}) AND sender_id != ?`,
                [...ownedIds, req.userId]
            );
        }
        // Upsert the manual-unread flag for each owned conversation (0 for read, 1 for unread).
        const manualVal = action === 'unread' ? 1 : 0;
        for (const cid of ownedIds) {
            await upsertConversationState(req.userId, cid, { manually_unread: manualVal }, conn);
        }
        await conn.commit();
        res.status(200).json({ status: 'success', updated: ownedIds.length });
    } catch (error) {
        await conn.rollback();
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    } finally {
        conn.release();
    }
});

// ==========================================
// 7. MUTE / UNMUTE
// ==========================================
router.patch('/:conversationId/mute', writeLimiter, async (req, res) => {
    try {
        const conversationId = Number(req.params.conversationId);
        const muted = req.body?.muted === true || req.body?.muted === 1 || req.body?.muted === '1';
        const conv = await loadParticipantConversation(conversationId, req.userId);
        if (!conv) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });
        await upsertConversationState(req.userId, conversationId, { is_muted: muted ? 1 : 0 });
        res.status(200).json({ status: 'success', is_muted: muted ? 1 : 0 });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    }
});

// ==========================================
// 8. PIN / UNPIN (max 5 per user, enforced server-side)
// ==========================================
router.patch('/:conversationId/pin', writeLimiter, async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    const pinned = req.body?.pinned === true || req.body?.pinned === 1 || req.body?.pinned === '1';
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const conv = await loadParticipantConversation(conversationId, req.userId, conn);
        if (!conv) { await conn.rollback(); return res.status(404).json({ status: 'error', message: 'Conversation not found.' }); }

        if (pinned) {
            // Count current pins (excluding this one) inside the transaction, so two
            // concurrent pin requests can't both slip past the cap.
            const [[{ pins }]] = await conn.query(
                'SELECT COUNT(*) AS pins FROM conversation_states WHERE user_id = ? AND pinned_at IS NOT NULL AND conversation_id <> ?',
                [req.userId, conversationId]
            );
            if (pins >= MAX_PINNED) {
                await conn.rollback();
                return res.status(409).json({ status: 'error', code: 'PIN_LIMIT', message: `You can pin up to ${MAX_PINNED} conversations. Unpin one first.` });
            }
            await upsertConversationState(req.userId, conversationId, { pinned_at: new Date() }, conn);
        } else {
            await upsertConversationState(req.userId, conversationId, { pinned_at: null }, conn);
        }
        await conn.commit();
        res.status(200).json({ status: 'success', pinned });
    } catch (error) {
        await conn.rollback();
        res.status(500).json({ status: 'error', message: `Server Error: ${error.message}` });
    } finally {
        conn.release();
    }
});

module.exports = router;