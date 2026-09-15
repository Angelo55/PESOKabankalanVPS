/**
 * PESO ADMINISTRATOR DASHBOARD — the operational command center.
 *
 * WHAT: a data-driven overview for the signed-in PESO administrator — summary
 * cards, vacancy/application distributions, skill-demand signal, monthly
 * employment trends, a recent-activity feed, and a "pending action" panel that
 * routes to the exact modules the bell notifications deep-link to.
 *
 * WHEN: the "Dashboard" sidebar item and the PESO admin landing page
 * (/peso-admin/dashboard). The authoring surface — creating, publishing,
 * editing, archiving and monitoring vacancies — lives one item down under
 * "Job Publication Management" (/peso-admin/jobs, PesoAdminDashboard.jsx).
 *
 * ── WHERE THE NUMBERS COME FROM ────────────────────────────────────────────
 * One call to GET /api/peso-admin/analytics/overview. Every figure is
 * owner-scoped to this administrator's postings, except the two registration
 * counts (job seekers, employers), which are platform-wide and share the public
 * landing page's definitions so no number disagrees across screens.
 *
 * "Successful Hires" counts recorded placement outcomes (outcome = 'Hired'),
 * never approved referrals — an emailed letter is not a job (invariant 0.14).
 *
 * ── DEGRADED, NEVER BLANK ──────────────────────────────────────────────────
 * The endpoint computes each panel independently and zero-fills on failure, so
 * a single broken aggregation narrows the dashboard instead of emptying it. The
 * page still renders its shell and a retry on a hard failure.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, PieChart, Pie, Cell, BarChart,
} from 'recharts';
import {
    Briefcase, Users, Building2, ClipboardList, FileCheck2, Trophy,
    LayoutDashboard, Activity, RefreshCw, ArrowRight, AlertCircle,
    Sparkles, Inbox, TrendingUp, Clock, Download, Loader2,
} from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import { useChat } from '../context/ChatContext';
import SkillDemandWidget from './dashboard/SkillDemandWidget';
import { StatCard, Panel, EmptyState } from './common/AdminUI';
import UsagePanel from './common/UsagePanel';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const ACCENT = '#4F7942'; // Deep Green — 5.07:1 on white, the PESO admin accent.

// Stable colours so a status keeps its hue across the pie and the legend.
const VACANCY_COLORS = {
    Open: '#10b981', Published: '#6366f1', Draft: '#f59e0b',
    Closed: '#64748b', Filled: '#0284c7',
};
const APPLICATION_COLORS = {
    Applied: '#6366f1', 'Under Review': '#f59e0b', Shortlisted: '#8b5cf6',
    Interview: '#0ea5e9', Hired: '#10b981', Rejected: '#ef4444',
};
const colorFor = (map, key, i) => map[key] || ['#4F7942', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'][i % 6];

// Tracks the html.dark toggle so the SVG-inline chart chrome (axis ticks, grid)
// can pick a theme-appropriate colour — recharts styles those inline, so they
// cannot inherit from CSS. Mirrors PipelineAnalyticsChart's approach.
const useIsDark = () => {
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
    useEffect(() => {
        const el = document.documentElement;
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return isDark;
};

// High-contrast, theme-aware tooltip. The previous version set a dark
// `contentStyle` but left recharts to colour each value in its SERIES colour —
// so a deep-green bar's value rendered as dark-green text on a near-black panel
// (failing contrast) and the label kept recharts' default mid-grey. Here the
// text is always gray-900/white (WCAG-safe on both themes) and series identity
// rides on a colour dot instead of tinting the number. Tailwind `dark:`
// classes follow the same toggle the rest of the page uses, so it adapts with
// no JS.
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    // Identity of the hovered point, so the fade replays only when the point
    // genuinely changes (see .chart-tooltip-in). Bars/lines carry a category
    // `label`; the pie has none, so fall back to the hovered slice's name.
    const activeKey = (label != null && label !== '')
        ? label
        : (payload[0]?.name ?? payload[0]?.payload?.name ?? payload[0]?.dataKey ?? 'pt');
    return (
        <div key={activeKey} className="chart-tooltip-in rounded-xl border border-line bg-surface shadow-xl px-3 py-2 text-xs min-w-[9rem]">
            {label != null && label !== '' && (
                <p className="font-black text-content mb-1.5">{label}</p>
            )}
            <ul className="space-y-1">
                {payload.map((entry, i) => (
                    <li key={i} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.payload?.fill || ACCENT }} />
                        <span className="text-muted font-semibold">{entry.name}</span>
                        <span className="ml-auto font-black text-content tabular-nums">{entry.value}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

// Recharts colours legend labels per series by default, which can disappear on a
// same-hue panel. Force a neutral, theme-aware ink instead.
const legendFormatter = (value) => (
    <span className="text-muted text-xs font-semibold">{value}</span>
);

const relTime = (raw) => {
    if (!raw) return '';
    const then = new Date(raw).getTime();
    if (Number.isNaN(then)) return '';
    const s = Math.floor((Date.now() - then) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
    return new Date(raw).toLocaleDateString();
};

// ── Presentational pieces ──────────────────────────────────────────────────
// StatCard / Panel / EmptyState now live in common/AdminUI so the ATS and job
// grid share them; only this file's loading skeleton stays local.

const SkeletonBlock = ({ className = '' }) => (
    <div className={`animate-pulse bg-sunken/40 rounded-2xl ${className}`} />
);

// ── Main ────────────────────────────────────────────────────────────────────

const PesoAdminOverview = () => {
    const navigate = useNavigate();
    const { notify } = useNotification();
    // New applications change the pending-action counts + recent-activity feed; watch
    // the socket trigger so those refresh in near-real-time without a focus reload.
    const { applicationUpdateTrigger } = useChat() || {};
    const isDark = useIsDark();
    const gridColor = isDark ? '#374151' : '#e5e7eb';        // slate-700 / gray-200
    const axisTick = { fill: isDark ? '#cbd5e1' : '#475569', fontSize: 12, fontWeight: 600 }; // slate-300 / slate-600
    const cursorFill = isDark ? '#33415566' : '#94a3b81f';
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [exporting, setExporting] = useState(false);
    // Governs the TREND CHART window only (3/6/12 months). The summary cards stay
    // current-state totals — the backend enforces the same split.
    const [trendMonths, setTrendMonths] = useState(6);
    // When the data was last successfully loaded — drives the freshness guard so a
    // tab-focus refetches only when the data is actually stale (stale-while-revalidate).
    const lastLoadedAtRef = useRef(0);

    // `background: true` = a fully invisible revalidation (poll / focus / socket): no
    // skeleton AND no refresh spinner, so an unchanged result is a true no-op on screen.
    // `silent` without `background` = the manual Refresh / trend-switch (shows the spin).
    const load = useCallback(async ({ silent = false, months, background = false } = {}) => {
        if (!silent) setLoading(true);
        else if (!background) setRefreshing(true);
        try {
            const res = await API.get(`/peso-admin/analytics/overview?months=${months ?? trendMonths}`, getAuthConfig());
            const next = res.data?.data || null;
            // Keep the SAME object reference when a (silent) revalidation returns data
            // identical to what's on screen — returning `prev` bails React out of the
            // re-render, so the charts don't re-mount/re-animate when nothing changed.
            // A non-silent (explicit) load always applies, so a manual refresh is honest.
            setData(prev => (silent && JSON.stringify(prev) === JSON.stringify(next)) ? prev : next);
            setError(false);
            lastLoadedAtRef.current = Date.now();
        } catch (e) {
            setError(true);
            if (silent) notify.error('Refresh Failed', 'Could not update the dashboard analytics.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify, trendMonths]);

    // Latest `load` behind a ref so the background effects below always fetch with the
    // current trend window WITHOUT re-subscribing their interval/listeners when it
    // changes (and without double-fetching on a trend-window switch).
    const loadRef = useRef(load);
    useEffect(() => { loadRef.current = load; }, [load]);

    // Initial load, once on mount. Trend-window changes fetch via changeTrendWindow;
    // background refreshes use the silent poll + socket paths below. `load`'s identity
    // is stable now that `notify` is memoised, so this no longer re-fires (and reloads
    // the whole dashboard) on every unrelated context render / tab-focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load({ silent: false }); }, []);

    // Backstop poll with a freshness guard (stale-while-revalidate). Visibility-gated,
    // so a hidden tab never polls and returning to the tab refetches ONLY when the data
    // is older than the TTL — focus alone no longer forces a full reload. The manual
    // Refresh button and the real-time socket path (below) cover the immediate cases.
    useEffect(() => {
        const POLL_MS = Number(import.meta.env.VITE_DASHBOARD_POLL_MS) || 120000;
        const TTL_MS = Number(import.meta.env.VITE_DASHBOARD_TTL_MS) || 60000;
        const tick = () => {
            if (document.hidden) return;
            if (Date.now() - lastLoadedAtRef.current < TTL_MS) return; // still fresh
            loadRef.current({ silent: true, background: true });
        };
        const id = setInterval(tick, POLL_MS);
        document.addEventListener('visibilitychange', tick);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
    }, []);

    // Real-time: a new application arrived (socket 'new_application_received' → this
    // trigger). Silently refresh so the pending-action counts and recent-activity feed
    // stay current without waiting for the poll. Skips the initial mount value.
    const firstAppTrigRef = useRef(true);
    useEffect(() => {
        if (firstAppTrigRef.current) { firstAppTrigRef.current = false; return; }
        loadRef.current({ silent: true, background: true });
    }, [applicationUpdateTrigger]);

    // Authed CSV download: the auth header can't ride on a plain link, so fetch
    // the file as a blob and click a synthesised anchor (the pattern the letter
    // and referral-report downloads already use).
    const exportSummary = async () => {
        setExporting(true);
        try {
            const res = await API.get(`/peso-admin/analytics/export?months=${trendMonths}`, { ...getAuthConfig(), responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `peso-dashboard-summary-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
            notify.error('Export Failed', 'Could not export the dashboard summary.');
        } finally {
            setExporting(false);
        }
    };

    const changeTrendWindow = (m) => { setTrendMonths(m); load({ silent: true, months: m }); };

    const cards = data?.cards || {};
    const vacancyStatus = (data?.vacancyStatus || []).map((r, i) => ({
        name: r.status || 'Unknown', value: Number(r.count) || 0, fill: colorFor(VACANCY_COLORS, r.status, i),
    }));
    const applicationStatus = (data?.applicationStatus || []).map((r, i) => ({
        name: r.status || 'Unknown', value: Number(r.count) || 0, fill: colorFor(APPLICATION_COLORS, r.status, i),
    }));
    const monthly = data?.monthly || [];
    const pending = data?.pendingActions || {};
    const recent = data?.recentActivity || [];

    const pendingItems = [
        { key: 'pendingReferrals', label: 'Referrals awaiting review', value: pending.pendingReferrals || 0, icon: <Sparkles size={18} />, tint: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30', to: '/referrals/recommended' },
        { key: 'newApplications', label: 'New applications to screen', value: pending.newApplications || 0, icon: <Inbox size={18} />, tint: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30', to: '/peso-admin/ats' },
        { key: 'failedReferrals', label: 'Referral letters needing retry', value: pending.failedReferrals || 0, icon: <RefreshCw size={18} />, tint: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30', to: '/referrals/failed' },
    ];

    if (loading) {
        // Mirrors the real layout section-for-section (header → KPI cards →
        // pending-action row → trends chart → two distributions → skill + activity)
        // so the page keeps its shape while loading and nothing shifts on arrival.
        return (
            <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                    <div className="space-y-2"><SkeletonBlock className="h-9 w-72" /><SkeletonBlock className="h-4 w-80 max-w-full" /></div>
                    <div className="flex gap-2"><SkeletonBlock className="h-11 w-32 rounded-xl" /><SkeletonBlock className="h-11 w-28 rounded-xl" /></div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} className="h-28" />)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
                    {Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-20" />)}
                </div>
                <SkeletonBlock className="h-80 mb-6 rounded-3xl" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                    <SkeletonBlock className="h-72 rounded-3xl" />
                    <SkeletonBlock className="h-72 rounded-3xl" />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
                    <SkeletonBlock className="h-64 rounded-3xl" />
                    <SkeletonBlock className="h-64 rounded-3xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-2xl text-white shrink-0" style={{ backgroundColor: ACCENT }}>
                        <LayoutDashboard size={22} />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight">
                            Operational Dashboard
                        </h1>
                        <p className="text-muted mt-1 font-medium text-sm">
                            Real-time Referral analytics for PESO Kabankalan.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 self-start md:self-auto">
                    <button
                        onClick={exportSummary}
                        disabled={exporting}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-accent-text bg-surface border border-line shadow-sm hover:bg-sunken transition-colors disabled:opacity-60"
                    >
                        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV
                    </button>
                    <button
                        onClick={() => load({ silent: true })}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-60"
                        style={{ backgroundColor: ACCENT }}
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {error && !data && (
                <div className="mb-6 p-5 rounded-2xl border border-rose-200 dark:border-rose-800/50 bg-rose-50/60 dark:bg-rose-900/20 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-rose-700 dark:text-rose-300">
                        <AlertCircle size={20} />
                        <p className="text-sm font-bold">The dashboard analytics could not be loaded.</p>
                    </div>
                    <button onClick={() => load()} className="px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ backgroundColor: ACCENT }}>Retry</button>
                </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
                <StatCard icon={<Briefcase />} label="Active Job Vacancies" value={cards.activeVacancies ?? 0} sub="Open & published postings" tint="text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30" />
                <StatCard icon={<Users />} label="Registered Job Seekers" value={cards.totalJobSeekers ?? 0} sub="Active applicant accounts" tint="text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30" />
                <StatCard icon={<Building2 />} label="Employers" value={cards.totalEmployers ?? 0} sub="Organizations with live vacancies" tint="text-sky-600 bg-sky-50 dark:bg-sky-900/30" />
                <StatCard icon={<ClipboardList />} label="Applications Received" value={cards.applicationsReceived ?? 0} sub="Across your vacancies" tint="text-violet-600 bg-violet-50 dark:bg-violet-900/30" />
                <StatCard icon={<FileCheck2 />} label="Referral Letters Generated" value={cards.referralLettersGenerated ?? 0} sub="Approved referrals" tint="text-amber-600 bg-amber-50 dark:bg-amber-900/30" />
                <StatCard icon={<Trophy />} label="Successful Hires" value={cards.successfulHires ?? 0} sub="Confirmed placements" tint="text-orange-600 bg-orange-50 dark:bg-orange-900/30" />
            </div>

            {/* Pending administrative action */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
                {pendingItems.map(item => (
                    <button
                        key={item.key}
                        onClick={() => navigate(item.to)}
                        className="group text-left bg-surface/80 p-4 rounded-2xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:border-accent/40 hover:shadow-md transition-all flex items-center gap-3"
                    >
                        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${item.tint}`}>{item.icon}</div>
                        <div className="min-w-0 flex-1">
                            <p className="text-2xl font-black text-content tabular-nums leading-none">{item.value}</p>
                            <p className="text-xs font-semibold text-muted mt-1 line-clamp-1">{item.label}</p>
                        </div>
                        <ArrowRight size={16} className="text-subtle group-hover:text-accent-text transition-colors shrink-0" />
                    </button>
                ))}
            </div>

            {/* Monthly employment trends (full width) */}
            <Panel
                title="Monthly Employment Trends"
                icon={<TrendingUp size={18} className="text-accent-text" />}
                className="mb-6"
                action={
                    <div className="inline-flex rounded-xl border border-line overflow-hidden text-xs font-bold" role="group" aria-label="Trend window">
                        {[3, 6, 12].map(m => (
                            <button
                                key={m}
                                onClick={() => changeTrendWindow(m)}
                                aria-pressed={trendMonths === m}
                                className={`px-3 py-1.5 transition-colors ${trendMonths === m ? 'bg-accent text-white' : 'bg-surface text-muted hover:bg-sunken'}`}
                            >
                                {m}m
                            </button>
                        ))}
                    </div>
                }
            >
                {monthly.some(m => m.applications || m.hires) ? (
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                                <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} isAnimationActive={false} />
                                <Legend formatter={legendFormatter} wrapperStyle={{ fontSize: 12 }} />
                                <Bar dataKey="applications" name="Applications" fill={ACCENT} radius={[6, 6, 0, 0]} maxBarSize={44} />
                                <Line dataKey="hires" name="Hires" type="monotone" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b' }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <EmptyState>No applications or hires recorded in the last six months yet.</EmptyState>
                )}
            </Panel>

            {/* Distributions row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                <Panel title="Vacancy Status Distribution" icon={<Briefcase size={18} className="text-accent-text" />}>
                    {vacancyStatus.length ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={vacancyStatus} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
                                        {vacancyStatus.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                                    </Pie>
                                    <Tooltip content={<ChartTooltip />} isAnimationActive={false} />
                                    <Legend formatter={legendFormatter} wrapperStyle={{ fontSize: 12 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <EmptyState>No vacancies posted yet. Create one under Job Publication Management.</EmptyState>
                    )}
                </Panel>

                <Panel title="Application Status Analytics" icon={<ClipboardList size={18} className="text-accent-text" />}>
                    {applicationStatus.length ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={applicationStatus} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                                    <YAxis type="category" dataKey="name" width={92} tick={axisTick} axisLine={false} tickLine={false} />
                                    <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} isAnimationActive={false} />
                                    <Bar dataKey="value" name="Applications" radius={[0, 6, 6, 0]} maxBarSize={26}>
                                        {applicationStatus.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <EmptyState>No applications received yet.</EmptyState>
                    )}
                </Panel>
            </div>

            {/* Skill demand + recent activity */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
                <SkillDemandWidget />

                <Panel title="Recent System Activity" icon={<Activity size={18} className="text-accent-text" />}>
                    {recent.length ? (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-700/50 -my-1">
                            {recent.map(item => (
                                <li key={item.id} className="py-3 flex items-start gap-3">
                                    <div className="w-9 h-9 shrink-0 rounded-xl bg-accent-soft flex items-center justify-center text-accent-text">
                                        <Inbox size={16} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-content font-medium leading-snug">
                                            <span className="font-bold">{item.applicant_name}</span> applied to{' '}
                                            <span className="font-bold">{item.job_title}</span>
                                        </p>
                                        <p className="text-xs text-subtle font-medium mt-0.5 flex items-center gap-1.5">
                                            <span className="px-1.5 py-0.5 rounded-md bg-sunken text-muted font-bold">{item.status}</span>
                                            <span className="inline-flex items-center gap-1"><Clock size={11} /> {relTime(item.applied_at)}</span>
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EmptyState>No applicant activity yet. It will appear here as job seekers apply.</EmptyState>
                    )}
                    <button onClick={() => navigate('/peso-admin/ats')} className="mt-4 w-full py-2.5 rounded-xl text-sm font-bold text-accent-text bg-accent-soft hover:bg-accent/15 transition-colors inline-flex items-center justify-center gap-2">
                        Open Applicant Pipeline <ArrowRight size={15} />
                    </button>
                </Panel>
            </div>

            {/* Office usage & limits — informational counts (posting/referrals/events are
                never capped) plus the enforced pin + upload ceilings. */}
            <div className="mt-6 rounded-3xl border border-line bg-surface/60 p-5 sm:p-6">
                <UsagePanel
                    scope="admin"
                    title="Office Usage & Limits"
                    description="How much of each resource your office has accumulated. Posting vacancies, referrals, and events is never limited; message pins and upload sizes are capped."
                />
            </div>
        </div>
    );
};

export default PesoAdminOverview;
