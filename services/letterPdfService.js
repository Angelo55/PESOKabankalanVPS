const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');

/**
 * Self-hosted letter PDF generator (cover letters + resignation letters).
 *
 * REPLACES PDFMonkey — an external, paid, template-hosted service these two
 * builders depended on. That was a real availability gap: a PDFMonkey outage or
 * an expired key failed the export with a 500, and the whole flow was an async
 * create-then-poll round-trip. Referral letters already proved pdfkit works
 * self-hosted (services/pdfService.js); this brings the same durability to the
 * builders. No external call, no template id, no polling — render and stream.
 *
 * Both builders POST the same envelope: { letterData }. The two documents share
 * a formal business-letter layout (sender block → date → recipient → subject →
 * salutation → body → closing → signature); only the field mapping differs.
 * Every field is read defensively — a missing piece is skipped, never a crash.
 */

const INK = '#1f2933';
const MUTED = '#52606d';
const ACCENT = '#134e48';   // brand green
const MARGIN = { top: 64, bottom: 64, left: 64, right: 64 };

/** Splits a body blob into paragraphs, tolerant of blank-line OR line-per-para input. */
function paragraphs(body) {
	const raw = String(body || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];
	if (/\n\s*\n/.test(raw)) {
		// Blank-line separated: collapse soft wraps inside each paragraph.
		return raw.split(/\n\s*\n/).map((p) => p.replace(/\n+/g, ' ').trim()).filter(Boolean);
	}
	// No blank lines: treat each line as its own paragraph.
	return raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

function formatDate(value) {
	const date = value ? new Date(value) : new Date();
	const safe = Number.isNaN(date.getTime()) ? new Date() : date;
	return safe.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Renders a formal business letter into `doc`.
 * @param {object} s  { senderName, senderContacts[], date, recipientLines[],
 *                      subject, salutation, bodyParas[], closing, signatureName }
 */
function renderBusinessLetter(doc, s) {
	const width = doc.page.width - MARGIN.left - MARGIN.right;

	// Sender
	doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(s.senderName || '', { width });
	const contacts = (s.senderContacts || []).filter(Boolean);
	if (contacts.length) {
		doc.moveDown(0.2).fillColor(MUTED).font('Helvetica').fontSize(10).text(contacts.join('   |   '), { width });
	}
	doc.moveDown(0.6);
	doc.strokeColor(ACCENT).lineWidth(1.5)
		.moveTo(MARGIN.left, doc.y).lineTo(doc.page.width - MARGIN.right, doc.y).stroke();
	doc.moveDown(0.9);

	// Date
	doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text(s.date, { width });
	doc.moveDown(1.0);

	// Recipient
	const recipient = (s.recipientLines || []).filter(Boolean);
	if (recipient.length) {
		doc.fillColor(INK).font('Helvetica').fontSize(10.5);
		recipient.forEach((line) => doc.text(line, { width }));
		doc.moveDown(0.9);
	}

	// Subject
	if (s.subject) {
		doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(s.subject, { width });
		doc.moveDown(0.8);
	}

	// Salutation
	if (s.salutation) {
		doc.fillColor(INK).font('Helvetica').fontSize(11).text(s.salutation, { width });
		doc.moveDown(0.6);
	}

	// Body
	const paras = s.bodyParas || [];
	if (paras.length === 0) {
		doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(11)
			.text('(No letter content was provided.)', { width });
		doc.moveDown(0.7);
	} else {
		paras.forEach((p) => {
			doc.fillColor(INK).font('Helvetica').fontSize(11).text(p, { width, align: 'left', lineGap: 3 });
			doc.moveDown(0.7);
		});
	}

	// Closing + signature (blank line left for a wet signature)
	doc.moveDown(0.4);
	doc.fillColor(INK).font('Helvetica').fontSize(11).text(s.closing || 'Sincerely,', { width });
	doc.moveDown(1.8);
	doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(s.signatureName || s.senderName || '', { width });
}

/** Streams a cover-letter PDF into `res` (caller sets headers, must not res.json after). */
function streamCoverLetter(letterData, res) {
	const d = letterData || {};
	const applicant = d.applicant || {};
	const target = d.target || {};

	const doc = new PDFDocument({ size: 'LETTER', margins: MARGIN });
	doc.pipe(res);

	renderBusinessLetter(doc, {
		senderName: applicant.name || 'Applicant',
		senderContacts: [applicant.email, applicant.phone, applicant.location],
		date: formatDate(),
		recipientLines: [target.hiringManager, target.department, target.company],
		subject: target.position ? `RE: Application for the ${target.position} position` : null,
		salutation: `Dear ${target.hiringManager || 'Hiring Manager'},`,
		bodyParas: paragraphs(d.body),
		closing: 'Sincerely,',
		signatureName: applicant.name || '',
	});

	doc.end();
}

/** Streams a resignation-letter PDF into `res`. */
function streamResignation(letterData, res) {
	const d = letterData || {};
	const employee = d.employee || {};
	const employment = d.employment || {};
	const details = d.details || {};

	const doc = new PDFDocument({ size: 'LETTER', margins: MARGIN });
	doc.pipe(res);

	renderBusinessLetter(doc, {
		senderName: employee.name || 'Employee',
		senderContacts: [employee.email, employee.phone],
		date: formatDate(details.date),
		recipientLines: [employment.managerName, employment.company],
		subject: `RE: Letter of Resignation${employment.position ? ` — ${employment.position}` : ''}`,
		salutation: `Dear ${employment.managerName || 'Manager'},`,
		bodyParas: paragraphs(d.body),
		closing: 'Sincerely,',
		signatureName: employee.name || '',
	});

	doc.end();
}

// Buffer variants — render fully in memory so the ROUTE can catch a render error
// and still return JSON (a mid-stream failure after headers are sent cannot).
function toBuffer(streamFn, letterData) {
	return new Promise((resolve, reject) => {
		try {
			const collector = new PassThrough();
			const chunks = [];
			collector.on('data', (c) => chunks.push(c));
			collector.on('end', () => resolve(Buffer.concat(chunks)));
			collector.on('error', reject);
			streamFn(letterData, collector);
		} catch (err) {
			reject(err);
		}
	});
}

const renderCoverLetterToBuffer = (d) => toBuffer(streamCoverLetter, d);
const renderResignationToBuffer = (d) => toBuffer(streamResignation, d);

module.exports = {
	streamCoverLetter, streamResignation,
	renderCoverLetterToBuffer, renderResignationToBuffer,
};
