/**
 * EMPTY STATE DESIGN SYSTEM — the one component every "nothing here yet" surface uses.
 *
 * WHY: an empty screen is often a new user's FIRST impression. A blank table reads
 * as broken; a purposeful empty state reads as onboarding. Every empty state built
 * with this component answers the three questions the initiative requires:
 *   1. Why is this page empty?      → `description`
 *   2. What is this module for?     → `title` + `description`
 *   3. What should I do next?       → `primaryAction` (+ optional `secondaryAction`)
 *
 * VARIANTS
 *   default  — new / no data. Neutral accent tile, gently floating. Primary CTA.
 *   search   — no results for a query. Shows the query in the copy; pass Recent
 *              Searches / suggestions via `children` (see RecentSearches).
 *   success  — a POSITIVE empty (all caught up, inbox clear, nothing pending). A
 *              green celebratory tile with a subtle, reduced-motion-safe pop.
 *
 * ACCESSIBILITY: the float/pop animations live behind `prefers-reduced-motion:
 * no-preference` in index.css (.es-float / .es-pop), and the entrance uses
 * `motion-reduce:animate-none`, so reduced-motion users get a static, complete
 * layout. Every action is a real <Link>/<button> with a visible focus ring.
 *
 * TOKENS ONLY: surfaces/ink/accent come from the design tokens (§24) so it themes
 * automatically in light/dark — never hard-code a hex here.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Search, CheckCircle2 } from 'lucide-react';

const ICON_BY_VARIANT = { default: Inbox, search: Search, success: CheckCircle2 };

// One action = one real Link (when `to`) or button (when `onClick`). Never a bare
// div, so it stays keyboard-reachable and focus-ringed.
const EmptyAction = ({ action, kind }) => {
    if (!action) return null;
    const base = 'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2';
    const styles = kind === 'primary'
        ? 'bg-accent text-accent-contrast hover:bg-accent-hover shadow-sm'
        : 'bg-surface border border-line text-content hover:bg-sunken';
    const cls = `${base} ${styles}`;
    const inner = <>{action.icon}{action.label}</>;
    if (action.to) return <Link to={action.to} className={cls}>{inner}</Link>;
    return <button type="button" onClick={action.onClick} className={cls}>{inner}</button>;
};

const EmptyState = ({
    variant = 'default',
    icon,                 // a lucide component (e.g. Bookmark) OR a rendered element
    title,
    description,
    primaryAction,        // { label, to?, onClick?, icon? }
    secondaryAction,      // { label, to?, onClick?, icon? }
    size = 'md',          // 'sm' (inside a panel) | 'md' (full-page)
    className = '',
    children,             // recent searches, suggestions, a getting-started guide, …
}) => {
    const isSuccess = variant === 'success';
    const IconCmp = icon || ICON_BY_VARIANT[variant] || Inbox;

    const pad = size === 'sm' ? 'py-10 px-5' : 'py-14 sm:py-20 px-6';
    const tile = size === 'sm' ? 'w-14 h-14' : 'w-20 h-20';
    const iconSize = size === 'sm' ? 24 : 34;
    const titleCls = size === 'sm' ? 'text-lg' : 'text-xl sm:text-2xl';

    const tileTheme = isSuccess
        ? 'bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200/70 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 es-pop'
        : 'bg-accent-soft/60 dark:bg-accent-text/10 border-line text-accent-text es-float';

    return (
        <div
            className={`w-full flex flex-col items-center justify-center text-center ${pad} bg-surface/70 rounded-3xl border border-line shadow-card animate-in fade-in zoom-in-95 duration-500 motion-reduce:animate-none ${className}`}
            role="status"
        >
            <div className="relative mb-5">
                <span aria-hidden="true" className={`absolute inset-0 rounded-3xl blur-xl ${isSuccess ? 'bg-emerald-400/20' : 'bg-accent/15'}`} />
                <span className={`relative inline-flex items-center justify-center ${tile} rounded-3xl border ${tileTheme}`}>
                    {React.isValidElement(IconCmp) ? IconCmp : <IconCmp size={iconSize} strokeWidth={2} />}
                </span>
            </div>

            <h3 className={`${titleCls} font-black text-content tracking-tight`}>{title}</h3>
            {description && (
                <p className="text-muted font-medium mt-2 max-w-md leading-relaxed text-sm sm:text-base">{description}</p>
            )}

            {(primaryAction || secondaryAction) && (
                <div className="flex flex-col sm:flex-row items-center gap-3 mt-6">
                    <EmptyAction action={primaryAction} kind="primary" />
                    <EmptyAction action={secondaryAction} kind="secondary" />
                </div>
            )}

            {children && <div className="mt-6 w-full max-w-md">{children}</div>}
        </div>
    );
};

export default EmptyState;
