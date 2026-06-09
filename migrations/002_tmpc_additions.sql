-- 002_tmpc_additions.sql
-- Taylor Mill Pentecostal Church (TMPC) adaptation.
-- Additive only: new church_info columns + the sunday_school_classes table.
-- Runs inside a BEGIN/COMMIT transaction via db/migrate.js.
--
-- NOTE on ordering: db/migrate.js runs migrations BEFORE seedChurchInfo(). On a
-- fresh database the church_info row does not exist yet when this runs, so the
-- UPDATE statements below affect zero rows and seedChurchInfo() (updated to the
-- TMPC values) populates the row. On an EXISTING database already seeded with
-- the old "Grace Community Church" placeholder, these UPDATEs adapt it in place.

-- ── New church_info fields (all TEXT, additive) ─────────────────────────────
ALTER TABLE church_info ADD COLUMN IF NOT EXISTS statement_of_faith     TEXT;
ALTER TABLE church_info ADD COLUMN IF NOT EXISTS visit_info             TEXT;
ALTER TABLE church_info ADD COLUMN IF NOT EXISTS sunday_school_intro    TEXT;
ALTER TABLE church_info ADD COLUMN IF NOT EXISTS sunday_school_schedule TEXT;

-- ── Sunday School classes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sunday_school_classes (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  age_group     VARCHAR(100),
  location      VARCHAR(200),
  teacher       VARCHAR(100),
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ DEFAULT NOW()
);

-- ── Branding override (existing rows only; fresh DBs handled by the seed) ────
-- Per the TMPC spec these override the generic spec defaults outright.
UPDATE church_info
   SET church_name    = 'Taylor Mill Pentecostal Church',
       tagline        = 'Come as you are — you''re welcome here.',
       hero_cta_label = 'Plan Your Visit';

-- ── Seed the four new fields with TMPC-voiced placeholders (only if NULL) ────
-- Plain text rendered with <%= and CSS white-space: pre-line, so blank lines and
-- headings show as written. Every real-world unknown is a labeled TODO — nothing
-- here is presented as fact. DO NOT treat the statement of faith below as final.
UPDATE church_info SET visit_info =
'You''re welcome here, and we''d love to meet you. Here''s what to expect when you visit.

When to arrive
[TODO: e.g. "Come about 10 minutes early so you have time to find parking and get settled."]

Parking
[TODO: where to park, and any visitor/accessible spaces.]

What to wear
Come as you are. You''ll see everything from jeans to Sunday best — what matters is that you came.

Your kids
[TODO: where children go, and where Sunday School classes meet.]

We can''t wait to welcome you in person.'
WHERE visit_info IS NULL;

UPDATE church_info SET statement_of_faith =
'What We Believe

[TODO: TMPC to supply the final wording. The headings below are a structure only —
do not treat the text under them as the church''s actual statement of faith.]

God
[TODO: our belief about God — Father, Son, and Holy Spirit.]

Scripture
[TODO: our belief about the Bible as God''s Word.]

Salvation
[TODO: our belief about salvation through Jesus Christ.]

Baptism in the Holy Spirit
[TODO: our Pentecostal belief about the baptism in the Holy Spirit.]

The Church
[TODO: our belief about the Church and life together.]'
WHERE statement_of_faith IS NULL;

UPDATE church_info SET sunday_school_intro =
'There''s a place for you in Sunday School. Whatever your age or where you are in your
walk with God, our classes are a warm, unhurried place to dig into Scripture and get to
know people. Come as you are — bring your questions.'
WHERE sunday_school_intro IS NULL;

UPDATE church_info SET sunday_school_schedule =
'[TODO: e.g. "Sunday School meets every Sunday at 10:00 AM, before our 11:00 AM worship service." Confirm times.]'
WHERE sunday_school_schedule IS NULL;
