/**
 * PESO ORGANIZATION PROFILE — the office's public identity.
 *
 * WHAT: how the Kabankalan City PESO Office presents itself — office
 * information, address, contact + social channels, mission & vision, and the
 * single Authorized Officer (the referral-letter signatory). This is the data
 * that surfaces on the public job board and, for the officer fields, informs
 * the tone of official correspondence.
 *
 * WHY IT IS NOT AN EMPLOYER PROFILE ANYMORE: the module used to collect
 * employer/company recruitment fields (industry, company size, years in
 * operation, an HR "recruitment contact"). That is semantically wrong for a
 * government PESO office and there is no Employer role yet. Those fields were
 * removed from the workflow; the underlying columns lie dormant for a future
 * dedicated Employer implementation (migration 026). System configuration
 * (AI thresholds, sign-up controls, OTP lifetime) is intentionally NOT here —
 * it is governed centrally by the Super Administrator (§7.12), not per office.
 */

import React, { useState, useEffect } from 'react';
import {
    Landmark, Building2, MapPin, Phone, Mail, Globe, Clock, Share2,
    Target, Eye, ShieldCheck, Loader2, Save, Info,
} from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const EMPTY_FORM = {
    company_name: '', business_description: '', office_hours: '', website: '',
    office_address: '', city: '', province: '', postal_code: '',
    office_phone: '', office_email: '', facebook_url: '',
    representative_name: '', representative_position: '', representative_email: '', representative_phone: '',
    mission: '', vision: '',
};

// Shared field styling so every input in the form reads identically.
const inputCls = "w-full p-3 sm:p-3.5 bg-sunken/50 border border-line rounded-xl text-sm font-semibold focus:ring-2 focus:ring-accent/50 outline-none text-content transition-all";
const labelCls = "block text-xs font-bold text-muted uppercase tracking-wide mb-2";

const Field = ({ label, icon, children }) => (
    <div>
        <label className={`${labelCls} flex items-center gap-2`}>{label}{icon}</label>
        {children}
    </div>
);

const Section = ({ icon, title, subtitle, children }) => (
    <div className="bg-raised/80 backdrop-blur-xl p-5 sm:p-8 rounded-[2rem] shadow-sm border border-white/60 dark:border-line/50">
        <div className="flex items-center gap-3 mb-6 border-b border-line pb-4">
            <div className="text-accent-text shrink-0">{icon}</div>
            <div>
                <h2 className="text-lg sm:text-xl font-black text-content">{title}</h2>
                {subtitle && <p className="text-xs text-muted font-medium mt-0.5">{subtitle}</p>}
            </div>
        </div>
        {children}
    </div>
);

const PesoAdminProfile = () => {
    const { notify } = useNotification();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [accountEmail, setAccountEmail] = useState('');

    useEffect(() => { fetchProfile(); }, []);

    const fetchProfile = async () => {
        try {
            const response = await API.get('/peso-admin/profile', getAuthConfig());
            const data = response.data?.data || {};
            setAccountEmail(data.account_email || '');
            // Merge only the fields this module owns, defaulting to '' to keep the
            // inputs controlled. Dormant legacy employer columns are ignored.
            setFormData(prev => {
                const next = { ...prev };
                for (const key of Object.keys(EMPTY_FORM)) next[key] = data[key] ?? '';
                return next;
            });
        } catch (error) {
            notify.error("Error", "Failed to load the organization profile.");
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await API.put('/peso-admin/profile', formData, getAuthConfig());
            notify.success("Profile Saved", "Your organization details have been updated successfully.");
        } catch (error) {
            notify.error("Save Failed", "Could not update the organization profile. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    // Completion reflects the fields that make the office look complete on the
    // public board and on letters.
    const completionFields = ['company_name', 'business_description', 'office_address', 'office_hours', 'office_phone', 'representative_name', 'mission'];
    const filled = completionFields.filter(f => (formData[f] || '').trim().length > 0).length;
    const completionRate = Math.round((filled / completionFields.length) * 100);

    if (loading) {
        return <div className="flex justify-center items-center min-h-[calc(100vh-4rem)]"><Loader2 className="animate-spin text-accent-text" size={40} /></div>;
    }

    return (
        <div className="p-3 sm:p-6 lg:p-8 w-full max-w-5xl mx-auto min-h-screen animate-fade-scale-in">
            {/* Header */}
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-2xl bg-accent text-accent-contrast shrink-0">
                        <Landmark size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight">
                            PESO Organization Profile
                        </h1>
                        <p className="text-muted mt-1 font-medium text-sm">Your office's public identity on the job board and referral letters.</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-surface/60 p-4 rounded-2xl border border-line shadow-sm w-full md:w-auto">
                    <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path strokeDasharray="100, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                            <path strokeDasharray={`${completionRate}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={completionRate === 100 ? "#10b981" : "#1a4a38"} strokeWidth="3" className="transition-all duration-1000 ease-out" />
                        </svg>
                        <div className="absolute flex items-center justify-center text-xs font-black text-muted">{completionRate}%</div>
                    </div>
                    <div>
                        <h3 className="font-bold text-sm text-content">Profile Strength</h3>
                        <p className="text-xs font-medium text-muted">A complete profile builds public trust.</p>
                    </div>
                </div>
            </header>

            <form onSubmit={handleSaveProfile} className="space-y-6 sm:space-y-8">

                {/* Office Information */}
                <Section icon={<Building2 size={24} />} title="Office Information">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                        <div className="md:col-span-2">
                            <Field label="Office Name *">
                                <input required name="company_name" value={formData.company_name} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. Kabankalan City PESO Office" />
                            </Field>
                        </div>
                        <div className="md:col-span-2">
                            <Field label="About the Office">
                                <textarea name="business_description" value={formData.business_description} onChange={handleInputChange} rows="4" className={inputCls} placeholder="Briefly describe the office's mandate and the services it provides to the community." />
                            </Field>
                        </div>
                        <Field label="Office Hours" icon={<Clock size={14} />}>
                            <input name="office_hours" value={formData.office_hours} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. Mon–Fri, 8:00 AM – 5:00 PM" />
                        </Field>
                        <Field label="Website" icon={<Globe size={14} />}>
                            <input name="website" value={formData.website} onChange={handleInputChange} type="url" className={inputCls} placeholder="https://kabankalan.gov.ph" />
                        </Field>
                    </div>
                </Section>

                {/* Office Address */}
                <Section icon={<MapPin size={24} />} title="Office Address">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
                        <div className="md:col-span-3">
                            <Field label="Complete Office Address">
                                <input name="office_address" value={formData.office_address} onChange={handleInputChange} type="text" className={inputCls} placeholder="Building, Street, Barangay" />
                            </Field>
                        </div>
                        <Field label="City / Municipality">
                            <input name="city" value={formData.city} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. Kabankalan City" />
                        </Field>
                        <Field label="Province">
                            <input name="province" value={formData.province} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. Negros Occidental" />
                        </Field>
                        <Field label="Postal Code">
                            <input name="postal_code" value={formData.postal_code} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. 6111" />
                        </Field>
                    </div>
                </Section>

                {/* Contact & Social */}
                <Section icon={<Phone size={24} />} title="Contact & Social" subtitle="Public channels job seekers can use to reach the office.">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                        <Field label="Office Phone" icon={<Phone size={14} />}>
                            <input name="office_phone" value={formData.office_phone} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. (034) 471-2345" />
                        </Field>
                        <Field label="Office Email" icon={<Mail size={14} />}>
                            <input name="office_email" value={formData.office_email} onChange={handleInputChange} type="email" className={inputCls} placeholder="peso@kabankalan.gov.ph" />
                        </Field>
                        <Field label="Facebook Page" icon={<Share2 size={14} />}>
                            <input name="facebook_url" value={formData.facebook_url} onChange={handleInputChange} type="url" className={inputCls} placeholder="https://facebook.com/PESOKabankalan" />
                        </Field>
                        <Field label="Login Email (read-only)">
                            <input value={accountEmail} type="email" disabled className={`${inputCls} opacity-70 cursor-not-allowed`} />
                        </Field>
                    </div>
                </Section>

                {/* Mission & Vision */}
                <Section icon={<Target size={24} />} title="Mission & Vision">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                        <Field label="Mission" icon={<Target size={14} />}>
                            <textarea name="mission" value={formData.mission} onChange={handleInputChange} rows="4" className={inputCls} placeholder="The office's mission statement." />
                        </Field>
                        <Field label="Vision" icon={<Eye size={14} />}>
                            <textarea name="vision" value={formData.vision} onChange={handleInputChange} rows="4" className={inputCls} placeholder="The office's vision statement." />
                        </Field>
                    </div>
                </Section>

                {/* Authorized Officer */}
                <Section icon={<ShieldCheck size={24} />} title="Authorized Officer" subtitle="The head of office / signatory whose details represent the office in official correspondence.">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                        <Field label="Full Name">
                            <input name="representative_name" value={formData.representative_name} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. Juan Dela Cruz" />
                        </Field>
                        <Field label="Position / Title">
                            <input name="representative_position" value={formData.representative_position} onChange={handleInputChange} type="text" className={inputCls} placeholder="e.g. PESO Manager" />
                        </Field>
                        <Field label="Email Address" icon={<Mail size={14} />}>
                            <input name="representative_email" value={formData.representative_email} onChange={handleInputChange} type="email" className={inputCls} />
                        </Field>
                        <Field label="Phone Number" icon={<Phone size={14} />}>
                            <input name="representative_phone" value={formData.representative_phone} onChange={handleInputChange} type="text" className={inputCls} />
                        </Field>
                    </div>
                </Section>

                {/* Save bar */}
                <div className="sticky bottom-4 sm:bottom-8 z-40 bg-surface/90 backdrop-blur-xl p-4 rounded-3xl border border-line shadow-2xl flex items-center justify-between gap-3">
                    <div className="hidden sm:flex items-center gap-3 px-4">
                        <Info className="text-subtle shrink-0" size={20} />
                        <p className="text-sm font-medium text-muted">System settings are managed by the Super Administrator — this profile is your office's public identity.</p>
                    </div>
                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full sm:w-auto px-8 py-3.5 bg-accent hover:bg-accent text-accent-contrast font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        {saving ? 'Saving...' : 'Save Organization Profile'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default PesoAdminProfile;
