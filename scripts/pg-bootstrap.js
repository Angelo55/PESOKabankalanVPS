/**
 * Postgres bootstrap (Supabase re-platform experiment).
 *
 * Applies postgres/schema.sql to the target Postgres database in ONE shot.
 * node-postgres runs a multi-statement, parameter-less query as a single batch,
 * so the plpgsql `$$` trigger bodies are sent verbatim (no fragile `;`-splitter).
 *
 * Connection: DATABASE_URL (Supabase copy-paste) or the discrete DB_* vars — the
 * same resolution dbPgAdapter.js uses. TLS on unless DB_SSL=false.
 *
 *   node scripts/pg-bootstrap.js            # apply schema (fails if objects exist)
 *   node scripts/pg-bootstrap.js --reset    # DROP & recreate the public schema first
 *
 * --reset is destructive: it drops every object in `public`. Guarded so it only
 * runs against a database whose name looks like a staging/experiment DB unless
 * PG_BOOTSTRAP_FORCE=1 is set.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const RESET = process.argv.includes('--reset');
const SCHEMA_FILE = path.join(__dirname, '..', 'postgres', 'schema.sql');

function poolConfig() {
	const ssl = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
	if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl, max: 3 };
	return {
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT) || 5432,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		ssl,
		max: 3,
	};
}

(async () => {
	const cfg = poolConfig();
	const dbLabel = process.env.DATABASE_URL
		? process.env.DATABASE_URL.replace(/:[^:@/]*@/, ':****@')
		: `${cfg.host}:${cfg.port}/${cfg.database}`;
	console.log(`[PG-BOOTSTRAP] target: ${dbLabel}`);

	const pool = new Pool(cfg);
	const client = await pool.connect();
	try {
		const [{ current_database, server_version }] = (
			await client.query('SELECT current_database(), version() AS server_version')
		).rows.map((r) => ({ current_database: r.current_database, server_version: r.server_version }));
		console.log(`[PG-BOOTSTRAP] connected: ${current_database} — ${server_version.split(',')[0]}`);

		if (RESET) {
			const safe = /stag|experiment|test|local|job_tracker/i.test(current_database);
			if (!safe && process.env.PG_BOOTSTRAP_FORCE !== '1') {
				throw new Error(
					`Refusing --reset on database "${current_database}" (name doesn't look like staging). Set PG_BOOTSTRAP_FORCE=1 to override.`,
				);
			}
			console.log('[PG-BOOTSTRAP] --reset: dropping and recreating schema public …');
			await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
		}

		const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
		await client.query(sql);
		console.log('[PG-BOOTSTRAP] schema.sql applied successfully.');

		const [{ n }] = (
			await client.query(
				"SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
			)
		).rows;
		console.log(`[PG-BOOTSTRAP] tables present: ${n}`);
	} finally {
		client.release();
		await pool.end();
	}
})().catch((e) => {
	console.error('[PG-BOOTSTRAP] FAILED:', e.message);
	process.exit(1);
});
