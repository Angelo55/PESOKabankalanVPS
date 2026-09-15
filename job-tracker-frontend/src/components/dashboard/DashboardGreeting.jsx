import React, { useEffect, useState } from 'react';
import API from '../../api';
import welcomeHero from '../../assets/illustrations/welcome_hero.webp';
import hiredHero from '../../assets/illustrations/hired.webp';

/**
 * DashboardGreeting — a TEMPORARY, session-scoped welcome shown ABOVE the dashboard
 * heading. It replaces the old PERSISTENT "Welcome back" chip that used to live in
 * TopHeader (relocated per the owner's layout reference).
 *
 * Behaviour:
 *  • Appears ONCE per session on dashboard entry / login, then fades itself out
 *    after a short interval — it is NOT a permanent dashboard element.
 *  • Does NOT reappear on every in-dashboard navigation: a per-user sessionStorage
 *    flag (keyed by user id, so a different login in the same tab greets afresh)
 *    suppresses it for the rest of the session.
 *  • Uses the authenticated user's name DYNAMICALLY (works for any role — Job
 *    Seeker / PESO Admin / etc.); the name always matches the logged-in user.
 *  • HIRED celebration: if the seeker has a referral with a recorded placement
 *    outcome of 'Hired' (the system's authoritative "hired" signal — §0.14,
 *    surfaced by GET /referrals/mine), the greeting shows the celebratory
 *    `hired.webp` illustration + a congratulations message instead of the normal
 *    welcome. It is a MILESTONE shown ONCE EVER per user (a persistent
 *    localStorage flag, separate from the once-per-session normal welcome);
 *    after it has been celebrated the seeker gets the normal welcome again. The
 *    check is best-effort: any fetch failure falls back to the normal welcome.
 *  • The fade respects prefers-reduced-motion via the global reduced-motion rule
 *    (which forces transition-duration → ~0), so reduced-motion users get an
 *    instant, complete state rather than motion.
 *
 * Reads the name passed in + a client-side session flag; the ONE network read is
 * the best-effort /referrals/mine hired-status check (reuses the existing route,
 * no new backend/logic).
 */
const VISIBLE_MS = 7500; // how long it stays fully visible before fading
const FADE_MS = 600;     // fade-out duration (kept in sync with the transition below)

// DEV-ONLY toggle: show the greeting on EVERY dashboard mount (bypassing the
// once-per-session gate) so it's easy to preview while developing. It is guarded by
// `import.meta.env.DEV`, so it can NEVER activate in a production build. Enable it in
// the browser console with:  localStorage.setItem('pk_greeting_always','1')
// and disable with:          localStorage.removeItem('pk_greeting_always')
const alwaysShowInDev = () => {
    try {
        return import.meta.env.DEV && localStorage.getItem('pk_greeting_always') === '1';
    } catch { return false; }
};

// DEV-ONLY: force the HIRED celebration variant so it can be previewed without a real
// 'Hired' referral outcome. Guarded by `import.meta.env.DEV` (never fires in prod).
// Enable in the console with:  localStorage.setItem('pk_greeting_force_hired','1')
// (also forces the greeting to show, and skips the /referrals/mine check.)
const forceHiredInDev = () => {
    try {
        return import.meta.env.DEV && localStorage.getItem('pk_greeting_force_hired') === '1';
    } catch { return false; }
};

const DashboardGreeting = ({ name, userId }) => {
    const first = (name || '').trim().split(/\s+/)[0];
    // 'pending' → deciding · 'in' → visible · 'out' → fading · 'done' → unmounted.
    const [phase, setPhase] = useState('pending');
    const [hired, setHired] = useState(false);
    const [hiredJob, setHiredJob] = useState(null); // { title, company } of the placement

    useEffect(() => {
        const forceHired = forceHiredInDev();           // dev preview of the hired variant
        const forceShow = alwaysShowInDev() || forceHired;
        const sessionKey = `pk_dash_greeted:${userId ?? 'anon'}`;
        // Hired milestone RESETS per placement: `seenKey` stores the referral ids already
        // celebrated, so a NEW 'Hired' referral (a new id) triggers a fresh celebration for
        // that exact position. (The old single-boolean `pk_dash_hired_celebrated:*` key is
        // retired; a leftover value is simply ignored.) We must fetch first to detect a new
        // placement, so the normal-welcome session gate is applied AFTER the fetch.

        const seenKey = `pk_dash_hired_seen:${userId ?? 'anon'}`;

        let alive = true;
        const timers = [];
        (async () => {
            // The seeker's referrals; a placement is outcome === 'Hired' (§0.14). Each hired
            // referral carries the exact job_title + company from the PESO admin's referral/
            // application data. Best-effort: any failure falls through to the normal welcome.
            let hiredRefs = [];
            if (!forceHired) {
                try {
                    const res = await API.get('/referrals/mine');
                    const list = Array.isArray(res.data?.data) ? res.data.data
                        : (Array.isArray(res.data) ? res.data : []);
                    hiredRefs = list.filter((r) => String(r?.outcome || '').toLowerCase() === 'hired');
                } catch { /* keep the normal welcome */ }
            }
            if (!alive) return;

            // Which placements has this user already been congratulated for?
            let seen = [];
            try { const raw = localStorage.getItem(seenKey); const p = raw ? JSON.parse(raw) : []; if (Array.isArray(p)) seen = p; } catch { /* private mode */ }

            let showHired = false;
            let job = null;
            if (forceHired) {
                showHired = true;
                job = hiredRefs[0]
                    ? { title: hiredRefs[0].job_title, company: hiredRefs[0].company_name }
                    : { title: 'Administrative Assistant', company: 'Kabankalan City Employer' };
            } else {
                // A NEW placement = a hired referral whose id isn't in the seen set.
                const fresh = hiredRefs.filter((r) => r?.id != null && !seen.includes(r.id));
                if (fresh.length) {
                    const latest = fresh.slice().sort((a, b) => new Date(b.outcome_at || 0) - new Date(a.outcome_at || 0))[0];
                    showHired = true;
                    job = { title: latest.job_title, company: latest.company_name };
                }
            }

            if (!forceShow) {
                if (showHired) {
                    // Congratulate this placement ONCE: record every current hired id so it
                    // won't repeat, while a FUTURE new placement (new id) celebrates again.
                    // Also set the session gate so the normal welcome doesn't also fire.
                    try {
                        const ids = hiredRefs.map((r) => r?.id).filter((x) => x != null);
                        localStorage.setItem(seenKey, JSON.stringify(Array.from(new Set([...seen, ...ids]))));
                    } catch { /* ignore */ }
                    try { sessionStorage.setItem(sessionKey, '1'); } catch { /* ignore */ }
                } else {
                    // Normal welcome: once per session.
                    let sessionSeen = false;
                    try { sessionSeen = !!sessionStorage.getItem(sessionKey); } catch { /* private mode */ }
                    if (sessionSeen) { setPhase('done'); return; }
                    try { sessionStorage.setItem(sessionKey, '1'); } catch { /* ignore */ }
                }
            }

            setHiredJob(job);
            setHired(showHired);
            setPhase('in');
            timers.push(setTimeout(() => { if (alive) setPhase('out'); }, VISIBLE_MS));
            timers.push(setTimeout(() => { if (alive) setPhase('done'); }, VISIBLE_MS + FADE_MS));
        })();

        return () => { alive = false; timers.forEach(clearTimeout); };
    }, [userId]);

    if (phase === 'pending' || phase === 'done') return null;

    // Two variants share the same box model / fade; only the artwork, palette and copy differ.
    const v = hired
        ? {
            img: hiredHero,
            surface: 'from-emerald-100/80 to-white/60 dark:from-emerald-900/30 dark:to-gray-800/60',
            kicker: 'Congratulations',
            kickerCls: 'text-emerald-600 dark:text-emerald-400',
            title: first ? `You're hired, ${first}! 🎉` : "You're hired! 🎉",
            sub: 'Congratulations on your placement through PESO Kabankalan — all the best in your new role!',
        }
        : {
            img: welcomeHero,
            surface: 'from-accent-soft/80 to-white/60 dark:from-gray-800/80 dark:to-gray-800/60',
            kicker: 'Welcome back',
            kickerCls: 'text-accent-text/80',
            title: first ? `Hello, ${first}! 👋` : 'Hello! 👋',
            sub: "Here's what's happening in your PESO dashboard today.",
        };

    return (
        <div
            role="status"
            aria-live="polite"
            style={{ transitionDuration: `${FADE_MS}ms` }}
            className={`mb-6 sm:mb-8 overflow-hidden rounded-[2rem] border border-white/60 dark:border-line bg-gradient-to-br ${v.surface} backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-opacity ease-out ${phase === 'out' ? 'opacity-0' : 'opacity-100 animate-slide-up-fade motion-reduce:animate-none'}`}
        >
            <div className="flex items-center gap-4 sm:gap-6 p-5 sm:p-7">
                <img
                    src={v.img}
                    alt=""
                    aria-hidden="true"
                    className="w-20 h-20 sm:w-28 sm:h-28 lg:w-32 lg:h-32 object-contain shrink-0"
                    width="128" height="128" decoding="async"
                />
                <div className="min-w-0">
                    <p className={`text-[11px] sm:text-xs font-black uppercase tracking-wider ${v.kickerCls}`}>{v.kicker}</p>
                    <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-accent-text dark:text-white tracking-tight truncate">
                        {v.title}
                    </h2>
                    {/* The exact position + employer they were placed for — from the referral data,
                        so the seeker immediately sees WHAT they were hired for and for WHICH vacancy. */}
                    {hired && (hiredJob?.title || hiredJob?.company) && (
                        <p className="mt-1.5 text-sm sm:text-base font-black text-emerald-700 dark:text-emerald-300 truncate">
                            {[hiredJob.title, hiredJob.company].filter(Boolean).join(' · ')}
                        </p>
                    )}
                    <p className="text-sm text-muted font-medium mt-1">{v.sub}</p>
                </div>
            </div>
        </div>
    );
};

export default DashboardGreeting;
