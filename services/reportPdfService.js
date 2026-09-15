/**
 * reportPdfService — renders the DOLE PESO Accomplishment Report as a PDF (Phase A).
 *
 * Self-hosted via pdfkit (no external service), returned as a Buffer the route streams
 * with an auth-header download. Deliberately does NOT use the referral-LETTER full-page
 * letterhead image: that artwork is a single-page header+footer with a blank middle
 * (§13) and would double-print its footer on a multi-page table report. A report is a
 * different document type, so it uses a clean text header + page-break-aware tables.
 *
 * Pure formatting — takes the already-built report object (services/reportingService)
 * and never touches the DB.
 */
const PDFDocument = require('pdfkit');

const OFFICE_NAME = process.env.PESO_OFFICE_NAME || 'Public Employment Service Office — Kabankalan City';

const fmtDate = (iso) => {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};
const periodLabel = (range) => {
	if (!range?.from && !range?.to) return 'All records to date';
	return `${range.from ? fmtDate(range.from) : 'Beginning'} – ${range.to ? fmtDate(range.to) : 'Present'}`;
};
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-PH'));
const pctLabel = (v) => (v == null ? '—' : `${v}%`);

/** Page-break-aware table. Returns the y after the table. */
function drawTable(doc, { x, y, headers, rows, widths, totalRow = null }) {
	const rowH = 22;
	const bottom = doc.page.height - doc.page.margins.bottom;
	const drawRow = (cells, yy, { bold = false, fill = null } = {}) => {
		if (fill) doc.rect(x, yy, widths.reduce((a, b) => a + b, 0), rowH).fill(fill);
		let cx = x;
		doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#1a2a24');
		cells.forEach((cell, i) => {
			const align = i === 0 ? 'left' : 'right';
			doc.text(String(cell), cx + 6, yy + 6, { width: widths[i] - 12, align, lineBreak: false });
			cx += widths[i];
		});
		// borders
		doc.strokeColor('#d5dbd8').lineWidth(0.5).rect(x, yy, widths.reduce((a, b) => a + b, 0), rowH).stroke();
		return yy + rowH;
	};

	let yy = drawRow(headers, y, { bold: true, fill: '#eef2f0' });
	for (const r of rows) {
		if (yy + rowH > bottom) { doc.addPage(); yy = doc.page.margins.top; yy = drawRow(headers, yy, { bold: true, fill: '#eef2f0' }); }
		yy = drawRow(r, yy);
	}
	if (totalRow) {
		if (yy + rowH > bottom) { doc.addPage(); yy = doc.page.margins.top; }
		yy = drawRow(totalRow, yy, { bold: true, fill: '#f6f8f7' });
	}
	return yy;
}

function sectionTitle(doc, text, y) {
	doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f3d2e').text(text, doc.page.margins.left, y);
	return doc.y + 6;
}

/**
 * @param {object} report  the object from reportingService.buildAccomplishmentReport
 * @returns {Promise<Buffer>}
 */
function renderAccomplishmentReportPdf(report) {
	return new Promise((resolve, reject) => {
		try {
			const doc = new PDFDocument({ size: 'LETTER', margins: { top: 56, bottom: 56, left: 56, right: 56 } });
			const chunks = [];
			doc.on('data', (c) => chunks.push(c));
			doc.on('end', () => resolve(Buffer.concat(chunks)));
			doc.on('error', reject);

			const left = doc.page.margins.left;
			const contentW = doc.page.width - left - doc.page.margins.right;

			// ── Header ──────────────────────────────────────────────────────────
			doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f3d2e')
				.text('PESO Accomplishment Report', { align: 'center' });
			doc.font('Helvetica').fontSize(10).fillColor('#4b5a54')
				.text(OFFICE_NAME, { align: 'center' });
			doc.moveDown(0.4);
			doc.fontSize(9).fillColor('#4b5a54')
				.text(`Reporting period: ${periodLabel(report.range)}`, { align: 'center' })
				.text(`Scope: ${report.scope === 'office' ? 'Office-wide' : 'Administrator'}   ·   Generated: ${fmtDate(report.generated_at)}`, { align: 'center' });
			doc.moveDown(0.6);
			doc.strokeColor('#0f3d2e').lineWidth(1).moveTo(left, doc.y).lineTo(left + contentW, doc.y).stroke();
			doc.moveDown(0.8);

			// ── Summary ─────────────────────────────────────────────────────────
			const s = report.summary;
			let y = sectionTitle(doc, 'Summary', doc.y);
			y = drawTable(doc, {
				x: left, y,
				headers: ['Indicator', 'Count'],
				widths: [contentW - 120, 120],
				rows: [
					['Registered applicants (office-wide)', num(s.registered)],
					['Vacancies solicited', num(s.vacancies_solicited)],
					['Positions solicited', num(s.positions_solicited)],
					['Applicants referred', num(s.referred)],
					['Applicants placed (Hired)', num(s.placed)],
				],
			});
			doc.y = y;
			doc.moveDown(0.7);

			// ── Placement rate ──────────────────────────────────────────────────
			y = sectionTitle(doc, 'Placement rate', doc.y);
			doc.font('Helvetica').fontSize(9).fillColor('#1a2a24');
			doc.text(`Of all referred: ${pctLabel(report.placement_rate.of_all)}   ·   Of referrals with a recorded outcome: ${pctLabel(report.placement_rate.of_known)}`, left, y);
			doc.fillColor('#4b5a54').fontSize(8).text(report.placement_rate.basis, left, doc.y + 2);
			doc.moveDown(0.8);

			// ── By sex ──────────────────────────────────────────────────────────
			const demoCols = (rows) => rows.map((r) => [r.bucket, num(r.registered), num(r.referred), num(r.placed)]);
			const totalOf = (rows, label) => [label,
				num(rows.reduce((a, r) => a + r.registered, 0)),
				num(rows.reduce((a, r) => a + r.referred, 0)),
				num(rows.reduce((a, r) => a + r.placed, 0))];

			y = sectionTitle(doc, 'By sex', doc.y);
			y = drawTable(doc, {
				x: left, y,
				headers: ['Sex', 'Registered', 'Referred', 'Placed'],
				widths: [contentW - 240, 80, 80, 80],
				rows: demoCols(report.by_sex),
				totalRow: totalOf(report.by_sex, 'Total'),
			});
			doc.y = y;
			doc.moveDown(0.7);

			// ── By educational attainment ───────────────────────────────────────
			y = sectionTitle(doc, 'By educational attainment', doc.y);
			y = drawTable(doc, {
				x: left, y,
				headers: ['Educational attainment', 'Registered', 'Referred', 'Placed'],
				widths: [contentW - 240, 80, 80, 80],
				rows: demoCols(report.by_education),
				totalRow: totalOf(report.by_education, 'Total'),
			});
			doc.y = y;
			doc.moveDown(0.7);

			// ── By age group ────────────────────────────────────────────────────
			y = sectionTitle(doc, 'By age group', doc.y);
			y = drawTable(doc, {
				x: left, y,
				headers: ['Age group', 'Registered', 'Referred', 'Placed'],
				widths: [contentW - 240, 80, 80, 80],
				rows: demoCols(report.by_age_group || []),
				totalRow: totalOf(report.by_age_group || [], 'Total'),
			});
			doc.y = y;
			doc.moveDown(0.8);

			// ── Notes ───────────────────────────────────────────────────────────
			if (Array.isArray(report.notes) && report.notes.length) {
				if (doc.y + 60 > doc.page.height - doc.page.margins.bottom) doc.addPage();
				sectionTitle(doc, 'Notes', doc.y);
				doc.font('Helvetica').fontSize(8).fillColor('#4b5a54');
				report.notes.forEach((n) => doc.text(`•  ${n}`, left, doc.y + 2, { width: contentW }));
			}

			doc.end();
		} catch (error) {
			reject(error);
		}
	});
}

module.exports = { renderAccomplishmentReportPdf };
