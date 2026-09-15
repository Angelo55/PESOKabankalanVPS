// Unified Document Builder — resignation-letter react-pdf templates.
// Draft shape (unchanged from the legacy ResignationBuilder):
//   { employee:{name,email,phone}, employment:{company,position,managerName},
//     details:{date,lastDay,reason,tone}, body, language }

import React from 'react';
import { LetterDocument, paragraphs, formatDate } from './letterShared';

function toLetter(d) {
	const employee = d.employee || {};
	const employment = d.employment || {};
	const details = d.details || {};
	return {
		senderName: employee.name || 'Employee',
		senderContacts: [employee.email, employee.phone],
		date: formatDate(details.date),
		recipientLines: [employment.managerName, employment.company],
		subject: `RE: Letter of Resignation${employment.position ? ` — ${employment.position}` : ''}`,
		salutation: `Dear ${employment.managerName || 'Manager'},`,
		bodyParas: paragraphs(d.body),
		closing: 'Sincerely,',
		signatureName: employee.name || '',
	};
}

export const ResignationModern = ({ data }) => <LetterDocument variant="modern" letter={toLetter(data)} pageSize={data.pageSize} />;
export const ResignationProfessional = ({ data }) => <LetterDocument variant="professional" letter={toLetter(data)} pageSize={data.pageSize} />;

export const RESIGNATION_TEMPLATES = [
	{ id: 'modern', name: 'Modern', description: 'Concise sans-serif notice with a green accent rule.', useCase: 'Most workplaces; a courteous, contemporary tone.', atsFriendly: false, category: 'Modern', Component: ResignationModern },
	{ id: 'professional', name: 'Professional', description: 'Formal serif letter for a traditional handover.', useCase: 'Government and corporate roles with formal HR process.', atsFriendly: false, category: 'Professional', Component: ResignationProfessional },
];
