-- 001_initial_schema.sql
-- Creates every table for the church website and seeds church_info + default admin.
-- Run inside a BEGIN/COMMIT transaction by db/migrate.js.

-- Needed for gen_random_uuid() on the pending_edits table.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Sermons (table name: services) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  date          DATE NOT NULL,
  pastor        VARCHAR(100) NOT NULL,
  description   TEXT,
  youtube_id    VARCHAR(11) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Events ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  date          DATE NOT NULL,
  time          TIME,
  location      VARCHAR(200),
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Ministries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ministries (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  leader        VARCHAR(100),
  contact_email VARCHAR(200),
  image_url     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Staff ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  title         VARCHAR(100),
  bio           TEXT,
  image_url     TEXT,
  display_order INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Announcements ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id            SERIAL PRIMARY KEY,
  message       VARCHAR(500) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT false,
  expiry_utc    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Church info (single row) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_info (
  id               SERIAL PRIMARY KEY,
  church_name      VARCHAR(200),
  tagline          VARCHAR(200),
  about            TEXT,
  mission_statement TEXT,
  address          TEXT,
  phone            VARCHAR(50),
  email            VARCHAR(200),
  service_times    TEXT,
  timezone         VARCHAR(100) DEFAULT 'America/New_York',
  maps_embed_url   TEXT,
  giving_embed_url TEXT,
  give_intro       TEXT,
  hero_cta_label   VARCHAR(50) DEFAULT 'Watch Latest Sermon',
  logo_url         TEXT,
  favicon_url      TEXT
);

-- ── Admins ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(50) UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'editor')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Backups ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  payload    JSONB NOT NULL,
  email_sent BOOLEAN DEFAULT false
);

-- ── Pending edits (optimistic-concurrency conflict staging) ─────────────────
CREATE TABLE IF NOT EXISTS pending_edits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name     VARCHAR(50) NOT NULL,
  record_id      INTEGER NOT NULL,
  submitted_data JSONB NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Migrations tracking ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
