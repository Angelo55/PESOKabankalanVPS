import { useMemo, useState } from 'react';

// A job's browsing category is its first-class `category`, falling back to the
// legacy free-text `department` so older postings still group somewhere.
export const getJobCategory = (job) => {
    const c = (job?.category ?? '').toString().trim();
    if (c) return c;
    return (job?.department ?? '').toString().trim();
};

export const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'az', label: 'Title A–Z' },
    { value: 'za', label: 'Title Z–A' },
    { value: 'deadline', label: 'Deadline (soonest)' },
];

const distinct = (jobs, key) => {
    const set = new Set();
    jobs.forEach(j => { const v = (j?.[key] ?? '').toString().trim(); if (v) set.add(v); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
};

/**
 * Single source of truth for job list search / filter / sort. Client-side so
 * filtering is instant on the small PESO datasets. Reused by every listing page.
 */
export default function useJobFilters(jobs = []) {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [jobType, setJobType] = useState('');
    const [workSetup, setWorkSetup] = useState('');
    const [location, setLocation] = useState('');
    const [status, setStatus] = useState(''); // used by admin/application listings
    const [sort, setSort] = useState('newest');

    const categories = useMemo(() => {
        const map = new Map();
        jobs.forEach(j => { const c = getJobCategory(j); if (c) map.set(c, (map.get(c) || 0) + 1); });
        return Array.from(map.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }, [jobs]);

    const jobTypes = useMemo(() => distinct(jobs, 'job_type'), [jobs]);
    const workSetups = useMemo(() => distinct(jobs, 'work_setup'), [jobs]);
    const statuses = useMemo(() => distinct(jobs, 'status'), [jobs]);

    const filtered = useMemo(() => {
        let list = Array.isArray(jobs) ? [...jobs] : [];
        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter(j =>
                [j.title, j.company, j.department, j.category, j.location, j.description]
                    .some(f => (f ?? '').toString().toLowerCase().includes(q))
            );
        }
        if (category) list = list.filter(j => getJobCategory(j) === category);
        if (jobType) list = list.filter(j => (j.job_type ?? '').toString() === jobType);
        if (workSetup) list = list.filter(j => (j.work_setup ?? '').toString() === workSetup);
        if (location) list = list.filter(j => (j.location ?? '').toString().toLowerCase().includes(location.trim().toLowerCase()));
        if (status) list = list.filter(j => (j.status ?? '').toString() === status);

        const time = (v) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
        switch (sort) {
            case 'oldest': list.sort((a, b) => time(a.created_at) - time(b.created_at)); break;
            case 'az': list.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')); break;
            case 'za': list.sort((a, b) => (b.title ?? '').localeCompare(a.title ?? '')); break;
            case 'deadline':
                list.sort((a, b) => {
                    const da = a.deadline ? new Date(a.deadline).getTime() : null;
                    const dbb = b.deadline ? new Date(b.deadline).getTime() : null;
                    if (da == null && dbb == null) return 0;
                    if (da == null) return 1;
                    if (dbb == null) return -1;
                    return da - dbb;
                });
                break;
            default: list.sort((a, b) => time(b.created_at) - time(a.created_at));
        }
        return list;
    }, [jobs, search, category, jobType, workSetup, location, status, sort]);

    const activeCount = [search, category, jobType, workSetup, location, status].filter(v => v && v.toString().trim()).length;

    const reset = () => {
        setSearch(''); setCategory(''); setJobType(''); setWorkSetup(''); setLocation(''); setStatus(''); setSort('newest');
    };

    return {
        state: { search, category, jobType, workSetup, location, status, sort },
        set: { setSearch, setCategory, setJobType, setWorkSetup, setLocation, setStatus, setSort },
        filtered, categories, jobTypes, workSetups, statuses, activeCount, reset,
    };
}
