// Featured images are served from /uploads on the API host (outside /api).
export const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');
export const resolveJobImage = (src) => (src ? (src.startsWith('http') ? src : `${FILE_BASE}${src}`) : null);

// Storage-agnostic resolver for EVENT banners/posters. A banner may be a base64 `data:`
// URI (base64-in-DB, legacy/dev), an absolute `http(s)` URL (Cloudflare R2, once migrated —
// §41), or a bare relative `/uploads/…` path (local storage driver). Pass data: and http(s)
// through verbatim; prefix a relative path with the API host so it never mis-resolves against
// the frontend origin. ONE definition, consumed by LandingPage, Events, and PesoEventManager.
export const resolveBannerSrc = (src) =>
    (!src ? null : (src.startsWith('data:') || src.startsWith('http')) ? src : `${FILE_BASE}${src}`);
