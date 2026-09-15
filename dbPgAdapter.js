/**
 * PostgreSQL adapter — a mysql2/promise-compatible facade over `pg`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The entire backend was written against a `mysql2/promise` pool (TiDB): ~533
 * call sites do `const [rows] = await pool.query(sql, params)` with `?`
 * placeholders, and ~13 files open transactions via
 * `pool.getConnection()` → `beginTransaction/commit/rollback/release`.
 *
 * The Supabase (Postgres) re-platform experiment (branch
 * `experiment/postgres-supabase`) must run that SAME code unchanged. Hand-porting
 * every call site to the `pg` idiom (`$1` placeholders, `{ rows }` result shape,
 * `client.release()`) would be ~500 mechanical, error-prone edits. Instead this
 * adapter presents pg through the mysql2 shape the code already speaks, so the
 * ONLY remaining work is the genuinely dialect-specific SQL (upserts, enums,
 * `information_schema`, MySQL date functions) — not the plumbing.
 *
 * This file is loaded ONLY when `DB_CLIENT=postgres` (see db.js). On the default
 * `mysql` path it is never required, so production (Render → TiDB) is untouched.
 *
 * ── WHAT IT TRANSLATES ──────────────────────────────────────────────────────
 *  • Placeholders: bareword `?` → `$1,$2,…` (positional), skipping quoted
 *    strings so a literal `?` inside a string is left alone.
 *  • Result shape: mysql2 returns `[rows, fields]` for SELECT and
 *    `[ResultSetHeader, undefined]` (with `.insertId`/`.affectedRows`) for
 *    writes. pg returns `{ rows, rowCount, command }`. We rebuild the mysql2
 *    tuple so existing destructuring (`const [rows] = …`, `const [result] = …`)
 *    keeps working.
 *  • insertId: pg has no `LAST_INSERT_ID()`. For an INSERT with no explicit
 *    RETURNING we append `RETURNING id` and surface `rows[0].id` as `insertId`.
 *    Tables without an `id` column (composite-PK: conversation_states,
 *    referral_preferences, system_settings…) raise 42703 (undefined_column);
 *    we transparently retry WITHOUT the RETURNING (nothing was inserted on the
 *    failed parse, so the retry is safe) and return insertId 0.
 *  • Transactions: `getConnection()` yields a client wrapper whose
 *    `beginTransaction/commit/rollback` map to `BEGIN/COMMIT/ROLLBACK` and
 *    `release()` maps to pg's `client.release()`.
 *
 * ── WHAT IT DOES NOT DO (handled as SQL rewrites in the dialect pass) ────────
 *  • `ON DUPLICATE KEY UPDATE` → `ON CONFLICT … DO UPDATE`
 *  • `INSERT IGNORE`           → `ON CONFLICT DO NOTHING`
 *  • `LIMIT ?, ?` (offset,limit) → `LIMIT ? OFFSET ?` (order differs; the code
 *    already uses the OFFSET form almost everywhere)
 *  • `information_schema` enum checks, `_tidb_rowid`, `GROUP_CONCAT`, `IFNULL`,
 *    `CURDATE()`, `DATE_SUB(… INTERVAL …)`, backtick identifiers — rewritten in
 *    the source SQL so the change is explicit and reviewable.
 *
 * ── ONE mysql2 CONVENIENCE IT DOES REPLICATE: `IN (?)` array-expansion ───────
 * mysql2 expands a single `?` bound to an ARRAY into a comma list, so
 * `WHERE id IN (?)` with `[[1,2,3]]`… `[1,2,3]` becomes `IN (1,2,3)`. ~15 call
 * sites rely on this. `buildPgQuery` reproduces it exactly (each element gets
 * its own `$n`), so those queries need no edit. An empty array renders `NULL`
 * (→ `IN (NULL)`, matches nothing) — the same effective result mysql2 gives.
 */
const { Pool } = require('pg');

/**
 * Rewrite mysql2 `?` placeholders to pg `$n`, skipping single/double-quoted
 * string literals so a `?` inside a string is never renumbered.
 */
function convertPlaceholders(sql) {
	return buildPgQuery(sql, []).text;
}

const INSERT_RE = /^\s*insert\b/i;
const RETURNING_RE = /\breturning\b/i;
// pg command tags whose payload is a row set (position 0 of the mysql2 tuple).
const ROWSET_COMMANDS = new Set(['SELECT', 'SHOW', 'WITH', 'EXPLAIN']);

function appendReturningId(text) {
	return `${text.replace(/;\s*$/, '')} RETURNING id`;
}

/**
 * Convert a pg result into the mysql2 `[rowsOrHeader, fields]` tuple.
 */
function toMysqlTuple(originalSql, res) {
	if (ROWSET_COMMANDS.has(res.command)) {
		return [res.rows, res.fields];
	}
	// Write / DDL — synthesise a mysql2 ResultSetHeader-like object.
	const header = {
		affectedRows: res.rowCount == null ? 0 : res.rowCount,
		changedRows: res.rowCount == null ? 0 : res.rowCount,
		insertId: res.rows && res.rows[0] && res.rows[0].id != null ? res.rows[0].id : 0,
		rowCount: res.rowCount == null ? 0 : res.rowCount,
		warningStatus: 0,
	};
	return [header, undefined];
}

/**
 * Run one query against a pg executor (the pool or a checked-out client),
 * returning the mysql2-shaped tuple. `params` may be undefined (DDL).
 */
/**
 * Build the pg query text + flat values from mysql2-style `?` SQL and params,
 * in a SINGLE pass so array params can be expanded with correct `$n` numbering.
 * Reproduces mysql2's `IN (?)` array-expansion; scalars map 1:1 to `$n`.
 */
// Every "boolean" column in this schema is modelled as smallint (0/1) to keep
// the 0/1 contract the JS/JSX relies on, so a JS boolean param must go to pg as
// 1/0 — pg would otherwise reject 'true'/'false' text for an integer column.
// (mysql2 accepted booleans and stored 0/1, so this preserves behaviour.)
const coerceParam = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

function buildPgQuery(sql, params) {
	const list = Array.isArray(params) ? params : params == null ? [] : [params];
	let text = '';
	const values = [];
	let pi = 0;
	let inSingle = false;
	let inDouble = false;
	let inLine = false; // -- line comment
	let inBlock = false; // /* block comment */

	for (let i = 0; i < sql.length; i += 1) {
		const ch = sql[i];
		const nx = sql[i + 1];

		// Skip comment bodies verbatim — a `?` or an apostrophe (e.g. "viewer's")
		// inside a comment must NOT be treated as a placeholder or a string quote.
		if (inLine) {
			text += ch;
			if (ch === '\n') inLine = false;
			continue;
		}
		if (inBlock) {
			text += ch;
			if (ch === '*' && nx === '/') { text += nx; i += 1; inBlock = false; }
			continue;
		}
		if (!inSingle && !inDouble) {
			if (ch === '-' && nx === '-') { inLine = true; text += ch; continue; }
			if (ch === '/' && nx === '*') { inBlock = true; text += ch; continue; }
		}

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			text += ch;
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			text += ch;
			continue;
		}
		if (ch === '?' && !inSingle && !inDouble) {
			const val = list[pi];
			pi += 1;
			if (Array.isArray(val)) {
				if (val.length === 0) {
					// mysql2 renders an empty IN-list as (NULL) → matches nothing.
					text += 'NULL';
				} else {
					text += val
						.map((v) => {
							values.push(coerceParam(v));
							return `$${values.length}`;
						})
						.join(', ');
				}
			} else {
				values.push(coerceParam(val));
				text += `$${values.length}`;
			}
			continue;
		}
		text += ch;
	}

	return { text, values };
}

// ---------------------------------------------------------------------------
// MySQL → Postgres SQL dialect translation.
//
// Applied to every statement BEFORE placeholder conversion so the ~50 call sites
// (and their source-coupled tests, which assert on the MySQL SQL text) stay
// untouched. Each transform is regular and unit-tested against a live Postgres.
// ---------------------------------------------------------------------------

// Table → the UNIQUE/PK columns an ON DUPLICATE KEY UPDATE / INSERT IGNORE
// conflicts on (from postgres/schema.sql). A table absent here has no unique key,
// so MySQL's ON DUPLICATE KEY never fired — we strip the clause (plain INSERT),
// preserving behaviour (e.g. userprofiles/linked_accounts accumulate rows).
const CONFLICT_TARGETS = {
	application_preferences: ['user_id', 'app_uid'],
	application_resumes: ['application_id'],
	application_scoring_jobs: ['application_id'],
	conversation_states: ['user_id', 'conversation_id'],
	email_outbox: ['dedupe_key'],
	email_verifications: ['email'],
	job_alert_jobs: ['job_id'],
	job_alert_preferences: ['user_id'],
	job_alerts_sent: ['user_id', 'job_id'],
	notification_preferences: ['user_id', 'type'],
	phone_verifications: ['user_id'],
	proactive_match_jobs: ['job_id'],
	proactive_referral_candidates: ['job_id', 'applicant_id'],
	referral_jobs: ['queue_id'],
	referral_letter_files: ['queue_id'],
	referral_outcomes: ['queue_id'],
	referral_preferences: ['user_id'],
	saved_jobs: ['user_id', 'job_id'],
	sms_outbox: ['dedupe_key'],
	system_settings: ['setting_key'],
	user_ui_preferences: ['user_id', 'pref_key'],
};

// Split a function's argument list on top-level commas (respecting nested parens
// and quotes), so DATE_ADD(NOW(), INTERVAL ? SECOND) → ['NOW()', 'INTERVAL ? SECOND'].
function splitTopLevelArgs(inner) {
	const args = [];
	let depth = 0, cur = '', s = false, d = false;
	for (const ch of inner) {
		if (ch === "'" && !d) s = !s;
		else if (ch === '"' && !s) d = !d;
		if (!s && !d) {
			if (ch === '(') depth += 1;
			else if (ch === ')') depth -= 1;
			else if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
		}
		cur += ch;
	}
	if (cur.trim() !== '' || args.length) args.push(cur.trim());
	return args;
}

// Replace every NAME(...) call with handler(argsArray), matching parens by depth
// so nested calls (MIN(created_at), NOW()) are handled correctly.
function replaceFunc(sql, name, handler) {
	const re = new RegExp(`\\b${name}\\s*\\(`, 'gi');
	let out = '', last = 0, m;
	while ((m = re.exec(sql))) {
		const openIdx = m.index + m[0].length - 1;
		let depth = 0, i = openIdx, s = false, d = false;
		for (; i < sql.length; i += 1) {
			const ch = sql[i];
			if (ch === "'" && !d) s = !s;
			else if (ch === '"' && !s) d = !d;
			if (!s && !d) {
				if (ch === '(') depth += 1;
				else if (ch === ')') { depth -= 1; if (depth === 0) break; }
			}
		}
		out += sql.slice(last, m.index) + handler(splitTopLevelArgs(sql.slice(openIdx + 1, i)));
		last = i + 1;
		re.lastIndex = last;
	}
	return out + sql.slice(last);
}

function dateArith(sign) {
	return (args) => {
		const m = /^INTERVAL\s+(.+?)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?$/i.exec(args[1] || '');
		if (!m) return `DATE_${sign === '+' ? 'ADD' : 'SUB'}(${args.join(', ')})`;
		const expr = args[0].trim();
		const left = expr === '?' ? '?::timestamptz' : expr;
		return `(${left} ${sign} ((${m[1].trim()}) * INTERVAL '1 ${m[2].toLowerCase()}'))`;
	};
}

function translateMysqlToPg(sql) {
	let s = sql;
	// Regular scalar-function swaps.
	s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
	s = s.replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE');
	s = s.replace(/\bRAND\s*\(\s*\)/gi, 'RANDOM()');
	// Date arithmetic (before TIMESTAMPDIFF so any CURDATE inside is already CURRENT_DATE).
	s = replaceFunc(s, 'DATE_ADD', dateArith('+'));
	s = replaceFunc(s, 'DATE_SUB', dateArith('-'));
	// Bare MySQL interval literals outside DATE_ADD/SUB, e.g. `NOW() - INTERVAL 1 DAY`.
	// Postgres needs a quoted interval; rewrite to `((n) * INTERVAL '1 unit')` so both
	// numeric and `?` amounts work. dateArith's own output is already quoted (a `'`
	// follows INTERVAL, not a digit/`?`), so it is not matched a second time here.
	s = s.replace(
		/\bINTERVAL\s+(\?|\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?\b/gi,
		(_m, amt, unit) => `((${amt === '?' ? '?::int' : amt}) * INTERVAL '1 ${unit.toLowerCase()}')`,
	);
	s = replaceFunc(s, 'DATE_FORMAT', (args) => {
		const fmt = (args[1] || '')
			.replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD')
			.replace(/%H/g, 'HH24').replace(/%i/g, 'MI').replace(/%s/g, 'SS');
		return `to_char(${args[0]}, ${fmt})`;
	});
	s = replaceFunc(s, 'TIMESTAMPDIFF', (args) => {
		const unit = (args[0] || '').toUpperCase();
		const a = args[1], b = args[2];
		if (unit === 'YEAR') return `EXTRACT(YEAR FROM age(${b}, ${a}))::int`;
		if (unit === 'MONTH') return `((EXTRACT(YEAR FROM age(${b}, ${a})) * 12 + EXTRACT(MONTH FROM age(${b}, ${a})))::int)`;
		const div = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400, WEEK: 604800 }[unit] || 1;
		return `(EXTRACT(EPOCH FROM ((${b}) - (${a}))) / ${div})::int`;
	});
	// Boolean literals against smallint "boolean" columns.
	s = s.replace(/(=|!=|<>)\s*TRUE\b/gi, '$1 1').replace(/(=|!=|<>)\s*FALSE\b/gi, '$1 0');

	// Untyped placeholder in `? IS [NOT] NULL`: Postgres can't infer a bare
	// parameter's type there (mysql2 accepts it), so anchor it with a text cast.
	// Only the null-test occurrence is cast; a second `?` bound to the same value
	// elsewhere (e.g. `(? IS NULL OR col = ?)`) still takes its type from its column.
	s = s.replace(/\?\s+IS\s+(NOT\s+)?NULL\b/gi, (_m, notKw) => `?::text IS ${notKw ? 'NOT ' : ''}NULL`);

	// Upserts. ON DUPLICATE KEY UPDATE → ON CONFLICT (targets) DO UPDATE SET …
	const odku = s.search(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i);
	if (odku !== -1) {
		const tm = /INSERT\s+(?:IGNORE\s+)?INTO\s+"?(\w+)"?/i.exec(s);
		const table = tm && tm[1];
		const before = s.slice(0, odku);
		let body = s.slice(odku).replace(/^ON\s+DUPLICATE\s+KEY\s+UPDATE/i, '').replace(/;\s*$/, '').trim();
		const cols = table && CONFLICT_TARGETS[table];
		if (cols) {
			body = body.replace(/\bVALUES\s*\(\s*"?(\w+)"?\s*\)/gi, 'EXCLUDED.$1');
			body = body.replace(/\bLAST_INSERT_ID\s*\([^)]*\)/gi, `${table}.id`);
			s = body
				? `${before}ON CONFLICT (${cols.join(', ')}) DO UPDATE SET ${body}`
				: `${before}ON CONFLICT (${cols.join(', ')}) DO NOTHING`;
		} else {
			// No unique key → the clause was a no-op in MySQL; drop it (plain INSERT).
			s = before.replace(/\s+$/, '');
		}
	}
	// INSERT IGNORE INTO t … → INSERT INTO t … ON CONFLICT (targets) DO NOTHING
	const ig = /INSERT\s+IGNORE\s+INTO\s+"?(\w+)"?/i.exec(s);
	if (ig) {
		s = s.replace(/INSERT\s+IGNORE\s+INTO/i, 'INSERT INTO');
		const cols = CONFLICT_TARGETS[ig[1]];
		if (cols) s = `${s.replace(/;\s*$/, '').replace(/\s+$/, '')} ON CONFLICT (${cols.join(', ')}) DO NOTHING`;
	}
	return s;
}

async function runQuery(executor, sql, params) {
	if (typeof sql !== 'string') {
		throw new TypeError('[pgAdapter] SQL must be a string');
	}

	const { text, values } = buildPgQuery(translateMysqlToPg(sql), params === undefined ? [] : params);
	const wantsInsertId = INSERT_RE.test(sql) && !RETURNING_RE.test(sql);

	try {
		const res = await executor.query(wantsInsertId ? appendReturningId(text) : text, values);
		return toMysqlTuple(sql, res);
	} catch (err) {
		// 42703 = undefined_column: the table has no `id` to RETURN. Retry plain.
		if (wantsInsertId && err && err.code === '42703') {
			const res = await executor.query(text, values);
			return toMysqlTuple(sql, res);
		}
		throw err;
	}
}

/**
 * Build the SSL option for node-postgres. Supabase requires TLS; its pooled and
 * direct endpoints present a chain Node won't validate against its bundled CAs
 * without the project CA, so for this experiment we connect over TLS but do not
 * hard-fail on the chain (DB_SSL=false disables TLS entirely for a plain local pg).
 */
function buildSsl() {
	if (process.env.DB_SSL === 'false') return false;
	return { rejectUnauthorized: false };
}

/**
 * Create the pg pool and wrap it in the mysql2-compatible facade.
 * Accepts either a single `DATABASE_URL` (Supabase copy-paste) or the discrete
 * DB_* vars the rest of the app already uses.
 */
function createPool() {
	const useUrl = Boolean(process.env.DATABASE_URL);
	const pool = new Pool(
		useUrl
			? { connectionString: process.env.DATABASE_URL, ssl: buildSsl(), max: 10 }
			: {
				host: process.env.DB_HOST,
				port: Number(process.env.DB_PORT) || 5432,
				user: process.env.DB_USER,
				password: process.env.DB_PASSWORD,
				database: process.env.DB_NAME,
				ssl: buildSsl(),
				max: 10,
			},
	);

	// A pool-level error handler so a dropped idle connection never crashes the
	// process (mirrors mysql2's internal handling).
	pool.on('error', (err) => {
		console.error('[DB:pg] idle client error:', err.message);
	});

	const facade = {
		// mysql2 exposes both query() and execute(); the app uses both.
		query: (sql, params) => runQuery(pool, sql, params),
		execute: (sql, params) => runQuery(pool, sql, params),
		end: () => pool.end(),

		// Transaction support: hand back a client wrapper matching the mysql2
		// connection API the services use.
		getConnection: async () => {
			const client = await pool.connect();
			let released = false;
			return {
				query: (sql, params) => runQuery(client, sql, params),
				execute: (sql, params) => runQuery(client, sql, params),
				beginTransaction: () => client.query('BEGIN'),
				commit: () => client.query('COMMIT'),
				rollback: () => client.query('ROLLBACK'),
				release: () => {
					if (released) return;
					released = true;
					client.release();
				},
			};
		},

		// Escape hatch for anything that genuinely needs the raw pg pool.
		__pgPool: pool,
	};

	return facade;
}

module.exports = { createPool, convertPlaceholders, buildPgQuery, translateMysqlToPg };
