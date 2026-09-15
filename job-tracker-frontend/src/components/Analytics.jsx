import React, { useState, useEffect } from 'react';
import API from '../api';
import { Loader2, BarChart2, TrendingUp, Layers } from 'lucide-react';

// --- FUSIONCHARTS SETUP ---
import ReactFC from 'react-fusioncharts';
import FusionCharts from 'fusioncharts';
import Charts from 'fusioncharts/fusioncharts.charts';
import FusionTheme from 'fusioncharts/themes/fusioncharts.theme.fusion';

// Resolve charts as dependency
ReactFC.fcRoot(FusionCharts, Charts, FusionTheme);

const STATUSES = [
    'Applied', 'Pending / Waiting', 'Responded', 'Interview', 
    'Interviewed', 'Final Interview', 'Final Interviewed', 
    'Hired', 'Rejected', 'Withdrawn', 'No Response'
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// UI Color Mapping for Left Panel
const STATUS_COLORS = {
    'Applied': 'bg-blue-500',
    'Pending / Waiting': 'bg-amber-500',
    'Responded': 'bg-sky-500',
    'Interview': 'bg-purple-500',
    'Interviewed': 'bg-pink-500',
    'Final Interview': 'bg-violet-600',
    'Final Interviewed': 'bg-indigo-600',
    'Hired': 'bg-emerald-500',
    'Rejected': 'bg-red-500',
    'Withdrawn': 'bg-stone-500',
    'No Response': 'bg-gray-500'
};

const Analytics = () => {
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchApplications = async () => {
            try {
                // Fetch raw applications so we can aggregate them precisely by month
                const response = await API.get('/applications');
                setApplications(response.data);
            } catch (error) {
                console.error("Failed to load analytics data:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchApplications();
    }, []);

    // --- DATA AGGREGATION LOGIC ---
    // 1. Initialize empty dataset for 12 months for every status
    const aggregatedData = {};
    STATUSES.forEach(status => {
        aggregatedData[status] = new Array(12).fill(0);
    });
    
    // Array to track total activity per month for the Line chart overlay
    const monthlyTotals = new Array(12).fill(0);
    
    // Count totals for the left summary panel
    const overallTotals = {};
    STATUSES.forEach(status => overallTotals[status] = 0);

    // 2. Populate the data
    applications.forEach(app => {
        const dateString = app.application_date || app.created_at;
        if (!dateString) return;

        const date = new Date(dateString);
        const monthIndex = date.getMonth(); // 0 for Jan, 11 for Dec
        const status = app.application_status || 'Applied';

        if (aggregatedData[status] !== undefined) {
            aggregatedData[status][monthIndex] += 1;
            monthlyTotals[monthIndex] += 1;
            overallTotals[status] += 1;
        }
    });

    // --- FUSIONCHARTS CONFIGURATION ---
    const chartConfig = {
        type: 'stackedcolumn2dline',
        width: '100%',
        height: '100%',
        dataFormat: 'json',
        dataSource: {
            chart: {
                caption: "Application Pipeline Progression",
                subcaption: "12-Month Trajectory & Status Breakdown",
                xaxisname: "Month",
                yaxisname: "Number of Applications",
                theme: "fusion",
                bgColor: "transparent",
                bgAlpha: "0",
                canvasBgAlpha: "0",
                showBorder: "0",
                showCanvasBorder: "0",
                usePlotGradientColor: "0",
                plotBorderAlpha: "10",
                legendBgAlpha: "0",
                legendBorderAlpha: "0",
                legendShadow: "0",
                legendItemFontSize: "12",
                legendItemFontColor: "#6b7280",
                baseFont: "'Helvetica Neue', Arial, sans-serif",
                baseFontColor: "#6b7280",
                outCnvBaseFontColor: "#6b7280",
                tooltipBgColor: "#ffffff",
                tooltipColor: "#111827",
                tooltipBorderRadius: "8",
                showHoverEffect: "1",
                paletteColors: "#3b82f6,#f59e0b,#0ea5e9,#a855f7,#ec4899,#7c3aed,#4f46e5,#10b981,#ef4444,#78716c,#6b7280"
            },
            categories: [{
                category: MONTHS.map(month => ({ label: month }))
            }],
            dataset: [
                // Stacked Columns for each status
                ...STATUSES.map(status => ({
                    seriesname: status,
                    data: aggregatedData[status].map(val => ({ value: val }))
                })),
                // Overlay Line Chart for Total Monthly Activity
                {
                    seriesname: "Total Monthly Activity",
                    renderAs: "line",
                    showValues: "0",
                    data: monthlyTotals.map(val => ({ value: val }))
                }
            ]
        }
    };

    if (loading) {
        return (
            <div className="w-full min-h-[500px] flex items-center justify-center bg-surface/70 backdrop-blur-xl rounded-[2rem]">
                <Loader2 className="animate-spin text-indigo-500" size={48} />
            </div>
        );
    }

    return (
        <div className="w-full animate-fade-scale-in">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <BarChart2 size={24} />
                </div>
                <div>
                    <h2 className="text-3xl font-black text-content tracking-tight">Analytics Engine</h2>
                    <p className="text-muted font-medium mt-1">Deep-dive into your recruitment funnel trends.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                
                {/* LEFT SIDE: Metrics Panel */}
                <div className="lg:col-span-1 flex flex-col gap-4">
                    <div className="bg-surface/70 backdrop-blur-xl p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line/50 flex-1">
                        <div className="flex items-center gap-2 mb-6">
                            <Layers size={20} className="text-indigo-500" />
                            <h3 className="text-lg font-bold text-content">Pipeline Summary</h3>
                        </div>
                        
                        <div className="space-y-4 max-h-[450px] overflow-y-auto custom-scrollbar pr-2">
                            {STATUSES.map(status => {
                                const count = overallTotals[status];
                                const maxCount = Math.max(...Object.values(overallTotals), 1);
                                const percentage = ((count / maxCount) * 100).toFixed(0);

                                return (
                                    <div key={status} className="group cursor-default">
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-sm font-semibold text-muted group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                {status}
                                            </span>
                                            <span className="font-black text-content">{count}</span>
                                        </div>
                                        <div className="w-full h-2 bg-sunken rounded-full overflow-hidden">
                                            <div 
                                                className={`h-full rounded-full ${STATUS_COLORS[status] || 'bg-gray-500'} group-hover:brightness-110 transition-all duration-700 ease-out`} 
                                                style={{ width: `${percentage}%` }} 
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* RIGHT SIDE: FusionCharts Visualization */}
                <div className="lg:col-span-3 bg-surface/70 backdrop-blur-xl p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line/50 min-h-[500px]">
                    {applications.length > 0 ? (
                        <div className="w-full h-full min-h-[500px]">
                            <ReactFC {...chartConfig} />
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-subtle min-h-[400px]">
                            <TrendingUp size={64} className="mb-4 opacity-30" />
                            <h3 className="text-xl font-bold text-muted">No Data Available</h3>
                            <p className="font-medium mt-2">Start tracking applications to visualize your pipeline.</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default Analytics;