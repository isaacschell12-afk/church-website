'use strict';

// Standalone backup restorer — the recovery half of /admin/backup.
//
//   node db/restore.js --latest --yes            restore the newest backup row
//   node db/restore.js backup.json --yes         restore from an emailed JSON file
//   node db/restore.js --latest                  dry run: show what WOULD be restored
//
// Replaces the CONTENT tables (services, events, ministries, staff,
// sunday_school_classes, announcements, church_info) inside one transaction.
// Never touches admins, contact_messages, backups, or pending_edits — admin
// accounts and the backup history survive a restore.

require('dotenv').config();

const fs = require('fs');
const pool = require('./pool');

const CONTENT_TABLES = [
  'church_info',
  'services',
  'events',
  'ministries',
  'staff',
  'sunday_school_classes',
  'announcements',
];

function stamp() {
  return new Date().toISOString();
}

function fail(msg) {
  console.error(`[${stamp()}] ERROR: ${msg}`);
  process.exit(1);
}

async function loadPayload(args) {
  if (args.includes('--latest')) {
    const { rows } = await pool.query(
      'SELECT id, created_at, payload FROM backups ORDER BY id DESC LIMIT 1'
    );
    if (rows.length === 0) fail('no backups found in the backups table');
    console.log(
      `[${stamp()}] using backup #${rows[0].id} from ${new Date(rows[0].created_at).toISOString()}`
    );
    return rows[0].payload;
  }

  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('pass a backup JSON file path or --latest');
  if (!fs.existsSync(file)) fail(`file not found: ${file}`);
  console.log(`[${stamp()}] using backup file ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fail(`could not parse ${file} as JSON: ${err.message}`);
  }
}

// Column lists come from the live schema, not the backup, so a backup taken
// before a later additive migration restores cleanly (missing keys -> defaults).
async function tableColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
}

async function restoreTable(client, table, rows) {
  await client.query(`DELETE FROM ${table}`);

  const columns = await tableColumns(client, table);
  let inserted = 0;
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => columns.has(k));
    if (keys.length === 0) continue;
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
      keys.map((k) => row[k])
    );
    inserted += 1;
  }

  // Re-sync the id sequence past the highest restored id.
  if (columns.has('id')) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                     COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
    );
  }
  return inserted;
}

async function main() {
  const args = process.argv.slice(2);
  const payload = await loadPayload(args);

  if (!payload || typeof payload !== 'object') fail('backup payload is not an object');
  const summary = CONTENT_TABLES.map((t) => {
    const rows = Array.isArray(payload[t]) ? payload[t] : [];
    return { table: t, rows };
  });

  console.log(`[${stamp()}] backup generated_at: ${payload.generated_at || '(unknown)'}`);
  summary.forEach(({ table, rows }) =>
    console.log(`  ${table.padEnd(22)} ${rows.length} row(s)`)
  );

  if (!args.includes('--yes')) {
    console.log(
      `\n[${stamp()}] DRY RUN — nothing changed. Re-run with --yes to replace the content tables above.`
    );
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { table, rows } of summary) {
      const inserted = await restoreTable(client, table, rows);
      console.log(`[${stamp()}] restored ${table}: ${inserted} row(s)`);
    }
    await client.query('COMMIT');
    console.log(`[${stamp()}] restore complete`);
  } catch (err) {
    await client.query('ROLLBACK');
    fail(`restore rolled back: ${err.message}`);
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`[${stamp()}] FATAL: ${err.message}`);
    process.exit(1);
  });
