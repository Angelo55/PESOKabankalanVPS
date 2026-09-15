/**
 * APPLICATION BOOTSTRAP — the map of the whole backend.
 *
 * WHAT THIS FILE DOES, in order:
 *   1. middleware (CORS, JSON body parsing, cookies, static /uploads)
 *   2. mounts every router under /api  — the table of contents below
 *   3. starts socket.io for realtime chat and notification push
 *   4. starts the in-process referral worker
 *   5. listens (default port 5000)
 *
 * READ THIS FIRST when tracing a request: find the mount, open that route file,
 * follow it into a service, then into a repository. Routes handle HTTP,
 * services hold business rules and transactions, repositories hold SQL. SQL in
 * a route file is a review-blocking smell.
 *
 * ── ROUTE MAP ──────────────────────────────────────────────────────────────
 *   /api/auth           registration + OTP verification, login, Google, resets
 *   /api/profile        job seeker profile, avatars, AI resume analysis
 *   /api/job-board      PUBLIC vacancy list/detail + landing-page statistics
 *   /api/jobs           authenticated job-seeker interactions
 *   /api/applications   apply: snapshot + AI score + referral staging + notify
 *   /api/peso-admin     vacancies, ATS, applicant statuses  (+ /api/employer,
 *                       a deprecated alias kept for older clients)
 *   /api/referrals      approve/reject/void/retry, letters, outcomes, reports,
 *                       audit trail
 *   /api/notifications  the bell: list, unread count, mark read
 *   /api/messages       applicant <-> administrator chat (REST half)
 *   /api/resume /api/cover-letter /api/resignation   AI builders + PDF output
 *   /api/saved-jobs /api/tracked-jobs                bookmarking, imports
 *   /api/analytics /api/admin                        dashboards, super admin
 *   /api/chatbot        site assistant (authenticated job-seeker)
 *   /api/public-assistant  PUBLIC visitor-support chatbot (no auth; public data + tools)
 *   /api/trash /api/preferences                      soft delete, UI settings
 *
 * ── TWO THINGS WORTH KNOWING ───────────────────────────────────────────────
 * /uploads IS PUBLIC. express.static serves it with no authentication, so
 * nothing containing personal data may be written there. Referral letters and
 * resumes live in the database and are served through authenticated routes.
 *
 * THE WORKER RUNS IN THIS PROCESS. There is no separate queue service: the
 * deployment is a single instance, and adding a broker would add a component
 * that can fail independently for no benefit at this scale. The database is the
 * queue — durability comes from the transactional outbox in referral_jobs, not
 * from the worker staying alive. If the process dies mid-delivery, the next boot
 * reclaims the row and resumes at the step that had not committed.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

// Shared abuse-protection limiters (middleware/rateLimiters.js). The global one is the
// app-wide backstop; tighter per-category limiters are attached inside the expensive routes.
const { globalLimiter } = require('./middleware/rateLimiters');

// HTTP and Socket.IO for Real-Time Messaging
const http = require('http');
const { Server } = require('socket.io');

// Importing this file executes the database connection and schema setup
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Behind ONE proxy in production (Render / Vercel front the app). Without this, `req.ip`
// is the proxy's address, so EVERY express-rate-limit limiter keys on a single global
// bucket (e.g. 5 failed logins from anyone would lock out login for everyone) and the auth
// [AUDIT] log records the proxy IP. Trusting the first hop makes `req.ip` the real client
// IP, so limits are per-visitor. `1` (not `true`) trusts exactly one hop — express-rate-limit
// accepts it and it is not the permissive setting its validator warns about. Cookies are
// unaffected (their `secure` flag is gated on NODE_ENV, not `req.secure`).
app.set('trust proxy', 1);

// Allowed browser origins for CORS + the socket handshake. Localhost stays for
// dev; PRODUCTION origins come from env (CORS_ORIGINS as a comma-separated list,
// or a single FRONTEND_URL) so the deploy config — not a code edit — controls
// who may call the API and open a socket. This is what lets the Vercel frontend
// reach the Render backend cross-origin; without it the socket (and every
// browser request) is CORS-rejected in production.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];
const ENV_ORIGINS = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
	.split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...DEV_ORIGINS, ...ENV_ORIGINS])];

// Wrap Express with HTTP Server & Initialize Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: ALLOWED_ORIGINS,
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE']
	}
});

// Expose 'io' globally so application routes can trigger real-time updates
app.set('io', io);

// Pass the io instance to our isolated socket handler
require('./socketServer')(io);

// The six outbox workers (§18.1) are wired in ONE shared module so this web
// entrypoint and the dedicated worker.js entrypoint can never drift (SKILL §25).
const { startAllWorkers, stopAllWorkers } = require('./startWorkers');
const { verifyMailTransport } = require('./services/mailService');

verifyMailTransport();

// WORKER_MODE gates who owns the background workers, so the worker-process split
// (SKILL §25) is a one-flag deploy — with the current single-service deploy
// UNCHANGED because the flag is unset:
//   unset / 'all'  → this web process runs the workers IN-PROCESS (today's behaviour)
//   'web'          → this web process runs the API ONLY; a separate `node worker.js`
//                    Render Background Worker service owns the workers
// (server.js never runs as the worker; worker.js is that entrypoint.)
const RUN_WORKERS = process.env.WORKER_MODE !== 'web';
if (RUN_WORKERS) {
	startAllWorkers(io);
} else {
	console.log('[Server] WORKER_MODE=web — background workers run in the dedicated worker process (worker.js), not here.');
}

process.on('SIGINT', () => { if (RUN_WORKERS) stopAllWorkers(); process.exit(0); });
process.on('SIGTERM', () => { if (RUN_WORKERS) stopAllWorkers(); process.exit(0); });

// =======================================================
// MIDDLEWARE  --  MUST come BEFORE any route mounts.
// CORS first, so it can answer preflight (OPTIONS) requests
// before auth middleware ever runs.
// =======================================================
const corsOptions = {
	origin: ALLOWED_ORIGINS,
	credentials: true
};
app.use(cors(corsOptions));
app.options('/*splat', cors(corsOptions)); // explicit preflight; '/*splat' replaces the invalid '*'

// Security headers. CSP is DISABLED here on purpose: this process serves JSON + the public
// /uploads images, never the app HTML (that's Vercel, which owns its own CSP), so a CSP here
// would only risk breaking image loads for no gain. `crossOriginResourcePolicy: cross-origin`
// is REQUIRED so the Vercel frontend can load /uploads images cross-origin (helmet's default
// `same-origin` would block them); COEP stays off for the same reason.
app.use(helmet({
	contentSecurityPolicy: false,
	crossOriginResourcePolicy: { policy: 'cross-origin' },
	crossOriginEmbedderPolicy: false,
}));

app.use(cookieParser());
// Body-size cap. The largest legitimate JSON payload is a base64 upload — an event banner
// (≤3MB), or a certificate / apply résumé snapshot (a ≤5MB file ≈ ~6.7MB base64). 15mb leaves
// comfortable headroom while cutting the old blanket 50mb DoS surface ~3x. FILE uploads go
// through multer (each with its own per-route fileSize limit), NOT this JSON parser.
// Env-overridable (`BODY_LIMIT`) so a future larger payload can be raised without a code change.
const BODY_LIMIT = process.env.BODY_LIMIT || '15mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// App-wide rate-limit backstop across the whole /api surface (health + preflight exempt).
// Tighter per-category limiters (AI, apply, uploads/writes) are attached inside the routes
// that need them; this catches anything not individually capped so no entry point is unbounded.
app.use('/api', globalLimiter);

// Per-route latency capture (p95/max/avg) → GET /admin/timing. Negligible overhead;
// gives real before/after baselines for the performance work without an external APM.
const { requestTiming } = require('./middleware/requestTiming');
app.use(requestTiming);

// =======================================================
// ROUTES  --  all mounted AFTER the middleware above.
// =======================================================
const pesoAdminRoutes = require('./routes/pesoAdminRoutes');

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/applications', require('./routes/applicationRoutes'));
app.use('/api/chatbot', require('./routes/chatbotRoutes'));
app.use('/api/public-assistant', require('./routes/publicAssistantRoutes')); // PUBLIC (no auth) visitor chatbot
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/saved-jobs', require('./routes/savedJobRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/resume', require('./routes/resumeRoutes'));
app.use('/api/resignation', require('./routes/resignationRoutes'));
app.use('/api/jobs', require('./routes/jobRoutes'));
app.use('/api/cover-letter', require('./routes/coverLetterRoutes'));
app.use('/api/tracked-jobs', require('./routes/trackedJobRoutes'));
app.use('/api/job-board', require('./routes/jobBoardRoutes'));
app.use('/api/peso-admin', pesoAdminRoutes);
app.use('/api/employer', pesoAdminRoutes); // deprecated alias -- remove after the frontend fully uses /api/peso-admin
app.use('/api/referrals', require('./routes/referralRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/trash', require('./routes/trashRoutes'));
app.use('/api/preferences', require('./routes/preferenceRoutes'));
app.use('/api/job-alerts', require('./routes/jobAlertRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/config', require('./routes/configRoutes'));
app.use('/api/usage', require('./routes/usageRoutes'));

// Health Check Route
app.get('/api/health', (req, res) => {
	res.status(200).json({
		status: 'success',
		message: 'Backend server is running smoothly!'
	});
});

// Start the HTTP `server` (not the Express `app`) so Sockets work.
server.listen(PORT, () => {
	console.log(`Server & Socket.IO running securely on http://localhost:${PORT}`);
	// Storage driver visibility (matches the worker boot-log pattern). In production this
	// MUST read `r2` with r2Configured=true, or uploaded images fall back to the ephemeral
	// local disk and vanish on the next deploy. See docs/cloud-storage-proposal.md.
	const st = require('./services/storageService').getStatus();
	console.log(`[Storage] driver=${st.driver}${st.driver === 'r2' ? ` (r2Configured=${st.r2Configured}, base=${st.publicBase || 'UNSET'})` : ''}`);
});


