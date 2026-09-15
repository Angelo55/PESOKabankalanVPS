import React, { useEffect, useRef } from 'react';

/**
 * Shared scroll-reveal wrapper — the SINGLE reveal implementation used by every
 * posted-job card surface (the Landing discovery grid, the Public Job Board, and
 * the PESO Admin Job Publication Manager), so easing/distance/duration/trigger and
 * reduced-motion behaviour stay identical across all three. The visual state lives
 * in `.reveal-item` / `.reveal-item.reveal-in` (index.css); this component only
 * decides WHEN a node crosses into view.
 *
 * PERFORMANCE — one observer PER observation root, shared by every Reveal under it.
 * A board of dozens of cards would be dozens of IntersectionObservers if each element
 * made its own; instead all Reveals against the same root register with a single
 * observer. The observer keeps watching its cards (it does NOT unobserve), so the
 * reveal can REPLAY: it toggles the `reveal-in` class as a card enters and leaves,
 * with no React state and no remount — pure classList work off the observer callback.
 *
 * REPLAY + HYSTERESIS — the reveal re-fires every time a card exits and re-enters its
 * visible area. To keep that from flickering when the user nudges a card a few pixels
 * across the edge, entry and exit use DIFFERENT boundaries: a card reveals only once
 * it is clearly in view (>= REVEAL_RATIO visible) and resets only once it is fully out
 * (not intersecting at all). Between those — partially visible but under the reveal
 * threshold — the card holds whatever state it already had. So a small back-and-forth
 * scroll sits inside the dead band and nothing toggles.
 *
 * ROOT — by default the observer watches the page viewport (root: null), which is the
 * scroll architecture of the Public Job Board and the Admin manager (their grids scroll
 * with the page). Pass a `root` REF whose element is a scroll container (e.g. the
 * Landing's fixed-height job panel) and visibility is measured against THAT container
 * instead, so cards reveal/reset as they scroll within the panel — not as the page
 * scrolls. Each distinct root element gets its own shared observer (kept in a WeakMap
 * so it is collected with the container).
 *
 * ACCESSIBILITY — reduced-motion (or an environment without IntersectionObserver)
 * skips the observer and shows the node in its final state right away (no replay); the
 * CSS media query neutralises the transition as a second guard.
 *
 * Usage: <Reveal delay={i * 40}><JobCard … /></Reveal>            (viewport root)
 *        <Reveal root={panelRef} delay={i * 40}>…</Reveal>        (container root)
 */

// One observer per root. The viewport observer (root: null) is a module singleton;
// container-rooted observers live in a WeakMap keyed by the root element so they are
// GC'd with the container. Created lazily so the module is import-safe without a DOM.
let viewportObserver = null;
const rootObservers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

// Reveal once a card is at least this visible; reset only once it is fully out. The gap
// between the two is the hysteresis band that prevents edge-jitter. Feeding both 0 and
// REVEAL_RATIO to the observer means it wakes at each of those crossings and nowhere in
// between, so the callback stays cheap.
const REVEAL_RATIO = 0.15;
const OBSERVER_OPTS = { threshold: [0, REVEAL_RATIO] };

const makeObserver = (rootEl) => new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.intersectionRatio >= REVEAL_RATIO) {
            entry.target.classList.add('reveal-in');       // clearly in view → play
        } else if (!entry.isIntersecting) {
            entry.target.classList.remove('reveal-in');    // fully out → arm the replay
        }
        // else: partially visible but under the threshold → hold current state (dead band)
    });
}, { ...OBSERVER_OPTS, root: rootEl || null });

const getObserver = (rootEl) => {
    if (typeof IntersectionObserver === 'undefined') return null;
    if (!rootEl) {
        if (!viewportObserver) viewportObserver = makeObserver(null);
        return viewportObserver;
    }
    if (!rootObservers) return makeObserver(rootEl); // no WeakMap: fall back to a fresh one
    let obs = rootObservers.get(rootEl);
    if (!obs) { obs = makeObserver(rootEl); rootObservers.set(rootEl, obs); }
    return obs;
};

const Reveal = ({ as: Tag = 'div', delay = 0, root = null, className = '', children, ...rest }) => {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const prefersReduced =
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // `root` is a ref; its element is attached before effects run (refs commit
        // before effects), so root.current is populated by the time we observe.
        const rootEl = (root && typeof root === 'object' && 'current' in root) ? root.current : null;
        const obs = prefersReduced ? null : getObserver(rootEl);
        if (!obs) {
            // No motion wanted / no observer available → show it immediately.
            el.classList.add('reveal-in');
            return undefined;
        }

        obs.observe(el);
        return () => obs.unobserve(el);
    }, [root]);

    return (
        <Tag
            ref={ref}
            className={`reveal-item ${className}`}
            style={delay ? { transitionDelay: `${delay}ms` } : undefined}
            {...rest}
        >
            {children}
        </Tag>
    );
};

export default Reveal;
