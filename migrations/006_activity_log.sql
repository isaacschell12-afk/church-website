-- Audit trail of admin actions, shown on the dashboard. Rows older than 90
-- days are pruned at server startup (see server.js).
CREATE TABLE IF NOT EXISTS activity_log (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50)  NOT NULL,
  action     VARCHAR(20)  NOT NULL,
  entity     VARCHAR(50)  NOT NULL,
  label      VARCHAR(300),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created
  ON activity_log (created_at DESC, id DESC);
