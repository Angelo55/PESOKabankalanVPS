// Unified Document Builder — shared react-pdf business-letter renderer.
// Cover letters and resignation letters share one formal layout (sender → date →
// recipient → subject → salutation → body → closing → signature); only the field
// mapping differs. Two visual variants: 'modern' (Helvetica + green accent rule) and
// 'professional' (Times serif, classic). Mirrors the server pdfkit letterPdfService so
// the export the seeker sees matches the legacy fallback.

import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

const INK = '#1f2933';
const MUTED = '#52606d';
const ACCENT = '#134e48';
const RULE = '#c7d0d9';

export function paragraphs(body) {
	const raw = String(body || '').replace(/\r\n/g, '\n').trim();
	if (!raw) return [];
	if (/\n\s*\n/.test(raw)) return raw.split(/\n\s*\n/).map((p) => p.replace(/\n+/g, ' ').trim()).filter(Boolean);
	return raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

export function formatDate(value) {
	const date = value ? new Date(value) : new Date();
	const safe = Number.isNaN(date.getTime()) ? new Date() : date;
	return safe.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const styles = {
	modern: StyleSheet.create({
		page: { paddingTop: 54, paddingBottom: 60, paddingHorizontal: 60, fontFamily: 'Helvetica', fontSize: 11, color: INK, lineHeight: 1.5 },
		sender: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: INK },
		contacts: { fontSize: 10, color: MUTED, marginTop: 3 },
		rule: { height: 1.5, backgroundColor: ACCENT, marginTop: 8, marginBottom: 14 },
		date: { fontSize: 10.5, color: MUTED, marginBottom: 14 },
		recipient: { fontSize: 10.5, marginBottom: 2 },
		recipientBlock: { marginBottom: 12 },
		subject: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, marginBottom: 12 },
		salutation: { fontSize: 11, marginBottom: 8 },
		para: { textAlign: 'left', marginBottom: 9 },
		closing: { marginTop: 6 },
		signature: { fontFamily: 'Helvetica-Bold', marginTop: 26 },
		empty: { fontFamily: 'Helvetica-Oblique', color: MUTED },
	}),
	professional: StyleSheet.create({
		page: { paddingTop: 60, paddingBottom: 64, paddingHorizontal: 66, fontFamily: 'Times-Roman', fontSize: 12, color: INK, lineHeight: 1.55 },
		sender: { fontFamily: 'Times-Bold', fontSize: 14, color: INK },
		contacts: { fontSize: 10.5, color: MUTED, marginTop: 3 },
		rule: { borderBottomWidth: 1, borderBottomColor: RULE, marginTop: 8, marginBottom: 16 },
		date: { fontSize: 11, color: MUTED, marginBottom: 16 },
		recipient: { fontSize: 11, marginBottom: 2 },
		recipientBlock: { marginBottom: 14 },
		subject: { fontFamily: 'Times-Bold', fontSize: 11.5, marginBottom: 14 },
		salutation: { fontSize: 12, marginBottom: 8 },
		para: { textAlign: 'justify', marginBottom: 10 },
		closing: { marginTop: 6 },
		signature: { fontFamily: 'Times-Bold', marginTop: 28 },
		empty: { fontFamily: 'Times-Italic', color: MUTED },
	}),
};

export function LetterDocument({ variant = 'modern', letter, pageSize }) {
	const s = styles[variant] || styles.modern;
	const l = letter || {};
	const recipient = (l.recipientLines || []).filter(Boolean);
	const paras = l.bodyParas || [];
	return (
		<Document>
			<Page size={pageSize === 'letter' ? 'LETTER' : 'A4'} style={s.page}>
				<Text style={s.sender}>{l.senderName || ''}</Text>
				{(l.senderContacts || []).filter(Boolean).length ? (
					<Text style={s.contacts}>{(l.senderContacts || []).filter(Boolean).join('   |   ')}</Text>
				) : null}
				<View style={s.rule} />

				<Text style={s.date}>{l.date}</Text>

				{recipient.length ? (
					<View style={s.recipientBlock}>
						{recipient.map((line, i) => <Text key={i} style={s.recipient}>{line}</Text>)}
					</View>
				) : null}

				{l.subject ? <Text style={s.subject}>{l.subject}</Text> : null}
				{l.salutation ? <Text style={s.salutation}>{l.salutation}</Text> : null}

				{paras.length === 0 ? (
					<Text style={s.empty}>(No letter content yet — write or generate the body.)</Text>
				) : (
					paras.map((p, i) => <Text key={i} style={s.para}>{p}</Text>)
				)}

				<Text style={s.closing}>{l.closing || 'Sincerely,'}</Text>
				<Text style={s.signature}>{l.signatureName || l.senderName || ''}</Text>
			</Page>
		</Document>
	);
}
