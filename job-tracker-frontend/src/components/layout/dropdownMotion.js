/**
 * Shared dropdown open/close motion — the SAME transition language as the
 * "+ Create New" menu (Dashboard.jsx): the panel is ALWAYS MOUNTED and toggles via
 * transition classes, so it fades + slides on BOTH open (down) and close (up) instead
 * of unmounting instantly. A subtle per-group stagger reveals the content just after
 * the panel. One definition, consumed by the TopHeader avatar menu and NotificationBell
 * so the interaction language stays identical (no duplicated animation logic).
 *
 * Reduced motion: the global index.css rule collapses the durations to ~0, so
 * reduced-motion users get an instant, complete state.
 *
 * Accessibility: a closed panel is BOTH non-interactive (pointer-events-none via the
 * state class) AND non-focusable / AT-hidden — pass `inert` on the panel when closed
 * (`inert={open ? undefined : true}`), so keyboard tab order and screen readers skip it.
 */

// Panel container: matches "+ Create New" exactly (origin-top, 200ms ease-out).
export const DROPDOWN_PANEL = 'origin-top transition-all duration-200 ease-out';
export const dropdownPanelState = (open) =>
    (open ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none');

// Per-group content stagger: same easing/duration as the panel, revealed slightly
// after it. On close, the delay resets to 0 so every group fades out WITH the panel.
export const DROPDOWN_ITEM = 'transition-all duration-200 ease-out';
export const dropdownItemState = (open) =>
    (open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1');
export const dropdownItemDelay = (open, index, base = 50, step = 40) =>
    ({ transitionDelay: open ? `${base + index * step}ms` : '0ms' });
