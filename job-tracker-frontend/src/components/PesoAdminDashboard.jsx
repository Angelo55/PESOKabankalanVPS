/**
 * PESO ADMINISTRATOR DASHBOARD — vacancy management.
 *
 * WHAT: the administrator's overview of their own postings, plus the
 * Create/Edit Job Posting modal that is the main authoring surface.
 *
 * WHEN: the "Job Publication Management" sidebar item (/peso-admin/jobs). This
 * file keeps its PesoAdminDashboard name for git continuity, but the analytics
 * "Dashboard" (the command center) is a separate component, PesoAdminOverview,
 * mounted at /peso-admin/dashboard. This screen is the CRUD/monitoring surface —
 * create, publish, edit, archive and monitor vacancies — and consolidates what
 * used to be the separate "Managed Listings" and "Post Vacancy" menu items.
 *
 * ── VACANCY USAGE ON EVERY CARD ────────────────────────────────────────────
 * Each posting shows "N/M positions referred" and a FULL chip at capacity. That
 * count is the SAME rule the server enforces when approving a referral, so the
 * card cannot promise an approval the API will refuse with a 409.
 *
 * Legacy rows can exceed their cap — referrals approved before the cap existed.
 * They simply render as filled. Do NOT "correct" them: the referrals are real
 * and the letters were issued.
 *
 * ── THE CREATE/EDIT MODAL ──────────────────────────────────────────────────
 * Compact spec on purpose (max-w-3xl, space-y-6, p-2.5/p-3 inputs). It is a long
 * form and generous padding pushed the save action below the fold on a laptop.
 *
 * `skills` and `qualifications` are persisted by POST and PUT. They were
 * silently dropped for a period — the fields accepted input, the request
 * succeeded, and the values never reached the database. Worth remembering
 * before adding a new field: check it round-trips, do not assume.
 *
 * ── STATUS VALUES ARE CONSTRAINED BY THE DATABASE ──────────────────────────
 * Only 'Open', 'Closed', 'Draft', 'Published' and 'Filled' are valid. TiDB
 * rejects anything else with WARN_DATA_TRUNCATED, which rolls back the WHOLE
 * enclosing transaction rather than failing one field — that is how referral
 * approval once started returning 500s. New status values need a migration
 * APPENDING to the enum first.
 *
 * ── THE REOPEN RULE ────────────────────────────────────────────────────────
 * Raising positions_available on a Filled posting reopens it to 'Open'
 * automatically. Adding a position IS the intent to reopen; making the
 * administrator also remember to change the status would be a trap.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Plus, Loader2, Briefcase, MapPin, X, CheckCircle, Edit3, Users, Calendar, PhilippinePeso, Accessibility, GraduationCap, ImagePlus, Trash2, ImageOff } from 'lucide-react';
import API from '../api';
import { useNotification } from '../context/NotificationContext';
import useJobFilters from './jobs/useJobFilters';
import Pagination from './common/Pagination';
import useClientPagination from '../hooks/useClientPagination';
import JobFilterBar from './jobs/JobFilterBar';
import { PRESET_CATEGORIES } from './jobs/JobQuestionsEditor';
import { Skeleton, SkeletonJobCard } from './Skeleton';
import useMultiSelect from './jobs/useMultiSelect';
import { SelectCheckbox } from './jobs/SelectionBar';
import { BulkActionBar } from './common/AdminUI';
import EmptyState from './common/EmptyState';
import Reveal from './common/Reveal';

// Statuses a PESO admin may set directly in bulk. 'Filled' is excluded — it is
// set only by the referral-approval transaction when the last slot is consumed.
const BULK_JOB_STATUSES = ['Open', 'Published', 'Draft', 'Closed'];

const getAuthConfig = () => {
	const token = sessionStorage.getItem('jobTrackerToken');
	return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

// Featured images are served from /uploads on the API host (outside the /api prefix).
const FILE_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');
const resolveJobImage = (src) => (src ? (src.startsWith('http') ? src : `${FILE_BASE}${src}`) : null);

const initialJobState = {
	title: '', company: 'Kabankalan City PESO Office', company_email: '', department: '', category: '', location: 'Kabankalan City',
	job_type: 'Full-Time', work_setup: 'On-site', status: 'Draft', positions_available: 1,
	salary_range: '', deadline: '', education: '', experience: '', skills: '', qualifications: '',
	gender: 'Any', description: '', accessibility_accommodations: ''
};

// Mirrors the server rule (pesoAdminRoutes.validateCompanyEmail): required before a
// vacancy goes live (Open/Published), optional for a Draft; validated if present.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PesoAdminDashboard = () => {
	const { notify, confirm } = useNotification();
	const [jobs, setJobs] = useState([]);
	const [loading, setLoading] = useState(true);

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingId, setEditingId] = useState(null);
	const [jobData, setJobData] = useState(initialJobState);
	const [isSaving, setIsSaving] = useState(false);


	// Discovery over the managed-listings grid. The search dropdown (recent / suggested
	// / results / quick filters) is owned by JobFilterBar via the 'job-manager' namespace.
	const jf = useJobFilters(jobs);
	// Client-side pagination over the admin's own (filtered) postings — same pager UX.
	const pager = useClientPagination(jf.filtered);

	// Bulk status changes across the (filtered) grid — close/archive/publish
	// several vacancies at once instead of editing each. Owner-scoping is enforced
	// server-side; the ids here only ever narrow to what is on screen.
	const ms = useMultiSelect(jf.filtered.map(j => j.id));
	const [bulkStatus, setBulkStatus] = useState('');
	const [bulkBusy, setBulkBusy] = useState(false);

	const applyBulkStatus = async () => {
		if (!bulkStatus || ms.count === 0) return;
		setBulkBusy(true);
		const ids = ms.ids;
		try {
			const res = await API.put('/peso-admin/jobs/bulk/status', { jobIds: ids, status: bulkStatus }, getAuthConfig());
			notify.success('Vacancies Updated', res.data?.message || `${ids.length} vacancy(ies) updated.`);
			ms.clear();
			setBulkStatus('');
			fetchJobs();
		} catch (error) {
			notify.error('Bulk Update Failed', error.response?.data?.message || 'Could not update the selected vacancies.');
		} finally {
			setBulkBusy(false);
		}
	};

	// Featured image (modal) state.
	const [existingImage, setExistingImage] = useState(null); // path already saved on the job
	const [imageFile, setImageFile] = useState(null);          // newly picked File
	const [imagePreview, setImagePreview] = useState(null);    // object URL for imageFile
	const [removeExisting, setRemoveExisting] = useState(false);
	const fileInputRef = useRef(null);

	useEffect(() => {
		fetchJobs();
	}, []);

	const fetchJobs = async () => {
		try {
			const response = await API.get('/peso-admin/jobs', getAuthConfig());
			const jobsArray = Array.isArray(response.data) ? response.data : (response.data?.data || []);
			setJobs(jobsArray);
		} catch (error) {
			notify.error('Error', 'Failed to load published jobs.');
			setJobs([]);
		} finally {
			setLoading(false);
		}
	};

	const resetImageState = () => {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setExistingImage(null);
		setImageFile(null);
		setImagePreview(null);
		setRemoveExisting(false);
	};

	const closeModal = () => {
		setIsModalOpen(false);
		resetImageState();
	};

	const handleOpenAdd = () => {
		resetImageState();
		setEditingId(null);
		setJobData(initialJobState);
		setIsModalOpen(true);
	};

	const handleOpenEdit = async (job) => {
		resetImageState();
		setEditingId(job.id);
		const sanitizedJob = Object.keys(initialJobState).reduce((acc, key) => {
			acc[key] = job[key] ?? initialJobState[key];
			return acc;
		}, {});
		if (sanitizedJob.deadline) {
			sanitizedJob.deadline = new Date(sanitizedJob.deadline).toISOString().split('T')[0];
		}
		setJobData(sanitizedJob);
		setExistingImage(job.featured_image || null);
		setIsModalOpen(true);
	};

	const handleImageSelect = (e) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			notify.warning('Invalid File', 'Please choose a JPG, PNG, or WEBP image.');
			return;
		}
		if (file.size > 8 * 1024 * 1024) {
			notify.warning('File Too Large', 'The featured image must be under 8MB.');
			return;
		}
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setImageFile(file);
		setImagePreview(URL.createObjectURL(file));
		setRemoveExisting(false);
	};

	const clearImage = () => {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setImageFile(null);
		setImagePreview(null);
		if (existingImage) setRemoveExisting(true);
	};

	// Uploads the image for a given job id. Isolated so a failure here never
	// masks a successful job save -- the posting persists either way.
	const syncJobImage = async (jobId) => {
		if (imageFile) {
			const form = new FormData();
			form.append('image', imageFile);
			await API.post(`/peso-admin/jobs/${jobId}/image`, form, {
				...getAuthConfig(),
				headers: { ...getAuthConfig().headers, 'Content-Type': 'multipart/form-data' }
			});
		} else if (removeExisting && existingImage) {
			await API.delete(`/peso-admin/jobs/${jobId}/image`, getAuthConfig());
		}
	};

	const handleSubmit = async (e) => {
		e.preventDefault();

		// Employer email guard — mirrors the server. Required before a vacancy goes
		// live (it is where the referral notification is delivered); optional for a
		// Draft; validated if present.
		const email = (jobData.company_email || '').trim();
		const goingLive = ['Open', 'Published'].includes(jobData.status);
		if (email && !EMAIL_RE.test(email)) {
			notify.error('Invalid email', 'Please enter a valid employer email address.');
			return;
		}
		if (goingLive && !email) {
			notify.error('Employer email required', 'Add the employer email before publishing — it is where the referral notification is sent.');
			return;
		}

		// R1 — similarity-based duplicate guard for NEW live postings. Ask the server to
		// classify the draft against this admin's own open postings; an Exact/High match
		// gets a confirm dialog BEFORE publishing (so an accidental duplicate is caught),
		// a Possible match just warns after. Legitimate reposts proceed on confirm. The
		// check is best-effort — if it errors, we fall through and create as normal (0.1).
		if (!editingId && ['Open', 'Published'].includes(jobData.status)) {
			try {
				const check = await API.post('/peso-admin/jobs/duplicate-check', {
					title: jobData.title, company: jobData.company, location: jobData.location,
					job_type: jobData.job_type, status: jobData.status,
				}, getAuthConfig());
				const a = check.data?.data;
				if (a?.level === 'Exact Duplicate' || a?.level === 'High Similarity') {
					const proceed = await confirm(
						a.level === 'Exact Duplicate' ? 'Identical posting already exists' : 'Very similar posting exists',
						`${a.message}\n\nDo you want to publish this as a separate vacancy anyway?`
					);
					if (!proceed) return; // administrator chose to edit the existing one instead
				}
			} catch (dupErr) { /* non-blocking: fall through and create */ }
		}

		setIsSaving(true);
		try {
			let jobId = editingId;
			let dupWarning = null;
			if (editingId) {
				await API.put(`/peso-admin/jobs/${editingId}`, jobData, getAuthConfig());
			} else {
				const res = await API.post('/peso-admin/jobs', jobData, getAuthConfig());
				jobId = res.data?.job_id;
				// Only surface the post-create toast for a POSSIBLE match; Exact/High were
				// already confirmed in the dialog above, so re-warning would be noise.
				dupWarning = res.data?.duplicateAssessment?.level === 'Possible Duplicate'
					? res.data?.duplicateWarning : null;
			}

			// Image is a secondary concern: try it, but do not fail the save if it errors.
			let imageWarning = false;
			try {
				if (jobId) await syncJobImage(jobId);
			} catch (imgError) {
				imageWarning = true;
			}

			if (imageWarning) {
				notify.warning('Saved (Image Pending)', 'The job was saved, but the featured image could not be uploaded. Try again from Edit.');
			} else {
				notify.success(editingId ? 'Record Updated' : 'Job Created', editingId ? 'Job posting updated successfully.' : 'New job posting has been saved to the system.');
			}

			// R1: a same-titled open posting already exists. Non-blocking heads-up so
			// the admin can decide whether this is a real second vacancy or a duplicate.
			if (dupWarning) {
				notify.warning('Possible duplicate posting', dupWarning);
			}

			closeModal();
			fetchJobs();
		} catch (error) {
			notify.error('Save Failed', error.response?.data?.message || 'An error occurred while saving the job.');
		} finally {
			setIsSaving(false);
		}
	};

	// Preview shown inside the modal image control.
	const modalImagePreview = imagePreview
		? imagePreview
		: (existingImage && !removeExisting ? resolveJobImage(existingImage) : null);

	// Skeletons rather than a full-page spinner: the grid's shape is known before
	// the data arrives, so showing it reads as "almost here" instead of "blank",
	// and nothing shifts when the real cards land (no CLS). Same treatment the
	// seeker dashboard and the operational dashboard already use.
	if (loading) {
		return (
			<div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in">
				<div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
					<div className="space-y-2">
						<Skeleton className="h-9 w-72" />
						<Skeleton className="h-4 w-96 max-w-full" />
					</div>
					<Skeleton className="h-11 w-44 rounded-xl" />
				</div>
				<div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))]">
					{Array.from({ length: 6 }).map((_, i) => <SkeletonJobCard key={i} />)}
				</div>
			</div>
		);
	}

	return (
		<div className="p-3 sm:p-5 lg:p-6 w-full max-w-7xl mx-auto min-h-screen animate-fade-scale-in relative">

			{/* Matches the Public Job Board: clean neutral surfaces with a single
			    Deep Green #4F7942 accent (5.07:1 on white) — no gradients. */}
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3 relative z-10">
				<div>
					<h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-content tracking-tight">
						Job Publication Manager
					</h1>
					<p className="text-muted mt-1 font-medium text-sm">Create, publish, and track community employment initiatives.</p>
				</div>
				<button
					onClick={handleOpenAdd}
					className="px-4 sm:px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-sm rounded-xl shadow-sm flex items-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
				>
					<Plus size={18} /> Create Job Posting
				</button>
			</div>

			{/* z-30 lifts this row (and its Filters popover) above the job grid
			    below — also a positioned z-10 sibling — so the popover is no longer
			    painted over at equal z-index. */}
			{jobs.length > 0 && (
				<JobFilterBar filters={jf} showStatus variant="radiant" resultCount={jf.activeCount > 0 ? jf.filtered.length : null} className="mb-8 relative z-30" searchNamespace="job-manager" searchPlaceholder="Search your vacancies…" />
			)}

			{ms.selectMode && (
				<div className="relative z-30">
					<BulkActionBar
						count={ms.count}
						nouns={{ singular: 'vacancy', plural: 'vacancies' }}
						allSelected={ms.allSelected}
						onToggleAll={ms.toggleAll}
						onCancel={ms.clear}
						busy={bulkBusy}
					>
						<select
							value={bulkStatus}
							onChange={(e) => setBulkStatus(e.target.value)}
							disabled={bulkBusy}
							aria-label="Bulk status to apply"
							className="px-3 py-1.5 rounded-xl text-xs font-bold bg-surface border border-line outline-none focus:ring-2 focus:ring-accent/40 text-content cursor-pointer"
						>
							<option value="">Set status…</option>
							{BULK_JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
						</select>
						<button
							type="button"
							onClick={applyBulkStatus}
							disabled={bulkBusy || !bulkStatus}
							className="px-3.5 py-1.5 rounded-xl bg-accent text-accent-contrast text-xs font-black shadow-sm transition-colors disabled:opacity-50"
						>
							Apply
						</button>
					</BulkActionBar>
				</div>
			)}

			{jobs.length > 0 && jf.filtered.length === 0 && (
				<div className="relative z-10 mb-6">
					<EmptyState
						variant="search"
						title={jf.state.search ? `No listings match “${jf.state.search}”` : 'No listings match your filters'}
						description="None of your postings match the current search, status, or category. Try a different keyword from the search box or clear the filters to see all of your vacancies."
						primaryAction={{ label: 'Clear filters', onClick: jf.reset }}
					/>
				</div>
			)}

			{/* Published jobs — same fluid grid as the Public Job Board:
			    auto-fill/minmax picks the column count, auto-rows-fr equalises
			    card heights per row regardless of content length. */}
			{jf.filtered.length > 0 && (
				<Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} position="top" />
			)}

			<div className="grid gap-4 sm:gap-5 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] relative z-10">
				{pager.pageItems.map((job, i) => {
					const img = resolveJobImage(job.featured_image);
					return (
						<Reveal key={job.id} className="h-full" delay={Math.min(i * 40, 320)}>
						<div className={`h-full bg-surface/80 rounded-3xl shadow-[0_2px_10px_rgba(15,23,42,0.05)] border transition-all duration-300 ease-out group relative flex flex-col overflow-hidden ${ms.isSelected(job.id) ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] hover:-translate-y-1 hover:border-accent/35'}`}>
							{/* Media band */}
							<div className="relative h-36 w-full shrink-0 overflow-hidden bg-sunken">
								{/* Placeholder sits behind; the image hides itself on error (dead legacy
								    /uploads asset whose file was wiped) to reveal it — never a broken icon. */}
								<div className="absolute inset-0 flex items-center justify-center bg-sunken">
									<span className="text-accent-text/70 dark:text-accent-text/70 font-black text-4xl">{(job.company || 'J').charAt(0).toUpperCase()}</span>
								</div>
								{img && (
									<img src={img} alt={job.title} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="relative w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
								)}
								{/* Multi-select checkbox. Its own top-left corner; the status
								    ribbon moved to the bottom to make room. */}
								<div className="absolute top-3 left-3 z-10">
									<SelectCheckbox
										checked={ms.isSelected(job.id)}
										selectMode={ms.selectMode}
										onToggle={() => (ms.selectMode ? ms.toggle(job.id) : ms.enterWith(job.id))}
									/>
								</div>
								<span className={`absolute bottom-3 left-3 px-3 py-1 rounded-full text-xs font-bold shadow-sm backdrop-blur-sm
									${job.status === 'Open' ? 'bg-emerald-500/90 text-white'
									: job.status === 'Published' ? 'bg-indigo-500/90 text-white'
									: job.status === 'Draft' ? 'bg-amber-500/90 text-white'
									: job.status === 'Filled' ? 'bg-sky-600/90 text-white'
									: 'bg-surface/70 text-gray-100'}`}>
									{job.status === 'Filled' ? 'Filled — all positions referred' : job.status}
								</span>
								<button onClick={() => handleOpenEdit(job)} className="absolute top-3 right-3 p-2 text-accent-text bg-surface/95 hover:bg-white rounded-xl transition-all hover:scale-105 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" title="Edit posting & image" aria-label="Edit posting">
									<Edit3 size={16} />
								</button>
							</div>

							{/* Body */}
							<div className="p-4 sm:p-5 flex flex-col flex-1 min-h-0">
								<h3 className="text-base sm:text-lg font-black text-content mb-1 leading-snug line-clamp-2">{job.title}</h3>
								<p className="text-sm font-semibold text-muted mb-3 line-clamp-1">{job.department || job.company}</p>

								<div className="space-y-2 mb-4 text-sm font-medium text-muted">
									<p className="flex items-center gap-2"><MapPin size={14} className="text-accent-text shrink-0" /> <span className="line-clamp-1">{job.location}</span></p>
									<p className="flex items-center gap-2"><Briefcase size={14} className="text-accent-text shrink-0" /> <span className="line-clamp-1">{job.work_setup} • {job.job_type}</span></p>
									<p className="flex items-center gap-2 flex-wrap">
										<Users size={14} className="text-accent-text shrink-0" />
										{job.positions_available == null ? (
											<>{Number(job.referred_count) || 0} referred · Multiple / Not specified</>
										) : (
											<>
												{Number(job.referred_count) || 0}/{Number(job.positions_available) || 1} position{(Number(job.positions_available) || 1) === 1 ? '' : 's'} referred
												{(Number(job.referred_count) || 0) >= (Number(job.positions_available) || 1) && (
													<span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-900/85 text-white">FULL</span>
												)}
											</>
										)}
									</p>
									{job.deadline && <p className="flex items-center gap-2"><Calendar size={14} className="text-accent-text shrink-0" /> Deadline: {new Date(job.deadline).toLocaleDateString()}</p>}
								</div>

								<div className="mt-auto pt-4 border-t border-line/50 flex justify-between items-center text-xs text-muted">
									<span>Posted {new Date(job.created_at).toLocaleDateString()}</span>
									{job.accessibility_accommodations && <Accessibility size={16} className="text-accent-text" title="Accessibility accommodations provided" />}
								</div>
							</div>
						</div>
						</Reveal>
					);
				})}

				{jobs.length === 0 && (
					<EmptyState
						className="col-span-full"
						icon={Briefcase}
						title="No vacancies published yet"
						description="This is where you author and manage job postings for PESO Kabankalan. Create your first vacancy to open it to job seekers on the Public Job Board — you can set positions and requirements, then publish when it's ready."
						primaryAction={{ label: 'Create Job Posting', onClick: handleOpenAdd, icon: <Plus size={16} /> }}
					/>
				)}
			</div>

			{jf.filtered.length > 0 && (
				<Pagination page={pager.page} limit={pager.limit} total={pager.total} onPage={pager.setPage} onLimitChange={pager.onLimitChange} />
			)}

			{isModalOpen && createPortal(
				<div
					className="fixed inset-0 bg-gray-900/60 dark:bg-black/80 backdrop-blur-md z-[40] flex items-center justify-center p-4 animate-in fade-in duration-300 cursor-pointer"
					onClick={closeModal}
				>
					<div
						className="w-full max-w-3xl bg-surface/95 dark:bg-[#0f172a]/95 backdrop-blur-3xl border border-white/60 dark:border-line rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 transition-all duration-500 cursor-default"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="p-4 sm:p-5 border-b border-white/40 dark:border-line/50 flex justify-between items-center bg-surface/40 dark:bg-surface/40 backdrop-blur-md gap-3">
							<div className="min-w-0">
								<h2 className="text-lg sm:text-xl font-black text-content truncate">
									{editingId ? 'Edit Job Posting' : 'Create Job Posting'}
								</h2>
								<p className="text-xs sm:text-sm text-muted mt-0.5 font-medium line-clamp-1">Define role requirements, logistics, imagery, and PWD accommodations.</p>
							</div>
							<button onClick={closeModal} aria-label="Close" className="p-2 shrink-0 text-subtle hover:text-content dark:hover:text-white hover:bg-surface/50 dark:hover:bg-raised/50 rounded-full transition-colors"><X size={20} /></button>
						</div>

						<div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 bg-transparent">
							<form id="pesoAdminJobForm" onSubmit={handleSubmit} className="space-y-6">

								{/* Featured image */}
								<section>
									<h3 className="text-base sm:text-lg font-bold text-content mb-3 sm:mb-4 flex items-center gap-2">
										<ImagePlus size={18} className="text-indigo-500" /> Featured Image <span className="text-subtle text-sm font-medium">(shown on the job board)</span>
									</h3>
									<input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
									<div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-2xl bg-surface/50 dark:bg-gray-900/50 border border-white/40 dark:border-line">
										<div className="w-full sm:w-56 h-32 shrink-0 rounded-2xl overflow-hidden border border-line bg-sunken flex items-center justify-center">
											{modalImagePreview ? (
												<img src={modalImagePreview} alt="Featured preview" className="w-full h-full object-cover" />
											) : (
												<div className="text-center text-subtle">
													<ImageOff size={28} className="mx-auto mb-1" />
													<span className="text-xs font-medium">No image</span>
												</div>
											)}
										</div>
										<div className="flex-1 text-center sm:text-left">
											<p className="text-xs text-muted mb-3">A wide (16:9) banner works best. JPG, PNG, or WEBP up to 8MB.</p>
											<div className="flex flex-wrap gap-2 justify-center sm:justify-start">
												<button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5">
													<ImagePlus size={14} /> {modalImagePreview ? 'Replace' : 'Upload'}
												</button>
												{modalImagePreview && (
													<button type="button" onClick={clearImage} className="px-4 py-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5">
														<Trash2 size={14} /> Remove
													</button>
												)}
											</div>
										</div>
									</div>
								</section>

								<hr className="border-white/30 dark:border-line/50" />

								<section>
									<h3 className="text-base sm:text-lg font-bold text-content mb-3 sm:mb-4 flex items-center gap-2">
										<Briefcase size={18} className="text-indigo-500" /> Core Information
									</h3>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
										<div className="space-y-1.5 md:col-span-2">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Job Title *</label>
											<input required type="text" placeholder="e.g., Senior Accessibility Consultant" value={jobData.title || ''} onChange={e => setJobData({ ...jobData, title: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Organization / Company *</label>
											<input required type="text" value={jobData.company || ''} onChange={e => setJobData({ ...jobData, company: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">
												Employer Email {['Open', 'Published'].includes(jobData.status)
													? <span className="text-accent-text">*</span>
													: <span className="text-subtle normal-case font-medium">(required to publish)</span>}
											</label>
											<input
												type="email"
												required={['Open', 'Published'].includes(jobData.status)}
												placeholder="e.g., hr@company.com"
												value={jobData.company_email || ''}
												onChange={e => setJobData({ ...jobData, company_email: e.target.value })}
												className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm"
											/>
											<p className="text-[11px] text-subtle font-medium">Where the referral notification is delivered when a candidate is referred.</p>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Category <span className="text-subtle normal-case font-medium">(groups the job on the board)</span></label>
											<input list="peso-category-options" placeholder="e.g., Tech, Healthcare, Administration" value={jobData.category || ''} onChange={e => setJobData({ ...jobData, category: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
											<datalist id="peso-category-options">
												{PRESET_CATEGORIES.map(c => <option key={c} value={c} />)}
											</datalist>
										</div>
										<div className="space-y-1.5 md:col-span-2">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Job Status *</label>
											<select aria-label="Job posting status" value={jobData.status || 'Draft'} onChange={e => setJobData({ ...jobData, status: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none cursor-pointer font-bold text-muted transition-all shadow-sm">
												<option value="Draft">Draft (Hidden from Public)</option>
												<option value="Open">Open (Visible & Accepting Applications)</option>
												<option value="Published">Published (Promoted on Board)</option>
												<option value="Closed">Closed (No longer accepting applications)</option>
												<option value="Filled">Filled (All positions referred — set automatically)</option>
											</select>
										</div>
									</div>
								</section>

								<hr className="border-white/30 dark:border-line/50" />

								<section>
									<h3 className="text-base sm:text-lg font-bold text-content mb-3 sm:mb-4 flex items-center gap-2">
										<Building2 size={18} className="text-emerald-500" /> Logistics & Compensation
									</h3>
									<div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Employment Type</label>
											<select aria-label="Job type" value={jobData.job_type || 'Full-Time'} onChange={e => setJobData({ ...jobData, job_type: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none cursor-pointer font-bold text-muted transition-all shadow-sm">
												<option value="Full-Time">Full-Time</option>
												<option value="Part-Time">Part-Time</option>
												<option value="Contract">Contract</option>
												<option value="Internship">Internship</option>
											</select>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Location *</label>
											<input required type="text" value={jobData.location || ''} onChange={e => setJobData({ ...jobData, location: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>

										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Salary Range</label>
											<div className="relative">
												<PhilippinePeso size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
												<input type="text" placeholder="e.g., ₱15,000 - ₱25,000 / month" value={jobData.salary_range || ''} onChange={e => setJobData({ ...jobData, salary_range: e.target.value })} className="w-full pl-9 pr-3 py-2.5 sm:py-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
											</div>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Positions Available</label>
											<div className="relative">
												<Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
												<input type="number" min="1" value={jobData.positions_available == null ? '' : jobData.positions_available} disabled={jobData.positions_available == null} placeholder="e.g., 3" onChange={e => setJobData({ ...jobData, positions_available: e.target.value })} className="w-full pl-9 pr-3 py-2.5 sm:py-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed" />
											</div>
											<label className="flex items-center gap-2 text-xs font-medium text-muted cursor-pointer select-none">
												<input type="checkbox" checked={jobData.positions_available == null} onChange={e => setJobData({ ...jobData, positions_available: e.target.checked ? null : 1 })} className="w-4 h-4 rounded accent-accent" />
												Multiple / number not specified
											</label>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Application Deadline</label>
											<input type="date" value={jobData.deadline || ''} onChange={e => setJobData({ ...jobData, deadline: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
									</div>
								</section>

								<hr className="border-white/30 dark:border-line/50" />

								<section>
									<h3 className="text-base sm:text-lg font-bold text-content mb-3 sm:mb-4 flex items-center gap-2">
										<GraduationCap size={18} className="text-blue-500" /> Requirements & Qualifications
									</h3>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Educational Requirements</label>
											<input type="text" placeholder="e.g., Bachelor's Degree in IT" value={jobData.education || ''} onChange={e => setJobData({ ...jobData, education: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Work Experience</label>
											<input type="text" placeholder="e.g., 2+ Years in customer service" value={jobData.experience || ''} onChange={e => setJobData({ ...jobData, experience: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
										<div className="space-y-1.5 md:col-span-2">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Gender Preference <span className="text-subtle normal-case font-medium">(only if the accredited employer specifies one)</span></label>
											<select aria-label="Gender preference" value={jobData.gender || 'Any'} onChange={e => setJobData({ ...jobData, gender: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none cursor-pointer font-bold text-muted transition-all shadow-sm">
												<option value="Any">Any / No preference</option>
												<option value="Male">Male</option>
												<option value="Female">Female</option>
											</select>
										</div>
										<div className="space-y-1.5 md:col-span-2">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Required Skills & Competencies</label>
											<input type="text" placeholder="e.g., Microsoft Office, Data Entry, Communication" value={jobData.skills || ''} onChange={e => setJobData({ ...jobData, skills: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content transition-all shadow-sm" />
										</div>
										<div className="space-y-1.5 md:col-span-2">
											<label className="text-xs font-bold text-muted uppercase tracking-wide">Additional Qualifications</label>
											<textarea placeholder="List any certifications, licenses, or specific traits needed..." value={jobData.qualifications || ''} onChange={e => setJobData({ ...jobData, qualifications: e.target.value })} className="w-full p-2.5 sm:p-3 rounded-lg text-sm bg-surface/50 dark:bg-gray-900/50 backdrop-blur-sm border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/50 font-medium text-content min-h-[70px] transition-all shadow-sm"></textarea>
										</div>
									</div>
								</section>

							</form>
						</div>

						<div className="p-4 sm:p-5 border-t border-white/40 dark:border-line/50 flex gap-3 bg-surface/40 dark:bg-surface/40 backdrop-blur-md">
							<button type="button" onClick={closeModal} className="flex-1 py-2.5 sm:py-3 font-bold text-sm text-content bg-surface/50 backdrop-blur-sm border border-line rounded-xl shadow-sm hover:bg-surface/80 dark:hover:bg-raised/80 transition-all">Cancel</button>
							<button type="submit" form="pesoAdminJobForm" disabled={isSaving} className="flex-1 py-2.5 sm:py-3 font-bold text-sm text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg shadow-accent/30 flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:-translate-y-0.5">
								{isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
								{editingId ? 'Save Changes' : 'Publish Job Posting'}
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
};

export default PesoAdminDashboard;