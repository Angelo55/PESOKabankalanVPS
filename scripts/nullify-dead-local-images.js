/**
 * nullify-dead-local-images.js — one-off, RE-RUNNABLE cleanup of DEAD local image
 * references left over from before object storage (R2) was adopted.
 *
 * WHY: featured images (and, historically, event banners) uploaded before R2 were
 * stored as `/uploads/<key>` paths pointing at Render's LOCAL disk. Render's filesystem
 * is EPHEMERAL, so those files were wiped on the next deploy — the DB still references
 * them, but the files 404. New uploads correctly go to R2 (§41) and are unaffected.
 *
 * This sets those dead `/uploads/...` references to NULL so the card falls back to its
 * branded placeholder instead of firing a 404 request. It NEVER touches base64 (`data:`)
 * or object-storage (`http(s)://`) references — only the dead local paths — and it does
 * NOT delete any files (there is nothing on disk to delete). The images themselves are
 * unrecoverable; a PESO admin re-uploading the image restores it (straight to R2).
 *
 * Safe: additive/idempotent, only NULLs `/uploads/%` values, prints every change.
 * USAGE (owner-run, read-only preview first):
 *   node scripts/nullify-dead-local-images.js --dry-run
 *   node scripts/nullify-dead-local-images.js
 */
require('dotenv').config();
const pool = require('../db');

const DRY = process.argv.includes('--dry-run');

async function sweep(table, column, label) {
    const [rows] = await pool.query(
        `SELECT id, ${column} AS ref FROM ${table} WHERE ${column} LIKE '/uploads/%'`
    );
    console.log(`\n[${label}] ${rows.length} dead local reference(s):`);
    rows.forEach((r) => console.log(`  #${r.id}: ${r.ref}`));
    if (rows.length && !DRY) {
        const [res] = await pool.query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} LIKE '/uploads/%'`);
        console.log(`  → nulled ${res.affectedRows} row(s).`);
    }
    return rows.length;
}

async function main() {
    let dbName = process.env.DB_NAME || '(default)';
    try {
        const [[db]] = await pool.query(pool.isPostgres ? 'SELECT current_database() AS db' : 'SELECT DATABASE() AS db');
        if (db && db.db) dbName = db.db;
    } catch { /* log-only, ignore */ }
    console.log(`[nullify-dead-local-images] db=${dbName} driver=${pool.isPostgres ? 'postgres' : 'mysql'}${DRY ? '  (DRY RUN — no writes)' : ''}`);
    let total = 0;
    total += await sweep('pesoadmin_job_posts', 'featured_image', 'Local Employment Board / job featured images');
    total += await sweep('peso_events', 'banner_image', 'PESO Events banners');
    console.log(`\nDone. ${total} dead reference(s) ${DRY ? 'found (dry run)' : 'cleared'}.`);
    if (total && !DRY) console.log('Affected postings/events now show the branded placeholder; re-upload the image to restore it (it will go to R2).');
    return 0;
}

main()
    .then((code) => pool.end().then(() => process.exit(code)))
    .catch((e) => { console.error('[nullify-dead-local-images] fatal:', e.message); pool.end().finally(() => process.exit(1)); });
