import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User as UserIcon, Settings, LogOut, ChevronDown, Home } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import Avatar from '../common/Avatar';
import NotificationBell from './NotificationBell';
import ThemeToggle from '../common/ThemeToggle';
import { normalizeRole, ROLE_KEYS } from '../../utils/roles';
import { DROPDOWN_PANEL, dropdownPanelState, DROPDOWN_ITEM, dropdownItemState, dropdownItemDelay } from './dropdownMotion';

/**
 * Persistent top bar for the job-seeker and PESO-admin shells. Holds the
 * notification bell and the profile avatar menu (Profile / Account Settings /
 * Logout). Rendered by AppLayout so it appears above every protected route. The
 * sidebar keeps the PESO branding; this bar deliberately carries no logo.
 *
 * The bar itself is `hidden md:flex` because the Sidebar renders its own
 * `md:hidden` mobile bar. It still MOUNTS on mobile (hidden is CSS-only), which
 * is what keeps `markVisitedLink` running on every route change regardless of
 * screen size. The bell now lives in <NotificationBell>, mounted here for
 * desktop and in the Sidebar's mobile bar for phones — see that component's
 * header for why it was extracted.
 *
 * The "Welcome back" chip that used to live here was RELOCATED to a temporary
 * session greeting above the dashboard heading (Dashboard.jsx) — the header now
 * carries controls only. The avatar menu opens on hover (desktop) as well as
 * click; see the hover-intent note below.
 */

// Hover-to-open is enabled only on genuine hover + fine-pointer devices (desktop),
// so a touch device never gets a phantom hover — click stays the interaction there.
// This header is `hidden md:flex` anyway, but the capability check keeps it correct
// on touch tablets at desktop widths (UI addendum §7 — capability, not breakpoint).
const hoverCapable = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Hover timing — 100% identical to the "+ Create New" menu: open IMMEDIATELY on enter,
// close after a short grace delay so moving toward/into the panel doesn't dismiss it.
const HOVER_CLOSE_MS = 180;

const TopHeader = () => {
    const { user, logout } = useAuth();
    const { markVisitedLink } = useNotification();
    const navigate = useNavigate();
    const location = useLocation();

    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);
    const hoverTimer = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [menuOpen]);

    // Clear any pending hover timer on unmount.
    useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

    // Visiting a module auto-acknowledges the notifications that point at it.
    useEffect(() => {
        markVisitedLink(location.pathname);
    }, [location.pathname, markVisitedLink]);

    const go = (path) => { setMenuOpen(false); navigate(path); };

    // The "Profile" item must resolve to the SAME authoritative profile module the
    // sidebar links to, per role — otherwise a PESO Administrator was sent to the
    // applicant-only `/profile` route (which their ProtectedRoute bounces away). PESO
    // Admin → the Organization Profile (`/peso-admin/profile`, the sidebar's target);
    // Job Seeker → their personal `/profile`. PESO Staff has no profile surface
    // (Manager-only, server-enforced), so the item is hidden for them; Super Admin
    // never mounts this header. Role is read through normalizeRole (never a raw string).
    const role = normalizeRole(user?.role);
    const profile = role === ROLE_KEYS.PESO_ADMINISTRATOR
        ? { path: '/peso-admin/profile', label: 'Organization Profile' }
        : role === ROLE_KEYS.JOB_SEEKER
            ? { path: '/profile', label: 'Profile' }
            : null;

    // Hover intent: open immediately on enter; close after a short grace period on
    // leave so moving the cursor across the gap into the menu doesn't dismiss it.
    // Both handlers sit on the wrapper (button + menu), so hovering either keeps it open.
    const onMenuEnter = () => {
        if (!hoverCapable()) return;
        clearTimeout(hoverTimer.current);
        setMenuOpen(true); // open immediately, like "+ Create New"
    };
    const onMenuLeave = () => {
        if (!hoverCapable()) return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setMenuOpen(false), HOVER_CLOSE_MS);
    };

    return (
        <header className="hidden md:flex sticky top-0 z-30 items-center justify-end gap-2 px-4 sm:px-6 h-16 bg-raised/70 backdrop-blur-md border-b border-line/60">
            {/* Global user controls live together in the Top Header: home, theme,
                notifications, account. The sidebar is navigation-only. */}
            {/* Home takes any authenticated role to the public landing page WITHOUT
                logging out; the landing page offers a "Back to Dashboard" return. */}
            <button
                onClick={() => go('/home')}
                title="Go to Home / Landing page"
                aria-label="Go to Home page"
                className="flex items-center gap-1.5 px-3 h-9 rounded-2xl bg-surface/70 border border-line/60 text-muted hover:text-content hover:bg-sunken shadow-card transition-all"
            >
                <Home size={17} />
                <span className="hidden lg:inline text-sm font-semibold">Home</span>
            </button>
            <ThemeToggle />
            <NotificationBell variant="panel" />

            <div className="relative" ref={menuRef} onMouseEnter={onMenuEnter} onMouseLeave={onMenuLeave}>
                <button
                    onClick={() => setMenuOpen(o => !o)}
                    className="flex items-center gap-2 pl-1 pr-2.5 py-1 bg-surface/70 rounded-2xl shadow-card border border-line/60 hover:-translate-y-0.5 transition-all duration-300"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                >
                    <Avatar user={user} size={36} rounded="rounded-xl" />
                    <span className="hidden sm:flex flex-col items-start leading-tight max-w-[140px]">
                        <span className="text-sm font-bold text-content truncate w-full">{user?.name || 'My Account'}</span>
                        <span className="text-[11px] font-medium text-muted truncate w-full capitalize">{user?.role || 'Job Seeker'}</span>
                    </span>
                    <ChevronDown size={16} className={`text-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Always mounted; opens/closes with the shared fade+slide motion (matches the
                    "+ Create New" menu) so it animates OUT as well as in. `inert` when closed
                    keeps keyboard/AT out of the hidden menu. Items stagger in after the panel.
                    POSITION + SIZE are relative to the profile trigger CONTAINER, not the name.
                    Because the panel is `absolute` inside this `relative` wrapper (which is sized
                    by the trigger button), `right-0` aligns its right edge to the trigger and
                    `min-w-full` makes it AT LEAST the trigger's width — so it reads as attached to
                    the profile box and its width tracks that container as the trigger grows/shrinks
                    (the trigger's own name is capped at max-w-[140px]). `w-max` only guarantees the
                    menu labels fit; `max-w-[min(20rem,calc(100vw-1.5rem))]` clamps to the viewport
                    so it never overflows on small screens. The header name + email both `truncate`
                    (`w-0 min-w-full` → they contribute 0 to the intrinsic width but fill and
                    ellipsize to the container-driven width), so a short OR long name never makes
                    the dropdown look disproportionate or detached. */}
                <div
                    role="menu"
                    inert={menuOpen ? undefined : true}
                    className={`absolute right-0 mt-2 min-w-full w-max max-w-[min(20rem,calc(100vw-1.5rem))] bg-raised rounded-2xl shadow-raised border border-line overflow-hidden z-50 ${DROPDOWN_PANEL} ${dropdownPanelState(menuOpen)}`}
                >
                    <div style={dropdownItemDelay(menuOpen, 0)} className={`px-4 py-3 border-b border-line ${DROPDOWN_ITEM} ${dropdownItemState(menuOpen)}`}>
                        <p className="text-sm font-bold text-content truncate w-0 min-w-full">{user?.name || 'My Account'}</p>
                        <p className="text-xs text-muted truncate w-0 min-w-full">{user?.email || ''}</p>
                    </div>
                    {profile && (
                        <button role="menuitem" onClick={() => go(profile.path)} style={dropdownItemDelay(menuOpen, 1)} className={`w-full text-left px-4 py-3 hover:bg-sunken font-semibold text-content flex items-center gap-3 text-sm ${DROPDOWN_ITEM} ${dropdownItemState(menuOpen)}`}>
                            <UserIcon size={17} className="text-indigo-500" /> {profile.label}
                        </button>
                    )}
                    <button role="menuitem" onClick={() => go('/settings')} style={dropdownItemDelay(menuOpen, 2)} className={`w-full text-left px-4 py-3 hover:bg-sunken font-semibold text-content flex items-center gap-3 text-sm ${DROPDOWN_ITEM} ${dropdownItemState(menuOpen)}`}>
                        <Settings size={17} className="text-muted" /> Account Settings
                    </button>
                    <button role="menuitem" onClick={() => { setMenuOpen(false); logout(); }} style={dropdownItemDelay(menuOpen, 3)} className={`w-full text-left px-4 py-3 hover:bg-rose-50 dark:hover:bg-rose-900/20 font-semibold text-rose-500 flex items-center gap-3 text-sm border-t border-line ${DROPDOWN_ITEM} ${dropdownItemState(menuOpen)}`}>
                        <LogOut size={17} /> Logout
                    </button>
                </div>
            </div>
        </header>
    );
};

export default TopHeader;
