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
  // Railway's private network (*.railway.internal) is not reachable by
  // on-path attackers, and its Postgres presents a self-signed cert with no
  // published CA, so skipping verification there is acceptable. PGSSL=no-verify
  // allows the same as an explicit opt-in elsewhere (e.g. running migrations
  // against the public proxy without a CA cert on hand).
  if (process.env.PGSSL === 'no-verify') return { rejectUnauthorized: false };
  if (/@[^/]*\.railway\.internal(:|\/)/.test(url)) return { rejectUnauthorized: false };
  // Otherwise verify the server certificate. DATABASE_CA_CERT holds the
  // provider's CA cert (PEM) when it isn't in the system trust store.
  const ssl = { rejectUnauthorized: true };
  if (process.env.DATABASE_CA_CERT) ssl.ca = process.env.DATABASE_CA_CERT;
  return ssl;
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
