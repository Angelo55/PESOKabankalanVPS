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

## Phase 1 — Staging environment

**Goal.** A safe place to rehearse Phase 2 (and every future change) before prod.
Zero added cost: reuse the EC2, add a second free Supabase project.

**Design.**
- **Staging DB:** a 2nd Supabase **free** project (free tier allows 2). Apply
  `postgres/schema.sql` to it (`node scripts/pg-bootstrap.js`), like prod.
- **Staging app:** a 2nd PM2 app on the same EC2, **port 5001**, from a separate
  checkout (`/var/www/pesokabankalan-staging`) on a `staging` branch (or the same
  `main`), with its own `.env` (staging Supabase URL, `PORT=5001`,
  `FRONTEND_URL=https://staging.pesokabankalan.tech`, its own OAuth redirect).
- **Web:** Nginx server block for `staging.pesokabankalan.tech` → proxy to
  `127.0.0.1:5001`; `certbot -d staging.pesokabankalan.tech`.
- **DNS:** `A staging → 56.10.113.135`.
- **Frontend:** build with `VITE_API_URL=https://staging.pesokabankalan.tech/api`.
- **Google:** add the staging origin + redirect URI to the OAuth client.

**Guardrail.** Staging uses its **own** Supabase project — never point staging at the
prod DB. Keep staging behind a note that it is non-production.

---

## Phase 2 — R2 for PII binaries + DB capacity  *(decision: option a)*

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
