import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    Bookmark, Building2, MapPin, Briefcase, ArrowRight, Trash2,
    ExternalLink, Ban, Clock, XCircle, Users, Compass, CalendarClock
} from 'lucide-react';
import API from '../api';
import { Skeleton, SkeletonPageHeader, SkeletonCompactCardGrid } from './Skeleton';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import useJobFilters from './jobs/useJobFilters';
import JobFilterBar from './jobs/JobFilterBar';
import { savedJobState } from './jobs/JobCard';
import { PinButton, ColorLabelPicker, cardTheme, pinnedFirst } from './jobs/CardLabels';
import useMultiSelect from './jobs/useMultiSelect';
import useTrashAction from './jobs/useTrashAction';
import { SelectCheckbox } from './jobs/SelectionBar';
import { BulkActionBar, BulkDeleteButton } from './common/AdminUI';
import Pagination from './common/Pagination';
import useClientPagination from '../hooks/useClientPagination';
import EmptyState from './common/EmptyState';

// 🚨 PRESERVED: Strict Session Isolation
const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

// Saved Vacancies is a BOOKMARK MANAGER, not a second job-details/AI surface.
// The Public Job Board is the single source of truth for job details, the AI
// compatibility score, employer info and the Apply flow. Opening an ACTIVE saved
// vacancy deep-links to the board (`/job-board?job=<id>`); a job that is closed,
// filled, expired or removed shows a lightweight "no longer available" tombstone
// instead of loading it. Availability is derived by savedJobState() (jobs/JobCard).

// Presentation for each derived state's badge (active gets no badge — it is the
// normal case). Kept contrast-safe on light and dark.
const STATE_BADGE = {
    filled:      { icon: Users,   cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600' },
    closed:      { icon: XCircle, cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800' },
    expired:     { icon: Clock,   cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800' },
    unavailable: { icon: Ban,     cls: 'bg-sunken text-muted border-line dark:bg-raised/40 dark:text-muted dark:border-line' },
    removed:     { icon: Ban,     cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800' },
};

// Status filter tabs. 'all'/'active' always show; the rest only when populated.
const STATE_TABS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'filled', label: 'Filled' },
    { key: 'closed', label: 'Closed' },
    { key: 'expired', label: 'Expired' },
    { key: 'unavailable', label: 'Unavailable' },
    { key: 'removed', label: 'Removed' },
];

const formatChecked = (ts) => {
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return null;
    const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
};

const StatusBadge = ({ stateKey, label }) => {
    const meta = STATE_BADGE[stateKey];
    if (!meta) return null;
    const Icon = meta.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase tracking-wide ${meta.cls}`}>
            <Icon size={11} /> {label}
        </span>
    );
};

const SavedJobs = () => {
    const { user } = useAuth();
    const [savedJobs, setSavedJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stateFilter, setStateFilter] = useState('all');
    const [tombstone, setTombstone] = useState(null); // the dead job shown in the info panel
    const [savingPref, setSavingPref] = useState(null);

    const { notify } = useNotification();
    const navigate = useNavigate();

    const jf = useJobFilters(savedJobs);

    // Derived-state counts over the search/category-filtered list, so the tabs
    // reflect what the user is currently looking at.
    const stateCounts = useMemo(() => {
        const counts = {};
        jf.filtered.forEach(j => { const k = savedJobState(j).key; counts[k] = (counts[k] || 0) + 1; });
        counts.all = jf.filtered.length;
        return counts;
    }, [jf.filtered]);

    const stateFiltered = useMemo(() => (
        stateFilter === 'all' ? jf.filtered : jf.filtered.filter(j => savedJobState(j).key === stateFilter)
    ), [jf.filtered, stateFilter]);

    const orderedJobs = pinnedFirst(stateFiltered);
    const pager = useClientPagination(orderedJobs);

    // Multi-select operates on the CURRENTLY VISIBLE rows only. saved_id is the
    // trash key (the saved_jobs row id) — NOT job.id (the vacancy).
    const visibleIds = stateFiltered.map(j => j.saved_id ?? j.id);
    const ms = useMultiSelect(visibleIds);
    const trash = useTrashAction({
        type: 'saved-jobs',
        nouns: { singular: 'Vacancy', plural: 'Vacancies' },
        onDone: () => { ms.clear(); setTombstone(null); loadSynchronizedData(); },
    });

    useEffect(() => {
        loadSynchronizedData();
    }, []);

    const loadSynchronizedData = async () => {
        setLoading(true);
        try {
            const response = await API.get('/saved-jobs', getAuthConfig());
            const jobsArray = Array.isArray(response.data) ? response.data : (response.data?.data || []);
            setSavedJobs(jobsArray);
        } catch (error) {
            console.error("Fetch Saved Jobs Error:", error);
            notify.error("Error", "Failed to load your saved jobs.");
            setSavedJobs([]);
        } finally {
            setLoading(false);
        }
    };

    // Pin / colour-label writes. Optimistic with rollback on failure.
    const updatePreference = async (jobId, patch) => {
        const previous = savedJobs;
        setSavingPref(jobId);
        setSavedJobs(prev => prev.map(j => (j.job_id === jobId || j.id === jobId) ? { ...j, ...patch } : j));
        try {
            await API.patch(`/saved-jobs/${jobId}/preferences`, patch, getAuthConfig());
        } catch (error) {
            setSavedJobs(previous);
            notify.error('Could not save', 'Your change was not stored. Please try again.');
        } finally {
            setSavingPref(null);
        }
    };

    // Remove now goes through the SAME soft-delete Trash path as multi-select
    // (commit-first with an Undo toast, §6.7) — the single-item Remove used to be a
    // hard delete, which was inconsistent with the bulk action.
    const removeOne = (rowId) => trash.moveToTrash([rowId]);

    // Card click: active → the board (single source of truth); otherwise the
    // tombstone. Validation is derived from the list payload the server already
    // returned (status / job_deleted), so there is no extra request per open.
    const handleCardOpen = (job, rowId) => {
        if (ms.consumedLongPress()) return;
        if (ms.selectMode) { ms.toggle(rowId); return; }
        const st = savedJobState(job);
        if (st.active) {
            navigate(`/job-board?job=${job.job_id}`);
        } else {
            setTombstone(job);
        }
    };

    const browseSimilar = (job) => {
        const cat = (job.category || job.department || '').toString().trim();
        setTombstone(null);
        navigate(cat ? `/job-board?category=${encodeURIComponent(cat)}` : '/job-board');
    };

    if (loading) return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen">
            <SkeletonPageHeader />
            {/* Filter bar + status tabs placeholders mirror the loaded layout, so the card
                grid lands in the same place after load (no shift). */}
            <Skeleton className="h-11 w-full rounded-2xl mb-4" />
            <div className="flex flex-wrap gap-2 mb-6">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-xl" />)}
            </div>
            <SkeletonCompactCardGrid count={8} />
        </div>
    );

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in relative">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">
                    Saved Vacancies
                </h1>
                <p className="text-muted mt-1 font-medium text-sm">
                    Your bookmarked jobs. Open an active one to view full details and apply on the Job Board.
                </p>
            </header>

            {savedJobs.length > 0 && !ms.selectMode && (
                <JobFilterBar filters={jf} variant="radiant" resultCount={jf.activeCount > 0 ? jf.filtered.length : null} className="mb-4" searchNamespace="saved-jobs" searchPlaceholder="Search saved jobs…" />
            )}

            {/* Status tabs — group/filter by derived availability. 'all'/'active'
                always show; the rest appear only when there is something in them. */}
            {savedJobs.length > 0 && !ms.selectMode && (
                <div className="flex flex-wrap gap-2 mb-6">
                    {STATE_TABS.filter(t => t.key === 'all' || t.key === 'active' || (stateCounts[t.key] || 0) > 0).map(t => {
                        const n = stateCounts[t.key] || 0;
                        const active = stateFilter === t.key;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setStateFilter(t.key)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                                    active
                                        ? 'bg-accent text-accent-contrast border-accent'
                                        : 'bg-surface/70 text-muted border-line hover:border-accent/40'
                                }`}
                            >
                                {t.label} <span className={active ? 'opacity-80' : 'text-subtle'}>({n})</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {ms.selectMode && (
                // Same shared Bulk Actions shell + delete button as My Applications, so both
                // modules read identically (2026-08-07 UI consistency). Behaviour unchanged —
                // same count / select-all / cancel / delete handlers as before.
                <BulkActionBar
                    count={ms.count}
                    nouns={{ singular: 'vacancy', plural: 'vacancies' }}
                    allSelected={ms.allSelected}
                    onToggleAll={ms.toggleAll}
                    onCancel={ms.clear}
                    busy={trash.busy}
                >
                    <BulkDeleteButton onClick={() => trash.moveToTrash(ms.ids)} disabled={trash.busy} />
                </BulkActionBar>
            )}

            {stateFiltered.length > 0 && (
                <Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} position="top" />
            )}

            <div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
                {savedJobs.length === 0 ? (
                    <EmptyState
                        className="col-span-full"
                        icon={Bookmark}
                        title="No saved jobs yet"
                        description="Tap the bookmark icon on any vacancy to save it here. Saved jobs let you shortlist opportunities you like, compare them side by side, and come back to apply when you're ready — nothing is submitted until you choose to apply."
                        primaryAction={{ label: 'Browse Jobs', to: '/job-board', icon: <Compass size={16} /> }}
                    />
                ) : stateFiltered.length === 0 ? (
                    <EmptyState
                        className="col-span-full"
                        variant="search"
                        title="No saved jobs match your filters"
                        description="None of your saved jobs match the current search, status, or category. Try broadening your filters to see the rest of your bookmarks."
                        primaryAction={{ label: 'Clear filters', onClick: () => { jf.reset(); setStateFilter('all'); } }}
                    />
                ) : (
                    pager.pageItems.map((job) => {
                        const t = cardTheme(job.color_label);
                        const rowId = job.saved_id ?? job.id;
                        const picked = ms.isSelected(rowId);
                        const st = savedJobState(job);
                        const checked = formatChecked(job.last_checked_at);
                        return (
                        <div
                            key={job.saved_id ?? job.id}
                            {...ms.longPressProps(rowId)}
                            onClick={() => handleCardOpen(job, rowId)}
                            className={`h-full rounded-3xl shadow-card border hover:shadow-raised hover:-translate-y-1 transition-all duration-300 ease-out flex flex-col cursor-pointer group overflow-hidden ${t.surface} ${picked ? 'border-accent ring-2 ring-accent/40' : (job.is_pinned && !t.labelled ? 'border-accent/40' : t.border)} ${!st.active ? 'opacity-[0.97]' : ''}`}
                        >
                            <div className="p-4 flex flex-col flex-1 min-h-0">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <SelectCheckbox
                                            checked={picked}
                                            selectMode={ms.selectMode}
                                            onToggle={() => (ms.selectMode ? ms.toggle(rowId) : ms.enterWith(rowId))}
                                        />
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${t.labelled ? `${t.chip} ${t.ink}` : 'bg-sunken text-accent-text border-line'}`}>
                                            <Building2 size={20} />
                                        </div>
                                    </div>
                                    <div className={`flex items-center gap-0.5 ${t.labelled ? t.ink : ''}`}>
                                        <PinButton
                                            pinned={!!job.is_pinned}
                                            busy={savingPref === job.job_id}
                                            onTint={t.labelled}
                                            onToggle={(next) => updatePreference(job.job_id, { is_pinned: next })}
                                        />
                                        <ColorLabelPicker
                                            colorKey={job.color_label}
                                            busy={savingPref === job.job_id}
                                            onTint={t.labelled}
                                            onPick={(key) => updatePreference(job.job_id, { color_label: key })}
                                        />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeOne(rowId); }}
                                            className={`p-1.5 transition-all rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${t.labelled ? 'text-current dim-until-hover hover:bg-black/5 dark:hover:bg-surface/10' : 'text-subtle hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 reveal-on-hover'}`}
                                            title="Remove from saved jobs"
                                            aria-label="Remove from saved jobs"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>

                                {!st.active && (
                                    <div className="mb-2"><StatusBadge stateKey={st.key} label={st.label} /></div>
                                )}

                                <h2 className={`text-sm sm:text-base font-black mb-1 leading-snug line-clamp-2 transition-colors ${t.ink} ${t.labelled ? '' : 'group-hover:text-accent-text'}`}>{job.title}</h2>
                                <p className={`text-xs font-semibold mb-3 line-clamp-1 ${t.inkMuted}`}>{job.company}</p>

                                <div className={`flex flex-wrap gap-1.5 text-[11px] font-bold mb-3 ${t.labelled ? t.ink : 'text-muted'}`}>
                                    <span className={`px-2 py-1 rounded-lg border flex items-center gap-1 ${t.chip}`}><MapPin size={11} className={t.labelled ? '' : 'text-accent-text'}/> {job.location || 'Kabankalan'}</span>
                                    {job.work_setup && <span className={`px-2 py-1 rounded-lg border flex items-center gap-1 ${t.chip}`}><Briefcase size={11} className={t.labelled ? '' : 'text-accent-text'}/> {job.work_setup}</span>}
                                </div>

                                {checked && (
                                    <p className={`text-[10px] font-semibold mb-2 flex items-center gap-1 ${t.labelled ? t.inkMuted : 'text-subtle'}`}>
                                        <CalendarClock size={10} /> Status checked {checked}
                                    </p>
                                )}

                                <div className={`mt-auto pt-2.5 border-t flex items-center justify-between text-xs font-bold ${t.divider} ${t.labelled ? t.ink : (st.active ? 'text-accent-text' : 'text-subtle')}`}>
                                    {st.active
                                        ? (<><span className="flex items-center gap-1">View on Job Board <ExternalLink size={12} /></span> <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" /></>)
                                        : (<><span>View status</span> <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" /></>)}
                                </div>
                            </div>
                        </div>
                        );
                    })
                )}
            </div>

            {stateFiltered.length > 0 && (
                <Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} />
            )}

            {/* Tombstone — a closed/filled/expired/removed saved vacancy. No details
                fetch, no AI: just an honest status and the two useful actions. */}
            {tombstone && createPortal(
                <div
                    className="fixed inset-0 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200 cursor-pointer"
                    onClick={() => setTombstone(null)}
                >
                    <div
                        className="w-full max-w-md bg-raised rounded-3xl shadow-2xl border border-line overflow-hidden cursor-default"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Vacancy no longer available"
                    >
                        <div className="p-6 text-center">
                            <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sunken border border-line mb-4">
                                <Ban size={26} className="text-subtle" />
                            </span>
                            <div className="mb-2 flex justify-center">
                                <StatusBadge stateKey={savedJobState(tombstone).key} label={savedJobState(tombstone).label} />
                            </div>
                            <h3 className="text-lg font-black text-content">{tombstone.title}</h3>
                            <p className="text-sm font-semibold text-muted">{tombstone.company}</p>
                            <p className="text-sm text-muted mt-4 leading-relaxed">
                                This job posting is no longer available.
                                {savedJobState(tombstone).key === 'removed' && ' It was removed by the PESO Administrator.'}
                                {savedJobState(tombstone).key === 'closed' && ' The posting has been closed.'}
                                {savedJobState(tombstone).key === 'filled' && ' All available positions have been filled.'}
                                {savedJobState(tombstone).key === 'expired' && ' The application deadline has passed.'}
                                {savedJobState(tombstone).key === 'unavailable' && ' The posting is not currently open.'}
                            </p>

                            <div className="mt-4 text-left text-xs font-semibold text-muted bg-sunken rounded-xl border border-line p-3 space-y-1.5">
                                <div className="flex justify-between"><span>Status</span><span className="text-content">{savedJobState(tombstone).label}</span></div>
                                {tombstone.saved_at && <div className="flex justify-between"><span>Saved</span><span className="text-content">{new Date(tombstone.saved_at).toLocaleDateString()}</span></div>}
                                {formatChecked(tombstone.last_checked_at) && <div className="flex justify-between"><span>Status checked</span><span className="text-content">{formatChecked(tombstone.last_checked_at)}</span></div>}
                            </div>

                            <div className="mt-6 flex flex-col sm:flex-row gap-2">
                                <button
                                    onClick={() => browseSimilar(tombstone)}
                                    className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-accent-contrast font-black rounded-xl transition-colors flex items-center justify-center gap-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                >
                                    <Compass size={16} /> Browse Similar Jobs
                                </button>
                                <button
                                    onClick={() => removeOne(tombstone.saved_id ?? tombstone.id)}
                                    className="flex-1 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border border-rose-200 dark:border-rose-800/50"
                                >
                                    <Trash2 size={16} /> Remove
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default SavedJobs;
