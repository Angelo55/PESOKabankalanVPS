/**
 * THE single source of truth for "what image represents this person".
 *
 * Every surface that shows a face — top header, Profile & Identity, Messages
 * Hub, Application Tracking / ATS, chat, notifications — resolves through
 * `resolveAvatarSrc()` here. Nothing renders `user.avatar_url` directly and
 * nothing falls back to initials any more, so a profile-image change is
 * automatically consistent everywhere the moment AuthContext updates.
 *
 * ── Three tiers, in order ───────────────────────────────────────────────────
 *   1. avatar_thumb   small square written at upload/selection time (list-safe)
 *   2. avatar_url     the full-size stored image
 *   3. generated      a deterministic DiceBear "micah" flat vector avatar
 *
 * Tier 3 is DERIVED, never stored. That is what makes this backward compatible
 * with zero migration and zero backfill: every existing account with a NULL
 * avatar gets a real face immediately, and the same account always gets the
 * SAME face because the seed is its user id.
 *
 * ── Why generation is client-side ───────────────────────────────────────────
 * The fallback is a pure function of the user id. Generating it in the browser
 * costs ~1ms, needs no DB column, no migration, no backfill job, and cannot
 * drift out of sync with the stored value. Storing a generated avatar for every
 * user would have added ~8KB × every row for information already implied by the
 * id.
 *
 * ── Why a SELECTED gallery avatar IS stored ─────────────────────────────────
 * A deliberate choice is not derivable from the id, and the requirement is that
 * it "behave identically to a custom uploaded image". So selection writes the
 * rendered SVG data URI to `users.avatar_url` through the same endpoint an
 * upload uses. Downstream code cannot tell the two apart — which is the point.
 * An SVG data URI is ~8KB, well under the ~30KB a downscaled photo costs.
 */

import { createAvatar } from '@dicebear/core';
import { micah } from '@dicebear/collection';

/**
 * Flat, solid-background palette taken from the avatar.jpg reference in the
 * backend root: saturated warm/pastel fills behind a flat vector character, no
 * gradients. Hex WITHOUT the leading '#' — that is the format DiceBear wants.
 */
export const AVATAR_BACKGROUNDS = [
    'f2d13c', // reference golden yellow
    'ffd5dc',
    'b6e3f4',
    'c0aede',
    'd1f4d0',
    'ffdfbf',
    'a7d8de',
    'f7c873'
];

/** Options shared by every avatar we generate, so the whole set looks like one family. */
const BASE_OPTIONS = {
    backgroundType: ['solid'],
    backgroundColor: AVATAR_BACKGROUNDS,
    // The reference art has visible glasses and facial hair on some faces but
    // not all. Leaving the probabilities at DiceBear's defaults keeps the set
    // varied; pinning them would make every avatar look like the same person.
    size: 128
};

/**
 * Generation is deterministic, so the result can be cached forever. Without
 * this, a 40-row applicant list re-rasterises 40 SVGs on every render pass.
 */
const cache = new Map();

/**
 * Renders one micah avatar as an `<img src>`-ready data URI.
 * `seed` fully determines the output.
 */
export const generateAvatar = (seed, options = {}) => {
    const key = `${seed}|${JSON.stringify(options)}`;
    if (cache.has(key)) return cache.get(key);

    const uri = createAvatar(micah, {
        ...BASE_OPTIONS,
        ...options,
        seed: String(seed)
    }).toDataUri();

    cache.set(key, uri);
    return uri;
};

/**
 * The stable identity a generated avatar hangs off.
 *
 * User id first: it never changes, so the face never changes. Email and name
 * are only fallbacks for payloads that omit the id (some list endpoints send a
 * denormalised participant). A last-resort constant is better than `undefined`,
 * which would give every anonymous slot a different random face per render.
 */
export const avatarSeedFor = (user) => {
    if (!user) return 'peso-guest';
    if (user.id !== undefined && user.id !== null && user.id !== '') return `user-${user.id}`;
    if (user.user_id !== undefined && user.user_id !== null && user.user_id !== '') return `user-${user.user_id}`;
    if (user.email) return String(user.email).trim().toLowerCase();
    if (user.name) return String(user.name).trim().toLowerCase();
    return 'peso-guest';
};

/** True for a value that can actually be used as an image source. */
const usableImage = (value) => typeof value === 'string'
    && value.trim().length > 0
    && value.trim() !== 'null'
    && value.trim() !== 'undefined';

/**
 * Avatars are normally base64/SVG data URIs, but a handful of legacy rows hold
 * a server-relative path like `/uploads/…`. Those need the API host prefixed —
 * logic that used to live privately inside TopHeader, which is exactly why the
 * other surfaces rendered them broken. It belongs here with the rest.
 */
const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

const normalizeStoredSrc = (src) => {
    const trimmed = src.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('http')) return trimmed;
    return `${FILE_BASE}${trimmed}`;
};

/**
 * THE resolver. Always returns a renderable src — never null, never an empty
 * string, so no caller needs an initials branch.
 *
 * `preferThumb` picks the small stored variant when one exists; pass false for
 * a large display (the Profile & Identity header) so it does not upscale a 96px
 * thumbnail.
 */
export const resolveAvatarSrc = (user, { preferThumb = true } = {}) => {
    if (user) {
        const stored = preferThumb
            ? [user.avatar_thumb, user.avatar_url]
            : [user.avatar_url, user.avatar_thumb];

        for (const candidate of stored) {
            if (usableImage(candidate)) return normalizeStoredSrc(candidate);
        }
    }
    return generateAvatar(avatarSeedFor(user));
};

/** True when the user has a real stored image rather than a generated one. */
export const hasStoredAvatar = (user) =>
    Boolean(user && (usableImage(user.avatar_url) || usableImage(user.avatar_thumb)));

/**
 * True when the given user object represents the PESO Kabankalan ORGANISATION
 * account rather than an individual job seeker.
 *
 * The PESO account is a single institutional identity: wherever it appears — top
 * header, Messages Hub, Profile, referral views — it should show the official
 * PESO logo, NOT a personal photo or a generated face. `Avatar` consults this to
 * short-circuit to the logo. Job seekers never match, so their avatars are
 * untouched.
 *
 * Role strings: the stored role is `peso_administrator`; `employer` is only a
 * legacy alias (see messageRoutes.js) — both are the organisation. A payload may
 * carry the role under `role`, or under a denormalised `*_role` field the caller
 * has already narrowed to the peer; we accept an explicit `isOrg` flag too, for
 * the few surfaces that lack a role on the object.
 */
const ORG_ROLES = new Set(['peso_administrator', 'employer']);
export const isOrgAccount = (user) => {
    if (!user) return false;
    if (user.isOrg === true) return true;
    const role = user.role;
    return typeof role === 'string' && ORG_ROLES.has(role.trim().toLowerCase());
};

// ---------------------------------------------------------------------------
// Gallery — the pick-an-avatar-without-uploading feature
// ---------------------------------------------------------------------------

/**
 * Fixed seed list. Fixed, not random, so the gallery a user saw when they chose
 * "Sunny" is the same gallery next week — a shuffled grid would make a chosen
 * avatar impossible to find again.
 */
export const AVATAR_GALLERY_SEEDS = [
    'Sunny', 'Marisol', 'Andres', 'Liwayway', 'Kiko', 'Amihan',
    'Dalisay', 'Tala', 'Bayani', 'Mayari', 'Rizal', 'Sinag',
    'Haraya', 'Makisig', 'Diwata', 'Alon', 'Bulan', 'Habagat',
    'Lakan', 'Malaya', 'Narra', 'Sampaguita', 'Tadhana', 'Uma'
];

/**
 * The gallery rendered for the picker: a stable id (what we compare against to
 * show the current selection) plus the data URI to display and to persist.
 */
export const buildAvatarGallery = () =>
    AVATAR_GALLERY_SEEDS.map((seed) => ({
        id: `micah:${seed}`,
        seed,
        src: generateAvatar(seed)
    }));

/**
 * Payload for POST /api/profile/avatar.
 *
 * Both fields carry the same string on purpose: an SVG is resolution
 * independent, so a separate "thumbnail" would be the identical bytes. This
 * keeps the stored shape identical to an uploaded photo's, which is what lets
 * every consumer treat a chosen avatar and an uploaded one the same way.
 */
export const buildGalleryAvatarPayload = (seed) => {
    const uri = generateAvatar(seed);
    return { avatar_url: uri, avatar_thumb: uri };
};
