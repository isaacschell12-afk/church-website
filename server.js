'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { doubleCsrf } = require('csrf-csrf');

const pool = require('./db/pool');
const runBackup = require('./db/runBackup');
const errorHandler = require('./middleware/errorHandler');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contact');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');

// ── Environment validation (crash with the full list of problems) ───────────
// ADMIN_RESET_TOKEN is intentionally optional: per README STEP 12 it is set only
// while performing a reset and removed afterwards, so requiring it would prevent
// normal boot.
const REQUIRED_ENV = [
  'PORT',
  'DATABASE_URL',
  'JWT_SECRET',
  'CSRF_SECRET',
  'BACKUP_SECRET',
  'BACKUP_EMAIL',
  'CHURCH_CONTACT_EMAIL',
  'RESEND_API_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'DEFAULT_ADMIN_USER',
  'DEFAULT_ADMIN_PASSWORD',
];

(function validateEnv() {
  const problems = [];
  REQUIRED_ENV.forEach((key) => {
    if (!process.env[key] || String(process.env[key]).trim() === '') {
      problems.push(`Missing required environment variable: ${key}`);
    }
  });
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  if (process.env.CSRF_SECRET && process.env.CSRF_SECRET.length < 32) {
    problems.push('CSRF_SECRET must be at least 32 characters');
  }
  if (process.env.BACKUP_SECRET && process.env.BACKUP_SECRET.length < 64) {
    problems.push('BACKUP_SECRET must be at least 64 characters');
  }
  if (problems.length > 0) {
    console.error('\nEnvironment validation failed. Fix the following and restart:');
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error('');
    process.exit(1);
  }
})();

const PORT = process.env.PORT;
const isProd = process.env.NODE_ENV === 'production';

// Cache-busting token for static assets (CSS/JS links in the layout). Static
// files are served with a one-day cache; a fresh token per server start means
// every deploy/restart serves fresh assets without anyone hard-refreshing.
const ASSET_VERSION = Date.now().toString(36);

const app = express();

// Railway terminates TLS at a proxy; trust the first hop so req.ip and secure
// cookies behave correctly.
app.set('trust proxy', 1);

// Canonical host: 301 www.* to the apex so search engines and shared links
// converge on a single hostname.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.startsWith('www.')) {
    return res.redirect(301, `${req.protocol}://${host.slice(4)}${req.originalUrl}`);
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Security headers + CSP ──────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameSrc: [
          'https://www.youtube-nocookie.com',
          'https://*.pushpay.com',
          'https://*.tithe.ly',
          'https://www.google.com',
        ],
        imgSrc: [
          "'self'",
          'blob:', // local image previews in the admin upload widget
          'https://img.youtube.com',
          'https://i.ytimg.com',
          'https://res.cloudinary.com',
        ],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(morgan('combined'));

// Gzip/Brotli responses — Railway does not compress for us, and the HTML/CSS
// payloads shrink ~70%.
app.use(compression());

// ── Static files ────────────────────────────────────────────────────────────
// CSS/JS/fonts are referenced with a per-deploy ?v= token (fonts live under
// /css/), so they can be cached for a year as immutable; images and other
// unversioned files keep the one-day cache.
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      const rel = path.relative(path.join(__dirname, 'public'), filePath);
      const versioned = rel.startsWith('css') || rel.startsWith('js');
      res.setHeader(
        'Cache-Control',
        versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'
      );
    },
  })
);

// ── Body parsing + cookies ──────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// ── Health check (before the global limiter so probes never 429; it gets its
// own small limit instead). Deliberately terse — no counts or internal state.
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.get('/health', healthLimiter, async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error' });
  }
});

// ── Global rate limit: 100 requests / 15 min / IP ───────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── res.locals: church info, query params, date/time formatters ─────────────
app.use(async (req, res, next) => {
  res.locals.query = req.query || {};
  res.locals.assetV = ASSET_VERSION;
  // Absolute origin for canonical URLs, Open Graph tags, and the sitemap.
  // SITE_URL (optional) pins it in production; otherwise derived per-request.
  res.locals.baseUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/+$/, '');
  res.locals.reqPath = req.path;
  // Cloudinary delivery optimization: inject f_auto (WebP/AVIF for supporting
  // browsers) + q_auto, and optionally cap the width. Non-Cloudinary URLs
  // (placeholders, external images) pass through untouched.
  res.locals.imgOpt = function (url, width) {
    const u = String(url || '');
    if (!u.includes('res.cloudinary.com') || !u.includes('/upload/')) return u;
    const t = `f_auto,q_auto${width ? `,w_${width},c_limit` : ''}`;
    return u.replace('/upload/', `/upload/${t}/`);
  };
  res.locals.fmtDate = function (d) {
    if (!d) return '';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return dt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };
  // Relative timestamps for admin lists ("3 days ago", exact date in title).
  res.locals.relTime = function (d) {
    if (!d) return '';
    const then = new Date(d).getTime();
    if (!Number.isFinite(then)) return '';
    const s = Math.round((Date.now() - then) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
    const days = Math.round(h / 24);
    if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  res.locals.fmtTime = function (t) {
    if (!t) return '';
    const bits = String(t).split(':');
    const dt = new Date(Date.UTC(2000, 0, 1, Number(bits[0]) || 0, Number(bits[1]) || 0));
    return dt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });
  };

  try {
    const result = await pool.query('SELECT * FROM church_info ORDER BY id ASC LIMIT 1');
    res.locals.church = result.rows[0] || null;
  } catch (err) {
    res.locals.church = null;
  }
  next();
});

// ── CSRF: double-submit cookie mode (no sessions) ───────────────────────────
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: isProd ? '__Host-csrf' : 'csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  },
  size: 64,
  getTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] || (req.body && req.body._csrf),
});

// Issue a token on safe requests so rendered forms have one.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    try {
      res.locals.csrfToken = generateToken(req, res);
    } catch (err) {
      res.locals.csrfToken = '';
    }
  }
  next();
});

// Validate the token on mutating requests, EXCEPT the two machine endpoints that
// authenticate by their own token (backup = Bearer BACKUP_SECRET, reset = ADMIN_RESET_TOKEN).
// /admin/backup is only exempt when it actually presents a Bearer header; the
// cookie-authenticated (superadmin session) path still gets normal CSRF checks.
app.use((req, res, next) => {
  const isBearerBackup =
    req.path === '/admin/backup' &&
    typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ');
  if (isBearerBackup || req.path === '/admin/auth/reset-password') {
    return next();
  }
  return doubleCsrfProtection(req, res, next);
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', contactRoutes);
app.use('/', uploadRoutes);
app.use('/', adminRoutes);

// ── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('layouts/main', {
    bodyPath: '../pages/404',
    title: 'Not found',
  });
});

// ── Central error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`[${new Date().toISOString()}] database connection OK`);
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] FATAL: cannot connect to the database on startup: ${err.message}`
    );
    process.exit(1);
  }

  // Clean up stale pending edits older than 24 hours.
  try {
    const cleaned = await pool.query(
      "DELETE FROM pending_edits WHERE created_at < NOW() - INTERVAL '24 hours'"
    );
    console.log(
      `[${new Date().toISOString()}] cleaned ${cleaned.rowCount} stale pending_edits`
    );
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] pending_edits cleanup skipped: ${err.message}`
    );
  }

  // Prune activity-log rows older than 90 days — enough history for the board,
  // bounded enough to never matter for storage.
  try {
    const pruned = await pool.query(
      "DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL '90 days'"
    );
    console.log(
      `[${new Date().toISOString()}] pruned ${pruned.rowCount} old activity_log rows`
    );
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] activity_log prune skipped: ${err.message}`
    );
  }

  const server = app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] server listening on port ${PORT}`);
  });

  // ── Automatic backups ──────────────────────────────────────────────────────
  // Defaults to every 24h in production; AUTO_BACKUP_HOURS overrides (0 disables).
  // Off in development so local runs don't spam the backups table and inbox.
  const backupHours = Number(process.env.AUTO_BACKUP_HOURS || (isProd ? '24' : '0'));
  if (Number.isFinite(backupHours) && backupHours > 0) {
    setInterval(() => {
      runBackup(pool)
        .then(({ backupId, emailSent }) => {
          console.log(
            `[${new Date().toISOString()}] scheduled backup ${backupId} complete (email ${emailSent ? 'sent' : 'FAILED'})`
          );
        })
        .catch((err) => {
          console.error(
            `[${new Date().toISOString()}] scheduled backup failed:`,
            err && err.stack ? err.stack : err
          );
        });
    }, backupHours * 60 * 60 * 1000).unref();
    console.log(
      `[${new Date().toISOString()}] automatic backups enabled (every ${backupHours}h)`
    );
  }

  function shutdown(signal) {
    console.log(`[${new Date().toISOString()}] ${signal} received — draining pool`);
    server.close(() => {
      pool
        .end()
        .then(() => {
          console.log(`[${new Date().toISOString()}] pool drained, exiting`);
          process.exit(0);
        })
        .catch(() => process.exit(0));
    });
    // Safety net if connections hang.
    setTimeout(() => process.exit(0), 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

module.exports = app;
