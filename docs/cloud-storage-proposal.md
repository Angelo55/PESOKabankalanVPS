# Production / Cloud Storage Proposal — PESO Kabankalan Referral System

**Status:** PROPOSAL (infrastructure phase, deferred-but-approved track — SKILL §25). Not yet implemented.
**Date:** 2026-09
**Author:** Engineering
**Decision requested:** adopt an object-storage provider to move durable binaries off base64-in-TiDB.
**Recommendation (TL;DR): Cloudflare R2**, behind a swappable `objectStorageService` provider
abstraction, rolled out flag-gated and additively — $0/month at capstone scale, S3-compatible so it
stays portable to AWS S3 / Backblaze B2 for production, and **zero egress fees** (the cost that
actually bites a document-serving app).

---

## 1. The problem — why this phase exists

Today, **every durable binary lives in TiDB as base64** (invariant 0.5 / 0.13). That was the correct
stopgap: Render's filesystem is **ephemeral** (wiped on every deploy), so the database was the only
durable store available without adding a dependency. It is not the right long-term home.

**What is currently base64-in-DB:**

| Data | Table / column | Type | Notes |
|---|---|---|---|
| Referral letters | `referral_letter_files`, `referral_letter_archive` | PDF (~397 KB each) | **Signed government documents** — durability + auditability are non-negotiable (0.13) |
| Application résumé snapshots | `application_resumes` | PDF | Immutable per-application snapshot (§7.3) |
| Supporting certificates | `user_certificates`, `application_certificates` | PDF / image | Evidence-only since §40 |
| Event banners | `peso_events.banner_image` | JPEG | Low-volume, list payloads inline them (§31.4) |
| Avatars | `users.avatar_url` + `avatar_thumb` | base64 data URI | ~319 KB originals; client-downscaled thumbs (§10.8) |

**Why base64-in-TiDB is a liability at scale:**

1. **Storage bloat + cost.** Base64 inflates bytes by ~33%. TiDB Cloud Serverless (the current tier)
   bills on storage and has a free-tier storage ceiling; PDFs/images eat it far faster than relational
   rows. A few hundred referral letters + resumes already dominate the row bytes.
2. **Query/latency risk.** Every list endpoint must carefully avoid `SELECT`ing the LONGTEXT blob
   (the ATS avatar bug and the `COALESCE(avatar_thumb, avatar_url)` rule in §10.8 exist precisely
   because inlining base64 in a list payload cost megabytes per request).
3. **Backup/replication weight.** DB backups and any future read-replica carry all the binary bytes,
   multiplying storage and transfer.
4. **No CDN / no offload.** Serving a letter or banner streams bytes through the Render app process
   (CPU + bandwidth on a constrained free instance), instead of letting a storage/CDN edge do it.
5. **Wrong tool.** Object storage is purpose-built for this: cheap, horizontally scalable, CDN-frontable,
   with presigned-URL access control and lifecycle/versioning for retention.

**Goal:** move the durable binaries to object storage while **preserving every invariant** — durability
(0.13), owner-scoped access (§12), "never fail the primary action" (0.1), and the archive-before-regenerate
rule for letters (0.13) — and doing it **additively and flag-gated**, never a hard cutover on live
government data.

---

## 2. Options considered

Evaluated against the capstone priority (**cost-effective now, scalable to production later**) and the
current **Render (backend) + Vercel (frontend) + TiDB** topology. S3-API compatibility is weighted
heavily because it (a) reuses familiar SDK patterns and (b) prevents lock-in — a provider swap becomes
an endpoint change.

| Provider | Free tier | Storage $/GB-mo | **Egress** | S3-compatible | Best for | Verdict |
|---|---|---|---|---|---|---|
| **Cloudflare R2** ⭐ | 10 GB + 1M/10M ops | ~$0.015 | **$0 (always)** | ✅ | Cost + portability + serving | **RECOMMENDED** |
| AWS S3 | 5 GB (12 mo only) | ~$0.023 | ~$0.09/GB | ✅ (native) | Ecosystem, maturity | Strong, but egress + short free tier |
| Backblaze B2 | 10 GB | ~$0.006 | Free ≤3× storage, then ~$0.01 (free via Cloudflare) | ✅ | Cheapest storage | Good budget alt; smaller ecosystem |
| Supabase Storage | 1 GB | ~$0.021 | 2 GB free then ~$0.09 | ✅ | Policy-based access, DX | Adds a platform; free tier pauses when idle |
| Cloudinary | 25 GB "credits" | usage-metered | metered | ❌ | Image transforms, avatars/banners | Media-centric; weak for PDFs; lock-in |
| Vercel Blob | 1 GB | ~$0.023 | ~$0.05/GB after free | ❌ (proprietary) | Vercel-native frontend uploads | Backend is on Render, not Vercel — poor fit; pricey |
| Render Persistent Disk | — | paid instance only | n/a | ❌ (block, not object) | Solving ephemerality only | **Rejected** — tied to one instance, no CDN, no presign, no horizontal scale (same trap as §25.2) |

### Per-criterion comparison (top 3 contenders)

| Criterion | Cloudflare R2 | AWS S3 | Backblaze B2 |
|---|---|---|---|
| **Cost (capstone)** | $0 (free tier covers it) | $0 for 12 mo, then storage+egress | $0 (free tier) |
| **Cost (production)** | Storage-only, **no egress** — most predictable | Storage + per-GB egress (can dominate) | Cheapest storage; egress free via CF |
| **Scalability** | Effectively unlimited, edge-distributed | Effectively unlimited, most mature | Unlimited; fewer regions |
| **Reliability** | 99.9% SLA (paid), Cloudflare backbone | Industry benchmark (11 9's durability) | 99.9%; solid, smaller footprint |
| **Security** | Private buckets, scoped API tokens, TLS, encryption at rest (default) | IAM (finest-grained), SSE, VPC endpoints | App keys w/ bucket scope, SSE |
| **Integration complexity** | LOW — S3 SDK + custom endpoint | LOW-MED — S3 SDK + IAM setup | LOW — S3 SDK + endpoint |
| **Upload performance** | Fast; edge network; multipart supported | Fast; multipart, transfer acceleration | Adequate; occasionally slower |
| **Access control** | Presigned URLs; public bucket via custom domain/Worker | Presigned URLs; bucket policies; ACLs | Presigned URLs; app keys |
| **Backup/recovery** | Object versioning; lifecycle rules | Versioning, lifecycle, cross-region replication, PITR-ish | Versioning, lifecycle |
| **Render/Vercel fit** | Independent of both (no coupling) — backend writes via SDK | Independent of both | Independent of both |

---

## 3. Recommendation — Cloudflare R2

**Why R2 wins for this project specifically:**

1. **Zero egress fees.** This app *serves the same documents repeatedly* — referral letters opened by
   admins and seekers, résumés streamed in the ATS, avatars/banners rendered on every page. Egress is
   the hidden cost that punishes S3 and Vercel Blob here; R2 removes it entirely. Cost becomes just
   storage, which is tiny.
2. **S3-compatible → no lock-in.** R2 speaks the S3 API, so we use the standard `@aws-sdk/client-s3`
   with a custom endpoint. If the office later standardizes on AWS or wants B2's cheaper storage,
   it's an **endpoint + credential swap**, not a rewrite — especially behind the provider abstraction
   below.
3. **Generous free tier covers the entire capstone.** 10 GB storage + millions of ops/month = **$0**
   at current scale, with a clean, predictable path to a few cents/dollars per month in production.
4. **Independent of Render and Vercel.** No new coupling to either host; the backend holds credentials
   and does the I/O, exactly as it does for TiDB and the AI providers today.
5. **Fits the project's established patterns** — a swappable provider abstraction (like
   `services/mailService.js` and `services/smsService.js`), flag-gated ship-dark rollout, additive
   migrations, and a re-runnable backfill script (like `scripts/backfill-referral-letters.js`).

**Runner-up:** Backblaze B2 (cheapest storage, S3-compatible, free egress through Cloudflare) is a
fine fallback if R2 is ever unavailable — and the abstraction makes it a config change. AWS S3 is the
safe institutional choice if a future sponsor mandates AWS, accepting egress cost.

---

## 4. Proposed architecture

```
Browser (Vercel)                      Backend (Render)                    Cloudflare R2
─────────────────                     ─────────────────                   ──────────────
                                      objectStorageService                 PRIVATE bucket
 upload  ──POST /api/... (auth)──►    .put(key, bytes) ──S3 SDK──►         peso-artifacts/
                                        └ store {key, provider} in DB          referral-letters/…
 view    ──GET  /api/.../file───►     owner check → presign(key, TTL)          resumes/…
          (auth, owner-scoped)          └ 302 redirect OR stream               certificates/…
                                                                            PUBLIC bucket (non-PII)
 <img>   ──────────────────────────────────────────────────────────►       avatars/… banners/…
                                                                            (custom domain + CDN)
```

**Key design decisions (each preserves an existing invariant):**

- **`services/objectStorageService.js`** — the single provider abstraction (`put`, `getSignedUrl`,
  `getStream`, `delete`, `copy`), provider chosen by `STORAGE_PROVIDER`. Callers never import a
  provider SDK directly — mirrors `mailService`/`smsService`. R2 is the first provider; S3/B2 are
  drop-in.
- **The DB stops holding bytes and starts holding a reference.** New columns `*_storage_key` +
  `*_storage_provider` (e.g. on `referral_letter_files`, `application_resumes`, `*_certificates`,
  `peso_events`, `users`). The durable store becomes R2; the DB row is the index + metadata. This
  **amends invariant 0.5** ("durable binaries as base64 in the DB") to "durable binaries in object
  storage, referenced by key in the DB" — the *intent* (survive a Render deploy) is preserved and
  strengthened.
- **PII stays private; only non-PII goes public.** Résumés, referral letters, and certificates go in a
  **private** bucket and are served **only** through the existing owner-scoped endpoints, which now
  issue a **short-TTL presigned GET URL** (or stream the object) *after* the current auth + owner check
  (§12). Avatars and event banners (already effectively public) may use a **public** bucket behind a
  Cloudflare custom domain for cheap, fast, CDN-cached delivery.
- **Upload never fails the primary action (0.1).** An upload to R2 is wrapped exactly like the AI/email/
  snapshot writes: on failure it logs and degrades (e.g. the application still succeeds; the letter
  worker retries via the existing outbox). The referral-letter worker's `generate_pdf` step writes to
  R2 instead of base64; its retry/dead-letter semantics are unchanged.
- **Letter archive-before-regenerate (0.13) → object versioning / copy.** Instead of copying a base64
  row into `referral_letter_archive`, the regeneration copies the R2 object to an `archive/` prefix (or
  relies on bucket versioning) before overwriting. Nothing is ever silently destroyed; retention
  (`purge_after`) becomes an R2 lifecycle rule.
- **Direct-to-R2 browser upload is deliberately deferred.** A presigned PUT would offload upload
  bandwidth from Render, but it complicates the auth/validation story (size/type caps,
  owner-scoping, the immutable snapshot guarantee). Phase 1 keeps **backend-proxied uploads** (browser →
  Render → R2) so all existing validation and owner checks stay in one place; direct upload is a later
  optimization if upload bandwidth on Render ever becomes a bottleneck.

---

## 5. Security & access control

- **Buckets private by default.** Only avatars/banners (non-PII) may be public, and only through a
  scoped custom domain — never the PII bucket.
- **Scoped credentials.** R2 API tokens are scoped to the specific bucket(s) with least privilege
  (write for the backend; the frontend never holds storage credentials). Stored in Render env only,
  never in the repo (consistent with the standing secret-hygiene rule).
- **Presigned URLs, short TTL.** GETs for private objects are presigned with a small TTL (e.g. 60–300 s)
  and issued **only after** the request passes the existing `requireAuth` + owner-scope check. A leaked
  URL expires quickly and never bypasses authorization, because authorization happens *before* the
  presign.
- **Encryption at rest** is on by default (R2); TLS in transit for all SDK + presigned traffic.
- **No PII in public buckets, ever** — résumés and letters contain personal + government data (DPA).
- **CORS** is configured narrowly (the Vercel origin only) *if* direct browser upload is ever enabled;
  in Phase 1 (backend-proxied) no browser-facing CORS on the bucket is needed.
- **Audit trail unaffected** — object operations can log through the existing `adminAuditService` where
  a human action triggers them (e.g. letter regeneration).

---

## 6. Migration plan (additive, flag-gated, reversible)

Rollout follows the project's proven pattern (ship-dark → dual-write → backfill → cut reads → stop
base64), never a hard cutover on live government data.

1. **Phase 0 — abstraction + flag (no behavior change).** Add `objectStorageService` (R2 provider),
   env, and `OBJECT_STORAGE_ENABLED=false`. Additive migrations add the `*_storage_key` /
   `*_storage_provider` columns. Deploy-safe; nothing reads/writes R2 yet.
2. **Phase 1 — dual-write new binaries.** With the flag on, new uploads write to **both** R2 (durable)
   and base64 (fallback), recording the key. Reads still prefer base64. Fully reversible (flag off).
3. **Phase 2 — backfill.** A re-runnable `scripts/backfill-artifacts-to-r2.js` (twin of
   `backfill-referral-letters.js`) streams existing base64 rows into R2 and records keys. Verified with
   read-only probes + a rolled-back dry run against prod (§13 discipline).
4. **Phase 3 — cut reads to R2, keep base64 as fallback.** Read paths prefer the R2 key, fall back to
   base64 (`COALESCE`-style), so a missing/failed object never blanks a document.
5. **Phase 4 — stop writing base64, then reclaim.** Once R2 is proven in prod, stop writing base64 for
   new rows; a later, separate migration nulls the legacy base64 columns to reclaim TiDB storage
   (letters/gov docs last, and only after archive verification).

**Rollback at any phase = flip `OBJECT_STORAGE_ENABLED` off** (Phases 0–3 keep base64 intact).

---

## 7. Cost projection

| Scenario | Storage | R2 monthly | AWS S3 monthly (for contrast) |
|---|---|---|---|
| **Capstone (now)** | < 10 GB | **$0** (free tier) | ~$0 (12-mo free), then storage + egress |
| **Early production** | ~40 GB, moderate downloads | **~$0.60** (storage only) | ~$0.90 storage **+ egress** (grows with downloads) |
| **Larger production** | ~200 GB, heavy serving | **~$3** (storage only) | ~$4.60 storage **+ potentially $10s in egress** |

The decisive line is **egress**: R2 keeps the bill flat as document views grow; S3/Vercel Blob do not.
This maps directly onto the "cost-effective now, scalable later" requirement.

---

## 8. Trade-offs, risks & mitigations

| Trade-off / risk | Mitigation |
|---|---|
| R2 is newer than S3 | Cloudflare-backed, 99.9% SLA; S3-compat means we can move to S3/B2 via config if ever needed |
| No native image transforms (unlike Cloudinary) | Not needed — avatars are already client-downscaled (§10.8); banners are pre-sized on upload |
| Public URL needs a custom domain/Worker for a clean path | Only affects non-PII avatars/banners; a `*.r2.dev` or a subdomain suffices; PII never uses public URLs |
| Another external dependency | Wrapped in the degrade-never-fail pattern (0.1) + base64 fallback during migration; provider is swappable |
| Presigned-URL leakage | Short TTL + authorization *before* presign; the URL is a time-boxed capability, not a bypass |
| Team unfamiliarity | S3 API is the industry standard; the abstraction hides provider specifics from callers |

---

## 9. Implementation complexity — LOW-to-MEDIUM

- **New:** `services/objectStorageService.js` (+ R2 provider), `@aws-sdk/client-s3` dependency, env
  (`STORAGE_PROVIDER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_PUBLIC_BASE_URL`), additive migrations for the key columns, a backfill script, guard tests.
- **Changed (surgical):** the write side of each producer (letter worker `generate_pdf`, résumé
  snapshot, certificate save, event-banner save, avatar upload) and the read side of each owner-scoped
  streaming endpoint — swap "base64 in/out of the DB" for "put/presign against R2", keeping the DB row
  as the index. Every touch is guarded and reversible.
- **Unchanged:** the referral outbox/worker state machine, owner-scoping, notifications, the AI/scoring
  paths, and the whole frontend (it still calls the same authed endpoints; a presign is just a URL).

**Estimated effort:** ~2–3 focused sessions across Phases 0–3, plus a verification pass. Phase 4
(reclaim) is a later, separate migration.

---

## 10. Decision

**Adopt Cloudflare R2**, implemented behind `objectStorageService` (S3-compatible, provider-swappable),
rolled out flag-gated and additively per §6. It is **$0 at capstone scale**, keeps the bill flat into
production by eliminating egress, preserves every storage/durability/access invariant, and stays
portable to AWS S3 / Backblaze B2 if institutional requirements later demand it.

**Sequencing:** this belongs on the deferred-but-approved infrastructure track (SKILL §25), and pairs
naturally with the Render Starter upgrade (kills cold starts) — but unlike the worker-split/Redis
items, R2 delivers value **immediately** (DB relief + faster document serving) at **near-zero cost**,
so it is a strong candidate to do **first** in the infra phase.

**Not in scope here:** direct-to-R2 browser uploads (Phase-later optimization), image transformation
pipelines, and any change to the relational schema beyond the additive key columns.
