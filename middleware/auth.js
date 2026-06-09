'use strict';

const jwt = require('jsonwebtoken');

// Reads the httpOnly auth cookie, verifies the JWT, and attaches
// { id, username, role } to req.user. On any failure redirects to /admin/login.
module.exports = function auth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.redirect('/admin/login');
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
    };
    res.locals.user = req.user;
    return next();
  } catch (err) {
    return res.redirect('/admin/login');
  }
};
