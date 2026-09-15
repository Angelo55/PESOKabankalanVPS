/**
 * NOTIFICATION CONTEXT — two different things, deliberately in one place.
 *
 * WHAT:
 *   1. TOASTS      the transient pop-ups: notify.success/error/warning/info.
 *                  Purely visual, never persisted, gone in a few seconds.
 *   2. THE BELL    the durable notification store behind the top-header bell:
 *                  the list, the unread count, and the mark-as-read actions.
 *
 * WHY BOTH LIVE HERE: a single arriving event usually needs both — a toast so
 * the user notices it now, and a bell row so they can find it later. Splitting
 * them into two providers meant every emit point had to remember to call both.
 *
 * ── WHERE THE BELL DATA COMES FROM ─────────────────────────────────────────
 * GET /api/notifications on mount, then ChatContext's socket listeners call
 * refreshNotifications() when a live event arrives. The DATABASE is always the
 * source of truth; the socket only shortens the delay before a refetch.
 *
 * ── markVisitedLink(pathname) ──────────────────────────────────────────────
 * Called by TopHeader on EVERY route change. Notifications whose deep link
 * points at the page you just opened are marked read automatically — reading
 * the Applicant Pipeline IS acknowledging "you have a new application", and
 * making the user then click the bell to clear a badge for something they have
 * already seen is busywork.
 *
 * ── OPTIMISTIC MARK-AS-READ ────────────────────────────────────────────────
 * Clicking a notification updates local state immediately and sends the PATCH
 * afterwards. A badge that lags behind the click feels broken, and the cost of
 * being wrong is trivial: the next refresh restores the true state.
 *
 * ── SUPER ADMINISTRATORS ARE SKIPPED ───────────────────────────────────────
 * The AdminLayout has no TopHeader, so there is no bell to fill. Fetching for
 * that role would be a request whose result nothing can ever display.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import API from '../api';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const NotificationContext = createContext();

export const useNotification = () => useContext(NotificationContext);

/**
 * One toast, owning its own dismissal lifecycle.
 *
 * WHY PER-CARD AND NOT A CONTEXT-LEVEL setTimeout: only the card knows when the
 * pointer is over it, and modern toasts pause their countdown on hover so a user
 * reading one is never robbed of it mid-sentence. The progress bar and the timer
 * are driven by the SAME `paused` flag, so what the bar shows and when the toast
 * actually leaves can never disagree.
 *
 * Lifecycle:
 *   • auto-dismiss after `duration` (0 = persist, e.g. loading toasts)
 *   • hover / focus  → pause (bar freezes, timer holds the remaining time)
 *   • leave / blur   → resume from the remaining time
 *   • click the body → reset to a full duration (a deliberate "keep this" nudge)
 *   • dismiss        → play a 300ms exit, THEN unmount (enter ease-out / exit ease-in)
 */
const ToastCard = ({ toast, config, onClose }) => {
    const duration = toast.duration ?? 4000;
    const auto = duration > 0;

    const [paused, setPaused] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [cycle, setCycle] = useState(0);        // bump → restart the progress bar
    const remainingRef = useRef(duration);
    const startRef = useRef(0);
    const timerRef = useRef(null);
    const leaveRef = useRef(null);

    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

    const close = useCallback(() => {
        if (leaveRef.current) return;             // already leaving
        clearTimer();
        setLeaving(true);
        leaveRef.current = setTimeout(() => onClose(toast.id), 300); // matches exit anim
    }, [onClose, toast.id]);

    // (Re)start / pause the dismissal timer whenever pause state or cycle changes.
    useEffect(() => {
        if (!auto || leaving) return;
        if (paused) { clearTimer(); return; }
        startRef.current = Date.now();
        timerRef.current = setTimeout(close, remainingRef.current);
        return clearTimer;
    }, [auto, paused, leaving, cycle, close]);

    useEffect(() => () => { clearTimer(); if (leaveRef.current) clearTimeout(leaveRef.current); }, []);

    const pause = () => {
        if (!auto || paused || leaving) return;
        // Bank how much time is left so resume continues, not restarts.
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current));
        setPaused(true);
    };
    const resume = () => { if (auto && paused && !leaving) setPaused(false); };
    const reset = () => {
        if (!auto || leaving) return;
        remainingRef.current = duration;
        setCycle((c) => c + 1);                   // restart the bar from full
    };

    return (
        <div
            role="status"
            aria-live="polite"
            onMouseEnter={pause}
            onMouseLeave={resume}
            onFocus={pause}
            onBlur={resume}
            onClick={reset}
            className={`pointer-events-auto relative w-80 overflow-hidden backdrop-blur-2xl p-4 rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] duration-300 motion-reduce:animate-none motion-reduce:duration-0 ${config.bg} ${config.border} ${
                leaving
                    ? 'animate-out fade-out slide-out-to-right-8 ease-in'
                    : 'animate-in slide-in-from-top-5 fade-in ease-out'
            }`}
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">{config.icon}</div>
                <div className="flex-1">
                    <h4 className="text-sm font-bold text-content tracking-tight">{toast.title}</h4>
                    {toast.message && <p className="text-xs text-muted mt-1 font-medium leading-relaxed">{toast.message}</p>}
                    {toast.action && (
                        <button
                            onClick={(e) => { e.stopPropagation(); toast.action.onClick?.(); close(); }}
                            className="mt-2 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-black hover:opacity-90 transition-opacity duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-900"
                        >
                            {toast.action.label}
                        </button>
                    )}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); close(); }}
                    aria-label="Dismiss notification"
                    className="text-subtle hover:text-content dark:hover:text-white transition-colors duration-100"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Countdown bar — only for auto-dismissing toasts. `key={cycle}` restarts
                it on reset; play-state freezes it on hover. */}
            {auto && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/5 dark:bg-surface/5">
                    <div
                        key={cycle}
                        className={`toast-progress h-full ${config.bar}`}
                        style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                    />
                </div>
            )}
        </div>
    );
};

export const NotificationProvider = ({ children }) => {
    const { user } = useAuth();
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState({ isOpen: false, title: '', message: '', resolve: null });

    // ── Persistent bell notifications (backed by /api/notifications) ─────────
    // Toasts above are ephemeral; these are the durable records shown in the
    // TopHeader bell panel. Super admins use AdminLayout (no TopHeader), so we
    // skip fetching for them — same convention as ChatContext.
    const [notifications, setNotifications] = useState([]);
    const [unreadNotifCount, setUnreadNotifCount] = useState(0);
    // Signature of the last applied bell payload. The backstop poll + the
    // visibilitychange refetch below run on EVERY tab-focus; without this, each one
    // called setNotifications with a fresh array (identical content, new reference),
    // re-rendering this provider and cascading a re-render into every consumer —
    // including the PESO dashboard and its recharts. We now skip the state update when
    // the payload is unchanged, so a focus/poll that finds nothing new is a true no-op.
    const notifSigRef = useRef('');

    // Per-type mute set (migration 028). A muted type's DURABLE bell row is already
    // suppressed server-side, but a platform BROADCAST (new vacancy) is one io-wide
    // socket emit that cannot know per-user prefs — so the client suppresses the
    // transient toast for locally-muted types. Fetched for non-admins.
    const [mutedTypes, setMutedTypes] = useState(() => new Set());

    const refreshMutedTypes = useCallback(async () => {
        if (!sessionStorage.getItem('jobTrackerToken')) return;
        try {
            const res = await API.get('/notifications/preferences', getAuthConfig());
            setMutedTypes(new Set((res.data?.data || []).filter(p => p.muted).map(p => p.type)));
        } catch (err) {
            // Non-critical: default to nothing muted (never suppress a toast on error).
        }
    }, []);

    const isTypeMuted = useCallback((type) => mutedTypes.has(type), [mutedTypes]);

    const refreshNotifications = useCallback(async () => {
        if (!sessionStorage.getItem('jobTrackerToken')) return;
        try {
            const res = await API.get('/notifications', getAuthConfig());
            if (res.data?.status === 'success') {
                const list = res.data.data || [];
                const count = res.data.unreadCount || 0;
                // A stable fingerprint of what actually matters for rendering: the unread
                // count plus each row's id + read state. If it is unchanged from the last
                // applied payload, skip the state update entirely — no re-render, no
                // consumer cascade. New rows change ids; a read/unread flip changes the
                // per-row token; both correctly fall through and update.
                const sig = `${count}|${list.map(n => `${n.id}:${n.is_read}`).join(',')}`;
                if (sig === notifSigRef.current) return;
                notifSigRef.current = sig;
                setNotifications(list);
                setUnreadNotifCount(count);
            }
        } catch (err) {
            // A failed refresh degrades to a stale panel, never an error state.
        }
    }, []);

    useEffect(() => {
        if (user && user.role !== 'admin') {
            refreshNotifications();
            refreshMutedTypes();
        } else {
            setNotifications([]);
            setUnreadNotifCount(0);
            setMutedTypes(new Set());
        }
    }, [user, refreshNotifications, refreshMutedTypes]);

    // Backstop refetch for the bell. The socket (ChatContext) is the INSTANT path —
    // it calls refreshNotifications() the moment an event arrives — but some
    // notifications are emitted by a background WORKER (e.g. REFERRAL_ISSUED from the
    // referral worker's notify step) rather than a web route, and a dropped/degraded
    // socket or a worker-process split (SKILL §25, no Redis bridge yet) can miss that
    // push. A visibility-gated poll + a refetch on tab-focus guarantees the bell
    // converges to the server's truth within the interval WITHOUT a manual reload,
    // the same durable-state + poll-backstop posture the Applicant Pipeline uses
    // (§18.9). DB is the source of truth; this only shortens the worst-case delay.
    useEffect(() => {
        if (!user || user.role === 'admin') return;
        const POLL_MS = Number(import.meta.env.VITE_NOTIF_POLL_MS) || 45000;
        // Debounce (D1): the socket is the primary path; this poll + the tab-focus
        // refetch are backstops. Collapse rapid tab switches so returning to the tab
        // N times in quick succession makes at most ONE request per MIN_REFETCH_MS,
        // instead of one per focus. The 45s interval poll is unaffected (> the window).
        const MIN_REFETCH_MS = 20000;
        let lastAt = 0;
        const tick = () => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - lastAt < MIN_REFETCH_MS) return;
            lastAt = now;
            refreshNotifications();
        };
        const id = setInterval(tick, POLL_MS);
        document.addEventListener('visibilitychange', tick);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
    }, [user, refreshNotifications]);

    const markNotificationRead = useCallback(async (id) => {
        // Optimistic: the badge drops immediately; the PATCH persists it.
        notifSigRef.current = ''; // local state now diverges from the last synced payload
        setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: 1 } : n)));
        setUnreadNotifCount(prev => Math.max(0, prev - 1));
        try {
            await API.patch(`/notifications/${id}/read`, {}, getAuthConfig());
        } catch (err) {
            refreshNotifications();
        }
    }, [refreshNotifications]);

    const markAllNotificationsRead = useCallback(async () => {
        notifSigRef.current = '';
        setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
        setUnreadNotifCount(0);
        try {
            await API.patch('/notifications/read-all', {}, getAuthConfig());
        } catch (err) {
            refreshNotifications();
        }
    }, [refreshNotifications]);

    // Auto-acknowledge on visit: navigating to a module clears every unread
    // notification that deep-links to it. Only fires when something would change.
    const markVisitedLink = useCallback(async (pathname) => {
        const affected = notifications.filter(n => !n.is_read && n.link === pathname).length;
        if (affected === 0) return;
        notifSigRef.current = '';
        setNotifications(prev => prev.map(n => (n.link === pathname ? { ...n, is_read: 1 } : n)));
        setUnreadNotifCount(prev => Math.max(0, prev - affected));
        try {
            await API.patch('/notifications/read-by-link', { link: pathname }, getAuthConfig());
        } catch (err) {
            refreshNotifications();
        }
    }, [notifications, refreshNotifications]);

    // `action` (optional) renders an inline button inside the toast — used by the
    // soft-delete flow for "Undo". It is a plain { label, onClick } pair; the
    // toast dismisses itself once the action runs.
    const showToast = useCallback((type, title, message = '', duration = 4000, action = null) => {
        const id = Math.random().toString(36).substring(2, 9);
        // Auto-dismiss is now owned by each ToastCard (so it can pause on hover and
        // show a progress bar). The duration travels ON the toast; the context no
        // longer runs a blind setTimeout. duration <= 0 means "persist" (loading
        // toasts, removed explicitly via notify.remove).
        setToasts((prev) => [...prev, { id, type, title, message, action, duration }]);
        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    // MEMOISED so `notify` keeps a STABLE identity across renders. It was a fresh
    // object literal every render, and this provider re-renders on its 45s bell poll
    // and on every `visibilitychange` (below). Any consumer that put `notify` in a
    // useEffect/useCallback dependency array therefore re-ran on every tab-focus —
    // which silently reloaded the PESO dashboard (PesoAdminOverview's `load`) and
    // re-triggered the Resume Builder's autosave (its init effect). Both underlying
    // methods (showToast/removeToast) are already stable useCallbacks, so this memo
    // never needs to change. Do NOT turn this back into a bare object literal.
    const notify = useMemo(() => ({
        success: (title, msg, dur) => showToast('success', title, msg, dur),
        error: (title, msg, dur) => showToast('error', title, msg, dur),
        warning: (title, msg, dur) => showToast('warning', title, msg, dur),
        info: (title, msg, dur) => showToast('info', title, msg, dur),
        loading: (title, msg, dur = 0) => showToast('loading', title, msg, dur),
        // Toast carrying an inline action, e.g. { label: 'Undo', onClick }.
        // Given a longer default window so the action is genuinely reachable.
        action: (title, msg, action, dur = 8000) => showToast('info', title, msg, dur, action),
        remove: removeToast
    }), [showToast, removeToast]);

    const confirm = useCallback((title, message) => {
        return new Promise((resolve) => {
            setConfirmState({ isOpen: true, title, message, resolve });
        });
    }, []);

    const handleConfirmClose = (result) => {
        if (confirmState.resolve) confirmState.resolve(result);
        setConfirmState({ isOpen: false, title: '', message: '', resolve: null });
    };

    const getToastConfig = (type) => {
        switch (type) {
            case 'success': return { icon: <CheckCircle className="text-emerald-500" size={24} />, bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', border: 'border-emerald-500/30', bar: 'bg-emerald-500' };
            case 'error': return { icon: <AlertCircle className="text-rose-500" size={24} />, bg: 'bg-rose-500/10 dark:bg-rose-500/20', border: 'border-rose-500/30', bar: 'bg-rose-500' };
            case 'warning': return { icon: <AlertTriangle className="text-amber-500" size={24} />, bg: 'bg-amber-500/10 dark:bg-amber-500/20', border: 'border-amber-500/30', bar: 'bg-amber-500' };
            case 'info': return { icon: <Info className="text-sky-500" size={24} />, bg: 'bg-sky-500/10 dark:bg-sky-500/20', border: 'border-sky-500/30', bar: 'bg-sky-500' };
            case 'loading': return { icon: <Loader2 className="text-indigo-500 animate-spin" size={24} />, bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', border: 'border-indigo-500/30', bar: 'bg-indigo-500' };
            default: return { icon: <Info size={24} />, bg: 'bg-gray-500/10', border: 'border-line0/30', bar: 'bg-gray-500' };
        }
    };

    // MEMOISED so the context value only gets a new identity when a field consumers
    // read actually changes. Without this, an unrelated re-render of this provider (a
    // toast being added/removed, for instance) handed every consumer a brand-new value
    // object and re-rendered all of them. All the functions here are stable useCallbacks
    // / a memoised `notify`, so the identity now tracks the data (notifications /
    // unread count / muted types) alone.
    const contextValue = useMemo(() => ({
        notify, confirm,
        notifications, unreadNotifCount,
        refreshNotifications, markNotificationRead, markAllNotificationsRead, markVisitedLink,
        isTypeMuted, refreshMutedTypes
    }), [notify, confirm, notifications, unreadNotifCount, refreshNotifications, markNotificationRead, markAllNotificationsRead, markVisitedLink, isTypeMuted, refreshMutedTypes]);

    return (
        <NotificationContext.Provider value={contextValue}>
            {children}

            {/* --- TOAST RENDERER --- */}
            <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
                {toasts.map((toast) => (
                    <ToastCard
                        key={toast.id}
                        toast={toast}
                        config={getToastConfig(toast.type)}
                        onClose={removeToast}
                    />
                ))}
            </div>

            {/* --- CONFIRMATION MODAL RENDERER --- */}
            {confirmState.isOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in pointer-events-auto">
                    <div className="bg-raised/80 backdrop-blur-2xl rounded-[2rem] p-8 max-w-sm w-full shadow-2xl border border-white/40 dark:border-line animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl"><AlertTriangle size={28} /></div>
                            <h3 className="text-xl font-black text-content leading-tight">{confirmState.title}</h3>
                        </div>
                        <p className="text-muted mb-8 font-medium text-sm leading-relaxed">{confirmState.message}</p>
                        <div className="flex gap-3">
                            <button onClick={() => handleConfirmClose(false)} className="flex-1 px-5 py-3 bg-sunken hover:bg-line text-content rounded-xl font-bold transition-colors">
                                Cancel
                            </button>
                            <button onClick={() => handleConfirmClose(true)} className="flex-1 px-5 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold shadow-lg shadow-rose-500/30 transition-all hover:-translate-y-0.5">
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </NotificationContext.Provider>
    );
};