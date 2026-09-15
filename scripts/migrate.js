/**
 * Migration runner.
 *
 * Commands:
 *   npm run migrate            Apply all pending migrations.
 *   npm run migrate:status     Show applied / pending, change nothing.
 *   npm run migrate:baseline   Record ALL current migration files as applied
 *                              WITHOUT executing them. Use exactly once, when
 *                              introducing migration tracking to a database
 *                              whose schema already exists.
 *
 * Every command prints the target host and database before doing anything.
 * DDL is not transactional in MySQL / MariaDB / TiDB -- a failed migration
 * cannot be rolled back, so migrations must be individually idempotent
 * (CREATE TABLE IF NOT EXISTS, etc.) and are recorded only on full success.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const COMMAND = (process.argv[2] || 'up').toLowerCase();

/**
 * Splits a SQL file into individual statements, respecting quoted strings
 * and stripping `--` line comments.
 */
function splitStatements(sql) {
	const statements = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;
	let inLineComment = false;

	for (let i = 0; i < sql.length; i += 1) {
		const ch = sql[i];
		const next = sql[i + 1];

		if (inLineComment) {
			if (ch === '\n') {
				inLineComment = false;
				current += ch;
			}
			continue;
		}

		if (!inSingle && !inDouble && ch === '-' && next === '-') {
			inLineComment = true;
			i += 1;
			continue;
		}

		if (ch === "'" && !inDouble) inSingle = !inSingle;
		if (ch === '"' && !inSingle) inDouble = !inDouble;

		if (ch === ';' && !inSingle && !inDouble) {
			if (current.trim()) statements.push(current.trim());
			current = '';
			continue;
		}

		current += ch;
	}

	if (current.trim()) statements.push(current.trim());
	return statements;
}

function listMigrationFiles() {
	if (!fs.existsSync(MIGRATIONS_DIR)) {
		console.error(`[MIGRATE] Migrations directory not found: ${MIGRATIONS_DIR}`);
		process.exit(1);
	}

	return fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((file) => file.endsWith('.sql'))
		.sort();
}

function confirm(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase());
		});
	});
}

async function connect() {
	const host = process.env.DB_HOST;
	const port = Number(process.env.DB_PORT) || 4000;
	const database = process.env.DB_NAME;

	if (!host || !database) {
		console.error('[MIGRATE] DB_HOST or DB_NAME is missing from .env. Refusing to run.');
		process.exit(1);
	}

	let connection;

	try {
		connection = await mysql.createConnection({
			host,
			port,
			user: process.env.DB_USER,
			password: process.env.DB_PASSWORD,
			database,
			ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2' } : undefined
		});
	} catch (error) {
		console.error(`[MIGRATE] Could not connect to ${host}:${port}/${database}`);
		console.error(`[MIGRATE] ${error.message}`);
		process.exit(1);
	}

	// Announce the target loudly. Applying a migration to the wrong database is
	// the single most expensive mistake available here.
	const [[versionRow]] = await connection.query('SELECT VERSION() AS version');

	console.log('[MIGRATE] ----------------------------------------------');
	console.log(`[MIGRATE] HOST      ${host}:${port}`);
	console.log(`[MIGRATE] DATABASE  ${database}`);
	console.log(`[MIGRATE] SERVER    ${versionRow.version}`);
	console.log('[MIGRATE] ----------------------------------------------');

	await connection.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id INT AUTO_INCREMENT PRIMARY KEY,
			filename VARCHAR(255) NOT NULL,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			baselined BOOLEAN NOT NULL DEFAULT FALSE,
			CONSTRAINT uq_schema_migrations_filename UNIQUE (filename)
		)
	`);

	return connection;
}

async function getApplied(connection) {
	const [rows] = await connection.query('SELECT filename, baselined FROM schema_migrations');
	return new Map(rows.map((row) => [row.filename, Boolean(row.baselined)]));
}

async function commandStatus(connection) {
	const applied = await getApplied(connection);
	const files = listMigrationFiles();

	for (const file of files) {
		if (!applied.has(file)) {
			console.log(`[MIGRATE] PENDING    ${file}`);
		} else if (applied.get(file)) {
			console.log(`[MIGRATE] BASELINED  ${file}`);
		} else {
			console.log(`[MIGRATE] APPLIED    ${file}`);
		}
	}

	for (const filename of applied.keys()) {
		if (!files.includes(filename)) {
			console.log(`[MIGRATE] ORPHANED   ${filename} (recorded, but the file is gone)`);
		}
	}
}

async function commandBaseline(connection) {
	const applied = await getApplied(connection);
	const files = listMigrationFiles();
	const pending = files.filter((file) => !applied.has(file));

	if (pending.length === 0) {
		console.log('[MIGRATE] Nothing to baseline. Every migration file is already recorded.');
		return;
	}

	console.log('[MIGRATE] The following files will be marked as ALREADY APPLIED.');
	console.log('[MIGRATE] Their SQL will NOT be executed.');
	console.log('[MIGRATE]');
	pending.forEach((file) => console.log(`[MIGRATE]   ${file}`));
	console.log('[MIGRATE]');
	console.log('[MIGRATE] Only do this if the schema these files describe ALREADY EXISTS');
	console.log('[MIGRATE] in the database shown above. Otherwise you will permanently skip');
	console.log('[MIGRATE] migrations that were never actually run.');
	console.log('[MIGRATE]');

	const answer = await confirm('[MIGRATE] Type BASELINE to confirm: ');

	if (answer !== 'baseline') {
		console.log('[MIGRATE] Aborted. Nothing was changed.');
		return;
	}

	for (const file of pending) {
		await connection.query(
			'INSERT INTO schema_migrations (filename, baselined) VALUES (?, TRUE)',
			[file]
		);
		console.log(`[MIGRATE] BASELINED  ${file}`);
	}

	console.log(`[MIGRATE] Done. ${pending.length} file(s) baselined.`);
}

async function commandUp(connection) {
	const applied = await getApplied(connection);
	const files = listMigrationFiles();

	if (files.length === 0) {
		console.log('[MIGRATE] No migration files found.');
		return;
	}

	let count = 0;

	for (const file of files) {
		if (applied.has(file)) {
			console.log(`[MIGRATE] SKIP      ${file}`);
			continue;
		}

		const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
		const statements = splitStatements(sql);

		console.log(`[MIGRATE] APPLY     ${file} (${statements.length} statement(s))`);

		for (let i = 0; i < statements.length; i += 1) {
			try {
				await connection.query(statements[i]);
			} catch (error) {
				console.error(`[MIGRATE] FAILED    ${file} at statement ${i + 1}:`);
				console.error(statements[i]);
				console.error(`[MIGRATE] ${error.code || ''} ${error.message}`);
				console.error('[MIGRATE]');
				console.error('[MIGRATE] This migration was NOT recorded, but statements 1..' + i);
				console.error('[MIGRATE] HAVE ALREADY EXECUTED and cannot be rolled back (DDL is');
				console.error('[MIGRATE] not transactional). Inspect the database before re-running.');
				process.exit(1);
			}
		}

		await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
		count += 1;
		console.log(`[MIGRATE] OK        ${file}`);
	}

	console.log(`[MIGRATE] Done. ${count} applied, ${files.length - count} skipped.`);
}

async function run() {
	const connection = await connect();

	try {
		if (COMMAND === 'status') {
			await commandStatus(connection);
		} else if (COMMAND === 'baseline') {
			await commandBaseline(connection);
		} else if (COMMAND === 'up') {
			await commandUp(connection);
		} else {
			console.error(`[MIGRATE] Unknown command: ${COMMAND}. Use: up | status | baseline`);
			process.exit(1);
		}
	} catch (error) {
		console.error('[MIGRATE] Unexpected failure:', error.message);
		process.exit(1);
	} finally {
		await connection.end();
	}
}

run();