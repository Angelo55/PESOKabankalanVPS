/**
 * motion.js — ONE shared Motion (framer-motion) language for the whole app.
 *
 * WHY THIS EXISTS
 * framer-motion ships in the bundle but nothing used it; every module rolled its
 * own `animate-in`/CSS timing, so the Events modal, Messages Hub and referral
 * views were drifting apart. This module is the single place durations, easings
 * and reusable variants are defined, so a modal in Events feels like a modal in
 * Messages, and both feel like the existing chatbot/header motion.
 *
 * It is deliberately aligned with `components/chat/chatMotion.js`: the same
 * expo-out curve (cubic-bezier(0.16, 1, 0.3, 1)) and ~300ms panel timing the two
 * chatbots already use. Import from here; do NOT hand-write durations/eases in
 * components.
 *
 * REDUCED MOTION
 * `prefersReducedMotion()` collapses variants to instant opacity swaps. Callers
 * that build variants at module scope can wrap with `withReducedMotion(variant)`;
 * components that can read at render time should prefer Motion's own
 * `useReducedMotion()` hook. Either way, honour the user's OS setting.
 *
 * KEEP IT SIMPLE
 * Motion is for enter/exit, layout, and stagger — where it measurably helps.
 * Simple hovers and colour fades stay in CSS/Tailwind for lighter overhead.
 */

// The signature PESO easing — expo-out. Matches chatMotion's cubic-bezier.
export const EASE_EXPO_OUT = [0.16, 1, 0.3, 1];
// A gentle standard ease for smaller, quicker transitions (list items, chips).
export const EASE_STANDARD = [0.4, 0, 0.2, 1];

export const DURATION = {
    fast: 0.18,
    base: 0.28,
    slow: 0.4
};

/** True when the viewer asked the OS to minimise animation. Safe on the server. */
export const prefersReducedMotion = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Collapse any variant set to a plain opacity swap when the user prefers reduced
 * motion — keeps meaning (present/absent) without transform movement.
 */
export const withReducedMotion = (variants) =>
    prefersReducedMotion()
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: { duration: DURATION.fast } },
            exit: { opacity: 0, transition: { duration: DURATION.fast } }
        }
        : variants;

// ── Overlay + panel: the standard modal/drawer pairing ─────────────────────
export const modalOverlay = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_STANDARD } },
    exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE_STANDARD } }
};

export const modalPanel = {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.base, ease: EASE_EXPO_OUT } },
    exit: { opacity: 0, y: 12, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_STANDARD } }
};

// ── Generic fade-in-up for cards/sections coming into view ──────────────────
export const fadeInUp = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_EXPO_OUT } },
    exit: { opacity: 0, y: 8, transition: { duration: DURATION.fast, ease: EASE_STANDARD } }
};

// ── Staggered list: a container that reveals its children in sequence ───────
export const listContainer = {
    initial: {},
    animate: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
    exit: {}
};

export const listItem = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_EXPO_OUT } },
    exit: { opacity: 0, transition: { duration: DURATION.fast } }
};

// Convenience spread for a tap/press affordance on interactive motion elements.
export const pressable = {
    whileTap: { scale: 0.97 },
    transition: { duration: DURATION.fast, ease: EASE_STANDARD }
};
