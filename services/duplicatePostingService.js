/**
 * DUPLICATE-POSTING DETECTION (R1 redesign).
 *
 * The first version only caught an EXACT (title + company) match, so a near-identical
 * repost — same title, slightly different wording, same employer — sailed through and
 * produced two vacancies that then read as "duplicate referrals" downstream (the
 * confusion diagnosed in docs/referral-lifecycle-sync-plan.md). This replaces that with
 * a lightweight SIMILARITY check over the primary business identifiers and classifies
 * the result into confidence levels the UI can act on:
 *
 *   Exact Duplicate  — same normalized title AND employer AND location AND type
 *   High Similarity  — same/near-identical title AND same employer
 *   Possible Duplicate — meaningfully similar title AND (same employer OR same location)
 *
 * It NEVER blocks (reposting a role after the first was Filled is legitimate, invariant
 * of the original R1). The classification drives a confirm dialog (Exact/High) or a
 * warning toast (Possible) in the Create flow; a confirmed repost proceeds unchanged.
 *
 * The similarity is a token Jaccard on the normalized title — cheap, dependency-free,
 * and computed over just ONE admin's own Open/Published postings (a tiny set), so there
 * is no cost concern. Thresholds are env-tunable (configurable, as requested) with safe
 * defaults; nothing here reads secrets or touches the DB (the caller supplies rows), so
 * the classifier is a pure function the test suite can lock without a database.
 */

const HIGH_SIMILARITY = clamp01(Number(process.env.DUP_HIGH_SIMILARITY)) ?? 0.72;
const POSSIBLE_SIMILARITY = clamp01(Number(process.env.DUP_POSSIBLE_SIMILARITY)) ?? 0.45;

function clamp01(n) {
	return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/** Lowercase, strip punctuation, collapse whitespace — so "Sales Lady!" == "sales lady". */
function normalize(s) {
	return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function tokenSet(s) {
	return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Jaccard overlap of the two titles' token sets: |A∩B| / |A∪B|, in [0,1]. */
function titleSimilarity(a, b) {
	const A = tokenSet(a);
	const B = tokenSet(b);
	if (A.size === 0 && B.size === 0) return 1;
	if (A.size === 0 || B.size === 0) return 0;
	let intersection = 0;
	for (const t of A) if (B.has(t)) intersection += 1;
	return intersection / (A.size + B.size - intersection);
}

const LEVEL_RANK = { 'Exact Duplicate': 3, 'High Similarity': 2, 'Possible Duplicate': 1 };

/**
 * Classify how likely `newJob` duplicates any of `existingJobs` (an admin's own
 * Open/Published postings). Pure — no I/O.
 *
 * @param {{title,company,location,job_type}} newJob
 * @param {Array<{id,title,company,location,job_type,status}>} existingJobs
 * @param {{high?:number, possible?:number}} [opts]
 * @returns {{ level: string|null, matches: Array }}
 */
function classifyDuplicates(newJob, existingJobs = [], opts = {}) {
	const high = clamp01(opts.high) ?? HIGH_SIMILARITY;
	const possible = clamp01(opts.possible) ?? POSSIBLE_SIMILARITY;

	const nTitle = normalize(newJob.title);
	const nCompany = normalize(newJob.company);
	const nLocation = normalize(newJob.location);
	const nType = normalize(newJob.job_type);

	const matches = [];

	for (const e of existingJobs) {
		// Only treat title similarity as meaningful when BOTH titles have content —
		// titleSimilarity('','') is mathematically 1 (identical empty sets) but must
		// never count as a match for a title-less draft.
		const titleContentful = nTitle !== '' && normalize(e.title) !== '';
		const sim = titleContentful ? titleSimilarity(newJob.title, e.title) : 0;
		const sameTitle = nTitle !== '' && normalize(e.title) === nTitle;
		const nearTitle = sameTitle || (titleContentful && sim >= high);
		const sameCompany = nCompany !== '' && normalize(e.company) === nCompany;
		const sameLocation = nLocation !== '' && normalize(e.location) === nLocation;
		const sameType = nType !== '' && normalize(e.job_type) === nType;

		let level = null;
		if (sameTitle && sameCompany && sameLocation && sameType) {
			level = 'Exact Duplicate';
		} else if (nearTitle && sameCompany) {
			level = 'High Similarity';
		} else if (titleContentful && sim >= possible && (sameCompany || sameLocation)) {
			level = 'Possible Duplicate';
		}
		if (!level) continue;

		const matchedFields = [];
		if (sameTitle) matchedFields.push('title'); else if (sim >= high) matchedFields.push('similar title');
		if (sameCompany) matchedFields.push('employer');
		if (sameLocation) matchedFields.push('location');
		if (sameType) matchedFields.push('employment type');

		matches.push({
			job_id: e.id,
			title: e.title,
			status: e.status,
			similarity: Math.round(sim * 100),
			matchedFields,
			level,
		});
	}

	matches.sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (b.similarity - a.similarity));
	return { level: matches.length ? matches[0].level : null, matches };
}

/** A human message for the top match, for the confirm dialog / toast. */
function messageFor(assessment, title) {
	if (!assessment.level) return null;
	const n = assessment.matches.length;
	const others = n === 1 ? '' : ` (and ${n - 1} other${n - 1 === 1 ? '' : 's'})`;
	const top = assessment.matches[0];
	const fields = top.matchedFields.join(', ');
	switch (assessment.level) {
		case 'Exact Duplicate':
			return `An identical open posting already exists: “${top.title}” — matching ${fields}${others}. This will create a SEPARATE vacancy (its own referrals and letters). Create it anyway only if this is a genuinely new opening.`;
		case 'High Similarity':
			return `A very similar open posting already exists: “${top.title}” — matching ${fields}${others}. If this is the same role, edit the existing posting instead of creating a duplicate.`;
		default:
			return `A possibly similar open posting already exists: “${top.title}” — matching ${fields}${others}. Double-check you are not duplicating it.`;
	}
}

module.exports = { classifyDuplicates, messageFor, titleSimilarity, normalize, HIGH_SIMILARITY, POSSIBLE_SIMILARITY };
