import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, Filter, Loader, AlertCircle } from 'lucide-react';
import API from '../../../api';
import Pagination from '../../../components/common/Pagination';
import EmptyState from '../../../components/common/EmptyState';

/**
 * AUDIT TRAIL — the searchable record of what administrators did.
 *
 * WHAT: every entry in admin_audit_logs, filterable by action and date, with
 * paging.
 *
 * WHY IT EXISTS: the platform was writing an audit trail that nobody could
 * read. The only consumer was the dashboard's recent-activity panel, hardcoded
 * to the ten newest rows — so the rest of the history was unreachable through
 * the UI entirely. For a government system the trail IS the accountability
 * record; "we log it" is worthless if the log cannot be produced on request.
 *
 * WHEN: /admin/audit.
 *
 * PAGED SERVER-SIDE, unlike the referral register which filters in the browser.
 * The audit table only grows, and it grows fastest exactly when something has
 * gone wrong and an administrator most needs it to load.
 */

/**
 * Presentation per action. Unmapped actions still render, with a neutral style
 * and the raw name — a new action added server-side must never make an audit
 * entry invisible, which is the one thing an audit viewer cannot do.
 */
const ACTION_META = {
    ACCOUNT_SUSPENDED:     { label: 'Account suspended',   tone: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/50' },
    ACCOUNT_REACTIVATED:   { label: 'Account reactivated', tone: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50' },
    ROLE_CHANGED:          { label: 'Role changed',        tone: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50' },
    JOB_DELETED:           { label: 'Job removed',         tone: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/50' },
    SETTING_CHANGED:       { label: 'Setting changed',     tone: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/50' },
    VERIFICATION_REVIEWED: { label: 'Verification review', tone: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800/50' },
};
const DEFAULT_META = { label: null, tone: 'bg-sunken text-muted border-line' };

const formatStamp = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const AuditTrail = () => {
    const [entries, setEntries] = useState([]);
    const [total, setTotal] = useState(0);
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [action, setAction] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(1); // 1-based (shared Pagination)
    const [limit, setLimit] = useState(10);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit, offset: (page - 1) * limit });
            if (action) params.set('action', action);
            if (from) params.set('from', from);
            if (to) params.set('to', to);

            const res = await API.get(`/admin/audit-logs?${params}`);
            setEntries(res.data?.rows || []);
            setTotal(res.data?.total || 0);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not load the audit trail.');
        } finally {
            setLoading(false);
        }
    }, [action, from, to, page, limit]);

    useEffect(() => { load(); }, [load]);

    // Filter options come from the data, so an action with no entries is never
    // offered — picking it would be a guaranteed dead end.
    useEffect(() => {
        API.get('/admin/audit-logs/actions')
            .then((res) => setActions(res.data?.data || []))
            .catch(() => { /* the filter simply stays empty */ });
    }, []);

    // Any filter change invalidates the current page number.
    const changeFilter = (setter) => (value) => { setter(value); setPage(1); };
    const onLimitChange = (n) => { setLimit(n); setPage(1); };

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight flex items-center gap-3">
                    <ScrollText className="text-indigo-500" size={32} /> Audit Trail
                </h1>
                <p className="text-muted mt-2 font-medium">A permanent record of every administrative action taken on the platform.</p>
            </header>

            <div className="bg-surface p-4 rounded-2xl border border-line shadow-sm flex flex-col sm:flex-row gap-3 mb-5">
                <div className="relative flex-1 min-w-0">
                    <Filter className="absolute left-4 top-3.5 text-subtle" size={18} />
                    <select
                        value={action}
                        onChange={(e) => changeFilter(setAction)(e.target.value)}
                        aria-label="Filter by action"
                        className="w-full pl-12 pr-4 py-3 bg-sunken border-none rounded-xl text-sm font-bold text-muted outline-none cursor-pointer appearance-none"
                    >
                        <option value="">All actions</option>
                        {actions.map((a) => (
                            <option key={a} value={a}>{(ACTION_META[a] || {}).label || a}</option>
                        ))}
                    </select>
                </div>
                <input type="date" value={from} onChange={(e) => changeFilter(setFrom)(e.target.value)} aria-label="From date"
                    className="px-4 py-3 bg-sunken border-none rounded-xl text-sm font-medium text-muted outline-none" />
                <input type="date" value={to} onChange={(e) => changeFilter(setTo)(e.target.value)} aria-label="To date"
                    className="px-4 py-3 bg-sunken border-none rounded-xl text-sm font-medium text-muted outline-none" />
            </div>

            {!loading && !error && (
                <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={onLimitChange} position="top" />
            )}

            <div className="bg-surface rounded-3xl border border-line shadow-sm overflow-hidden">
                {error ? (
                    <p className="p-10 text-center text-sm font-medium text-rose-600 dark:text-rose-400 flex items-center justify-center gap-2">
                        <AlertCircle size={16} /> {error}
                    </p>
                ) : loading ? (
                    <div className="p-16 text-center"><Loader className="animate-spin text-indigo-500 mx-auto" size={32} /></div>
                ) : entries.length === 0 ? (
                    <EmptyState
                        size="sm"
                        variant="search"
                        icon={ScrollText}
                        title="No administrative actions found"
                        description="No audit entries match the current filters. Every privileged action — role changes, suspensions, setting updates, deletions — is recorded here; adjust the action type or date range to see more."
                    />
                ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse min-w-[640px]">
                            <thead>
                                <tr className="bg-sunken/50 border-b border-line text-xs font-black text-muted uppercase tracking-widest">
                                    <th className="p-4">Action</th>
                                    <th className="p-4">Target</th>
                                    <th className="p-4">Details</th>
                                    <th className="p-4">By</th>
                                    <th className="p-4 whitespace-nowrap">When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e) => {
                                    const meta = ACTION_META[e.action] || DEFAULT_META;
                                    return (
                                        <tr key={e.id} className="border-b border-line dark:border-line last:border-0 hover:bg-sunken/50 transition-colors align-top">
                                            <td className="p-4">
                                                <span className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border whitespace-nowrap ${meta.tone}`}>
                                                    {meta.label || e.action}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm font-bold text-content">{e.target_entity || '—'}</td>
                                            <td className="p-4 text-sm text-muted font-medium max-w-md">{e.action_details || '—'}</td>
                                            {/* A deleted administrator leaves admin_name null. "Unknown" is
                                                honest; blank would read as a rendering fault. */}
                                            <td className="p-4 text-sm font-medium text-muted whitespace-nowrap">{e.admin_name || 'Unknown'}</td>
                                            <td className="p-4 text-xs font-bold text-subtle whitespace-nowrap">{formatStamp(e.created_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {!loading && !error && (
                <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={onLimitChange} />
            )}
        </div>
    );
};

export default AuditTrail;
