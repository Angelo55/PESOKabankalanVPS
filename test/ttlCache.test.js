const { test } = require('node:test');
const assert = require('node:assert');
const { createTtlCache } = require('../utils/ttlCache');

/** Unit tests for the in-process TTL cache behind the board AI-match preview cache. */

test('ttlCache stores and returns a value; misses are undefined', () => {
	const c = createTtlCache({ ttlMs: 1000, max: 10 });
	assert.strictEqual(c.get('missing'), undefined);
	c.set('a', 42);
	assert.strictEqual(c.get('a'), 42);
});

test('ttlCache expires entries past their TTL', () => {
	const c = createTtlCache({ ttlMs: -1, max: 10 }); // every entry is immediately stale
	c.set('a', 1);
	assert.strictEqual(c.get('a'), undefined);
});

test('ttlCache evicts the oldest entry at capacity', () => {
	const c = createTtlCache({ ttlMs: 100000, max: 2 });
	c.set('a', 1);
	c.set('b', 2);
	c.set('c', 3); // over capacity → evicts 'a'
	assert.strictEqual(c.get('a'), undefined);
	assert.strictEqual(c.get('b'), 2);
	assert.strictEqual(c.get('c'), 3);
});
