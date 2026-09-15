/**
 * migrate-event-banners-to-r2.js — one-off, RE-RUNNABLE migration of EXISTING event
 * banners from base64-in-DB (peso_events.banner_image) to Cloudflare R2 object storage.
 *
 * WHY: §41 stored event banners as base64 data URIs; the owner has approved moving them to
 * R2 (the deferred §41 storage-path migration). This is a STORAGE-PATH migration only — it
 * NEVER touches event business data (title, description, date, venue, status, publishing).
 *
 * SAFETY:
 *   • Rollback-preserving — the ORIGINAL base64 is archived into banner_image_legacy
 *     (migration 048) BEFORE banner_image is overwritten with the R2 URL. Nothing is
 *     destroyed; roll back with `--rollback`.
 *   • Idempotent — only rows whose banner_image is still a `data:` URI are migrated; already
 *     migrated rows (http URLs) are skipped. Safe to re-run after a partial run.
 *   • Refuses to run for real unless STORAGE_DRIVER=r2 AND R2_* are configured — otherwise it
 *     would write local `/uploads/...` paths into the DB. Run it in the prod (Render) env
 *     where R2 is configured, or use --dry-run anywhere (read-only preview).
 *
 * USAGE (owner-run, like npm run migrate):
 *   node scripts/migrate-event-banners-to-r2.js --dry-run     # preview (read-only)
 *   node scripts/migrate-event-banners-to-r2.js               # migrate (requires driver=r2)
 *   node scripts/migrate-event-banners-to-r2.js --rollback    # restore base64 from legacy
 *
 * PREREQUISITE: run `npm run migrate` first so migration 048 (banner_image_legacy) exists.
 */
require('dotenv').config();
const pool = require('../db');
const storageService = require('../services/storageService');
const { parseDataUri, bannerKey } = require('../services/eventBannerStorage');

const DRY = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

async function main() {
    const status = storageService.getStatus();
    const [[dbInfo]] = await pool.query('SELECT DATABASE() AS db');
    console.log(`[migrate-banners] db=${dbInfo.db} host=${process.env.DB_HOST || '(default)'} ` +
        `storageDriver=${status.driver} r2Configured=${status.r2Configured}` +
        `${DRY ? '  (DRY RUN — no writes)' : ROLLBACK ? '  (ROLLBACK)' : ''}`);

    // Guard: banner_image_legacy must exist (migration 048) before any WRITE. A --dry-run is
    // read-only and doesn't archive, so it can preview without 048 applied.
    if (!DRY) {
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'peso_events' AND COLUMN_NAME = 'banner_image_legacy'`
        );
        if (!cols.length) {
            console.error('ABORT: peso_events.banner_image_legacy is missing. Run `npm run migrate` (048) first.');
            return 1;
        }
    }

    if (ROLLBACK) {
        // Restore any row whose banner was changed away from base64 (a proper http URL OR a
        // malformed reference from a misconfigured R2_PUBLIC_BASE_URL) back to its archived
        // base64. Rows still holding base64 are left alone.
        const [r] = await pool.query(
            `UPDATE peso_events SET banner_image = banner_image_legacy
              WHERE banner_image_legacy IS NOT NULL AND banner_image NOT LIKE 'data:%'`
        );
        console.log(`Rollback: restored ${r.affectedRows} event(s) to their base64 banner. ` +
            `(R2 objects were left in place; delete them manually only after you are sure.)`);
        return 0;
    }

    if (!DRY) {
        if (status.driver !== 'r2') {
            console.error('ABORT: STORAGE_DRIVER is not "r2". Running now would write local /uploads paths into the DB.\n' +
                'Run this in the production environment (Render) where STORAGE_DRIVER=r2 and R2_* are set, or use --dry-run.');
            return 1;
        }
        if (!status.r2Configured) {
            console.error('ABORT: STORAGE_DRIVER=r2 but the R2_* env vars are not fully set.');
            return 1;
        }
        // R2_PUBLIC_BASE_URL must be the bucket's PUBLIC ORIGIN (an r2.dev URL or a custom
        // domain), NOT the bucket name — otherwise the stored banner_image would be an
        // unreachable string. Guard it so a misconfig can't write broken references.
        if (!/^https?:\/\//i.test(status.publicBase || '')) {
            console.error(`ABORT: R2_PUBLIC_BASE_URL must be a full public URL (https://…), but it is "${status.publicBase}".\n` +
                'That value is the bucket'+"'"+'s PUBLIC origin — enable Public access on the R2 bucket for an\n' +
                'r2.dev URL (https://pub-<hash>.r2.dev) or connect a custom domain — NOT the bucket name.\n' +
                'Fix R2_PUBLIC_BASE_URL and re-run.');
            return 1;
        }
    }

    const [rows] = await pool.query(
        `SELECT id, banner_image FROM peso_events WHERE banner_image LIKE 'data:%'`
    );
    console.log(`Found ${rows.length} event(s) with a base64 banner to migrate.`);
    let migrated = 0, skipped = 0, failed = 0;

    for (const row of rows) {
        const parsed = parseDataUri(row.banner_image);
        if (!parsed) {
            console.warn(`  event ${row.id}: banner is not a decodable base64 data URI — skipped.`);
            skipped++;
            continue;
        }
        const key = bannerKey(parsed.buffer, parsed.ext);
        if (DRY) {
            console.log(`  [dry] event ${row.id}: ${parsed.mime} ${parsed.buffer.length}B → ${key}`);
            migrated++;
            continue;
        }
        try {
            const url = await storageService.save(key, parsed.buffer, parsed.mime);
            // Archive the original base64 (if not already), then point banner_image at the R2
            // URL. The `LIKE 'data:%'` guard keeps it idempotent under a re-run.
            const [res] = await pool.query(
                `UPDATE peso_events
                    SET banner_image_legacy = COALESCE(banner_image_legacy, banner_image),
                        banner_image = ?
                  WHERE id = ? AND banner_image LIKE 'data:%'`,
                [url, row.id]
            );
            if (res.affectedRows === 1) { console.log(`  event ${row.id}: migrated → ${url}`); migrated++; }
            else { console.warn(`  event ${row.id}: no row updated (already migrated?) — skipped.`); skipped++; }
        } catch (e) {
            console.error(`  event ${row.id}: FAILED — ${e.message}`);
            failed++;
        }
    }

    console.log(`Done. migrated=${migrated} skipped=${skipped} failed=${failed}`);
    if (!DRY && migrated > 0) {
        console.log('Verify the R2 URLs render (Landing carousel + Events pages), then the base64 ' +
            'originals remain safe in banner_image_legacy for rollback (`--rollback`).');
    }
    return failed ? 1 : 0;
}

main()
    .then((code) => pool.end().then(() => process.exit(code)))
    .catch((e) => { console.error('[migrate-banners] fatal:', e); pool.end().finally(() => process.exit(1)); });
