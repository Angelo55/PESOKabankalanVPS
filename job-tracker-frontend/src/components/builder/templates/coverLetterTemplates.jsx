// Unified Document Builder — cover-letter react-pdf templates.
// Draft shape (unchanged from the legacy CoverLetterBuilder):
//   { applicant:{name,email,phone,location}, target:{company,hiringManager,position,department},
//     context:{...,tone}, body, language }

import React from 'react';
import { LetterDocument, paragraphs, formatDate } from './letterShared';

function toLetter(d) {
	const applicant = d.applicant || {};
	const target = d.target || {};
	return {
		senderName: applicant.name || 'Applicant',
		senderContacts: [applicant.email, applicant.phone, applicant.location],
		date: formatDate(),
		recipientLines: [target.hiringManager, target.department, target.company],
		subject: target.position ? `RE: Application for the ${target.position} position` : null,
		salutation: `Dear ${target.hiringManager || 'Hiring Manager'},`,
		bodyParas: paragraphs(d.body),
		closing: 'Sincerely,',
		signatureName: applicant.name || '',
	};
}

export const CoverLetterModern = ({ data }) => <LetterDocument variant="modern" letter={toLetter(data)} pageSize={data.pageSize} />;
export const CoverLetterProfessional = ({ data }) => <LetterDocument variant="professional" letter={toLetter(data)} pageSize={data.pageSize} />;

export const COVER_LETTER_TEMPLATES = [
	{ id: 'modern', name: 'Modern', description: 'Clean sans-serif letter with a green accent rule.', useCase: 'Contemporary companies and most private-sector roles.', atsFriendly: true, category: 'Modern', Component: CoverLetterModern },
	{ id: 'professional', name: 'Professional', description: 'Formal serif business letter, justified body.', useCase: 'Government, corporate, and traditional industries.', atsFriendly: true, category: 'Professional', Component: CoverLetterProfessional },
];
