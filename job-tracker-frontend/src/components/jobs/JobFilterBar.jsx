import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Search, SlidersHorizontal, ChevronDown, X, ArrowDownWideNarrow } from 'lucide-react';
import { SORT_OPTIONS } from './useJobFilters';
import SearchDropdown from '../common/SearchDropdown';
import useRecentSearches from '../../hooks/useRecentSearches';

/**
 * Shared discovery control row: search, category selector, a "Filters" popover
 * (job type / work setup / location / optional status) and a sort dropdown.
 * Driven entirely by a useJobFilters() instance passed in as `filters`.
 *
 * THEMING: shared by the Public Job Board, the PESO Admin dashboard and Saved
 * Jobs. Now fully token-driven (§24) — both `default` and `radiant` resolve to the
 * SAME semantic-token styling, so the accent is unified on the redesigned green
 * (#4F7942 light / #A8D5BA dark via the accent tokens) and the legacy #1a4a38/#99e742
 * are retired here. The `variant` prop is kept for call-site compatibility.
 */
const TOKENS = {
    control: 'border border-line bg-surface text-content shadow-card focus:ring-2 focus:ring-accent/35',
    searchIcon: 'text-subtle group-focus-within:text-accent-text',
    input: 'border border-line bg-surface text-content placeholder-subtle shadow-card focus:bg-surface focus:border-accent/40 focus:ring-2 focus:ring-accent/35',
    button: 'border border-line bg-surface text-content shadow-card hover:border-accent/40 hover:text-content',
    countBadge: 'bg-accent text-accent-contrast',
    popover: 'bg-raised border border-line',
    label: 'text-muted',
    textInput: 'border border-line bg-sunken focus:ring-2 focus:ring-accent/35 text-content',
    meta: 'text-muted',
};
const THEMES = { default: TOKENS, radiant: TOKENS };

const JobFilterBar = ({ filters, showStatus = false, showCategory = true, resultCount = null, className = '', variant = 'default', searchNamespace = 'jobs', searchPlaceholder = 'Search jobs, keywords, or companies' }) => {
    const { state, set, categories, jobTypes, workSetups, statuses, activeCount, reset, filtered } = filters;
    const [popoverOpen, setPopoverOpen] = useState(false);
    const popoverRef = useRef(null);
    const t = THEMES[variant] || THEMES.default;

    // Recent searches for THIS module's search dropdown (namespaced). Recorded on a
    // debounce so a settled, intentional term is stored — plus explicitly on submit.
    const { recent, record, remove, clear } = useRecentSearches(searchNamespace);
    useEffect(() => {
        const q = (state.search || '').trim();
        if (!q) return;
        const id = setTimeout(() => record(q), 900);
        return () => clearTimeout(id);
    }, [state.search, record]);

    // Dropdown sections derived from the live dataset:
    //  • Suggested searches = the top categories (a keyword text search)
    //  • Quick filters      = the top employment types (an exact filter toggle)
    //  • Matching results   = the current filtered postings, shown while typing
    const suggestions = useMemo(() => categories.slice(0, 6).map((c) => c.name), [categories]);
    const quickFilters = useMemo(() => jobTypes.slice(0, 5).map((jt) => ({
        key: jt, label: jt, active: state.jobType === jt,
        onToggle: () => set.setJobType(state.jobType === jt ? '' : jt),
    })), [jobTypes, state.jobType, set]);
    const results = useMemo(() => (
        (state.search || '').trim()
            ? (filtered || []).slice(0, 6).map((j) => ({ key: j.id, label: j.title, sublabel: j.company }))
            : []
    ), [state.search, filtered]);

    // NOTE: no padding-left here on purpose. Callers add their own (`pl-3.5`
    // plain, `pl-10` when a leading icon sits inside the control). Baking a
    // default in meant the sort select carried BOTH `pl-3.5` and `pl-10`;
    // Tailwind emits equal-specificity rules, so whichever lands later in the
    // stylesheet wins — and when `pl-3.5` won, "Newest first" was drawn
    // underneath its own leading icon and read as a stray glyph over the label.
    const selectClass = `appearance-none pr-9 py-2.5 rounded-2xl text-sm font-bold outline-none transition-all cursor-pointer ${t.control}`;

    useEffect(() => {
        if (!popoverOpen) return;
        const onClick = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setPopoverOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setPopoverOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [popoverOpen]);

    const advancedCount = [state.jobType, state.workSetup, state.location, showStatus ? state.status : ''].filter(v => v && v.toString().trim()).length;

    return (
        <div className={`flex flex-wrap items-center gap-3 ${className}`}>
            {/* Search — unified dropdown overlay (recent / suggested / results / quick filters) */}
            <SearchDropdown
                className="flex-1 min-w-[220px]"
                value={state.search}
                onChange={set.setSearch}
                onSubmit={(term) => { set.setSearch(term); record(term); }}
                placeholder={searchPlaceholder}
                ariaLabel="Search"
                recent={recent}
                onRemoveRecent={remove}
                onClearRecent={clear}
                suggestions={suggestions}
                results={results}
                quickFilters={quickFilters}
            />

            {/* Category (hidden where a dedicated category-chip row is shown instead) */}
            {showCategory && (
                <div className="relative">
                    <select value={state.category} onChange={(e) => set.setCategory(e.target.value)} className={`${selectClass} pl-3.5`} aria-label="Filter by category">
                        <option value="">All Categories</option>
                        {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
                </div>
            )}

            {/* Filters popover */}
            <div className="relative" ref={popoverRef}>
                <button
                    onClick={() => setPopoverOpen(o => !o)}
                    aria-expanded={popoverOpen}
                    aria-haspopup="true"
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all ${t.button}`}
                >
                    <SlidersHorizontal size={16} /> Filters
                    {advancedCount > 0 && <span className={`ml-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${t.countBadge}`}>{advancedCount}</span>}
                    <ChevronDown size={14} className={`transition-transform ${popoverOpen ? 'rotate-180' : ''}`} />
                </button>

                {popoverOpen && (
                    <div className={`absolute right-0 mt-2 w-72 rounded-2xl shadow-xl p-4 z-50 animate-in fade-in slide-in-from-top-2 space-y-4 ${t.popover}`}>
                        <div>
                            <label className={`block text-[11px] font-black uppercase tracking-widest mb-1.5 ${t.label}`}>Employment Type</label>
                            <select value={state.jobType} onChange={(e) => set.setJobType(e.target.value)} className={`${selectClass} w-full pl-3.5`}>
                                <option value="">Any</option>
                                {jobTypes.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={`block text-[11px] font-black uppercase tracking-widest mb-1.5 ${t.label}`}>Work Setup</label>
                            <select value={state.workSetup} onChange={(e) => set.setWorkSetup(e.target.value)} className={`${selectClass} w-full pl-3.5`}>
                                <option value="">Any</option>
                                {workSetups.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={`block text-[11px] font-black uppercase tracking-widest mb-1.5 ${t.label}`}>Location</label>
                            <input value={state.location} onChange={(e) => set.setLocation(e.target.value)} placeholder="e.g. Kabankalan" className={`w-full px-3.5 py-2.5 rounded-2xl text-sm font-medium outline-none ${t.textInput}`} />
                        </div>
                        {showStatus && (
                            <div>
                                <label className={`block text-[11px] font-black uppercase tracking-widest mb-1.5 ${t.label}`}>Status</label>
                                <select value={state.status} onChange={(e) => set.setStatus(e.target.value)} className={`${selectClass} w-full pl-3.5`}>
                                    <option value="">Any</option>
                                    {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        )}
                        <button onClick={() => { reset(); setPopoverOpen(false); }} className="w-full py-2.5 text-sm font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-colors">
                            Clear all filters
                        </button>
                    </div>
                )}
            </div>

            {/* Sort */}
            <div className="relative">
                <ArrowDownWideNarrow size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
                <select value={state.sort} onChange={(e) => set.setSort(e.target.value)} className={`${selectClass} pl-10`} aria-label="Sort jobs">
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
            </div>

            {(activeCount > 0 || resultCount != null) && (
                <div className={`flex items-center gap-3 w-full sm:w-auto text-xs font-bold ${t.meta}`}>
                    {resultCount != null && <span>{resultCount} result{resultCount === 1 ? '' : 's'}</span>}
                    {activeCount > 0 && (
                        <button onClick={reset} className="flex items-center gap-1 text-rose-500 hover:text-rose-600 transition-colors">
                            <X size={14} /> Clear
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default JobFilterBar;
