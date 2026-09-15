-- Migration 048 — Event banner rollback archive column.
--
-- WHY: event banners have lived as base64 data URIs in peso_events.banner_image (§41).
-- We are migrating those existing banners to Cloudflare R2 object storage (the base64→R2
-- storage-path migration deferred in §41), run by scripts/migrate-event-banners-to-r2.js.
-- That script overwrites banner_image with the R2 URL, so it must FIRST preserve the
-- original base64 here for a safe, non-destructive rollback (the owner requirement: do not
-- discard the legacy asset until the migration is verified end-to-end).
--
--   banner_image_legacy — the ORIGINAL base64 data URI, copied before banner_image is
--                         replaced with the R2 URL. Rollback = copy it back. It is kept
--                         until the migration is verified in production; a later, separate
--                         contract migration may drop it once confirmed.
--
-- This ONLY adds a nullable archive column — no event business data (title, description,
-- date, venue, status, publishing) is touched. Additive + idempotent (ADD COLUMN IF NOT
-- EXISTS), an instant metadata change on TiDB, safe to re-run.
ALTER TABLE peso_events
    ADD COLUMN IF NOT EXISTS banner_image_legacy LONGTEXT NULL;
