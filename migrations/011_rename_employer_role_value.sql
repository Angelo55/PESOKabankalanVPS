-- Standardizes the stored PESO Administrator role value. 'employer' remains an
-- accepted alias in normalizeRole (rbac.js / roles.js), so existing JWTs and any
-- un-migrated rows keep resolving correctly.
UPDATE users SET role = 'peso_administrator' WHERE role = 'employer';