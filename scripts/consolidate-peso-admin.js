/**
 * consolidate-peso-admin.js — one-off controlled data migration.
 *
 * WHAT: reassigns all live PESO-office content owned by legacy PESO-owner accounts
 * (demoted to 'applicant' but still owning jobs/threads) to the sole authoritative
 * PESO Administrator, peso@kabankalancity.gov.ph. Reassignment only — NO account
 * deletions, NO status changes, NO rewriting of historical actor references
 * (referral reviewer / activity-log actor / outcome recorder are left intact for
 * audit truth), and NO change to any job-seeker-side data.
 *
 * SCOPE (decided with the owner, 2026-09-14):
 *   pesoadmin_job_posts.peso_admin_id : 16,17,25 -> 30002   (job posts + their apps/referrals ride along)
 *   conversations.peso_admin_id       : 16,17,25 -> 30002   (no (job,applicant) collisions — verified)
 *   messages.sender_id                : 16       -> 30002   (16's office-authored messages only;
 *                                                            17's lone message is a SEEKER message — untouched; 25 has none)
 *
 * SAFETY: dry-run by default (backup + before-counts + plan, no writes). Pass
 * --commit to apply, wrapped in ONE transaction. A timestamped backup of every
 * row that will change (plus a rollback .sql) is written to the scratchpad BEFORE
 * any write. Read-only introspection guards abort on any surprise.
 *
 * Usage:  node scripts/consolidate-peso-admin.js            (dry run)
 *         node scripts/consolidate-peso-admin.js --commit   (apply)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const COMMIT = process.argv.includes('--commit');
const TARGET_EMAIL = 'peso@kabankalancity.gov.ph';
const LEGACY_IDS = [16, 17, 25];
const BACKUP_DIR = process.env.CONSOLIDATE_BACKUP_DIR
  || path.join(process.env.TEMP || '.', 'peso-consolidation-backup');

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2' }, timezone: 'Z'
});

const log = (...a) => console.log(...a);
const list = LEGACY_IDS.join(',');

async function ownershipCounts(conn) {
  const ids = `${list},30002`;
  const [jobs] = await conn.query(
    `SELECT peso_admin_id id, COUNT(*) n FROM pesoadmin_job_posts WHERE peso_admin_id IN (${ids}) GROUP BY peso_admin_id`);
  const [convos] = await conn.query(
    `SELECT peso_admin_id id, COUNT(*) n FROM conversations WHERE peso_admin_id IN (${ids}) GROUP BY peso_admin_id`);
  const [msgs] = await conn.query(
    `SELECT sender_id id, COUNT(*) n FROM messages WHERE sender_id IN (${ids}) GROUP BY sender_id`);
  const [totals] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM pesoadmin_job_posts) jobs,
            (SELECT COUNT(*) FROM conversations)       convos,
            (SELECT COUNT(*) FROM messages)            messages,
            (SELECT COUNT(*) FROM job_applications)    job_applications,
            (SELECT COUNT(*) FROM referral_queue)      referral_queue`);
  const shape = (rows) => rows.reduce((m, r) => (m[r.id] = Number(r.n), m), {});
  return { jobs: shape(jobs), convos: shape(convos), msgs: shape(msgs), totals: totals[0] };
}

(async () => {
  const conn = await pool.getConnection();
  try {
    log(`\n=== PESO Admin consolidation — ${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${new Date().toISOString()} ===`);

    // ---- Guards (abort on any surprise) -------------------------------------
    const [[target]] = await conn.query('SELECT id, role FROM users WHERE email=?', [TARGET_EMAIL]);
    if (!target) throw new Error(`Target ${TARGET_EMAIL} not found`);
    if (target.id !== 30002) throw new Error(`Target id changed: expected 30002, got ${target.id}`);
    if (target.role !== 'peso_administrator')
      throw new Error(`Target role is '${target.role}', expected peso_administrator`);
    const [legacyRows] = await conn.query(
      `SELECT id, email, role FROM users WHERE id IN (${list})`);
    if (legacyRows.length !== LEGACY_IDS.length)
      throw new Error(`Expected ${LEGACY_IDS.length} legacy accounts, found ${legacyRows.length}`);
    for (const u of legacyRows) {
      if (u.role !== 'applicant')
        throw new Error(`Legacy account ${u.id} role is '${u.role}', expected applicant — aborting`);
    }
    // A PESO Administrator other than 30002 must not have appeared.
    const [[otherAdmin]] = await conn.query(
      "SELECT COUNT(*) n FROM users WHERE role IN ('employer','peso_administrator') AND id<>30002");
    if (otherAdmin.n !== 0) throw new Error(`Unexpected extra peso_administrator accounts: ${otherAdmin.n}`);
    log('Guards passed: target=30002 (peso_administrator), legacy=16,17,25 (applicant), no other admins.');

    // ---- Backup (BEFORE any write) ------------------------------------------
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const [bkJobs] = await conn.query(
      `SELECT id, peso_admin_id FROM pesoadmin_job_posts WHERE peso_admin_id IN (${list})`);
    const [bkConvos] = await conn.query(
      `SELECT id, peso_admin_id FROM conversations WHERE peso_admin_id IN (${list})`);
    const [bkMsgs] = await conn.query(
      `SELECT id, sender_id FROM messages WHERE sender_id = 16`);
    const backup = { generated_at: new Date().toISOString(), target: 30002, legacy: LEGACY_IDS,
      pesoadmin_job_posts: bkJobs, conversations: bkConvos, messages_sender16: bkMsgs };
    const backupPath = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    // Rollback SQL that restores every original owner id.
    const rb = [];
    for (const r of bkJobs) rb.push(`UPDATE pesoadmin_job_posts SET peso_admin_id=${r.peso_admin_id} WHERE id=${r.id};`);
    for (const r of bkConvos) rb.push(`UPDATE conversations SET peso_admin_id=${r.peso_admin_id} WHERE id=${r.id};`);
    for (const r of bkMsgs) rb.push(`UPDATE messages SET sender_id=${r.sender_id} WHERE id=${r.id};`);
    const rollbackPath = path.join(BACKUP_DIR, `rollback-${stamp}.sql`);
    fs.writeFileSync(rollbackPath, rb.join('\n') + '\n');
    log(`Backup written: ${backupPath}`);
    log(`Rollback  written: ${rollbackPath}`);
    log(`Rows to change -> jobs:${bkJobs.length}  conversations:${bkConvos.length}  messages:${bkMsgs.length}`);

    // ---- Before counts ------------------------------------------------------
    const before = await ownershipCounts(conn);
    log('\nBEFORE ownership:', JSON.stringify(before, null, 0));

    if (!COMMIT) {
      log('\nDRY RUN — no writes performed. Re-run with --commit to apply.');
      return;
    }

    // ---- Apply (single transaction) -----------------------------------------
    await conn.beginTransaction();
    const [u1] = await conn.query(
      `UPDATE pesoadmin_job_posts SET peso_admin_id=30002 WHERE peso_admin_id IN (${list})`);
    const [u2] = await conn.query(
      `UPDATE conversations SET peso_admin_id=30002 WHERE peso_admin_id IN (${list})`);
    const [u3] = await conn.query(
      `UPDATE messages SET sender_id=30002 WHERE sender_id = 16`);
    await conn.commit();
    log(`\nCOMMITTED -> jobs:${u1.affectedRows}  conversations:${u2.affectedRows}  messages:${u3.affectedRows}`);

    // ---- After counts + verification ---------------------------------------
    const after = await ownershipCounts(conn);
    log('AFTER ownership:', JSON.stringify(after, null, 0));
    const problems = [];
    for (const id of LEGACY_IDS) {
      if (after.jobs[id]) problems.push(`legacy ${id} still owns ${after.jobs[id]} jobs`);
      if (after.convos[id]) problems.push(`legacy ${id} still owns ${after.convos[id]} conversations`);
    }
    if (after.msgs[16]) problems.push(`sender 16 still on ${after.msgs[16]} messages`);
    // Row totals must be identical (reassignment moves, never loses).
    for (const k of ['jobs', 'convos', 'messages', 'job_applications', 'referral_queue']) {
      if (before.totals[k] !== after.totals[k])
        problems.push(`TOTAL ${k} changed ${before.totals[k]} -> ${after.totals[k]} (rows lost!)`);
    }
    if (problems.length) { log('\n⚠ VERIFICATION PROBLEMS:'); problems.forEach(p => log('  - ' + p)); }
    else log('\n✓ Verified: all legacy PESO ownership now resolves to 30002; no rows lost.');
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('\nMIGRATION ERROR (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
