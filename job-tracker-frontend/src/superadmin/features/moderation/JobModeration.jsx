import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, Search, Filter, Trash2, CheckCircle, AlertCircle, Loader, Building, MapPin, Users, X, ImagePlus, ImageOff } from 'lucide-react';
import API from '../../../api';
import { useNotification } from '../../../context/NotificationContext';
import Pagination from '../../../components/common/Pagination';
import EmptyState from '../../../components/common/EmptyState';

// Featured images are served from /uploads on the API host (outside the /api prefix).
const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');
const resolveImage = (src) => (src ? (src.startsWith('http') ? src : `${FILE_BASE}${src}`) : null);

const getAuthConfig = () => {
	const token = sessionStorage.getItem('jobTrackerToken');
	return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

const JobModeration = () => {
	const { notify } = useNotification();
	const [jobs, setJobs] = useState([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(10);
	const [loading, setLoading] = useState(true);

	// Search + status now drive SERVER-SIDE queries (Phase 1).
	const [searchQuery, setSearchQuery] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [statusFilter, setStatusFilter] = useState('All');

	const [jobToDelete, setJobToDelete] = useState(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Per-card image upload tracking.
	const [uploadingId, setUploadingId] = useState(null);
	const fileInputRef = useRef(null);
	const targetJobRef = useRef(null);

	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
		return () => clearTimeout(t);
	}, [searchQuery]);

	useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === 'Escape' && jobToDelete && !isDeleting) setJobToDelete(null);
		};
		if (jobToDelete) window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [jobToDelete, isDeleting]);

	const fetchJobs = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams({ page: String(page), limit: String(limit) });
			if (debouncedSearch) params.set('q', debouncedSearch);
			if (statusFilter !== 'All') params.set('status', statusFilter);
			const response = await API.get(`/admin/jobs?${params.toString()}`, getAuthConfig());
			setJobs(Array.isArray(response.data?.data) ? response.data.data : []);
			setTotal(response.data?.total || 0);
		} catch (error) {
			notify.error('Data Error', 'Failed to load platform job postings.');
			setJobs([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, [page, limit, debouncedSearch, statusFilter, notify]);

	useEffect(() => { fetchJobs(); }, [fetchJobs]);

	const confirmDeleteJob = async () => {
		if (!jobToDelete) return;
		setIsDeleting(true);
		try {
			await API.delete(`/admin/jobs/${jobToDelete.id}`, getAuthConfig());
			notify.success('Deleted', 'Job posting has been permanently removed.');
			setJobToDelete(null);
			fetchJobs(); // refetch so the page + total stay accurate after removal
		} catch (error) {
			notify.error('Error', 'Failed to delete job posting.');
		} finally {
			setIsDeleting(false);
		}
	};

	const openImagePicker = (job) => {
		targetJobRef.current = job;
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
			fileInputRef.current.click();
		}
	};

	const handleImageSelected = async (e) => {
		const file = e.target.files?.[0];
		const job = targetJobRef.current;
		e.target.value = '';
		if (!file || !job) return;

		if (!file.type.startsWith('image/')) {
			notify.warning('Invalid File', 'Please choose a JPG, PNG, or WEBP image.');
			return;
		}
		if (file.size > 8 * 1024 * 1024) {
			notify.warning('File Too Large', 'The featured image must be under 8MB.');
			return;
		}

		setUploadingId(job.id);
		try {
			const form = new FormData();
			form.append('image', file);
			const res = await API.post(`/admin/jobs/${job.id}/image`, form, {
				...getAuthConfig(),
				headers: { ...getAuthConfig().headers, 'Content-Type': 'multipart/form-data' }
			});
			const featured = res.data?.featured_image;
			setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, featured_image: featured } : j)));
			notify.success('Image Updated', 'The featured image is now live on the job board.');
		} catch (error) {
			notify.error('Upload Failed', error.response?.data?.message || 'Could not upload the featured image.');
		} finally {
			setUploadingId(null);
		}
	};

	const removeImage = async (job) => {
		setUploadingId(job.id);
		try {
			await API.delete(`/admin/jobs/${job.id}/image`, getAuthConfig());
			setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, featured_image: null } : j)));
			notify.success('Image Removed', 'The featured image has been cleared.');
		} catch (error) {
			notify.error('Error', error.response?.data?.message || 'Could not remove the featured image.');
		} finally {
			setUploadingId(null);
		}
	};

	const isLive = (status) => status === 'Open' || status === 'Published';

	return (
		<div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in relative">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				className="hidden"
				onChange={handleImageSelected}
			/>

			<header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
				<div>
					<h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight flex items-center gap-3">
						<Briefcase className="text-emerald-500" size={36} /> Job Publication Manager
					</h1>
					<p className="text-muted mt-2 font-medium">
						Curate featured imagery, review, and moderate platform job postings.
					</p>
				</div>
			</header>

			<div className="flex flex-col md:flex-row gap-4 mb-8">
				<div className="relative flex-1">
					<Search className="absolute left-4 top-3.5 text-subtle" size={20} />
					<input
						type="text"
						placeholder="Search by title or employer..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full pl-12 pr-4 py-3.5 bg-surface border border-line dark:border-line rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500/50 outline-none text-content transition-all shadow-sm"
					/>
				</div>
				<div className="relative w-full md:w-64">
					<Filter className="absolute left-4 top-3.5 text-subtle" size={20} />
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="w-full pl-12 pr-10 py-3.5 bg-surface border border-line dark:border-line rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500/50 outline-none text-content appearance-none cursor-pointer shadow-sm"
					>
						<option value="All">All Statuses</option>
						<option value="Open">Open</option>
						<option value="Published">Published</option>
						<option value="Closed">Closed</option>
					</select>
				</div>
			</div>

			<Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} position="top" />

			{loading ? (
				<div className="p-24 text-center">
					<Loader className="animate-spin text-emerald-500 mx-auto" size={36} />
				</div>
			) : jobs.length === 0 ? (
				<EmptyState
					variant="search"
					icon={Briefcase}
					title="No job postings found"
					description="No vacancies match your current search or status filter. Try a different keyword or adjust the filters to review the rest of the platform's postings."
				/>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
					{jobs.map((job) => {
						const img = resolveImage(job.featured_image);
						const busy = uploadingId === job.id;
						return (
							<div
								key={job.id}
								className="group bg-surface rounded-3xl border border-line shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col transition-all hover:-translate-y-1 hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]"
							>
								{/* Bento visual */}
								<div className="relative h-40 w-full overflow-hidden">
									{img ? (
										<img src={img} alt={job.title} className="w-full h-full object-cover" />
									) : (
										<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent via-accent to-accent-hover">
											<span className="text-white/90 font-black text-4xl tracking-tight">
												{(job.company || job.employer_name || 'J').charAt(0).toUpperCase()}
											</span>
										</div>
									)}

									<span
										className={`absolute top-3 left-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider backdrop-blur-sm ${
											isLive(job.status)
												? 'bg-emerald-500/90 text-white'
												: 'bg-gray-900/70 text-gray-100'
										}`}
									>
										{isLive(job.status) ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
										{job.status || 'Unknown'}
									</span>

									{/* Image controls */}
									<div className="absolute top-3 right-3 flex gap-2">
										<button
											onClick={() => openImagePicker(job)}
											disabled={busy}
											title={img ? 'Replace featured image' : 'Upload featured image'}
											className="p-2 rounded-lg bg-surface/90 hover:bg-white text-accent-text shadow-sm transition-colors disabled:opacity-50"
										>
											{busy ? <Loader size={16} className="animate-spin" /> : <ImagePlus size={16} />}
										</button>
										{img && !busy && (
											<button
												onClick={() => removeImage(job)}
												title="Remove featured image"
												className="p-2 rounded-lg bg-surface/90 hover:bg-white text-rose-500 shadow-sm transition-colors"
											>
												<ImageOff size={16} />
											</button>
										)}
									</div>
								</div>

								{/* Body */}
								<div className="p-5 flex flex-col flex-1">
									<h3 className="font-black text-content text-lg leading-tight line-clamp-2">
										{job.title}
									</h3>
									<div className="flex items-center gap-1.5 mt-1.5 text-sm font-bold text-muted">
										<Building size={14} className="text-subtle" /> {job.company || job.employer_name}
									</div>
									<div className="text-xs text-subtle font-medium mt-0.5">{job.employer_email}</div>

									<div className="flex items-center gap-3 mt-4 text-xs font-semibold text-muted">
										<span className="flex items-center gap-1">
											<MapPin size={12} /> {job.location || 'Unspecified'}
										</span>
										<span className="flex items-center gap-1">
											<Users size={12} /> {job.application_count || 0} Applicants
										</span>
									</div>

									<div className="mt-5 pt-4 border-t border-line flex justify-end">
										<button
											onClick={() => setJobToDelete(job)}
											className="p-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 text-rose-500 rounded-xl transition-colors inline-flex items-center gap-1.5 text-xs font-black"
											title="Forcefully remove this posting"
										>
											<Trash2 size={16} /> Remove
										</button>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Pagination page={page} limit={limit} total={total} onPage={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />

			{jobToDelete && createPortal(
				<div
					className="fixed inset-0 lg:left-64 z-[9999] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md animate-in fade-in duration-300 cursor-pointer"
					onClick={() => !isDeleting && setJobToDelete(null)}
				>
					<div
						className="bg-surface w-full max-w-md rounded-[2rem] p-5 sm:p-6 shadow-2xl relative animate-in zoom-in-95 duration-300 border border-line cursor-default"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							onClick={() => !isDeleting && setJobToDelete(null)}
							disabled={isDeleting}
							className="absolute top-4 right-4 p-2 text-subtle hover:text-content dark:hover:text-white bg-sunken hover:bg-line rounded-full transition-colors disabled:opacity-50"
						>
							<X size={20} />
						</button>

						<div className="flex flex-col items-center text-center mb-8 mt-2">
							<div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mb-5 border-4 border-white dark:border-line shadow-sm">
								<AlertCircle size={32} />
							</div>
							<h3 className="text-2xl font-black text-content mb-2 tracking-tight">Delete Job Posting?</h3>
							<p className="text-sm font-medium text-muted mb-6">This action is permanent and cannot be undone.</p>

							<div className="bg-sunken w-full p-5 rounded-2xl border border-line text-left">
								<p className="text-sm font-black text-content truncate">{jobToDelete.title}</p>
								<div className="flex items-center gap-1.5 mt-1.5">
									<Building size={14} className="text-indigo-400" />
									<p className="text-xs font-bold text-indigo-500 truncate">{jobToDelete.company || jobToDelete.employer_name}</p>
								</div>
							</div>
						</div>

						<div className="flex gap-3">
							<button
								onClick={() => setJobToDelete(null)}
								disabled={isDeleting}
								className="flex-1 py-3.5 bg-sunken hover:bg-line text-muted font-black rounded-xl transition-all disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								onClick={confirmDeleteJob}
								disabled={isDeleting}
								className="flex-1 py-3.5 bg-rose-500 hover:bg-rose-600 text-white font-black rounded-xl shadow-lg shadow-rose-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
							>
								{isDeleting ? <Loader size={18} className="animate-spin" /> : <Trash2 size={18} />}
								{isDeleting ? 'Deleting...' : 'Confirm Delete'}
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
};

export default JobModeration;