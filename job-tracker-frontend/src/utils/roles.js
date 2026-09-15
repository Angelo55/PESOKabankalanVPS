export const ROLE_KEYS = {
    JOB_SEEKER: 'applicant',
    PESO_ADMINISTRATOR: 'peso_administrator',
    PESO_STAFF: 'peso_staff',
    SUPER_ADMINISTRATOR: 'admin'
};

export const ROLE_LABELS = {
    [ROLE_KEYS.JOB_SEEKER]: 'Job Seeker',
    [ROLE_KEYS.PESO_ADMINISTRATOR]: 'PESO Administrator',
    [ROLE_KEYS.PESO_STAFF]: 'PESO Staff',
    [ROLE_KEYS.SUPER_ADMINISTRATOR]: 'Super Administrator'
};

// Mirror of middleware/rbac.js normalizeRole — the two MUST agree. PESO Staff is a
// distinct, more-restricted PESO role (Job Publication Manager only). Checked
// BEFORE peso_administrator so its own spellings don't fall through to the Manager.
export const normalizeRole = (role) => {
    const key = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['peso_staff', 'job_publication_staff', 'publication_staff'].includes(key)) return ROLE_KEYS.PESO_STAFF;
    if (['peso_administrator', 'peso_admin', 'employer'].includes(key)) return ROLE_KEYS.PESO_ADMINISTRATOR;
    if (['super_administrator', 'super_admin', 'admin'].includes(key)) return ROLE_KEYS.SUPER_ADMINISTRATOR;
    return ROLE_KEYS.JOB_SEEKER;
};

export const getRoleLabel = (role) => ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS[ROLE_KEYS.JOB_SEEKER];

export const getRolePortalLabel = (role) => {
    const normalized = normalizeRole(role);
    if (normalized === ROLE_KEYS.SUPER_ADMINISTRATOR) return 'Super Administrator Portal';
    if (normalized === ROLE_KEYS.PESO_ADMINISTRATOR) return 'PESO Administrator Portal';
    if (normalized === ROLE_KEYS.PESO_STAFF) return 'PESO Staff Portal';
    return 'Job Seeker Portal';
};
