// Unified Document Builder — résumé react-pdf templates (promoted from the Phase 0 spike).
// Draft shape (UNCHANGED from the legacy ResumeBuilder — the AI scoring sync depends on it):
//   { personal:{name,email,phone,location,summary,photo}, experience:[{role,company,dates,description}],
//     education:[{degree,school,year}], skills:"comma/newline string" }

import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';

const ACCENT = '#134e48';
const INK = '#1f2933';
const NAME_DARK = '#0b1c30';
const GREY = '#52606d';
const RULE = '#d3dbe2';

const hasPhoto = (p) => typeof p === 'string' && p.indexOf('base64,') !== -1;
const skillList = (skills) => String(skills || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const bullets = (description) => {
	const raw = String(description || '').trim();
	if (!raw) return [];
	let items = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (items.length === 1) items = items[0].split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
	return items;
};
const contactLine = (p) => [p.email, p.phone, p.location].filter(Boolean).join('   |   ');
const pageOf = (d) => (d?.pageSize === 'letter' ? 'LETTER' : 'A4');

// ── Template 1 — Modern ───────────────────────────────────────────────────────
const modern = StyleSheet.create({
	page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 10, color: INK, lineHeight: 1.45 },
	header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
	headText: { flex: 1, paddingRight: 12 },
	name: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: NAME_DARK, letterSpacing: 0.5 },
	contact: { fontSize: 9, color: GREY, marginTop: 5 },
	photo: { width: 62, height: 62, borderRadius: 31 },
	topRule: { height: 2, backgroundColor: ACCENT, marginTop: 10, marginBottom: 6 },
	sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, color: ACCENT, textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 13, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: RULE, paddingBottom: 2 },
	rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
	role: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: INK },
	dates: { fontSize: 9, color: GREY },
	company: { fontFamily: 'Helvetica-Oblique', fontSize: 10, color: ACCENT, marginBottom: 3 },
	bulletRow: { flexDirection: 'row', marginBottom: 2, paddingRight: 6 },
	bulletDot: { width: 12, color: ACCENT, fontFamily: 'Helvetica-Bold' },
	bulletText: { flex: 1 },
	eduDegree: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
	eduSchool: { fontFamily: 'Helvetica-Oblique', fontSize: 10, color: GREY },
	skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
	chip: { fontSize: 9, backgroundColor: '#eaf1ef', color: ACCENT, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 4, marginRight: 5, marginBottom: 5 },
	entry: { marginBottom: 8 },
	summary: { marginTop: 2 },
});

export function ModernResume({ data }) {
	const p = data.personal || {};
	const exp = Array.isArray(data.experience) ? data.experience : [];
	const edu = Array.isArray(data.education) ? data.education : [];
	const skills = skillList(data.skills);
	return (
		<Document>
			<Page size={pageOf(data)} style={modern.page}>
				<View style={modern.header}>
					<View style={modern.headText}>
						<Text style={modern.name}>{(p.name || 'Your Name').toUpperCase()}</Text>
						{contactLine(p) ? <Text style={modern.contact}>{contactLine(p)}</Text> : null}
					</View>
					{hasPhoto(p.photo) ? <Image style={modern.photo} src={p.photo} /> : null}
				</View>
				<View style={modern.topRule} />

				{p.summary ? (
					<View>
						<Text style={modern.sectionTitle}>Professional Summary</Text>
						<Text style={modern.summary}>{p.summary}</Text>
					</View>
				) : null}

				{exp.length ? (
					<View>
						<Text style={modern.sectionTitle}>Professional Experience</Text>
						{exp.map((e, i) => (
							<View key={i} style={modern.entry} wrap={false}>
								<View style={modern.rowBetween}>
									<Text style={modern.role}>{e.role || ''}</Text>
									{e.dates ? <Text style={modern.dates}>{e.dates}</Text> : null}
								</View>
								{e.company ? <Text style={modern.company}>{e.company}</Text> : null}
								{bullets(e.description).map((b, j) => (
									<View key={j} style={modern.bulletRow}>
										<Text style={modern.bulletDot}>{'•'}</Text>
										<Text style={modern.bulletText}>{b}</Text>
									</View>
								))}
							</View>
						))}
					</View>
				) : null}

				{edu.length ? (
					<View>
						<Text style={modern.sectionTitle}>Education</Text>
						{edu.map((e, i) => (
							<View key={i} style={modern.entry} wrap={false}>
								<View style={modern.rowBetween}>
									<Text style={modern.eduDegree}>{e.degree || ''}</Text>
									{e.year ? <Text style={modern.dates}>{e.year}</Text> : null}
								</View>
								{e.school ? <Text style={modern.eduSchool}>{e.school}</Text> : null}
							</View>
						))}
					</View>
				) : null}

				{skills.length ? (
					<View>
						<Text style={modern.sectionTitle}>Skills &amp; Competencies</Text>
						<View style={modern.skillsWrap}>
							{skills.map((s, i) => <Text key={i} style={modern.chip}>{s}</Text>)}
						</View>
					</View>
				) : null}
			</Page>
		</Document>
	);
}

// ── Template 2 — Professional ─────────────────────────────────────────────────
const professional = StyleSheet.create({
	page: { paddingTop: 42, paddingBottom: 46, paddingHorizontal: 54, fontFamily: 'Times-Roman', fontSize: 11, color: INK, lineHeight: 1.5 },
	name: { fontFamily: 'Times-Bold', fontSize: 21, textAlign: 'center', letterSpacing: 1 },
	contact: { fontSize: 10, color: GREY, textAlign: 'center', marginTop: 4 },
	divider: { borderBottomWidth: 1, borderBottomColor: '#9aa5b1', marginTop: 10, marginBottom: 12 },
	sectionTitle: { fontFamily: 'Times-Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 12, marginBottom: 4 },
	sectionUnderline: { borderBottomWidth: 1, borderBottomColor: RULE, marginBottom: 6 },
	rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
	role: { fontFamily: 'Times-Bold', fontSize: 11.5 },
	dates: { fontSize: 10, color: GREY },
	company: { fontFamily: 'Times-Italic', fontSize: 10.5, marginBottom: 2 },
	para: { textAlign: 'justify', marginBottom: 2 },
	entry: { marginBottom: 8 },
	skills: { marginTop: 2 },
});

export function ProfessionalResume({ data }) {
	const p = data.personal || {};
	const exp = Array.isArray(data.experience) ? data.experience : [];
	const edu = Array.isArray(data.education) ? data.education : [];
	const skills = skillList(data.skills);
	return (
		<Document>
			<Page size={pageOf(data)} style={professional.page}>
				<Text style={professional.name}>{p.name || 'Your Name'}</Text>
				{contactLine(p) ? <Text style={professional.contact}>{contactLine(p)}</Text> : null}
				<View style={professional.divider} />

				{p.summary ? (
					<View>
						<Text style={professional.sectionTitle}>Summary</Text>
						<View style={professional.sectionUnderline} />
						<Text style={professional.para}>{p.summary}</Text>
					</View>
				) : null}

				{exp.length ? (
					<View>
						<Text style={professional.sectionTitle}>Experience</Text>
						<View style={professional.sectionUnderline} />
						{exp.map((e, i) => (
							<View key={i} style={professional.entry} wrap={false}>
								<View style={professional.rowBetween}>
									<Text style={professional.role}>{e.role || ''}</Text>
									{e.dates ? <Text style={professional.dates}>{e.dates}</Text> : null}
								</View>
								{e.company ? <Text style={professional.company}>{e.company}</Text> : null}
								{bullets(e.description).map((b, j) => <Text key={j} style={professional.para}>{b}</Text>)}
							</View>
						))}
					</View>
				) : null}

				{edu.length ? (
					<View>
						<Text style={professional.sectionTitle}>Education</Text>
						<View style={professional.sectionUnderline} />
						{edu.map((e, i) => (
							<View key={i} style={professional.entry} wrap={false}>
								<View style={professional.rowBetween}>
									<Text style={professional.role}>{e.degree || ''}</Text>
									{e.year ? <Text style={professional.dates}>{e.year}</Text> : null}
								</View>
								{e.school ? <Text style={professional.company}>{e.school}</Text> : null}
							</View>
						))}
					</View>
				) : null}

				{skills.length ? (
					<View>
						<Text style={professional.sectionTitle}>Skills</Text>
						<View style={professional.sectionUnderline} />
						<Text style={professional.skills}>{skills.join('  •  ')}</Text>
					</View>
				) : null}
			</Page>
		</Document>
	);
}

export const RESUME_TEMPLATES = [
	{ id: 'modern', name: 'Modern', description: 'Single-column layout with accent headings and skill chips.', useCase: 'Tech, startups, and creative roles.', atsFriendly: true, category: 'Modern', Component: ModernResume },
	{ id: 'professional', name: 'Professional', description: 'Classic serif, centered header, ruled section dividers.', useCase: 'Government, finance, legal, and academic applications.', atsFriendly: true, category: 'Professional', Component: ProfessionalResume },
];
