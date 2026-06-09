'use strict';

// Standalone migration runner. Safe to run repeatedly (idempotent).
//   node db/migrate.js
// Reads /migrations/*.sql sorted by filename, applies any not yet recorded in
// the migrations table inside a BEGIN/COMMIT transaction, then seeds the
// church_info row and the default superadmin if those tables are empty.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function stamp() {
  return new Date().toISOString();
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(200) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function appliedMigrations() {
  const { rows } = await pool.query('SELECT name FROM migrations');
  return new Set(rows.map((r) => r.name));
}

async function runMigrations() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = await appliedMigrations();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[${stamp()}] migration already applied: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[${stamp()}] applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(
        `\n[${stamp()}] MIGRATION FAILED: ${file}\n` +
          `PostgreSQL error: ${err.message}\n` +
          `The transaction was rolled back. Fix the migration and re-run.\n`
      );
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }
}

async function seedChurchInfo() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM church_info');
  if (rows[0].count > 0) {
    console.log(`[${stamp()}] church_info already seeded`);
    return;
  }
  // Taylor Mill Pentecostal Church (TMPC) seed for a fresh database. Real-world
  // unknowns (address, phone, email, service times, statement of faith, schedule)
  // are obvious placeholders/TODO — never presented as fact. Edit from the admin
  // dashboard under Church Info. The four TMPC fields mirror migration 002.
  await pool.query(
    `INSERT INTO church_info
      (church_name, tagline, about, mission_statement, address, phone, email,
       service_times, timezone, maps_embed_url, giving_embed_url, give_intro,
       hero_cta_label, logo_url, favicon_url,
       statement_of_faith, visit_info, sunday_school_intro, sunday_school_schedule)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19)`,
    [
      'Taylor Mill Pentecostal Church',
      "Come as you are — you're welcome here.",
      'Welcome to Taylor Mill Pentecostal Church. We are a Pentecostal family in ' +
        'Taylor Mill, Kentucky, seeking to follow Jesus together. Update this text ' +
        'from the admin dashboard under Church Info.',
      'To know God, to grow in Him, and to make Him known.',
      '[TODO: street address], Taylor Mill, KY',
      '[TODO: phone number]',
      '[TODO: office@TMPCfamily.net]',
      '[TODO: e.g. "Sunday School 10:00 AM · Worship 11:00 AM" — confirm times]',
      'America/New_York',
      '',
      '',
      'Your generosity makes our ministry possible. Thank you for giving.',
      'Plan Your Visit',
      null,
      null,
      // statement_of_faith — structure only; TMPC supplies the real wording.
      'What We Believe\n\n' +
        '[TODO: TMPC to supply the final wording. The headings below are a ' +
        'structure only — do not treat the text under them as the actual ' +
        'statement of faith.]\n\n' +
        'God\n[TODO: our belief about God — Father, Son, and Holy Spirit.]\n\n' +
        'Scripture\n[TODO: our belief about the Bible as God’s Word.]\n\n' +
        'Salvation\n[TODO: our belief about salvation through Jesus Christ.]\n\n' +
        'Baptism in the Holy Spirit\n[TODO: our Pentecostal belief about the ' +
        'baptism in the Holy Spirit.]\n\n' +
        'The Church\n[TODO: our belief about the Church and life together.]',
      // visit_info
      "You're welcome here, and we'd love to meet you. Here's what to expect when " +
        'you visit.\n\nWhen to arrive\n[TODO: e.g. "Come about 10 minutes early."]\n\n' +
        'Parking\n[TODO: where to park, and any visitor/accessible spaces.]\n\n' +
        'What to wear\nCome as you are. What matters is that you came.\n\n' +
        'Your kids\n[TODO: where children go, and where Sunday School classes meet.]\n\n' +
        "We can't wait to welcome you in person.",
      // sunday_school_intro
      "There's a place for you in Sunday School. Whatever your age or where you are " +
        'in your walk with God, our classes are a warm, unhurried place to dig into ' +
        'Scripture and get to know people. Come as you are — bring your questions.',
      // sunday_school_schedule
      '[TODO: e.g. "Sunday School meets every Sunday at 10:00 AM, before our ' +
        '11:00 AM worship service." Confirm times.]',
    ]
  );
  console.log(`[${stamp()}] seeded TMPC church_info row`);
}

async function seedDefaultAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM admins');
  if (rows[0].count > 0) {
    console.log(`[${stamp()}] admins already seeded`);
    return;
  }

  const username = process.env.DEFAULT_ADMIN_USER;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!username || !password) {
    console.error(
      `[${stamp()}] cannot seed default admin: DEFAULT_ADMIN_USER / DEFAULT_ADMIN_PASSWORD missing`
    );
    await pool.end();
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 12);
  await pool.query(
    'INSERT INTO admins (username, hashed_password, role) VALUES ($1, $2, $3)',
    [username, hashed, 'superadmin']
  );
  console.log(`[${stamp()}] seeded default superadmin: ${username}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(`[${stamp()}] DATABASE_URL is not set — cannot run migrations`);
    process.exit(1);
  }

  // Verify connectivity up front with a clear message on failure.
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(
      `[${stamp()}] could not connect to the database: ${err.message}\n` +
        `Check DATABASE_URL and that PostgreSQL is reachable.`
    );
    process.exit(1);
  }

  await ensureMigrationsTable();
  await runMigrations();
  await seedChurchInfo();
  await seedDefaultAdmin();

  await pool.end();
  console.log(`[${stamp()}] migrations complete`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`[${stamp()}] unexpected migration error:`, err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
