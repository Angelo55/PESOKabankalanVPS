import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import API from '../api';
import { SkeletonProfile } from './Skeleton';
import { 
    Camera, User, MapPin, Clock, Edit3, CheckCircle, Circle, 
    FileText, Globe, Phone, BookOpen,
    Briefcase, Save, X, Loader2, Sparkles, AlertCircle, XCircle, 
    Upload, BarChart3, Palette
} from 'lucide-react';
import Avatar from './common/Avatar';
import CertificateLibrary from './CertificateLibrary';
import SmsAlertsCard from './profile/SmsAlertsCard';
import { buildAvatarPayload } from '../utils/imageThumb';
import { buildAvatarGallery, buildGalleryAvatarPayload, hasStoredAvatar } from '../utils/avatar';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const Profile = () => {
    const { user, updateUser, features } = useAuth();
    const { notify } = useNotification();
    
    // Core Layout States
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('personal');

    // Job Seeker Verification decommissioned (2026-08-01): the ID-document upload
    // and verification-status hooks were removed. The government ID-TYPE selector was
    // then removed too (PESO confirmed it is outside their workflow) — no identity ID
    // field remains here. The underlying users columns are left dormant, not dropped.

    // Profile Avatar Hooks
    const fileInputRef = useRef(null);
    const [avatarFile, setAvatarFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

    // Avatar gallery ("choose one, don't upload one"). The grid is deterministic
    // and cached in utils/avatar.js, so building it once at module scope would
    // work too — useState keeps it out of the render path without a useMemo dep
    // list that can only ever be empty.
    const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
    const [gallery] = useState(() => buildAvatarGallery());
    const [pendingSeed, setPendingSeed] = useState(null);

    // Profile Core State Machine
    const [profileData, setProfileData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        role: 'applicant',
        gender: '',
        dob: '',
        phone: '',
        location: '',
        availability: 'Full-time',
        educational_attainment: '',
        languages: '',
        skills: '',
        preferred_roles: '',
        experience_level: 'Entry Level',
        career_goals: '',
        avatar_url: ''
    });

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const response = await API.get('/profile', getAuthConfig());
            const data = response.data?.data || response.data?.user || response.data;
            
            if (data && Object.keys(data).length > 0) {
                setProfileData(prev => ({
                    ...prev,
                    name: data.name || prev.name,
                    gender: data.gender || '',
                    dob: data.dob ? new Date(data.dob).toISOString().split('T')[0] : '',
                    phone: data.phone || '',
                    location: data.location || '',
                    availability: data.availability || 'Full-time',
                    educational_attainment: data.educational_attainment || '',
                    languages: data.languages || '',
                    skills: data.skills || '',
                    preferred_roles: data.preferred_roles || '',
                    experience_level: data.experience_level || 'Entry Level',
                    career_goals: data.career_goals || '',
                    avatar_url: data.avatar_url || ''
                }));
            }
        } catch (error) {
            notify.error("Data Error", "Failed to retrieve profile data.");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        setProfileData({ ...profileData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        setIsSaving(true);
        try {
            const formData = new FormData();
            
            // Build the multi-part body safely
            Object.keys(profileData).forEach(key => {
                formData.append(key, profileData[key] ?? '');
            });

            // Route standard updates over the multi-part data transaction path.
            // `timeout` is a safety net: a profile save is a simple DB update that can
            // never legitimately take this long, so if the server ever fails to respond
            // the request REJECTS (→ catch → error toast → finally resets the spinner)
            // instead of hanging the Save button forever. (AI endpoints keep the default
            // no-timeout since they can legitimately run long.)
            await API.put('/profile', formData, {
                headers: {
                    ...getAuthConfig().headers,
                    'Content-Type': 'multipart/form-data'
                },
                timeout: 30000
            });

            notify.success("Changes Saved", "Your professional profile has been updated.");
            setIsEditing(false);
            // Keep the header in sync with edited identity fields (e.g. name).
            updateUser({ name: profileData.name, avatar_url: profileData.avatar_url });
            fetchProfile();
        } catch (error) {
            notify.error("Save Failed", "Could not synchronize profile records with the server.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            notify.warning("Invalid File", "Please choose a valid graphic format.");
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            notify.warning("File Too Large", "Profile avatar must remain below 10MB.");
            return;
        }

        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
        setIsAvatarModalOpen(true);
    };

    /**
     * The ONE write path for a profile image, whether it came from an upload or
     * from the gallery. Both produce the same { avatar_url, avatar_thumb } pair,
     * hit the same endpoint, and run the same local sync — which is what makes a
     * chosen avatar behave identically to an uploaded one everywhere else.
     *
     * updateUser() is what propagates the change: AuthContext holds the user
     * object every <Avatar> reads from, so the header, chat and ATS update in
     * the same tick with no refetch and no page refresh. (The value is a data
     * URI, so there is no browser image cache to bust either.)
     */
    const persistAvatar = async (payload, successMessage) => {
        const response = await API.post('/profile/avatar', payload, getAuthConfig());
        if (response.data.status !== 'success') throw new Error('Rejected');

        const saved = {
            avatar_url: response.data.avatar_url,
            avatar_thumb: response.data.avatar_thumb || response.data.avatar_url
        };
        setProfileData(prev => ({ ...prev, ...saved }));
        updateUser(saved);
        notify.success('Profile Picture Updated', successMessage);
    };

    const confirmAvatarUpload = async () => {
        if (!avatarFile) return;
        setIsUploadingAvatar(true);

        try {
            // Downscale in the browser before sending. The endpoint accepts a raw
            // multipart file too, but that path stores the original — averaging
            // ~319KB per row and no thumbnail — which is what utils/imageThumb.js
            // was written to avoid. It had never actually been wired to a caller.
            const payload = await buildAvatarPayload(avatarFile);
            await persistAvatar(payload, 'Your uploaded photo is now live across the system.');
            setIsAvatarModalOpen(false);
        } catch (error) {
            notify.error("Upload Failed", "Could not synchronize profile image.");
        } finally {
            setIsUploadingAvatar(false);
            setAvatarFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const chooseGalleryAvatar = async (seed) => {
        setPendingSeed(seed);
        try {
            await persistAvatar(
                buildGalleryAvatarPayload(seed),
                'Your selected avatar is now live across the system.'
            );
            setIsAvatarPickerOpen(false);
        } catch (error) {
            notify.error('Could Not Save Avatar', 'Please try again in a moment.');
        } finally {
            setPendingSeed(null);
        }
    };

    const cancelAvatarUpload = () => {
        setIsAvatarModalOpen(false);
        setAvatarFile(null);
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Weights sum to 100. The former "Verification Identity" (pwd_category, 15) was
    // removed with the identity ID-TYPE field (2026-08-23); its weight was redistributed.
    const strengthMetrics = [
        { label: 'Basic Info', key: 'name', weight: 15 },
        { label: 'Contact Info', key: 'phone', weight: 15 },
        { label: 'Skills', key: 'skills', weight: 20 },
        { label: 'Educational Info', key: 'educational_attainment', weight: 15 },
        { label: 'Work Preferences', key: 'preferred_roles', weight: 20 },
        { label: 'Career Goals', key: 'career_goals', weight: 15 }
    ];

    const calculateStrength = () => {
        let score = 0;
        let completedCount = 0;
        strengthMetrics.forEach(metric => {
            if (profileData[metric.key] && String(profileData[metric.key]).trim() !== '') {
                score += metric.weight;
                completedCount++;
            }
        });
        return { score, completedCount, total: strengthMetrics.length };
    };

    const strength = calculateStrength();
    const skillsList = profileData.skills ? profileData.skills.split(',').map(s => s.trim()).filter(s => s) : [];
    const languageList = profileData.languages ? profileData.languages.split(',').map(l => l.trim()).filter(l => l) : [];

    if (loading) return <SkeletonProfile />;

    // Form-first page: deliberately capped at max-w-5xl (1024px) rather than the
    // max-w-7xl the card-grid pages use. A handful of inputs stretched across a
    // wide monitor reads as oversized and hard to scan. The sidebar-aware
    // widening in index.css only targets `.max-w-7xl`, so this shell stays
    // compact in both sidebar states by design.
    return (
        <div className="p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto min-h-screen animate-fade-scale-in">
            <header className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-content tracking-tight">Identity &amp; Profile</h1>
                <p className="text-muted mt-1 font-medium text-sm">Manage your personal details, preferences, and professional portfolio.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
                {/* Profile Summary Cards Column */}
                <div className="md:col-span-4 flex flex-col gap-5">
                    <div className="bg-raised/80 backdrop-blur-xl rounded-3xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-5 sm:p-6 text-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-20 bg-sunken"></div>

                        {/* Never an empty circle: <Avatar> falls back to this
                            account's generated DiceBear face, so the "no picture
                            yet" state looks intentional instead of broken. */}
                        <div className="relative w-24 h-24 sm:w-28 sm:h-28 mx-auto mt-2 mb-3 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <Avatar
                                user={{ ...user, ...profileData }}
                                preferThumb={false}
                                size="2xl"
                                className="w-full h-full border-4 border-surface shadow-md"
                            />
                            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                <Camera className="text-white" size={32} />
                            </div>
                            <button type="button" aria-label="Upload a profile photo" className="absolute bottom-1 right-1 bg-accent text-white p-2 rounded-full shadow-lg border-2 border-surface z-10">
                                <Camera size={16} />
                            </button>
                            <input type="file" accept="image/png, image/jpeg, image/webp" className="hidden" ref={fileInputRef} onChange={handleAvatarSelect} />
                        </div>

                        <h2 className="text-lg sm:text-xl font-black text-content">{profileData.name || user?.name || 'User Profile'}</h2>
                        <p className="text-xs font-semibold text-muted mb-3">{profileData.role || 'Job Seeker'}</p>

                        {/* Two equal routes to a profile picture. The gallery is
                            listed alongside upload, not hidden behind it, because
                            it is the faster path for most people. */}
                        <div className="flex flex-col sm:flex-row gap-2 justify-center mb-4">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-muted bg-sunken hover:bg-line transition-colors"
                            >
                                <Upload size={14} /> Upload Photo
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAvatarPickerOpen(true)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-accent-text bg-accent/10 dark:bg-accent-text/10 hover:bg-accent/20 dark:hover:bg-accent-text/20 transition-colors"
                            >
                                <Palette size={14} /> Choose Avatar
                            </button>
                        </div>

                        {!hasStoredAvatar({ ...user, ...profileData }) && (
                            <p className="text-[11px] text-subtle font-medium mb-3 -mt-1 px-2">
                                You're using an auto-generated avatar. Upload a photo or pick one you like.
                            </p>
                        )}


                        <div className="text-left border-t border-line pt-4 space-y-3">
                            <h3 className="text-xs font-bold text-subtle uppercase tracking-wider mb-2">Basic Information</h3>
                            <div className="flex items-center gap-3 text-sm font-medium text-muted">
                                <Clock size={16} className="text-subtle" />
                                <div><span className="block text-xs text-subtle">Availability</span>{profileData.availability || 'Not Specified'}</div>
                            </div>
                            <div className="flex items-center gap-3 text-sm font-medium text-muted">
                                <MapPin size={16} className="text-subtle" />
                                <div><span className="block text-xs text-subtle">Location</span>{profileData.location || 'Not Specified'}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Form Management Area */}
                <div className="md:col-span-8 flex flex-col gap-5">
                    <div className="bg-raised/80 backdrop-blur-xl rounded-3xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-5 sm:p-6">
                        <div className="flex flex-wrap justify-between items-end gap-2 mb-3">
                            <h3 className="text-base sm:text-lg font-black text-content">Profile Strength: <span className="text-content">{strength.score}%</span></h3>
                            <span className="text-xs font-bold text-muted">{strength.completedCount}/{strength.total} sections complete</span>
                        </div>
                        <div className="w-full h-2 bg-sunken rounded-full mb-4 overflow-hidden">
                            <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${strength.score}%` }}></div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {strengthMetrics.map((metric, idx) => {
                                const isComplete = profileData[metric.key] && String(profileData[metric.key]).trim() !== '';
                                return (
                                    <div key={idx} className={`px-3 py-1.5 rounded-full border text-xs font-bold flex items-center gap-1.5 transition-colors ${isComplete ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400' : 'border-line bg-surface text-muted'}`}>
                                        {isComplete ? <CheckCircle size={14} /> : <Circle size={14} />} {metric.label}
                                    </div>
                                );
                            })}
                        </div>
                    </div>


                    {/* Tab Navigation Area */}
                    <div className="bg-raised/80 backdrop-blur-xl rounded-3xl border border-line shadow-[0_2px_10px_rgba(15,23,42,0.05)] overflow-hidden flex flex-col h-full min-h-[420px]">
                        <div className="flex border-b border-line bg-sunken/50">
                            <button type="button" onClick={() => setActiveTab('personal')} className={`flex-1 py-4 text-sm font-bold transition-all relative ${activeTab === 'personal' ? 'text-content' : 'text-muted hover:text-content dark:hover:text-subtle'}`}>
                                Personal Details
                                {activeTab === 'personal' && <span className="absolute bottom-0 left-0 w-full h-1 bg-accent dark:bg-accent-text rounded-t-lg"></span>}
                            </button>
                            <button type="button" onClick={() => setActiveTab('preference')} className={`flex-1 py-4 text-sm font-bold transition-all relative ${activeTab === 'preference' ? 'text-content' : 'text-muted hover:text-content dark:hover:text-subtle'}`}>
                                Work Preferences
                                {activeTab === 'preference' && <span className="absolute bottom-0 left-0 w-full h-1 bg-accent dark:bg-accent-text rounded-t-lg"></span>}
                            </button>
                            <button type="button" onClick={() => setActiveTab('portfolio')} className={`flex-1 py-4 text-sm font-bold transition-all relative ${activeTab === 'portfolio' ? 'text-content' : 'text-muted hover:text-content dark:hover:text-subtle'}`}>
                                Portfolio
                                {activeTab === 'portfolio' && <span className="absolute bottom-0 left-0 w-full h-1 bg-accent dark:bg-accent-text rounded-t-lg"></span>}
                            </button>
                        </div>

                        <div className="p-5 sm:p-6 flex-1">
                            {!isEditing && (
                                <div className="flex justify-end mb-5">
                                    <button type="button" onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-content dark:bg-accent-text/15 dark:text-accent-text font-bold rounded-xl hover:bg-accent/20 transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                        <Edit3 size={16} /> Edit Profile
                                    </button>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-6">
                                {activeTab === 'personal' && (
                                    <div className="space-y-6 animate-in slide-in-from-bottom-2">
                                        <section>
                                            <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                <User size={18} className="text-accent-text" /> Personal Info
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Full Name</label>
                                                    {isEditing ? <input name="name" value={profileData.name ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium">{profileData.name || '—'}</p>}
                                                </div>
                                                
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Gender</label>
                                                    {isEditing ? (
                                                        <select name="gender" value={profileData.gender ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content">
                                                            <option value="">Select...</option>
                                                            <option value="Male">Male</option>
                                                            <option value="Female">Female</option>
                                                            <option value="Other">Other</option>
                                                            <option value="Prefer not to say">Prefer not to say</option>
                                                        </select>
                                                    ) : <p className="text-content text-sm font-medium">{profileData.gender || '—'}</p>}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Date of Birth</label>
                                                    {isEditing ? <input type="date" name="dob" value={profileData.dob ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium">{profileData.dob || '—'}</p>}
                                                </div>
                                            </div>

                                            {isEditing && (
                                                <p className="text-[11px] text-muted mt-3 leading-relaxed">
                                                    Your sex, date of birth, and educational attainment help PESO Kabankalan prepare its DOLE employment reports. These are optional, but completing them supports accurate community statistics.
                                                </p>
                                            )}

                                        </section>

                                        {/* Contact Parameters */}
                                        <section>
                                            <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                <Phone size={18} className="text-accent-text" /> Contact Information
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Phone Number</label>
                                                    {isEditing ? <input name="phone" value={profileData.phone ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium">{profileData.phone || '—'}</p>}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Email Address</label>
                                                    <p className="p-3.5 bg-sunken/80 border border-transparent rounded-xl text-muted font-medium cursor-not-allowed">{profileData.email}</p>
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-bold text-muted mb-1">Full Location / Address</label>
                                                    {isEditing ? <input name="location" value={profileData.location ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium">{profileData.location || '—'}</p>}
                                                </div>
                                            </div>
                                        </section>

                                        {/* Academic Records */}
                                        <section>
                                            <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                <BookOpen size={18} className="text-amber-500" /> Educational Information
                                            </h3>
                                            <div className="mb-6">
                                                <label className="block text-xs font-bold text-muted mb-1">Educational Attainment</label>
                                                {isEditing ? (
                                                    <select name="educational_attainment" value={profileData.educational_attainment ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content">
                                                        <option value="">Select...</option>
                                                        <option value="High School Graduate">High School Graduate</option>
                                                        <option value="College Undergraduate">College Undergraduate</option>
                                                        <option value="College Graduate">College Graduate</option>
                                                        <option value="Vocational / Technical">Vocational / Technical</option>
                                                        <option value="Postgraduate">Postgraduate</option>
                                                    </select>
                                                ) : <p className="text-content text-sm font-medium">{profileData.educational_attainment || '—'}</p>}
                                            </div>
                                        </section>

                                        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                                            <div>
                                                <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                    <Globe size={18} className="text-blue-500" /> Languages Spoken
                                                </h3>
                                                {isEditing ? (
                                                    <textarea name="languages" placeholder="e.g., English, Tagalog, Hiligaynon (comma separated)" value={profileData.languages ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[80px] outline-none focus:ring-2 focus:ring-accent/50 text-content" />
                                                ) : (
                                                    <div className="flex flex-wrap gap-2">
                                                        {languageList.length > 0 ? languageList.map((lang, idx) => (
                                                            <span key={idx} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-xs font-bold rounded-full">{lang}</span>
                                                        )) : <span className="text-subtle text-sm italic">None specified</span>}
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                    <Sparkles size={18} className="text-amber-500" /> Core Skillsets
                                                </h3>
                                                {isEditing ? (
                                                    <textarea name="skills" placeholder="e.g., Communication, Data Entry, Customer Service (comma separated)" value={profileData.skills ?? ''} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[80px] outline-none focus:ring-2 focus:ring-accent/50 text-content" />
                                                ) : (
                                                    <div className="flex flex-wrap gap-2">
                                                        {skillsList.length > 0 ? skillsList.map((skill, idx) => (
                                                            <span key={idx} className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-xs font-bold rounded-full">{skill}</span>
                                                        )) : <span className="text-subtle text-sm italic">None specified</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'preference' && (
                                    <div className="space-y-6 animate-in slide-in-from-bottom-2">
                                        <section>
                                            <h3 className="text-sm font-bold text-content flex items-center gap-2 mb-4 border-b border-line pb-2">
                                                <Briefcase size={18} className="text-accent-text" /> Career Preferences
                                            </h3>
                                            <div className="grid grid-cols-1 gap-4 sm:gap-5">
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Preferred Job Roles</label>
                                                    {isEditing ? <input name="preferred_roles" placeholder="e.g., IT Support, Admin Assistant" value={profileData.preferred_roles} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium">{profileData.preferred_roles || '—'}</p>}
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                                                    <div>
                                                        <label className="block text-xs font-bold text-muted mb-1">Experience Level</label>
                                                        {isEditing ? (
                                                            <select name="experience_level" value={profileData.experience_level} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content">
                                                                <option value="Entry Level">Entry Level (0-2 years)</option>
                                                                <option value="Mid Level">Mid Level (3-5 years)</option>
                                                                <option value="Senior Level">Senior Level (5+ years)</option>
                                                            </select>
                                                        ) : <p className="text-content text-sm font-medium">{profileData.experience_level || '—'}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-muted mb-1">Availability Setup</label>
                                                        {isEditing ? (
                                                            <select name="availability" value={profileData.availability} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium outline-none focus:ring-2 focus:ring-accent/50 text-content">
                                                                <option value="Full-time">Full-time</option>
                                                                <option value="Part-time">Part-time</option>
                                                                <option value="Night-shift">Night-shift</option>
                                                                <option value="Freelance/Contract">Freelance / Contract</option>
                                                            </select>
                                                        ) : <p className="text-content text-sm font-medium">{profileData.availability || '—'}</p>}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted mb-1">Career Goals & Objectives</label>
                                                    {isEditing ? <textarea name="career_goals" placeholder="What are you looking to achieve in your next professional position?" value={profileData.career_goals} onChange={handleChange} className="w-full p-2.5 rounded-lg border border-line bg-sunken text-sm font-medium min-h-[100px] outline-none focus:ring-2 focus:ring-accent/50 text-content" /> : <p className="text-content text-sm font-medium whitespace-pre-wrap">{profileData.career_goals || '—'}</p>}
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}

                                {activeTab === 'portfolio' && (
                                    <div className="space-y-6">
                                        <CertificateLibrary />
                                        {/* SMS alerts — shown only when the office has enabled the SMS channel (#8). */}
                                        {features?.smsNotifications && <SmsAlertsCard />}
                                    </div>
                                )}

                                {/* Action Control Row */}
                                {isEditing && (
                                    <div className="pt-6 border-t border-line flex justify-end gap-3 sticky bottom-0 bg-surface/95 backdrop-blur py-4 -mx-8 px-8 rounded-b-[2rem] shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-10">
                                        <button type="button" onClick={() => setIsEditing(false)} disabled={isSaving} className="px-6 py-3 font-bold text-muted bg-sunken hover:bg-line rounded-xl transition-colors disabled:opacity-50 text-sm">Cancel</button>
                                        <button type="submit" disabled={isSaving} className="px-8 py-3 font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg shadow-accent/30 flex items-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-50 text-sm">
                                            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                            Save Profile
                                        </button>
                                    </div>
                                )}
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            {/* AVATAR CONFIRMATION FRAME */}
            {isAvatarModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in" onClick={cancelAvatarUpload}>
                    <div className="bg-surface rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl border border-white/20 dark:border-line text-center relative animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-black text-content mb-2">Update Profile Picture</h3>
                        <p className="text-sm text-muted mb-6 font-medium">Are you sure you want to use this image as your profile picture?</p>
                        <div className="w-40 h-40 mx-auto rounded-full border-4 border-indigo-100 dark:border-line shadow-lg overflow-hidden mb-8 bg-sunken">
                            <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex gap-3">
                            <button onClick={cancelAvatarUpload} disabled={isUploadingAvatar} className="flex-1 py-3.5 bg-sunken hover:bg-line text-muted font-bold rounded-xl transition-colors disabled:opacity-50">Cancel</button>
                            <button onClick={confirmAvatarUpload} disabled={isUploadingAvatar} className="flex-1 py-3.5 bg-accent hover:bg-accent-hover text-white font-black rounded-xl shadow-sm flex justify-center items-center gap-2 disabled:opacity-50"><CheckCircle size={18} /> Confirm</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* AVATAR GALLERY — pick a picture without uploading one.
                A selection is persisted through the same endpoint as an upload
                (see persistAvatar), so from here on the two are indistinguishable
                to every other module. */}
            {isAvatarPickerOpen && createPortal(
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in"
                    onClick={() => !pendingSeed && setIsAvatarPickerOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Choose an avatar"
                >
                    <div
                        className="bg-surface rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl border border-white/20 dark:border-line animate-in zoom-in-95"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 p-5 sm:p-6 border-b border-line">
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-content">Choose Your Avatar</h3>
                                <p className="text-sm text-muted font-medium mt-0.5">
                                    Pick a ready-made avatar — no upload needed. You can change it any time.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAvatarPickerOpen(false)}
                                disabled={Boolean(pendingSeed)}
                                aria-label="Close"
                                className="p-2 rounded-lg text-subtle hover:text-muted dark:hover:text-gray-200 hover:bg-line transition-colors disabled:opacity-40"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4">
                                {gallery.map(option => {
                                    const isCurrent = profileData.avatar_url === option.src;
                                    const isSaving = pendingSeed === option.seed;
                                    return (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => chooseGalleryAvatar(option.seed)}
                                            disabled={Boolean(pendingSeed)}
                                            aria-label={`Use the ${option.seed} avatar`}
                                            aria-pressed={isCurrent}
                                            className={`relative aspect-square rounded-2xl overflow-hidden border-2 transition-all disabled:opacity-60 ${
                                                isCurrent
                                                    ? 'border-accent dark:border-accent ring-2 ring-accent/30 dark:ring-accent/30'
                                                    : 'border-transparent hover:border-line hover:-translate-y-0.5'
                                            }`}
                                        >
                                            <img src={option.src} alt="" className="w-full h-full object-cover" />
                                            {isCurrent && !isSaving && (
                                                <span className="absolute bottom-1 right-1 bg-accent text-white rounded-full p-0.5 shadow">
                                                    <CheckCircle size={14} />
                                                </span>
                                            )}
                                            {isSaving && (
                                                <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                                    <Loader2 size={22} className="animate-spin text-white" />
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-4 sm:p-5 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3">
                            <p className="text-xs text-subtle font-medium text-center sm:text-left">
                                Prefer your own picture? Upload one instead — it works exactly the same way.
                            </p>
                            <button
                                type="button"
                                onClick={() => { setIsAvatarPickerOpen(false); fileInputRef.current?.click(); }}
                                disabled={Boolean(pendingSeed)}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50"
                            >
                                <Upload size={16} /> Upload a Photo
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Profile;