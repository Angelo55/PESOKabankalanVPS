/**
 * A tiny SYNCHRONOUS cache of the client-readable runtime feature flags
 * (GET /api/config/features). AuthContext fetches those flags and also mirrors
 * them here, so PURE helpers that cannot be React hooks — e.g. isJobFilled in
 * jobs/JobCard.jsx — can consult a flag without a hook or prop-drilling.
 *
 * Defaults to all-off, so a dark-shipped feature stays hidden/inactive until the
 * flags load (and if the fetch fails, everything degrades to the OFF behaviour).
 */
let flags = {};

export const setFeatureFlags = (next) => { flags = next || {}; };
export const featureFlag = (name) => Boolean(flags[name]);
