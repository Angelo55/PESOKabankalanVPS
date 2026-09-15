// Centralized Philippine Peso (PHP) currency presentation.
//
// The PESO Kabankalan system is a Philippine government platform, so every
// monetary value it displays is in Philippine Pesos. This module is the ONE
// home for formatting a numeric amount as ₱ — import `formatPHP` rather than
// hand-writing `Intl.NumberFormat` or prefixing a bare "$"/"₱" at a call site,
// so the locale, symbol and grouping stay consistent everywhere.
//
// IMPORTANT (scope): job salary is currently a FREE-TEXT field (`salary_range`,
// e.g. the admin types "₱15,000 - ₱25,000 / month") and is rendered verbatim —
// it is NOT a number, so it does NOT pass through this formatter. There is no
// other numeric monetary value in the system today. This helper therefore has
// no caller yet; it exists as the shared foundation so that if/when a genuinely
// numeric money field is introduced, it formats through here in ₱ by default and
// nothing reaches for "$". Do NOT ₱-prefix `salary_range` with it (that would
// double the currency the admin already typed).

export const PESO = '₱'; // ₱

const phpFormatter = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

/**
 * Format a NUMERIC amount as Philippine Pesos, e.g. formatPHP(15000) → "₱15,000".
 * Non-numeric / null / NaN input returns an em dash so a missing value never
 * renders "₱NaN". Pass an already-formatted free-text value straight through to
 * the UI instead — do not route free text here.
 * @param {number|string} value
 * @param {{ fallback?: string }} [opts]
 * @returns {string}
 */
export function formatPHP(value, { fallback = '—' } = {}) {
    const n = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : value;
    if (n == null || Number.isNaN(n)) return fallback;
    return phpFormatter.format(n);
}
