import { useEffect, useState } from 'react';

/**
 * Shared read-side of the sidebar's collapse state.
 *
 * Sidebar.jsx and AdminSidebar.jsx each own their own toggle and persist the
 * choice to localStorage['sidebarCollapsed'] so it survives navigation. That is
 * enough for the sidebars themselves, but NOT for anything else on the page:
 * the browser's native `storage` event only fires in OTHER tabs, so a toggle
 * never notifies same-tab listeners. Hence the custom event below — the
 * sidebars publish through `publishSidebarCollapsed`, and every consumer
 * (currently the layout shells) re-renders in step with the animation.
 */
const KEY = 'sidebarCollapsed';
export const SIDEBAR_COLLAPSE_EVENT = 'sidebar-collapse-change';

export const readSidebarCollapsed = () => {
    try {
        return localStorage.getItem(KEY) === 'true';
    } catch (e) {
        return false; // private-mode / storage-disabled: default to expanded
    }
};

/** Persist AND broadcast. Sidebars call this instead of setItem directly. */
export const publishSidebarCollapsed = (collapsed) => {
    try {
        localStorage.setItem(KEY, collapsed ? 'true' : 'false');
    } catch (e) {
        /* non-fatal: the UI still updates via the event below */
    }
    window.dispatchEvent(new CustomEvent(SIDEBAR_COLLAPSE_EVENT, { detail: { collapsed } }));
};

export default function useSidebarCollapsed() {
    const [collapsed, setCollapsed] = useState(readSidebarCollapsed);

    useEffect(() => {
        const onToggle = (e) => setCollapsed(!!e.detail?.collapsed);
        const onStorage = (e) => { if (e.key === KEY) setCollapsed(e.newValue === 'true'); };

        window.addEventListener(SIDEBAR_COLLAPSE_EVENT, onToggle);
        window.addEventListener('storage', onStorage); // keeps other tabs in sync
        return () => {
            window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, onToggle);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    return collapsed;
}
