import React, { useState } from 'react';
import { ExternalLink, X, Globe, Linkedin, Briefcase, LayoutDashboard, Target, Sparkles } from 'lucide-react';

const TOP_PLATFORMS = [
    { id: 1, name: 'LinkedIn', url: 'https://www.linkedin.com/jobs', icon: <Linkedin className="text-blue-600" />, color: 'bg-blue-50 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800/50' },
    { id: 2, name: 'Indeed', url: 'https://www.indeed.com', icon: <Briefcase className="text-blue-500" />, color: 'bg-blue-50 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800/50' },
    { id: 3, name: 'Glassdoor', url: 'https://www.glassdoor.com', icon: <LayoutDashboard className="text-green-500" />, color: 'bg-green-50 border-green-100 dark:bg-green-900/20 dark:border-green-800/50' },
    { id: 4, name: 'ZipRecruiter', url: 'https://www.ziprecruiter.com', icon: <Target className="text-emerald-500" />, color: 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800/50' },
    { id: 5, name: 'Wellfound', url: 'https://wellfound.com', icon: <Sparkles className="text-red-500" />, color: 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-800/50' },
];

const TopPlatforms = () => {
    const [selectedPlatform, setSelectedPlatform] = useState(null);

    const handlePlatformClick = (platform) => {
        setSelectedPlatform(platform);
    };

    const confirmRedirect = () => {
        if (selectedPlatform) {
            window.open(selectedPlatform.url, '_blank', 'noopener,noreferrer');
            setSelectedPlatform(null);
        }
    };

    return (
        <>
            {/* Redirection Modal */}
            {selectedPlatform && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm transition-opacity animate-in fade-in">
                    <div className="bg-surface rounded-[2rem] p-8 max-w-md w-full shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-2xl ${selectedPlatform.color}`}>
                                    {selectedPlatform.icon}
                                </div>
                                <h3 className="text-xl font-bold text-content">External Redirection</h3>
                            </div>
                            <button onClick={() => setSelectedPlatform(null)} className="text-subtle hover:text-muted dark:hover:text-subtle transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                        
                        <p className="text-muted mb-8 font-medium">
                            Do you want to visit <span className="font-bold text-content">{selectedPlatform.name}</span>? This will open in a new tab.
                        </p>
                        
                        <div className="flex gap-4">
                            <button 
                                onClick={() => setSelectedPlatform(null)}
                                className="flex-1 px-6 py-3 bg-sunken hover:bg-line dark:hover:bg-line text-content rounded-2xl font-bold transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmRedirect}
                                className="flex-1 px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-2xl font-bold shadow-lg shadow-accent/30 flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5"
                            >
                                Visit Site <ExternalLink size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dashboard Widget Card */}
            <div className="bg-surface/70 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 dark:border-line/50 transition-all duration-300 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)]">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl">
                        <Globe className="text-indigo-600 dark:text-indigo-400" size={20} />
                    </div>
                    <h3 className="text-xl font-bold text-content tracking-tight">Top Platforms</h3>
                </div>
                
                <div className="space-y-3">
                    {TOP_PLATFORMS.map((platform) => (
                        <button 
                            key={platform.id}
                            onClick={() => handlePlatformClick(platform)}
                            className="w-full flex items-center justify-between p-3.5 bg-surface/50 dark:bg-raised/30 backdrop-blur-md rounded-2xl border border-white/50 dark:border-line/50 hover:bg-white dark:hover:bg-raised transition-all duration-300 group hover:shadow-md hover:-translate-y-0.5"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`p-2.5 rounded-xl border ${platform.color} shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                                    {React.cloneElement(platform.icon, { size: 18 })}
                                </div>
                                <span className="font-bold text-content group-hover:text-accent-text dark:group-hover:text-white transition-colors">
                                    {platform.name}
                                </span>
                            </div>
                            <ExternalLink size={16} className="text-subtle group-hover:text-accent-text dark:group-hover:text-white transition-colors" />
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
};

export default TopPlatforms;