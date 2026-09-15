const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Referral letter generator.
 *
 * WHY NOT /uploads: server.js serves that folder with express.static, i.e.
 * publicly, with no auth. A referral letter contains a citizen's full name and
 * the employer they were endorsed to. Letters live in storage/ instead, which
 * Express does not serve, and are downloaded through an authenticated route.
 *
 * WHY pdfkit AND NOT A HOSTED SERVICE: no network dependency, no third-party
 * account, no template living in someone else's dashboard. The letter's exact
 * wording is in this file and can be changed in thirty seconds.
 *
 * LAYOUT: this reproduces the official PESO Kabankalan referral letter. When the
 * official full-page letterhead PNG is present it is drawn as a full-bleed page
 * background (city seal, Republic/Province/City lines, campaign logos, rule, and
 * the City Hall footer) and the office subtitle + body are drawn on top. If that
 * image is absent it falls back to a text-only letterhead so letters still
 * generate. The five prescribed body paragraphs carry the applicant's name,
 * address, and applied position; the signatory is the fixed PESO Manager block.
 */

const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'referrals');

const ASSET_ROOT = path.join(__dirname, '..', 'assets', 'letterhead');
// Official full-page letterhead (US-Letter proportion). Preferred when present.
const LETTERHEAD_FULL = path.join(ASSET_ROOT, 'letterhead.png');
// Fallback seals, used only when the full letterhead image is missing.
const SEAL_LEFT = path.join(ASSET_ROOT, 'seal-left.png');
const SEAL_RIGHT = path.join(ASSET_ROOT, 'seal-right.png');

const INK = '#111111';
const MUTED = '#333333';

// The official letter is signed by the PESO Manager, NOT by whichever admin
// approved the referral. Kept configurable so a change of officer is a one-line
// env edit, but defaults to the signatory printed on the official template.
const SIGNATORY_NAME = process.env.PESO_SIGNATORY_NAME || 'ELMA B. BACHITA, PhD';
const SIGNATORY_TITLE = process.env.PESO_SIGNATORY_TITLE || 'City Government Department Head I';
const SIGNATORY_ROLE = process.env.PESO_SIGNATORY_ROLE || '(PESO Manager)';

function ensureStorageDir() {
	if (!fs.existsSync(STORAGE_ROOT)) {
		fs.mkdirSync(STORAGE_ROOT, { recursive: true });
	}
}

/** Resolves a stored relative path to an absolute one. Used by the download route. */
function resolveLetterPath(relativePath) {
	// Guard against path traversal: a poisoned pdf_path must not be able to read
	// arbitrary files off the server.
	const absolute = path.resolve(STORAGE_ROOT, path.basename(relativePath));

	if (!absolute.startsWith(path.resolve(STORAGE_ROOT))) {
		throw new Error('Refused to resolve a letter path outside the storage directory.');
	}

	return absolute;
}

function formatDate(value) {
	return new Date(value || Date.now()).toLocaleDateString('en-PH', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

/**
 * Underlined blank for a missing dynamic value, mirroring the paper form.
 */
function orBlank(value, blankWidthChars) {
	const text = (value || '').toString().trim();
	if (text) return text;
	return '\u00A0'.repeat(blankWidthChars || 24);
}

/**
 * Draws the letterhead and returns { bodyTop, hasImageFooter }.
 *
 * Prefers the official full-page PNG as a full-bleed background. The image lacks
 * the office-specific line, so "Public Employment Service Office" is drawn just
 * below the header rule. Falls back to a drawn text letterhead if the image is
 * absent, so letter generation never depends on the asset being present.
 */
function drawLetterhead(doc) {
	const pageW = doc.page.width;
	const pageH = doc.page.height;
	const pageLeft = doc.page.margins.left;
	const contentWidth = pageW - doc.page.margins.left - doc.page.margins.right;

	if (fs.existsSync(LETTERHEAD_FULL)) {
		try {
			doc.image(LETTERHEAD_FULL, 0, 0, { width: pageW, height: pageH });

			// NO subtitle is drawn here. The official artwork ALREADY carries the
			// "PUBLIC EMPLOYMENT SERVICE OFFICE" line in its header; drawing it
			// again printed the same words twice, slightly offset. Only the
			// text-only fallback below needs to render that line itself, because
			// there it is genuinely absent.
			//
			// The artwork's header ends ~12.8% down the page. Body starts at 18.5%
			// to clear it with a normal letter's breathing room.
			return { bodyTop: pageH * 0.185, hasImageFooter: true };
		} catch (e) {
			// A corrupt image must never break letter generation -- fall through
			// to the text letterhead below.
		}
	}

	// --- Fallback: drawn text letterhead (+ optional seals) ---
	const top = doc.page.margins.top;
	const sealBox = 74;
	if (fs.existsSync(SEAL_LEFT)) {
		try { doc.image(SEAL_LEFT, pageLeft, top, { fit: [sealBox, sealBox], align: 'center', valign: 'center' }); } catch (e) {}
	}
	if (fs.existsSync(SEAL_RIGHT)) {
		try { doc.image(SEAL_RIGHT, pageW - doc.page.margins.right - sealBox, top, { fit: [sealBox, sealBox], align: 'center', valign: 'center' }); } catch (e) {}
	}
	doc.fillColor(INK);
	doc.font('Times-Roman').fontSize(11).text('Republic of the Philippines', pageLeft, top + 4, { width: contentWidth, align: 'center' });
	doc.font('Times-Roman').fontSize(11).text('Province of Negros Occidental', { width: contentWidth, align: 'center' });
	doc.font('Times-Bold').fontSize(12).text('CITY OF KABANKALAN', { width: contentWidth, align: 'center' });
	doc.font('Times-Bold').fontSize(14).text('Public Employment Service Office', { width: contentWidth, align: 'center' });
	const ruleY = Math.max(doc.y, top + sealBox) + 8;
	doc.moveTo(pageLeft, ruleY).lineTo(pageW - doc.page.margins.right, ruleY).lineWidth(1).strokeColor(INK).stroke();
	return { bodyTop: ruleY + 18, hasImageFooter: false };
}

/**
 * Renders the referral letter and returns BOTH representations:
 *
 *   { fileName, buffer }
 *
 * The buffer is what gets stored in referral_letter_files (migration 021) and
 * is the durable copy. The disk write is retained during the expand phase so a
 * rollback to the previous code has files to serve; once the DB path is proven
 * in production, the disk half of this function goes away with pdf_path.
 *
 * WHY COLLECT THE BUFFER RATHER THAN READ THE FILE BACK: on Render the file may
 * not survive long enough to be read back, and re-reading is a second chance to
 * fail for no benefit. pdfkit is already streaming the bytes -- capture them in
 * passing.
 *
 * IDEMPOTENT BY FILENAME: the file is named after the reference number, which is
 * unique. If the worker crashes after writing the file but before committing the
 * DB update, the retry overwrites the same file with identical content. No
 * orphans, no duplicates.
 */
function generateReferralLetter(referral) {
	ensureStorageDir();

	const fileName = `${referral.reference_number}.pdf`;
	const absolutePath = path.join(STORAGE_ROOT, fileName);

	return new Promise((resolve, reject) => {
		try {
			// bottom margin 0 so the address line can sit in the white band beneath
			// the City Hall footer graphic without pdfkit spawning a second page.
			const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 0, left: 72, right: 72 } });
			const stream = fs.createWriteStream(absolutePath);

			const chunks = [];
			doc.on('data', (chunk) => chunks.push(chunk));

			// The promise must settle on the STREAM, not on doc.end(). doc.end()
			// returns before the bytes are flushed -- resolving there would let the
			// worker mark the step complete while the file is still half-written.
			// The buffer is complete by the time the stream finishes, so settling
			// here is correct for both outputs.
			stream.on('finish', () => resolve({ fileName, buffer: Buffer.concat(chunks) }));
			stream.on('error', reject);
			doc.on('error', reject);

			doc.pipe(stream);

			const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
			const bodyOptions = { width: contentWidth, align: 'justify', lineGap: 3, indent: 28 };

			// --- Letterhead ---
			const { bodyTop, hasImageFooter } = drawLetterhead(doc);
			doc.x = doc.page.margins.left;
			doc.y = bodyTop;

			// --- Date ---
			doc.font('Times-Roman').fontSize(12).fillColor(INK);
			doc.text(`Date: ${formatDate(referral.reviewed_at || referral.created_at)}`, { align: 'left' });
			doc.moveDown(1.2);

			// --- Addressee ---
			doc.font('Times-Bold').fontSize(12).text('THE MANAGER', { align: 'left' });
			doc.font('Times-Roman').fontSize(12).text((referral.company_name || 'Name of Company').toString(), { align: 'left' });
			doc.text(orBlank(referral.company_address || referral.job_location, 34), { align: 'left', underline: !(referral.company_address || referral.job_location) });
			doc.moveDown(0.9);

			// --- Salutation ---
			doc.text(`Dear Ma\u2019am ${orBlank(null, 14)}:`, { align: 'left' });
			doc.moveDown(0.6);

			// --- Body ---
			doc.font('Times-Roman').fontSize(12).fillColor(INK);
			doc.text('The Public Employment Service Office (PESO) is privileged to have partnership with your company in terms of employment facilitation. This is one way of helping our constituents in finding job that suits their qualifications.', bodyOptions);
			doc.moveDown(0.6);

			// Paragraph 2 carries the dynamic data; applicant name in bold.
			doc.text('In line with this, I am endorsing to you  ', { ...bodyOptions, continued: true });
			doc.font('Times-Bold').text(orBlank(referral.applicant_name, 18), { continued: true });
			doc.font('Times-Roman').text(', a resident of ', { continued: true });
			doc.text(orBlank(referral.applicant_address, 22), { continued: true });
			doc.text(' and applying for ', { continued: true });
			doc.text(orBlank(referral.job_title, 20), { continued: true });
			doc.text(' position based on your Job hiring.', { align: 'justify', lineGap: 3 });
			doc.moveDown(0.6);

			doc.text('We will continue coordinating with you in line with your hired personnel through our referral/facilitation services for our Labor Market Information Analysis.', bodyOptions);
			doc.moveDown(0.6);
			doc.text('Thank you for your partnership with us in terms of employment facilitation.', bodyOptions);
			doc.moveDown(0.6);
			doc.text('God bless you always.', bodyOptions);
			doc.moveDown(1.4);

			// --- Complimentary close ---
			doc.text('Very truly yours,', { align: 'left' });
			doc.moveDown(2.6);

			// --- Signatory (fixed PESO Manager block, right of centre) ---
			const sigLeft = doc.page.margins.left + contentWidth * 0.42;
			const sigWidth = contentWidth - contentWidth * 0.42;
			doc.font('Times-Bold').fontSize(12).text(SIGNATORY_NAME, sigLeft, doc.y, { width: sigWidth, align: 'center' });
			doc.font('Times-Roman').fontSize(11).text(SIGNATORY_TITLE, sigLeft, doc.y, { width: sigWidth, align: 'center' });
			doc.text(SIGNATORY_ROLE, sigLeft, doc.y, { width: sigWidth, align: 'center' });

			// --- File reference (left) ---
			doc.moveDown(1.4);
			doc.font('Times-Italic').fontSize(9).fillColor(MUTED)
				.text(`PESO/referraletter  \u2014  Ref. No: ${referral.reference_number}`, doc.page.margins.left, doc.y, { align: 'left' });

			// --- Address line, in the white band beneath the City Hall footer ---
			//
			// ONLY when the letterhead image is absent. The official artwork
			// already carries this address strip at the same position, so drawing
			// it here too printed both copies a couple of points apart -- legible
			// as a blur rather than as text. hasImageFooter has been returned by
			// drawLetterhead since it was written; it was simply never read.
			if (!hasImageFooter) {
				const footerWidth = doc.page.width - 108;
				doc.font('Times-Roman').fontSize(8).fillColor(MUTED)
					.text('2F Kabankalan City Hall, J.Y. Perez Ave., 6111 Kabankalan City, Negros Occidental, Negros Island Region', 54, doc.page.height - 26, { align: 'center', width: footerWidth });
				doc.text('lgu@kabankalancity.gov.ph     www.kabankalancity.gov.ph', 54, doc.page.height - 16, { align: 'center', width: footerWidth });
			}

			doc.end();
		} catch (error) {
			reject(error);
		}
	});
}

module.exports = { generateReferralLetter, resolveLetterPath, STORAGE_ROOT };