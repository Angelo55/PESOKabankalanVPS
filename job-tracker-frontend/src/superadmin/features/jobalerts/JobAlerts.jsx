import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, Loader2, Power, PowerOff } from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';

/**
 * AI JOB ALERTS — Super Administrator monitor (Enhancement D). Read-only status
 * board over GET /admin/job-alerts: whether matching is enabled, the match-outbox
 * backlog, alerts delivered, and matches staged for the daily digest. Mirrors the
 * Email Delivery / Workflow Automation pages.
 */

const getAuthConfig = () => {
    const t = sessionStorage.getItem('jobTrackerToken');
    return t ? { headers: { Authorization: `Bearer ${t}` } } : {};
};

const Tile = ({ label, value, tone, hint }) => {
    const tones = { ok: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', idle: 'text-content' };
    return (
        <div className="bg-surface/80 rounded-2xl border border-line shadow-sm p-5">
            <p className={`text-3xl font-black tabular-nums leading-none ${tones[tone] || tones.idle}`}>{value}</p>
            <p className="text-sm font-bold text-muted mt-2">{label}</p>
            {hint && <p className="text-xs text-subtle mt-0.5">{hint}</p>}
        </div>
    );
};

const JobAlerts = () => {
    const { notify } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async ({ silent = false } = {}) => {
        silent ? setRefreshing(true) : setLoading(true);
        try {
            const res = await API.get('/admin/job-alerts', getAuthConfig());
            setData(res.data?.data || null);
        } catch {
            notify.error('Load failed', 'Could not load job-alert status.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify]);
    useEffect(() => { load(); }, [load]);

    if (loading) {
        return <div className="p-8 min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-accent-text" size={36} /></div>;
    }

    const enabled = !!data?.enabled;
    const c = data?.counts || {};

    return (
        <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen animate-fade-scale-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast"><Sparkles size={22} /></div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">AI Job Alerts</h1>
                        <p className="text-muted text-sm font-medium mt-0.5">Vacancy matching &amp; seeker alert delivery.</p>
                    </div>
                </div>
                <button onClick={() => load({ silent: true })} disabled={refreshing} className="self-start inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-accent hover:bg-accent-hover shadow-sm transition-colors disabled:opacity-60">
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            <div className={`mb-6 rounded-2xl border p-4 flex items-center gap-3 ${enabled ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/20' : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-900/20'}`}>
                {enabled ? <Power className="text-emerald-600 dark:text-emerald-400" size={20} /> : <PowerOff className="text-amber-600 dark:text-amber-400" size={20} />}
                <p className="text-sm font-semibold text-content">
                    {enabled
                        ? 'Matching is enabled. New vacancies are matched to seekers and alerts are delivered automatically.'
                        : 'Job alerts are disabled (JOB_ALERTS_ENABLED is not set). Publishing a vacancy queues no matching until the flag is turned on.'}
                </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Tile label="Pending match jobs" value={c.pending ?? 0} tone={(c.pending || 0) > 0 ? 'warn' : 'ok'} hint="Vacancies awaiting matching" />
                <Tile label="Failed" value={c.failed ?? 0} tone={(c.failed || 0) > 0 ? 'warn' : 'ok'} hint="Dead-lettered match tasks" />
                <Tile label="Alerts sent" value={c.sent ?? 0} tone="ok" hint="Emails delivered" />
                <Tile label="Staged for digest" value={c.staged ?? 0} tone="idle" hint="Awaiting the daily digest" />
            </div>

            <p className="text-xs text-subtle mt-6">
                Tune the AI threshold, per-day cap, candidate cap and default frequency in Settings. Seekers control their own frequency and can unsubscribe from any alert email.
            </p>
        </div>
    );
};

export default JobAlerts;
