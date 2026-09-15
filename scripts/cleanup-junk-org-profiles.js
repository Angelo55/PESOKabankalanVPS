/**
 * cleanup-junk-org-profiles.js — one-off follow-up to the PESO Admin consolidation.
 *
 * Deletes the two JUNK organization-profile rows that were left orphaned on the
 * legacy (now 'applicant') accounts after the consolidation — test garbage, never
 * the real office profile:
 *     pesoadmin_profiles.user_id=16  ("CCC" / "Drugs")
 *     pesoadmin_profiles.user_id=25  ("SI IAN")
 * The authoritative account (30002) keeps its own profile (created on save); these
 * rows are unreferenced leaves. Owner-approved 2026-09-14.
 *
 * Dry-run by default (backup + plan, no writes). Pass --commit to apply in ONE txn.
 * A full-row JSON backup is written to the scratchpad BEFORE any delete.
 *
 * Usage:  node scripts/cleanup-junk-org-profiles.js            (dry run)
 *         node scripts/cleanup-junk-org-profiles.js --commit   (apply)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const COMMIT = process.argv.includes('--commit');
const JUNK_USER_IDS = [16, 25];
const BACKUP_DIR = process.env.CONSOLIDATE_BACKUP_DIR
  || path.join(process.env.TEMP || '.', 'peso-consolidation-backup');

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2' }, timezone: 'Z'
});
const log = (...a) => console.log(...a);

(async () => {
  const conn = await pool.getConnection();
  try {
    log(`\n=== Cleanup junk org-profiles — ${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${new Date().toISOString()} ===`);

    // Guard: the owners must still be non-admin 'applicant' rows, and the target
    // PESO Administrator (30002) must NOT be among the rows we delete.
    const [owners] = await pool.query(
      `SELECT id, role FROM users WHERE id IN (${JUNK_USER_IDS.join(',')})`);
    for (const u of owners) {
      if (u.role !== 'applicant')
        throw new Error(`Owner ${u.id} role is '${u.role}', expected applicant — aborting`);
    }
    const [rows] = await conn.query(
      `SELECT * FROM pesoadmin_profiles WHERE user_id IN (${JUNK_USER_IDS.join(',')})`);
    if (rows.some(r => r.user_id === 30002)) throw new Error('Refusing: target 30002 profile in scope');
    log(`Rows to delete: ${rows.length} (${rows.map(r => `id=${r.id}/user=${r.user_id}/"${r.company_name}"`).join(', ')})`);

    // Backup BEFORE any write.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `junk-profiles-backup-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));
    log(`Backup written: ${backupPath}`);

    if (!COMMIT) { log('\nDRY RUN — no writes. Re-run with --commit to apply.'); return; }

    await conn.beginTransaction();
    const [del] = await conn.query(
      `DELETE FROM pesoadmin_profiles WHERE user_id IN (${JUNK_USER_IDS.join(',')})`);
    await conn.commit();
    const [[after]] = await conn.query(
      `SELECT COUNT(*) n FROM pesoadmin_profiles WHERE user_id IN (${JUNK_USER_IDS.join(',')})`);
    log(`\nCOMMITTED — deleted ${del.affectedRows} row(s). Remaining for these users: ${after.n} (expect 0).`);
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('\nCLEANUP ERROR (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
