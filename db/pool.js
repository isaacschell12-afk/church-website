'use strict';

const { Pool, types } = require('pg');

// Keep DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead of JS Date
// objects, so rendered dates never shift by a day due to timezone conversion.
types.setTypeParser(1082, (v) => v);

// Railway (and other hosted) PostgreSQL requires SSL or connections fail. A
// local Postgres normally has no SSL, so auto-disable it for localhost — this
// keeps hosted behavior identical while allowing `npm run migrate`/`npm start`
// to work against a local database during development.
function sslConfig() {
  if (process.env.PGSSL === 'disable') return false;
  const url = process.env.DATABASE_URL || '';
  if (/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
});

pool.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Unexpected idle pg client error:`, err);
});

module.exports = pool;
