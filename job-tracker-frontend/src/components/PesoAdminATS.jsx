/**
 * APPLICANT TRACKING SYSTEM — where a PESO administrator works vacancies.
 *
 * WHAT: two ways in — pick ONE vacancy to see just its applicants, or "All
 * Applicants" to search everyone who applied across every vacancy at once (so
 * finding a citizen no longer requires first remembering which posting they
 * applied to). For any applicant: read the AI match score, open the exact resume
 * submitted, message them, change their pipeline status, or approve/reject a
 * referral. Several applicants can be moved to a status together via multi-select.
 *
 * WHEN: the "Applicant Pipeline" screen — the administrator's main working
 * surface.
 *
 * ── THE AI MATCH SCORE ─────────────────────────────────────────────────────
 * Computed once at apply time and stored on the application; this screen only
 * displays it. A ranking aid, not a decision — an unscored applicant (AI was
 * unavailable) is not hidden, they just need manual review.
 *
 * ── RESUME DOWNLOAD ────────────────────────────────────────────────────────
 * Fetched with the Authorization header as a blob, then opened from an object
 * URL — a plain window.open() cannot attach a bearer token, and the endpoint is
 * owner-scoped. The file is the immutable per-application snapshot.
 *
 * ── STATUS CHANGES NOTIFY THE APPLICANT ────────────────────────────────────
 * Single or bulk, moving someone writes an APPLICATION_STATUS notification. It is
 * best-effort: a failed notification never rolls back the status change.
 *
 * ── BULK STATUS IS OWNER-SCOPED SERVER-SIDE ────────────────────────────────
 * The bulk endpoint intersects the posted ids with this admin's vacancies, so a
 * tampered payload cannot touch another office's applicants — ids that aren't
 * theirs are reported as skipped, not applied.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, Briefcase, Users, MessageCircle, FileText,
    Loader2, Sparkles, Download, LayoutGrid, ChevronDown, UserSearch, Clock, FileCheck2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useChat } from '../context/ChatContext';
import API from '../api';
import ReferralActionButton from './ReferralActionButton';
import Avatar from './common/Avatar';
import useMultiSelect from './jobs/useMultiSelect';
import Pagination from './common/Pagination';
import ApplicantProfileDrawer from './ApplicantProfileDrawer';
import { SelectCheckbox } from './jobs/SelectionBar';
import { BulkActionBar } from './common/AdminUI';
import EmptyState from './common/EmptyState';
import SearchDropdown from './common/SearchDropdown';
import useRecentSearches from '../hooks/useRecentSearches';

const getAuthConfig = () => ({
    headers: { Authorization: `Bearer ${sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken')}` }
});

// Slow background-sync interval (ms) for the pipeline. Hybrid polling: the fast
// path is the ChatContext `scores_updated` socket push; this poll is only the
// resilience backstop for a missed event, a reconnect, or a transient blip.
// Configurable via VITE_PIPELINE_POLL_MS; 90s default.
const PIPELINE_POLL_MS = Number(import.meta.env.VITE_PIPELINE_POLL_MS) || 90000;

// The PESO workflow (standardized 2026-08-04): Applied → Under Review → Shortlisted → Referred.
// SETTABLE = the three an admin can pick in the ATS. 'Referred' is set by ISSUING a referral
// (the letter), never from a dropdown — so it's a read-only badge here, not an option. FILTER
// adds 'Referred' so the office can filter finalized applicants.
const ATS_SETTABLE_STATUSES = ['Applied', 'Under Review', 'Shortlisted'];
// FILTER adds the two system-set terminal states so the office can filter finalized
// applicants: 'Referred' (a referral was issued) and 'Not Referred' (declined, G3.2).
const ATS_FILTER_STATUSES = ['Applied', 'Under Review', 'Shortlisted', 'Referred', 'Not Referred'];

// One place for the status pill/select colours, so the per-card control and the
// read-only Referred/legacy badge stay in agreement.
const statusSelectTone = (status) =>
    status === 'Referred' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300' :
    status === 'Shortlisted' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400' :
    status === 'Under Review' ? 'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/20 dark:border-sky-800 dark:text-sky-300' :
    status === 'Applied' ? 'bg-sunken border-line text-muted' :
    // 'Not Referred' — system-set when a referral is rejected/declined (G3.2).
    status === 'Not Referred' ? 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300' :
    // Deprecated/legacy values kept only for historical rows.
    status === 'Hired' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400' :
    status === 'Interview' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-400' :
    status === 'Rejected' ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400' :
    'bg-sunken border-line text-muted';

const PesoAdminATS = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { notify } = useNotification();
    const { applicationUpdateTrigger, pipelineRefreshTrigger } = useChat();

    const [jobs, setJobs] = useState([]);
    // viewMode 'all' = every vacancy's applicants; 'job' = one selected vacancy.
    const [viewMode, setViewMode] = useState('all');
    const [selectedJob, setSelectedJob] = useState(null);
    // Each applicant row now carries its own referral_status + referral_reference
    // (both ATS endpoints select them), so the Refer button renders correctly in
    // every view without a separate per-vacancy referral fetch.
    const [applicants, setApplicants] = useState([]);

    const [loadingJobs, setLoadingJobs] = useState(true);
    const [loadingApplicants, setLoadingApplicants] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [exporting, setExporting] = useState(false);

    // Recent applicant searches, shown in the no-results empty state so an admin can
    // re-run a previous query in one click. Fed by the already-debounced search value.
    const { recent: recentSearches, record: recordSearch, remove: removeSearch, clear: clearSearches } = useRecentSearches('ats-applicants');
    useEffect(() => {
        const q = (debouncedSearch || '').trim();
        if (q) recordSearch(q);
    }, [debouncedSearch, recordSearch]);

    // Server-side pagination for the cross-job "all" view (Phase 1 fast-follow).
    // The per-job view stays client-side (bounded to one vacancy's applicants).
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);

    // AI-ranking controls (Enhancement B): sort by live match score + optional
    // minimum-score floor. Both drive the server ('all' view) and the per-job view.
    const [sort, setSort] = useState('recent');
    const [minScore, setMinScore] = useState(0);

    // Bulk status apply.
    const [bulkStatus, setBulkStatus] = useState('');
    const [bulkBusy, setBulkBusy] = useState(false);

    // Unified Applicant Profile drawer (Enhancement A). Holds { id, name } of the
    // application whose full profile is open, or null.
    const [profileTarget, setProfileTarget] = useState(null);

    // Fetch the admin's live jobs (for the left rail + counts).
    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const response = await API.get('/peso-admin/ats/jobs', getAuthConfig());
                setJobs(response.data?.data || []);
            } catch (error) {
                console.error("ATS Job Fetch Error:", error);
            } finally {
                setLoadingJobs(false);
            }
        };
        fetchJobs();
    }, [applicationUpdateTrigger]);

    // Debounce the search box so the cross-job view queries once typing pauses.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    // Any search / status / view change returns to page 1.
    useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, viewMode, selectedJob, sort, minScore]);

    // Fetch applicants for the current view. The cross-job "all" view is
    // server-side (search / status / page go to the API); the per-job view fetches
    // that vacancy's applicants and filters client-side.
    // `silent` refetches in the BACKGROUND (no spinner, no error toast) — used by
    // the auto-refresh so completed re-scores surface without a manual reload.
    const fetchApplicants = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoadingApplicants(true);
        try {
            let url;
            if (viewMode === 'all') {
                const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
                if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
                if (statusFilter) params.set('status', statusFilter);
                if (minScore > 0) params.set('minScore', String(minScore));
                url = `/peso-admin/ats/applicants?${params.toString()}`;
            } else {
                url = selectedJob ? `/peso-admin/ats/jobs/${selectedJob.id}/applicants?sort=${sort}` : null;
            }
            if (!url) { setApplicants([]); setTotal(0); return; }
            const response = await API.get(url, getAuthConfig());
            setApplicants(response.data.data || []);
            if (viewMode === 'all') setTotal(response.data.total || 0);
        } catch (error) {
            console.error("Applicant Fetch Error", error);
            if (!silent) notify.error("Data Error", "Failed to load applicants.");
        } finally {
            if (!silent) setLoadingApplicants(false);
        }
    }, [viewMode, selectedJob, page, limit, debouncedSearch, statusFilter, sort, minScore, notify]);

    useEffect(() => { fetchApplicants(); }, [fetchApplicants, applicationUpdateTrigger]);

    // Hybrid polling — RESILIENCE BACKSTOP (Enhancement B).
    // The LIVE score changes when a background re-score completes. The fast path is
    // the `scores_updated` socket push (effect below); this slow poll only catches
    // a missed event / reconnect / transient blip, so the ranking is eventually
    // consistent even if a push is lost. Silent = no spinner flash, no error toast;
    // the immutable apply-time score never changes, so nothing historical is
    // disturbed. Visibility-gated: a hidden tab does not poll, and refetches once
    // when it becomes visible again (catching up on anything it slept through).
    useEffect(() => {
        // Debounce (D1): the scores_updated socket is the instant path; this poll +
        // the tab-focus refetch are the backstops. Collapse rapid tab switches so a
        // burst of focus events triggers at most one silent refetch per MIN_REFETCH_MS.
        const MIN_REFETCH_MS = 20000;
        let lastAt = 0;
        const refetch = () => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - lastAt < MIN_REFETCH_MS) return;
            lastAt = now;
            fetchApplicants({ silent: true });
        };
        const id = setInterval(refetch, PIPELINE_POLL_MS);
        document.addEventListener('visibilitychange', refetch);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', refetch);
        };
    }, [fetchApplicants]);

    // Hybrid polling — REAL-TIME PATH. When a re-score for one of this admin's
    // vacancies lands, ChatContext bumps pipelineRefreshTrigger; refetch silently
    // so the new ranking surfaces at once instead of waiting for the slow poll. The
    // socket is only the trigger — the data still comes from the owner-scoped DB
    // endpoint (invariant 0.3). Excludes fetchApplicants from deps on purpose: a
    // filter change already refetches via the effect above; this must fire ONLY on
    // a genuine score push, using the latest fetchApplicants closure.
    useEffect(() => {
        if (pipelineRefreshTrigger === 0) return; // ignore the initial mount value
        fetchApplicants({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pipelineRefreshTrigger]);

    const selectJob = (job) => { setViewMode('job'); setSelectedJob(job); setSearchQuery(''); };
    const selectAllView = () => { setViewMode('all'); setSelectedJob(null); setSearchQuery(''); };

    // Single-applicant status change (the per-card select).
    const handleUpdateStatus = async (applicationId, newStatus) => {
        const previous = applicants;
        setApplicants(prev => prev.map(a => a.application_id === applicationId ? { ...a, status: newStatus } : a));
        try {
            // BUGFIX: this used an undefined `id` — every status change threw a
            // ReferenceError before the request was ever sent.
            await API.put(`/peso-admin/ats/applications/${applicationId}/status`, { status: newStatus }, getAuthConfig());
            notify.success("Pipeline Updated", `Applicant moved to ${newStatus}.`);
        } catch (error) {
            setApplicants(previous);
            notify.error("Update Failed", "Could not change applicant status. Please try again.");
        }
    };

    const viewResume = async (applicant) => {
        if (!applicant?.has_resume) return notify.warning("No Resume", "This applicant did not submit a resume.");
        try {
            const response = await API.get(
                `/peso-admin/ats/applications/${applicant.application_id}/resume`,
                { ...getAuthConfig(), responseType: 'blob' }
            );
            const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) {
            notify.error("Could not open resume", error?.response?.data?.message || "The resume could not be loaded.");
        }
    };

    const handleMessageApplicant = async (applicantUserId, jobId, applicantName) => {
        try {
            const response = await API.post('/messages/conversations', { applicant_id: applicantUserId, job_id: jobId }, getAuthConfig());
            if (response.data.status === 'success') {
                notify.success("Chat Initialized", `Opening secure channel with ${applicantName}...`);
                navigate('/messages');
            }
        } catch (error) {
            notify.error("Connection Error", "Could not connect to the messaging server.");
        }
    };

    // Client-side view filter (search + status), applied to both modes so the
    // list always matches the controls above it.
    const filteredApplicants = applicants.filter(app => {
        const q = searchQuery.toLowerCase();
        const matchesSearch = !q
            || (app?.name || '').toLowerCase().includes(q)
            || (app?.email || '').toLowerCase().includes(q)
            || (app?.job_title || '').toLowerCase().includes(q);
        const matchesStatus = !statusFilter || app?.status === statusFilter;
        // minScore floor for the per-job view (the 'all' view filters server-side).
        const effScore = app?.current_match_score ?? app?.match_score;
        const matchesScore = minScore <= 0 || (effScore != null && effScore >= minScore);
        return matchesSearch && matchesStatus && matchesScore;
    });

    // 'all' rows arrive already filtered/paged from the server; the per-job view
    // filters client-side. `list` is what renders and drives bulk selection.
    const list = viewMode === 'all' ? applicants : filteredApplicants;
    const visibleIds = list.map(a => a.application_id);
    const ms = useMultiSelect(visibleIds);

    // Search-dropdown sections for the applicant pipeline: live matches from the
    // current list while typing, and the ATS statuses as one-tap quick filters.
    const applicantResults = (searchQuery || '').trim()
        ? list.slice(0, 6).map((a) => ({ key: a.application_id, label: a.name || 'Applicant', sublabel: a.job_title || a.email }))
        : [];
    const statusQuickFilters = ATS_FILTER_STATUSES.map((s) => ({
        key: s, label: s, active: statusFilter === s,
        onToggle: () => setStatusFilter(statusFilter === s ? '' : s),
    }));

    // Leaving a view or changing the filter clears a selection that no longer
    // matches what's on screen.
    useEffect(() => { ms.clear(); setBulkStatus(''); /* eslint-disable-next-line */ }, [viewMode, selectedJob, statusFilter, page, debouncedSearch]);

    const applyBulkStatus = async () => {
        if (!bulkStatus || ms.count === 0) return;
        setBulkBusy(true);
        const targetIds = ms.ids;
        try {
            const res = await API.put('/peso-admin/ats/applications/bulk/status',
                { applicationIds: targetIds, status: bulkStatus }, getAuthConfig());
            const { updated = 0, skipped = 0 } = res.data?.data || {};
            setApplicants(prev => prev.map(a => targetIds.includes(a.application_id) ? { ...a, status: bulkStatus } : a));
            notify.success("Applicants Updated", `${updated} moved to ${bulkStatus}${skipped ? `, ${skipped} skipped` : ''}.`);
            ms.clear();
            setBulkStatus('');
        } catch (error) {
            notify.error("Bulk Update Failed", error.response?.data?.message || "Could not update the selected applicants.");
        } finally {
            setBulkBusy(false);
        }
    };

    const exportApplicants = async () => {
        setExporting(true);
        try {
            const params = new URLSearchParams();
            if (searchQuery.trim()) params.set('search', searchQuery.trim());
            if (statusFilter) params.set('status', statusFilter);
            if (viewMode === 'job' && selectedJob) params.set('jobId', selectedJob.id);
            const res = await API.get(`/peso-admin/ats/applicants/export?${params.toString()}`, { ...getAuthConfig(), responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `peso-applicants-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (error) {
            notify.error("Export Failed", "Could not export the applicant list.");
        } finally {
            setExporting(false);
        }
    };

    const totalApplicants = jobs.reduce((sum, j) => sum + (Number(j.applicants_count) || 0), 0);
    const headerTitle = viewMode === 'all' ? 'All Applicants' : `${selectedJob?.title || ''} Pipeline`;

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Application Tracking</h1>
                <p className="text-muted mt-2 font-medium">Review live candidates across every vacancy, manage pipelines, and communicate directly.</p>
            </header>

            <div className="flex flex-col lg:flex-row gap-4 sm:gap-5 lg:h-[calc(100vh-12rem)]">

                {/* ================= LEFT PANE: view switch + roles ================= */}
                <div className="w-full lg:w-1/3 flex flex-col bg-raised/80 backdrop-blur-xl rounded-2xl border border-line shadow-sm overflow-hidden shrink-0 max-h-[40vh] lg:max-h-none">
                    <div className="p-3 border-b border-line">
                        <button
                            onClick={selectAllView}
                            className={`w-full text-left p-4 rounded-2xl transition-all border flex items-center justify-between ${viewMode === 'all' ? 'bg-accent-soft border-accent/25' : 'border-transparent hover:bg-sunken'}`}
                        >
                            <span className="flex items-center gap-2 font-bold text-sm text-content">
                                <LayoutGrid size={16} className="text-accent-text" /> All Applicants
                            </span>
                            <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black px-2 py-0.5 rounded-md">{totalApplicants}</span>
                        </button>
                    </div>

                    <div className="px-3 pt-3 pb-1">
                        <p className="text-[11px] font-black uppercase tracking-wider text-subtle">Your Active Roles</p>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 pt-1 space-y-2">
                        {loadingJobs ? (
                            <div className="flex justify-center p-10"><Loader2 className="animate-spin text-accent-text" size={24} /></div>
                        ) : jobs.length === 0 ? (
                            <div className="text-center px-4 py-8">
                                <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-sunken border border-line mb-3 es-float">
                                    <Briefcase size={22} className="text-accent-text" />
                                </span>
                                <p className="text-sm font-black text-content">No vacancies yet</p>
                                <p className="text-xs text-muted mt-1 leading-relaxed">Publish a job in Job Publication Management and applicants will show up here for screening.</p>
                            </div>
                        ) : (
                            jobs.map(job => {
                                const isSelected = viewMode === 'job' && selectedJob?.id === job.id;
                                return (
                                    <button
                                        key={job.id}
                                        onClick={() => selectJob(job)}
                                        className={`w-full text-left p-4 rounded-2xl transition-all border ${isSelected ? 'bg-surface border-line shadow-sm ring-1 ring-accent/10' : 'border-transparent hover:bg-sunken'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1 gap-2">
                                            <h4 className={`font-bold text-sm ${isSelected ? 'text-accent-text' : 'text-content'}`}>{job.title}</h4>
                                            <span className="shrink-0 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1">
                                                <Users size={10} /> {job.applicants_count || 0}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted font-medium">{job.location}</p>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ================= RIGHT PANE: applicant pipeline ================= */}
                <div className="flex-1 bg-raised/80 backdrop-blur-xl rounded-2xl border border-line shadow-sm overflow-hidden flex flex-col min-w-0">
                    <div className="p-4 border-b border-line bg-sunken/50 flex flex-col gap-3 shrink-0">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div className="min-w-0">
                                <h2 className="text-xl font-black text-content truncate">{headerTitle}</h2>
                                <p className="text-sm font-medium text-muted mt-1">Showing {viewMode === 'all' ? total : list.length} application{(viewMode === 'all' ? total : list.length) === 1 ? '' : 's'}</p>
                            </div>
                            <button
                                onClick={exportApplicants}
                                disabled={exporting || list.length === 0}
                                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-accent-text bg-surface border border-line shadow-sm hover:bg-sunken transition-colors disabled:opacity-50"
                            >
                                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export CSV
                            </button>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <SearchDropdown
                                className="flex-1"
                                size="sm"
                                value={searchQuery}
                                onChange={setSearchQuery}
                                onSubmit={(term) => { setSearchQuery(term); if (term) recordSearch(term); }}
                                placeholder={viewMode === 'all' ? 'Search by name, email, or vacancy…' : 'Search by name or email…'}
                                ariaLabel="Search applicants"
                                recent={recentSearches}
                                onRemoveRecent={removeSearch}
                                onClearRecent={clearSearches}
                                results={applicantResults}
                                quickFilters={statusQuickFilters}
                            />
                            <div className="relative">
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    aria-label="Filter by status"
                                    className="appearance-none w-full sm:w-44 pl-4 pr-9 py-2 bg-surface border border-line rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-accent/30 text-content cursor-pointer transition-all"
                                >
                                    <option value="">All statuses</option>
                                    {ATS_FILTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-2.5 text-subtle pointer-events-none" />
                            </div>
                            <div className="relative">
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                    aria-label="Sort applicants"
                                    className="appearance-none w-full sm:w-44 pl-4 pr-9 py-2 bg-surface border border-line rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-accent/30 text-content cursor-pointer transition-all"
                                >
                                    <option value="recent">Most recent</option>
                                    <option value="match_desc">Highest AI match</option>
                                    <option value="match_asc">Lowest AI match</option>
                                    <option value="oldest">Oldest first</option>
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-2.5 text-subtle pointer-events-none" />
                            </div>
                            <div className="relative">
                                <select
                                    value={minScore}
                                    onChange={(e) => setMinScore(Number(e.target.value))}
                                    aria-label="Minimum AI match score"
                                    className="appearance-none w-full sm:w-40 pl-4 pr-9 py-2 bg-surface border border-line rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-accent/30 text-content cursor-pointer transition-all"
                                >
                                    <option value={0}>Any score</option>
                                    <option value={60}>≥ 60% match</option>
                                    <option value={75}>≥ 75% match</option>
                                    <option value={90}>≥ 90% match</option>
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-2.5 text-subtle pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                        {ms.selectMode && (
                            <BulkActionBar
                                count={ms.count}
                                nouns={{ singular: 'applicant', plural: 'applicants' }}
                                allSelected={ms.allSelected}
                                onToggleAll={ms.toggleAll}
                                onCancel={ms.clear}
                                busy={bulkBusy}
                            >
                                <div className="relative">
                                    <select
                                        value={bulkStatus}
                                        onChange={(e) => setBulkStatus(e.target.value)}
                                        disabled={bulkBusy}
                                        aria-label="Bulk status to apply"
                                        className="appearance-none pl-3 pr-8 py-1.5 rounded-xl text-xs font-bold bg-surface border border-line outline-none focus:ring-2 focus:ring-accent/40 text-content cursor-pointer"
                                    >
                                        <option value="">Set status…</option>
                                        {ATS_SETTABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <ChevronDown size={13} className="absolute right-2.5 top-2 text-subtle pointer-events-none" />
                                </div>
                                <button
                                    type="button"
                                    onClick={applyBulkStatus}
                                    disabled={bulkBusy || !bulkStatus}
                                    className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-contrast text-xs font-black shadow-sm transition-colors disabled:opacity-50"
                                >
                                    Apply
                                </button>
                            </BulkActionBar>
                        )}

                        {viewMode === 'all' && !loadingApplicants && (
                            <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} position="top" />
                        )}

                        {loadingApplicants ? (
                            <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-accent-text" size={32} /></div>
                        ) : list.length === 0 ? (
                            (searchQuery || statusFilter) ? (
                                <EmptyState
                                    variant="search"
                                    title={searchQuery ? `No applicants match “${searchQuery}”` : 'No applicants match your filters'}
                                    description="No candidates match the current search or status filter. Try a different keyword from the search box, or clear the filters to see everyone in the pipeline."
                                    primaryAction={{ label: 'Clear filters', onClick: () => { setSearchQuery(''); setStatusFilter(''); } }}
                                />
                            ) : (
                                <EmptyState
                                    icon={Users}
                                    title="No applicants yet"
                                    description="This is your Applicant Pipeline. As job seekers apply to your vacancies, their live records appear here — ranked by AI compatibility — so you can screen, shortlist, and refer them from one place."
                                    primaryAction={{ label: 'Manage Vacancies', to: '/peso-admin/jobs' }}
                                />
                            )
                        ) : (
                            list.map((applicant, index) => {
                                const safeName = applicant?.name || 'Unknown Applicant';
                                // Live score (Enhancement B) with apply-time fallback.
                                const matchScore = applicant?.current_match_score ?? applicant?.match_score;
                                const isLiveScore = applicant?.current_match_score != null;
                                const showRank = sort === 'match_desc' && matchScore != null && matchScore !== undefined;
                                const rankNumber = index + 1 + (viewMode === 'all' ? (page - 1) * limit : 0);
                                const selected = ms.isSelected(applicant.application_id);
                                return (
                                    <div key={applicant.application_id} className={`bg-surface border rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm hover:shadow-md transition-all ${selected ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}>

                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <SelectCheckbox
                                                checked={selected}
                                                selectMode={ms.selectMode}
                                                onToggle={() => (ms.selectMode ? ms.toggle(applicant.application_id) : ms.enterWith(applicant.application_id))}
                                            />
                                            <Avatar user={applicant} size={44} alt={safeName} className="shadow-sm" />
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-content text-lg truncate">{safeName}</h3>
                                                <p className="text-sm text-muted font-medium truncate">{applicant?.email || 'No email provided'}</p>
                                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                                    {showRank && (
                                                        <span className="flex items-center justify-center text-[10px] font-black bg-accent text-accent-contrast min-w-[20px] h-5 px-1 rounded-md" title="AI rank (by live score)">#{rankNumber}</span>
                                                    )}
                                                    {/* Live AI score — recalculated as evidence changes; DRIVES ranking. */}
                                                    {isLiveScore && (
                                                        <span
                                                            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md border border-emerald-100 dark:border-emerald-800/50"
                                                            title={applicant?.scored_at ? `Live AI match — recalculated ${new Date(applicant.scored_at).toLocaleString()}. This drives ranking.` : 'Live AI match — drives ranking.'}
                                                        >
                                                            <Sparkles size={10} /> {applicant.current_match_score}% Live
                                                        </span>
                                                    )}
                                                    {/* Apply-time AI score — IMMUTABLE snapshot, for audit. */}
                                                    {typeof applicant?.match_score === 'number' && (
                                                        <span
                                                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-sunken text-muted px-2 py-0.5 rounded-md border border-line"
                                                            title="AI match at time of application — immutable snapshot for auditing."
                                                        >
                                                            <Clock size={10} /> {applicant.match_score}% at apply
                                                        </span>
                                                    )}
                                                    {/* Never scored. */}
                                                    {!isLiveScore && typeof applicant?.match_score !== 'number' && (
                                                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-sunken text-subtle px-2 py-0.5 rounded-md" title="Not yet scored — manual review.">
                                                            Not scored
                                                        </span>
                                                    )}
                                                    {/* In "All Applicants" the vacancy is not obvious from the
                                                        left rail, so name it on the card. */}
                                                    {viewMode === 'all' && applicant?.job_title && (
                                                        <span className="flex items-center gap-1 text-[10px] font-bold bg-sunken text-muted px-2 py-0.5 rounded-md border border-line">
                                                            <Briefcase size={10} /> {applicant.job_title}
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] font-bold text-subtle">
                                                        Applied: {applicant?.applied_at ? new Date(applicant.applied_at).toLocaleDateString() : 'Recently'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="w-full md:w-auto flex flex-col sm:flex-row items-center gap-3 shrink-0">
                                            {ATS_SETTABLE_STATUSES.includes(applicant?.status || 'Applied') ? (
                                                <select
                                                    value={applicant?.status || 'Applied'}
                                                    onChange={(e) => handleUpdateStatus(applicant.application_id, e.target.value)}
                                                    aria-label={`Change application status${applicant?.applicant_name ? ` for ${applicant.applicant_name}` : ''}`}
                                                    className={`w-full sm:w-40 px-4 py-2.5 rounded-xl text-sm font-bold border outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer appearance-none transition-colors ${statusSelectTone(applicant?.status)}`}
                                                >
                                                    {ATS_SETTABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            ) : (
                                                // 'Referred' (and any deprecated/legacy status) is a FINALIZED record —
                                                // shown as a read-only badge, not an editable dropdown. To change a
                                                // referred application, void the referral (which reopens it).
                                                <span
                                                    className={`w-full sm:w-40 px-4 py-2.5 rounded-xl text-sm font-bold border text-center inline-flex items-center justify-center gap-1.5 ${statusSelectTone(applicant?.status)}`}
                                                    title={applicant?.status === 'Referred' ? 'Referred — finalized. Void the referral to reopen.'
                                                        : applicant?.status === 'Not Referred' ? 'Not referred — PESO decided not to refer this application.'
                                                        : `${applicant?.status} (historical)`}
                                                >
                                                    {applicant?.status === 'Referred' && <FileCheck2 size={14} />}{applicant?.status}
                                                </span>
                                            )}

                                            <div className="flex w-full sm:w-auto gap-2">
                                                <button
                                                    onClick={() => setProfileTarget({ id: applicant.application_id, name: safeName })}
                                                    className="flex-1 sm:flex-none p-2.5 rounded-xl bg-sunken text-muted hover:bg-line transition-colors flex items-center justify-center"
                                                    title="View full profile"
                                                >
                                                    <UserSearch size={18} />
                                                </button>
                                                <button
                                                    onClick={() => viewResume(applicant)}
                                                    className={`flex-1 sm:flex-none p-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 ${applicant?.has_resume ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50' : 'bg-sunken text-subtle'}`}
                                                    title="View Resume"
                                                >
                                                    <FileText size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleMessageApplicant(applicant.user_id, applicant.job_id ?? selectedJob?.id, safeName)}
                                                    className="flex-1 sm:flex-none px-4 py-2.5 bg-accent text-accent-contrast font-black rounded-xl hover:bg-accent-hover hover:-translate-y-0.5 transition-all shadow-md flex items-center justify-center gap-2"
                                                    title="Message Applicant"
                                                >
                                                    <MessageCircle size={18} /> <span className="sm:hidden">Message</span>
                                                </button>
                                                <ReferralActionButton
                                                    applicationId={applicant.application_id}
                                                    applicantName={safeName}
                                                    initialStatus={applicant.referral_status || null}
                                                    initialReference={applicant.referral_reference || null}
                                                    referredCount={applicant.referred_count ?? selectedJob?.referred_count}
                                                    positionsAvailable={applicant.positions_available ?? selectedJob?.positions_available}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}

                        {viewMode === 'all' && !loadingApplicants && (
                            <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
                        )}
                    </div>
                </div>
            </div>

            {profileTarget && (
                <ApplicantProfileDrawer
                    applicationId={profileTarget.id}
                    applicantName={profileTarget.name}
                    onClose={() => setProfileTarget(null)}
                />
            )}
        </div>
    );
};

export default PesoAdminATS;
