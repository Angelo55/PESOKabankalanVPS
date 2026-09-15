/**
 * resumeText — extract plain text from an uploaded résumé (PDF or DOCX). Phase C of
 * docs/data-processing-modules-proposal.md.
 *
 * PDF goes through the CANONICAL `pdfTextService` (invariant §12 — never call a raw pdf lib
 * directly; it bridges pdf-parse v1/v2 and degrades gracefully). DOCX goes through mammoth
 * (raw text). This is the ONE place résumé extraction happens, reused by the analyze flow.
 */
const path = require('path');
const pdfTextService = require('./pdfTextService');

let _mammoth = null; // lazy — only loaded for a DOCX

const MIME_KIND = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** 'pdf' | 'docx' | null for an uploaded file (mimetype first, extension fallback). */
function resumeKind(file) {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (MIME_KIND[mime]) return MIME_KIND[mime];
    const ext = path.extname(file?.originalname || '').toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (ext === '.docx') return 'docx';
    return null;
}

/** Extract text from a résumé buffer; throws a user-safe Error on an unsupported/failed file. */
async function extractResumeText(file) {
    const kind = resumeKind(file);
    if (kind === 'pdf') {
        if (!pdfTextService.isPdfExtractAvailable()) throw new Error('PDF reading is unavailable on the server right now.');
        const { text } = await pdfTextService.extractPdfText(file.buffer);
        return (text || '').trim();
    }
    if (kind === 'docx') {
        if (!_mammoth) _mammoth = require('mammoth');
        const { value } = await _mammoth.extractRawText({ buffer: file.buffer });
        return (value || '').trim();
    }
    throw new Error('Unsupported file type — please upload a PDF or DOCX résumé.');
}

module.exports = { extractResumeText, resumeKind };
