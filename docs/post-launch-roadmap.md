# PESO Kabankalan — Post-Launch Roadmap (VPS + Supabase line)

**Status:** Production is **LIVE** at https://pesokabankalan.tech (2026-09-16) — AWS EC2
`t3.small` (`ap-southeast-1`, Elastic IP `56.10.113.135`) → Nginx + HTTPS → PM2 →
Supabase PostgreSQL 17.6 (pg-adapter path). See `deploy/vps-runbook.md` and
`DEPLOYMENT.md`.

This roadmap sequences the deferred items from the architecture skill (§25 worker
split, §41 object storage, §32 SMS) plus a staging environment. **Decisions are
locked** as noted per phase.

**Sequence & dependencies:** Phase 0 → Phase 1 → Phase 2 (rehearse on staging first)
→ Phase 3 (anytime). Phase 1 gates Phase 2 — never run the PII migration straight
against prod.

| Phase | Item | Decision | Effort | Cost | Risk |
|---|---|---|---|---|---|
| 0 | Fix worker real-time | **Single-process** (WORKER_MODE unset) | S | $0 | Low |
| 1 | Staging environment | 2nd Supabase project + `staging.` on same EC2 | M | $0 | Low |
| 2 | R2 for PII + DB capacity | **(a) Migrate PII to private R2 + presigned URLs** | L | $0 | Med |
| 3 | SMS activation | **TextBee dev provider** | S | $0 | Low |

---

## Phase 0 — Restore worker real-time (single-process)

**Problem.** The VPS currently runs the worker **split** (`peso-api` `WORKER_MODE=web`
+ `peso-worker`) **without Redis**. SKILL §25 is explicit: *"do NOT set
`WORKER_MODE=web` without the Redis adapter or worker→client real-time goes dark."*
So worker-originated real-time (referral-issued pushes, live score updates, some
notifications) is falling back to poll backstops. §25's prod stance is
**single-service, WORKER_MODE unset, workers share `io`**.

**Fix.** Collapse `ecosystem.config.js` to one `peso-app` running `server.js` with no
`WORKER_MODE` (API + the six workers in one process, sharing `io`). PM2 `autorestart`
covers crashes; fine on 2 GB.

**Apply (on the VPS):**
```bash
cd /var/www/pesokabankalan && git pull
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
pm2 status
pm2 logs peso-app --lines 20 --nostream | grep -E '\[DB\]|\[Worker|PostgreSQL|listening'
```
**Verify:** one `peso-app` online; `[DB] Connected (postgres)`; workers started;
a referral-issued / notification event pushes in real time (no ~90s poll lag).

**Future option (not now):** re-introduce the split + a Redis adapter
(socket.io-redis, Redis local or Upstash free) for crash isolation **and** real-time,
once traffic justifies it. Keep the split block commented in `ecosystem.config.js`.

---

## Phase 1 — Staging environment  *(decision: Option A — lightweight, staging DB only)*

**Goal.** A safe place to rehearse Phase 2 (and future DB changes) before prod, at
**zero infra cost**. A full EC2 staging site (subdomain + 2nd PM2 + cert — Option B)
was considered and deferred; promote to it later only if a shareable UAT URL is needed.

**Design (Option A).**
- **Staging DB:** a 2nd Supabase **free** project (`peso-kabankalan-staging`,
  region `ap-southeast-1`; free tier allows 2 projects). Apply `postgres/schema.sql`
  with `scripts/pg-bootstrap.js` pointed at its **session-pooler** URL.
- **Run against it on demand:** point a LOCAL run (or a temporary VPS run) at the
  staging `DATABASE_URL` to rehearse a migration/change, verify, then apply to prod.
- No subdomain, no 2nd cert, no 2nd PM2 process — nothing new to maintain.

**Guardrail.** Never point the live prod process at the staging DB or vice-versa;
keep the staging URL out of the committed repo (local shell / `.env` only). Rehearse
every Phase 2 migration on staging first.

---

## Phase 2 — object storage for PII binaries + DB capacity  *(decision: Supabase Storage)*

**Provider decision (2026-09-16): Supabase Storage, not Cloudflare R2.** It's already
in the project, S3-compatible (reuses `@aws-sdk/client-s3`), and its 1 GB free storage
is separate from the 500 MB DB cap. Audit showed prod is ~13 MB with almost no PII, so
this is proactive plumbing (future uploads land in storage, no big migration).

**STATUS — code SHIPPED (avatars + résumé snapshots), activation pending S3 keys:**
- Buckets created: `avatars` (public) + `resumes` (private) via
  `scripts/provision-supabase-storage.js`.
- `storageService` gained a `supabase` driver + private save/stream/remove.
- Résumé snapshots → private bucket, streamed through the owner-scoped API; avatars →
  public bucket URL. Both gated on a durable off-DB driver — on `local` they stay
  base64-in-DB (no durability regression), so the code is a no-op until
  `STORAGE_DRIVER=supabase`. Schema: `application_resumes.file_key` (Supabase ALTER
  applied; `schema.sql` + migration 054 updated).
- **Remaining to activate:** generate Supabase S3 keys (dashboard → Storage → S3 Access
  Keys) → set `STORAGE_DRIVER=supabase` + `SUPABASE_S3_ACCESS_KEY_ID/SECRET` in `.env`
  (local to test, then VPS) → `git pull` + `pm2 reload`. Letters/certs deferred.

### (Original R2 plan, superseded by Supabase Storage above)

**Why.** Supabase free tier caps the **DB at 500 MB**. Today PII binaries are base64
in Postgres — `application_resumes` (a full PDF per application), résumé uploads,
referral letters, certificates, avatars — which grows into the cap under real use.
Job featured images and event banners are already on R2 (§41/§45.6); this extends R2
to the PII binaries via a **private** bucket. R2 free tier = 10 GB, no egress fees →
stays $0.

**Approach (rehearse on staging first — Phase 1):**
1. **Private bucket** `peso-pii` (separate from the public job-image bucket). Extend
   `services/storageService.js` (or a sibling `piiStorageService`) with a private
   driver: `save`, `remove`, and **short-TTL presigned GET** (`@aws-sdk/s3-request-presigner`).
2. **Reads go through authorized presigned URLs**, minted per request by the existing
   owner-scoped endpoints (résumé stream, letter fetch, cert view, avatar) — never a
   public URL. Short TTL (e.g. 60–300 s). Auth stays enforced at the API before the
   URL is minted.
3. **Migration** (archive-first, like event banners §45.6): a script copies each
   base64 blob to R2, stores the R2 key, and only then clears the base64 column;
   keep a rollback archive. Idempotent, dry-run-first, transactional.
4. **Invariants preserved:** 0.13 (referral letters durable — ensure R2 durability or
   keep a DB fallback for letters specifically), 0.5 (no new uploads to local disk),
   owner-scoping on every read. `verification_id_type`/PII access rules unchanged.
5. **Order:** avatars + certs first (lowest risk) → résumé uploads/`application_resumes`
   → referral letters last (most sensitive; verify durability + 0.13).

**Alternative considered:** Supabase Pro ($25/mo, 8 GB DB) — rejected for now in favor
of the $0 R2 path (revisit if the migration proves too costly to maintain).

**Risk:** PII access control — presigned URLs MUST be short-TTL and only minted after
the API authorizes the caller. Get this right; test on staging.

---

## Phase 3 — SMS activation  *(decision: TextBee dev provider)*

**Why/when.** SMS for referral events is built and ship-dark (§32). Use the **TextBee**
provider (real delivery, dev-grade, env-only — no sender name; the paired Android
device is the endpoint). Semaphore (production, funded) stays the later option.

**Activate:**
1. Set in the prod `.env`: `SMS_PROVIDER=textbee`, `TEXTBEE_API_KEY=…`,
   `TEXTBEE_DEVICE_ID=…`.
2. Flip the system setting `sms_notifications_enabled` on (Super Admin → Settings, or
   the settings service). Fan-out is referral events only (`smsTemplates.SMS_FANOUT_TYPES`).
3. A recipient still needs a **verified + opted-in** phone (`sms_opt_in`,
   `phone_verified_at`); the in-app row remains the durable deliverable (0.11), SMS is
   best-effort (0.1).
4. Verify: trigger a referral, confirm the SMS worker sends and the in-app row still
   writes. Watch `/admin/sms` monitor.

**Do not** wire SMS into non-referral notifications, and never remove the in-app row.

---

## Cross-cutting notes
- **Free-tier pausing:** the running worker keeps Supabase active (no idle-pause) as
  long as `peso-app`/`peso-worker` runs.
- **Redeploy:** `cd /var/www/pesokabankalan && git pull && npm ci && (cd job-tracker-frontend && npm ci && npm run build) && pm2 reload ecosystem.config.js`.
- **Migrations:** on the pg path, `postgres/schema.sql` owns the schema; `npm run
  migrate` is the MySQL/TiDB path — do not run it against Supabase.
- **Secrets:** never commit `.env`; the R2 keys and any SMS keys are env-only.
