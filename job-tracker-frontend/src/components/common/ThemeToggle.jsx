import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

/**
 * The global light/dark control. Lives in the TopHeader (desktop) and the Sidebar
 * mobile bar / Super Admin header, so it is reachable from every shell.
 *
 * The icon MORPHS rather than swaps: sun and moon are stacked, and the outgoing one
 * rotates + scales out while the incoming one rotates + scales in (~300ms). The heavy
 * lifting of the theme change (circular reveal / cross-fade) is owned by ThemeContext;
 * this is just the trigger + its micro-interaction. Styled entirely in semantic tokens.
 */
const ThemeToggle = ({ className = '' }) => {
    const { isDark, toggle } = useTheme();
    return (
        <button
            type="button"
            onClick={(e) => toggle(e)}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`relative inline-flex items-center justify-center w-10 h-10 rounded-xl border border-line bg-surface text-muted hover:text-accent-text hover:-translate-y-0.5 transition-all duration-200 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
        >
            <Sun
                size={18}
                className={`absolute transition-all duration-300 ease-out ${isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`}
            />
            <Moon
                size={18}
                className={`absolute transition-all duration-300 ease-out ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`}
            />
        </button>
    );
};

export default ThemeToggle;
