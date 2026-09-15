/**
 * useUnifiedApplications — the ONE client-side source of truth for every application
 * the Job Seeker has, composed by GET /api/applications/unified.
 *
 * It merges the two underlying stores WITHOUT merging their tables:
 *   • source 'peso'     → job_applications (real PESO vacancy submissions; AI score +
 *                          referral state + letter; READ-ONLY here — the referral
 *                          pipeline stays FK-bound to job_applications).
 *   • source 'imported' → usertrackedjobs (external + spreadsheet-imported; editable).
 *
 * Every surface that shows or counts applications — the unified My Applications page,
 * the Dashboard's Pipeline Analytics chart, My Recent Applications, and the KPI cards —
 * consumes THIS hook, so a single normalized dataset drives them all (one metric, one
 * home: SKILL §10.6, now homed on the unified feed instead of a tracker-only endpoint).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

// The COMPLETE application lifecycle both status vocabularies (PESO ATS + external
// tracker + referral outcomes) map onto, so every widget reads one language. It merges
// two lifecycles into one progressive model (2026-08-07, §28 follow-up):
//   PESO workflow:      Applied → Under Review → Shortlisted → Referred
//   Employer outcome:   Referred → Interview Scheduled → Interviewed → Final Interview
//                                → Final Interviewed → Hired
// plus the alternative/terminal outcomes that can occur at any point.
// The editable status vocabulary for IMPORTED/external records (usertrackedjobs). Shared
// by the My Applications cards and the Dashboard table so their dropdowns never drift.
export const EXTERNAL_STATUSES = [
    'Applied', 'Pending / Waiting', 'Responded', 'Interview', 'Interviewed',
    'Final Interview', 'Final Interviewed', 'Hired', 'Rejected', 'Withdrawn', 'No Response',
];

export const MAIN_STAGES = [
    'Applied', 'Under Review', 'Shortlisted', 'Referred',
    'Interview Scheduled', 'Interviewed', 'Final Interview', 'Final Interviewed', 'Hired',
];
export const ALT_STAGES = ['Responded', 'Pending / Waiting', 'Not Referred', 'Rejected', 'Withdrawn', 'No Response'];
export const CANONICAL_STAGES = [...MAIN_STAGES, ...ALT_STAGES];

// The employer-side interview progression (for the "interviews reached" KPI).
export const INTERVIEW_STAGES = new Set(['Interview Scheduled', 'Interviewed', 'Final Interview', 'Final Interviewed']);
// Terminal outcomes — an application here is no longer "active". 'Not Referred' is the
// PESO decision not to refer (G3.2), a terminal state for that application/job pairing.
export const TERMINAL_STAGES = new Set(['Hired', 'Rejected', 'Withdrawn', 'No Response', 'Not Referred']);

/**
 * THE single status colour system, shared by every application surface — the Pipeline
 * Analytics chart (uses `hex`), the My Applications cards + the Dashboard "All Your
 * Applications" table badges (use `badge`). One entry per canonical stage, so a status
 * reads identically wherever it appears (2026-08-07). Add a stage here, not per-file.
 */
export const STAGE_STYLE = {
    'Applied':             { hex: '#6366f1', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/50' },
    'Under Review':        { hex: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50' },
    'Shortlisted':         { hex: '#8b5cf6', badge: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800/50' },
    'Referred':            { hex: '#0ea5e9', badge: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800/50' },
    'Interview Scheduled': { hex: '#06b6d4', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800/50' },
    'Interviewed':         { hex: '#3b82f6', badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50' },
    'Final Interview':     { hex: '#4f46e5', badge: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700/60' },
    'Final Interviewed':   { hex: '#7c3aed', badge: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700/60' },
    'Hired':               { hex: '#10b981', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700/60' },
    'Responded':           { hex: '#14b8a6', badge: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800/50' },
    'Pending / Waiting':   { hex: '#eab308', badge: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800/50' },
    'Not Referred':        { hex: '#f97316', badge: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50' },
    'Rejected':            { hex: '#ef4444', badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50' },
    'Withdrawn':           { hex: '#64748b', badge: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600' },
    'No Response':         { hex: '#9ca3af', badge: 'bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600' },
};

const NEUTRAL_BADGE = 'bg-sunken text-muted border-line';
/** Tailwind badge classes (bg/text/border, light+dark) for a canonical stage. */
export const statusBadgeClass = (stage) => (STAGE_STYLE[stage]?.badge || NEUTRAL_BADGE);
/** Hex for the analytics chart. */
export const statusHex = (stage) => (STAGE_STYLE[stage]?.hex || '#9ca3af');
/** Progression rank for sorting — canonical order; unknown sinks to the end. */
export const statusRank = (stage) => {
    const i = CANONICAL_STAGES.indexOf(stage);
    return i === -1 ? CANONICAL_STAGES.length : i;
};

// PESO base status → canonical (the admin-driven PESO workflow).
const PESO_BASE = { 'Applied': 'Applied', 'Under Review': 'Under Review', 'Shortlisted': 'Shortlisted', 'Referred': 'Referred', 'Not Referred': 'Not Referred' };
// Referral OUTCOME → canonical (the employer-side lifecycle once a letter is out). It
// supersedes the base status because it means the app has moved past Referred. 'Issued'
// is "letter sent, no news" → the stage stays Referred (returns null = fall through).
const OUTCOME_MAP = {
    'Issued': null,
    'Employer Acknowledged': 'Responded',
    'Interview Scheduled': 'Interview Scheduled',
    'Interviewed': 'Interviewed',
    'Final Interview': 'Final Interview',
    'Final Interviewed': 'Final Interviewed',
    'Hired': 'Hired',
    'Not Hired': 'Rejected',
    'Withdrawn': 'Withdrawn',
    'No Response': 'No Response',
};
// External-tracker status → canonical (the imported/private records carry the full set).
const EXT_MAP = {
    'Applied': 'Applied', 'Pending / Waiting': 'Pending / Waiting', 'Responded': 'Responded',
    'Interview': 'Interview Scheduled', 'Interviewed': 'Interviewed',
    'Final Interview': 'Final Interview', 'Final Interviewed': 'Final Interviewed',
    'Hired': 'Hired', 'Rejected': 'Rejected', 'Withdrawn': 'Withdrawn', 'No Response': 'No Response',
};

export const canonicalStage = (app) => {
    if (!app) return 'Applied';
    if (app.source === 'peso') {
        // A recorded referral outcome moves the app along the employer-side lifecycle;
        // otherwise it sits at its PESO ATS stage.
        if (app.referral_outcome) {
            const mapped = OUTCOME_MAP[app.referral_outcome];
            if (mapped) return mapped;
        }
        return PESO_BASE[app.status] || 'Applied';
    }
    return EXT_MAP[app.status] || 'Applied';
};

const isClosed = (stage) => TERMINAL_STAGES.has(stage);

export default function useUnifiedApplications() {
    const [apps, setApps] = useState([]);
    const [counts, setCounts] = useState({ peso: 0, imported: 0, total: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const refetch = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        try {
            const res = await API.get('/applications/unified', getAuthConfig());
            const list = res.data?.data || [];
            setApps(list.map((a) => ({ ...a, stage: canonicalStage(a) })));
            setCounts(res.data?.counts || { peso: 0, imported: 0, total: list.length });
            setError(false);
        } catch (e) {
            setError(true);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => { refetch(); }, [refetch]);

    // Optimistic in-place update for pin / colour toggles, so a card responds instantly
    // while the PATCH is in flight; the caller re-fetches (or reverts) on failure.
    const mutateLocal = useCallback((uid, patch) => {
        setApps((prev) => prev.map((a) => (a.uid === uid ? { ...a, ...patch } : a)));
    }, []);

    // KPIs derived from the unified set — the same numbers the page shows, so the
    // Dashboard cards can never disagree with the list.
    const metrics = useMemo(() => {
        const byStage = Object.fromEntries(CANONICAL_STAGES.map((s) => [s, 0]));
        let referred = 0, hired = 0, interviews = 0, active = 0, responded = 0, withLetter = 0, peso = 0, imported = 0;
        for (const a of apps) {
            const s = a.stage;
            byStage[s] = (byStage[s] || 0) + 1;
            if (a.source === 'peso') peso += 1; else imported += 1;
            if (a.referral_status === 'Approved' || a.has_referral_letter) referred += 1;
            if (s === 'Hired') hired += 1;
            if (INTERVIEW_STAGES.has(s)) interviews += 1;
            if (!isClosed(s)) active += 1;
            // "Responded" = anything past a bare Applied that isn't still-waiting / dead.
            if (s !== 'Applied' && s !== 'Pending / Waiting' && s !== 'No Response') responded += 1;
            if (a.has_referral_letter) withLetter += 1;
        }
        const total = apps.length;
        return {
            total, peso, imported, byStage,
            referred, hired, interviews, active, withLetter,
            responseRate: total ? Math.round((responded / total) * 100) : 0,
        };
    }, [apps]);

    return { apps, counts, metrics, loading, error, refetch, mutateLocal };
}
