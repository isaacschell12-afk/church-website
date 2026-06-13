-- Record id on activity rows so the dashboard can link each entry straight to
-- the edit screen of whatever was touched. Nullable: logins, deletes, and
-- pre-007 rows have no record to link to.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS record_id INTEGER;
