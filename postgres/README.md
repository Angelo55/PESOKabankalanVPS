# Postgres / Supabase port (experiment)

Branch: `experiment/postgres-supabase` — **isolated**. `main` still runs on TiDB
(MySQL) and is not touched. The driver is selected at boot by `DB_CLIENT`
(default `mysql`); nothing changes for production unless that env var is set.

## What this is

A full data-layer re-platform of the PESO Kabankalan backend from TiDB/MySQL to
PostgreSQL (Supabase), done as a separate experiment. The application source SQL
is **unchanged** — MySQL→Postgres translation happens in a driver adapter, so the
existing (MySQL-coupled) test suite stays green on `main`.

## Moving parts

| File | Role |
|------|------|
| `dbPgAdapter.js` (repo root) | mysql2-compatible facade over `pg`: `?`→`$n` placeholders, `IN (?)` array expansion, `insertId` via auto `RETURNING id`, transactions via `getConnection()`, and MySQL→Postgres dialect translation (`ON DUPLICATE KEY UPDATE`→`ON CONFLICT`, `INSERT IGNORE`, `DATE_ADD/SUB`, `DATE_FORMAT`, `TIMESTAMPDIFF`, `IFNULL`, `RAND`, `CURDATE`, bare `INTERVAL n UNIT`, `? IS NULL` type-anchoring, boolean→0/1). |
| `db.js` | Chooses the adapter when `DB_CLIENT=postgres`; otherwise mysql2 as before. |
| `postgres/schema.sql` | Full Postgres schema: 58 tables, FKs, indexes, 25 updated-at triggers, seed rows. Built from a read-only `SHOW CREATE TABLE` introspection of the live TiDB schema (the authoritative current shape). |
| `scripts/pg-bootstrap.js` | Applies `schema.sql`. `--reset` drops/recreates `public` (guarded to staging-named DBs unless `PG_BOOTSTRAP_FORCE=1`). |
| `test/pgAdapter.test.js` | Adapter unit tests (placeholders, IN-expansion, dialect translation, upsert mapping). |

### Upsert mapping (`CONFLICT_TARGETS` in `dbPgAdapter.js`)

`ON DUPLICATE KEY UPDATE` becomes `ON CONFLICT (<cols>) DO UPDATE SET …` driven by
a per-table map of conflict columns. A table **not** in the map (e.g.
`userprofiles`, `linked_accounts`, `cover_letter_drafts` — no unique key in MySQL)
has the clause **stripped** to a plain INSERT, preserving the MySQL no-op behavior.
Every entry in the map is verified to match a real UNIQUE/PK constraint in
`schema.sql`.

## Run it against a local Postgres (offline validation)

```bash
docker run -d --name peso-pg-experiment -e POSTGRES_PASSWORD=peso -e POSTGRES_DB=job_tracker -p 5433:5432 postgres:16
DATABASE_URL='postgres://postgres:peso@localhost:5433/job_tracker' DB_SSL=false node scripts/pg-bootstrap.js --reset
DB_CLIENT=postgres DATABASE_URL='postgres://postgres:peso@localhost:5433/job_tracker' DB_SSL=false PORT=5055 node server.js
```

## Live Supabase project (Phase 4 — DONE except the app boot)

Project **peso-kabankalan** (org `angelo55's projects`), ref
`xdtmyjknyimuxohalzyo`, region `ap-southeast-1`, Postgres **17.6**.
Direct host: `db.xdtmyjknyimuxohalzyo.supabase.co`.

- Schema applied via a Supabase migration (`peso_kabankalan_initial_schema`):
  58 tables / 39 FKs / 137 indexes / 25 triggers / 13 seed rows — exact match to
  the local validation.
- Dialect parity confirmed against real Postgres 17 (IDENTITY + RETURNING id, all
  three upsert forms, the ON UPDATE trigger emulation incl. explicit-value-wins,
  bare INTERVAL, `?::text IS NULL`).
- **Security hardened** (migration `enable_rls_default_deny_and_pin_trigger_search_path`):
  RLS enabled default-deny on all 58 tables (the anon/PostgREST roles get no
  access; the app's direct `postgres` connection bypasses RLS, so it is
  unaffected), and a fixed `search_path` pinned on the 5 trigger functions. The
  only remaining advisor note is `rls_enabled_no_policy` at INFO — expected and
  desired for a direct-connection app.
- Minimal non-credential seed present: users 30002 (PESO admin) + 100 (seeker,
  password NULL — set a real one before any authed test), job post 1, event 1.

### Remaining: boot the app end-to-end against Supabase

The DB password is required and the session guardrail blocks setting/hashing it,
so this step needs the owner. In Supabase → **Project Settings → Database →
Connection string**, copy the **Session pooler** URI (IPv4-friendly; direct
`db.<ref>` is IPv6-only on the free tier) and its password, then:

```bash
DB_CLIENT=postgres DATABASE_URL='<supabase-session-pooler-uri>' PORT=5055 node server.js
```

Supabase requires TLS; the adapter connects over TLS without hard-failing the
chain. Do **not** set `DB_SSL=false` for Supabase. Keep the URI in `.env` (never
committed) or the shell env — it is a secret.

## Validation status

- `postgres/schema.sql` applies cleanly on Postgres 16 (58 tables / FKs / indexes /
  25 triggers / seed).
- Adapter unit tests: **15/15**. Full suite on the unchanged mysql path: **242/242**.
- Smoke-tested against the local container on the Postgres path: public + authed
  read endpoints, `/usage` + `/peso-admin/usage`, and write/upsert paths
  (saved-jobs INSERT-SELECT upsert, UI/notification/job-alert preference upserts,
  `proactive_match_jobs` re-enqueue) all pass with a clean server log.
- **Not yet run against Supabase itself** — Phase 4 above is the next step and
  needs the project + connection string.
