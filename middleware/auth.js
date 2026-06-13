'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// Reads the httpOnly auth cookie, verifies the JWT, then confirms the admin
// still exists and the token has not been revoked (token_version must match
// the row — it is bumped on password reset). Attaches { id, username, role }
// from the DATABASE ROW (not the token) to req.user, so role changes apply
// immediately. On any auth failure redirects to /admin/login.
module.exports = async function auth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.redirect('/admin/login');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.redirect('/admin/login');
  }

  try {
    const result = await pool.query(
      'SELECT id, username, role, token_version FROM admins WHERE id = $1',
      [payload.id]
    );
    const admin = result.rows[0];
    // Reject if the admin was deleted, or the token was issued before the
    // last token_version bump (tokens minted before this column existed have
    // no token_version claim and are rejected too).
    if (!admin || payload.token_version !== admin.token_version) {
      return res.redirect('/admin/login');
    }
    req.user = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    };
    res.locals.user = req.user;
    // Unread-messages count for the nav badge on every admin page. Advisory
    // UI only — a count failure must never block an admin action.
    try {
      const unread = await pool.query(
        'SELECT COUNT(*)::int AS c FROM contact_messages WHERE is_read = false'
      );
      res.locals.unreadMessages = unread.rows[0].c;
    } catch (err) {
      res.locals.unreadMessages = 0;
    }
    return next();
  } catch (err) {
    // Database error — not an auth failure; let the error handler respond.
    return next(err);
  }
};
