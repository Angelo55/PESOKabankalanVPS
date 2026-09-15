import React, { useState, useEffect, useRef } from 'react';
import { Briefcase, MapPin, ArrowRight, Bookmark, BookmarkCheck, Loader2, Calendar, UserCheck, Users } from 'lucide-react';
import { resolveJobImage } from './jobImage';
import { featureFlag } from '../../utils/featureFlags';

/**
 * Shared job card used by the Public Job Board grid and category rows.
 * Mouse users browse with a single click and open with double-click / the
 * "Full Details" button; touch users open on tap (matches the board's existing
 * interaction model).
 *
 * ── Visual language: clean and neutral, accented (not themed) ───────────────
 * The surface is plain white on a neutral border with a soft grey shadow — no
 * tinted washes and no gradients, so the card reads as a professional record
 * rather than a decorated tile. "Radiant Fields" survives only as accents:
 *   Deep Green #4F7942  actions, icons, links, hover — 5.07:1 on white (AA),
 *                       and 5.07:1 under white text, so it is safe both ways.
 *   Ink Green  #2F4A28  headings.
 * Gold is deliberately absent here: at 1.6:1 on white it can never carry text,
 * and used as a block it dominated the grid. It is kept to one small highlight
 * in the category navigation instead.
 *
 * SIZING: the card targets ~350–400px wide × ~480–500px tall, but never with a
 * hard width — the parent grid uses auto-fill/minmax so the card fluidly fills
 * its track. `h-full` + the grid's `auto-rows-fr` give every card in a row an
 * identical height regardless of content length; `min-h` holds the design
 * target when a row is sparse. Line clamps keep long text from bloating a card.
 */

// A posting is "filled" when its status says so, or when every available
// position is already consumed by an approved referral (referred_count is
// only present on job-board payloads; other callers fall back to status).
export const isJobFilled = (job) => {
    if (!job) return false;
    if (job.status === 'Filled' || job.status === 'Closed') return true;
    // #11b: when vacancy closure is PESO-verified (vacancy_manual_fill_enabled), a
    // vacancy is "Filled" ONLY by its confirmed status — never inferred from the
    // referral count. The office keeps referring while the employer is still hiring.
    if (featureFlag('vacancyManualFill')) return false;
    // NULL positions_available = the employer did not state a headcount. It is NOT
    // zero and NOT one — an unspecified vacancy can never be count-filled, only
    // closed by a confirmed status.
    if (job.positions_available == null) return false;
    if (job.referred_count == null) return false;
    const capacity = Number(job.positions_available) || 1;
    return (Number(job.referred_count) || 0) >= capacity;
};

// Vacancy-aware completion label: singular for exactly one stated position, plural
// otherwise (including an unspecified headcount, which is "multiple").
export const filledLabel = (job) =>
    (job?.positions_available != null && (Number(job?.positions_available) || 1) === 1) ? 'Vacancy Filled' : 'Vacancies Filled';

// Human label for the vacancy headcount. NULL = the employer did not specify a
// number, shown as "Multiple / Not specified" rather than a fabricated count.
export const positionsLabel = (job) => {
    if (!job) return null;
    if (job.positions_available == null) return 'Multiple / Not specified';
    const n = Number(job.positions_available) || 0;
    return n > 0 ? `${n} opening${n === 1 ? '' : 's'}` : null;
};

// Availability state for a SAVED bookmark. Saved Vacancies is a bookmark manager,
// not a job-details surface: an ACTIVE bookmark deep-links to the Public Job Board
// (the single source of truth for details + AI), while any non-active state renders
// an in-place "no longer available" tombstone instead of loading the job.
//
// `job_deleted` is set by GET /saved-jobs when the vacancy was hard-deleted (the
// LEFT JOIN left pj.* NULL). Precedence: removed → closed → filled → draft →
// expired(by deadline) → active. Returns { key, label, active }.
export const savedJobState = (job) => {
    if (!job) return { key: 'active', label: 'Active', active: true };
    if (job.job_deleted) return { key: 'removed', label: 'No Longer Available', active: false };

    const status = job.status;
    if (status === 'Closed') return { key: 'closed', label: 'Closed', active: false };
    if (status === 'Filled') return { key: 'filled', label: filledLabel(job), active: false };

    // Count-filled even if the status flag has not caught up (legacy rows). Skipped
    // under vacancy_manual_fill (#11b), where only a PESO-confirmed status is "filled".
    if (!featureFlag('vacancyManualFill') && job.positions_available != null) {
        const capacity = Number(job.positions_available) || 1;
        if (job.referred_count != null && (Number(job.referred_count) || 0) >= capacity) {
            return { key: 'filled', label: filledLabel(job), active: false };
        }
    }

    if (status === 'Draft') return { key: 'unavailable', label: 'Unavailable', active: false };

    if (job.deadline) {
        const d = new Date(job.deadline);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!Number.isNaN(d.getTime()) && d < today) {
            return { key: 'expired', label: 'Expired', active: false };
        }
    }

    // Open / Published (or any other live status) → deep-link to the board.
    return { key: 'active', label: 'Active', active: true };
};

const JobCard = ({ job, saved = false, saving = false, onOpen, onToggleSave, isTouch = false, showSave = true, className = '' }) => {
    const img = resolveJobImage(job.featured_image);
    const filled = isJobFilled(job);
    const positions = positionsLabel(job);

    // Fire the expand-and-bounce ONLY when the icon crosses into the saved state
    // (not on un-save, and not on first render of an already-saved card). The
    // class is removed after the run so a later re-save can retrigger it.
    const [pop, setPop] = useState(false);
    // Fall back to the branded placeholder if the image fails to load — e.g. a legacy
    // featured image that was stored on the ephemeral local disk and no longer exists
    // (pre-R2 uploads). Keeps the board clean instead of showing a broken-image icon.
    const [imgError, setImgError] = useState(false);
    const prevSaved = useRef(saved);
    useEffect(() => {
        if (saved && !prevSaved.current) {
            setPop(true);
            const t = setTimeout(() => setPop(false), 260);
            prevSaved.current = saved;
            return () => clearTimeout(t);
        }
        prevSaved.current = saved;
    }, [saved]);

    return (
        <div
            onClick={() => { if (isTouch) onOpen?.(job); }}
            onDoubleClick={() => { if (!isTouch) onOpen?.(job); }}
            role={isTouch ? 'button' : undefined}
            className={`h-full min-h-[480px] bg-surface rounded-3xl border border-line shadow-card hover:shadow-raised hover:-translate-y-1 hover:border-accent/35 transition-all duration-300 ease-out flex flex-col overflow-hidden group select-none ${isTouch ? 'cursor-pointer' : 'cursor-default'} ${className}`}
        >
            {/* Media — fixed band so every card's content starts at the same y */}
            <div className="relative h-44 w-full shrink-0 overflow-hidden bg-sunken">
                {img && !imgError ? (
                    <img src={img} alt={job.title} loading="lazy" onError={() => setImgError(true)} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-sunken">
                        <span className="text-accent-text/70 font-black text-5xl">{(job.company || 'J').charAt(0).toUpperCase()}</span>
                    </div>
                )}

                {filled && (
                    <span className="absolute top-3 left-3 px-3 py-1 rounded-full text-[11px] font-black bg-slate-900/85 text-white backdrop-blur-sm shadow-sm flex items-center gap-1 z-10">
                        <UserCheck size={12} /> {filledLabel(job)}
                    </span>
                )}

                {showSave && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleSave?.(e, job.id); }}
                        disabled={saving}
                        aria-label={saved ? 'Remove from saved jobs' : 'Save job'}
                        aria-pressed={saved}
                        className="absolute top-3 right-3 p-2 rounded-xl bg-surface/95 hover:bg-surface text-accent-text shadow-sm transition-transform duration-150 ease-out hover:scale-105 active:scale-90 disabled:opacity-50 z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        title={saved ? 'Remove from saved' : 'Save job'}
                    >
                        {/* The pop rides on this stable wrapper so it plays across the
                            Bookmark → BookmarkCheck swap; the icons themselves fade
                            their colour. */}
                        <span className={`inline-flex ${pop ? 'animate-bookmark-pop' : ''}`}>
                            {saving ? <Loader2 size={20} className="animate-spin" /> :
                             saved ? <BookmarkCheck size={20} className="text-accent-text transition-colors duration-200" fill="currentColor" /> :
                             <Bookmark size={20} className="transition-colors duration-200" />}
                        </span>
                    </button>
                )}
            </div>

            {/* Content — flex column so the CTA always pins to the bottom */}
            <div className="p-5 sm:p-6 flex flex-col flex-1 min-h-0">
                <h2 className="text-lg sm:text-xl font-black text-content leading-snug mb-1 group-hover:text-accent-text transition-colors line-clamp-2">
                    {job.title}
                </h2>
                <p className="text-sm font-semibold text-muted mb-3 line-clamp-1">{job.company}</p>

                <div className="flex flex-wrap gap-2 text-xs font-bold text-muted mb-3">
                    <span className="px-2.5 py-1.5 bg-sunken rounded-lg border border-line flex items-center gap-1">
                        <MapPin size={12} className="text-accent-text" /> {job.location || 'Kabankalan'}
                    </span>
                    {job.work_setup && (
                        <span className="px-2.5 py-1.5 bg-sunken rounded-lg border border-line flex items-center gap-1">
                            <Briefcase size={12} className="text-accent-text" /> {job.work_setup}
                        </span>
                    )}
                    {positions && !filled && (
                        <span className="px-2.5 py-1.5 bg-sunken rounded-lg border border-line flex items-center gap-1">
                            <Users size={12} className="text-accent-text" /> {positions}
                        </span>
                    )}
                </div>

                {job.description && (
                    <p className="text-[13px] leading-relaxed text-muted font-medium line-clamp-3 mb-3">
                        {job.description}
                    </p>
                )}

                {/* Salary / deadline sit just above the footer, pushed down by mt-auto */}
                <div className="mt-auto">
                    {(job.salary_range || job.deadline) && (
                        <div className="text-xs font-medium space-y-1 mb-3">
                            {job.salary_range && (
                                <p className="text-sm font-black text-content">{job.salary_range}</p>
                            )}
                            {job.deadline && (
                                <p className="flex items-center gap-1 text-muted">
                                    <Calendar size={12} className="text-accent-text" /> Apply by {new Date(job.deadline).toLocaleDateString()}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="pt-4 border-t border-line flex items-center justify-between gap-3">
                        {!isTouch && <span className="text-[11px] font-medium text-subtle hidden sm:inline">Double-click to open</span>}
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpen?.(job); }}
                            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black rounded-xl shadow-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                        >
                            View Details <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JobCard;
