import React, { useState, useEffect } from 'react';
import { BarChart, Loader, PieChart, TrendingUp } from 'lucide-react';
import API from '../../../api';
import { normalizeRole, ROLE_KEYS } from '../../../utils/roles';
import { useNotification } from '../../../context/NotificationContext';
import AccomplishmentReport from '../../../components/common/AccomplishmentReport';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const PlatformReports = () => {
    const { notify } = useNotification();
    const [reports, setReports] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const response = await API.get('/admin/reports', getAuthConfig());
            setReports(response.data?.data);
        } catch (error) {
            notify.error("Data Error", "Failed to load system reports.");
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

    // Safely calculate totals for our CSS charts
    const appData = Array.isArray(reports?.applications) ? reports.applications : [];
    const totalApps = appData.reduce((acc, curr) => acc + curr.count, 0) || 1; // Fallback to 1 to prevent divide by zero

    const userData = Array.isArray(reports?.users) ? reports.users : [];
    const totalUsers = userData.reduce((acc, curr) => acc + curr.count, 0) || 1;

    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight flex items-center gap-3">
                        <BarChart className="text-indigo-500" size={32} /> System Reports
                    </h1>
                    <p className="text-muted mt-2 font-medium">Analyze platform engagement, user composition, and ATS outcomes.</p>
                </div>
            </header>

            {/* DOLE accomplishment report (aggregate + demographic + PDF/CSV) — office-wide. */}
            <AccomplishmentReport endpoint="/admin/reports/accomplishment" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">

                {/* Chart 1: Application Outcomes */}
                <div className="bg-surface p-4 sm:p-6 rounded-3xl border border-line shadow-sm">
                    <h3 className="text-xl font-bold text-content mb-6 flex items-center gap-2">
                        <TrendingUp className="text-emerald-500" size={20}/> ATS Pipeline Outcomes
                    </h3>
                    
                    <div className="space-y-6">
                        {appData.length === 0 ? (
                            <p className="text-muted text-sm font-medium">No application data available yet.</p>
                        ) : (
                            appData.map((stat, idx) => {
                                const percentage = ((stat.count / totalApps) * 100).toFixed(1);
                                return (
                                    <div key={idx}>
                                        <div className="flex justify-between text-sm font-bold mb-2">
                                            <span className="text-muted">{stat.status}</span>
                                            <span className="text-content">{stat.count} ({percentage}%)</span>
                                        </div>
                                        <div className="w-full bg-sunken rounded-full h-3 overflow-hidden">
                                            <div 
                                                className={`h-3 rounded-full ${stat.status === 'Hired' ? 'bg-emerald-500' : stat.status === 'Rejected' ? 'bg-rose-500' : 'bg-indigo-500'}`}
                                                style={{ width: `${percentage}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Chart 2: User Composition */}
                <div className="bg-surface p-4 sm:p-6 rounded-3xl border border-line shadow-sm">
                    <h3 className="text-xl font-bold text-content mb-6 flex items-center gap-2">
                        <PieChart className="text-amber-500" size={20}/> Platform Composition
                    </h3>
                    
                    <div className="space-y-6">
                        {userData.length === 0 ? (
                            <p className="text-muted text-sm font-medium">No user data available yet.</p>
                        ) : (
                            userData.map((stat, idx) => {
                                const percentage = ((stat.count / totalUsers) * 100).toFixed(1);
                                const isJobSeeker = normalizeRole(stat.role) === ROLE_KEYS.JOB_SEEKER;
                                return (
                                    <div key={idx}>
                                        <div className="flex justify-between text-sm font-bold mb-2">
                                            <span className="text-muted">{isJobSeeker ? 'Job Seekers' : 'Employers'}</span>
                                            <span className="text-content">{stat.count} ({percentage}%)</span>
                                        </div>
                                        <div className="w-full bg-sunken rounded-full h-3 overflow-hidden">
                                            <div 
                                                className={`h-3 rounded-full ${isJobSeeker ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${percentage}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default PlatformReports;