/**
 * eventRoutes — PESO Events / Announcements (migration 041).
 *
 * An EXTENSIBLE event subsystem (event_type discriminator), not a hard-coded Job
 * Fair feature. Public read for the seeker/landing surfaces; management is gated by
 * the RBAC capability `events:manage` (held by the PESO Manager AND PESO Staff), via
 * requirePermission — so the access rule lives in the RBAC map, not this file.
 *
 * Publishing an event for the FIRST time broadcasts an EVENT_ANNOUNCEMENT to every
 * job seeker through the single notification writer (row first, socket second, never
 * throws — 0.1/0.11). A re-publish never re-notifies (published_at gates it).
 */
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbac');
const events = require('../repositories/eventRepository');
const { notifyAllJobSeekers } = require('../services/notificationService');
const { persistBannerRef } = require('../services/eventBannerStorage');

const canManage = [requireAuth, requirePermission('events:manage')];

const EVENT_TYPES = ['job_fair', 'recruitment_drive', 'seminar', 'orientation', 'general'];
const MANUAL_STATUSES = ['Draft', 'Cancelled', 'Completed']; // 'Published' goes through /publish (it notifies)
// Base64 banner cap (~3.0MB string ≈ ~2.2MB image) — the client (PesoEventManager
// fileToBannerDataUrl) keeps originals verbatim when they fit and only re-encodes to stay
// under this, so posters stay sharp. Keep this in lockstep with the client's MAX_BANNER_CHARS.
const MAX_BANNER_CHARS = 3_000_000;

function cleanEventInput(body = {}) {
    const title = String(body.title || '').trim();
    const eventType = EVENT_TYPES.includes(body.event_type) ? body.event_type : 'job_fair';
    const banner = body.banner_image;
    return {
        title,
        eventType,
        description: body.description ? String(body.description) : null,
        venue: body.venue ? String(body.venue).trim() : null,
        // Normalize to a plain YYYY-MM-DD for the DATE column. The edit form round-trips the
        // stored value, which serializes as a full UTC datetime ("2026-09-12T00:00:00.000Z");
        // re-saving that raw into a DATE risks a truncation/parse shift that can drop the event
        // out of the "event_date >= CURDATE()" upcoming filter (the Landing carousel) even
        // though the record is untouched — the same date-fragility as §49. Slice the calendar
        // date so a re-save is byte-stable and never shifts.
        eventDate: body.event_date ? String(body.event_date).slice(0, 10) : null,
        startTime: body.start_time ? String(body.start_time).trim() : null,
        endTime: body.end_time ? String(body.end_time).trim() : null,
        registrationInfo: body.registration_info ? String(body.registration_info) : null,
        // undefined => keep existing banner on update; null => explicit clear; string => set.
        bannerImage: banner === undefined ? undefined : (banner ? String(banner) : null),
    };
}

function eventDateLabel(d) {
    if (!d) return '';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── PUBLIC ──────────────────────────────────────────────────────────────────
// Published events, upcoming first. No auth — the seeker board/landing can surface them.
// The payload ALWAYS includes the uploaded banner image, so the Landing Page teaser and
// the authenticated Events module render the identical poster (one image source).
//
// Default (no query) → all published, unchanged (the seeker Events module relies on it).
// The Landing Page passes `?scope=upcoming&limit=N` to get an upcoming-only, capped list
// from the SAME data source (no separate endpoint, no separate image path).
router.get('/', async (req, res) => {
    try {
        const scope = req.query.scope === 'upcoming' ? 'upcoming' : 'all';
        const data = await events.listPublished({ scope, limit: req.query.limit });
        res.status(200).json({ status: 'success', data });
    } catch (error) {
        console.error('[Events] list published failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load events.' });
    }
});

// ── MANAGEMENT LIST (must be registered BEFORE the public /:id param route) ──
router.get('/manage', canManage, async (req, res) => {
    try {
        res.status(200).json({ status: 'success', data: await events.listAll() });
    } catch (error) {
        console.error('[Events] manage list failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load events.' });
    }
});

router.post('/', canManage, async (req, res) => {
    try {
        const input = cleanEventInput(req.body);
        if (!input.title) return res.status(400).json({ status: 'error', message: 'An event title is required.' });
        if (typeof input.bannerImage === 'string' && input.bannerImage.length > MAX_BANNER_CHARS) {
            return res.status(413).json({ status: 'error', message: 'The banner image is too large. Please use a smaller image.' });
        }
        // In prod (STORAGE_DRIVER=r2) a base64 banner is uploaded to R2 and stored as a URL;
        // in dev it stays base64 (§45.5). Size check above runs on the incoming base64 first.
        input.bannerImage = await persistBannerRef(input.bannerImage);
        const id = await events.create({ ...input, createdBy: req.userId, status: 'Draft' });
        res.status(201).json({ status: 'success', message: 'Event saved as a draft.', id });
    } catch (error) {
        console.error('[Events] create failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to create the event.' });
    }
});

// ── PUBLIC DETAIL (published only) ──
router.get('/:id', async (req, res) => {
    try {
        const event = await events.findById(req.params.id, true);
        if (!event) return res.status(404).json({ status: 'error', message: 'Event not found.' });
        res.status(200).json({ status: 'success', data: event });
    } catch (error) {
        console.error('[Events] detail failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to load the event.' });
    }
});

router.put('/:id', canManage, async (req, res) => {
    try {
        const input = cleanEventInput(req.body);
        if (!input.title) return res.status(400).json({ status: 'error', message: 'An event title is required.' });
        if (typeof input.bannerImage === 'string' && input.bannerImage.length > MAX_BANNER_CHARS) {
            return res.status(413).json({ status: 'error', message: 'The banner image is too large. Please use a smaller image.' });
        }
        // Convert a newly-uploaded base64 banner to an R2 URL in prod (undefined = keep
        // existing, so an edit that doesn't touch the image is unaffected; §45.5).
        if (typeof input.bannerImage === 'string') input.bannerImage = await persistBannerRef(input.bannerImage);
        const affected = await events.update(req.params.id, input);
        if (affected === 0) return res.status(404).json({ status: 'error', message: 'Event not found.' });
        res.status(200).json({ status: 'success', message: 'Event updated.' });
    } catch (error) {
        console.error('[Events] update failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to update the event.' });
    }
});

router.delete('/:id', canManage, async (req, res) => {
    try {
        const affected = await events.remove(req.params.id);
        if (affected === 0) return res.status(404).json({ status: 'error', message: 'Event not found.' });
        res.status(200).json({ status: 'success', message: 'Event deleted.' });
    } catch (error) {
        console.error('[Events] delete failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to delete the event.' });
    }
});

// Publish → visible to seekers. The FIRST publish announces it to every job seeker.
router.post('/:id/publish', canManage, async (req, res) => {
    try {
        const event = await events.findById(req.params.id);
        if (!event) return res.status(404).json({ status: 'error', message: 'Event not found.' });

        const firstAnnouncement = !event.published_at; // published_at stamped only on first publish
        await events.setStatus(req.params.id, 'Published');

        if (firstAnnouncement) {
            // Fire-and-forget broadcast (single writer; swallows its own errors, 0.1/0.11).
            const dateLabel = eventDateLabel(event.event_date);
            notifyAllJobSeekers(req.app.get('io'), {
                type: 'EVENT_ANNOUNCEMENT',
                title: `New PESO event: ${event.title}`,
                body: `${event.title}${event.venue ? ` at ${event.venue}` : ''}${dateLabel ? ` on ${dateLabel}` : ''}. Tap to view details.`,
                link: '/events',
            });
        }
        res.status(200).json({ status: 'success', message: firstAnnouncement ? 'Event published and announced to job seekers.' : 'Event re-published.' });
    } catch (error) {
        console.error('[Events] publish failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to publish the event.' });
    }
});

// Other lifecycle transitions (Draft / Cancelled / Completed) — no re-broadcast.
router.put('/:id/status', canManage, async (req, res) => {
    try {
        const status = String(req.body.status || '');
        if (!MANUAL_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: `Invalid status. Use one of: ${MANUAL_STATUSES.join(', ')} (publish uses its own action).` });
        }
        const affected = await events.setStatus(req.params.id, status);
        if (affected === 0) return res.status(404).json({ status: 'error', message: 'Event not found.' });
        res.status(200).json({ status: 'success', message: `Event marked ${status}.` });
    } catch (error) {
        console.error('[Events] status change failed:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to update the event status.' });
    }
});

module.exports = router;
