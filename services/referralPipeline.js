
/**
 * Referral delivery pipeline definition.
 *
 * The ONLY place step order is declared. The service enqueues at FIRST_STEP;
 * the worker advances via getNextStep(). Neither hardcodes a step name, so
 * adding 'generate_pdf' in Phase 4 means editing this array and writing one
 * handler -- nothing else in the system needs to know.
 *
 * Steps must be:
 *   IDEMPOTENT-SAFE -- a crash after the work but before the DB commit means
 *                      the step reruns. Design each one so that is survivable.
 *   ORDERED         -- once a step commits, it never reruns. This is why
 *                      send_email can be added later without risking a double
 *                      send: the step marker advances past it permanently.
 */

const STEP_SEQUENCE = [
	'generate_pdf',
	'send_email',
	'notify',
	'dispatch_n8n'
];

const FIRST_STEP = STEP_SEQUENCE[0];

/** Returns the next step, or null when the pipeline is finished. */
function getNextStep(currentStep) {
	const index = STEP_SEQUENCE.indexOf(currentStep);

	if (index === -1) return null;
	if (index === STEP_SEQUENCE.length - 1) return null;

	return STEP_SEQUENCE[index + 1];
}

function isKnownStep(step) {
	return STEP_SEQUENCE.includes(step);
}

module.exports = { STEP_SEQUENCE, FIRST_STEP, getNextStep, isKnownStep };