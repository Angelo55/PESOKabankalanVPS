import React from 'react';
import { LayoutGrid } from 'lucide-react';

/**
 * Full-width category navigation for the Public Job Board.
 *
 * LAYOUT — full-width flex-wrap:
 * Chips flow left-to-right across the ENTIRE content width of the board module
 * (`flex flex-wrap`), filling each row edge-to-edge before wrapping onto the next.
 * This replaced the earlier `grid-flow-col auto-cols-max w-max` + `overflow-x-auto`
 * layout, which sized the track to its content and clustered every chip on the
 * left — leaving a large empty gap on the right of wide screens. Wrapping (rather
 * than a horizontal scroll track) means the control uses the available horizontal
 * space on desktop and adapts gracefully to more rows on narrow screens, with no
 * clipping and no sideways scrolling. Chips keep their natural size (`shrink-0` —
 * never stretched to fill), so the balance comes from distribution across the
 * width, not from distorting individual buttons. This matches the Landing page's
 * `LandingCategorySelector` (§65) so the two category controls read the same.
 *
 * Because there is no scroll track, the old scroll-position contract (inline
 * buttons + no scroll-snap + scroll-the-clicked-chip-into-view) is no longer
 * needed: every chip is always laid out and visible, so selecting one never
 * moves the viewport.
 *
 * COLOUR — restrained. Idle chips are plain white on a neutral border. The
 * SELECTED chip is Deep Green #4F7942 with white text (5.07:1) and carries the
 * one small Vibrant Gold highlight left in the board — its count badge, where
 * Ink Green #2F4A28 on gold measures 7.0:1. Gold is never used as text on a
 * light surface (1.6:1), and appears nowhere on the cards.
 *
 * @param categories  [{ name, count }] pre-sorted by useJobFilters
 * @param active      the currently selected category ('' = All)
 * @param total       total active postings (for the "All Jobs" badge)
 * @param onSelect    (name) => void  — '' clears the category filter
 */
const CategoryChips = ({ categories = [], active = '', total = 0, onSelect, className = '' }) => {
    if (!categories.length) return null;

    const chipClass = (selected) =>
        `shrink-0 flex items-center gap-2 pl-3.5 pr-2 py-2.5 rounded-full border text-sm font-bold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
            selected
                ? 'bg-accent border-accent text-white shadow-sm'
                : 'bg-surface/70 border-line/50 text-content hover:border-accent/40 hover:text-content dark:hover:bg-surface shadow-[0_1px_4px_rgba(15,23,42,0.04)]'
        }`;

    const badgeClass = (selected) =>
        `inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-xs font-black leading-none tabular-nums rounded-full ${
            selected
                ? 'bg-[#FFD700] text-content'
                : 'bg-accent/10 text-content dark:bg-accent-text/20 dark:text-accent-text'
        }`;

    // One flat list of inline buttons — the filtering contract is unchanged:
    // "All Jobs" clears the category; clicking the active chip also clears it.
    const items = [
        { key: '__all__', value: '', label: 'All Jobs', count: total, selected: !active, allChip: true },
        ...categories.map(({ name, count }) => ({
            key: name,
            value: active === name ? '' : name, // clicking the active chip clears it
            label: name,
            count,
            selected: active === name,
            allChip: false,
        })),
    ];

    return (
        <div
            className={`flex flex-wrap items-center gap-2.5 ${className}`}
            role="group"
            aria-label="Filter jobs by category"
        >
            {items.map((it) => (
                <button
                    key={it.key}
                    type="button"
                    onClick={() => onSelect?.(it.value)}
                    aria-pressed={it.selected}
                    className={chipClass(it.selected)}
                >
                    {it.allChip && (
                        <LayoutGrid size={15} className={it.selected ? 'text-white' : 'text-accent-text'} />
                    )}
                    <span className="whitespace-nowrap">{it.label}</span>
                    <span className={badgeClass(it.selected)}>{it.count}</span>
                </button>
            ))}
        </div>
    );
};

export default CategoryChips;
