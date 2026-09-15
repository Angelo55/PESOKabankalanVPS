import React, { useState, useEffect, useCallback } from 'react';
import {
    Workflow, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Clock,
    Send, PlugZap, Unplug,
} from 'lucide-react';
import API from '../../../api';
import EmptyState from '../../../components/common/EmptyState';
import { useNotification } from '../../../context/NotificationContext';

/**
 * WORKFLOW AUTOMATION — Super Administrator monitor + replay for the downstream
 * automation dispatch (Make.com after the 2026-09 migration; formerly self-hosted n8n).
 *
 * The automation is a DOWNSTREAM consumer (invariant 0.10): a referral is fully complete —
 * letter generated, emailed, applicant notified — before the automation is ever contacted.
 * If it is unreachable the dispatch step retries with backoff, then SKIPS
 * (never dead-letters the referral), leaving a sync gap. This page surfaces that
 * gap platform-wide and lets an admin RE-QUEUE the dispatch once it is back —
 * which re-runs only the dispatch step, never the letter.
 */

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const StatTile = ({ label, value, tone, hint }) => {
    const tones = {
        ok: 'text-emerald-600 dark:text-emerald-400',
        warn: 'text-amber-600 dark:text-amber-400',
        idle: 'text-content',
    };
    return (
        <div className="bg-surface/80 rounded-2xl border border-line shadow-sm p-5">
            <p className={`text-3xl font-black tabular-nums leading-none ${tones[tone] || tones.idle}`}>{value}</p>
            <p className="text-sm font-bold text-muted mt-2">{label}</p>
            {hint && <p className="text-xs text-subtle font-medium mt-0.5">{hint}</p>}
        </div>
    );
};

const WorkflowAutomation = () => {
    const { notify } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [replaying, setReplaying] = useState(false);

    const load = useCallback(async ({ silent = false } = {}) => {
        if (silent) setRefreshing(true); else setLoading(true);
        try {
            const res = await API.get('/admin/automation', getAuthConfig());
            setData(res.data?.data || null);
            setSelected(new Set());
        } catch (error) {
            notify.error('Load failed', 'Could not load automation status.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify]);

    useEffect(() => { load(); }, [load]);

    const undispatched = data?.recentUndispatched || [];
    const counts = data?.counts || {};

    const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const allSelected = undispatched.length > 0 && undispatched.every((r) => selected.has(r.queue_id));
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(undispatched.map((r) => r.queue_id)));

    const replay = async (ids) => {
        if (ids.length === 0) return;
        setReplaying(true);
        try {
            const res = await API.post('/admin/automation/replay', { queueIds: ids }, getAuthConfig());
            notify.success('Replay queued', res.data?.message || 'Dispatch re-queued.');
            await load({ silent: true });
        } catch (error) {
            notify.error('Replay failed', error.response?.data?.message || 'Could not re-queue dispatch.');
        } finally {
            setReplaying(false);
        }
    };

    if (loading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-accent-text" size={36} />
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast"><Workflow size={22} /></div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Workflow Automation</h1>
                        <p className="text-muted text-sm font-medium mt-0.5">Make.com automation dispatch status &amp; recovery.</p>
                    </div>
                </div>
                <button
                    onClick={() => load({ silent: true })}
                    disabled={refreshing}
                    className="self-start inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-accent hover:bg-accent-hover shadow-sm transition-colors disabled:opacity-60"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* automation connection banner */}
            <div className={`mb-6 rounded-2xl border p-4 flex items-center gap-3 ${data?.configured
                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/20'
                : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-900/20'}`}>
                {data?.configured ? <PlugZap className="text-emerald-600 dark:text-emerald-400" size={20} /> : <Unplug className="text-amber-600 dark:text-amber-400" size={20} />}
                <p className="text-sm font-semibold text-content">
                    {data?.configured
                        ? 'The automation webhook (Make.com) is configured. Referrals dispatch automatically; the queue below is what still needs to sync.'
                        : 'No automation webhook is configured (AUTOMATION_WEBHOOK_URL unset). Dispatch is skipped by design — referrals still complete normally.'}
                </p>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatTile label="Dispatched" value={counts.dispatched ?? 0} tone="ok" hint="Reached the automation" />
                <StatTile label="Undispatched" value={counts.undispatched ?? 0} tone={(counts.undispatched || 0) > 0 ? 'warn' : 'ok'} hint="Completed, not synced" />
                <StatTile label="Pending" value={counts.pending ?? 0} tone="idle" hint="Dispatch in flight" />
                <StatTile label="Dead-lettered" value={counts.failed ?? 0} tone={(counts.failed || 0) > 0 ? 'warn' : 'ok'} hint="In Failed Referrals" />
            </div>

            {/* Undispatched list + replay */}
            <div className="bg-surface/80 rounded-2xl border border-line shadow-sm overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-line/60">
                    <h3 className="font-bold text-content flex items-center gap-2">
                        <AlertTriangle size={18} className="text-amber-500" /> Undispatched referrals
                    </h3>
                    {undispatched.length > 0 && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => replay([...selected])}
                                disabled={replaying || selected.size === 0}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50"
                            >
                                {replaying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Replay selected ({selected.size})
                            </button>
                            <button
                                onClick={() => replay(undispatched.map((r) => r.queue_id))}
                                disabled={replaying}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-accent-text bg-accent-soft dark:bg-raised/50 hover:bg-accent/15 dark:hover:bg-raised transition-colors disabled:opacity-50"
                            >
                                Replay all
                            </button>
                        </div>
                    )}
                </div>

                {undispatched.length === 0 ? (
                    <EmptyState
                        size="sm"
                        variant="success"
                        title="Everything is synced"
                        description="No completed referrals are waiting on the automation — every dispatch has gone through. If a referral ever completes without reaching it, it will appear here so you can replay just the dispatch step."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm min-w-[640px]">
                            <thead className="bg-sunken/70 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-muted">
                                <tr>
                                    <th className="p-3 w-10">
                                        <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="accent-[#1a4a38] w-4 h-4" />
                                    </th>
                                    <th className="p-3 font-bold">Reference</th>
                                    <th className="p-3 font-bold">Applicant</th>
                                    <th className="p-3 font-bold">Vacancy</th>
                                    <th className="p-3 font-bold whitespace-nowrap">Approved</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                                {undispatched.map((r) => (
                                    <tr key={r.queue_id} className="hover:bg-sunken/60 dark:hover:bg-raised/30">
                                        <td className="p-3">
                                            <input type="checkbox" checked={selected.has(r.queue_id)} onChange={() => toggle(r.queue_id)} aria-label={`Select ${r.reference_number || r.queue_id}`} className="accent-[#1a4a38] w-4 h-4" />
                                        </td>
                                        <td className="p-3 font-mono text-xs font-bold text-content">{r.reference_number || `#${r.queue_id}`}</td>
                                        <td className="p-3 text-muted">{r.applicant_name}</td>
                                        <td className="p-3 text-muted">{r.job_title}{r.company_name ? ` · ${r.company_name}` : ''}</td>
                                        <td className="p-3 text-subtle whitespace-nowrap"><span className="inline-flex items-center gap-1"><Clock size={12} /> {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : '—'}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkflowAutomation;
