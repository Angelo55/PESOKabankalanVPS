const { test } = require('node:test');
const assert = require('node:assert');
const { classifyDuplicates, titleSimilarity } = require('../services/duplicatePostingService');

const EXISTING = [
	{ id: 1, title: 'Sales Lady', company: 'Gaisano', location: 'Kabankalan', job_type: 'Full-Time', status: 'Open' },
];

test('exact duplicate: same title + employer + location + type', () => {
	const r = classifyDuplicates(
		{ title: 'Sales Lady!', company: 'gaisano', location: 'KABANKALAN', job_type: 'Full-Time' },
		EXISTING
	);
	assert.strictEqual(r.level, 'Exact Duplicate');
	assert.strictEqual(r.matches[0].job_id, 1);
});

test('high similarity: near-identical title + same employer, different location/type', () => {
	const r = classifyDuplicates(
		{ title: 'Sales Lady', company: 'Gaisano', location: 'Binalbagan', job_type: 'Part-Time' },
		EXISTING
	);
	assert.strictEqual(r.level, 'High Similarity');
});

test('possible duplicate: similar title + same location, different employer', () => {
	const r = classifyDuplicates(
		{ title: 'Sales Lady Cashier', company: 'Other Store', location: 'Kabankalan', job_type: 'Full-Time' },
		EXISTING
	);
	assert.strictEqual(r.level, 'Possible Duplicate');
});

test('no match: unrelated title clears the possible threshold', () => {
	const r = classifyDuplicates(
		{ title: 'Software Developer', company: 'TechCorp', location: 'Bacolod', job_type: 'Remote' },
		EXISTING
	);
	assert.strictEqual(r.level, null);
	assert.strictEqual(r.matches.length, 0);
});

test('never throws on empty inputs; identical empties are not flagged', () => {
	assert.deepStrictEqual(classifyDuplicates({}, []), { level: null, matches: [] });
	// An empty-title draft must not "exact match" another empty title (guarded by nTitle !== '').
	const r = classifyDuplicates({ title: '', company: 'X', location: 'Y', job_type: 'Z' },
		[{ id: 9, title: '', company: 'X', location: 'Y', job_type: 'Z', status: 'Open' }]);
	assert.strictEqual(r.level, null);
});

test('similarity ranks the closest existing posting first', () => {
	const r = classifyDuplicates(
		{ title: 'Delivery Driver', company: 'Gaisano', location: 'Kabankalan', job_type: 'Full-Time' },
		[
			{ id: 1, title: 'Delivery Driver', company: 'Gaisano', location: 'Kabankalan', job_type: 'Full-Time', status: 'Open' },
			{ id: 2, title: 'Delivery Driver Helper', company: 'Gaisano', location: 'Kabankalan', job_type: 'Full-Time', status: 'Open' },
		]
	);
	assert.strictEqual(r.matches[0].job_id, 1); // exact beats partial
	assert.strictEqual(r.level, 'Exact Duplicate');
});

test('titleSimilarity is order-insensitive and normalized', () => {
	assert.strictEqual(titleSimilarity('Sales Lady', 'lady sales'), 1);
	assert.ok(titleSimilarity('IT Help Desk', 'IT Support Desk') > 0.3);
});
