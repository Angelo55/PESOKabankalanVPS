import React, { useState, useEffect, useCallback } from 'react';
import { Award, Upload, Trash2, Loader2, Eye } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import EmptyState from './common/EmptyState';
import InlineUsageMeter from './common/InlineUsageMeter';

/**
 * CERTIFICATE LIBRARY (Enhancement C.2) — the applicant's reusable supporting
 * certificates. Upload once here; re-select them in the Apply Wizard (which
 * snapshots the chosen ones into each application package). Durable base64 in the
 * DB via the owner-scoped /profile/certificates endpoints.
 */

const getAuthConfig = () => {
    const token = sessionStorage.getItem('jobTrackerToken');
    return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const CATEGORIES = ['TESDA', 'License', 'Certification', 'Training', 'Seminar', 'Other'];

const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); const c = s.indexOf(','); resolve(c >= 0 ? s.slice(c + 1) : s); };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
});

const CertificateLibrary = () => {
    const { notify, confirm } = useNotification();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [category, setCategory] = useState('Other');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await API.get('/profile/certificates', getAuthConfig());
            setItems(res.data?.data || []);
        } catch {
            /* non-critical */
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const onFiles = async (fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        setUploading(true);
        for (const file of files) {
            if (!ALLOWED.includes(file.type)) { notify.warning('Unsupported file', `${file.name}: PDF, JPG, PNG, or WEBP only.`); continue; }
            if (file.size > MAX_BYTES) { notify.warning('File too large', `${file.name} is over 5 MB.`); continue; }
            try {
                const base64 = await fileToBase64(file);
                await API.post('/profile/certificates', { file_name: file.name, mime_type: file.type, base64, title: file.name, category }, getAuthConfig());
            } catch (e) {
                notify.error('Upload failed', e.response?.data?.message || `Could not save ${file.name}.`);
            }
        }
        setUploading(false);
        load();
    };

    const remove = async (id) => {
        const ok = await confirm('Remove certificate?', 'This deletes it from your library. Applications you already submitted keep their own copy.');
        if (!ok) return;
        try {
            await API.delete(`/profile/certificates/${id}`, getAuthConfig());
            setItems((prev) => prev.filter((i) => i.id !== id));
        } catch {
            notify.error('Failed', 'Could not remove the certificate.');
        }
    };

    const view = async (id, mime) => {
        try {
            const res = await API.get(`/profile/certificates/${id}`, { ...getAuthConfig(), responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: mime || 'application/pdf' }));
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch {
            notify.error('Could not open', 'The file could not be loaded.');
        }
    };

    return (
        <div className="animate-in slide-in-from-bottom-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-lg font-bold text-content">My Certificates</h3>
                    <p className="text-sm text-muted">Save TESDA certs, licences, and training certificates once — attach them to any application.</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Certificate category" className="appearance-none px-3 py-2 rounded-lg border border-line bg-surface text-sm font-semibold text-content cursor-pointer">
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-contrast rounded-lg text-sm font-black cursor-pointer hover:bg-accent-hover transition-colors">
                        {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload
                        <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
                    </label>
                </div>
            </div>

            {/* Library usage — the enforced 30-certificate cap, so the limit is visible
                before an upload is refused. Refreshes as certificates are added/removed. */}
            <InlineUsageMeter keys={['certificate_library']} refreshKey={items.length} className="mb-4" />

            {loading ? (
                <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-accent-text" size={28} /></div>
            ) : items.length === 0 ? (
                <EmptyState
                    size="sm"
                    icon={Award}
                    title="No certificates yet"
                    description="Upload your certificates, licenses, and training records once — then attach them to any application in a click. PDF certificates are also read by the AI to strengthen your compatibility score."
                />
            ) : (
                <ul className="space-y-2">
                    {items.map((c) => (
                        <li key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-line bg-surface/60">
                            <Award size={18} className="text-accent-text shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-content truncate">{c.title || c.file_name}</p>
                                <p className="text-[11px] text-subtle">{c.category || 'Certificate'} · {(c.byte_size / 1024).toFixed(0)} KB</p>
                            </div>
                            <button type="button" onClick={() => view(c.id, c.mime_type)} className="p-2 text-subtle hover:text-accent-text transition-colors" title="View"><Eye size={16} /></button>
                            <button type="button" onClick={() => remove(c.id)} className="p-2 text-subtle hover:text-rose-500 transition-colors" title="Remove"><Trash2 size={16} /></button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default CertificateLibrary;
