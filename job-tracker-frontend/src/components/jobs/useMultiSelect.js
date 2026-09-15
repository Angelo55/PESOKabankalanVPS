import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Shared multi-select behaviour for Saved Vacancies and My Applications.
 *
 * TWO ENTRY POINTS, ONE STATE MACHINE:
 *   - Desktop: checkboxes are always available; ticking one enters select mode.
 *   - Touch:   a long-press (500ms) enters select mode and selects that card;
 *              subsequent taps toggle further cards.
 *
 * Why long-press is bound here rather than per page: the gesture needs a
 * movement threshold (a scroll must NOT be read as a press) and a shared timer,
 * and getting that subtly wrong on one page only is exactly the kind of drift
 * this hook exists to prevent.
 *
 * Selection is keyed by the row id the API expects, so callers pass the same id
 * they will later send to /api/trash.
 */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10; // finger drift above this = scroll, not a press

export default function useMultiSelect(allIds = []) {
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());

    // Long-press bookkeeping. Refs (not state) so the timer callbacks never
    // capture stale values and never trigger a re-render mid-gesture.
    const timerRef = useRef(null);
    const startRef = useRef({ x: 0, y: 0 });
    const firedRef = useRef(false);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const toggle = useCallback((id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            // Leaving select mode when the last item is deselected keeps the UI
            // from stranding the user in an empty selection toolbar.
            if (next.size === 0) setSelectMode(false);
            return next;
        });
    }, []);

    const enterWith = useCallback((id) => {
        setSelectMode(true);
        setSelected(new Set([id]));
    }, []);

    const clear = useCallback(() => {
        setSelected(new Set());
        setSelectMode(false);
    }, []);

    const selectAll = useCallback(() => {
        setSelectMode(true);
        setSelected(new Set(allIds));
    }, [allIds]);

    const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));

    const toggleAll = useCallback(() => {
        if (allSelected) clear(); else selectAll();
    }, [allSelected, clear, selectAll]);

    /**
     * Spread onto a card. Returns touch handlers only — mouse users get
     * checkboxes, so binding mouse long-press would just make text selection
     * feel broken.
     */
    const longPressProps = useCallback((id) => ({
        onTouchStart: (e) => {
            if (selectMode) return; // already selecting: plain taps toggle
            const t = e.touches?.[0];
            startRef.current = { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
            firedRef.current = false;
            clearTimer();
            timerRef.current = setTimeout(() => {
                firedRef.current = true;
                enterWith(id);
                // Haptic confirmation where supported — the gesture has no
                // visual affordance until it fires, so the buzz IS the feedback.
                if (navigator.vibrate) navigator.vibrate(35);
            }, LONG_PRESS_MS);
        },
        onTouchMove: (e) => {
            const t = e.touches?.[0];
            if (!t) return;
            const dx = Math.abs(t.clientX - startRef.current.x);
            const dy = Math.abs(t.clientY - startRef.current.y);
            if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) clearTimer();
        },
        onTouchEnd: () => clearTimer(),
        onTouchCancel: () => clearTimer(),
    }), [selectMode, enterWith]);

    /** True when the just-finished gesture was a long-press, so the card's own
     *  click/open handler can bail out instead of navigating. */
    const consumedLongPress = useCallback(() => {
        if (firedRef.current) { firedRef.current = false; return true; }
        return false;
    }, []);

    return useMemo(() => ({
        selectMode,
        selected,
        count: selected.size,
        ids: Array.from(selected),
        isSelected: (id) => selected.has(id),
        toggle,
        enterWith,
        clear,
        selectAll,
        toggleAll,
        allSelected,
        setSelectMode,
        longPressProps,
        consumedLongPress,
    }), [selectMode, selected, toggle, enterWith, clear, selectAll, toggleAll, allSelected, longPressProps, consumedLongPress]);
}
