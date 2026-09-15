/**
 * REALTIME LAYER — socket.io wiring for chat and notification push.
 *
 * WHAT: authenticates socket connections, joins each user to a private room,
 * relays chat messages, and carries live notification pushes.
 *
 * WHEN: one connection per signed-in browser tab, opened by ChatContext on the
 * frontend and held for the life of the session.
 *
 * ── ROOMS ──────────────────────────────────────────────────────────────────
 * Every socket joins `user_<id>`. That is what lets the server push to ONE
 * person without broadcasting to everyone and filtering client-side — which
 * would mean every user's browser receiving every other user's notifications.
 *
 * ── MESSAGE FLOW (`send_message`) ──────────────────────────────────────────
 *   1. persist the message to the database
 *   2. emit it to the recipient's room
 *   3. write a deduplicated NEW_MESSAGE notification via notificationService
 *
 * Order matters: the row is written FIRST. A message pushed but not persisted
 * disappears on refresh, which is the one failure a chat cannot have.
 *
 * Step 3 is deduplicated on purpose — without it, a ten-message conversation
 * produced ten unread bell rows for the same sender.
 *
 * ── WHY THIS FILE IS SEPARATE FROM server.js ───────────────────────────────
 * Socket wiring is easy to break and hard to test. Keeping it isolated means
 * server.js stays a readable list of what the application mounts, and a change
 * to realtime behaviour cannot accidentally alter HTTP routing.
 *
 * ── ONE CONNECTION, ONE OWNER ──────────────────────────────────────────────
 * The frontend counterpart (src/context/ChatContext.jsx) owns the ONLY socket
 * in the app. New realtime features add listeners to it; they never open a
 * second connection. Two connections mean two lifecycles, two reconnect
 * policies, and duplicated events that are very hard to diagnose.
 */

const jwt = require('jsonwebtoken');
const db = require('./db');
const { notifyNewMessage } = require('./services/notificationService');

// Per-socket send throttle + content bounds. The REST half of chat is rate-limited
// (writeLimiter), but the realtime `send_message` path was UNBOUNDED — a scripted or
// compromised client could flood the DB + notification writes with no ceiling. A simple
// sliding window per socket connection is enough and never touches normal human typing.
// All env-tunable so ops can adjust without a deploy.
const SEND_WINDOW_MS = Number(process.env.SOCKET_SEND_WINDOW_MS) || 10000;
const SEND_MAX = Number(process.env.SOCKET_SEND_MAX) || 20;      // 20 messages / 10s per socket
const MAX_MESSAGE_CHARS = Number(process.env.SOCKET_MAX_MESSAGE_CHARS) || 4000;

module.exports = (io) => {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        if (!token) return next(new Error("Authentication Error: No token provided."));

        // No hardcoded fallback secret: a token can only be trusted if it was signed with the
        // real JWT_SECRET. (A public fallback key would let anyone forge a socket identity.)
        // JWT_SECRET is required app-wide anyway — authRoutes signs with it and no fallback.
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) return next(new Error("Authentication Error: Invalid token."));
            socket.userId = decoded.userId;
            socket.role = decoded.role;
            next();
        });
    });

    io.on('connection', (socket) => {
        // 1. Join a global user-specific room to receive platform-wide notifications
        socket.join(`user_${socket.userId}`);

        // 2. Join a specific conversation context
        socket.on('join_conversation', (conversationId) => {
            socket.join(`conv_${conversationId}`);
        });

        // 3. Handle incoming messages & automated synchronization
        socket.on('send_message', async (data, callback) => {
            // `tempId` is a client-generated correlation id for the sender's
            // optimistic bubble. It is echoed back untouched so the sending tab
            // can REPLACE that bubble with this authoritative row rather than
            // appending a second copy — which is what produced duplicated
            // outgoing messages for the sender (the recipient, having no
            // optimistic copy, correctly saw one).
            const { conversationId, content, tempId = null } = data || {};

            // Content guard — reject empty/oversized before any DB work (also stops a giant
            // string being persisted). `data || {}` above means a malformed emit can't crash us.
            const text = typeof content === 'string' ? content.trim() : '';
            if (!conversationId || !text) { if (callback) callback({ status: 'error', message: 'Message is empty.' }); return; }
            if (text.length > MAX_MESSAGE_CHARS) { if (callback) callback({ status: 'error', message: 'Message is too long.' }); return; }

            // Per-socket sliding-window throttle: drop the oldest timestamps outside the window,
            // then refuse once the ceiling is hit. Human chat never approaches SEND_MAX/window.
            const now = Date.now();
            socket._sendTimes = (socket._sendTimes || []).filter((t) => now - t < SEND_WINDOW_MS);
            if (socket._sendTimes.length >= SEND_MAX) {
                if (callback) callback({ status: 'error', message: 'You are sending messages too quickly. Please slow down.' });
                return;
            }
            socket._sendTimes.push(now);

            try {
                // Identify the recipient to route global notifications
                const [convs] = await db.query('SELECT peso_admin_id, applicant_id FROM conversations WHERE id = ?', [conversationId]);
                if (convs.length === 0) throw new Error("Conversation context not found.");

                const conv = convs[0];
                const recipientId = (conv.peso_admin_id === socket.userId) ? conv.applicant_id : conv.peso_admin_id;

                // Persist to database (the trimmed, length-checked text)
                const [result] = await db.query(
                    'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
                    [conversationId, socket.userId, text]
                );

                await db.query('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);

                const newMessage = {
                    id: result.insertId,
                    conversation_id: conversationId,
                    sender_id: socket.userId,
                    content: text,
                    created_at: new Date().toISOString(),
                    tempId // echoed for sender-side reconciliation; null for recipients' purposes
                };

                // Broadcast to the active chat pane. Deliberately `io.to(...)`
                // (everyone in the room, sender included) rather than
                // `socket.to(...)`: the sender needs this authoritative row to
                // swap in for its optimistic bubble, so the real DB id and
                // timestamp replace the placeholder ones. Any OTHER tab the
                // sender has open carries no matching tempId and simply appends,
                // which is also correct.
                io.to(`conv_${conversationId}`).emit('receive_message', newMessage);

                // Broadcast to recipient's global room (to trigger sidebar updates and notifications)
                io.to(`user_${recipientId}`).emit('conversation_updated', {
                    conversationId,
                    lastMessage: newMessage
                });

                // Durable bell notification for the recipient. Deduped inside the
                // service (one unread NEW_MESSAGE entry at a time) and never throws,
                // so it cannot fail the message that was already persisted above.
                try {
                    const [[sender]] = await db.query('SELECT name FROM users WHERE id = ?', [socket.userId]);
                    await notifyNewMessage(io, { userId: recipientId, senderName: sender?.name || null });
                } catch (notifError) {
                    console.error('[Socket] Message notification failed (message WAS delivered):', notifError.message);
                }

                if (callback) callback({ status: 'success' });
            } catch (error) {
                console.error("[Socket] Synchronization Error:", error);
                if (callback) callback({ status: 'error', message: 'Message failed to sync.' });
            }
        });

        // 4. Presence & Typing Indicators
        socket.on('typing', (data) => {
            socket.to(`conv_${data.conversationId}`).emit('user_typing', {
                userId: socket.userId,
                isTyping: data.isTyping
            });
        });

        socket.on('disconnect', () => {
            // Memory cleanup is handled natively by the Socket.IO lifecycle
        });
    });
};