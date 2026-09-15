/**
 * CHAT CONTEXT — the app's ONLY socket connection.
 *
 * WHAT: opens one socket.io connection for the signed-in session and exposes it,
 * plus the unread message badge and a refresh trigger, to the rest of the app.
 *
 * WHEN: connects once the user is authenticated; disconnects on sign-out.
 *
 * ── THE RULE: ONE SOCKET, ONE OWNER ────────────────────────────────────────
 * Any new realtime feature adds a LISTENER to this socket. It must never call
 * io() again. Two connections mean two lifecycles, two reconnect policies, and
 * every server emit arriving twice — a class of bug that is very hard to
 * diagnose because it looks like the server sending duplicates.
 *
 * ── WHAT IT LISTENS FOR ────────────────────────────────────────────────────
 *   receive_message         a chat message for this user
 *   notification_created    a bell notification aimed at this user
 *   notification_broadcast  a platform-wide announcement (e.g. a new vacancy);
 *                           the payload carries targetRole and clients filter
 *                           locally, so one emit serves every job seeker
 *   referral_issued         a referral letter was delivered to this user
 *   scores_updated          a background re-score landed for one of THIS PESO
 *                           admin's vacancies — a silent refetch trigger for the
 *                           Applicant Pipeline (no toast, carries no data). The
 *                           pipeline still slow-polls as the backstop, so a missed
 *                           event costs immediacy, not correctness.
 *
 * ── THE QUIET SET ──────────────────────────────────────────────────────────
 * Some notification types already raise a toast from their own dedicated event.
 * The generic 'notification_created' listener skips those, otherwise a single
 * new message produced two identical pop-ups. The bell count is still refreshed
 * for every type — only the toast is suppressed.
 *
 * ── WHY THE SOCKET IS NOT THE SOURCE OF TRUTH ──────────────────────────────
 * Every event here has already been persisted server-side before it was emitted
 * (notificationService writes the row FIRST, then pushes). So a dropped socket
 * event costs immediacy, never data: the next fetch or page load shows the same
 * information. That is why nothing in this file needs delivery guarantees.
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useNotification } from './NotificationContext';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';
import API from '../api';

// Types whose dedicated socket events below already raise a toast; the generic
// 'notification_created' listener must not toast them a second time.
const ALREADY_TOASTED_TYPES = new Set(['NEW_MESSAGE', 'NEW_APPLICATION', 'REFERRAL_ISSUED']);

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const ChatContext = createContext();
export const useChat = () => useContext(ChatContext);

export const ChatProvider = ({ children }) => {
    const { user } = useAuth();
    const { notify, refreshNotifications, isTypeMuted } = useNotification();
    const [socket, setSocket] = useState(null);

    // The socket effect below must not re-run (and reconnect) every time the mute
    // set changes, so read the latest isTypeMuted through a ref instead of closing
    // over it.
    const isTypeMutedRef = useRef(isTypeMuted);
    useEffect(() => { isTypeMutedRef.current = isTypeMuted; }, [isTypeMuted]);
    const [unreadCount, setUnreadCount] = useState(0);
    // Purpose-specific refetch triggers (was one `globalUpdateTrigger` that every
    // consumer watched, so a chat message reloaded the whole ATS and a new
    // application refetched the message hub). Each consumer now subscribes only to
    // the trigger it cares about:
    //   messageUpdateTrigger    — a new/read message → unread count + conversations
    //   applicationUpdateTrigger — a new application → the Applicant Pipeline
    const [messageUpdateTrigger, setMessageUpdateTrigger] = useState(0);
    const [applicationUpdateTrigger, setApplicationUpdateTrigger] = useState(0);
    // Bumped on every `scores_updated` push. The Applicant Pipeline watches this
    // and does a silent refetch — the real-time half of hybrid polling. Kept
    // separate from the message/application triggers so a score nudge doesn't also
    // refire the unread-message / conversation / job fetches.
    const [pipelineRefreshTrigger, setPipelineRefreshTrigger] = useState(0);
    // Bumped on every `referral_outcome_updated` push — a referral's outcome moved
    // (an admin recorded one, or a seeker reported a suggestion). My Referrals and
    // the Referral Register watch this and silently refetch so both parties see the
    // same state at once. Carries no data; the row is already durable server-side.
    const [outcomeRefreshTrigger, setOutcomeRefreshTrigger] = useState(0);
    // Bumped when THIS seeker's PESO application moves stage — an ATS status change
    // (Applied → Under Review → Shortlisted, via the APPLICATION_STATUS notification)
    // or a referral being issued (→ Referred). The "PESO Applications" board watches
    // this and silently refetches so the card lands in the right column without a
    // reload. DB is the source of truth (0.3); the visibility backstop covers a miss.
    const [applicationStatusTrigger, setApplicationStatusTrigger] = useState(0);
    // Bumped when a vacancy is published / edited / has its status changed. The Public
    // Job Board watches this and does a SILENT refetch so a newly-published (or
    // closed/reopened/filled) vacancy appears live, without a manual reload. Carries no
    // data — the board reads the fresh list from the DB. A low-frequency visibility-gated
    // poll on the board backstops any missed event (and covers anonymous visitors, who
    // have no socket). Same durable-state + poll-backstop posture as the pipeline (§18.9).
    const [jobBoardRefreshTrigger, setJobBoardRefreshTrigger] = useState(0);

    // Fetch unread count whenever a global trigger fires or user logs in
    useEffect(() => {
        if (!user || user.role === 'admin') return;

        API.get('/messages/unread', getAuthConfig())
            .then(res => setUnreadCount(res.data.unreadCount || 0))
            .catch(err => console.error("Unread count fetch error"));

    }, [user, messageUpdateTrigger]);

    // Backstop: re-sync the unread message count when the tab regains focus. The
    // socket + triggerBadgeRefresh are the instant paths; this guarantees the badge
    // converges to the server's truth after a missed event or a dropped socket, with
    // no manual reload (the platform's durable-state + poll-backstop posture, §18.9).
    useEffect(() => {
        if (!user || user.role === 'admin') return;
        // Debounce (D1): collapse rapid tab switches so a burst of focus events makes
        // at most one /messages/unread call per MIN_REFETCH_MS. Socket + triggerBadgeRefresh
        // remain the instant paths; this is only the missed-event backstop.
        const MIN_REFETCH_MS = 20000;
        let lastAt = 0;
        const resync = () => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - lastAt < MIN_REFETCH_MS) return;
            lastAt = now;
            API.get('/messages/unread', getAuthConfig())
                .then(res => setUnreadCount(res.data.unreadCount || 0))
                .catch(() => {});
        };
        document.addEventListener('visibilitychange', resync);
        return () => document.removeEventListener('visibilitychange', resync);
    }, [user]);

    // ONE socket per authenticated session. This effect is keyed on the user's
    // IDENTITY (id + role), NOT the whole `user` object — so a profile edit that
    // calls updateUser()/refreshUser() (which replace the user object, §68) can no
    // longer tear down and rebuild the socket. Only a real login / logout / account
    // switch re-runs it. That is what stops the reconnect churn (and the request
    // storms it risks) on every unrelated profile update.
    useEffect(() => {
        const token = sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken');
        if (!token || !user || user.role === 'admin') return;

        // The realtime endpoint follows the SAME source as the REST client (api.js:
        // VITE_API_URL), minus the trailing /api. PRODUCTION MUST NEVER dial
        // localhost: if the env var is somehow unset in a prod build, fall back to
        // the page's own origin (never http://localhost:5000, which cannot resolve
        // from a remote host); only local dev uses the localhost default.
        const apiBase = import.meta.env.VITE_API_URL
            || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000/api');
        const SOCKET_URL = apiBase.replace(/\/api\/?$/, '');

        const newSocket = io(SOCKET_URL, {
            auth: { token },
            withCredentials: true,
            // POLLING FIRST, then upgrade to WebSocket. This is the graceful-fallback
            // ordering: the session establishes over HTTP long-polling (which works
            // behind every proxy, incl. Render's free tier) and silently UPGRADES to
            // WebSocket when the network allows; if the WS upgrade fails the socket
            // simply stays on polling instead of hard-failing with nothing to fall
            // back to. It also sidesteps the dev-only "WebSocket is closed before the
            // connection is established" warning: React StrictMode's throwaway mount
            // is torn down during the POLLING phase, so no raw WS handshake is aborted.
            transports: ['polling', 'websocket'],
            // Controlled reconnection with capped exponential backoff — never a retry
            // storm. socket.io owns the retries; do NOT add manual reconnect loops on
            // top (that is what produced the earlier messaging request-storm class of
            // bug). After the cap it stops and the durable-state + visibility/poll
            // backstops keep the UI correct until the next reload/focus.
            reconnection: true,
            reconnectionAttempts: 15,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 15000,
            randomizationFactor: 0.5,
            timeout: 20000,
        });

        newSocket.on('connect', () => console.log("Real-Time Notification Hub Active."));

        // Transient handshake failure (backend waking on free tier, network blip).
        // socket.io retries with the capped backoff above — this only logs; it must
        // NOT trigger any manual reconnect (that would defeat the backoff and storm).
        newSocket.on('connect_error', (err) => {
            console.warn('[Socket] connect_error (will retry with backoff):', err?.message || err);
        });
        // Reconnection gave up after the attempt cap — fail gracefully and quietly.
        // Live push pauses; the visibility-resync + slow polls (§18.9) keep state
        // converged, and the next focus/reload starts a fresh attempt.
        newSocket.io.on('reconnect_failed', () => {
            console.warn('[Socket] reconnection attempts exhausted; live updates paused until reload.');
        });

        newSocket.on('conversation_updated', (data) => {
            notify.info("New Message", "You have a new unread message in your hub.");
            setMessageUpdateTrigger(prev => prev + 1);
        });

        newSocket.on('new_application_received', (data) => {
            notify.success("New Applicant!", `Someone applied to your ${data.jobTitle} posting.`);
            setApplicationUpdateTrigger(prev => prev + 1);
        });

        newSocket.on('referral_issued', (data) => {
            notify.success("Referral Issued!", `PESO endorsed you for ${data.jobTitle}. Reference: ${data.referenceNumber}`);
            // The worker persists this notification itself (no notification_created
            // emit), so the bell refresh has to ride this event.
            refreshNotifications();
            // The application just became 'Referred' — nudge the PESO Applications
            // board so its card moves to the Referred column live.
            setApplicationStatusTrigger(prev => prev + 1);
        });

        // A durable notification row was just written for THIS user -> refresh
        // the bell panel. Toast only the types not already toasted above.
        newSocket.on('notification_created', (data) => {
            refreshNotifications();
            // A PESO Administrator moved this seeker's application to a new ATS stage
            // (Applied / Under Review / Shortlisted). Nudge the PESO Applications board
            // to refetch so the card follows the administrator's update in real time.
            if (data?.type === 'APPLICATION_STATUS') {
                setApplicationStatusTrigger(prev => prev + 1);
            }
            if (data?.type && !ALREADY_TOASTED_TYPES.has(data.type)) {
                notify.info(data.title || 'Notification', data.body || '');
            }
        });

        // A background re-score landed for one of this admin's vacancies. Bump the
        // trigger so the Applicant Pipeline refetches silently. No toast — this is a
        // background ranking refresh, not an announcement. Carries no scores; the
        // pipeline reads them from the owner-scoped DB endpoint.
        newSocket.on('scores_updated', () => {
            setPipelineRefreshTrigger(prev => prev + 1);
        });

        // A referral outcome moved (admin recorded, or seeker suggested). Bump the
        // trigger so My Referrals / the Register refetch silently. No toast here —
        // the durable notification row already toasts via notification_created.
        newSocket.on('referral_outcome_updated', () => {
            setOutcomeRefreshTrigger(prev => prev + 1);
        });

        // A vacancy was published / edited / had its status changed. Bump the trigger
        // so the Public Job Board silently refetches its list. No toast, no DB read
        // here — the board pulls the fresh list itself (mirrors 'scores_updated').
        newSocket.on('job_board_updated', () => {
            setJobBoardRefreshTrigger(prev => prev + 1);
        });

        // Platform-wide announcements (e.g. new job postings) target a role;
        // each client decides locally whether it applies to them.
        newSocket.on('notification_broadcast', (data) => {
            if (data?.targetRole === 'applicant' && normalizeRole(user?.role) === ROLE_KEYS.JOB_SEEKER) {
                // A new-vacancy announcement also means the board list changed — refresh
                // it silently (redundant with 'job_board_updated', harmless if both fire).
                if (data?.type === 'NEW_JOB') setJobBoardRefreshTrigger(prev => prev + 1);
                // A muted type wrote no bell row server-side; suppress its toast too.
                if (data?.type && isTypeMutedRef.current?.(data.type)) return;
                refreshNotifications();
                notify.info(data.title || 'Announcement', data.body || '');
            }
        });

        setSocket(newSocket);
        // Full teardown on auth change / unmount: drop every listener AND the socket
        // so no zombie connection or handler survives a logout or account switch.
        // removeAllListeners() first so an in-flight event can't fire into stale
        // closures during disconnect.
        return () => {
            newSocket.removeAllListeners();
            newSocket.io?.removeAllListeners?.();
            newSocket.disconnect();
            setSocket(null);
        };
    }, [user?.id, user?.role]);

    // Expose a manual trigger so the UI can clear the badge when a message is clicked.
    // Stable identity (useCallback) so it doesn't defeat the memoised value below.
    const triggerBadgeRefresh = useCallback(() => setMessageUpdateTrigger(prev => prev + 1), []);

    // MEMOISED so consumers only re-render when a value they read actually changes. A
    // bare object literal handed every consumer a new value on every provider render —
    // so a message-badge bump re-rendered the PESO dashboard (which only reads
    // applicationUpdateTrigger). Now the identity tracks the individual triggers.
    const contextValue = useMemo(() => ({
        socket, messageUpdateTrigger, applicationUpdateTrigger, pipelineRefreshTrigger,
        outcomeRefreshTrigger, applicationStatusTrigger, jobBoardRefreshTrigger, unreadCount,
        triggerBadgeRefresh,
    }), [socket, messageUpdateTrigger, applicationUpdateTrigger, pipelineRefreshTrigger, outcomeRefreshTrigger, applicationStatusTrigger, jobBoardRefreshTrigger, unreadCount, triggerBadgeRefresh]);

    return (
        <ChatContext.Provider value={contextValue}>
            {children}
        </ChatContext.Provider>
    );
};