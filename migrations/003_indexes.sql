-- 003_indexes.sql
-- Secondary indexes for the hot public-page queries. All were sequential scans:
--   services  ORDER BY date DESC, id DESC          (home, /sermons, admin list)
--   events    WHERE date >= ... ORDER BY date ASC  (home, /events)
--   announcements WHERE active = true AND (expiry_utc IS NULL OR expiry_utc > NOW())
--   staff / sunday_school_classes ORDER BY display_order (lists + move/neighbor queries)
-- Runs inside a BEGIN/COMMIT transaction via db/migrate.js.

CREATE INDEX IF NOT EXISTS idx_services_date          ON services (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_date            ON events (date);
CREATE INDEX IF NOT EXISTS idx_announcements_active   ON announcements (active, expiry_utc);
CREATE INDEX IF NOT EXISTS idx_staff_display_order    ON staff (display_order);
CREATE INDEX IF NOT EXISTS idx_ss_classes_display_order ON sunday_school_classes (display_order);
