/**
 * JOB SEEKER DASHBOARD — the landing screen after signing in.
 *
 * WHAT: the seeker's overview — application statistics, AI career insights,
 * recommended vacancies, recent activity — plus the two data-entry tools in the
 * header.
 *
 * ── THE TWO HEADER TOOLS ───────────────────────────────────────────────────
 *
 * "Analyze My Resume" (was "Upload Resume")
 *   Upload a .pdf/.doc/.docx. The backend extracts the text, has the AI parse
 *   it into structured career data, and builds the Unified Profile and career
 *   insights shown on this page. The upload is the INPUT; the analysis is the
 *   feature — which is why the old name was misleading enough to rename.
 *
 * "Import Past Applications" (was "Import Tracker")
 *   Upload a .xlsx/.csv of jobs applied for elsewhere. Company / Title / Status
 *   columns are auto-detected and duplicates skipped, so a seeker keeps one
 *   history instead of two. It imports records; it never tracked anything.
 *
 * ── AI CAREER INSIGHTS ─────────────────────────────────────────────────────
 * `aiProfile` is populated by resume analysis and rendered as a dismissible
 * panel (the eye toggle). Absent until a resume has been analysed — so the
 * empty state is NORMAL for a new account, not a failure, and must never be
 * shown as an error.
 *
 * ── WHY THE MODALS LIVE HERE ───────────────────────────────────────────────
 * Both tools are modals on this page rather than routed screens. They are
 * occasional, one-shot actions that return you to the dashboard; a route would
 * add a back-navigation step to a task that is finished in one interaction.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, LayoutDashboard, Bookmark, PlusCircle, Search, UploadCloud, Loader2, Cpu, CheckCircle, EyeOff, Eye, Sparkles, Target, TrendingUp, AlertCircle, ChevronRight, ExternalLink, X, Globe, Users, FileSpreadsheet, BarChart2, TableProperties, FileText, ChevronDown, Building2, Database, ScanSearch, Trophy, CalendarClock, MessagesSquare, TrendingDown, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import API from '../api';
import SkillDemandWidget from './dashboard/SkillDemandWidget';
import ImportPastApplicationsModal from './dashboard/ImportPastApplicationsModal';
import AnalyzeResumeModal from './dashboard/AnalyzeResumeModal';
import DashboardGreeting from './dashboard/DashboardGreeting';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useChat } from '../context/ChatContext';
import { lazy, Suspense } from 'react';
const PipelineAnalyticsChart = lazy(() => import('./PipelineAnalyticsChart'));
import { SkeletonMetricCard, SkeletonChart } from './Skeleton';
import EmptyState from './common/EmptyState';
import GettingStartedGuide from './common/GettingStartedGuide';
import { canonicalStage, INTERVIEW_STAGES, TERMINAL_STAGES, CANONICAL_STAGES, statusBadgeClass, statusRank, EXTERNAL_STATUSES } from '../hooks/useUnifiedApplications';
import Pagination from './common/Pagination';
import useClientPagination from '../hooks/useClientPagination';

// 🚨 STRICT ISOLATION HELPER: Prevents undefined token crashes
const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

// Summary-card KPIs computed from the UNIFIED application feed (2026-08-07
// consolidation) — the same dataset the chart + recent widget + My Applications page
// use, so the Dashboard counters can never disagree with the list (one metric, one
// home, now homed on the unified feed). `list` items already carry a canonical `stage`.
const computeUnifiedMetrics = (list) => {
    const now = new Date();
    const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let hired = 0, interviews = 0, active = 0, responded = 0, thisMonth = 0, lastMonth = 0;
    for (const a of list) {
        const s = a.stage;
        if (s === 'Hired') hired += 1;
        if (INTERVIEW_STAGES.has(s)) interviews += 1;
        if (!TERMINAL_STAGES.has(s)) active += 1;
        if (s !== 'Applied' && s !== 'Pending / Waiting' && s !== 'No Response') responded += 1;
        const d = a.applied_at ? new Date(a.applied_at) : null;
        if (d && !Number.isNaN(d.getTime())) {
            if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth += 1;
            else if (d.getFullYear() === lastM.getFullYear() && d.getMonth() === lastM.getMonth()) lastMonth += 1;
        }
    }
    const total = list.length;
    return { total, hired, interviews, active, responseRate: total ? Math.round((responded / total) * 100) : 0, thisMonth, monthDelta: thisMonth - lastMonth };
};

// ── ALL YOUR APPLICATIONS TABLE (unified) ──────────────────────────────────
// The proven records-table architecture, refactored to run entirely against the
// CENTRALIZED unified feed (the same rows the My Applications cards + analytics use).
// It reuses the shared status system (statusBadgeClass / statusRank / EXTERNAL_STATUSES
// from useUnifiedApplications) — no parallel status logic. Rows carry the canonical
// `status` (stage) for display/sort, plus `native_status`/`editable`/`tracked_id` so the
// status cell is an editable dropdown for imported rows and a read-only badge for PESO.
const TRACKER_COLUMNS = [
    { key: 'company', label: 'Company' },
    { key: 'job_title', label: 'Role' },
    { key: 'date_applied', label: 'Date Applied' },
    { key: 'status', label: 'Current Status' },
];
const TRACKER_COLUMN_LABEL = Object.fromEntries(TRACKER_COLUMNS.map(c => [c.key, c.label]));
const TRACKER_SORT_KEYS = new Set(TRACKER_COLUMNS.map(c => c.key));
// STATUS_ORDER is now the canonical progression (single source); statusRank ranks by it.
const STATUS_ORDER = CANONICAL_STAGES;

const compareRecords = (a, b, key) => {
    switch (key) {
        case 'company':   return (a.company || '').localeCompare(b.company || '', undefined, { sensitivity: 'base' });
        case 'job_title': return (a.job_title || '').localeCompare(b.job_title || '', undefined, { sensitivity: 'base' });
        case 'status':    return statusRank(a.status) - statusRank(b.status);
        case 'date_applied': {
            const ta = a.date_applied ? new Date(a.date_applied).getTime() : NaN;
            const tb = b.date_applied ? new Date(b.date_applied).getTime() : NaN;
            return (Number.isNaN(ta) ? -Infinity : ta) - (Number.isNaN(tb) ? -Infinity : tb);
        }
        default: return 0;
    }
};
// Array.sort is stable, so equal rows keep the server order (newest first).
const sortRecords = (rows, criteria) => {
    if (!criteria.length) return rows;
    return [...rows].sort((a, b) => {
        for (const { key, dir } of criteria) {
            const c = compareRecords(a, b, key);
            if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
    });
};
const filterRecords = (rows, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.company, r.job_title, r.status].some(f => (f ?? '').toString().toLowerCase().includes(q)));
};

const SortIndicator = ({ dir, priority, showPriority }) => {
    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
    return (
        <span className={`inline-flex items-center gap-0.5 ${dir ? 'text-accent-text' : 'text-subtle'}`}>
            <Icon size={14} strokeWidth={2.5} />
            {showPriority && dir && <span className="text-[10px] font-black tabular-nums">{priority}</span>}
        </span>
    );
};

const TrackerTable = ({ data, onUpdateStatus, sort, onSort }) => {
    const sortMap = new Map(sort.map((s, i) => [s.key, { dir: s.dir, priority: i + 1 }]));
    const multi = sort.length > 1;
    return (
    <div className="overflow-x-auto max-h-[440px] overflow-y-auto rounded-2xl border border-white/40 dark:border-line bg-surface/30 custom-scrollbar">
        <table className="w-full text-left border-collapse relative min-w-[600px]">
            <thead className="sticky top-0 bg-surface/80 backdrop-blur-md z-10 shadow-sm">
                <tr>
                    {TRACKER_COLUMNS.map((col) => {
                        const active = sortMap.get(col.key);
                        return (
                            <th key={col.key} scope="col" className="p-0 whitespace-nowrap" aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={(e) => onSort(col.key, e.shiftKey)} title="Click to sort. Shift-click to add a secondary sort."
                                    className="w-full flex items-center justify-between gap-2 p-4 font-bold text-content hover:bg-surface/60 dark:hover:bg-raised/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                                    <span>{col.label}</span>
                                    <SortIndicator dir={active?.dir} priority={active?.priority} showPriority={multi} />
                                </button>
                            </th>
                        );
                    })}
                </tr>
            </thead>
            <tbody className="divide-y divide-white/40 dark:divide-gray-700/50">
                {data.map((row) => (
                    <tr key={row.id} className="hover:bg-surface/60 dark:hover:bg-raised/60 transition-colors group">
                        <td className="p-4 font-bold text-content">{row.company}</td>
                        <td className="p-4 text-muted font-medium">{row.job_title}</td>
                        <td className="p-4 text-sm text-muted">{row.date_applied ? new Date(row.date_applied).toISOString().split('T')[0] : '--'}</td>
                        <td className="p-4">
                            {row.editable ? (
                                // Interactive: imported status is user-editable. Coloured by the
                                // canonical stage, cursor-pointer + hover ring signal it's clickable.
                                <div className="relative inline-block">
                                    <select
                                        value={row.native_status || 'Applied'}
                                        onChange={(e) => onUpdateStatus(row, e.target.value)}
                                        aria-label={`Update status for ${row.job_title || 'application'}`}
                                        title="Update this imported application's status"
                                        className={`appearance-none pl-2.5 pr-7 py-1 text-[11px] font-black rounded-full border cursor-pointer outline-none transition-shadow hover:ring-2 hover:ring-accent/30 focus:ring-2 focus:ring-accent/40 ${statusBadgeClass(row.status)}`}
                                    >
                                        {EXTERNAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <ChevronDown size={13} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" />
                                </div>
                            ) : (
                                // Read-only: PESO status is admin-driven. Same colour, but a static
                                // badge with default cursor and no hover affordance.
                                <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-black rounded-full border cursor-default ${statusBadgeClass(row.status)}`} title="Managed by the PESO office">
                                    {row.status}
                                </span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
    );
};

const BackgroundDecorations = () => (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400/10 dark:bg-indigo-900/20 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/10 dark:bg-emerald-900/20 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
    </div>
);

// `sub` is an optional one-line description under the label — used by the
// application-lifecycle KPIs so each figure carries its own context
// (e.g. "2 hired out of 6 total applications") instead of floating alone.
const MetricCard = ({ number, label, sub, icon, color }) => (
    <div className="bg-surface/70 backdrop-blur-xl p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center justify-between gap-3 border border-white/60 dark:border-line hover:-translate-y-1 hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all duration-300 group">
        <div className="min-w-0">
            <h2 className="text-4xl font-black text-accent-text dark:text-white tracking-tight tabular-nums">{number}</h2>
            <p className="text-muted text-sm font-semibold mt-1">{label}</p>
            {sub && <p className="text-[11px] text-subtle font-medium mt-0.5 leading-snug">{sub}</p>}
        </div>
        <div className={`w-14 h-14 shrink-0 ${color} rounded-[1.25rem] flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
            {React.cloneElement(icon, { size: 24, strokeWidth: 2.5 })}
        </div>
    </div>
);

const RecentAppItem = ({ app, navigate }) => (
    <div onClick={() => navigate('/my-applications')} className="flex items-center justify-between group p-3 -mx-3 rounded-2xl hover:bg-surface/60 dark:hover:bg-raised/50 transition-colors duration-300 cursor-pointer">
        <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 rounded-[1.25rem] flex items-center justify-center text-accent-text dark:text-white font-black text-lg shadow-inner">
                {app.company?.charAt(0) || 'C'}
            </div>
            <div>
                <h5 className="font-bold text-content text-sm group-hover:text-accent-text transition-colors">{app.job_title}</h5>
                <p className="text-xs text-muted font-medium mt-0.5">{app.status} • {app.company}</p>
            </div>
        </div>
        <button className="text-subtle hover:text-content dark:hover:text-white transition-colors">
            <ChevronRight size={18} />
        </button>
    </div>
);

const Dashboard = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { notify } = useNotification();
    // Real-time: a PESO application moving stage or a referral being issued bumps this
    // (ChatContext). The Dashboard silently re-pulls the unified feed so its table, KPIs
    // and chart stay in lock-step with My Applications — same source, same moment.
    const { applicationStatusTrigger } = useChat() || {};

    const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);

    // Hover-activated "Create New" menu. A short close delay lets the cursor
    // travel from the button into the menu without it snapping shut.
    const createMenuTimer = useRef(null);
    const openCreateMenu = () => { if (createMenuTimer.current) clearTimeout(createMenuTimer.current); setIsCreateDropdownOpen(true); };
    const scheduleCloseCreateMenu = () => {
        if (createMenuTimer.current) clearTimeout(createMenuTimer.current);
        createMenuTimer.current = setTimeout(() => setIsCreateDropdownOpen(false), 180);
    };
    useEffect(() => () => { if (createMenuTimer.current) clearTimeout(createMenuTimer.current); }, []);
    const [isDashboardLoading, setIsDashboardLoading] = useState(true);

    const [jobs, setJobs] = useState([]);
    
    const [isTrackerModalOpen, setIsTrackerModalOpen] = useState(false);

    const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);

    const [aiProfile, setAiProfile] = useState(null); 
    const [isAiProfileVisible, setIsAiProfileVisible] = useState(true);
    const [aiInsights, setAiInsights] = useState(null);
    const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
    // Application-lifecycle KPIs for the summary cards. These are the SINGLE
    // place these figures appear (the standalone KPI strip that duplicated them
    // inside Pipeline Analytics was removed in the same change).
    const EMPTY_METRICS = { total: 0, hired: 0, interviews: 0, active: 0, responseRate: 0, thisMonth: 0, monthDelta: 0 };
    const [metrics, setMetrics] = useState(EMPTY_METRICS);

    // ── First-run onboarding (Getting Started Guide) ────────────────────────────
    // Each step marks itself done from a REAL signal (profile filled, resume built,
    // a job saved, a PESO application submitted, a referral issued), so the guide
    // reflects genuine progress. Dismissible; auto-hides once every step is done.
    const [onboarding, setOnboarding] = useState({ loaded: false, profile: false, resume: false, saved: false, applied: false, referred: false });
    const [gsgDismissed, setGsgDismissed] = useState(() => {
        try { return localStorage.getItem('pk_gsg_dismissed') === '1'; } catch { return false; }
    });
    const dismissGsg = () => {
        setGsgDismissed(true);
        try { localStorage.setItem('pk_gsg_dismissed', '1'); } catch { /* private mode */ }
    };

    // ── "All Your Applications" table view state (over the unified `jobs`) ───────
    // Sort persists for the tab session (survives navigating away and back); the search
    // box is intentionally ephemeral so a returning user isn't confronted with a filter
    // they forgot they set. Same UX as the module's own filters.
    const RECORDS_SORT_KEY = 'dashboardRecordsSort';
    const [tableSort, setTableSort] = useState(() => {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(RECORDS_SORT_KEY) || '[]');
            return Array.isArray(parsed) ? parsed.filter(s => s && TRACKER_SORT_KEYS.has(s.key) && (s.dir === 'asc' || s.dir === 'desc')) : [];
        } catch { return []; }
    });
    const [tableSearch, setTableSearch] = useState('');
    const [tableStatusFilter, setTableStatusFilter] = useState(''); // '' = all stages
    useEffect(() => {
        try { sessionStorage.setItem(RECORDS_SORT_KEY, JSON.stringify(tableSort)); } catch { /* storage blocked — sort still works in-memory */ }
    }, [tableSort]);

    // Plain click: sole sort key (asc → desc → cleared). Shift-click: layer an additional
    // criterion — enabling multi-column sorts like "Status, then newest Date Applied".
    const handleTableSort = (key, additive) => {
        setTableSort(prev => {
            const current = prev.find(s => s.key === key);
            if (additive) {
                if (!current) return [...prev, { key, dir: 'asc' }];
                if (current.dir === 'asc') return prev.map(s => s.key === key ? { key, dir: 'desc' } : s);
                return prev.filter(s => s.key !== key);
            }
            if (prev.length === 1 && current) return current.dir === 'asc' ? [{ key, dir: 'desc' }] : [];
            return [{ key, dir: 'asc' }];
        });
    };

    // The chart + KPI cards read the FULL `jobs`; only the table narrows — search, then a
    // single stage chip, then the multi-column sort. Status is the CANONICAL stage.
    const visibleRecords = React.useMemo(() => {
        let rows = filterRecords(jobs, tableSearch);
        if (tableStatusFilter) rows = rows.filter(r => (r.status || 'Applied') === tableStatusFilter);
        return sortRecords(rows, tableSort);
    }, [jobs, tableSearch, tableStatusFilter, tableSort]);

    // Chip counts from the FULL set (each chip shows its true total); only stages present.
    const statusCounts = React.useMemo(() => {
        const m = {};
        for (const j of jobs) { const s = j.status || 'Applied'; m[s] = (m[s] || 0) + 1; }
        return m;
    }, [jobs]);
    const presentStatuses = STATUS_ORDER.filter(s => statusCounts[s]);

    // Shared client-side pagination — the widget no longer renders every row at once.
    const recordsPager = useClientPagination(visibleRecords);

    useEffect(() => {
        if (user) {
            fetchUnifiedJobs(); // sets both `jobs` and `metrics` from the unified feed
            fetchUserProfile();
            fetchOnboardingProgress();
        } else {
            setJobs([]);
            setMetrics(EMPTY_METRICS);
            setAiProfile(null);
            setAiInsights(null);
            setIsDashboardLoading(false);
        }
    }, [user]);

    // Real-time sync: silently re-pull the unified feed when a PESO application moves
    // stage or a referral is issued (skips the initial mount value). No skeleton flash —
    // the table/KPIs/chart just update in place, matching the My Applications board.
    const firstAppTrigRef = useRef(true);
    useEffect(() => {
        if (firstAppTrigRef.current) { firstAppTrigRef.current = false; return; }
        if (user) fetchUnifiedJobs({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applicationStatusTrigger]);

    /**
     * Derives onboarding progress from the signals that actually mean each step is
     * done. One parallel batch, all best-effort (allSettled): a failing probe just
     * leaves that step "not done" rather than blocking the guide. Tolerant of every
     * response envelope shape (bare array / {data} / grouped-by-status object).
     */
    const fetchOnboardingProgress = async () => {
        const results = await Promise.allSettled([
            API.get('/profile', getAuthConfig()),
            API.get('/resume/draft', getAuthConfig()),
            API.get('/saved-jobs', getAuthConfig()),
            API.get('/applications/mine', getAuthConfig()),
            API.get('/referrals/mine', getAuthConfig()),
        ]);
        const val = (r) => (r.status === 'fulfilled' ? r.value : null);
        const countItems = (r) => {
            const d = val(r)?.data;
            const payload = d?.data ?? d;
            if (Array.isArray(payload)) return payload.length;
            if (payload && typeof payload === 'object') {
                return Object.values(payload).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
            }
            return 0;
        };

        const profile = (() => { const d = val(results[0])?.data; return d?.data ?? d ?? {}; })();
        const profileDone = !!(profile.location && (profile.phone || profile.contact_number || profile.mobile));
        const draft = val(results[1])?.data?.data;
        const resumeDone = !!(draft && (draft.personal?.name || (Array.isArray(draft.experience) && draft.experience.length) || (draft.skills && String(draft.skills).trim())))
            || !!profile.ai_profile_data;

        setOnboarding({
            loaded: true,
            profile: profileDone,
            resume: resumeDone,
            saved: countItems(results[2]) > 0,
            applied: countItems(results[3]) > 0,
            referred: countItems(results[4]) > 0,
        });
    };

    const onboardingSteps = [
        { id: 'profile', title: 'Complete your Identity & Profile', description: 'Add your contact details and address so your applications and referral letters carry the right information.', icon: Users, done: onboarding.profile, action: { label: 'Open Profile', to: '/profile' } },
        { id: 'resume', title: 'Build your resume in Resume Assistant', description: 'Create a polished resume — the AI uses it to match you to the vacancies that fit you best.', icon: FileText, done: onboarding.resume, action: { label: 'Build Resume', to: '/builder' } },
        { id: 'explore', title: 'Explore available job opportunities', description: 'Browse verified local vacancies posted by the PESO Kabankalan office.', icon: Search, done: onboarding.saved || onboarding.applied, action: { label: 'Browse Jobs', to: '/job-board' } },
        { id: 'save', title: "Save jobs you're interested in", description: 'Bookmark vacancies so you can compare them and come back to apply later.', icon: Bookmark, done: onboarding.saved, action: { label: 'Find Jobs to Save', to: '/job-board' } },
        { id: 'apply', title: 'Apply for suitable vacancies', description: 'Submit your application in a few guided steps, right from the job board.', icon: Briefcase, done: onboarding.applied, action: { label: 'Apply Now', to: '/job-board' } },
        { id: 'track', title: 'Track your applications and referrals', description: 'Follow each application through the pipeline and see the referrals PESO issues for you.', icon: LayoutDashboard, done: onboarding.applied || onboarding.referred, action: { label: 'View Applications', to: '/my-applications' } },
    ];
    const allStepsDone = onboardingSteps.every((s) => s.done);
    const showGettingStarted = onboarding.loaded && !gsgDismissed && !allStepsDone;

    // Reads the ONE unified application feed (PESO + imported) and drives BOTH the
    // pipeline chart / recent widget (via `jobs`, mapped to their expected shape) AND
    // the KPI cards (via `metrics`), so every Dashboard number shares the source of
    // truth with the My Applications page. (Kept the name for minimal churn.)
    const fetchUnifiedJobs = async ({ silent = false } = {}) => {
        if (!silent) setIsDashboardLoading(true);
        try {
            const response = await API.get('/applications/unified', getAuthConfig());
            const list = (response.data?.data || []).map(a => ({ ...a, stage: canonicalStage(a) }));
            // Map to the row shape the chart + recent widget + the "All Your Applications"
            // table read. `status` carries the CANONICAL stage (so the chart groups + the
            // table badge colour match the analytics); `native_status` is the raw imported
            // status the editable dropdown writes back; source/editable/tracked_id drive the
            // interactive-vs-read-only status cell.
            setJobs(list.map(a => ({
                id: a.uid, uid: a.uid, company: a.company, job_title: a.job_title,
                date_applied: a.applied_at, status: a.stage, source: a.source,
                editable: a.editable, tracked_id: a.tracked_id,
                native_status: a.source === 'imported' ? a.status : null,
            })));
            setMetrics(computeUnifiedMetrics(list));
        } catch (error) {
            notify.error("Connection Error", error.response?.data?.message || "Failed to load your applications.");
        } finally {
            setIsDashboardLoading(false);
        }
    };

    // Update an IMPORTED application's status from the table (read-only PESO rows never
    // call this). Optimistic: reflect the new canonical stage instantly, then persist to
    // the same /tracked-jobs endpoint the My Applications module uses, and re-pull the
    // unified feed so the chart, KPIs and recent widget all stay in lock-step.
    const handleUpdateTrackerStatus = async (row, newStatus) => {
        if (!row.editable || !row.tracked_id) return;
        const previous = jobs;
        setJobs(prev => prev.map(j => j.id === row.id
            ? { ...j, native_status: newStatus, status: canonicalStage({ source: 'imported', status: newStatus }) }
            : j));
        try {
            await API.put(`/tracked-jobs/${row.tracked_id}/status`, { status: newStatus }, getAuthConfig());
            fetchUnifiedJobs(); // authoritative refresh (re-derives stage + KPIs)
            notify.success('Status Updated', 'Application status saved.');
        } catch (error) {
            setJobs(previous);
            notify.error('Update Failed', 'Could not save the status. Reverting.');
        }
    };

    /**
     * Restores the AI resume profile + career insights from the DATABASE on
     * every mount, so the Show/Hide toggle and its panels survive a re-login.
     *
     * REGRESSION THIS FIXES: GET /api/profile responds with an envelope —
     * `{ status, data: {...} }` — but this function read `response.data.ai_profile_data`,
     * i.e. one level too shallow. That is always undefined, so `aiProfile` stayed
     * null on load and the toggle (gated on `aiProfile`) never rendered. It only
     * appeared right after an upload because that path sets the state directly
     * from the upload response. The row was in the database the whole time.
     *
     * The fallback chain also tolerates a bare payload, matching how Profile.jsx
     * already reads this same endpoint.
     */
    const fetchUserProfile = async () => {
        try {
            const response = await API.get('/profile', getAuthConfig());
            const data = response.data?.data ?? response.data ?? {};

            if (data.ai_profile_data) {
                // Stored as LONGTEXT. Guard the parse: a malformed row must not
                // take down the whole dashboard mount.
                try {
                    setAiProfile(typeof data.ai_profile_data === 'string'
                        ? JSON.parse(data.ai_profile_data)
                        : data.ai_profile_data);
                } catch (e) {
                    console.warn('Could not parse stored AI profile:', e.message);
                }
                // Visibility is a persisted user choice; mysql2 may return the
                // BOOLEAN as 1/0 or true/false depending on the column type.
                setIsAiProfileVisible(
                    data.is_ai_profile_visible === 1 ||
                    data.is_ai_profile_visible === true ||
                    data.is_ai_profile_visible === '1'
                );
            }

            if (data.ai_insights_data) {
                try {
                    setAiInsights(typeof data.ai_insights_data === 'string'
                        ? JSON.parse(data.ai_insights_data)
                        : data.ai_insights_data);
                } catch (e) {
                    console.warn('Could not parse stored career insights:', e.message);
                }
            }
        } catch (error) {
            // Non-critical: the dashboard still renders without the AI panels.
        }
    };

    // Import Past Applications now lives in <ImportPastApplicationsModal> (Phase B —
    // /profile/import/preview + /commit). The old single-shot handler was removed.

    // Analyze My Resume now lives in <AnalyzeResumeModal> (Phase C — POST /profile/upload
    // extracts via PDF/DOCX + persists parsed_text + AI profile). The old handler + local
    // validation were removed; on success the modal calls onAnalyzed to refresh the profile.
    const onResumeAnalyzed = () => { setIsAiProfileVisible(true); setAiInsights(null); fetchUserProfile(); };

    const toggleAiProfileVisibility = async () => {
        const newState = !isAiProfileVisible;
        setIsAiProfileVisible(newState);
        try { 
            await API.put('/profile/visibility', { isVisible: newState }, getAuthConfig()); 
            notify.info("Visibility Updated", `AI Profile is now ${newState ? 'visible' : 'hidden'}.`);
        } 
        catch (error) { 
            setIsAiProfileVisible(!newState); 
            notify.error("Update Failed", "Could not change visibility.");
        }
    };

    const generateInsights = async () => {
        setIsGeneratingInsights(true);
        const toastId = notify.loading("Generating Insights", "Analyzing your Unified Profile trajectory...");
        try {
            const response = await API.post('/profile/insights/generate', {}, getAuthConfig()); 
            notify.remove(toastId);
            notify.success("Insights Generated", "Your career trajectory and skill gaps have been analyzed.");
            setAiInsights(response.data.insights);
        } catch (error) { 
            notify.remove(toastId);
            notify.error("Generation Failed", "Failed to generate AI insights."); 
        } 
        finally { setIsGeneratingInsights(false); }
    };

    return (
        <>
            <div className="relative p-4 sm:p-6 lg:p-8 w-full min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-accent-soft/50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 transition-colors duration-500 animate-fade-scale-in motion-reduce:animate-none">
                <BackgroundDecorations />
                
                <div className="relative z-10">
                    {/* The header's old "Search your applications…" box was retired: it
                        was never wired to any filter, so it silently did nothing. The
                        real search lives on the records table below, scoped to the data
                        it actually filters. */}
                    <header className="flex flex-col md:flex-row md:justify-end md:items-center gap-4 mb-6 sm:mb-8">
                        <div className="flex items-center flex-wrap gap-2 sm:gap-3">

                            <div
                                className="relative"
                                onMouseEnter={openCreateMenu}
                                onMouseLeave={scheduleCloseCreateMenu}
                            >
                                <button
                                    onClick={() => setIsCreateDropdownOpen(o => !o)}
                                    onFocus={openCreateMenu}
                                    aria-haspopup="menu"
                                    aria-expanded={isCreateDropdownOpen}
                                    className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-2xl font-bold shadow-lg shadow-indigo-500/30 hover:-translate-y-0.5 transition-all"
                                >
                                    <PlusCircle size={18} /> Create New <ChevronDown size={16} className={`transition-transform duration-200 ${isCreateDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Always mounted so it can slide up/down; visibility is animated. */}
                                <div
                                    role="menu"
                                    className={`absolute top-full right-0 mt-2 w-56 bg-surface rounded-2xl shadow-xl border border-line overflow-hidden z-50 origin-top transition-all duration-200 ease-out ${isCreateDropdownOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
                                >
                                    {/* Straight to the builder — the Template Gallery opens there.
                                        The old "Create with AI / Manually" intermediate modal was
                                        removed (docs/document-builder-platform-plan.md §5); AI and
                                        manual are now integrated modes inside the builder. */}
                                    <button
                                        role="menuitem"
                                        onClick={() => { setIsCreateDropdownOpen(false); navigate('/builder'); }}
                                        className="w-full text-left px-4 py-3 hover:bg-sunken font-semibold text-content flex items-center gap-3 transition-colors"
                                    >
                                        <FileText size={18} className="text-indigo-500" /> Resume
                                    </button>
                                    <button
                                        role="menuitem"
                                        onClick={() => { setIsCreateDropdownOpen(false); navigate('/cover-letter'); }}
                                        className="w-full text-left px-4 py-3 hover:bg-sunken font-semibold text-content flex items-center gap-3 transition-colors"
                                    >
                                        <FileText size={18} className="text-blue-500" /> Cover Letter
                                    </button>
                                    <button
                                        role="menuitem"
                                        onClick={() => { setIsCreateDropdownOpen(false); navigate('/resignation-builder'); }}
                                        className="w-full text-left px-4 py-3 hover:bg-sunken font-semibold text-content flex items-center gap-3 transition-colors"
                                    >
                                        <FileText size={18} className="text-emerald-500" /> Resignation Letter
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={() => setIsTrackerModalOpen(true)} 
                                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-surface/70 backdrop-blur-md border border-white/50 dark:border-line text-accent-text dark:text-accent-text rounded-2xl font-semibold shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:bg-white dark:hover:bg-raised hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300 whitespace-nowrap"
                            >
                                <FileSpreadsheet size={18} />
                                Import Past Applications
                            </button>

                            <button 
                                onClick={() => setIsResumeModalOpen(true)} 
                                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-surface/70 backdrop-blur-md border border-white/50 dark:border-line text-accent-text dark:text-white rounded-2xl font-semibold shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:bg-white dark:hover:bg-raised hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300 whitespace-nowrap"
                            >
                                <ScanSearch size={18} />
                                Analyze My Resume
                            </button>

                            {aiProfile && (
                                <button onClick={toggleAiProfileVisibility} aria-label={isAiProfileVisible ? "Hide AI profile" : "Show AI profile"} className="flex items-center justify-center w-11 h-11 bg-surface/70 backdrop-blur-md border border-white/50 dark:border-line text-muted hover:text-accent-text dark:hover:text-white rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300">
                                    {isAiProfileVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            )}
                        </div>
                    </header>

                    {/* Temporary session greeting, relocated from the old TopHeader "Welcome
                        back" chip — shows once per session on entry/login, then fades out. */}
                    <DashboardGreeting name={user?.name} userId={user?.id} />

                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-accent to-accent-hover dark:from-white dark:to-gray-300 mb-6 sm:mb-8 tracking-tight">
                        Dashboard Overview
                    </h1>

                    {/* First-run onboarding — a guided journey instead of empty widgets. */}
                    {showGettingStarted && (
                        <div className="mb-6 sm:mb-8">
                            <GettingStartedGuide name={user?.name} steps={onboardingSteps} onDismiss={dismissGsg} />
                        </div>
                    )}

                    {aiProfile && isAiProfileVisible && (
                        <div className="mb-6 bg-gradient-to-br from-accent-soft/80 to-white/60 dark:from-gray-800/80 dark:to-gray-800/60 backdrop-blur-xl border border-white/60 dark:border-line p-5 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-500 animate-slide-up-fade motion-reduce:animate-none">
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-gradient-to-br from-accent to-accent-hover rounded-2xl text-white shadow-lg shadow-accent/30">
                                        <Cpu size={28} />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-accent-text dark:text-white tracking-tight">Unified Career Profile</h3>
                                        <div className="flex items-center gap-2 text-sm text-muted mt-1 font-medium">
                                            <span>Extracted by DeepSeek AI</span><span className="text-subtle">•</span>
                                            <span className="flex items-center gap-1 text-accent-text"><Sparkles size={14}/> Enriched by Coresignal</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                                <div className="space-y-4">
                                    <h4 className="font-semibold text-content tracking-wide uppercase text-xs">Employment History</h4>
                                    {aiProfile.canonical_history.map((job, idx) => (
                                        <div key={idx} className="bg-surface/60 backdrop-blur-md p-5 rounded-2xl border border-white/50 dark:border-line hover:bg-surface/80 dark:hover:bg-raised transition-colors duration-300 shadow-sm">
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 bg-accent/10 p-1 rounded-full"><CheckCircle size={16} className="text-accent-text" /></div>
                                                <div className="w-full">
                                                    <p className="font-bold text-content text-lg">{job.job_title}</p>
                                                    <p className="text-sm text-muted font-medium mt-0.5">{job.hrflow_explicit_data.company} • {job.hrflow_explicit_data.start_date}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-8">
                                    <div>
                                        <h4 className="font-semibold text-content tracking-wide uppercase text-xs mb-3">Explicit Skills</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {aiProfile.canonical_history[0]?.hrflow_explicit_data.skills.map((skill, idx) => (
                                                <span key={idx} className="px-3.5 py-1.5 bg-surface/60 backdrop-blur-sm border border-white/50 dark:border-line text-content text-sm font-semibold rounded-xl shadow-sm">
                                                    {skill}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {aiProfile && isAiProfileVisible && (
                        <div className="mb-6 sm:mb-10 bg-surface/70 backdrop-blur-xl border border-white/60 dark:border-indigo-900/30 p-5 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all duration-500 relative overflow-hidden">
                            <div className="absolute -top-24 -right-24 text-indigo-50 dark:text-indigo-900/10 pointer-events-none transform rotate-12 transition-transform duration-700 group-hover:rotate-45">
                                <Target size={300} strokeWidth={1} />
                            </div>

                            <div className="relative z-10 flex items-center justify-between mb-8">
                                <div>
                                    <h3 className="text-2xl font-black text-indigo-900 dark:text-indigo-300 flex items-center gap-2 tracking-tight">
                                        <Sparkles size={24} className="text-indigo-500" /> 
                                        AI Career Insights
                                    </h3>
                                    <p className="text-muted mt-1 font-medium">Advanced reasoning based on your Unified Profile</p>
                                </div>
                                
                                {!aiInsights && (
                                    <button onClick={generateInsights} disabled={isGeneratingInsights} className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-2xl font-bold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50">
                                        {isGeneratingInsights ? <Loader2 size={20} className="animate-spin" /> : <TrendingUp size={20} />}
                                        {isGeneratingInsights ? 'Analyzing...' : 'Generate Insights'}
                                    </button>
                                )}
                            </div>

                            {aiInsights && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10 animate-slide-up-fade motion-reduce:animate-none">
                                    <div className="bg-indigo-50/60 dark:bg-indigo-900/20 backdrop-blur-sm p-6 rounded-[1.5rem] border border-indigo-100/50 dark:border-indigo-800/50">
                                        <h4 className="text-indigo-800 dark:text-indigo-300 font-bold mb-4 flex items-center gap-2">
                                            <TrendingUp size={18} /> Career Trajectory
                                        </h4>
                                        <p className="text-3xl font-black text-indigo-950 dark:text-white mb-2 tracking-tight">{aiInsights.trajectory}</p>
                                    </div>
                                    <div className="bg-amber-50/60 dark:bg-amber-900/20 backdrop-blur-sm p-6 rounded-[1.5rem] border border-amber-100/50 dark:border-amber-800/50">
                                        <h4 className="text-amber-800 dark:text-amber-400 font-bold mb-4 flex items-center gap-2">
                                            <AlertCircle size={18} /> Identified Skill Gaps
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {aiInsights.skill_gaps.map((gap, idx) => (
                                                <span key={idx} className="px-3.5 py-1.5 bg-raised/80 backdrop-blur text-amber-700 dark:text-amber-400 text-sm font-bold rounded-xl border border-amber-100 dark:border-amber-700/50 shadow-sm">
                                                    {gap}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-10 opacity-0 animate-slide-up-fade [animation-delay:200ms] motion-reduce:opacity-100 motion-reduce:animate-none">
                        {isDashboardLoading ? (
                            <>
                                <SkeletonMetricCard />
                                <SkeletonMetricCard />
                                <SkeletonMetricCard />
                                <SkeletonMetricCard />
                            </>
                        ) : (
                            <>
                                <MetricCard
                                    number={metrics.hired}
                                    label="Total Hired"
                                    sub={`${metrics.hired} hired out of ${metrics.total} total application${metrics.total === 1 ? '' : 's'}`}
                                    icon={<Trophy />}
                                    color="bg-gradient-to-br from-yellow-400 to-orange-400 shadow-orange-400/30"
                                />
                                <MetricCard
                                    number={metrics.interviews}
                                    label="Interviews"
                                    sub={`${metrics.interviews} application${metrics.interviews === 1 ? '' : 's'} reached the interview stage`}
                                    icon={<CalendarClock />}
                                    color="bg-gradient-to-br from-lime-400 to-purple-500 shadow-purple-500/30"
                                />
                                <MetricCard
                                    number={`${metrics.responseRate}%`}
                                    label="Response Rate"
                                    sub={`${metrics.active} application${metrics.active === 1 ? ' is' : 's are'} still awaiting an employer response`}
                                    icon={<MessagesSquare />}
                                    color="bg-gradient-to-br from-blue-400 to-indigo-500 shadow-indigo-500/30"
                                />
                                <MetricCard
                                    number={metrics.thisMonth}
                                    label="This Month"
                                    sub={metrics.monthDelta === 0
                                        ? 'same as last month'
                                        : `${metrics.monthDelta > 0 ? '+' : ''}${metrics.monthDelta} application${Math.abs(metrics.monthDelta) === 1 ? '' : 's'} compared to last month`}
                                    icon={metrics.monthDelta < 0 ? <TrendingDown /> : <TrendingUp />}
                                    color="bg-gradient-to-br from-emerald-400 to-teal-500 shadow-teal-500/30"
                                />
                            </>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8 opacity-0 animate-slide-up-fade [animation-delay:400ms] motion-reduce:opacity-100 motion-reduce:animate-none">
                        
                        <div className="xl:col-span-2 flex flex-col gap-8">
                            
                            <div className="bg-surface/70 backdrop-blur-xl p-5 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] border border-white/60 dark:border-line transition-all duration-500 animate-slide-up-fade">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl">
                                        <BarChart2 className="text-indigo-600 dark:text-indigo-400" size={20} />
                                    </div>
                                    <h3 className="text-xl font-bold text-content tracking-tight">Application Pipeline Analytics</h3>
                                </div>
                                
                                {isDashboardLoading ? (
                                    <SkeletonChart />
                                ) : jobs.length > 0 ? (
                                    <Suspense fallback={<SkeletonChart />}>
                                        <PipelineAnalyticsChart data={jobs} />
                                    </Suspense>
                                ) : (
                                    <EmptyState
                                        size="sm"
                                        icon={BarChart2}
                                        title="Your pipeline chart is waiting for data"
                                        description="Once you apply to vacancies or import past applications, this chart visualizes your progress across every stage — from applied to hired."
                                        primaryAction={{ label: 'Explore Vacancies', to: '/job-board', icon: <Search size={16} /> }}
                                        secondaryAction={{ label: 'Import Records', onClick: () => setIsTrackerModalOpen(true) }}
                                    />
                                )}
                            </div>

                            {/* ALL YOUR APPLICATIONS — the proven records table, now driven by the
                                CENTRALIZED unified feed (same rows as My Applications + the chart),
                                sortable/searchable/paginated, with the shared status colour system. */}
                            <div className="bg-surface/70 backdrop-blur-xl p-5 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line transition-all duration-300">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-accent-soft dark:bg-green-900/30 rounded-xl">
                                            <TableProperties className="text-accent-text" size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-accent-text dark:text-white tracking-tight">All Your Applications</h3>
                                            <p className="text-xs text-muted font-medium mt-0.5">Every application in one table — imported and PESO. Manage them in <button onClick={() => navigate('/my-applications')} className="font-bold text-accent-text hover:underline">My Applications</button>.</p>
                                        </div>
                                    </div>
                                    {jobs.length > 0 && (
                                        <div className="relative shrink-0 sm:w-56">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" size={15} />
                                            <input type="text" value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Search records..." aria-label="Search applications by company, role, or status"
                                                className="w-full pl-9 pr-8 py-2 rounded-xl border border-line bg-surface/70 dark:text-white text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 transition-all" />
                                            {tableSearch && <button onClick={() => setTableSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-content"><X size={14} /></button>}
                                        </div>
                                    )}
                                </div>

                                {jobs.length > 0 && presentStatuses.length > 1 && (
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <button onClick={() => setTableStatusFilter('')} className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${tableStatusFilter === '' ? 'bg-accent text-accent-contrast border-transparent' : 'bg-surface/60 text-muted border-line hover:bg-white dark:hover:bg-raised'}`}>
                                            All <span className="tabular-nums opacity-70">{jobs.length}</span>
                                        </button>
                                        {presentStatuses.map(s => (
                                            <button key={s} onClick={() => setTableStatusFilter(prev => prev === s ? '' : s)} aria-pressed={tableStatusFilter === s}
                                                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${tableStatusFilter === s ? 'bg-accent text-accent-contrast border-transparent' : 'bg-surface/60 text-muted border-line hover:bg-white dark:hover:bg-raised'}`}>
                                                {s} <span className="tabular-nums opacity-70">{statusCounts[s]}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {tableSort.length > 0 && jobs.length > 0 && (
                                    <div className="flex items-center justify-between gap-3 mb-3 text-xs">
                                        <span className="text-muted font-medium truncate">
                                            Sorted by {tableSort.map(s => `${TRACKER_COLUMN_LABEL[s.key]} ${s.dir === 'desc' ? '↓' : '↑'}`).join(', ')}
                                            <span className="hidden sm:inline text-subtle"> · Shift-click a column to add another</span>
                                        </span>
                                        <button onClick={() => setTableSort([])} className="shrink-0 font-bold text-accent-text hover:underline">Clear sorting</button>
                                    </div>
                                )}

                                {jobs.length === 0 ? (
                                    <EmptyState size="sm" icon={TableProperties} title="No applications yet"
                                        description="Applications you submit to PESO vacancies and records you import both appear here."
                                        primaryAction={{ label: 'Explore Vacancies', to: '/job-board', icon: <Search size={16} /> }}
                                        secondaryAction={{ label: 'Import Records', onClick: () => setIsTrackerModalOpen(true) }} />
                                ) : visibleRecords.length === 0 ? (
                                    <EmptyState size="sm" variant="search" title="No records match your filters"
                                        description={tableSearch ? `Nothing matches “${tableSearch}”${tableStatusFilter ? ` in ${tableStatusFilter}` : ''}.` : `No records with status “${tableStatusFilter}”.`}
                                        primaryAction={{ label: 'Clear filters', onClick: () => { setTableSearch(''); setTableStatusFilter(''); } }} />
                                ) : (
                                    <>
                                        <TrackerTable data={recordsPager.pageItems} onUpdateStatus={handleUpdateTrackerStatus} sort={tableSort} onSort={handleTableSort} />
                                        <Pagination page={recordsPager.page} limit={recordsPager.limit} total={recordsPager.total} onPage={recordsPager.setPage} onLimitChange={recordsPager.onLimitChange} />
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="xl:col-span-1 flex flex-col gap-8">
                            <div className="bg-surface/70 backdrop-blur-xl p-5 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line transition-all duration-300">
                                <h3 className="text-xl font-bold text-accent-text dark:text-white mb-6 tracking-tight">My Recent Applications</h3>
                                <div className="space-y-4">
                                    {jobs.length === 0 ? (
                                        <EmptyState
                                            size="sm"
                                            icon={Briefcase}
                                            title="No applications yet"
                                            description="Your most recent applications will show up here so you can jump back into them quickly."
                                            primaryAction={{ label: 'Explore Vacancies', to: '/job-board', icon: <Search size={16} /> }}
                                        />
                                    ) : (
                                        jobs.slice(0, 5).map(app => <RecentAppItem key={app.id} app={app} navigate={navigate} />)
                                    )}
                                </div>
                            </div>
                            
                            <SkillDemandWidget />
                        </div>
                    </div>
                </div>
            </div>

            {/* MODALS RENDERED AS SIBLINGS TO BREAK FREE FROM CSS TRANSFORM */}
            <ImportPastApplicationsModal
                open={isTrackerModalOpen}
                onClose={() => setIsTrackerModalOpen(false)}
                onImported={() => fetchUnifiedJobs({ silent: true })}
            />

            <AnalyzeResumeModal
                open={isResumeModalOpen}
                onClose={() => setIsResumeModalOpen(false)}
                onAnalyzed={onResumeAnalyzed}
            />
        </>
    );
};

export default Dashboard;