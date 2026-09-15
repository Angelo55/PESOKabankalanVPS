import React, { useState, useEffect } from 'react';
import {
	ComposedChart, Bar, Line, XAxis, YAxis,
	CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { CANONICAL_STAGES, statusHex } from '../hooks/useUnifiedApplications';

/**
 * Pipeline analytics chart. Recharts replacement for FusionCharts.
 *
 * WHY THE SWITCH: FusionCharts was ~2 MB, commercially licensed (watermarks
 * without a paid key -- a real problem for a government system), and blocked the
 * dashboard's first paint. Recharts is ~400 KB, native React, MIT-licensed, and
 * lazy-loaded so it streams in AFTER the dashboard is interactive.
 *
 * Visual parity: a stacked column chart (one stack segment per application
 * status, per month) with a line overlay for total monthly activity -- exactly
 * what the FusionCharts 'stackedcolumn2dline' produced.
 *
 * Self-contained: STATUSES, MONTHS, and dark-mode detection live here, as they
 * did in the original, so the Dashboard only needs to pass `data`.
 */

// The chart visualizes the UNIFIED, COMPLETE application lifecycle (2026-08-07): the PESO
// workflow (Applied → Under Review → Shortlisted → Referred) AND the employer-side outcome
// lifecycle (Interview Scheduled → … → Hired) plus alternatives — the single canonical
// stage list from useUnifiedApplications, so the chart can never drift from the page/KPIs.
const STATUSES = CANONICAL_STAGES;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One colour per canonical stage, from the SINGLE status colour system (STAGE_STYLE in
// useUnifiedApplications) so the chart, the My Applications cards and the Dashboard table
// badges all read identically. Derived, not duplicated.
const PALETTE = CANONICAL_STAGES.map(statusHex);

/**
 * Custom tooltip — shows ONLY the statuses that actually have a value in the hovered
 * month, plus the month Total. The default recharts tooltip listed every stacked
 * series including all the zeros, which drowned the one or two real numbers in noise.
 * Display-only: the chart's data/aggregation/metrics are unchanged.
 */
const PipelineTooltip = ({ active, payload, label, tooltipBg, gridColor, tooltipText }) => {
	if (!active || !payload?.length) return null;
	// Split the stacked-status bars (non-zero only) from the Total line overlay.
	const statuses = payload.filter((e) => e.dataKey !== 'Total' && Number(e.value) > 0);
	const totalEntry = payload.find((e) => e.dataKey === 'Total');
	const total = totalEntry ? Number(totalEntry.value) : statuses.reduce((s, e) => s + Number(e.value || 0), 0);
	if (total <= 0 && statuses.length === 0) return null;

	return (
		// Keyed on the hovered month so the fade replays only on a NEW bar, not on
		// every mousemove within the same one (see .chart-tooltip-in in index.css).
		<div key={label} className="chart-tooltip-in" style={{ backgroundColor: tooltipBg, border: `1px solid ${gridColor}`, borderRadius: '8px', padding: '10px 12px', color: tooltipText, fontSize: '12px', minWidth: 150 }}>
			<div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
			{statuses.length === 0 ? (
				<div style={{ opacity: 0.7 }}>No applications</div>
			) : (
				statuses.map((e) => (
					<div key={e.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
						<span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: e.color || e.fill, flexShrink: 0 }} />
						<span style={{ flex: 1 }}>{e.dataKey}</span>
						<span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{e.value}</span>
					</div>
				))
			)}
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${gridColor}`, fontWeight: 700 }}>
				<span>Total</span>
				<span style={{ fontVariantNumeric: 'tabular-nums' }}>{total}</span>
			</div>
		</div>
	);
};

const PipelineAnalyticsChart = ({ data }) => {
	const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));

	useEffect(() => {
		const observer = new MutationObserver(() =>
			setIsDark(document.documentElement.classList.contains('dark'))
		);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);

	// --- Aggregate into one row per month, a key per status + a Total.
	// Recharts wants an array of objects keyed by series name, not FusionCharts'
	// parallel arrays. Same counting logic, different output shape.
	const chartData = MONTHS.map((month) => {
		const row = { month, Total: 0 };
		STATUSES.forEach((status) => { row[status] = 0; });
		return row;
	});

	(data || []).forEach((app) => {
		// Unified feed uses applied_at + canonical `stage`; tolerate the old
		// date_applied/status shape so the chart is safe either way.
		let date = new Date(app.applied_at || app.date_applied);
		if (Number.isNaN(date.getTime())) date = new Date();
		const monthIndex = date.getMonth();
		const status = app.stage || app.status || 'Applied';
		if (chartData[monthIndex] && chartData[monthIndex][status] !== undefined) {
			chartData[monthIndex][status] += 1;
			chartData[monthIndex].Total += 1;
		}
	});

	const axisColor = isDark ? '#9ca3af' : '#6b7280';
	const gridColor = isDark ? '#374151' : '#e5e7eb';
	const tooltipBg = isDark ? '#1f2937' : '#ffffff';
	const tooltipText = isDark ? '#f3f4f6' : '#111827';

	return (
		<ResponsiveContainer width="100%" height={400}>
			<ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
				<CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
				<XAxis dataKey="month" stroke={axisColor} tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: gridColor }} />
				<YAxis stroke={axisColor} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
				<Tooltip
					content={<PipelineTooltip tooltipBg={tooltipBg} gridColor={gridColor} tooltipText={tooltipText} />}
					cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
					// Off = no slide from the chart's left edge; recharts drops the tooltip
					// straight at its overflow-safe position, and .chart-tooltip-in fades it in.
					isAnimationActive={false}
				/>
				<Legend wrapperStyle={{ fontSize: '11px', color: axisColor }} iconType="circle" />

				{STATUSES.map((status, i) => (
					<Bar
						key={status}
						dataKey={status}
						stackId="pipeline"
						fill={PALETTE[i % PALETTE.length]}
						radius={i === STATUSES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
						maxBarSize={48}
					/>
				))}

				<Line
					type="monotone"
					dataKey="Total"
					name="Total Monthly Activity"
					stroke={isDark ? '#60a5fa' : '#3b82f6'}
					strokeWidth={2.5}
					dot={{ r: 3 }}
					activeDot={{ r: 5 }}
				/>
			</ComposedChart>
		</ResponsiveContainer>
	);
};

export default PipelineAnalyticsChart;