/**
 * eventBannerStorage — convert an uploaded event banner (a base64 `data:` URI the client
 * sends) into a durable object-storage reference via the centralized `storageService`.
 *
 * Event banners historically lived as base64 in peso_events.banner_image (§41). This is the
 * ONE place that turns that base64 into an R2 URL, shared by:
 *   - routes/eventRoutes.js  — new create/update banners
 *   - scripts/migrate-event-banners-to-r2.js — the one-off migration of EXISTING banners
 * so the object-key scheme and data-URI parsing can never drift between the two.
 *
 * KEY SCHEME: content-addressed — `event-banners/<sha256(bytes)[0..16]>.<ext>`. Collision-safe
 * (a hash), id-independent (so create can upload BEFORE the row exists), and it dedups
 * identical re-uploads. Banners are public marketing content, so they use the same PUBLIC R2
 * bucket as job featured images (§41) — never a PII/private path.
 */
const crypto = require('crypto');
const storageService = require('./storageService');

const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif',
};
// data:<mime>;base64,<payload>  — only base64 data URIs are accepted (the client always
// produces base64; a non-base64 data URI is treated as "not convertible" and left as-is).
const DATA_URI_RE = /^data:([^;,]+)?;base64,(.*)$/s;

/** Parse a base64 data URI → { buffer, mime, ext }, or null if it isn't one. */
function parseDataUri(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(DATA_URI_RE);
    if (!m) return null;
    const mime = (m[1] || 'application/octet-stream').toLowerCase();
    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return null;
    return { buffer, mime, ext: MIME_EXT[mime] || 'bin' };
}

/** Content-addressed object key for a banner buffer. */
function bannerKey(buffer, ext) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    return `event-banners/${hash}.${ext}`;
}

/**
 * Return the reference to STORE for a banner value.
 *   - Not a data URI (already a URL, or null/undefined) → returned unchanged.
 *   - A data URI while the active driver is R2 → uploaded to R2, returns the public URL.
 *   - A data URI while the driver is `local` (dev) → returned UNCHANGED (kept as base64), so
 *     local development needs no R2 and nothing is written to the ephemeral uploads/ dir.
 * Resilient (invariant 0.1): if an R2 upload fails, the original base64 is returned so
 * saving the event never fails on a storage hiccup — the banner still renders as a data URI.
 */
async function persistBannerRef(bannerImage) {
    if (storageService.DRIVER !== 'r2') return bannerImage;
    const parsed = parseDataUri(bannerImage);
    if (!parsed) return bannerImage;
    try {
        return await storageService.save(bannerKey(parsed.buffer, parsed.ext), parsed.buffer, parsed.mime);
    } catch (e) {
        console.error('[eventBanner] R2 upload failed; keeping base64:', e.message);
        return bannerImage;
    }
}

module.exports = { parseDataUri, bannerKey, persistBannerRef };
