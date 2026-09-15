-- Migration: 007_rename_employer_profiles
-- Standardizes the PESO Admin organization-profile table name.
-- FK leaf (references users only); no child FK rebuild required.
-- Idempotency: the runner records applied files in schema_migrations and skips
-- them, so this executes exactly once. If the table was renamed manually before
-- this ran, record it instead with: npm run migrate:baseline.

RENAME TABLE employer_profiles TO pesoadmin_profiles;