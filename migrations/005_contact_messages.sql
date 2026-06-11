-- Contact form submissions, stored so messages survive email outages and are
-- readable from the admin panel (Messages inbox).
CREATE TABLE IF NOT EXISTS contact_messages (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(200) NOT NULL,
  message    TEXT NOT NULL,
  source     VARCHAR(100),
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON contact_messages (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_contact_messages_unread
  ON contact_messages (is_read) WHERE is_read = false;
