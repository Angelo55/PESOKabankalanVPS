/**
 * consolidate-super-admin.js — one-off controlled cleanup.
 *
 * Consolidates the two Super Administrator accounts to one authoritative account,
 * the owner's own: id 1 (angelopamalacsao@gmail.com). The junk-named second admin
 * — id 18, admin@hire.com "ASDASDA" — is removed AFTER its history is reassigned to
 * id 1 (same human), so the audit trail is preserved rather than destroyed.
 *
 * id 18 owns NO cascade content (no jobs/conversations/messages/applications —
 * verified); its only references are actor/updater rows:
 *   admin_audit_logs.admin_id      (NOT NULL, NO ACTION FK — would otherwise BLOCK the delete)
 *   system_settings.updated_by     (SET NULL)
 *   referral_activity_log.actor_id (SET NULL)
 * All three are reassigned 18 -> 1, then a FULL scan asserts no reference to 18
 * remains anywhere before the user row is deleted. Owner-approved 2026-09-14.
 *
 * Dry-run by default (backup + before-counts + plan, no writes). Pass --commit to
 * apply in ONE transaction. Backup + rollback SQL written to the scratchpad first.
 *
 * Usage:  node scripts/consolidate-super-admin.js            (dry run)
 *         node scripts/consolidate-super-admin.js --commit   (apply)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const COMMIT = process.argv.includes('--commit');
const DEAD = 18;          // account to remove
const KEEP = 1;           // authoritative Super Admin (owner's own)
const BACKUP_DIR = process.env.CONSOLIDATE_BACKUP_DIR
  || path.join(process.env.TEMP || '.', 'peso-consolidation-backup');

// Every (table,column) that can reference a user id — used for the pre-delete scan.
const REFS = [
  ['referral_outcomes','recorded_by'],['system_settings','updated_by'],['admin_audit_logs','admin_id'],
  ['applicant_profiles','user_id'],['applications','user_id'],['chathistory','user_id'],
  ['conversations','applicant_id'],['conversations','peso_admin_id'],['cover_letter_drafts','user_id'],
  ['pesoadmin_applications','applicant_id'],['pesoadmin_profiles','user_id'],['job_applications','applicant_id'],
  ['job_seeker_verifications','reviewed_by'],['job_seeker_verifications','user_id'],['linked_accounts','user_id'],
  ['messages','sender_id'],['pesoadmin_job_posts','peso_admin_id'],['resignation_letters','user_id'],
  ['resumes','user_id'],['uploaded_resumes','user_id'],['userprofiles','user_id'],['usertrackedjobs','user_id'],
  ['user_preferences','user_id'],['verification_history','performed_by'],['verification_history','user_id'],
  ['referral_queue','reviewed_by'],['referral_activity_log','actor_id'],['notifications','user_id'],
  ['user_ui_preferences','user_id'],['notification_preferences','user_id'],['user_certificates','user_id'],
  ['job_alerts_sent','user_id'],['job_alert_preferences','user_id'],['proactive_referral_candidates','reviewed_by'],
  ['saved_jobs','user_id'],['application_preferences','user_id'],['peso_events','created_by'],
  ['sms_outbox','user_id'],['phone_verifications','user_id'],['import_batches','user_id'],
  ['conversation_states','user_id'],['referral_preferences','user_id']
];

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2' }, timezone: 'Z'
});
const log = (...a) => console.log(...a);

async function scanFor(conn, id) {
  const hits = {};
  for (const [t, c] of REFS) {
    try {
      const [[row]] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${c}\` = ?`, [id]);
      if (row.n > 0) hits[`${t}.${c}`] = row.n;
    } catch { /* table/column absent — ignore */ }
  }
  return hits;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    log(`\n=== Super Admin consolidation — ${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${new Date().toISOString()} ===`);

    // ---- Guards -------------------------------------------------------------
    const [[keep]] = await conn.query('SELECT id, email, role, account_status FROM users WHERE id=?', [KEEP]);
    const [[dead]] = await conn.query('SELECT id, email, name, role, account_status FROM users WHERE id=?', [DEAD]);
    if (!keep) throw new Error(`Authoritative admin id ${KEEP} not found`);
    if (keep.role !== 'admin') throw new Error(`id ${KEEP} role is '${keep.role}', expected admin (Super Admin)`);
    if (!dead) { log(`id ${DEAD} already absent — nothing to do.`); return; }
    if (dead.role !== 'admin') throw new Error(`id ${DEAD} role is '${dead.role}', expected admin — aborting`);
    if (dead.email !== 'admin@hire.com') throw new Error(`id ${DEAD} email is '${dead.email}', expected admin@hire.com — aborting`);
    log(`Keep: ${KEEP} <${keep.email}> (${keep.account_status}). Remove: ${DEAD} <${dead.email}> "${dead.name}".`);

    // ---- Pre-scan: where does 18 appear? ------------------------------------
    const before = await scanFor(conn, DEAD);
    log('id 18 references BEFORE:', JSON.stringify(before));
    // Every table 18 appears in must be one of the three we know how to reassign.
    const REASSIGN = ['admin_audit_logs.admin_id', 'system_settings.updated_by', 'referral_activity_log.actor_id'];
    const unexpected = Object.keys(before).filter(k => !REASSIGN.includes(k));
    if (unexpected.length) throw new Error(`Unexpected references to 18 (not reassignable): ${unexpected.join(', ')} — aborting`);

    // ---- Backup (PK-aware; full rows so restore is possible regardless of schema) ----
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pkOf = async (table) => {
      const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`,
        [process.env.DB_NAME, table]);
      return rows.map(r => r.COLUMN_NAME);
    };
    const spec = [
      { table: 'admin_audit_logs', col: 'admin_id' },
      { table: 'system_settings', col: 'updated_by' },
      { table: 'referral_activity_log', col: 'actor_id' }
    ];
    const backup = { generated_at: new Date().toISOString(), dead_user: dead, keep_user: KEEP, tables: {} };
    const rb = [`-- Restore also requires re-creating user 18 (row in the JSON backup).`];
    const sqlVal = (v) => v === null ? 'NULL' : (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
    for (const { table, col } of spec) {
      const pk = await pkOf(table);
      const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE \`${col}\`=?`, [DEAD]);
      backup.tables[table] = { column: col, pk, rows };
      for (const r of rows) {
        const where = pk.map(k => `\`${k}\`=${sqlVal(r[k])}`).join(' AND ');
        rb.push(`UPDATE \`${table}\` SET \`${col}\`=${DEAD} WHERE ${where};`);
      }
    }
    fs.writeFileSync(path.join(BACKUP_DIR, `superadmin-backup-${stamp}.json`), JSON.stringify(backup, null, 2));
    fs.writeFileSync(path.join(BACKUP_DIR, `superadmin-rollback-${stamp}.sql`), rb.join('\n') + '\n');
    log(`Backup + rollback written to ${BACKUP_DIR}`);
    log(`Reassign -> ` + spec.map(s => `${s.table}:${backup.tables[s.table].rows.length}`).join('  '));

    if (!COMMIT) { log('\nDRY RUN — no writes. Re-run with --commit to apply.'); return; }

    // ---- Apply (single transaction) -----------------------------------------
    await conn.beginTransaction();
    const [a] = await conn.query('UPDATE admin_audit_logs SET admin_id=? WHERE admin_id=?', [KEEP, DEAD]);
    const [s] = await conn.query('UPDATE system_settings SET updated_by=? WHERE updated_by=?', [KEEP, DEAD]);
    const [g] = await conn.query('UPDATE referral_activity_log SET actor_id=? WHERE actor_id=?', [KEEP, DEAD]);
    // Assert no reference to 18 survives, THEN delete the user row.
    const remaining = await scanFor(conn, DEAD);
    if (Object.keys(remaining).length) throw new Error(`References to 18 survive after reassign: ${JSON.stringify(remaining)}`);
    const [d] = await conn.query('DELETE FROM users WHERE id=? AND role=? AND email=?', [DEAD, 'admin', 'admin@hire.com']);
    if (d.affectedRows !== 1) throw new Error(`Expected to delete exactly 1 user, deleted ${d.affectedRows}`);
    await conn.commit();
    log(`\nCOMMITTED -> reassigned audit:${a.affectedRows} settings:${s.affectedRows} reflog:${g.affectedRows}; deleted user 18.`);

    // ---- Verify -------------------------------------------------------------
    const [[gone]] = await conn.query('SELECT COUNT(*) n FROM users WHERE id=?', [DEAD]);
    const [[admins]] = await conn.query("SELECT COUNT(*) n FROM users WHERE role='admin'");
    const after = await scanFor(conn, DEAD);
    log(`user 18 exists: ${gone.n} (expect 0). Super Admins remaining: ${admins.n}. Dangling refs to 18: ${JSON.stringify(after)} (expect {}).`);
    log((gone.n === 0 && Object.keys(after).length === 0) ? '\n✓ Verified: id 18 removed, history preserved under id 1, no dangling references.' : '\n⚠ VERIFICATION PROBLEM — review above.');
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('\nCONSOLIDATION ERROR (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
