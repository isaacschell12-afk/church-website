'use strict';

const pool = require('./pool');

// Fire-and-forget audit trail. A failed log write must never break the admin
// action it describes, so errors are logged and swallowed.
module.exports = function logActivity(username, action, entity, label, recordId) {
  pool
    .query(
      'INSERT INTO activity_log (username, action, entity, label, record_id) VALUES ($1, $2, $3, $4, $5)',
      [
        String(username || 'unknown').slice(0, 50),
        action,
        entity,
        String(label || '').slice(0, 300),
        Number.isInteger(recordId) ? recordId : null,
      ]
    )
    .catch((err) => {
      console.error(
        `[${new Date().toISOString()}] activity log write failed:`,
        err && err.message ? err.message : err
      );
    });
};
