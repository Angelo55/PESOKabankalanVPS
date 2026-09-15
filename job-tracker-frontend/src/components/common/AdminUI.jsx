/**
 * SHARED PESO ADMIN UI — one source for the pieces the admin surfaces were each
 * re-declaring, so the Operational Dashboard, ATS, and Job Publication grid read
 * as one product instead of three near-identical copies.
 *
 * TOKENS: the platform grew two green systems — the job-seeker dashboard's
 * #1a4a38 → #99e742 gradients and the newer flat #4F7942. These constants are the
 * canonical admin greens; new admin UI should pull from here rather than hard-code
 * a fourth shade. (Existing screens are migrated opportunistically, not in one
 * risky sweep.)
 */

import React from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';

export const PESO = {
    accent: '#4F7942',       // Deep Green — 5.07:1 on white, the admin accent
    accentDeep: '#1a4a38',   // darker green for solid buttons
    lime: '#99e742',         // lime highlight, used sparingly on dark grounds
    accentSoft: '#A8D5BA',   // the dark-mode ink for the accent
};

// A KPI tile. `tint` carries the icon's colour classes so semantic hue stays
// separate from the single green accent.
export const StatCard = ({ icon, label, value, sub, tint }) => (
    <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-line shadow-card hover:shadow-raised hover:-translate-y-0.5 transition-all duration-300 flex items-start justify-between gap-3">
        <div className="min-w-0">
            <p className="text-3xl font-black text-content tabular-nums leading-none">{value}</p>
            <p className="text-sm font-bold text-muted mt-2">{label}</p>
            {sub && <p className="text-xs text-subtle font-medium mt-0.5">{sub}</p>}
        </div>
        <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${tint}`}>
            {React.cloneElement(icon, { size: 20, strokeWidth: 2.5 })}
        </div>
    </div>
);

// A titled content card with an optional right-aligned action.
export const Panel = ({ title, icon, action, children, className = '' }) => (
    <div className={`bg-surface p-4 sm:p-6 rounded-3xl border border-line shadow-card ${className}`}>
        <div className="flex items-center justify-between gap-3 mb-5">
            <h3 className="text-base sm:text-lg font-black text-content tracking-tight flex items-center gap-2">
                {icon} {title}
            </h3>
            {action}
        </div>
        {children}
    </div>
);

export const EmptyState = ({ children }) => (
    <div className="h-full min-h-[180px] flex items-center justify-center text-center px-4 border-2 border-dashed border-line rounded-2xl">
        <p className="text-sm text-muted font-medium">{children}</p>
    </div>
);

/**
 * Generic multi-select toolbar. Unlike SelectionBar (delete-only, for the
 * seeker's trash flow), this hosts arbitrary bulk ACTIONS — status changes,
 * archive, publish — passed as children. Pairs with the shared useMultiSelect
 * hook. `busy` disables the whole bar while a bulk request is in flight.
 */
export const BulkActionBar = ({ count, nouns = { singular: 'item', plural: 'items' }, allSelected, onToggleAll, onCancel, busy = false, children }) => (
    <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 px-3 sm:px-4 py-2.5 rounded-2xl border border-accent-text/30 bg-accent-text/10 backdrop-blur-md shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
        <span className="text-sm font-black text-content">
            {count} {count === 1 ? nouns.singular : nouns.plural} selected
        </span>

        {onToggleAll && (
            <button
                type="button"
                onClick={onToggleAll}
                className="hidden sm:inline text-xs font-bold text-accent-text hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg px-1.5 py-1"
            >
                {allSelected ? 'Clear all' : 'Select all'}
            </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
            {busy && <Loader2 size={15} className="animate-spin text-accent-text" />}
            {children}
            <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-muted hover:bg-content/5 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-subtle"
            >
                <X size={14} className="inline -mt-0.5 mr-1" />Cancel
            </button>
        </div>
    </div>
);

/**
 * The standard destructive bulk action, rendered as a child of BulkActionBar so every
 * module's "Delete selected" looks identical (My Applications = the design reference;
 * Saved Vacancies now consumes the same shell + button). The bar's own busy spinner
 * (above) shows the loading state, so this button just disables while busy.
 */
export const BulkDeleteButton = ({ onClick, disabled = false, label = 'Delete' }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black shadow-sm transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1"
    >
        <Trash2 size={14} /> {label}
    </button>
);
