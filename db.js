const mysql = require('mysql2/promise');
require('dotenv').config();

// Driver selection (Postgres re-platform experiment, branch
// experiment/postgres-supabase). Defaults to mysql, so the production path
// (Render → TiDB) is byte-for-byte unchanged. DB_CLIENT=postgres routes every
// query through the mysql2-compatible pg adapter (dbPgAdapter.js) instead.
const DB_CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase();
const IS_PG = DB_CLIENT === 'postgres' || DB_CLIENT === 'pg';

const pool = IS_PG ? require('./dbPgAdapter').createPool() : mysql.createPool({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT) || 4000,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	// TiDB Serverless requires TLS. Node's bundled CA store validates its
	// certificate, so no .pem file is needed. Set DB_SSL=false only if you
	// ever point this at a plain local MySQL/MariaDB again.
	ssl: process.env.DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2' },

	// TIMEZONE — do not remove.
	//
	// TiDB stores these columns in UTC (its session/global time_zone is SYSTEM,
	// and the cloud host runs UTC: CURRENT_TIMESTAMP === UTC_TIMESTAMP()). The
	// wire protocol returns naive strings like '2026-07-20 07:30:35' with no
	// offset, so the DRIVER decides how to interpret them.
	//
	// mysql2 defaults to timezone:'local'. On this UTC+8 (Asia/Manila) host that
	// reinterpreted every UTC timestamp as Manila time, producing a JS Date
	// exactly 8 hours in the past — which is why brand-new notifications
	// rendered as "8h ago". Measured: 'local' -> 8.00h drift, 'Z' -> 0.00h.
	//
	// 'Z' tells mysql2 those strings ARE UTC, so Dates come back as the correct
	// instant and Express serialises them to proper ISO-8601 with a Z suffix.
	// It also fixes the write direction: a JS Date passed as a parameter is now
	// serialised as UTC rather than shifted local time.
	//
	// This is system-wide, not notification-specific: referrals, applications,
	// saved jobs and Trash retention all read timestamps through this pool.
	timezone: 'Z',

	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

const acceptedPhilippineIds = [
	'Philippine National ID (PhilSys ID)',
	'Passport',
	"Driver's License",
	'UMID',
	'Postal ID',
	'PRC ID',
	"Voter's ID",
	'PhilHealth ID',
	'SSS ID',
	'GSIS ID',
	'Senior Citizen ID',
	'PWD ID',
	'Other government-issued ID'
];

async function initDB() {
	try {
		// Announce the connection target on boot. Silently talking to the wrong
		// database is the most expensive class of bug available in this project.
		const [[versionRow]] = await pool.query('SELECT VERSION() AS version');
		console.log(`[DB] Connected to ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
		console.log(`[DB] Server: ${versionRow.version}`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS Users (
				id INT AUTO_INCREMENT PRIMARY KEY,
				email VARCHAR(255) UNIQUE NOT NULL,
				name VARCHAR(255) NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS Applications (
				id INT AUTO_INCREMENT PRIMARY KEY,
				user_id INT NOT NULL,
				company_name VARCHAR(255) NOT NULL,
				job_title VARCHAR(255) NOT NULL,
				platform_source VARCHAR(100),
				application_status ENUM('Applied', 'Under Review', 'Interview', 'Rejected', 'Accepted') DEFAULT 'Applied',
				application_date DATE,
				notes TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
			)
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS saved_jobs (
				id INT AUTO_INCREMENT PRIMARY KEY,
				user_id INT NOT NULL,
				job_id INT NOT NULL,
				saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE KEY unique_user_job (user_id, job_id)
			)
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS jobs (
				id INT AUTO_INCREMENT PRIMARY KEY,
				title VARCHAR(255) NOT NULL,
				company VARCHAR(255) NOT NULL,
				location VARCHAR(255),
				employment_type VARCHAR(100),
				work_setup VARCHAR(100),
				description TEXT,
				educational_requirements TEXT,
				required_experience TEXT,
				accessibility_accommodations TEXT,
				positions_available INT DEFAULT 1,
				salary_range VARCHAR(100),
				application_deadline DATE,
				department VARCHAR(100),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		try { await pool.query(`ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'applicant'`); } catch(e) {}
		try { await pool.query(`ALTER TABLE users ADD COLUMN account_status VARCHAR(50) DEFAULT 'Active'`); } catch(e) {}

		await pool.query(`
			CREATE TABLE IF NOT EXISTS verification_id_types (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(120) NOT NULL UNIQUE,
				is_active BOOLEAN DEFAULT TRUE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		for (const idType of acceptedPhilippineIds) {
			await pool.query(
				`INSERT IGNORE INTO verification_id_types (name) VALUES (?)`,
				[idType]
			);
		}

		await pool.query(`
			CREATE TABLE IF NOT EXISTS job_seeker_verifications (
				id INT AUTO_INCREMENT PRIMARY KEY,
				user_id INT NOT NULL UNIQUE,
				verification_status ENUM('Not Submitted', 'Pending', 'Approved', 'Rejected', 'Requires Additional Information') DEFAULT 'Not Submitted',
				submitted_id_type VARCHAR(120),
				document_path TEXT,
				submitted_at TIMESTAMP NULL DEFAULT NULL,
				reviewed_by INT NULL,
				reviewed_at TIMESTAMP NULL DEFAULT NULL,
				review_remarks TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
			)
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS verification_history (
				id INT AUTO_INCREMENT PRIMARY KEY,
				verification_id INT NOT NULL,
				user_id INT NOT NULL,
				action VARCHAR(80) NOT NULL,
				status VARCHAR(80) NOT NULL,
				remarks TEXT,
				performed_by INT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (verification_id) REFERENCES job_seeker_verifications(id) ON DELETE CASCADE,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
			)
		`);

		console.log("[DB] Schema validated.");
	} catch (error) {
		console.error("[DB] Initialization failed. Check DB_HOST, DB_PORT, DB_SSL and credentials in .env.");
		console.error(error);
	}
}

// initDB() creates/patches legacy tables on EVERY boot — but migrations own the
// schema now (§13; it is "pending retirement"), and on a hibernating free instance
// this DDL is a real cold-start cost paid on every wake. Skip it by default and just
// verify the DB is reachable; set DB_INIT_ON_BOOT=true only for a fresh local database
// that has never been migrated.
// Expose the active driver so the route-level "ensure schema" boot guards (which
// emit MySQL DDL) can skip themselves on Postgres, where postgres/schema.sql owns
// the schema. Attached to the pool so `require('../db').isPostgres` works anywhere.
pool.isPostgres = IS_PG;

// initDB() is MySQL-specific legacy DDL and only meaningful on the mysql path.
// On Postgres the schema is owned by schema.postgres.sql / the ported migrations,
// so we never run it there — we just announce the target and verify reachability.
if (!IS_PG && process.env.DB_INIT_ON_BOOT === 'true') {
	initDB();
} else {
	pool.query('SELECT VERSION() AS version')
		.then(([rows]) => {
			const version = rows && rows[0] ? rows[0].version : 'unknown';
			// Report the ACTUAL target for the active driver. On the pg path the
			// connection comes from DATABASE_URL (password masked before logging);
			// DB_HOST is the leftover MySQL/TiDB host and would MISLABEL the log
			// (it once printed "…tidbcloud.com" while really talking to Supabase).
			const target = IS_PG
				? (process.env.DATABASE_URL
					? process.env.DATABASE_URL.replace(/:[^:@/]*@/, ':****@')
					: `${process.env.DB_HOST || '?'}:${process.env.DB_PORT || ''}/${process.env.DB_NAME || ''}`)
				: `${process.env.DB_HOST || process.env.DATABASE_URL || '?'}/${process.env.DB_NAME || ''}`;
			console.log(`[DB] Connected (${IS_PG ? 'postgres' : 'mysql'}) to ${target}`);
			console.log(`[DB] Server: ${version}`);
			if (!IS_PG) console.log('[DB] initDB skipped — migrations own the schema; set DB_INIT_ON_BOOT=true to run it.');
		})
		.catch((e) => console.error('[DB] Boot connectivity check failed:', e.message));
}

module.exports = pool;