const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards for the PESO Events / Announcements subsystem (Phase 3, migration 041).
 * Source-only assertions (no DB: require('../db') runs initDB against prod, §13).
 */

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'eventRoutes.js'), 'utf8');
const REPO = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'eventRepository.js'), 'utf8');
const RBAC = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rbac.js'), 'utf8');
const NOTIF_ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'notificationRoutes.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations', '041_peso_events.sql'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('event management is gated by the events:manage CAPABILITY, not a hard-coded role list', () => {
	assert.match(ROUTES, /requirePermission\('events:manage'\)/, 'management routes use requirePermission');
	assert.match(RBAC, /requirePermission/, 'rbac exports a requirePermission guard');
});

test('both the PESO Manager and PESO Staff hold events:manage (so both can publish events)', () => {
	// Extract each role's permission block and assert events:manage is present.
	const mgr = RBAC.match(/\[ROLE_KEYS\.PESO_ADMINISTRATOR\]:\s*\[([\s\S]*?)\]/);
	const staff = RBAC.match(/\[ROLE_KEYS\.PESO_STAFF\]:\s*\[([\s\S]*?)\]/);
	assert.ok(mgr && /'events:manage'/.test(mgr[1]), 'Manager must have events:manage');
	assert.ok(staff && /'events:manage'/.test(staff[1]), 'Staff must have events:manage');
});

test('publishing broadcasts EVENT_ANNOUNCEMENT to job seekers, only on the FIRST publish', () => {
	assert.match(ROUTES, /notifyAllJobSeekers/, 'publish must broadcast via the single notification writer');
	assert.match(ROUTES, /type:\s*'EVENT_ANNOUNCEMENT'/, 'broadcast uses the EVENT_ANNOUNCEMENT type');
	assert.match(ROUTES, /firstAnnouncement/, 'a re-publish must not re-notify (published_at gates it)');
	assert.match(REPO, /COALESCE\(published_at, NOW\(\)\)/, 'published_at is stamped only once');
});

test('EVENT_ANNOUNCEMENT is a muteable notification type (Notification Center)', () => {
	assert.match(NOTIF_ROUTES, /EVENT_ANNOUNCEMENT/, 'must be in CONTROLLABLE_TYPES');
});

test('the events router is mounted and the migration is additive with a durable base64 banner', () => {
	assert.match(SERVER, /\/api\/events/, 'router mounted at /api/events');
	assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS peso_events/, 'additive create');
	assert.match(MIGRATION, /banner_image\s+LONGTEXT/, 'banner stored as base64 LONGTEXT (durable, §0.5)');
	assert.match(MIGRATION, /event_type\s+VARCHAR/, 'extensible via an event_type discriminator, not a Job-Fair-only table');
});

test('list payloads include the banner + description so cards render inline (no per-card fetch)', () => {
	const listCols = REPO.match(/LIST_COLUMNS = `([\s\S]*?)`/)[1];
	assert.match(listCols, /banner_image/, 'LIST_COLUMNS includes banner_image for card thumbnails');
	assert.match(listCols, /description/, 'LIST_COLUMNS includes description for the card summary');
});

// ── Public LIST reuse for the Landing Page carousel (same image data, scoped + capped) ──

test('the Landing Page reuses the SAME banner data source — one projection, no second image path', () => {
	// listPublished (used by BOTH the seeker module and the landing) always selects the
	// uploaded banner, and there is NO separate banner-free/duplicate list method.
	const listCols = REPO.match(/LIST_COLUMNS = `([\s\S]*?)`/)[1];
	assert.match(listCols, /banner_image/, 'LIST_COLUMNS includes the uploaded event image for the cards');
	assert.doesNotMatch(REPO, /LITE_COLUMNS|listPublishedLite/, 'no parallel banner-free list method / projection');
});

test('listPublished supports an optional upcoming scope + a BOUNDED limit (landing teaser)', () => {
	const fn = REPO.slice(REPO.indexOf('async listPublished'), REPO.indexOf('async listAll'));
	assert.match(fn, /\{\s*scope\s*=\s*'all'\s*,\s*limit\s*=\s*null\s*\}\s*=\s*\{\}/, 'accepts optional { scope, limit } (default = original behaviour)');
	assert.match(fn, /event_date >= CURDATE\(\)/, "scope 'upcoming' drops past-dated events");
	assert.match(fn, /Math\.min\(n,\s*50\)/, 'limit is bounded (max 50) so a public page never pulls unbounded banners');
	// The 'all' scope (Landing carousel + seeker module) SHOWS past events but keeps upcoming
	// first, so a LIMIT never buries the next job fair: upcoming soonest-first, past most-recent-first.
	assert.match(fn, /event_date >= CURDATE\(\) THEN event_date END ASC/, "ordering: upcoming events surface first (soonest first)");
	assert.match(fn, /event_date < CURDATE\(\) THEN event_date END DESC/, 'ordering: past events sink below upcoming, most-recent first');
});

test('public GET / passes scope+limit through, defaulting to all published (with banner)', () => {
	const handler = ROUTES.slice(ROUTES.indexOf("router.get('/'"), ROUTES.indexOf("router.get('/manage'"));
	assert.match(handler, /req\.query\.scope === 'upcoming'/, 'reads the optional scope param');
	assert.match(handler, /listPublished\(\{\s*scope,\s*limit:\s*req\.query\.limit\s*\}\)/, 'forwards scope+limit to the one list method');
	assert.doesNotMatch(handler, /listPublishedLite/, 'no separate lite endpoint branch');
});
