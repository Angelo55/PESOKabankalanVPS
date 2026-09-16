/**
 * ETL: full-replace migration of the ORIGINAL TiDB (MySQL) database into the
 * VPS Supabase (Postgres) target. Data-only — the target schema is owned by
 * postgres/schema.sql and must already be applied.
 *
 * SOURCE  (read-only): SRC_DB_HOST/PORT/USER/PASSWORD/NAME(/SSL) in .env.
 * TARGET  (writes)   : DATABASE_URL (the Supabase pooler) in .env.
 *
 *   node scripts/etl-tidb-to-supabase.js            # DRY RUN — counts only, no writes
 *   node scripts/etl-tidb-to-supabase.js --execute  # TRUNCATE target + load + validate
 *
 * Design:
 *  - Dynamic: introspects the TARGET for tables, column types, and FK edges; loads
 *    in FK-dependency (topological) order so parents exist before children.
 *  - Type coercion MySQL→PG per TARGET column type (boolean 0/1→t/f, zero-dates→NULL,
 *    json/jsonb objects→text). Values move as native types (no SQL-text transform).
 *  - Column set = SOURCE ∩ TARGET (a target-only column like file_key stays default;
 *    a SOURCE-only column is WARNED about — potential data loss — and skipped).
 *  - --execute wraps the load on ONE connection with session_replication_role='replica'
 *    (FK/trigger checks off) so self-referential/any-order rows load; then re-enables,
 *    resets identity sequences to MAX(id), and re-counts source vs target.
 *
 * SAFETY: --execute TRUNCATEs every target table (RESTART IDENTITY CASCADE). Intended
 * for the agreed full-replace only. Dry-run first; never point SRC_* at the target.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const EXECUTE = process.argv.includes('--execute');
const BATCH = Number(process.env.ETL_BATCH || 100);

function topoSort(tables, edges) {
	// edges: [{child, parent}] — load parents before children. Self-edges ignored.
	const set = new Set(tables);
	const deps = new Map(tables.map((t) => [t, new Set()]));
	for (const { child, parent } of edges) {
		if (child === parent) continue;
		if (set.has(child) && set.has(parent)) deps.get(child).add(parent);
	}
	const out = [], done = new Set();
	let guard = 0;
	while (done.size < tables.length && guard++ < tables.length + 5) {
		for (const t of tables) {
			if (done.has(t)) continue;
			if ([...deps.get(t)].every((p) => done.has(p))) { out.push(t); done.add(t); }
		}
	}
	// Any left over are in a cycle — append them (FK checks are off during load).
	for (const t of tables) if (!done.has(t)) out.push(t);
	return out;
}

function coerce(val, type) {
	if (val === null || val === undefined) return null;
	if (type === 'boolean') {
		if (typeof val === 'boolean') return val;
		const s = String(val).toLowerCase();
		return s === '1' || s === 'true' || s === 't' || s === 'y';
	}
	if (type === 'json' || type === 'jsonb') {
		return typeof val === 'object' ? JSON.stringify(val) : val;
	}
	if (type === 'date' || type.startsWith('timestamp') || type.startsWith('time')) {
		const s = String(val);
		if (/^0000-00-00/.test(s) || s === '0000-00-00 00:00:00') return null;
		return s;
	}
	return val; // int/bigint/numeric/text/varchar/etc. pass through
}

async function main() {
	const src = await mysql.createConnection({
		host: process.env.SRC_DB_HOST,
		port: Number(process.env.SRC_DB_PORT) || 4000,
		user: process.env.SRC_DB_USER,
		password: process.env.SRC_DB_PASSWORD,
		database: process.env.SRC_DB_NAME,
		ssl: process.env.SRC_DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2' },
		dateStrings: true,
		supportBigNumbers: true,
		bigNumberStrings: true,
	});
	const tgt = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
	await tgt.connect();

	try {
		// ── introspect target ──────────────────────────────────────────────────
		const tables = (await tgt.query(
			`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
		)).rows.map((r) => r.table_name);

		const colTypes = {}; // table -> Map(colName -> data_type)
		const idCols = {};   // table -> id column name (identity), if any
		for (const t of tables) {
			const rows = (await tgt.query(
				`SELECT column_name, data_type, is_identity FROM information_schema.columns
				 WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]
			)).rows;
			colTypes[t] = new Map(rows.map((r) => [r.column_name, r.data_type]));
			const idr = rows.find((r) => r.is_identity === 'YES') || rows.find((r) => r.column_name === 'id');
			if (idr) idCols[t] = idr.column_name;
		}

		const fkEdges = (await tgt.query(`
			SELECT tc.table_name AS child, ccu.table_name AS parent
			FROM information_schema.table_constraints tc
			JOIN information_schema.constraint_column_usage ccu
			  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
			WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`)).rows;
		const order = topoSort(tables, fkEdges);

		// ── source tables ──────────────────────────────────────────────────────
		const [srcTblRows] = await src.query(
			`SELECT table_name AS t FROM information_schema.tables WHERE table_schema=?`, [process.env.SRC_DB_NAME]
		);
		const srcTables = new Set(srcTblRows.map((r) => r.t));

		// ── DRY RUN: report counts + column diffs, no writes ────────────────────
		console.log(`\n=== ${EXECUTE ? 'EXECUTE' : 'DRY RUN'} — ${tables.length} target tables, load order resolved ===`);
		for (const t of order) {
			if (!srcTables.has(t)) { console.log(`  ${t.padEnd(34)} (not in source — skip)`); continue; }
			const [[{ n: sc }]] = await src.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
			const tc = (await tgt.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
			// column diff (source-only columns = potential data loss)
			const [srcColRows] = await src.query(
				`SELECT column_name AS c FROM information_schema.columns WHERE table_schema=? AND table_name=?`,
				[process.env.SRC_DB_NAME, t]
			);
			const srcCols = new Set(srcColRows.map((r) => r.c));
			const srcOnly = [...srcCols].filter((c) => !colTypes[t].has(c));
			const warn = srcOnly.length ? `  ⚠ source-only cols dropped: ${srcOnly.join(',')}` : '';
			console.log(`  ${t.padEnd(34)} src=${String(sc).padStart(6)}  tgt=${String(tc).padStart(6)}${warn}`);
		}

		if (!EXECUTE) {
			console.log('\nDRY RUN complete — no writes. Re-run with --execute to load.');
			return;
		}

		// ── EXECUTE: truncate + load + reset sequences ──────────────────────────
		console.log('\n--- disabling FK checks + truncating target ---');
		await tgt.query(`SET session_replication_role = 'replica'`);
		const truncatable = order.filter((t) => srcTables.has(t)).map((t) => `"${t}"`);
		await tgt.query(`TRUNCATE ${truncatable.join(', ')} RESTART IDENTITY CASCADE`);

		let totalRows = 0;
		for (const t of order) {
			if (!srcTables.has(t)) continue;
			const targetCols = colTypes[t];
			const [srcColRows] = await src.query(
				`SELECT column_name AS c FROM information_schema.columns WHERE table_schema=? AND table_name=?`,
				[process.env.SRC_DB_NAME, t]
			);
			const loadCols = srcColRows.map((r) => r.c).filter((c) => targetCols.has(c));
			if (loadCols.length === 0) { console.log(`  ${t}: no shared columns — skip`); continue; }

			const [rows] = await src.query(`SELECT ${loadCols.map((c) => `\`${c}\``).join(', ')} FROM \`${t}\``);
			if (rows.length === 0) { console.log(`  ${t.padEnd(34)} 0 rows`); continue; }

			const colList = loadCols.map((c) => `"${c}"`).join(', ');
			for (let i = 0; i < rows.length; i += BATCH) {
				const slice = rows.slice(i, i + BATCH);
				const values = [];
				const params = [];
				let p = 1;
				for (const row of slice) {
					const ph = loadCols.map((c) => {
						params.push(coerce(row[c], targetCols.get(c)));
						return `$${p++}`;
					});
					values.push(`(${ph.join(', ')})`);
				}
				await tgt.query(`INSERT INTO "${t}" (${colList}) VALUES ${values.join(', ')}`, params);
			}
			totalRows += rows.length;
			console.log(`  ${t.padEnd(34)} loaded ${rows.length}`);
		}

		// Neutralize migrated OUTBOX rows so the live workers never re-send/re-dispatch
		// referrals/emails/SMS that the ORIGINAL system already handled. Workers act only
		// on status='pending'; 'migrated' is an inert sentinel (all these are varchar(20),
		// no CHECK). 'done'/'failed'/'sent' terminal rows are already inert and untouched.
		console.log('\n--- neutralizing migrated outbox rows (no re-send on resume) ---');
		const OUTBOX = ['referral_jobs', 'email_outbox', 'sms_outbox', 'proactive_match_jobs', 'job_alert_jobs', 'application_scoring_jobs'];
		for (const t of OUTBOX) {
			if (!srcTables.has(t) || !colTypes[t] || !colTypes[t].has('status')) continue;
			const r = await tgt.query(`UPDATE "${t}" SET status = 'migrated' WHERE status IN ('pending', 'processing')`);
			console.log(`  ${t.padEnd(28)} neutralized ${r.rowCount} non-terminal row(s)`);
		}

		console.log('\n--- resetting identity sequences ---');
		for (const t of order) {
			if (!srcTables.has(t) || !idCols[t]) continue;
			const id = idCols[t];
			try {
				await tgt.query(
					`SELECT setval(pg_get_serial_sequence('"${t}"', '${id}'),
					        GREATEST((SELECT COALESCE(MAX("${id}"), 0) FROM "${t}"), 1),
					        (SELECT COUNT(*) FROM "${t}") > 0)`
				);
			} catch (e) { console.warn(`  ${t}.${id}: setval skipped (${e.message})`); }
		}

		await tgt.query(`SET session_replication_role = 'origin'`);

		console.log('\n--- validation: source vs target counts ---');
		let mismatches = 0;
		for (const t of order) {
			if (!srcTables.has(t)) continue;
			const [[{ n: sc }]] = await src.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
			const tc = (await tgt.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
			const ok = Number(sc) === tc;
			if (!ok) mismatches++;
			if (!ok) console.log(`  ⚠ ${t}: src=${sc} tgt=${tc} MISMATCH`);
		}
		console.log(`\nDONE — loaded ~${totalRows} rows. ${mismatches === 0 ? 'All counts match ✓' : mismatches + ' table(s) MISMATCH ✗'}`);
	} finally {
		await src.end();
		await tgt.end();
	}
}

main().catch((e) => { console.error('ETL FAILED:', e.message); process.exit(1); });
