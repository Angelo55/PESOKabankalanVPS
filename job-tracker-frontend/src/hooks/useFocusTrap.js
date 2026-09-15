import { useEffect, useRef } from 'react';

/**
 * useFocusTrap — accessible modal focus management (WCAG 2.4.3, audit C1).
 *
 * When `active`:
 *   1. remembers the element that had focus when the modal opened (the opener),
 *   2. moves focus INTO the modal (first focusable, else the container itself),
 *   3. keeps Tab / Shift+Tab cycling WITHIN the modal (focus trap),
 *   4. on close/unmount, restores focus to the opener.
 *
 * Esc / backdrop close stay the caller's job — this only manages focus. Attach the
 * returned ref to the modal's content container and give that container
 * role="dialog" aria-modal="true" tabIndex={-1}:
 *
 *   const trapRef = useFocusTrap(true);
 *   <div ref={trapRef} role="dialog" aria-modal="true" tabIndex={-1}> … </div>
 */
export default function useFocusTrap(active = true) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!active) return undefined;
        const container = containerRef.current;
        if (!container) return undefined;

        const opener = document.activeElement;
        const SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        // Visible, focusable descendants in DOM order (offsetParent is null for
        // display:none / detached nodes).
        const focusables = () => Array.from(container.querySelectorAll(SELECTOR))
            .filter((el) => el.offsetParent !== null || el === document.activeElement);

        // Move focus in SYNCHRONOUSLY (not via requestAnimationFrame — rAF is paused
        // while the page/tab is hidden, which would leave focus outside the dialog).
        // Prefer the first interactive control; fall back to the container (marked
        // tabIndex={-1}). Focusing the role="dialog" container is also good SR behaviour
        // — it announces the dialog before Tab reaches the controls.
        (focusables()[0] || container).focus?.();

        const onKeyDown = (e) => {
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) { e.preventDefault(); container.focus?.(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            const activeEl = document.activeElement;
            if (e.shiftKey && (activeEl === first || activeEl === container)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && activeEl === last) {
                e.preventDefault();
                first.focus();
            }
        };
        container.addEventListener('keydown', onKeyDown);

        return () => {
            container.removeEventListener('keydown', onKeyDown);
            // Restore focus to the opener if it is still in the document.
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
                opener.focus();
            }
        };
    }, [active]);

    return containerRef;
}
