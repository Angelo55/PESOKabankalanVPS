/**
 * SEARCH DROPDOWN — the unified, reusable search-with-suggestion overlay.
 *
 * One component for every searchable module (Public Job Board, Job Publication
 * Manager, Applicant Pipeline, Referral Register, …). It renders the search input
 * AND a contextual dropdown that opens on focus/typing, replacing the old
 * below-content Recent/Suggested chips. Sections, in order:
 *   • Quick Filters    — one-tap category/type filters for the current module
 *   • Recent Searches  — the user's history (empty query only); each removable
 *   • Suggested        — recommended keywords from the data (empty query only)
 *   • Matching Results — live matches as you type (replaces Recent/Suggested)
 *
 * INTERACTION CONTRACT (matches the request):
 *   1. Focus/click opens the dropdown immediately.
 *   2. With no input → Recent + Suggested (+ Quick Filters).
 *   3. Typing → Matching Results replace Recent/Suggested in real time.
 *   4. Picking an option populates the field AND runs the search (onSubmit).
 *   5. Enter runs a standard search on the raw text.
 *   6. Outside click / Escape closes with a light animation.
 *
 * ACCESSIBILITY: ARIA combobox+listbox, `aria-activedescendant`, full keyboard
 * nav (↑/↓ through options, Enter to pick/submit, Esc to close). Entrance/exit use
 * `animate-in` + `motion-reduce:animate-none`, so reduced-motion users get no
 * movement. Token-styled → themes light/dark automatically.
 *
 * The parent owns the data + actions; this component owns the interaction:
 *   value / onChange        controlled input text (drives live filtering)
 *   onSubmit(term)          run the search + record the term as recent
 *   recent / onRemoveRecent / onClearRecent
 *   suggestions[]           string keywords
 *   results[]               [{ key, label, sublabel?, icon?, onSelect? }]
 *   quickFilters[]          [{ key, label, icon?, active, onToggle }]
 */

import React, { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Search, X, Clock, Sparkles, ArrowRight, CornerDownLeft, SlidersHorizontal } from 'lucide-react';

const SearchDropdown = ({
    value,
    onChange,
    onSubmit,
    placeholder = 'Search…',
    ariaLabel = 'Search',
    recent = [],
    onRemoveRecent,
    onClearRecent,
    suggestions = [],
    results = [],
    quickFilters = [],
    size = 'md',
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const wrapRef = useRef(null);
    const inputRef = useRef(null);
    const listId = useId();

    const hasQuery = (value || '').trim().length > 0;

    // The flat, arrow-navigable option list. When typing, it's the live results;
    // otherwise it's recent history then suggested keywords. Quick filters are a
    // separate chip row (tabbable, not part of arrow nav).
    const options = useMemo(() => {
        if (hasQuery) {
            return results.map((r) => ({
                type: 'result', label: r.label, sublabel: r.sublabel, icon: r.icon, key: `res-${r.key}`,
                run: () => (r.onSelect ? r.onSelect() : selectTerm(r.label)),
            }));
        }
        return [
            ...recent.map((t) => ({ type: 'recent', label: t, key: `rec-${t}`, run: () => selectTerm(t) })),
            ...suggestions.map((t) => ({ type: 'suggestion', label: t, key: `sug-${t}`, run: () => selectTerm(t) })),
        ];
        // selectTerm is stable enough within a render; deps below cover the data.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasQuery, results, recent, suggestions]);

    // Clamp the active index whenever the option set changes.
    useEffect(() => {
        setActiveIndex((i) => (i >= options.length ? options.length - 1 : i));
    }, [options.length]);

    // Close on outside click.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const selectTerm = (term) => {
        onChange(term);
        onSubmit?.(term);
        setOpen(false);
        setActiveIndex(-1);
        // Keep focus on the field so the user can keep refining.
        inputRef.current?.focus();
    };

    const submitRaw = () => {
        onSubmit?.((value || '').trim());
        setOpen(false);
        setActiveIndex(-1);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, -1));
        } else if (e.key === 'Enter') {
            if (open && activeIndex >= 0 && options[activeIndex]) {
                e.preventDefault();
                options[activeIndex].run();
            } else {
                submitRaw();
            }
        } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); setOpen(false); setActiveIndex(-1); }
        }
    };

    const showRecent = !hasQuery && recent.length > 0;
    const showSuggested = !hasQuery && suggestions.length > 0;
    const showResults = hasQuery;
    const hasPanelContent = quickFilters.length > 0 || showRecent || showSuggested || showResults;

    const inputPad = size === 'sm' ? 'py-2' : 'py-2.5';

    return (
        <div ref={wrapRef} className={`relative group ${className}`}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle group-focus-within:text-accent-text transition-colors pointer-events-none" size={18} />
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIndex(-1); }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                aria-label={ariaLabel}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
                autoComplete="off"
                className={`w-full pl-12 pr-10 ${inputPad} rounded-2xl outline-none transition-all duration-300 font-medium text-sm border border-line bg-surface text-content placeholder-subtle shadow-card focus:border-accent/40 focus:ring-2 focus:ring-accent/35`}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => { onChange(''); setActiveIndex(-1); inputRef.current?.focus(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    aria-label="Clear search"
                >
                    <X size={16} />
                </button>
            )}

            {open && hasPanelContent && (
                <div
                    id={listId}
                    role="listbox"
                    aria-label="Search suggestions"
                    className="absolute z-[60] left-0 right-0 mt-2 max-h-[22rem] overflow-y-auto custom-scrollbar rounded-2xl border border-line bg-raised shadow-xl p-2 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"
                >
                    {/* Quick filters */}
                    {quickFilters.length > 0 && (
                        <div className="px-2 pt-1.5 pb-2">
                            <p className="text-[10px] font-black uppercase tracking-wider text-subtle flex items-center gap-1.5 mb-2">
                                <SlidersHorizontal size={11} /> Quick filters
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {quickFilters.map((f) => (
                                    <button
                                        key={f.key}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => f.onToggle?.()}
                                        aria-pressed={!!f.active}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                            f.active
                                                ? 'bg-accent text-accent-contrast border-transparent'
                                                : 'bg-surface border-line text-muted hover:bg-sunken hover:text-content'
                                        }`}
                                    >
                                        {f.icon}{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent searches (empty query) */}
                    {showRecent && (
                        <Section
                            title="Recent searches"
                            icon={<Clock size={11} />}
                            action={onClearRecent && (
                                <button onMouseDown={(e) => e.preventDefault()} onClick={onClearRecent} className="text-[10px] font-bold text-muted hover:text-content transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1">Clear</button>
                            )}
                        >
                            {recent.map((term) => {
                                const idx = options.findIndex((o) => o.type === 'recent' && o.label === term);
                                return (
                                    <OptionRow
                                        key={term} id={`${listId}-opt-${idx}`} active={idx === activeIndex}
                                        icon={<Clock size={15} className="text-subtle" />} label={term}
                                        onPick={() => selectTerm(term)} onHover={() => setActiveIndex(idx)}
                                        trailing={onRemoveRecent && (
                                            <button
                                                type="button"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={(e) => { e.stopPropagation(); onRemoveRecent(term); }}
                                                aria-label={`Remove ${term}`}
                                                className="p-1 rounded-full text-subtle hover:text-content hover:bg-content/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                            >
                                                <X size={13} />
                                            </button>
                                        )}
                                    />
                                );
                            })}
                        </Section>
                    )}

                    {/* Suggested searches (empty query) */}
                    {showSuggested && (
                        <Section title="Suggested searches" icon={<Sparkles size={11} />}>
                            {suggestions.map((term) => {
                                const idx = options.findIndex((o) => o.type === 'suggestion' && o.label === term);
                                return (
                                    <OptionRow
                                        key={term} id={`${listId}-opt-${idx}`} active={idx === activeIndex}
                                        icon={<Sparkles size={15} className="text-accent-text" />} label={term}
                                        onPick={() => selectTerm(term)} onHover={() => setActiveIndex(idx)}
                                    />
                                );
                            })}
                        </Section>
                    )}

                    {/* Live matching results (typing) */}
                    {showResults && (
                        <Section title="Matching results" icon={<Search size={11} />}>
                            {results.length === 0 ? (
                                <p className="px-3 py-3 text-sm text-muted">
                                    No matches for <span className="font-bold text-content">“{value}”</span>. Press <CornerDownLeft size={12} className="inline -mt-0.5" /> Enter to search anyway.
                                </p>
                            ) : (
                                results.map((r, i) => (
                                    <OptionRow
                                        key={r.key} id={`${listId}-opt-${i}`} active={i === activeIndex}
                                        icon={r.icon || <ArrowRight size={15} className="text-subtle" />}
                                        label={r.label} sublabel={r.sublabel}
                                        onPick={() => (r.onSelect ? (r.onSelect(), setOpen(false)) : selectTerm(r.label))}
                                        onHover={() => setActiveIndex(i)}
                                    />
                                ))
                            )}
                        </Section>
                    )}
                </div>
            )}
        </div>
    );
};

const Section = ({ title, icon, action, children }) => (
    <div className="py-1">
        <div className="flex items-center justify-between px-2 mb-1">
            <p className="text-[10px] font-black uppercase tracking-wider text-subtle flex items-center gap-1.5">{icon} {title}</p>
            {action}
        </div>
        {children}
    </div>
);

const OptionRow = ({ id, active, icon, label, sublabel, onPick, onHover, trailing }) => (
    <div
        id={id}
        role="option"
        aria-selected={active}
        // onMouseDown preventDefault keeps input focus so the panel doesn't blur-close before the click lands.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPick}
        onMouseEnter={onHover}
        className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${active ? 'bg-accent-soft/70 dark:bg-accent-text/10' : 'hover:bg-sunken'}`}
    >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-content truncate">{label}</span>
            {sublabel && <span className="block text-xs text-muted truncate">{sublabel}</span>}
        </span>
        {trailing}
    </div>
);

export default SearchDropdown;
