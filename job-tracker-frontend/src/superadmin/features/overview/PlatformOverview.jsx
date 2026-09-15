import React, { useState, useEffect } from 'react';
import { 
    Users, Briefcase, FileText, Activity, 
    CheckCircle, Clock, Loader, User
} from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';

// 🚨 PRESERVED: Strict Session Isolation
const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const timeAgo = (dateInput) => {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
};

const PlatformOverview = () => {
    const { notify } = useNotification();
    const [metrics, setMetrics] = useState(null);
    const [logs, setLogs] = useState([]);
    const [activityFeed, setActivityFeed] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            const [metricsRes, logsRes, feedRes] = await Promise.all([
                API.get('/admin/metrics', getAuthConfig()),
                API.get('/admin/logs', getAuthConfig()),
                API.get('/admin/activity-feed', getAuthConfig())
            ]);

            setMetrics(metricsRes.data?.data || null);
            setLogs(Array.isArray(logsRes.data?.data) ? logsRes.data.data : []);
            setActivityFeed(Array.isArray(feedRes.data?.data) ? feedRes.data.data : []);
        } catch (error) {
            console.error("Dashboard Sync Error:", error);
            notify.error("Connection Error", "Failed to synchronize live dashboard data.");
            setMetrics(null);
            setLogs([]);
            setActivityFeed([]);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-canvas">
                <Loader className="animate-spin text-indigo-600" size={40} />
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight">
                        Platform Overview
                    </h1>
                    <p className="text-muted mt-2 font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Live data synchronized with MySQL database
                    </p>
                </div>
                <button 
                    onClick={fetchDashboardData}
                    className="px-5 py-2.5 bg-surface text-muted font-bold rounded-xl border border-line dark:border-line shadow-sm hover:bg-sunken transition-all flex items-center gap-2"
                >
                    <Activity size={16} /> Refresh Metrics
                </button>
            </header>

            {/* KPI Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
                <div className="bg-surface p-6 rounded-3xl border border-line shadow-sm relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-50 dark:bg-indigo-900/20 rounded-full group-hover:scale-150 transition-transform duration-500 z-0"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
                                <Users size={24} />
                            </div>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-black text-content mb-1">{metrics?.users?.total || 0}</h3>
                        <p className="text-sm font-bold text-muted uppercase tracking-wide">Total Users</p>
                        <div className="mt-4 flex items-center gap-3 text-xs font-semibold text-subtle">
                            <span>{metrics?.users?.job_seekers || 0} Job Seekers</span> • <span>{metrics?.users?.employers || 0} Employers</span>
                        </div>
                    </div>
                </div>

                <div className="bg-surface p-6 rounded-3xl border border-line shadow-sm relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-50 dark:bg-emerald-900/20 rounded-full group-hover:scale-150 transition-transform duration-500 z-0"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                <Briefcase size={24} />
                            </div>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-black text-content mb-1">{metrics?.jobs?.active || 0}</h3>
                        <p className="text-sm font-bold text-muted uppercase tracking-wide">Active Jobs</p>
                        <div className="mt-4 text-xs font-semibold text-emerald-500">Currently Published</div>
                    </div>
                </div>

                <div className="bg-surface p-6 rounded-3xl border border-line shadow-sm relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-rose-50 dark:bg-rose-900/20 rounded-full group-hover:scale-150 transition-transform duration-500 z-0"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl">
                                <FileText size={24} />
                            </div>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-black text-content mb-1">{metrics?.applications?.total || 0}</h3>
                        <p className="text-sm font-bold text-muted uppercase tracking-wide">Applications Sent</p>
                        <div className="mt-4 text-xs font-semibold text-rose-500">Across all ATS Pipelines</div>
                    </div>
                </div>
            </div>

            {/* Bottom Grid: Activity Feeds */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Platform Activity Stream */}
                <div className="lg:col-span-2 bg-surface border border-line rounded-3xl p-6 shadow-sm flex flex-col h-[500px]">
                    <div className="flex justify-between items-center mb-6 border-b border-line pb-4">
                        <h3 className="text-lg font-bold text-content flex items-center gap-2">
                            <Activity className="text-indigo-500" size={18}/> Platform Activity
                        </h3>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                        {activityFeed.length === 0 ? (
                            <p className="text-sm font-medium text-muted text-center mt-10">No recent platform events found.</p>
                        ) : (
                            activityFeed.map((activity, i) => (
                                <div key={i} className="flex gap-4 items-center bg-sunken/50 hover:bg-sunken p-3 rounded-2xl transition-colors border border-transparent hover:border-line dark:hover:border-line">
                                    <div className={`p-2.5 rounded-xl shrink-0 ${
                                        activity.type === 'user' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' :
                                        activity.type === 'job' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                        'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                                    }`}>
                                        {activity.type === 'user' && <User size={18} />}
                                        {activity.type === 'job' && <Briefcase size={18} />}
                                        {activity.type === 'application' && <FileText size={18} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-content flex items-center gap-2">
                                            {activity.type === 'user' && (activity.detail === 'employer' ? 'Employer Registered' : 'New User Joined')}
                                            {activity.type === 'job' && `Job Posted`}
                                            {activity.type === 'application' && `Application Submitted`}
                                        </p>
                                        <p className="text-xs text-muted font-medium truncate mt-0.5">
                                            {activity.type === 'user' && `${activity.entity_name} joined the platform`}
                                            {activity.type === 'job' && `${activity.detail} created "${activity.entity_name}"`}
                                            {activity.type === 'application' && `${activity.entity_name} applied for "${activity.detail}"`}
                                        </p>
                                    </div>
                                    <div className="text-[11px] font-bold text-subtle whitespace-nowrap shrink-0">
                                        {timeAgo(activity.timestamp)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Audit Logs */}
                <div className="bg-surface border border-line rounded-3xl p-6 shadow-sm flex flex-col h-[500px]">
                    <h3 className="text-lg font-bold text-content mb-6 flex items-center gap-2 border-b border-line pb-4">
                        <Clock className="text-amber-500" size={18}/> Admin Audit Log
                    </h3>
                    
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                        {logs.length === 0 ? (
                            <p className="text-sm font-medium text-muted text-center mt-10">No recent administrative actions recorded.</p>
                        ) : (
                            logs.map((log, i) => (
                                <div key={log.id || i} className="flex gap-4 items-start border-b border-line dark:border-line/50 pb-4 last:border-0">
                                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg shrink-0">
                                        <CheckCircle size={14} className="text-amber-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-content leading-tight">
                                            {log.action} <span className="text-indigo-500">{log.target_entity}</span>
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] font-semibold text-subtle">
                                            <span>By {log.admin_name}</span>
                                            <span>•</span>
                                            <span>{timeAgo(log.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default PlatformOverview;