/**
 * SMS message templates — keyed, centralized (docs/sms-notification-proposal.md §5).
 *
 * NEVER inline SMS body strings at a call site. SMS is billed per ~160-char segment,
 * so every template is deliberately short (one segment where possible) and free of
 * PII beyond a first name. A template returns null when it does not apply, so a caller
 * can pass a whole notification through and only the SMS-relevant types produce a body.
 *
 * SCOPE (owner decision): only REFERRAL events and the WALK-IN CLAIM text fan out to
 * SMS for now — application-status and event broadcasts stay in-app + email only, to
 * keep SMS cost bounded. Adding a type later is one entry here + one line in
 * SMS_FANOUT_TYPES (notificationService).
 */

const { appUrl } = require('../utils/appUrl');

const APP_NAME = 'PESO Kabankalan';

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * The set of in-app notification TYPES that also fan out to SMS. Kept beside the
 * templates so the two never drift. notificationService reads this.
 * ACCOUNT_REACTIVATED is here so reactivation is consistent with suspension over SMS.
 */
const SMS_FANOUT_TYPES = new Set(['REFERRAL_ISSUED', 'REFERRAL_ENDORSEMENT', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']);

/**
 * Render the SMS body for an in-app notification, or null if this type is not an SMS
 * type. `notification` is the same { type, title, body } the bell row carries, plus an
 * optional recipient name for the greeting.
 */
function renderForNotification({ type, name, title, body } = {}) {
	// Deep links route through the app's auth guard — a logged-out tap lands on sign-in;
	// no token is embedded, so no referral/account data is exposed without a session.
	switch (type) {
		case 'REFERRAL_ISSUED':
			return `${APP_NAME}: Hi ${firstName(name)}, your referral letter has been issued. Review it: ${appUrl('/referrals')}`;
		case 'REFERRAL_ENDORSEMENT':
			return `${APP_NAME}: Hi ${firstName(name)}, PESO has endorsed you for a job. Sign in to review & accept: ${appUrl('/referrals')}`;
		case 'ACCOUNT_SUSPENDED':
			// Suspension notice (item 4). No link — a suspended user cannot sign in; direct
			// them to the office. No reason text over SMS (sensitive/long); in-app + email carry it.
			return `${APP_NAME}: Hi ${firstName(name)}, your account has been suspended. Please contact the PESO Kabankalan office for assistance.`;
		case 'ACCOUNT_REACTIVATED':
			return `${APP_NAME}: Hi ${firstName(name)}, your account has been reactivated. Sign in: ${appUrl('/')}`;
		default:
			// Not an SMS type — fall back to null so the router skips SMS for it. (A
			// generic body is intentionally NOT sent for unknown types: SMS costs money
			// and un-vetted copy could leak PII.)
			return SMS_FANOUT_TYPES.has(type) ? `${APP_NAME}: ${title}` : null;
	}
}

/**
 * The walk-in account-claim text. Not a bell notification — sent directly at
 * registration/reissue time to a phone that has NOT been verified yet (the claim code
 * is the credential; the office vouched for the number in person). Carries the two
 * things the seeker needs — the claim PAGE URL and the CODE — plus a one-line
 * instruction (open the link, enter the code) and a do-not-share note. No account data
 * beyond the claim code + the public claim page. The URL is always absolute + env-driven
 * (falls back to appUrl('/claim') if a caller omitted it), so it is a real tappable link
 * in both local dev and production — never a bare relative path.
 */
function walkInClaim({ name, claimCode, claimUrl }) {
	const url = claimUrl || appUrl('/claim');
	return `${APP_NAME}: Hi ${firstName(name)}, claim your account — open ${url} and enter code ${claimCode} to activate. Do not share this code.`;
}

module.exports = { SMS_FANOUT_TYPES, renderForNotification, walkInClaim, APP_NAME };
