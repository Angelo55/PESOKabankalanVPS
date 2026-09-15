/**
 * NOTIFICATION BELL — the single bell implementation, used by every shell.
 *
 * WHY IT LIVES HERE AND NOT INSIDE TopHeader: TopHeader is `hidden md:flex`, so
 * on a phone the bell and its unread badge disappeared entirely — office staff
 * working from mobile could not see new applications or referral alerts at all.
 * The fix is not to unhide TopHeader (the Sidebar already renders its own
 * `md:hidden` mobile bar, so that would produce two stacked headers) but to make
 * the bell a component both bars mount. Only one is ever visible at a time.
 *
 * Behaviour: opens on CLICK, and ALSO on HOVER on desktop (hover + fine pointer
 * only — a touch device never gets a phantom hover, so tap/click stays the
 * interaction there; UI addendum §7). Splits into New / Earlier, marks read on
 * click, and closes on outside-click, Escape, or (for hover) a short leave delay.
 * The panel keeps its slide-down entrance (`animate-in slide-in-from-top-2`).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bell, CheckCheck, Users, MessageSquare, FileCheck2, Sparkles,
    Briefcase, Search, Inbox, CalendarDays, Lock, ShieldCheck,
} from 'lucide-react';
import { useNotification } from '../../context/NotificationContext';
import { DROPDOWN_PANEL, dropdownPanelState, DROPDOWN_ITEM, dropdownItemState, dropdownItemDelay } from './dropdownMotion';

// Source + visual identity per notification type. `source` names the module the
// notification deep-links to, so every entry reads "what happened, where".
export const TYPE_META = {
    NEW_APPLICATION:    { icon: Users,         source: 'Applicant Pipeline', classes: 'bg-indigo-500/15 text-indigo-500' },
    AI_RECOMMENDATION:  { icon: Sparkles,      source: 'AI Recommended',     classes: 'bg-violet-500/15 text-violet-500' },
    NEW_MESSAGE:        { icon: MessageSquare, source: 'Communications',     classes: 'bg-sky-500/15 text-sky-500' },
    REFERRAL_ISSUED:    { icon: FileCheck2,    source: 'My Referrals',       classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    REFERRAL_UPDATE:    { icon: FileCheck2,    source: 'Referral Register',  classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    REFERRAL_OUTCOME:   { icon: FileCheck2,    source: 'Referral outcome',   classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    REFERRAL_ENDORSEMENT: { icon: FileCheck2,  source: 'My Referrals',       classes: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
    REFERRAL_WITHDRAWN: { icon: FileCheck2,    source: 'My Referrals',       classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    ACCOUNT_SUSPENDED:  { icon: Lock,          source: 'Account status',     classes: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
    ACCOUNT_REACTIVATED:{ icon: ShieldCheck,   source: 'Account status',     classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    NEW_JOB:            { icon: Search,        source: 'Public Job Board',   classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    APPLICATION_STATUS: { icon: Briefcase,     source: 'PESO Applications',  classes: 'bg-teal-500/15 text-teal-600 dark:text-teal-400' },
    APPLICATION_DECLINED: { icon: Briefcase,   source: 'PESO Applications',  classes: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
    EVENT_ANNOUNCEMENT: { icon: CalendarDays,  source: 'PESO Events',        classes: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400' },
};
const DEFAULT_META = { icon: Bell, source: 'Platform', classes: 'bg-gray-500/15 text-muted' };

// Hover-to-open only on genuine hover + fine-pointer devices (desktop); touch keeps
// tap/click (capability, not breakpoint — UI addendum §7).
const hoverCapable = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Hover timing — 100% identical to the "+ Create New" menu: open IMMEDIATELY on enter,
// close after a short grace delay so moving toward/into the panel doesn't dismiss it.
const HOVER_CLOSE_MS = 180;

/**
 * Relative time for a notification's created_at.
 *
 * INPUT CONTRACT: an ISO-8601 UTC string (…Z). Both sources satisfy this — the
 * REST payload serialises a correctly-parsed Date, and the socket payload sends
 * `new Date().toISOString()`. `new Date(iso)` then yields the right instant in
 * ANY client timezone, so no manual offset maths is needed or wanted here.
 *
 * Timestamps that parse in the FUTURE (small clock skew between the server and
 * the user's machine) are clamped to "Just now" rather than rendering something
 * nonsensical like "-3m ago".
 */
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
const MONTH = 2592000; // 30d — display-only granularity, not calendar-exact

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

export const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return '';

    const secs = Math.floor((Date.now() - then) / 1000);
    if (secs < 10) return 'Just now';          // also covers negative (clock skew)
    if (secs < MINUTE) return plural(secs, 'second');
    if (secs < HOUR) return plural(Math.floor(secs / MINUTE), 'minute');
    if (secs < DAY) return plural(Math.floor(secs / HOUR), 'hour');

    const days = Math.floor(secs / DAY);
    if (days === 1) return 'Yesterday';
    if (secs < WEEK) return plural(days, 'day');
    if (secs < MONTH) return plural(Math.floor(secs / WEEK), 'week');

    const months = Math.floor(secs / MONTH);
    if (months < 12) return plural(months, 'month');
    return plural(Math.floor(months / 12), 'year');
};

const NotificationItem = ({ item, onOpen }) => {
    const meta = TYPE_META[item.type] || DEFAULT_META;
    const Icon = meta.icon;
    const unread = !item.is_read;

    return (
        <button
            onClick={() => onOpen(item)}
            className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-sunken ${unread ? 'bg-accent-soft/50' : ''}`}
        >
            <span className={`shrink-0 mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center ${meta.classes}`}>
                <Icon size={17} />
            </span>
            <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                    <span className={`text-sm truncate ${unread ? 'font-bold text-content' : 'font-semibold text-muted'}`}>
                        {item.title}
                    </span>
                    {unread && <span className="shrink-0 w-2 h-2 rounded-full bg-accent-text" aria-label="Unread" />}
                </span>
                {item.body && (
                    <span className="block text-xs text-muted mt-0.5 leading-relaxed line-clamp-2">{item.body}</span>
                )}
                <span className="block text-[11px] font-semibold text-subtle mt-1">
                    {meta.source} · {timeAgo(item.created_at)}
                </span>
            </span>
        </button>
    );
};

/**
 * @param {'panel'|'bare'} variant  'panel' = the raised pill used in TopHeader;
 *                                  'bare'  = a flat icon button for the mobile bar.
 */
const NotificationBell = ({ variant = 'panel' }) => {
    const { notifications, unreadNotifCount, markNotificationRead, markAllNotificationsRead } = useNotification();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const hoverTimer = useRef(null);

    // Clear any pending hover timer on unmount.
    useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

    // Hover intent: a brief open delay (no accidental pop on brush-past) and a longer
    // close delay so the cursor can cross the gap into the panel without it dismissing.
    // Handlers sit on the wrapper (button + panel), so hovering either keeps it open.
    const onHoverEnter = () => {
        if (!hoverCapable()) return;
        clearTimeout(hoverTimer.current);
        setOpen(true); // open immediately, like "+ Create New"
    };
    const onHoverLeave = () => {
        if (!hoverCapable()) return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
    };

    // Relative times are computed at render, so an open panel would otherwise
    // freeze at whatever it said when it opened ("Just now" forever). A 30s tick
    // re-renders only WHILE the panel is open — no timer runs the rest of the
    // time, and 30s is fine granularity for a scale whose smallest step is 10s.
    const [, setNowTick] = useState(0);
    useEffect(() => {
        if (!open) return;
        const id = setInterval(() => setNowTick(t => t + 1), 30000);
        return () => clearInterval(id);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const openNotification = (item) => {
        if (!item.is_read) markNotificationRead(item.id);
        setOpen(false);
        if (item.link) navigate(item.link);
    };

    const fresh = notifications.filter(n => !n.is_read);
    const earlier = notifications.filter(n => n.is_read);

    const buttonCls = variant === 'panel'
        ? "relative p-2.5 text-muted hover:text-accent-text bg-surface/70 rounded-2xl shadow-card border border-line/60 hover:-translate-y-0.5 transition-all duration-300"
        : "relative p-2 text-muted hover:bg-sunken rounded-lg transition-colors bg-transparent border-none cursor-pointer";

    return (
        <div className="relative" ref={ref} onMouseEnter={onHoverEnter} onMouseLeave={onHoverLeave}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-label={`Notifications${unreadNotifCount > 0 ? ` (${unreadNotifCount} unread)` : ''}`}
                aria-haspopup="true"
                aria-expanded={open}
                className={buttonCls}
            >
                <Bell size={variant === 'panel' ? 20 : 22} />
                {unreadNotifCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-black min-w-[18px] h-[18px] flex items-center justify-center rounded-full ring-2 ring-surface px-1">
                        {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                )}
            </button>

            {/* Always mounted; opens/closes with the shared fade+slide motion (matches the
                "+ Create New" menu) so it animates OUT as well as in. `inert` when closed keeps
                keyboard/AT out. Width is clamped so it can't overflow a narrow phone screen. */}
            <div
                inert={open ? undefined : true}
                className={`absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] sm:w-96 bg-raised rounded-2xl shadow-raised border border-line overflow-hidden z-[60] ${DROPDOWN_PANEL} ${dropdownPanelState(open)}`}
            >
                    <div style={dropdownItemDelay(open, 0)} className={`flex items-center justify-between px-4 py-3 border-b border-line ${DROPDOWN_ITEM} ${dropdownItemState(open)}`}>
                        <p className="text-sm font-bold text-content">Notifications</p>
                        {unreadNotifCount > 0 && (
                            <button
                                onClick={markAllNotificationsRead}
                                className="flex items-center gap-1.5 text-xs font-bold text-accent-text hover:opacity-70 transition-opacity"
                            >
                                <CheckCheck size={14} /> Mark all as read
                            </button>
                        )}
                    </div>

                    <div style={dropdownItemDelay(open, 1)} className={`max-h-[26rem] overflow-y-auto ${DROPDOWN_ITEM} ${dropdownItemState(open)}`}>
                        {notifications.length === 0 ? (
                            <div className="px-4 py-10 text-center">
                                <Inbox size={28} className="mx-auto text-subtle" />
                                <p className="text-sm font-bold text-muted mt-3">You're all caught up</p>
                                <p className="text-xs text-subtle mt-1">New activity will appear here.</p>
                            </div>
                        ) : (
                            <>
                                {fresh.length > 0 && (
                                    <>
                                        <p className="px-4 pt-3 pb-1 text-[11px] font-black uppercase tracking-wider text-subtle">New</p>
                                        {fresh.map(item => <NotificationItem key={item.id} item={item} onOpen={openNotification} />)}
                                    </>
                                )}
                                {earlier.length > 0 && (
                                    <>
                                        <p className="px-4 pt-3 pb-1 text-[11px] font-black uppercase tracking-wider text-subtle border-t border-line">Earlier</p>
                                        {earlier.map(item => <NotificationItem key={item.id} item={item} onOpen={openNotification} />)}
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    <button
                        onClick={() => { setOpen(false); navigate('/notifications'); }}
                        style={dropdownItemDelay(open, 2)}
                        className={`w-full px-4 py-3 text-center text-xs font-bold text-accent-text border-t border-line hover:bg-sunken ${DROPDOWN_ITEM} ${dropdownItemState(open)}`}
                    >
                        See all &amp; settings
                    </button>
                </div>
        </div>
    );
};

export default NotificationBell;
