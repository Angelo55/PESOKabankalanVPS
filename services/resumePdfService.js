const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');

/**
 * Resume PDF generator (self-hosted, modern ATS layout).
 *
 * WHY THIS SHAPE: the previous export read like a CV -- centered name, full-width
 * justified paragraphs, no bullets. This renders a modern one-page resume:
 * single column (so an ATS parses it top-to-bottom without column scrambling),
 * every field as REAL selectable text, standard section headings, and bulleted
 * achievements. The optional photo is a decorative embedded image; ATS parsers
 * ignore images, so parseability is unaffected whether or not one is present.
 *
 * Accepts the payload the frontend already sends:
 *   { personal: { name, email, phone, location, summary, photo },
 *     skills: "comma, separated string",
 *     experience: [ { role, company, dates, description } ],
 *     education:  [ { degree, school, year } ] }
 *
 * `photo` is an optional data URL (data:image/...;base64,...). Every field is
 * defensively read -- a missing section is skipped, a bad photo is ignored,
 * never a crash.
 */

const ACCENT = '#134e48';   // brand green (7:1 on white)
const NAME_DARK = '#0b1c30';
const TEXT_DARK = '#1f2933';
const TEXT_GREY = '#52606d';
const RULE_GREY = '#d3dbe2';

const MARGIN = { top: 46, bottom: 52, left: 52, right: 52 };

function drawPhoto(doc, photo, x, y, size) {
	// Returns true if a photo was drawn, false otherwise. Never throws.
	if (!photo || typeof photo !== 'string' || photo.indexOf('base64,') === -1) return false;
	try {
		const base64 = photo.split('base64,').pop();
		const buffer = Buffer.from(base64, 'base64');
		if (!buffer || buffer.length === 0) return false;

		const cx = x + size / 2;
		const cy = y + size / 2;

		doc.save();
		doc.circle(cx, cy, size / 2).clip();
		doc.image(buffer, x, y, { width: size, height: size });
		doc.restore();

		doc.lineWidth(1.2).strokeColor(ACCENT).circle(cx, cy, size / 2).stroke();
		return true;
	} catch (error) {
		// A malformed image must never break the export -- render text-only.
		return false;
	}
}

function sectionTitle(doc, title) {
	doc.moveDown(0.9);
	const y = doc.y;
	doc.fillColor(ACCENT)
		.font('Helvetica-Bold')
		.fontSize(11)
		.text(title.toUpperCase(), MARGIN.left, y, { characterSpacing: 1 });

	doc.strokeColor(RULE_GREY)
		.lineWidth(1)
		.moveTo(MARGIN.left, doc.y + 2)
		.lineTo(doc.page.width - MARGIN.right, doc.y + 2)
		.stroke();

	doc.moveDown(0.55);
}

function twoColumnRow(doc, leftText, rightText, contentWidth) {
	// Bold left label + right-aligned meta on the same baseline.
	const rowY = doc.y;
	doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(11)
		.text(leftText || '', MARGIN.left, rowY, { width: contentWidth * 0.7, continued: false });

	if (rightText) {
		doc.fillColor(TEXT_GREY).font('Helvetica').fontSize(9.5)
			.text(rightText, MARGIN.left, rowY, { align: 'right', width: contentWidth });
	}
}

function bulletedDescription(doc, description, contentWidth) {
	const raw = String(description || '').trim();
	if (!raw) return;

	// Treat each line (or sentence, if a single blob) as a bullet.
	let items = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (items.length === 1) {
		items = items[0].split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
	}

	doc.moveDown(0.2);
	items.forEach((item) => {
		const y = doc.y;
		doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(10).text('•', MARGIN.left + 2, y, { width: 10 });
		doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10)
			.text(item, MARGIN.left + 16, y, { width: contentWidth - 16, align: 'left', lineGap: 1.5 });
	});
}

/**
 * Streams a resume PDF into `res`. The caller sets headers before calling and
 * must NOT call res.json() afterwards -- doc.pipe(res) owns the response.
 */
function streamResume(resumeData, res) {
	const personal = resumeData.personal || {};
	const experience = Array.isArray(resumeData.experience) ? resumeData.experience : [];
	const education = Array.isArray(resumeData.education) ? resumeData.education : [];
	const skills = typeof resumeData.skills === 'string' ? resumeData.skills.trim() : '';

	const doc = new PDFDocument({ size: 'LETTER', margins: MARGIN });
	doc.pipe(res);

	const contentWidth = doc.page.width - MARGIN.left - MARGIN.right;
	const photoSize = 74;
	const hasPhoto = !!(personal.photo && String(personal.photo).indexOf('base64,') !== -1);
	const nameWidth = hasPhoto ? contentWidth - photoSize - 20 : contentWidth;

	// --- Header: name + contact (left), optional photo (right) ---
	let photoDrawn = false;
	if (hasPhoto) {
		photoDrawn = drawPhoto(doc, personal.photo, doc.page.width - MARGIN.right - photoSize, MARGIN.top, photoSize);
	}

	const headerTop = MARGIN.top;
	doc.fillColor(NAME_DARK)
		.font('Helvetica-Bold')
		.fontSize(23)
		.text((personal.name || 'Untitled').toUpperCase(), MARGIN.left, headerTop, {
			width: photoDrawn ? nameWidth : contentWidth,
			characterSpacing: 0.5
		});

	const contactParts = [personal.email, personal.phone, personal.location].filter(Boolean);
	if (contactParts.length > 0) {
		doc.moveDown(0.35);
		doc.fillColor(TEXT_GREY)
			.font('Helvetica')
			.fontSize(9.5)
			.text(contactParts.join('   |   '), MARGIN.left, doc.y, {
				width: photoDrawn ? nameWidth : contentWidth
			});
	}

	// Drop below whichever is taller: the text block or the photo.
	const textBottom = doc.y;
	const photoBottom = photoDrawn ? MARGIN.top + photoSize : 0;
	doc.y = Math.max(textBottom, photoBottom) + 10;

	doc.strokeColor(ACCENT)
		.lineWidth(2)
		.moveTo(MARGIN.left, doc.y)
		.lineTo(doc.page.width - MARGIN.right, doc.y)
		.stroke();

	// --- Summary ---
	if (personal.summary && personal.summary.trim()) {
		sectionTitle(doc, 'Professional Summary');
		doc.fillColor(TEXT_DARK)
			.font('Helvetica')
			.fontSize(10)
			.text(personal.summary.trim(), MARGIN.left, doc.y, { width: contentWidth, align: 'left', lineGap: 2 });
	}

	// --- Experience ---
	if (experience.length > 0) {
		sectionTitle(doc, 'Professional Experience');
		experience.forEach((exp, index) => {
			twoColumnRow(doc, exp.role || '', exp.dates || '', contentWidth);
			if (exp.company) {
				doc.fillColor(ACCENT).font('Helvetica-Oblique').fontSize(10)
					.text(exp.company, MARGIN.left, doc.y, { width: contentWidth });
			}
			bulletedDescription(doc, exp.description, contentWidth);
			if (index < experience.length - 1) doc.moveDown(0.6);
		});
	}

	// --- Education ---
	if (education.length > 0) {
		sectionTitle(doc, 'Education');
		education.forEach((edu, index) => {
			twoColumnRow(doc, edu.degree || '', edu.year || '', contentWidth);
			if (edu.school) {
				doc.fillColor(TEXT_GREY).font('Helvetica-Oblique').fontSize(10)
					.text(edu.school, MARGIN.left, doc.y, { width: contentWidth });
			}
			if (index < education.length - 1) doc.moveDown(0.45);
		});
	}

	// --- Skills (normalized, comma-delimited plain text for ATS) ---
	if (skills) {
		sectionTitle(doc, 'Skills & Competencies');
		const normalized = skills
			.split(/[\n,]/)
			.map((s) => s.trim())
			.filter(Boolean)
			.join('   •   ');
		doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(10)
			.text(normalized || skills, MARGIN.left, doc.y, { width: contentWidth, lineGap: 3 });
	}

	doc.end();
}

// Renders the same resume PDF to an in-memory Buffer instead of an HTTP response.
// Reuses streamResume by piping into a collector stream, so the generated document
// is byte-identical to what /resume/generate streams to the browser.
function renderResumeToBuffer(resumeData) {
	return new Promise((resolve, reject) => {
		try {
			const collector = new PassThrough();
			const chunks = [];
			collector.on('data', (chunk) => chunks.push(chunk));
			collector.on('end', () => resolve(Buffer.concat(chunks)));
			collector.on('error', reject);
			streamResume(resumeData, collector);
		} catch (err) {
			reject(err);
		}
	});
}

module.exports = { streamResume, renderResumeToBuffer };