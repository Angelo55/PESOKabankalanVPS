/**
 * THE HTTP CLIENT — every request to the backend goes through this instance.
 *
 * WHAT: a preconfigured axios instance with the API base URL and an interceptor
 * that attaches the bearer token to every outgoing request.
 *
 * WHY A SHARED INSTANCE: authentication is applied in exactly one place. A
 * component that used bare `fetch` or its own axios call would silently send an
 * unauthenticated request and get a confusing 401. Import this; never create a
 * second client.
 *
 * ── THE TOKEN ──────────────────────────────────────────────────────────────
 * Read from sessionStorage (tab-scoped — see AuthContext for why). The string
 * checks against 'undefined' and 'null' are not paranoia: a bad write stores
 * those as literal text, and `Authorization: Bearer undefined` produces a 401
 * that looks like an expired session rather than a client bug.
 *
 * Headers are spread into a NEW object rather than mutated. Mutating the shared
 * config object let Vite's hot reload drop headers between edits, which showed
 * up as requests randomly losing their authentication during development only.
 *
 * ── WHAT THIS CANNOT DO ────────────────────────────────────────────────────
 * An interceptor cannot attach a header to a plain `window.open()` or a bare
 * <a download>. Authenticated files — referral letters, ATS resumes, CSV
 * exports — are therefore fetched through this client as a blob and opened from
 * an object URL. That is why those download paths look more involved than a
 * simple link; they are not over-engineered.
 */

import axios from 'axios';

const API = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
    withCredentials: true,
    // Client-side timeout so a stalled request (dead network, hung upstream) rejects instead
    // of spinning forever — components already handle a rejected promise (error toast / retry).
    // 60s comfortably clears the slowest legitimate calls (AI scoring ~20s server timeout, PDF
    // render, résumé parse) while still bounding a truly stuck socket. Override per-call for any
    // long operation that needs longer.
    timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 60000
});

API.interceptors.request.use(
    (config) => {
        // Redundancy check ensures the token survives strict browser tab isolation
        const token = sessionStorage.getItem('jobTrackerToken') || localStorage.getItem('jobTrackerToken');
        
        if (token && token !== 'undefined' && token !== 'null') {
            // 🚨 SAFE DESTRUCTURING: Prevents Axios from dropping headers during Vite HMR reloads
            config.headers = {
                ...config.headers,
                Authorization: `Bearer ${token}`
            };
        }
        
        return config;
    },
    (error) => Promise.reject(error)
);

API.interceptors.response.use(
    (response) => response,
    (error) => {
        // 🚨 REMOVED: We no longer violently clear the session on random 401 data failures.
        // The components will handle the errors gracefully, stopping the infinite crash loops.

        // SUSPENSION KICK (item 4). requireAuth returns 403 { code:'ACCOUNT_SUSPENDED' }
        // on EVERY request from a now-suspended account, so an already-open session is
        // ended here: stash the notice, drop the token, and bounce to the landing page
        // where the auth modal shows the standardized suspension message. Guarded so it
        // fires once (not on the public landing, which makes no authed calls).
        const data = error.response?.data;
        const isLoginCall = (error.config?.url || '').includes('/auth/login');
        if (error.response?.status === 403 && data?.code === 'ACCOUNT_SUSPENDED' && !isLoginCall) {
            try {
                sessionStorage.setItem('pesoSuspensionNotice', JSON.stringify(data.suspension || {}));
                sessionStorage.removeItem('jobTrackerToken');
                localStorage.removeItem('jobTrackerToken');
            } catch (_) { /* storage may be unavailable */ }
            if (!window.location.pathname.match(/^\/(home)?$/) || !window.location.search.includes('suspended=1')) {
                window.location.assign('/?suspended=1');
            }
        }
        return Promise.reject(error);
    }
);

export default API;