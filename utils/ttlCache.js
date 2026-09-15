/**
 * Minimal in-process TTL cache. Per-instance and lost on restart — which is fine for
 * cacheable ESTIMATES (e.g. the board's AI match preview), not for anything that must
 * be durable. No dependencies; O(1) get/set; a crude size cap evicts the oldest entry.
 *
 * Safe for the match-score cache specifically because scoring is now temperature 0
 * (deterministic): the same (user, job) yields the same score, so a cached value is a
 * correct value until the résumé/job changes — bounded by the TTL.
 */
function createTtlCache({ ttlMs = 600000, max = 1000 } = {}) {
	const store = new Map(); // key -> { value, expires }

	function get(key) {
		const e = store.get(key);
		if (!e) return undefined;
		if (Date.now() > e.expires) { store.delete(key); return undefined; }
		return e.value;
	}

	function set(key, value) {
		if (store.size >= max && !store.has(key)) {
			const oldest = store.keys().next().value; // insertion order
			if (oldest !== undefined) store.delete(oldest);
		}
		store.set(key, { value, expires: Date.now() + ttlMs });
	}

	function del(key) { store.delete(key); }

	/** Delete every entry whose key starts with `prefix`. Returns the count removed.
	 * Used to invalidate all of one user's cached estimates (e.g. board match scores)
	 * when their résumé changes, so a stale preview can't outlive the input it scored. */
	function delByPrefix(prefix) {
		let removed = 0;
		for (const k of [...store.keys()]) {
			if (k.startsWith(prefix)) { store.delete(k); removed += 1; }
		}
		return removed;
	}

	return { get, set, del, delByPrefix, size: () => store.size };
}

module.exports = { createTtlCache };
