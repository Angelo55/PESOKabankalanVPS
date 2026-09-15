/**
 * Shared pagination parsing for list endpoints (Phase 1).
 *
 * Turns `?page=&limit=` into a clamped { limit, page, offset } so a malformed or
 * hostile query string can never ask for the whole table, a negative page, or a
 * limit large enough to be a denial-of-service. `page` is 1-based (what the UI
 * shows); `offset` is derived for the SQL. Mirrors the bounds adminAuditService
 * already used, extracted so every paginated list clamps identically.
 */
function getPageParams(query = {}, { defaultLimit = 10, maxLimit = 100 } = {}) {
	const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
	const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
	return { limit, page, offset: (page - 1) * limit };
}

module.exports = { getPageParams };
