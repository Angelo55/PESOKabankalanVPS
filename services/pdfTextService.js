/**
 * pdfTextService -- version-tolerant plain-text extraction from PDF buffers.
 *
 * pdf-parse v1 exported a function: `await pdfParse(buffer)` -> { text }.
 * pdf-parse v2 (installed: ^2.4.5) exports a PDFParse class instead:
 * `new PDFParse({ data }); await parser.getText()` -> { text }.
 *
 * Both routes that extract resume text (applicationRoutes, resumeRoutes) were
 * written against the v1 API and broke silently on v2 ("pdfParse is not a
 * function"). This module detects whichever API is installed and exposes one
 * stable contract: extractPdfText(buffer) -> Promise<{ text }>.
 *
 * Loaded defensively -- a missing or unrecognizable library must never crash
 * the server; callers check isPdfExtractAvailable() and degrade (invariant:
 * resume text extraction is a secondary concern, the primary action succeeds).
 */
let extractImpl = null;

try {
	const pdfParseModule = require('pdf-parse');

	if (typeof pdfParseModule === 'function') {
		// v1 API: module IS the parse function.
		extractImpl = async (buffer) => {
			const result = await pdfParseModule(buffer);
			return { text: result?.text || '' };
		};
	} else if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
		// v2 API: PDFParse class with getText().
		const { PDFParse } = pdfParseModule;
		extractImpl = async (buffer) => {
			const parser = new PDFParse({ data: new Uint8Array(buffer) });
			try {
				const result = await parser.getText();
				return { text: result?.text || '' };
			} finally {
				if (typeof parser.destroy === 'function') {
					try { await parser.destroy(); } catch (e) { /* release-only failure */ }
				}
			}
		};
	} else {
		console.warn('[PDF] pdf-parse is installed but exposes no known API. PDF text extraction disabled.');
	}
} catch (e) {
	console.warn("[PDF] pdf-parse not installed. PDF text extraction disabled until 'npm install pdf-parse' is run.");
}

const isPdfExtractAvailable = () => !!extractImpl;

async function extractPdfText(buffer) {
	if (!extractImpl) throw new Error('pdf-parse library is not available on the server.');
	return extractImpl(buffer);
}

module.exports = { extractPdfText, isPdfExtractAvailable };
