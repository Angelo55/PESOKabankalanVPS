import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * SidebarTooltip — the ONE contextual helper tooltip shared by every role-based
 * sidebar (Job Seeker, PESO Admin, PESO Staff, the Employer alias → PESO Admin, and
 * the Super Admin portal). Wrap a single sidebar nav item; on hover OR keyboard focus
 * it shows a concise description of what that module is for, anchored just to the
 * RIGHT of the item — so the user learns the module's purpose without opening it.
 *
 * ── WHY A PORTAL + position:fixed ───────────────────────────────────────────
 * The sidebars scroll their nav with `overflow-x-hidden`, which clips a normally
 * (absolutely) positioned tooltip. Rendering the bubble into document.body at fixed
 * coordinates measured from the item's bounding rect escapes every overflow/stacking
 * ancestor, and lets us CLAMP it to the viewport — satisfying "adjacent to the item,
 * always on screen, never clipped". It flips to the item's left only if the right
 * side would overflow (never happens for a left sidebar on desktop, but it's robust).
 *
 * ── CONSISTENCY (design system, not a standalone black bubble) ───────────────
 * The bubble uses the SAME elevated-surface tokens as the TopHeader avatar menu and
 * the "+ Create New" dropdown — `bg-raised` + `border-line` + `shadow-raised`, with
 * `text-content` / `text-muted` typography — so it themes correctly in light AND dark
 * (no pure-black background) and reads as a native part of the interface. The motion
 * matches those dropdowns: a subtle fade + slight positional slide over 200ms ease-out
 * on BOTH appear and disappear (no abrupt pop). Reduced-motion aware, and
 * `pointer-events-none` so it can never intercept a navigation click or flicker as the
 * cursor moves within the item. It does not touch the sidebar collapse/expand state,
 * the NavLink click, or keyboard focus.
 *
 * Props:
 *   label        the item's label (shown as a bold title line only when `showLabel`)
 *   description  the contextual helper text (the point of the tooltip)
 *   showLabel    true when the rail is COLLAPSED (label otherwise hidden) → show it
 *   disabled     skip the tooltip entirely (e.g. on touch/mobile shells)
 */
const TOOLTIP_MAX_W = 300;
const HALF_EST = 54; // conservative half-height (1–3 line bubble) for the viewport clamp

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SidebarTooltip = ({ label, description, showLabel = false, disabled = false, children }) => {
    const triggerRef = useRef(null);
    const hideTimer = useRef(null);
    const [mounted, setMounted] = useState(false); // in the DOM (portal)
    const [shown, setShown] = useState(false);      // transitioned-in (visible)
    const [pos, setPos] = useState({ top: 0, left: 0 });

    // Render the item untouched when there is nothing worth showing.
    const hasContent = Boolean(description) || (showLabel && Boolean(label));

    const place = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const margin = 8;
        // Vertically centre on the item, then clamp so the bubble stays on screen.
        const top = Math.min(
            Math.max(r.top + r.height / 2, margin + HALF_EST),
            window.innerHeight - margin - HALF_EST,
        );
        // Open to the RIGHT of the item; flip left only if that would overflow.
        let left = r.right + 12;
        if (left + TOOLTIP_MAX_W > window.innerWidth - margin) {
            left = Math.max(margin, r.left - 12 - TOOLTIP_MAX_W);
        }
        setPos({ top, left });
    }, []);

    const show = useCallback(() => {
        if (disabled || !hasContent) return;
        clearTimeout(hideTimer.current);
        place();
        setMounted(true);
        // Two rAFs so the initial (hidden) styles paint before we flip to shown,
        // guaranteeing the enter transition actually runs.
        requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    }, [disabled, hasContent, place]);

    const hide = useCallback(() => {
        setShown(false);
        clearTimeout(hideTimer.current);
        // Keep it mounted for the full exit transition (200ms, matching the dropdowns),
        // then remove — so it fades/slides out instead of vanishing abruptly.
        hideTimer.current = setTimeout(() => setMounted(false), 210);
    }, []);

    // Clear any pending unmount timer if this item is removed (e.g. role/nav change).
    useEffect(() => () => clearTimeout(hideTimer.current), []);

    const reduce = prefersReducedMotion();
    const bubbleStyle = {
        top: pos.top,
        left: pos.left,
        maxWidth: TOOLTIP_MAX_W,
        opacity: shown ? 1 : 0,
        // Fade + a subtle 6px slide, matching the TopHeader / "+ Create New" dropdowns
        // (200ms ease-out on both appear and disappear).
        transform: `translateY(-50%) translateX(${shown || reduce ? '0px' : '-6px'})`,
        transition: reduce ? 'none' : 'opacity 200ms ease-out, transform 200ms ease-out',
    };

    return (
        <div
            ref={triggerRef}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
        >
            {children}
            {mounted && hasContent && createPortal(
                <div
                    role="tooltip"
                    style={bubbleStyle}
                    // Same elevated-surface tokens as the app's dropdowns/cards — themes
                    // in light AND dark via the design tokens; never a pure-black overlay.
                    className="fixed z-[9999] rounded-xl bg-raised border border-line shadow-raised px-3 py-2.5 text-left pointer-events-none"
                >
                    {showLabel && label && (
                        <span className="block text-base font-bold text-content leading-tight">{label}</span>
                    )}
                    {description && (
                        <span
                            className={`block text-sm leading-snug ${
                                showLabel && label ? 'mt-1 text-muted font-medium' : 'text-content font-semibold'
                            }`}
                        >
                            {description}
                        </span>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
};

export default SidebarTooltip;
