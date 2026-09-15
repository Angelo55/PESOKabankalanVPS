/**
 * MY APPLICATIONS — the single, card-based workspace for every Job Seeker application,
 * from ONE unified feed (GET /api/applications/unified via useUnifiedApplications).
 *
 * Card architecture + interaction model REUSE the Saved Vacancies toolkit so the two
 * surfaces read identically: fluid card grid, useMultiSelect (checkbox + long-press),
 * BulkActionBar, useTrashAction (soft-delete to Trash), PinButton / ColorLabelPicker /
 * cardTheme / pinnedFirst, Pagination / useClientPagination, EmptyState + skeleton.
 *
 * Source-aware behaviour (the referral pipeline stays FK-bound to job_applications):
 *   • PESO rows   — read-only status (admin-driven); show AI compatibility + referral
 *                   letter link. Not bulk-selectable, not deletable here.
 *   • Imported    — user-editable status (per-card + BULK), deletable (bulk → Trash).
 * PIN + COLOUR LABEL work on EVERY card (both sources) via the unified per-user
 * preferences store (PATCH /applications/:uid/preferences → application_preferences),
 * a personal marker that never touches the application/referral record.
 *
 * Real-time: a PESO status move or a referral issue bumps applicationStatusTrigger
 * (ChatContext) → silent refetch.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Building2, MapPin, Inbox, Search, Plus, X, Loader2,
    Cpu, FileCheck2, Clock, FileSpreadsheet, Trash2,
} from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import { useChat } from '../context/ChatContext';
import useUnifiedApplications, { CANONICAL_STAGES, statusBadgeClass, EXTERNAL_STATUSES } from '../hooks/useUnifiedApplications';
import { Skeleton, SkeletonCompactCard } from './Skeleton';
import EmptyState from './common/EmptyState';
import InlineUsageMeter from './common/InlineUsageMeter';
import Pagination from './common/Pagination';
import useClientPagination from '../hooks/useClientPagination';
import useMultiSelect from './jobs/useMultiSelect';
import { SelectCheckbox } from './jobs/SelectionBar';
import { BulkActionBar, BulkDeleteButton } from './common/AdminUI';
import useTrashAction from './jobs/useTrashAction';
import { PinButton, ColorLabelPicker, cardTheme, pinnedFirst } from './jobs/CardLabels';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const KpiTile = ({ label, value, tone }) => (
    <div className="bg-surface rounded-2xl border border-line p-4 shadow-card">
        <p className={`text-2xl font-black tabular-nums ${tone || 'text-content'}`}>{value}</p>
        <p className="text-xs font-bold text-muted mt-0.5">{label}</p>
    </div>
);

const SourceBadge = ({ source, origin, onTint }) => {
    if (source === 'peso') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-accent-soft/70 text-accent-text dark:bg-accent-text/10">
                {origin === 'admin_referral' ? 'PESO · Referred' : 'PESO'}
            </span>
        );
    }
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide border ${onTint ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-current' : 'bg-sunken text-muted border-line'}`}>
            Imported
        </span>
    );
};

const AddRecordModal = ({ onClose, onAdded }) => {
    const { notify } = useNotification();
    const [form, setForm] = useState({ company: '', job_title: '', status: 'Applied', date_applied: new Date().toISOString().slice(0, 10) });
    const [saving, setSaving] = useState(false);
    const submit = async () => {
        if (!form.company.trim() || !form.job_title.trim()) return notify.warning('Missing info', 'Company and role are required.');
        setSaving(true);
        try {
            await API.post('/tracked-jobs', { ...form }, getAuthConfig());
            notify.success('Added', `${form.company} added to your applications.`);
            onAdded();
            onClose();
        } catch (e) {
            notify.error('Could not add', e.response?.data?.message || 'Please try again.');
        } finally { setSaving(false); }
    };
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
            <div className="w-full max-w-md bg-raised rounded-3xl border border-line shadow-2xl p-6 animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-black text-content">Add a manual application</h3>
                    <button onClick={onClose} className="p-1.5 text-subtle hover:text-content rounded-full"><X size={20} /></button>
                </div>
                <div className="space-y-3">
                    <input autoFocus value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" className="w-full p-2.5 rounded-xl text-sm bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
                    <input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Role / job title" className="w-full p-2.5 rounded-xl text-sm bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
                    <div className="flex gap-3">
                        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} aria-label="Status" className="flex-1 p-2.5 rounded-xl text-sm bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35">
                            {EXTERNAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="date" value={form.date_applied} onChange={(e) => setForm({ ...form, date_applied: e.target.value })} aria-label="Date applied" className="flex-1 p-2.5 rounded-xl text-sm bg-sunken border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
                    </div>
                </div>
                <div className="flex gap-3 mt-6">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-sunken hover:bg-line text-content font-bold text-sm transition-colors">Cancel</button>
                    <button onClick={submit} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                        {saving && <Loader2 size={15} className="animate-spin" />} Add
                    </button>
                </div>
            </div>
        </div>
    );
};

// One application card. Reuses cardTheme (colour label), PinButton, ColorLabelPicker and
// SelectCheckbox so it behaves and looks like a Saved Vacancies card.
const ApplicationCard = ({ app, selectMode, selected, onToggleSelect, longPressProps, onChangeStatus, onPin, onColor, onOpenReferral, busyPref }) => {
    const t = cardTheme(app.color_label);
    const applied = app.applied_at ? new Date(app.applied_at).toLocaleDateString() : '—';
    // G3.3: a PESO application is scored ASYNC (~seconds after submit). Until the score
    // lands, show a "Calculating…" state instead of nothing, so the seeker knows a newer
    // score is being computed (and the board PREVIEW they saw isn't the committed score).
    // Recency-gated so a genuinely never-scored old row doesn't claim "calculating" forever.
    const scorePending = app.source === 'peso' && app.match_score == null
        && app.applied_at && (Date.now() - new Date(app.applied_at).getTime() < 15 * 60 * 1000);
    return (
        // Card shell mirrors the Saved Vacancies card (SavedJobs.jsx): same rounded-3xl,
        // shadow-card→hover:shadow-raised, hover-lift, equal-height flex column, and the
        // selected/pinned border treatment — so both modules read as one visual language.
        // The card body is NOT a navigation target (unlike Saved Vacancies): its controls
        // (status select, pin/colour, referral link) drive all behaviour, unchanged.
        <div
            {...(app.editable ? longPressProps(app.uid) : {})}
            className={`relative h-full min-h-[180px] rounded-3xl shadow-card border hover:shadow-raised hover:-translate-y-1 transition-all duration-300 ease-out flex flex-col group overflow-hidden ${t.surface} ${selected ? 'border-accent ring-2 ring-accent/40' : (app.is_pinned && !t.labelled ? 'border-accent/40' : t.border)}`}
        >
            <div className="p-4 flex flex-col flex-1 min-h-0">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                        {app.editable && (
                            <SelectCheckbox checked={selected} selectMode={selectMode} onToggle={() => onToggleSelect(app.uid)} />
                        )}
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${t.labelled ? `${t.chip} ${t.ink}` : 'bg-sunken text-accent-text border-line'}`}>
                            <Building2 size={20} />
                        </div>
                    </div>
                    <div className={`flex items-center gap-0.5 shrink-0 ${t.labelled ? t.ink : ''}`}>
                        <PinButton pinned={app.is_pinned} busy={busyPref} onToggle={(v) => onPin(app, v)} onTint={t.labelled} />
                        <ColorLabelPicker colorKey={app.color_label} busy={busyPref} onPick={(k) => onColor(app, k)} onTint={t.labelled} />
                    </div>
                </div>

                {/* Source pill sits in the same slot as the Saved Vacancies status badge. */}
                <div className="mb-2"><SourceBadge source={app.source} origin={app.origin} onTint={t.labelled} /></div>

                <h2 className={`text-sm sm:text-base font-black mb-1 leading-snug line-clamp-2 ${t.ink}`}>{app.job_title || 'Untitled role'}</h2>
                <p className={`text-xs font-semibold mb-3 line-clamp-1 ${t.inkMuted}`}>{app.company || 'Unknown company'}</p>

                <div className={`flex flex-wrap gap-1.5 text-[11px] font-bold mb-3 ${t.labelled ? t.ink : 'text-muted'}`}>
                    {app.location && (
                        <span className={`px-2 py-1 rounded-lg border flex items-center gap-1 ${t.chip}`}><MapPin size={11} className={t.labelled ? '' : 'text-accent-text'} /> {app.location}</span>
                    )}
                    <span className={`px-2 py-1 rounded-lg border flex items-center gap-1 ${t.chip}`}><Clock size={11} className={t.labelled ? '' : 'text-accent-text'} /> {applied}</span>
                </div>

                {app.source === 'peso' && (app.match_score != null || scorePending || app.referral_status === 'Approved') && (
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        {app.match_score != null ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/25 text-indigo-700 dark:text-indigo-300 text-[11px] font-black" title="AI compatibility">
                                <Cpu size={11} /> {Math.round(Number(app.match_score))}%
                            </span>
                        ) : scorePending && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sunken text-muted text-[11px] font-black animate-pulse" title="Your AI compatibility score is being calculated">
                                <Cpu size={11} /> Calculating…
                            </span>
                        )}
                        {app.referral_status === 'Approved' && (
                            <button onClick={() => onOpenReferral(app)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300 text-[11px] font-black hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors" title={app.referral_reference || 'View referral'}>
                                <FileCheck2 size={11} /> Referral Letter
                            </button>
                        )}
                    </div>
                )}

                <div className={`mt-auto pt-2.5 border-t ${t.divider} flex items-center justify-between gap-2`}>
                    {app.editable ? (
                        <select
                            value={app.status}
                            onChange={(e) => onChangeStatus(app, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Update status"
                            className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-surface/80 border border-line text-content outline-none cursor-pointer focus:ring-2 focus:ring-accent/30 max-w-[62%] truncate"
                        >
                            {EXTERNAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    ) : (
                        <span className={`text-[10px] font-black uppercase tracking-wide ${t.labelled ? 'text-current/60' : 'text-subtle'}`}>PESO-managed</span>
                    )}
                    <span className={`shrink-0 px-2.5 py-1 rounded-full border text-[11px] font-black ${statusBadgeClass(app.stage)}`}>{app.stage}</span>
                </div>
            </div>
        </div>
    );
};

// Card grid + dimensions mirror Saved Vacancies (components/SavedJobs.jsx) so the two
// card-based Job-Seeker modules share ONE visual language: a fluid auto-fill grid with a
// 240px floor and equal-height rows. The min() guard stops the floor from overflowing a
// viewport narrower than 240px (UI addendum §4.1). This is a presentation match only — the
// unified feed, statuses, bulk/pin/colour, filtering and pagination are unchanged.
const CARD_GRID = 'grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]';
// Default page size stays 12; the shared <Pagination> selector still lets users change it.
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];

// Layout-aware loading state — mirrors the card board (header + KPI strip + filters + card
// grid + pagination), composed from the shared design-system Skeleton.
const MyApplicationsSkeleton = () => (
    <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
            <div className="space-y-2"><Skeleton className="h-9 w-64 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /></div>
            <div className="flex gap-2"><Skeleton className="h-11 w-28 rounded-xl" /><Skeleton className="h-11 w-20 rounded-xl" /></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface rounded-2xl border border-line p-4"><Skeleton className="h-7 w-12 mb-2" /><Skeleton className="h-3 w-24" /></div>
            ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mb-5"><Skeleton className="h-10 w-64 rounded-xl" /><Skeleton className="h-10 flex-1 rounded-xl" /></div>
        <div className="flex flex-wrap gap-2 mb-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-20 rounded-full" />)}</div>
        {/* Card grid reuses the module's CARD_GRID + the shared SkeletonCompactCard, so the
            skeleton mirrors the real ApplicationCard structure and grid exactly (no CLS). */}
        <div className={CARD_GRID}>
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCompactCard key={i} />)}
        </div>
    </div>
);

const MyApplications = () => {
    const navigate = useNavigate();
    const { notify, confirm } = useNotification();
    const { applicationStatusTrigger } = useChat() || {};
    const { apps, metrics, loading, error, refetch, mutateLocal } = useUnifiedApplications();

    const [sourceTab, setSourceTab] = useState('all'); // all | peso | imported
    const [stageFilter, setStageFilter] = useState('');
    const [search, setSearch] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [prefBusy, setPrefBusy] = useState(null);
    const [bulkBusy, setBulkBusy] = useState(false);

    // Live refresh when a PESO application moves stage or a referral is issued.
    const firstTrig = useRef(true);
    useEffect(() => {
        if (firstTrig.current) { firstTrig.current = false; return; }
        refetch({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applicationStatusTrigger]);

    // Filter → pin-to-top → paginate. `pinnedFirst` floats pinned cards above the rest
    // regardless of the (date-desc) order, across pages.
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = apps.filter((a) => {
            if (sourceTab !== 'all' && a.source !== sourceTab) return false;
            if (stageFilter && a.stage !== stageFilter) return false;
            if (q && ![a.company, a.job_title].some((f) => (f || '').toLowerCase().includes(q))) return false;
            return true;
        });
        return pinnedFirst(filtered);
    }, [apps, sourceTab, stageFilter, search]);

    const pager = useClientPagination(visible, 12);

    // Multi-select is scoped to IMPORTED rows in the current filtered view (bulk status +
    // bulk delete are imported-only; PESO submissions are admin-managed / not deletable).
    const importedUids = useMemo(() => visible.filter((a) => a.editable).map((a) => a.uid), [visible]);
    const ms = useMultiSelect(importedUids);
    const trash = useTrashAction({
        type: 'applications',
        nouns: { singular: 'Application', plural: 'Applications' },
        onDone: () => { refetch({ silent: true }); ms.clear(); },
    });

    const uidToTrackedId = (uid) => Number(String(uid).replace('ext-', ''));

    const changeStatus = async (app, status) => {
        mutateLocal(app.uid, { status });
        try {
            await API.put(`/tracked-jobs/${app.tracked_id}/status`, { status }, getAuthConfig());
            refetch({ silent: true });
        } catch (e) { notify.error('Update failed', 'Could not save the status.'); refetch({ silent: true }); }
    };

    const savePref = async (app, patch) => {
        mutateLocal(app.uid, patch); // optimistic — pin reorders / tint changes instantly
        setPrefBusy(app.uid);
        try { await API.patch(`/applications/${app.uid}/preferences`, patch, getAuthConfig()); }
        catch (e) { notify.error('Could not save', 'Your change was not stored.'); refetch({ silent: true }); }
        finally { setPrefBusy(null); }
    };

    const applyBulkStatus = async (status) => {
        const ids = ms.ids.map(uidToTrackedId).filter(Boolean);
        if (!ids.length || !status) return;
        const ok = await confirm('Update status?', `Set ${ids.length} imported application${ids.length === 1 ? '' : 's'} to “${status}”? PESO applications are managed by the office and are never affected.`);
        if (!ok) return;
        setBulkBusy(true);
        try {
            await API.put('/tracked-jobs/bulk/status', { ids, status }, getAuthConfig());
            notify.success('Status updated', `${ids.length} application${ids.length === 1 ? '' : 's'} set to ${status}.`);
            ms.clear();
            refetch({ silent: true });
        } catch (e) { notify.error('Bulk update failed', 'Please try again.'); }
        finally { setBulkBusy(false); }
    };

    const applyBulkDelete = () => trash.moveToTrash(ms.ids.map(uidToTrackedId).filter(Boolean));
    const openReferral = () => navigate('/referrals');

    if (loading) return <MyApplicationsSkeleton />;

    const stagesPresent = CANONICAL_STAGES.filter((s) => metrics.byStage[s] > 0);

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight">My Applications</h1>
                    <p className="text-muted mt-1 font-medium text-sm">
                        Every application in one workspace — PESO vacancies you applied to, and roles you track or import. Pin and colour-label to organise; select imported cards for bulk actions.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start md:self-auto">
                    <button onClick={() => navigate('/')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-content bg-surface border border-line hover:bg-sunken transition-colors">
                        <FileSpreadsheet size={16} /> Import
                    </button>
                    <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-accent-contrast bg-accent hover:bg-accent-hover shadow-sm transition-colors">
                        <Plus size={16} /> Add
                    </button>
                </div>
            </div>

            {error && apps.length === 0 && (
                <div className="mb-6 p-4 rounded-2xl border border-rose-200 dark:border-rose-800/50 bg-rose-50/60 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm font-bold flex items-center justify-between">
                    Could not load your applications.
                    <button onClick={() => refetch()} className="px-3 py-1.5 rounded-lg bg-accent text-accent-contrast text-xs">Retry</button>
                </div>
            )}

            {/* KPI strip — from the SAME unified feed the cards use */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <KpiTile label="Total applications" value={metrics.total} />
                <KpiTile label="Referred by PESO" value={metrics.referred} tone="text-emerald-600 dark:text-emerald-400" />
                <KpiTile label="Hired" value={metrics.hired} tone="text-emerald-700 dark:text-emerald-300" />
                <KpiTile label="Still active" value={metrics.active} tone="text-indigo-600 dark:text-indigo-400" />
            </div>

            {/* Usage — PESO applications (no limit) + tracked applications (the enforced
                1,000 cap, Trash-excluded), so the tracking capacity is visible here. */}
            <InlineUsageMeter keys={['peso_applications', 'tracked_applications']} refreshKey={apps.length} className="mb-6" />

            {/* Bulk action bar — only while selecting (imported rows) */}
            {ms.selectMode && ms.count > 0 && (
                <BulkActionBar
                    count={ms.count}
                    nouns={{ singular: 'application', plural: 'applications' }}
                    allSelected={ms.allSelected}
                    onToggleAll={ms.toggleAll}
                    onCancel={ms.clear}
                    busy={bulkBusy || trash.busy}
                >
                    <select
                        value=""
                        onChange={(e) => { if (e.target.value) applyBulkStatus(e.target.value); e.target.value = ''; }}
                        aria-label="Bulk set status"
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-surface border border-line text-content outline-none cursor-pointer focus:ring-2 focus:ring-accent/30"
                    >
                        <option value="">Set status…</option>
                        {EXTERNAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <BulkDeleteButton onClick={applyBulkDelete} disabled={bulkBusy || trash.busy} />
                </BulkActionBar>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
                <div className="inline-flex rounded-xl border border-line overflow-hidden text-xs font-bold self-start">
                    {[['all', `All (${metrics.total})`], ['peso', `PESO (${metrics.peso})`], ['imported', `Imported (${metrics.imported})`]].map(([k, lbl]) => (
                        <button key={k} onClick={() => setSourceTab(k)} className={`px-3.5 py-2 transition-colors ${sourceTab === k ? 'bg-accent text-accent-contrast' : 'bg-surface text-muted hover:bg-sunken'}`}>{lbl}</button>
                    ))}
                </div>
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" size={16} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or role…" aria-label="Search applications" className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-surface border border-line text-content outline-none focus:ring-2 focus:ring-accent/35" />
                </div>
            </div>

            {/* Stage chips */}
            {stagesPresent.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                    <button onClick={() => setStageFilter('')} className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${stageFilter === '' ? 'bg-accent text-accent-contrast border-transparent' : 'bg-surface text-muted border-line hover:bg-sunken'}`}>All stages</button>
                    {stagesPresent.map((s) => (
                        <button key={s} onClick={() => setStageFilter((p) => p === s ? '' : s)} className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${stageFilter === s ? 'bg-accent text-accent-contrast border-transparent' : 'bg-surface text-muted border-line hover:bg-sunken'}`}>
                            {s} <span className="tabular-nums opacity-70">{metrics.byStage[s]}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Cards */}
            {apps.length === 0 ? (
                <EmptyState
                    icon={Inbox}
                    title="No applications yet"
                    description="This is your one place for every application — the PESO vacancies you apply to on the Public Job Board show up here with their live status, AI compatibility and referral letters, alongside any roles you track or import."
                    primaryAction={{ label: 'Explore Vacancies', to: '/job-board', icon: <Search size={16} /> }}
                    secondaryAction={{ label: 'Add a record', onClick: () => setShowAdd(true) }}
                />
            ) : visible.length === 0 ? (
                <EmptyState
                    size="sm"
                    variant="search"
                    title="No applications match your filters"
                    description="Nothing matches the current source, stage, or search. Try clearing them to see everything."
                    primaryAction={{ label: 'Clear filters', onClick: () => { setSourceTab('all'); setStageFilter(''); setSearch(''); } }}
                />
            ) : (
                <>
                    <Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} pageSizeOptions={PAGE_SIZE_OPTIONS} position="top" />
                    <div className={CARD_GRID}>
                        {pager.pageItems.map((a) => (
                            <ApplicationCard
                                key={a.uid}
                                app={a}
                                selectMode={ms.selectMode}
                                selected={ms.isSelected(a.uid)}
                                // First tick ENTERS select mode (enterWith sets selectMode=true so
                                // the Bulk Actions toolbar appears); further ticks toggle. Matches
                                // the Saved Vacancies pattern — without this the toolbar never showed.
                                onToggleSelect={(uid) => (ms.selectMode ? ms.toggle(uid) : ms.enterWith(uid))}
                                longPressProps={ms.longPressProps}
                                onChangeStatus={changeStatus}
                                onPin={(app, v) => savePref(app, { is_pinned: v })}
                                onColor={(app, k) => savePref(app, { color_label: k })}
                                onOpenReferral={openReferral}
                                busyPref={prefBusy === a.uid}
                            />
                        ))}
                    </div>
                    <Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} pageSizeOptions={PAGE_SIZE_OPTIONS} />
                </>
            )}

            {showAdd && <AddRecordModal onClose={() => setShowAdd(false)} onAdded={() => refetch({ silent: true })} />}
        </div>
    );
};

export default MyApplications;
