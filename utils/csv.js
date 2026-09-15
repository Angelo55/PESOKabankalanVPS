/**
 * CSV helpers shared by every export in the platform.
 *
 * EXTRACTED, NOT REWRITTEN: this logic was proven on the referral DOLE export and
 * is now reused by the ATS applicant export and the dashboard summary export. One
 * copy means an injection-defence fix lands everywhere at once — three
 * hand-rolled escapers would inevitably drift, and the one that drifted would be
 * the one opened in Excel by a government office.
 */

/**
 * Escapes one CSV field.
 *
 * Quotes every value rather than only the risky ones: applicant names and
 * employer names routinely contain commas ("dela Cruz, Juan Jr."), and free-text
 * outcome notes can contain quotes and newlines. Blanket quoting removes the
 * chance of a field being judged safe wrongly.
 *
 * The leading apostrophe on =, +, - and @ is CSV injection defence: Excel treats
 * a leading = as a formula, so an outcome note beginning "=cmd" would execute on
 * open. These files are opened in Excel by definition.
 */
function csvField(value) {
	if (value === null || value === undefined) return '""';
	let text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
	if (/^[=+\-@]/.test(text)) text = `'${text}`;
	return `"${text.replace(/"/g, '""')}"`;
}

/** Joins a header + rows into a CRLF-delimited CSV body. */
function csvBody(header, rows) {
	const lines = [header.map(csvField).join(',')];
	for (const row of rows) lines.push(row.map(csvField).join(','));
	return lines.join('\r\n');
}

/**
 * Sends a CSV download.
 *
 * The BOM is why Excel opens UTF-8 correctly — without it Filipino names with
 * accented characters render as mojibake. The filename is stripped of quotes and
 * newlines so it cannot break out of the Content-Disposition header.
 */
function sendCsv(res, filename, header, rows) {
	const safeName = String(filename).replace(/["\r\n]/g, '');
	res.setHeader('Content-Type', 'text/csv; charset=utf-8');
	res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
	return res.send('﻿' + csvBody(header, rows));
}

module.exports = { csvField, csvBody, sendCsv };
