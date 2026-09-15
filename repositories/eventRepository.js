/**
 * eventRepository — all SQL for the PESO Events / Announcements subsystem
 * (migration 041). Routes parse/authorize/respond; this holds the queries.
 *
 * The banner is base64 in the DB (durable, §0.5). List queries INCLUDE it so the
 * seeker + manager CARDS can render the image inline (the client downscales each
 * banner to ~1000px JPEG before upload, and events are low-volume — unlike a
 * multi-row ATS list of full-size avatars, this payload stays modest).
 */
const db = require('../db');

// Columns for LIST payloads. Includes banner_image so cards show the poster without
// a per-card detail fetch; description/venue/times drive the rich card presentation.
// The SAME projection feeds the seeker Events module AND the public Landing Page teaser,
// so both render the identical uploaded event image (no duplicate image path).
const LIST_COLUMNS = `id, created_by, event_type, title, description, venue, event_date,
    start_time, end_time, registration_info, banner_image, status, published_at, created_at, updated_at`;

const eventRepository = {
    /**
     * Published events, ALWAYS with the next event first. One data source for both the
     * seeker Events module and the public Landing Page — the banner (uploaded event
     * image) is always included so both surfaces render the identical poster.
     *
     * Optional:
     *   - `scope: 'upcoming'` — drop past-dated events (undated kept). Used by the public
     *                           chatbot's `get_upcoming_events` tool, which must only name
     *                           events that are still ahead.
     *   - `limit`             — cap the row count (bounded 1..50) so a public page never
     *                           pulls an unbounded number of base64 banners.
     * No args = every published event (the Landing carousel + seeker Events module both use
     * this): PAST events ARE included (badged "Ended" client-side), but the ordering keeps
     * upcoming events first so a LIMIT never buries the next job fair under old ones.
     *
     * Ordering:
     *   - 'upcoming': all rows are future/undated → soonest first (undated last).
     *   - 'all':      upcoming (soonest first) → undated announcements → past (most-recent
     *                 first). This is why a small LIMIT still surfaces what's next.
     */
    async listPublished({ scope = 'all', limit = null } = {}) {
        const upcomingOnly = scope === 'upcoming';
        const where = upcomingOnly
            ? "status = 'Published' AND (event_date IS NULL OR event_date >= CURDATE())"
            : "status = 'Published'";
        const orderBy = upcomingOnly
            ? '(event_date IS NULL), event_date ASC, created_at DESC'
            : `CASE WHEN event_date IS NOT NULL AND event_date >= CURDATE() THEN 0
                    WHEN event_date IS NULL THEN 1 ELSE 2 END,
               CASE WHEN event_date IS NOT NULL AND event_date >= CURDATE() THEN event_date END ASC,
               CASE WHEN event_date IS NOT NULL AND event_date < CURDATE() THEN event_date END DESC,
               created_at DESC`;
        const n = Number.parseInt(limit, 10);
        const clause = Number.isInteger(n) && n > 0 ? ` LIMIT ${Math.min(n, 50)}` : '';
        const [rows] = await db.query(
            `SELECT ${LIST_COLUMNS} FROM peso_events
             WHERE ${where}
             ORDER BY ${orderBy}${clause}`
        );
        return rows;
    },

    /** Every event (all statuses) for the management surface. */
    async listAll() {
        const [rows] = await db.query(
            `SELECT ${LIST_COLUMNS} FROM peso_events
             ORDER BY (event_date IS NULL), event_date DESC, created_at DESC`
        );
        return rows;
    },

    /** One event WITH its banner. `publishedOnly` scopes the public detail route. */
    async findById(id, publishedOnly = false) {
        const [rows] = await db.query(
            `SELECT * FROM peso_events WHERE id = ?${publishedOnly ? " AND status = 'Published'" : ''}`,
            [id]
        );
        return rows[0] || null;
    },

    async create(fields) {
        const {
            createdBy = null, eventType = 'job_fair', title, description = null, venue = null,
            eventDate = null, startTime = null, endTime = null, registrationInfo = null,
            bannerImage = null, status = 'Draft'
        } = fields;
        const publishedAt = status === 'Published' ? new Date() : null;
        const [result] = await db.query(
            `INSERT INTO peso_events
                (created_by, event_type, title, description, venue, event_date, start_time,
                 end_time, registration_info, banner_image, status, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [createdBy, eventType, title, description, venue, eventDate || null, startTime, endTime,
             registrationInfo, bannerImage, status, publishedAt]
        );
        return result.insertId;
    },

    /**
     * Full update of the editable fields. `banner_image` is only overwritten when a
     * new value is supplied (undefined = keep the stored banner, so an edit that does
     * not re-upload the image never wipes it).
     */
    async update(id, fields) {
        const {
            eventType, title, description = null, venue = null, eventDate = null,
            startTime = null, endTime = null, registrationInfo = null, bannerImage
        } = fields;
        const sets = [
            'event_type = ?', 'title = ?', 'description = ?', 'venue = ?', 'event_date = ?',
            'start_time = ?', 'end_time = ?', 'registration_info = ?'
        ];
        const values = [eventType, title, description, venue, eventDate || null, startTime, endTime, registrationInfo];
        if (bannerImage !== undefined) { sets.push('banner_image = ?'); values.push(bannerImage); }
        values.push(id);
        const [result] = await db.query(`UPDATE peso_events SET ${sets.join(', ')} WHERE id = ?`, values);
        return result.affectedRows;
    },

    /**
     * Transition status. When moving to 'Published' for the FIRST time, stamp
     * published_at (used to decide whether a publish should fire the broadcast — a
     * re-publish of an already-announced event must not re-notify everyone).
     */
    async setStatus(id, status) {
        const stampPublish = status === 'Published';
        const [result] = await db.query(
            `UPDATE peso_events
             SET status = ?${stampPublish ? ', published_at = COALESCE(published_at, NOW())' : ''}
             WHERE id = ?`,
            [status, id]
        );
        return result.affectedRows;
    },

    async remove(id) {
        const [result] = await db.query('DELETE FROM peso_events WHERE id = ?', [id]);
        return result.affectedRows;
    },

    /** Published + upcoming (or undated) count — for the seeker landing/board badge. */
    async countUpcoming() {
        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM peso_events
             WHERE status = 'Published' AND (event_date IS NULL OR event_date >= CURDATE())`
        );
        return Number(total);
    }
};

module.exports = eventRepository;
