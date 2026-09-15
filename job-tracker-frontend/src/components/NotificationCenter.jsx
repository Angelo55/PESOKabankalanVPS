import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, Loader2, Inbox, SlidersHorizontal } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';
import JobAlertSettings from './JobAlertSettings';
import { TYPE_META, timeAgo } from './layout/NotificationBell';
import EmptyState from './common/EmptyState';

/**
 * NOTIFICATION CENTER — the full, paged history behind the bell, plus per-type
 * mute controls (Phase 2 of the roadmap).
 *
 * The bell panel (NotificationBell) is delivery-only and capped at 40; this page
 * is the complete owner-scoped trail (GET /notifications/history, paged) and the
 * place a user turns individual notification types off (GET/PUT
 * /notifications/preferences). A muted type is suppressed at the single writer
 * (notificationService) — it never badges, toasts, or lands in this history.
 *
 * Mark-as-read routes through NotificationContext so the bell badge stays in sync.
 */

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const DEFAULT_META = { icon: Bell, source: 'Platform', classes: 'bg-gray-500/15 text-muted' };
const PAGE = 20;

const NotificationCenter = () => {
    const navigate = useNavigate();
    const { notify, markNotificationRead, markAllNotificationsRead, refreshMutedTypes } = useNotification();
    const { user } = useAuth();
    const isJobSeeker = normalizeRole(user?.role) === ROLE_KEYS.JOB_SEEKER;

    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    const [prefs, setPrefs] = useState([]);
    const [showSettings, setShowSettings] = useState(false);
    const [savingType, setSavingType] = useState(null);

    const loadHistory = useCallback(async (offset = 0, append = false) => {
        append ? setLoadingMore(true) : setLoading(true);
        try {
            const res = await API.get(`/notifications/history?limit=${PAGE}&offset=${offset}`, getAuthConfig());
            const rows = res.data?.data || [];
            setTotal(res.data?.total || 0);
            setItems((prev) => (append ? [...prev, ...rows] : rows));
        } catch {
            notify.error('Load failed', 'Could not load your notifications.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [notify]);

    const loadPrefs = useCallback(async () => {
        try {
            const res = await API.get('/notifications/preferences', getAuthConfig());
            setPrefs(res.data?.data || []);
        } catch {
            // Preferences are optional; the panel simply shows no toggles.
        }
    }, []);

    useEffect(() => { loadHistory(0, false); loadPrefs(); }, [loadHistory, loadPrefs]);

    const openItem = (item) => {
        if (!item.is_read) {
            markNotificationRead(item.id); // keeps the bell badge in sync
            setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)));
        }
        if (item.link) navigate(item.link);
    };

    const markAll = async () => {
        await markAllNotificationsRead();
        setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    };

    const toggleMute = async (type, muted) => {
        setSavingType(type);
        setPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, muted } : p))); // optimistic
        try {
            await API.put('/notifications/preferences', { type, muted }, getAuthConfig());
            refreshMutedTypes?.(); // keep the live toast-suppression set in sync
        } catch {
            setPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, muted: !muted } : p))); // revert
            notify.error('Save failed', 'Could not update that preference.');
        } finally {
            setSavingType(null);
        }
    };

    const unread = items.filter((n) => !n.is_read).length;
    const hasMore = items.length < total;

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-3xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast"><Bell size={22} /></div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Notifications</h1>
                        <p className="text-muted text-sm font-medium mt-0.5">
                            {total} total{unread > 0 ? ` · ${unread} unread on this page` : ''}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {unread > 0 && (
                        <button
                            onClick={markAll}
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-accent-text bg-accent-soft hover:bg-accent/15 transition-colors"
                        >
                            <CheckCheck size={15} /> Mark all read
                        </button>
                    )}
                    <button
                        onClick={() => setShowSettings((s) => !s)}
                        aria-expanded={showSettings}
                        className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${showSettings
                            ? 'text-white bg-accent hover:bg-accent-hover'
                            : 'text-content bg-surface border border-line hover:bg-sunken'}`}
                    >
                        <SlidersHorizontal size={15} /> Settings
                    </button>
                </div>
            </div>

            {/* Per-type mute controls */}
            {showSettings && (
                <div className="mb-6 bg-surface/80 rounded-2xl border border-line shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-line/60">
                        <h3 className="font-bold text-content text-sm">Notification types</h3>
                        <p className="text-xs text-muted mt-0.5">Muting a type stops new notifications of that kind — nothing is deleted.</p>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
                        {prefs.length === 0 && (
                            <li className="px-4 py-4 text-sm text-muted">Preferences are unavailable right now.</li>
                        )}
                        {prefs.map((p) => {
                            const meta = TYPE_META[p.type] || DEFAULT_META;
                            const Icon = meta.icon;
                            return (
                                <li key={p.type} className="px-4 py-3 flex items-center gap-3">
                                    <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${meta.classes}`}><Icon size={17} /></span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-content truncate">{p.label}</p>
                                        <p className="text-xs text-subtle">{meta.source}</p>
                                    </div>
                                    <button
                                        onClick={() => toggleMute(p.type, !p.muted)}
                                        disabled={savingType === p.type}
                                        role="switch"
                                        aria-checked={!p.muted}
                                        aria-label={`${p.muted ? 'Unmute' : 'Mute'} ${p.label}`}
                                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${p.muted ? 'bg-line' : 'bg-accent'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.muted ? 'translate-x-1' : 'translate-x-6'}`} />
                                    </button>
                                    <span className="w-14 text-right text-[11px] font-bold text-subtle hidden sm:inline-flex items-center justify-end gap-1">
                                        {p.muted ? <><BellOff size={12} /> Off</> : <><Bell size={12} /> On</>}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    {isJobSeeker && <JobAlertSettings />}
                </div>
            )}

            {/* History list */}
            <div className="bg-surface/80 rounded-2xl border border-line shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-12 flex items-center justify-center">
                        <Loader2 className="animate-spin text-accent-text" size={32} />
                    </div>
                ) : items.length === 0 ? (
                    <EmptyState
                        size="sm"
                        icon={Bell}
                        title="No notifications yet"
                        description={isJobSeeker
                            ? "This is your activity feed. Application updates, referral progress, new job postings, and messages from the PESO office will all show up here — so you never miss a step."
                            : "This is your activity feed. New applications, AI referral recommendations, and delivery updates will appear here as they happen."}
                        primaryAction={isJobSeeker
                            ? { label: 'Explore Vacancies', to: '/job-board' }
                            : { label: 'Open Applicant Pipeline', to: '/peso-admin/ats' }}
                    />
                ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
                        {items.map((item) => {
                            const meta = TYPE_META[item.type] || DEFAULT_META;
                            const Icon = meta.icon;
                            const isUnread = !item.is_read;
                            return (
                                <li key={item.id}>
                                    <button
                                        onClick={() => openItem(item)}
                                        className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors hover:bg-sunken ${isUnread ? 'bg-accent-soft/50' : ''}`}
                                    >
                                        <span className={`shrink-0 mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center ${meta.classes}`}><Icon size={17} /></span>
                                        <span className="flex-1 min-w-0">
                                            <span className="flex items-center gap-2">
                                                <span className={`text-sm truncate ${isUnread ? 'font-bold text-content' : 'font-semibold text-muted'}`}>{item.title}</span>
                                                {isUnread && <span className="shrink-0 w-2 h-2 rounded-full bg-accent dark:bg-accent-text" aria-label="Unread" />}
                                            </span>
                                            {item.body && <span className="block text-xs text-muted mt-0.5 leading-relaxed line-clamp-2">{item.body}</span>}
                                            <span className="block text-[11px] font-semibold text-subtle mt-1">{meta.source} · {timeAgo(item.created_at)}</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {hasMore && !loading && (
                    <div className="p-3 border-t border-line/60">
                        <button
                            onClick={() => loadHistory(items.length, true)}
                            disabled={loadingMore}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-accent-text bg-accent-soft hover:bg-accent/15 transition-colors disabled:opacity-60"
                        >
                            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
                            Load more ({total - items.length} older)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NotificationCenter;
