/**
 * Shared board AI-match-score cache (G3.3).
 *
 * The Public Job Board's compatibility PREVIEW (`POST /api/jobs/match`) is a cacheable
 * estimate: scoring is temperature 0 (deterministic), so a cached (user, job) score is
 * correct UNTIL the résumé or job changes — bounded by the TTL.
 *
 * This lives in its own module (was a local cache inside jobRoutes) so the résumé-change
 * sites (resume builder save / résumé upload / apply-time overwrite) can INVALIDATE a
 * user's cached previews immediately, instead of letting a stale preview linger for the
 * full TTL. That was the divergence behind "seeker saw 75% on the board, admin saw 30%
 * in the pipeline": the board preview was a cached score for an OLDER résumé, while the
 * committed application score was computed against the résumé actually applied with. The
 * committed score is unchanged; this only keeps the PREVIEW honest.
 */
const { createTtlCache } = require('../utils/ttlCache');

const cache = createTtlCache({ ttlMs: Number(process.env.MATCH_CACHE_TTL_MS) || 600000, max: 2000 });

const keyFor = (userId, jobId) => `${userId}:${jobId}`;

module.exports = {
	get: (userId, jobId) => cache.get(keyFor(userId, jobId)),
	set: (userId, jobId, value) => cache.set(keyFor(userId, jobId), value),
	/** Invalidate ALL of one user's cached board previews (their résumé changed). */
	invalidateUser: (userId) => (userId == null ? 0 : cache.delByPrefix(`${userId}:`)),
};
