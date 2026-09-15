import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';
import { normalizeRole, ROLE_KEYS } from '../utils/roles';

const ProtectedRoute = ({ allowedRoles }) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    // 🚨 CRITICAL FIX: Always wait for authentication loading to complete before validating routes
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-accent-soft dark:bg-gray-900">
                <Loader2 className="animate-spin text-accent-text" size={40} />
            </div>
        );
    }

    // If not logged in, gracefully redirect to Landing Page but save the attempted location
    if (!user) {
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    // Standardize role to prevent undefined mismatch
    const currentRole = normalizeRole(user.role);
    const normalizedAllowedRoles = allowedRoles?.map(normalizeRole);

    // Role-based route guard
    if (normalizedAllowedRoles && !normalizedAllowedRoles.includes(currentRole)) {
        // If an applicant tries to access an employer route (or vice versa), redirect to their authorized dashboard
        const redirectPath = currentRole === ROLE_KEYS.SUPER_ADMINISTRATOR
            ? '/admin/dashboard'
            : currentRole === ROLE_KEYS.PESO_ADMINISTRATOR
                ? '/employer/dashboard'
                : currentRole === ROLE_KEYS.PESO_STAFF
                    ? '/peso-admin/jobs'
                    : '/';
        return <Navigate to={redirectPath} replace />;
    }

    // Authorization passed, render the protected component
    return <Outlet />;
};

export default ProtectedRoute;
