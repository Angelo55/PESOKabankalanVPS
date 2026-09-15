/**
 * Lightweight request-timing middleware + in-memory rolling stats.
 *
 * WHY: to capture REAL per-route latency (p95/max/avg) and surface slow requests
 * without adding an external APM. Zero dependencies, negligible overhead (one
 * hrtime read + a bounded ring buffer per route). Exposed via GET /admin/timing so
 * before/after optimisation baselines are measurable, the same discipline the
 * scoring eval harness gave us.
 *
 * Routes are grouped by method + a normalised path (numeric ids → :id) so
 * /peso-admin/ats/applications/123/status and .../456/status aggregate into one row.
 * Stats are per-process and reset on restart — fine for spotting hotspots.
 */

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 1000;
const MAX_SAMPLES = 200; // per-route ring buffer used for the p95

const stats = new Map(); // key -> { count, sum, max, samples: number[] }

function routeKey(req) {
	const path = String(req.originalUrl || req.url || '').split('?')[0];
	const norm = path.replace(/\/\d+(?=\/|$)/g, '/:id');
	return `${req.method} ${norm}`;
}

function record(key, ms) {
	let s = stats.get(key);
	if (!s) { s = { count: 0, sum: 0, max: 0, samples: [] }; stats.set(key, s); }
	s.count += 1;
	s.sum += ms;
	if (ms > s.max) s.max = ms;
	s.samples.push(ms);
	if (s.samples.length > MAX_SAMPLES) s.samples.shift();
}

function percentile(arr, p) {
	if (!arr.length) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return Math.round(sorted[idx]);
}

function requestTiming(req, res, next) {
	const start = process.hrtime.bigint();
	res.on('finish', () => {
		const ms = Number(process.hrtime.bigint() - start) / 1e6;
		record(routeKey(req), ms);
		if (ms >= SLOW_MS) {
			console.warn(`[SLOW ${Math.round(ms)}ms] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
		}
	});
	next();
}

/** Per-route summary, slowest (by p95) first — for GET /admin/timing. */
function getTimingSummary() {
	const routes = [];
	for (const [route, s] of stats) {
		routes.push({
			route,
			count: s.count,
			avgMs: Math.round(s.sum / s.count),
			p95Ms: percentile(s.samples, 95),
			maxMs: Math.round(s.max),
		});
	}
	routes.sort((a, b) => b.p95Ms - a.p95Ms);
	return { slowThresholdMs: SLOW_MS, sampledPerRoute: MAX_SAMPLES, routes };
}

function resetTimingStats() { stats.clear(); }

module.exports = { requestTiming, getTimingSummary, resetTimingStats };
