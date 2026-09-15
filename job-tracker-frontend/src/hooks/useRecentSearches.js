/**
 * useRecentSearches — a tiny, per-module recent-search memory.
 *
 * Namespaced in localStorage so the Public Job Board, Job Publication Manager,
 * Applicant Pipeline, Referral Register, etc. each keep their OWN history. Terms
 * are de-duplicated case-insensitively, most-recent-first, capped, and every write
 * is try/catch-wrapped so private mode degrades to an in-memory list rather than
 * throwing. Pair with the RecentSearches chips + the `search` EmptyState variant.
 *
 *   const { recent, record, remove, clear } = useRecentSearches('job-board');
 *   // on a committed search:  record(query)
 *   // clicking a chip:        setQuery(term)  // re-runs the search
 */

import { useState, useCallback } from 'react';

const keyFor = (ns) => `recentSearches:${ns}`;
const DEFAULT_MAX = 6;

const read = (ns, max) => {
    try {
        const v = JSON.parse(localStorage.getItem(keyFor(ns)) || '[]');
        return Array.isArray(v) ? v.filter(t => typeof t === 'string').slice(0, max) : [];
    } catch {
        return [];
    }
};

const write = (ns, list) => {
    try { localStorage.setItem(keyFor(ns), JSON.stringify(list)); } catch { /* private mode — in-memory only */ }
};

export default function useRecentSearches(namespace, max = DEFAULT_MAX) {
    const [recent, setRecent] = useState(() => read(namespace, max));

    // Record a committed search term (ignores blanks; a term already present is
    // promoted to the front rather than duplicated).
    const record = useCallback((term) => {
        const t = (term || '').trim();
        if (!t) return;
        setRecent(prev => {
            const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, max);
            write(namespace, next);
            return next;
        });
    }, [namespace, max]);

    const remove = useCallback((term) => {
        setRecent(prev => {
            const next = prev.filter(x => x !== term);
            write(namespace, next);
            return next;
        });
    }, [namespace]);

    const clear = useCallback(() => {
        setRecent([]);
        write(namespace, []);
    }, [namespace]);

    return { recent, record, remove, clear };
}
