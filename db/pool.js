'use strict';

const { Pool, types } = require('pg');

// Keep DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead of JS Date
// objects, so rendered dates never shift by a day due to timezone conversion.
types.setTypeParser(1082, (v) => v);

// Railway PostgreSQL requires SSL or connections fail.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Unexpected idle pg client error:`, err);
});

module.exports = pool;
