import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * Centralized theme state — the SINGLE owner of light/dark for the whole app.
 *
 * Before this, theme lived inside Sidebar.jsx, so the Super Admin portal (which uses
 * SuperAdminSidebar, not Sidebar) could neither toggle nor even APPLY a saved
 * preference. Mounting this provider at the app root fixes that: every shell —
 * job seeker, PESO admin, and Super Admin — shares one source of truth.
 *
 * The `.dark` class is applied to <html> before first paint by a tiny inline script
 * in index.html (no FOUC); this provider takes over and keeps it in sync.
 *
 * `toggle(event)` is the PREMIUM switch:
 *   - View Transitions API → a circular reveal wipes the new theme in from the
 *     toggle's position (hardware-accelerated, ~460ms).
 *   - No VT support → a 260ms colour cross-fade (index.css `.theme-transition`).
 *   - Reduced motion → an instant, honest swap (both effects are skipped, and the
 *     global reduced-motion catch-all zeroes any residual transition).
 */
const ThemeContext = createContext({ theme: 'light', isDark: false, toggle: () => {} });

const prefersReducedMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const getInitialTheme = () => {
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || saved === 'light') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
        return 'light';
    }
};

const applyThemeClass = (theme) => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem('theme', theme); } catch { /* private mode: DOM class still applied */ }
};

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(getInitialTheme);

    // Keep <html> and storage in step with state (covers the initial mount and any
    // external change). Idempotent with the imperative apply in the toggle below.
    useEffect(() => { applyThemeClass(theme); }, [theme]);

    const runTransition = (next, event) => {
        const root = document.documentElement;

        if (prefersReducedMotion()) {
            setTheme(next);
            return;
        }

        // No View Transitions support → colour cross-fade for one beat.
        if (typeof document.startViewTransition !== 'function') {
            root.classList.add('theme-transition');
            setTheme(next);
            window.setTimeout(() => root.classList.remove('theme-transition'), 320);
            return;
        }

        // View Transitions circular reveal from the toggle's position.
        const x = event?.clientX ?? window.innerWidth - 44;
        const y = event?.clientY ?? 44;

        const vt = document.startViewTransition(() => {
            // Apply synchronously inside the callback so the transition captures the
            // NEW theme; React state is updated in the same tick for consumers.
            applyThemeClass(next);
            setTheme(next);
        });

        vt.ready.then(() => {
            const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
                { duration: 460, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
            );
        }).catch(() => { /* a cancelled/unsupported transition already applied the theme */ });
    };

    const toggle = (event) => runTransition(theme === 'dark' ? 'light' : 'dark', event);

    return (
        <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggle }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
