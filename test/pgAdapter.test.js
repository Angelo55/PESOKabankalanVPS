/**
 * Guards the mysql2 → pg SQL translation in dbPgAdapter.js (Postgres re-platform
 * experiment). Pure string/param transforms — no database connection. Keeps the
 * shim faithful to mysql2 semantics so the ~533 unchanged call sites keep working
 * when DB_CLIENT=postgres.
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildPgQuery, convertPlaceholders, translateMysqlToPg } = require('../dbPgAdapter');

test('scalar placeholders map to $1..$n in order', () => {
	const { text, values } = buildPgQuery(
		'SELECT * FROM users WHERE id = ? AND role = ?',
		[5, 'admin'],
	);
	assert.strictEqual(text, 'SELECT * FROM users WHERE id = $1 AND role = $2');
	assert.deepStrictEqual(values, [5, 'admin']);
});

test('IN (?) array param expands with correct offset numbering', () => {
	const { text, values } = buildPgQuery('UPDATE t SET a=? WHERE id IN (?)', ['x', [1, 2, 3]]);
	assert.strictEqual(text, 'UPDATE t SET a=$1 WHERE id IN ($2, $3, $4)');
	assert.deepStrictEqual(values, ['x', 1, 2, 3]);
});

test('array before scalar keeps sequential numbering', () => {
	const { text, values } = buildPgQuery(
		'SELECT * FROM t WHERE status IN (?) AND owner=?',
		[['Applied', 'Under Review'], 9],
	);
	assert.strictEqual(text, 'SELECT * FROM t WHERE status IN ($1, $2) AND owner=$3');
	assert.deepStrictEqual(values, ['Applied', 'Under Review', 9]);
});

test('empty IN (?) renders NULL (matches nothing, like mysql2)', () => {
	const { text, values } = buildPgQuery('SELECT * FROM t WHERE id IN (?)', [[]]);
	assert.strictEqual(text, 'SELECT * FROM t WHERE id IN (NULL)');
	assert.deepStrictEqual(values, []);
});

test('? inside a string literal is not treated as a placeholder', () => {
	const { text, values } = buildPgQuery("SELECT '?' AS lit FROM t WHERE y=?", [42]);
	assert.strictEqual(text, "SELECT '?' AS lit FROM t WHERE y=$1");
	assert.deepStrictEqual(values, [42]);
});

test('non-array params are tolerated (wrapped)', () => {
	const { text, values } = buildPgQuery('SELECT ?', 7);
	assert.strictEqual(text, 'SELECT $1');
	assert.deepStrictEqual(values, [7]);
});

test('convertPlaceholders matches buildPgQuery for scalar-only SQL', () => {
	assert.strictEqual(
		convertPlaceholders('a=? AND b=?'),
		'a=$1 AND b=$2',
	);
});

// --- MySQL → Postgres dialect translation ---------------------------------

test('ON DUPLICATE KEY UPDATE → ON CONFLICT (targets) DO UPDATE SET, VALUES()→EXCLUDED', () => {
	const out = translateMysqlToPg(
		'INSERT INTO conversation_states (user_id, conversation_id, is_muted) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_muted = VALUES(is_muted)',
	);
	assert.match(out, /ON CONFLICT \(user_id, conversation_id\) DO UPDATE SET is_muted = EXCLUDED\.is_muted/);
});

test('LAST_INSERT_ID(id) idempotent upsert maps to <table>.id', () => {
	const out = translateMysqlToPg(
		'INSERT INTO email_outbox (dedupe_key) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
	);
	assert.match(out, /ON CONFLICT \(dedupe_key\) DO UPDATE SET id = email_outbox\.id/);
});

test('proactive_match_jobs re-enqueue upsert maps to ON CONFLICT (job_id) (not stripped)', () => {
	// Regression: this table has UNIQUE(job_id); a missing CONFLICT_TARGETS entry
	// would strip the clause to a plain INSERT and re-enqueue would raise 23505.
	const out = translateMysqlToPg(
		"INSERT INTO proactive_match_jobs (job_id, status) VALUES (?, 'pending') ON DUPLICATE KEY UPDATE status = 'pending', attempts = 0",
	);
	assert.match(out, /ON CONFLICT \(job_id\) DO UPDATE SET status = 'pending', attempts = 0/);
});

test('ON DUPLICATE KEY on a table with no unique key is stripped (plain INSERT)', () => {
	const out = translateMysqlToPg(
		'INSERT INTO userprofiles (user_id, ai_profile_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE ai_profile_data = VALUES(ai_profile_data)',
	);
	assert.doesNotMatch(out, /ON CONFLICT|ON DUPLICATE/i);
	assert.match(out, /VALUES \(\?, \?\)\s*$/);
});

test('INSERT IGNORE → ON CONFLICT (targets) DO NOTHING', () => {
	const out = translateMysqlToPg('INSERT IGNORE INTO job_alerts_sent (user_id, job_id) VALUES (?, ?)');
	assert.match(out, /^INSERT INTO job_alerts_sent .* ON CONFLICT \(user_id, job_id\) DO NOTHING$/);
});

test('DATE_ADD/DATE_SUB → interval arithmetic (? left arg cast)', () => {
	assert.match(
		translateMysqlToPg('DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)'),
		/\(CURRENT_TIMESTAMP \+ \(\(\?\) \* INTERVAL '1 second'\)\)/,
	);
	// Bare interval outside DATE_ADD/SUB (e.g. rolling-window filters).
	assert.strictEqual(
		translateMysqlToPg('created_at >= (NOW() - INTERVAL 1 DAY)'),
		"created_at >= (NOW() - ((1) * INTERVAL '1 day'))",
	);
	assert.match(
		translateMysqlToPg('created_at < DATE_ADD(?, INTERVAL 1 DAY)'),
		/\(\?::timestamptz \+ \(\(1\) \* INTERVAL '1 day'\)\)/,
	);
});

test('DATE_FORMAT/TIMESTAMPDIFF/CURDATE/IFNULL/RAND/boolean literals', () => {
	assert.match(translateMysqlToPg("DATE_FORMAT(x, '%Y-%m')"), /to_char\(x, 'YYYY-MM'\)/);
	assert.match(translateMysqlToPg('TIMESTAMPDIFF(MINUTE, MIN(created_at), NOW())'), /EXTRACT\(EPOCH FROM \(\(NOW\(\)\) - \(MIN\(created_at\)\)\)\) \/ 60/);
	assert.match(translateMysqlToPg('TIMESTAMPDIFF(YEAR, u.dob, CURDATE())'), /EXTRACT\(YEAR FROM age\(CURRENT_DATE, u\.dob\)\)::int/);
	assert.strictEqual(translateMysqlToPg('IFNULL(a, 0)'), 'COALESCE(a, 0)');
	assert.strictEqual(translateMysqlToPg('ORDER BY RAND()'), 'ORDER BY RANDOM()');
	assert.strictEqual(translateMysqlToPg('is_read = FALSE AND muted = TRUE'), 'is_read = 0 AND muted = 1');
});

test('untyped `? IS [NOT] NULL` gets a ::text cast so Postgres can infer the type', () => {
	// The nullable-filter idiom: the null-test placeholder is cast, the value
	// placeholder (bound to the same param) keeps its column-derived type.
	assert.strictEqual(
		translateMysqlToPg('WHERE (? IS NULL OR created_at >= ?)'),
		'WHERE (?::text IS NULL OR created_at >= ?)',
	);
	assert.strictEqual(translateMysqlToPg('AND ? IS NOT NULL'), 'AND ?::text IS NOT NULL');
	// A column null-test is untouched (only bare `?` placeholders are cast).
	assert.strictEqual(translateMysqlToPg('WHERE deleted_at IS NULL'), 'WHERE deleted_at IS NULL');
});
