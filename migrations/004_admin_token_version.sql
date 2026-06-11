-- 004_admin_token_version.sql
-- Server-side session revocation for admin JWTs.
-- token_version is embedded in each JWT at login; the auth middleware rejects
-- any token whose version no longer matches the row (or whose row is gone).
-- Bumping token_version (e.g. on password reset) invalidates all previously
-- issued tokens for that admin; deleting the row invalidates them outright.
-- Runs inside a BEGIN/COMMIT transaction via db/migrate.js.

ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
