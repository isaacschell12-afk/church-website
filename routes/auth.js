'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../db/pool');
const catchAsync = require('../middleware/catchAsync');

const router = express.Router();

// Dummy hash used when the username is not found so bcrypt.compare always runs,
// preventing timing-based username enumeration.
const DUMMY_HASH = '$2b$12$invalidhashfortimingnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn';

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: EIGHT_HOURS_MS,
  };
}

// 5 login attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// 3 password resets per hour per IP.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /admin/login — render the login form (no auth required)
router.get('/admin/login', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/admin/login',
    title: 'Admin Login',
  });
});

// POST /admin/login
router.post(
  '/admin/login',
  loginLimiter,
  catchAsync(async (req, res) => {
    const username = typeof req.body.username === 'string' ? req.body.username : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const result = await pool.query(
      'SELECT id, username, hashed_password, role FROM admins WHERE username = $1',
      [username]
    );
    const admin = result.rows[0];

    // Always run bcrypt.compare — against the real hash if the user exists, or the
    // dummy hash if not — so response time does not reveal whether the username exists.
    let valid = false;
    try {
      valid = await bcrypt.compare(password, admin ? admin.hashed_password : DUMMY_HASH);
    } catch (err) {
      valid = false;
    }

    if (!admin || !valid) {
      return res.redirect('/admin/login?error=1');
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('token', token, cookieOptions());
    return res.redirect('/admin');
  })
);

// POST /admin/logout
router.post('/admin/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.redirect('/admin/login');
});

// POST /admin/auth/reset-password
// Machine endpoint authenticated by the ADMIN_RESET_TOKEN env var (see README STEP 12).
// CSRF is intentionally not applied here (no browser/cookie context); the reset token
// is the authentication factor.
const resetSchema = z.object({
  resetToken: z.string().min(1),
  username: z.string().min(1).max(50),
  newPassword: z.string().min(12),
});

router.post(
  '/admin/auth/reset-password',
  resetLimiter,
  catchAsync(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const { resetToken, username, newPassword } = parsed.data;

    const expected = process.env.ADMIN_RESET_TOKEN;
    if (!expected || resetToken !== expected) {
      console.error(
        `[${new Date().toISOString()}] reset-password token mismatch for username="${username}"`
      );
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    const update = await pool.query(
      'UPDATE admins SET hashed_password = $1 WHERE username = $2 RETURNING id',
      [hashed, username]
    );

    if (update.rows.length === 0) {
      console.error(
        `[${new Date().toISOString()}] reset-password: no admin named "${username}"`
      );
      return res.status(400).json({ error: 'Unknown user' });
    }

    console.log(
      `[${new Date().toISOString()}] password reset performed for username="${username}"`
    );
    return res.status(200).json({ success: true });
  })
);

module.exports = router;
