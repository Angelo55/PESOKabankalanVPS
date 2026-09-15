import React, { useEffect, useRef, useState } from 'react';
import { Pin, PinOff, Palette, Check } from 'lucide-react';

/**
 * Shared "organise my cards" controls: pin-to-top and a Google-Keep-style
 * colour label. Used by BOTH Saved Vacancies and the My Applications Kanban so
 * the two surfaces behave and look identical.
 *
 * The database stores the palette KEY ('red', 'amber', …), never a hex value —
 * see migration 015. That means the actual colours live here, can be retuned
 * for light/dark without a data migration, and an unrecognised key simply
 * renders as "no label" instead of injecting arbitrary CSS.
 */
/**
 * ── Contrast model ─────────────────────────────────────────────────────────
 * Each colour declares its own `ink` (primary text) and `inkMuted` (secondary)
 * alongside its `surface`, so text colour is DATA, not a guess at call sites.
 *
 * Contrast is guaranteed by CONSTRUCTION rather than by a runtime luminance
 * calculation: every surface is pinned to a known lightness band — a saturated
 * but light tint (200) in light mode, a deep tint (900/45%) in dark mode. That
 * lets the colours read as genuinely vibrant while keeping dark ink far above
 * AA on light mode and light ink far above it on dark. Measured worst case at
 * 200/950: ~11.5:1 (teal) to ~12:1 (amber) — AAA with headroom to spare.
 *
 * Because `ink` is per-colour data, adding a genuinely dark surface later only
 * means declaring light ink on that one row — no call site changes, and no
 * chance of an unreadable combination slipping in.
 *
 * `swatch` is a step more saturated (400) than the card so the picker dots stay
 * easy to tell apart at 24px; borders sit one step above the surface (300) to
 * give each card a crisp edge rather than bleeding into the page.
 */
export const COLOR_LABELS = [
    { key: 'red',    name: 'Red',    swatch: 'bg-rose-400',    ring: 'ring-rose-400',
      surface: 'bg-rose-200 dark:bg-rose-900/45',       border: 'border-rose-300 dark:border-rose-800/60',
      ink: 'text-rose-950 dark:text-rose-50',           inkMuted: 'text-rose-900/80 dark:text-rose-100/75' },
    { key: 'amber',  name: 'Amber',  swatch: 'bg-amber-400',   ring: 'ring-amber-400',
      surface: 'bg-amber-200 dark:bg-amber-900/45',     border: 'border-amber-300 dark:border-amber-800/60',
      ink: 'text-amber-950 dark:text-amber-50',         inkMuted: 'text-amber-900/80 dark:text-amber-100/75' },
    { key: 'green',  name: 'Green',  swatch: 'bg-emerald-400', ring: 'ring-emerald-400',
      surface: 'bg-emerald-200 dark:bg-emerald-900/45', border: 'border-emerald-300 dark:border-emerald-800/60',
      ink: 'text-emerald-950 dark:text-emerald-50',     inkMuted: 'text-emerald-900/80 dark:text-emerald-100/75' },
    { key: 'teal',   name: 'Teal',   swatch: 'bg-teal-400',    ring: 'ring-teal-400',
      surface: 'bg-teal-200 dark:bg-teal-900/45',       border: 'border-teal-300 dark:border-teal-800/60',
      ink: 'text-teal-950 dark:text-teal-50',           inkMuted: 'text-teal-900/80 dark:text-teal-100/75' },
    { key: 'blue',   name: 'Blue',   swatch: 'bg-sky-400',     ring: 'ring-sky-400',
      surface: 'bg-sky-200 dark:bg-sky-900/45',         border: 'border-sky-300 dark:border-sky-800/60',
      ink: 'text-sky-950 dark:text-sky-50',             inkMuted: 'text-sky-900/80 dark:text-sky-100/75' },
    { key: 'purple', name: 'Purple', swatch: 'bg-violet-400',  ring: 'ring-violet-400',
      surface: 'bg-violet-200 dark:bg-violet-900/45',   border: 'border-violet-300 dark:border-violet-800/60',
      ink: 'text-violet-950 dark:text-violet-50',       inkMuted: 'text-violet-900/80 dark:text-violet-100/75' },
    { key: 'pink',   name: 'Pink',   swatch: 'bg-pink-400',    ring: 'ring-pink-400',
      surface: 'bg-pink-200 dark:bg-pink-900/45',       border: 'border-pink-300 dark:border-pink-800/60',
      ink: 'text-pink-950 dark:text-pink-50',           inkMuted: 'text-pink-900/80 dark:text-pink-100/75' },
    { key: 'gray',   name: 'Gray',   swatch: 'bg-slate-400',   ring: 'ring-slate-400',
      surface: 'bg-slate-200 dark:bg-slate-700/60',     border: 'border-slate-400 dark:border-slate-600',
      ink: 'text-slate-900 dark:text-slate-50',         inkMuted: 'text-slate-700/85 dark:text-slate-200/75' },
];

export const getLabel = (key) => COLOR_LABELS.find(c => c.key === key) || null;

/**
 * Resolves a labelled card's full style set, falling back to the neutral card
 * when there is no label. Both pages call this so a labelled card looks the
 * same everywhere and the untinted default is defined in exactly one place.
 */
export const cardTheme = (key) => {
    const c = getLabel(key);
    if (!c) {
        return {
            surface: 'bg-surface',
            border: 'border-line',
            ink: 'text-content',
            inkMuted: 'text-muted',
            // Meta chips on an untinted card.
            chip: 'bg-sunken border-line',
            divider: 'border-line',
            labelled: false,
        };
    }
    return {
        surface: c.surface,
        border: c.border,
        ink: c.ink,
        inkMuted: c.inkMuted,
        // Translucent white/black keeps chips legible on ANY tint without
        // needing a per-colour chip token.
        chip: 'bg-surface/70 dark:bg-black/20 border-black/5 dark:border-white/10',
        divider: 'border-black/10 dark:border-white/10',
        labelled: true,
    };
};

/**
 * Sort helper shared by both pages: pinned first, then the caller's existing
 * order preserved (Array.prototype.sort is stable in modern engines, so equal
 * pin state keeps whatever order the server sent).
 */
export const pinnedFirst = (items) =>
    [...items].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));

/**
 * Pin toggle. Deliberately always visible once pinned (so the state is legible
 * at rest) and revealed on hover/focus otherwise, keeping the card clean.
 *
 * On a labelled card the idle button inherits the card's ink at reduced opacity
 * rather than a fixed grey, so it stays visible on every tint.
 */
export const PinButton = ({ pinned, busy = false, onToggle, onTint = false, className = '' }) => (
    <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle?.(!pinned); }}
        disabled={busy}
        aria-pressed={!!pinned}
        aria-label={pinned ? 'Unpin from top' : 'Pin to top'}
        title={pinned ? 'Unpin from top' : 'Pin to top priority'}
        className={`p-1.5 rounded-lg transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            pinned
                ? (onTint
                    ? 'bg-black/10 dark:bg-surface/15 text-current'
                    : 'bg-accent-text/10 text-accent-text')
                : (onTint
                    ? 'text-current dim-until-hover hover:bg-black/5 dark:hover:bg-surface/10'
                    : 'text-subtle hover:text-accent-text hover:bg-sunken reveal-on-hover')
        } ${className}`}
    >
        {pinned ? <Pin size={15} fill="currentColor" /> : <Pin size={15} />}
    </button>
);

/**
 * Colour-label picker. A small popover of swatches plus a "no label" clear.
 * Closes on outside click and Escape, and stops click propagation so opening it
 * never triggers the parent card's own click/drag handlers.
 */
export const ColorLabelPicker = ({ colorKey, busy = false, onPick, onTint = false, className = '' }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const active = getLabel(colorKey);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open]);

    return (
        <div className={`relative ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                disabled={busy}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={active ? `Colour label: ${active.name}` : 'Add colour label'}
                title={active ? `Label: ${active.name}` : 'Add colour label'}
                className={`p-1.5 rounded-lg transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    onTint
                        ? (open ? 'bg-black/10 dark:bg-surface/15 text-current' : 'text-current dim-until-hover hover:bg-black/5 dark:hover:bg-surface/10')
                        : (active || open
                            ? 'text-muted bg-sunken'
                            : 'text-subtle hover:text-accent-text hover:bg-sunken reveal-on-hover')
                }`}
            >
                {active
                    ? <span className={`block w-[15px] h-[15px] rounded-full ${active.swatch}`} />
                    : <Palette size={15} />}
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1.5 z-30 p-2 rounded-xl bg-raised border border-line shadow-raised w-[136px] animate-in fade-in zoom-in-95 duration-150">
                    <div className="grid grid-cols-4 gap-1.5">
                        {COLOR_LABELS.map(c => (
                            <button
                                key={c.key}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onPick?.(colorKey === c.key ? null : c.key); setOpen(false); }}
                                aria-label={c.name}
                                title={c.name}
                                className={`w-6 h-6 rounded-full ${c.swatch} flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 ${c.ring} ${colorKey === c.key ? `ring-2 ring-offset-1 ring-offset-raised ${c.ring}` : ''}`}
                            >
                                {colorKey === c.key && <Check size={13} className="text-white drop-shadow" />}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onPick?.(null); setOpen(false); }}
                        className="mt-2 w-full text-[11px] font-bold text-muted hover:text-content py-1 rounded-lg hover:bg-sunken transition-colors"
                    >
                        No label
                    </button>
                </div>
            )}
        </div>
    );
};
