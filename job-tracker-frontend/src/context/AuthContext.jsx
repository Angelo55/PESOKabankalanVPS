/**
 * AUTHENTICATION CONTEXT — who is signed in, everywhere in the app.
 *
 * WHAT: holds the current `user` object (id, name, email, role, permissions,
 * avatar) and the helpers that change it. `useAuth()` is how any component asks
 * "who is this?".
 *
 * WHEN: mounted once at the root. It runs on every full page load to rehydrate
 * the session before the first render that depends on a role.
 *
 * ── HOW A SESSION STARTS, THREE WAYS ───────────────────────────────────────
 *   1. Sign-in / Google popup — the API response contains both the token and
 *      the full user object, and the session is seeded straight from it.
 *   2. Google redirect — the token arrives as an `?auth_token=` query
 *      parameter. It is stored, then stripped from the URL with
 *      history.replaceState so a bearer token is never left in the address bar,
 *      in browser history, or in a screenshot.
 *   3. Page refresh — the stored token is exchanged at /auth/me.
 *
 * ── WHY sessionStorage AND NOT localStorage ────────────────────────────────
 * sessionStorage is scoped to the tab and cleared when it closes. That suits a
 * municipal employment office where citizens use shared public terminals: the
 * next person to open the browser does not inherit the previous person's
 * session. localStorage would survive indefinitely across users of that machine.
 *
 * ── WHY THE LOGIN RESPONSE MUST CARRY THE AVATAR ───────────────────────────
 * The session is seeded from the sign-in payload and does NOT re-fetch
 * /auth/me afterwards. When the avatar was missing from that payload, the top
 * header showed a placeholder until the next full refresh. /login, /auth/me and
 * /google must therefore all return the SAME user shape.
 *
 * ── updateUser() IS WHAT MAKES AVATARS PROPAGATE ───────────────────────────
 * Every <Avatar> in the app reads from this context. Changing a profile picture
 * calls updateUser(), and the header, chat, ATS and profile all update in the
 * same tick with no refetch and no page refresh.
 *
 * SECURITY NOTE: `role` here decides what is DISPLAYED. It never decides what is
 * ALLOWED — every protected endpoint re-checks the role and the record's owner
 * server-side. A tampered client can change its own menu, nothing more.
 */

import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import API from '../api';
import { setFeatureFlags } from '../utils/featureFlags';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    // Runtime feature flags resolved by the backend (DB row → env → default). Used
    // to render optional surfaces only when the server will honour them, so a
    // dark-shipped feature stays hidden until an administrator flips it on. Defaults
    // to all-off; refreshed whenever a session is established.
    const [features, setFeatures] = useState({ referralLifecycleSync: false });
    // Post-registration onboarding / account-completion gate (JOB SEEKERS only). Derived
    // server-side from the profile + résumé (GET /profile/onboarding), so it can't be
    // bypassed by refresh/logout; `onboarding.canApply` gates the Apply action. Null until
    // loaded. `onboardingOpen` drives the shared OnboardingModal (mounted in AppLayout),
    // openable from anywhere (e.g. a gated Apply button).
    const [onboarding, setOnboarding] = useState(null);
    const [onboardingOpen, setOnboardingOpen] = useState(false);

    useEffect(() => {
        let isMounted = true; 
        
        // 1. OAuth Callback Interceptor
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('auth_token');
        
        if (urlToken) {
            // 🚨 ISOLATION FIX: Store OAuth tokens strictly in tab-scoped sessionStorage
            sessionStorage.setItem('jobTrackerToken', urlToken);
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 2. Session Rehydration Logic
        const verifySession = async () => {
            // 🚨 ISOLATION FIX: Read exclusively from sessionStorage. Eradicated localStorage fallback.
            const token = sessionStorage.getItem('jobTrackerToken');
            
            if (!token || token === 'undefined' || token === 'null') {
                if (isMounted) setLoading(false);
                return;
            }

            try {
                // Hydrate user context and role data
                const response = await API.get('/auth/me');
                if (isMounted && response.data.status === 'success') {
                    setUser(response.data.user);
                }
            } catch (error) {
                // Purge invalid/expired session data
                if (isMounted) {
                    setUser(null); 
                    sessionStorage.removeItem('jobTrackerToken');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        verifySession();
        return () => { isMounted = false; };
    }, []);

    // Load runtime feature flags once a session exists (covers all three login
    // paths: they all end with `user` becoming set). Non-blocking and fail-safe —
    // a failure just leaves every optional surface hidden.
    useEffect(() => {
        if (!user) { setFeatures({ referralLifecycleSync: false }); setFeatureFlags({}); return; }
        let active = true;
        API.get('/config/features')
            .then((res) => {
                if (active && res.data?.data) { setFeatures(res.data.data); setFeatureFlags(res.data.data); }
            })
            .catch(() => { /* keep defaults (all-off) */ });
        return () => { active = false; };
    }, [user]);

    // 3. Manual Authentication Mutator
    const login = (userData, token) => {
        if (token) {
            // 🚨 ISOLATION FIX: Persist token to sessionStorage only
            sessionStorage.setItem('jobTrackerToken', token);
        }
        setUser(userData);
    };

    // 3b. Partial user updater — merges changed fields into the shared user so
    // header-bound data (avatar, name) reflects profile edits instantly, with no
    // page refresh. Ignored when there is no active session.
    const updateUser = (partial) => {
        if (!partial || typeof partial !== 'object') return;
        setUser(prev => (prev ? { ...prev, ...partial } : prev));
    };

    // 3b-ii. Re-pull the AUTHORITATIVE user from the server (/auth/me) and reseed the
    // session. Used after an OAuth callback (account link/unlink) so the Connected state
    // is derived from the backend record, never from an optimistic local flip. No-op
    // without a session.
    const refreshUser = useCallback(async () => {
        const token = sessionStorage.getItem('jobTrackerToken');
        if (!token) return null;
        try {
            const res = await API.get('/auth/me');
            if (res.data?.status === 'success' && res.data.user) { setUser(res.data.user); return res.data.user; }
        } catch (_) { /* keep the current user on a transient failure */ }
        return null;
    }, []);

    // 3c. Refresh the account-completion state for the current job seeker (no-op for
    // other roles / no session). Call after login and after any profile/résumé change so
    // the Apply gate and onboarding UI reflect reality immediately. Returns the new state.
    const refreshOnboarding = useCallback(async () => {
        const token = sessionStorage.getItem('jobTrackerToken');
        if (!token) { setOnboarding(null); return null; }
        try {
            const res = await API.get('/profile/onboarding');
            if (res.data?.data) { setOnboarding(res.data.data); return res.data.data; }
        } catch (_) { /* keep prior state — the server re-checks at apply time anyway */ }
        return null;
    }, []);

    const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
    const closeOnboarding = useCallback(() => setOnboardingOpen(false), []);

    // Load the onboarding/completion state once a JOB-SEEKER session exists (other roles
    // have no application gate). Cleared on logout / role change. Declared AFTER
    // refreshOnboarding so it is never referenced inside its temporal dead zone.
    useEffect(() => {
        if (user && normalizeRole(user.role) === ROLE_KEYS.JOB_SEEKER) {
            refreshOnboarding();
        } else {
            setOnboarding(null);
            setOnboardingOpen(false);
        }
    }, [user, refreshOnboarding]);

    // 4. Session Termination
    const logout = async () => {
        try { 
            await API.post('/auth/logout'); 
        } catch (error) {
            console.warn("Backend logout synchronization failed, but local session will be destroyed.");
        } finally {
            setUser(null);
            // 🚨 ISOLATION FIX: Replaced destructive .clear() with targeted removal 
            // to protect unrelated tab-scoped session data.
            sessionStorage.removeItem('jobTrackerToken'); 
            
            // Failsafe: Eradicate any legacy localStorage tokens left over from before the patch
            localStorage.removeItem('jobTrackerToken'); 
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading, updateUser, refreshUser, features, onboarding, refreshOnboarding, onboardingOpen, openOnboarding, closeOnboarding }}>
            {children}
        </AuthContext.Provider>
    );
};