/**
 * SMART REFERRAL QUEUE — the PESO Administrator's proactive referral workspace.
 *
 * WHAT: AI-ranked existing applicants the administrator can refer to a vacancy they
 * did NOT apply to. The matcher (proactiveReferralWorker) continuously scores active
 * job seekers against Open/Published postings; the strongest land here for review.
 *
 * ── GROUPED BY VACANCY, RANKED WITHIN VACANCY ──────────────────────────────
 * Candidates are grouped under the specific posted Job Title and ranked against ONLY
 * the other candidates for that same vacancy (#1, #2, … per job) — never globally
 * across unrelated postings. This makes the referral order logically defensible. The
 * feed is paginated BY VACANCY (a job's ranking never splits across pages), read-only,
 * and owner-scoped to vacancies this administrator published.
 *
 * ── PROMOTE = A REAL REFERRAL ──────────────────────────────────────────────
 * "Refer" materializes an administrator-initiated application on the seeker's behalf
 * and runs it through the ordinary referral pipeline (vacancy cap, official letter,
 * email delivery). Because it is a government action, the button asks for an explicit
 * confirm. Dismiss removes a suggestion for good (it is never re-surfaced).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, UserPlus, X, Check, Briefcase, MapPin, Info, Users } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import API from '../api';
import Avatar from './common/Avatar';
import Pagination from './common/Pagination';
import EmptyState from './common/EmptyState';

const getAuthConfig = () => ({
    headers: { Authorization: `Bearer ${sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken')}` }
});

const scoreTone = (score) =>
    score >= 90 ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/25 dark:border-emerald-800 dark:text-emerald-300' :
    score >= 80 ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/25 dark:border-green-800 dark:text-green-300' :
    'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/25 dark:border-amber-800 dark:text-amber-300';

// Rank medal colour for the position WITHIN a vacancy.
const rankTone = (rank) =>
    rank === 1 ? 'bg-amber-400 text-amber-950' :
    rank === 2 ? 'bg-slate-300 text-slate-800' :
    rank === 3 ? 'bg-orange-300 text-orange-900' :
    'bg-accent text-accent-contrast';

const SmartReferralQueue = () => {
    const { notify } = useNotification();

    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);   // number of VACANCIES with candidates
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [confirmingId, setConfirmingId] = useState(null); // per-card "confirm referral"
    const [busyId, setBusyId] = useState(null);

    const fetchGroups = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        try {
            const res = await API.get(`/peso-admin/proactive/candidates/grouped?page=${page}&limit=${limit}`, getAuthConfig());
            setGroups(res.data.groups || []);
            setTotal(res.data.total || 0);
        } catch (error) {
            if (!silent) notify.error('Load failed', 'Could not load recommended candidates.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [page, limit, notify]);

    useEffect(() => { fetchGroups(); }, [fetchGroups]);

    // Remove one candidate from its vacancy group after refer/dismiss. If the group
    // empties, drop it (and decrement the vacancy total that drives pagination).
    const removeCandidateLocally = (jobId, candId) => {
        setGroups((prev) => {
            const next = prev
                .map((g) => (g.job_id === jobId ? { ...g, candidates: g.candidates.filter((c) => c.id !== candId), candidate_count: Math.max(0, g.candidate_count - 1) } : g))
                .filter((g) => g.candidates.length > 0);
            if (next.length !== prev.length) setTotal((t) => Math.max(0, t - 1));
            return next;
        });
    };

    const approve = async (group, cand) => {
        setBusyId(cand.id);
        try {
            const res = await API.post(`/peso-admin/proactive/candidates/${cand.id}/approve`, {}, getAuthConfig());
            const ref = res.data?.data?.referenceNumber;
            notify.success('Referral created', `${cand.applicant_name} was referred for "${group.job_title}".${ref ? ` Reference ${ref}.` : ''} The letter is queued for delivery.`);
            removeCandidateLocally(group.job_id, cand.id);
            setConfirmingId(null);
        } catch (error) {
            notify.error('Could not refer', error?.response?.data?.message || 'The referral could not be created.');
        } finally {
            setBusyId(null);
        }
    };

    const dismiss = async (group, cand) => {
        setBusyId(cand.id);
        try {
            await API.post(`/peso-admin/proactive/candidates/${cand.id}/dismiss`, {}, getAuthConfig());
            notify.info('Dismissed', `${cand.applicant_name} was removed from the queue.`);
            removeCandidateLocally(group.job_id, cand.id);
        } catch (error) {
            notify.error('Could not dismiss', error?.response?.data?.message || 'Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const positionsLabel = (n) => (n == null ? 'Multiple / Not specified' : `${n} position${n === 1 ? '' : 's'}`);

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight flex items-center gap-2">
                    <UserPlus className="text-accent-text" /> Smart Referral Queue
                </h1>
                <p className="text-muted mt-2 font-medium">
                    AI-ranked existing applicants that strongly match your vacancies, grouped by job and ranked within each. Refer a candidate directly — no new application needed.
                </p>
            </header>

            <div className="flex items-start gap-3 mb-5 p-4 rounded-xl bg-accent-soft border border-accent/20">
                <Info size={18} className="text-accent-text shrink-0 mt-0.5" />
                <p className="text-sm text-muted">
                    Referring here issues an <span className="font-bold">official PESO referral</span> on the seeker's behalf — it consumes a vacancy slot, generates the letter, and emails the employer. You approve each one explicitly.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-accent-text" size={32} /></div>
            ) : groups.length === 0 ? (
                <EmptyState
                    variant="success"
                    icon={Sparkles}
                    title="You're all caught up"
                    description="There are no pending AI recommendations to review right now. As applicants strengthen their profiles and you publish or edit vacancies, the AI re-runs matching in the background and surfaces strong candidates here automatically."
                    primaryAction={{ label: 'Open Applicant Pipeline', to: '/peso-admin/ats' }}
                />
            ) : (
                <>
                    <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} position="top" />
                    <div className="space-y-6 mt-2">
                        {groups.map((group) => (
                            <section key={group.job_id} className="rounded-2xl border border-line bg-sunken/30 overflow-hidden">
                                {/* Vacancy header — the group the candidates below are ranked within. */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-surface border-b border-line">
                                    <Briefcase size={18} className="text-accent-text shrink-0" />
                                    <h2 className="text-base sm:text-lg font-black text-content truncate">{group.job_title}</h2>
                                    {group.company && <span className="text-xs font-semibold text-muted truncate">· {group.company}</span>}
                                    <span className="ml-auto flex items-center gap-3 text-[11px] font-bold text-muted">
                                        <span className="inline-flex items-center gap-1"><Users size={13} /> {group.candidate_count} candidate{group.candidate_count === 1 ? '' : 's'}</span>
                                        <span className="hidden sm:inline text-subtle">{positionsLabel(group.positions_available)}</span>
                                    </span>
                                </div>

                                <div className="p-3 space-y-2.5">
                                    {group.candidates.map((cand, index) => {
                                        const rank = index + 1; // rank WITHIN this vacancy
                                        const score = cand.match_score;
                                        const isBusy = busyId === cand.id;
                                        const confirming = confirmingId === cand.id;
                                        return (
                                            <div key={cand.id} className="bg-surface border border-line rounded-xl p-3.5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 shadow-sm hover:shadow-md transition-all">
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    <span className={`flex items-center justify-center text-[11px] font-black min-w-[26px] h-6 px-1.5 rounded-md shrink-0 ${rankTone(rank)}`} title={`Rank ${rank} for this vacancy`}>#{rank}</span>
                                                    <Avatar
                                                        user={{ id: cand.applicant_id, name: cand.applicant_name, email: cand.applicant_email, avatar_thumb: cand.avatar_thumb, avatar_url: cand.avatar_url }}
                                                        size={44}
                                                        alt={cand.applicant_name}
                                                        className="shadow-sm"
                                                    />
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-content text-lg truncate">{cand.applicant_name || 'Applicant'}</h3>
                                                        <p className="text-sm text-muted font-medium truncate">{cand.applicant_email || 'No email'}</p>
                                                        <div className="flex flex-wrap items-center gap-2 mt-2">
                                                            {typeof score === 'number' && (
                                                                <span className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${scoreTone(score)}`}>
                                                                    <Sparkles size={10} /> {score}% match
                                                                </span>
                                                            )}
                                                            {cand.location && (
                                                                <span className="flex items-center gap-1 text-[10px] font-bold text-subtle">
                                                                    <MapPin size={10} /> {cand.location}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {cand.reason && <p className="text-xs text-muted mt-2 max-w-2xl">{cand.reason}</p>}
                                                    </div>
                                                </div>

                                                <div className="w-full lg:w-auto flex items-center gap-2 shrink-0">
                                                    {confirming ? (
                                                        <>
                                                            <span className="text-xs font-bold text-muted hidden sm:inline">Issue referral?</span>
                                                            <button
                                                                onClick={() => approve(group, cand)}
                                                                disabled={isBusy}
                                                                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-accent text-accent-contrast font-black rounded-xl hover:bg-accent-hover transition-all shadow-md disabled:opacity-50"
                                                            >
                                                                {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm
                                                            </button>
                                                            <button onClick={() => setConfirmingId(null)} disabled={isBusy} className="px-3 py-2.5 rounded-xl bg-sunken text-muted font-bold text-sm hover:bg-line disabled:opacity-50">
                                                                Cancel
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => setConfirmingId(cand.id)}
                                                                disabled={isBusy}
                                                                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-accent text-accent-contrast font-black rounded-xl hover:bg-accent-hover hover:-translate-y-0.5 transition-all shadow-md disabled:opacity-50"
                                                            >
                                                                <UserPlus size={16} /> Refer
                                                            </button>
                                                            <button
                                                                onClick={() => dismiss(group, cand)}
                                                                disabled={isBusy}
                                                                className="p-2.5 rounded-xl bg-sunken text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                                                                title="Dismiss recommendation"
                                                            >
                                                                {isBusy ? <Loader2 size={16} className="animate-spin" /> : <X size={18} />}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                    <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
                </>
            )}
        </div>
    );
};

export default SmartReferralQueue;
