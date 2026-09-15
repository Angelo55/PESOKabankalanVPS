// Unified Document Builder — template registry keyed by docType. The Template Gallery
// and the live preview both read from here; adding a template = adding a file + an entry.

import { RESUME_TEMPLATES } from './resumeTemplates';
import { COVER_LETTER_TEMPLATES } from './coverLetterTemplates';
import { RESIGNATION_TEMPLATES } from './resignationTemplates';

export const TEMPLATES = {
	resume: RESUME_TEMPLATES,
	'cover-letter': COVER_LETTER_TEMPLATES,
	resignation: RESIGNATION_TEMPLATES,
};

export const getTemplates = (docType) => TEMPLATES[docType] || [];

export const getTemplate = (docType, id) => {
	const list = TEMPLATES[docType] || [];
	return list.find((t) => t.id === id) || list[0] || null;
};
