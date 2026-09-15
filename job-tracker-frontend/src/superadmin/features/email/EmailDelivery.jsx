import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Mail, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Clock,
    Send, Power, PowerOff, Search,
} from 'lucide-react';
import API from '../../../api';
import EmptyState from '../../../components/common/EmptyState';
import Pagination from '../../../components/common/Pagination';
import useClientPagination from '../../../hooks/useClientPagination';
import { useNotification } from '../../../context/NotificationContext';

/**
 * EMAIL DELIVERY — Super Administrator monitor + resend for the generic email
 * outbox (Phase 2C).
 *
 * Every attachment-less transactional email (password reset, contact-inquiry
 * notification, OTP signup code, security alerts) is queued in `email_outbox`
 * and drained by a background worker with retry + backoff + dead-letter — the
 * same durability referral letters already have. This page surfaces the queue
 * platform-wide and lets an admin RESEND a dead-lettered (or stalled) email once
 * the provider recovers. It mirrors the Workflow Automation page (P2b).
 *
 * NOTE: this is a SEPARATE channel from the in-app notification bell — the outbox
 * is real email, not a `notifications` row.
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

// Per-status pill for the table.
const StatusPill = ({ status }) => {
    const map = {
        sent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        processing: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        failed: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    };
    return (
        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold capitalize ${map[status] || 'bg-sunken text-muted'}`}>
            {status}
        </span>
    );
};

// Only these can be re-queued (matches the server-side resetToPending guard).
const isResendable = (row) => row.status === 'failed' || row.status === 'pending';

const EmailDelivery = () => {
    const { notify } = useNotification();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [resending, setResending] = useState(false);

    const load = useCallback(async ({ silent = false } = {}) => {
        if (silent) setRefreshing(true); else setLoading(true);
        try {
            const res = await API.get('/admin/email', getAuthConfig());
            setData(res.data?.data || null);
            setSelected(new Set());
        } catch (error) {
            notify.error('Load failed', 'Could not load email delivery status.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify]);

    useEffect(() => { load(); }, [load]);

    const recent = data?.recent || [];
    const counts = data?.counts || {};

    // Client-side search + status filter + pagination over the recent window — the same
    // UX the other admin tables use. No backend change: the outbox endpoint already
    // returns the recent rows failed/pending-first.
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return recent.filter((r) => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (!q) return true;
            return [r.to_email, r.subject, r.category].some((v) => String(v || '').toLowerCase().includes(q));
        });
    }, [recent, search, statusFilter]);
    const { pageItems, page, setPage, limit, onLimitChange, total } = useClientPagination(filtered, 25);
    useEffect(() => { setPage(1); }, [search, statusFilter, setPage]);
    const resendableRows = filtered.filter(isResendable);

    const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const allSelected = resendableRows.length > 0 && resendableRows.every((r) => selected.has(r.id));
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(resendableRows.map((r) => r.id)));

    const resend = async (ids) => {
        if (ids.length === 0) return;
        setResending(true);
        try {
            const res = await API.post('/admin/email/resend', { ids }, getAuthConfig());
            notify.success('Resend queued', res.data?.message || 'Emails re-queued for delivery.');
            await load({ silent: true });
        } catch (error) {
            notify.error('Resend failed', error.response?.data?.message || 'Could not re-queue delivery.');
        } finally {
            setResending(false);
        }
    };

    if (loading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-accent-text" size={36} />
            </div>
        );
    }

    const enabled = !!data?.enabled;

    return (
        <div className="p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast"><Mail size={22} /></div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Email Delivery</h1>
                        <p className="text-muted text-sm font-medium mt-0.5">Transactional email queue, retries &amp; recovery.</p>
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

            {/* Worker status banner */}
            <div className={`mb-6 rounded-2xl border p-4 flex items-center gap-3 ${enabled
                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/20'
                : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-900/20'}`}>
                {enabled ? <Power className="text-emerald-600 dark:text-emerald-400" size={20} /> : <PowerOff className="text-amber-600 dark:text-amber-400" size={20} />}
                <p className="text-sm font-semibold text-content">
                    {enabled
                        ? 'The email worker is enabled. Senders queue their mail here and it is retried automatically until delivered.'
                        : 'The email outbox is disabled (EMAIL_OUTBOX_ENABLED is not set). Emails send inline and are not queued — this monitor stays empty until the flag is turned on.'}
                </p>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatTile label="Pending" value={counts.pending ?? 0} tone={(counts.pending || 0) > 0 ? 'warn' : 'ok'} hint="Waiting to send" />
                <StatTile label="Sent" value={counts.sent ?? 0} tone="ok" hint="Delivered" />
                <StatTile label="Failed" value={counts.failed ?? 0} tone={(counts.failed || 0) > 0 ? 'warn' : 'ok'} hint="Dead-lettered — resendable" />
                <StatTile label="Processing" value={counts.processing ?? 0} tone="idle" hint="In flight" />
            </div>

            {/* Recent list + resend */}
            <div className="bg-surface/80 rounded-2xl border border-line shadow-sm overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-line/60">
                    <h3 className="font-bold text-content flex items-center gap-2">
                        <Mail size={18} className="text-accent-text" /> Recent email
                    </h3>
                    {resendableRows.length > 0 && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => resend([...selected])}
                                disabled={resending || selected.size === 0}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50"
                            >
                                {resending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Resend selected ({selected.size})
                            </button>
                            <button
                                onClick={() => resend(resendableRows.map((r) => r.id))}
                                disabled={resending}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-accent-text bg-accent-soft dark:bg-raised/50 hover:bg-accent/15 dark:hover:bg-raised transition-colors disabled:opacity-50"
                            >
                                Resend all failed/pending
                            </button>
                        </div>
                    )}
                </div>

                {recent.length === 0 ? (
                    <EmptyState
                        size="sm"
                        icon={Mail}
                        title="Nothing queued"
                        description="No transactional email has passed through the outbox yet. Password resets, OTPs, and security alerts will appear here with their delivery status once the queue starts processing mail."
                    />
                ) : (
                    <>
                        {/* Search + status filter (client-side over the recent window). */}
                        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-line/60">
                            <div className="relative flex-1">
                                <Search className="absolute left-3.5 top-3 text-subtle" size={16} />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search recipient, subject, or category…"
                                    className="w-full pl-10 pr-4 py-2.5 bg-sunken border border-line rounded-xl text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                />
                            </div>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                aria-label="Filter by delivery status"
                                className="w-full sm:w-40 px-4 py-2.5 bg-sunken border border-line rounded-xl text-sm font-bold text-muted outline-none cursor-pointer"
                            >
                                <option value="all">All statuses</option>
                                <option value="sent">Sent</option>
                                <option value="pending">Pending</option>
                                <option value="processing">Processing</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>

                        {filtered.length === 0 ? (
                            <EmptyState size="sm" variant="search" icon={Mail} title="No matching email" description="No email matches your search or status filter. Try a different term or status." />
                        ) : (
                            <>
                                <div className="px-4 pt-3">
                                    <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={onLimitChange} />
                                </div>
                                <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm min-w-[760px]">
                            <thead className="bg-sunken/70 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-muted">
                                <tr>
                                    <th className="p-3 w-10">
                                        {resendableRows.length > 0 && (
                                            <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all resendable" className="accent-[#1a4a38] w-4 h-4" />
                                        )}
                                    </th>
                                    <th className="p-3 font-bold">Recipient</th>
                                    <th className="p-3 font-bold">Subject</th>
                                    <th className="p-3 font-bold">Category</th>
                                    <th className="p-3 font-bold">Status</th>
                                    <th className="p-3 font-bold whitespace-nowrap">Attempts</th>
                                    <th className="p-3 font-bold whitespace-nowrap">When</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                                {pageItems.map((r) => (
                                    <tr key={r.id} className="hover:bg-sunken/60 dark:hover:bg-raised/30 align-top">
                                        <td className="p-3">
                                            {isResendable(r) && (
                                                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select email ${r.id}`} className="accent-[#1a4a38] w-4 h-4" />
                                            )}
                                        </td>
                                        <td className="p-3 text-muted whitespace-nowrap">{r.to_email}</td>
                                        <td className="p-3 text-muted max-w-xs truncate" title={r.subject}>{r.subject}</td>
                                        <td className="p-3 text-muted font-mono text-xs">{r.category}</td>
                                        <td className="p-3">
                                            <StatusPill status={r.status} />
                                            {r.status === 'failed' && r.last_error && (
                                                <p className="text-xs text-rose-500 mt-1 max-w-xs truncate" title={r.last_error}>{r.last_error}</p>
                                            )}
                                        </td>
                                        <td className="p-3 text-subtle tabular-nums">{r.attempts}/{r.max_attempts}</td>
                                        <td className="p-3 text-subtle whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1">
                                                <Clock size={12} /> {new Date(r.sent_at || r.created_at).toLocaleString()}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                                </div>
                                <div className="px-4 pb-3">
                                    <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={onLimitChange} />
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default EmailDelivery;
