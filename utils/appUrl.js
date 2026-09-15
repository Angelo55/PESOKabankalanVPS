/**
 * appUrl — the public FRONTEND base URL for links placed in emails and SMS.
 *
 * WHY: notification links must point at the DEPLOYED frontend in production and at the
 * local dev server in development, without hardcoding either. Resolution mirrors the
 * CORS config in server.js: FRONTEND_URL, else the first CORS_ORIGINS entry, else the
 * Vite dev default. Env-driven — no code edit to change the base per environment.
 *
 * These links NEVER carry a token or auto-authenticate: they are plain app routes, so
 * the app's ProtectedRoute + the server-side guards still enforce a valid session before
 * any referral/account data is shown (a logged-out click lands on the sign-in flow).
 */
function frontendBaseUrl() {
	const fromEnv = process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',')[0];
	return String(fromEnv || 'http://localhost:5173').trim().replace(/\/$/, '');
}

/** Absolute app URL for a path, e.g. appUrl('/referrals'). Defaults to the site root. */
function appUrl(path = '/') {
	const p = !path ? '/' : (path.startsWith('/') ? path : `/${path}`);
	return `${frontendBaseUrl()}${p}`;
}

module.exports = { appUrl, frontendBaseUrl };
