/**
 * Provision Supabase Storage buckets for the PII/media re-platform (Phase 2).
 * Idempotent: creates the buckets only if absent. Safe to re-run.
 *
 *   avatars  — PUBLIC  (display images; served by public object URL)
 *   resumes  — PRIVATE (PII PDFs; streamed through the authenticated API only)
 *
 * Runs against the DB in DATABASE_URL (prod Supabase via .env). Creating a row in
 * storage.buckets is Supabase's registry for a bucket; objects then flow through the
 * Storage S3/REST endpoint with the storage credentials (generated in the dashboard).
 *
 *   node scripts/provision-supabase-storage.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const BUCKETS = [
  { id: 'avatars', public: true },
  { id: 'resumes', public: false },
];

const ssl = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });
const q = (s, p) => pool.query(s, p).then((r) => r.rows);

(async () => {
  // Confirm the storage schema exists (it always does on a Supabase project).
  const [{ has }] = await q(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='storage' AND table_name='buckets') AS has"
  );
  if (!has) throw new Error('storage.buckets not found — is this a Supabase project?');

  console.log('Buckets BEFORE:');
  for (const b of await q('SELECT id, public FROM storage.buckets ORDER BY id')) {
    console.log(`  ${b.id} (public=${b.public})`);
  }

  for (const b of BUCKETS) {
    await pool.query(
      'INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, $2) ON CONFLICT (id) DO NOTHING',
      [b.id, b.public]
    );
  }

  console.log('\nBuckets AFTER:');
  for (const b of await q('SELECT id, public FROM storage.buckets ORDER BY id')) {
    console.log(`  ${b.id} (public=${b.public})`);
  }
  await pool.end();
  console.log('\nOK — buckets provisioned (idempotent).');
})().catch((e) => { console.error('PROVISION FAILED:', e.message); process.exit(1); });
