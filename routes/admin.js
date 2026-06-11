'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const { z } = require('zod');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const catchAsync = require('../middleware/catchAsync');

const router = express.Router();

const PER_PAGE = 20;

// ── shared zod helpers ──────────────────────────────────────────────────────
const optionalText = (max) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v == null || v.trim() === '' ? null : v));

const optionalShort = (max) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v == null || v.trim() === '' ? null : v));

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
  .refine((v) => {
    // Reject impossible dates (e.g. 2025-13-40) and year 0000 (no year zero in
    // Postgres) so they fail validation instead of erroring in the database.
    if (v.startsWith('0000')) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Invalid date');
const optionalTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));
const optionalEmail = z
  .union([z.literal(''), z.string().email().max(200)])
  .optional()
  .transform((v) => (v ? v : null));

function pageFrom(req) {
  let page = parseInt(req.query.page, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  return page;
}

function isoOrEmpty(value) {
  return value ? new Date(value).toISOString() : '';
}

// Parse the :id route param; returns null for non-numeric ids so handlers can
// redirect instead of sending 'NaN' to Postgres (mirrors the public.js guard).
function idFrom(req) {
  const id = parseInt(req.params.id, 10);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

// pending_edits.id is a UUID column; a malformed token would make Postgres
// throw a cast error (22P02), so validate the shape before querying.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

// ── entity configs (sermons / events / ministries / announcements) ──────────
const ENTITIES = {
  sermons: {
    table: 'services',
    base: '/admin/sermons',
    listView: '../pages/admin/sermons',
    formView: '../pages/admin/sermons-form',
    title: 'Sermons',
    label: (r) => r.title,
    listOrder: 'ORDER BY date DESC, id DESC',
    columns: ['title', 'date', 'pastor', 'description', 'youtube_id'],
    displayFields: [
      { key: 'title', label: 'Title' },
      { key: 'date', label: 'Date' },
      { key: 'pastor', label: 'Pastor' },
      { key: 'description', label: 'Description' },
      { key: 'youtube_id', label: 'YouTube ID' },
    ],
    parse(body) {
      const schema = z.object({
        title: z.string().trim().min(1).max(200),
        date: dateField,
        pastor: z.string().trim().min(1).max(100),
        description: optionalText(10000),
        youtube_id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Invalid YouTube ID'),
      });
      return schema.safeParse(body);
    },
  },
  events: {
    table: 'events',
    base: '/admin/events',
    listView: '../pages/admin/events',
    formView: '../pages/admin/events-form',
    title: 'Events',
    label: (r) => r.title,
    listOrder: 'ORDER BY date DESC, id DESC',
    columns: ['title', 'date', 'time', 'location', 'description'],
    displayFields: [
      { key: 'title', label: 'Title' },
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'location', label: 'Location' },
      { key: 'description', label: 'Description' },
    ],
    parse(body) {
      const schema = z.object({
        title: z.string().trim().min(1).max(200),
        date: dateField,
        time: optionalTime,
        location: optionalShort(200),
        description: optionalText(10000),
      });
      return schema.safeParse(body);
    },
  },
  ministries: {
    table: 'ministries',
    base: '/admin/ministries',
    listView: '../pages/admin/ministries',
    formView: '../pages/admin/ministries-form',
    title: 'Ministries',
    label: (r) => r.name,
    listOrder: 'ORDER BY name ASC',
    columns: ['name', 'description', 'leader', 'contact_email', 'image_url'],
    displayFields: [
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'leader', label: 'Leader' },
      { key: 'contact_email', label: 'Contact email' },
      { key: 'image_url', label: 'Image URL' },
    ],
    parse(body) {
      const schema = z.object({
        name: z.string().trim().min(1).max(200),
        description: optionalText(10000),
        leader: optionalShort(100),
        contact_email: optionalEmail,
        image_url: optionalText(2000),
      });
      return schema.safeParse(body);
    },
  },
  announcements: {
    table: 'announcements',
    base: '/admin/announcements',
    listView: '../pages/admin/announcements',
    formView: '../pages/admin/announcements-form',
    title: 'Announcements',
    label: (r) => r.message,
    listOrder: 'ORDER BY created_at DESC, id DESC',
    columns: ['message', 'active', 'expiry_utc'],
    displayFields: [
      { key: 'message', label: 'Message' },
      { key: 'active', label: 'Active' },
      { key: 'expiry_utc', label: 'Expiry (UTC)' },
    ],
    parse(body) {
      const schema = z.object({
        message: z.string().trim().min(1).max(500),
      });
      const base = schema.safeParse({ message: body.message });
      if (!base.success) return base;
      // active checkbox -> boolean; expiry datetime-local -> UTC timestamp or null
      const active = body.active === 'on' || body.active === 'true' || body.active === true;
      let expiry = null;
      if (body.expiry_utc && String(body.expiry_utc).trim() !== '') {
        const raw = String(body.expiry_utc);
        // datetime-local has no timezone; interpret the entered value as UTC by
        // appending 'Z' (e.g. "2025-01-01T10:00" -> "2025-01-01T10:00Z").
        const d = new Date(`${raw}Z`);
        expiry = isNaN(d.getTime()) ? null : d.toISOString();
      }
      return { success: true, data: { message: base.data.message, active, expiry_utc: expiry } };
    },
  },
};

// ── generic CRUD wiring ─────────────────────────────────────────────────────
function valuesInColumnOrder(cfg, data) {
  return cfg.columns.map((c) => data[c]);
}

function registerEntity(name, cfg) {
  // LIST
  router.get(
    `${cfg.base}`,
    auth,
    catchAsync(async (req, res) => {
      const page = pageFrom(req);
      const offset = (page - 1) * PER_PAGE;
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT * FROM ${cfg.table} ${cfg.listOrder} LIMIT $1 OFFSET $2`,
          [PER_PAGE, offset]
        ),
        pool.query(`SELECT COUNT(*)::int AS count FROM ${cfg.table}`),
      ]);
      const totalPages = Math.max(1, Math.ceil(count.rows[0].count / PER_PAGE));
      res.render('layouts/main', {
        bodyPath: cfg.listView,
        title: cfg.title,
        admin: true,
        entity: name,
        base: cfg.base,
        rows: rows.rows,
        page,
        totalPages,
      });
    })
  );

  // NEW
  router.get(
    `${cfg.base}/new`,
    auth,
    (req, res) => {
      res.render('layouts/main', {
        bodyPath: cfg.formView,
        title: `New ${cfg.title}`,
        admin: true,
        mode: 'new',
        base: cfg.base,
        record: {},
      });
    }
  );

  // CREATE
  router.post(
    `${cfg.base}`,
    auth,
    catchAsync(async (req, res) => {
      const parsed = cfg.parse(req.body);
      if (!parsed.success) {
        return res.redirect(`${cfg.base}/new?error=1`);
      }
      const values = valuesInColumnOrder(cfg, parsed.data);
      const cols = cfg.columns.join(', ');
      const placeholders = cfg.columns.map((_, i) => `$${i + 1}`).join(', ');
      await pool.query(
        `INSERT INTO ${cfg.table} (${cols}, created_at, last_modified)
         VALUES (${placeholders}, NOW(), NOW())`,
        values
      );
      return res.redirect(`${cfg.base}?success=1`);
    })
  );

  // EDIT (prepopulated)
  router.get(
    `${cfg.base}/:id/edit`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      const result = await pool.query(`SELECT * FROM ${cfg.table} WHERE id = $1`, [id]);
      if (result.rows.length === 0) {
        return res.redirect(`${cfg.base}?error=notfound`);
      }
      const record = result.rows[0];
      record.last_modified = isoOrEmpty(record.last_modified);
      res.render('layouts/main', {
        bodyPath: cfg.formView,
        title: `Edit ${cfg.title}`,
        admin: true,
        mode: 'edit',
        base: cfg.base,
        record,
      });
    })
  );

  // UPDATE (with optimistic-concurrency conflict detection)
  router.post(
    `${cfg.base}/:id`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      const parsed = cfg.parse(req.body);
      if (!parsed.success) {
        return res.redirect(`${cfg.base}/${id}/edit?error=1`);
      }

      // Atomic optimistic-concurrency check: the UPDATE only matches when the
      // submitted last_modified still equals the stored value (millisecond
      // precision, since the hidden form field comes from isoOrEmpty).
      const submittedModified = new Date(req.body.last_modified || '');
      let updated = { rowCount: 0 };
      if (!isNaN(submittedModified.getTime())) {
        const setClause = cfg.columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
        const values = valuesInColumnOrder(cfg, parsed.data);
        values.push(id, submittedModified);
        updated = await pool.query(
          `UPDATE ${cfg.table} SET ${setClause}, last_modified = NOW()
           WHERE id = $${values.length - 1}
             AND date_trunc('milliseconds', last_modified) = $${values.length}`,
          values
        );
      }

      if (updated.rowCount === 0) {
        const current = await pool.query(`SELECT id FROM ${cfg.table} WHERE id = $1`, [id]);
        if (current.rows.length === 0) {
          return res.redirect(`${cfg.base}?error=notfound`);
        }
        // Stash the submitted edit and send the user to the conflict screen.
        const pending = await pool.query(
          `INSERT INTO pending_edits (table_name, record_id, submitted_data)
           VALUES ($1, $2, $3) RETURNING id`,
          [cfg.table, id, JSON.stringify(parsed.data)]
        );
        return res.redirect(`${cfg.base}/${id}/conflict?token=${pending.rows[0].id}`);
      }
      return res.redirect(`${cfg.base}?success=1`);
    })
  );

  // CONFLICT view
  router.get(
    `${cfg.base}/:id/conflict`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      const token = uuidOrNull(req.query.token);
      if (!token) return res.redirect(`${cfg.base}?error=conflictexpired`);
      const pending = await pool.query(
        `SELECT * FROM pending_edits WHERE id = $1 AND table_name = $2 AND record_id = $3`,
        [token, cfg.table, id]
      );
      if (pending.rows.length === 0) {
        return res.redirect(`${cfg.base}?error=conflictexpired`);
      }
      const current = await pool.query(`SELECT * FROM ${cfg.table} WHERE id = $1`, [id]);
      if (current.rows.length === 0) {
        return res.redirect(`${cfg.base}?error=notfound`);
      }
      res.render('layouts/main', {
        bodyPath: '../pages/admin/sermons-conflict',
        title: `Conflict — ${cfg.title}`,
        admin: true,
        base: cfg.base,
        entityTitle: cfg.title,
        token,
        id,
        fields: cfg.displayFields,
        current: current.rows[0],
        submitted: pending.rows[0].submitted_data,
      });
    })
  );

  // CONFLICT — keep current
  router.post(
    `${cfg.base}/:id/conflict/keep`,
    auth,
    catchAsync(async (req, res) => {
      const token = uuidOrNull(req.body.token || req.query.token);
      if (!token) return res.redirect(`${cfg.base}?error=conflictexpired`);
      await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
      return res.redirect(`${cfg.base}?success=1`);
    })
  );

  // CONFLICT — save mine
  router.post(
    `${cfg.base}/:id/conflict/save`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      const token = uuidOrNull(req.body.token || req.query.token);
      if (!token) return res.redirect(`${cfg.base}?error=conflictexpired`);
      const pending = await pool.query(
        `SELECT * FROM pending_edits WHERE id = $1 AND table_name = $2 AND record_id = $3`,
        [token, cfg.table, id]
      );
      if (pending.rows.length === 0) {
        return res.redirect(`${cfg.base}?error=conflictexpired`);
      }
      const data = pending.rows[0].submitted_data;
      const setClause = cfg.columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
      const values = cfg.columns.map((c) => data[c]);
      values.push(id);
      await pool.query(
        `UPDATE ${cfg.table} SET ${setClause}, last_modified = NOW() WHERE id = $${values.length}`,
        values
      );
      await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
      return res.redirect(`${cfg.base}?success=1`);
    })
  );

  // DELETE confirm page
  router.get(
    `${cfg.base}/:id/delete`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      const result = await pool.query(`SELECT * FROM ${cfg.table} WHERE id = $1`, [id]);
      if (result.rows.length === 0) {
        return res.redirect(`${cfg.base}?error=notfound`);
      }
      res.render('layouts/main', {
        bodyPath: '../pages/admin/delete-confirm',
        title: `Delete — ${cfg.title}`,
        admin: true,
        base: cfg.base,
        id,
        label: cfg.label(result.rows[0]),
      });
    })
  );

  // DELETE confirm submit
  router.post(
    `${cfg.base}/:id/delete-confirm`,
    auth,
    catchAsync(async (req, res) => {
      const id = idFrom(req);
      if (id === null) return res.redirect(`${cfg.base}?error=notfound`);
      await pool.query(`DELETE FROM ${cfg.table} WHERE id = $1`, [id]);
      return res.redirect(`${cfg.base}?success=1`);
    })
  );
}

Object.entries(ENTITIES).forEach(([name, cfg]) => registerEntity(name, cfg));

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get(
  '/admin',
  auth,
  catchAsync(async (req, res) => {
    const isSuperadmin = res.locals.user && res.locals.user.role === 'superadmin';
    const [sermons, events, ministries, staff, sundaySchool, announcements, unreadMessages, recentBackups] =
      await Promise.all([
        pool.query('SELECT COUNT(*)::int AS c FROM services'),
        pool.query('SELECT COUNT(*)::int AS c FROM events'),
        pool.query('SELECT COUNT(*)::int AS c FROM ministries'),
        pool.query('SELECT COUNT(*)::int AS c FROM staff'),
        pool.query('SELECT COUNT(*)::int AS c FROM sunday_school_classes'),
        pool.query(
          `SELECT COUNT(*)::int AS c FROM announcements
           WHERE active = true AND (expiry_utc IS NULL OR expiry_utc > NOW())`
        ),
        pool.query('SELECT COUNT(*)::int AS c FROM contact_messages WHERE is_read = false'),
        isSuperadmin
          ? pool.query(
              'SELECT id, created_at, email_sent FROM backups ORDER BY created_at DESC, id DESC LIMIT 5'
            )
          : Promise.resolve({ rows: [] }),
      ]);
    res.render('layouts/main', {
      bodyPath: '../pages/admin/dashboard',
      title: 'Dashboard',
      admin: true,
      counts: {
        sermons: sermons.rows[0].c,
        events: events.rows[0].c,
        ministries: ministries.rows[0].c,
        staff: staff.rows[0].c,
        sundaySchool: sundaySchool.rows[0].c,
        announcements: announcements.rows[0].c,
        unreadMessages: unreadMessages.rows[0].c,
      },
      recentBackups: recentBackups.rows,
    });
  })
);

// ── CONTACT MESSAGES inbox (list / read / toggle / delete) ──────────────────
router.get(
  '/admin/messages',
  auth,
  catchAsync(async (req, res) => {
    const page = pageFrom(req);
    const offset = (page - 1) * PER_PAGE;
    const [rows, count, unread] = await Promise.all([
      pool.query(
        `SELECT id, name, email, source, is_read, created_at,
                LEFT(message, 160) AS preview
         FROM contact_messages
         ORDER BY created_at DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [PER_PAGE, offset]
      ),
      pool.query('SELECT COUNT(*)::int AS count FROM contact_messages'),
      pool.query('SELECT COUNT(*)::int AS c FROM contact_messages WHERE is_read = false'),
    ]);
    const totalPages = Math.max(1, Math.ceil(count.rows[0].count / PER_PAGE));
    res.render('layouts/main', {
      bodyPath: '../pages/admin/messages',
      title: 'Messages',
      admin: true,
      rows: rows.rows,
      unread: unread.rows[0].c,
      page,
      totalPages,
    });
  })
);

router.get(
  '/admin/messages/:id',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/messages?error=notfound');
    // Opening a message marks it read; RETURNING * avoids a second query.
    const result = await pool.query(
      'UPDATE contact_messages SET is_read = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.redirect('/admin/messages?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/message-detail',
      title: 'Message',
      admin: true,
      msg: result.rows[0],
    });
  })
);

router.post(
  '/admin/messages/:id/toggle-read',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/messages?error=notfound');
    await pool.query('UPDATE contact_messages SET is_read = NOT is_read WHERE id = $1', [id]);
    return res.redirect('/admin/messages');
  })
);

router.get(
  '/admin/messages/:id/delete',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/messages?error=notfound');
    const result = await pool.query('SELECT id, name FROM contact_messages WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.redirect('/admin/messages?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/delete-confirm',
      title: 'Delete — Message',
      admin: true,
      base: '/admin/messages',
      id,
      label: `message from ${result.rows[0].name}`,
    });
  })
);

router.post(
  '/admin/messages/:id/delete-confirm',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/messages?error=notfound');
    await pool.query('DELETE FROM contact_messages WHERE id = $1', [id]);
    return res.redirect('/admin/messages?success=1');
  })
);

// ── STAFF (list + move + CRUD with conflict) ────────────────────────────────
const staffDisplayFields = [
  { key: 'name', label: 'Name' },
  { key: 'title', label: 'Title' },
  { key: 'bio', label: 'Bio' },
  { key: 'image_url', label: 'Image URL' },
];

function parseStaff(body) {
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    title: optionalShort(100),
    bio: optionalText(10000),
    image_url: optionalText(2000),
  });
  return schema.safeParse(body);
}

router.get(
  '/admin/staff',
  auth,
  catchAsync(async (req, res) => {
    const rows = await pool.query(
      'SELECT * FROM staff ORDER BY display_order ASC, id ASC'
    );
    res.render('layouts/main', {
      bodyPath: '../pages/admin/staff',
      title: 'Staff',
      admin: true,
      rows: rows.rows,
    });
  })
);

router.get('/admin/staff/new', auth, (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/admin/staff-form',
    title: 'New Staff',
    admin: true,
    mode: 'new',
    record: {},
  });
});

router.post(
  '/admin/staff',
  auth,
  catchAsync(async (req, res) => {
    const parsed = parseStaff(req.body);
    if (!parsed.success) {
      return res.redirect('/admin/staff/new?error=1');
    }
    const { name, title, bio, image_url } = parsed.data;
    // New staff go to the bottom of the list. Compute the order inside the
    // INSERT so concurrent creates cannot read the same MAX.
    await pool.query(
      `INSERT INTO staff (name, title, bio, image_url, display_order, created_at, last_modified)
       SELECT $1, $2, $3, $4, COALESCE(MAX(display_order), 0) + 10, NOW(), NOW() FROM staff`,
      [name, title, bio, image_url]
    );
    return res.redirect('/admin/staff?success=1');
  })
);

router.get(
  '/admin/staff/:id/edit',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const result = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.redirect('/admin/staff?error=notfound');
    const record = result.rows[0];
    record.last_modified = isoOrEmpty(record.last_modified);
    res.render('layouts/main', {
      bodyPath: '../pages/admin/staff-form',
      title: 'Edit Staff',
      admin: true,
      mode: 'edit',
      record,
    });
  })
);

router.post(
  '/admin/staff/:id',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const parsed = parseStaff(req.body);
    if (!parsed.success) return res.redirect(`/admin/staff/${id}/edit?error=1`);

    // Atomic optimistic-concurrency check: the UPDATE only matches when the
    // submitted last_modified still equals the stored value (ms precision).
    const { name, title, bio, image_url } = parsed.data;
    const submittedModified = new Date(req.body.last_modified || '');
    let updated = { rowCount: 0 };
    if (!isNaN(submittedModified.getTime())) {
      updated = await pool.query(
        `UPDATE staff SET name = $1, title = $2, bio = $3, image_url = $4, last_modified = NOW()
         WHERE id = $5 AND date_trunc('milliseconds', last_modified) = $6`,
        [name, title, bio, image_url, id, submittedModified]
      );
    }

    if (updated.rowCount === 0) {
      const current = await pool.query('SELECT id FROM staff WHERE id = $1', [id]);
      if (current.rows.length === 0) return res.redirect('/admin/staff?error=notfound');
      const pending = await pool.query(
        `INSERT INTO pending_edits (table_name, record_id, submitted_data)
         VALUES ($1, $2, $3) RETURNING id`,
        ['staff', id, JSON.stringify(parsed.data)]
      );
      return res.redirect(`/admin/staff/${id}/conflict?token=${pending.rows[0].id}`);
    }
    return res.redirect('/admin/staff?success=1');
  })
);

router.get(
  '/admin/staff/:id/conflict',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const token = uuidOrNull(req.query.token);
    if (!token) return res.redirect('/admin/staff?error=conflictexpired');
    const pending = await pool.query(
      `SELECT * FROM pending_edits WHERE id = $1 AND table_name = 'staff' AND record_id = $2`,
      [token, id]
    );
    if (pending.rows.length === 0) return res.redirect('/admin/staff?error=conflictexpired');
    const current = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.redirect('/admin/staff?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/sermons-conflict',
      title: 'Conflict — Staff',
      admin: true,
      base: '/admin/staff',
      entityTitle: 'Staff',
      token,
      id,
      fields: staffDisplayFields,
      current: current.rows[0],
      submitted: pending.rows[0].submitted_data,
    });
  })
);

router.post(
  '/admin/staff/:id/conflict/keep',
  auth,
  catchAsync(async (req, res) => {
    const token = uuidOrNull(req.body.token || req.query.token);
    if (!token) return res.redirect('/admin/staff?error=conflictexpired');
    await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
    return res.redirect('/admin/staff?success=1');
  })
);

router.post(
  '/admin/staff/:id/conflict/save',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const token = uuidOrNull(req.body.token || req.query.token);
    if (!token) return res.redirect('/admin/staff?error=conflictexpired');
    const pending = await pool.query(
      `SELECT * FROM pending_edits WHERE id = $1 AND table_name = 'staff' AND record_id = $2`,
      [token, id]
    );
    if (pending.rows.length === 0) return res.redirect('/admin/staff?error=conflictexpired');
    const d = pending.rows[0].submitted_data;
    await pool.query(
      `UPDATE staff SET name = $1, title = $2, bio = $3, image_url = $4, last_modified = NOW()
       WHERE id = $5`,
      [d.name, d.title, d.bio, d.image_url, id]
    );
    await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
    return res.redirect('/admin/staff?success=1');
  })
);

router.get(
  '/admin/staff/:id/delete',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const result = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.redirect('/admin/staff?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/delete-confirm',
      title: 'Delete — Staff',
      admin: true,
      base: '/admin/staff',
      id,
      label: result.rows[0].name,
    });
  })
);

router.post(
  '/admin/staff/:id/delete-confirm',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    await pool.query('DELETE FROM staff WHERE id = $1', [id]);
    return res.redirect('/admin/staff?success=1');
  })
);

// STAFF reorder — swap display_order with the adjacent neighbor in a transaction.
router.post(
  '/admin/staff/:id/move',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/staff?error=notfound');
    const direction = req.body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).render('layouts/main', {
        bodyPath: '../pages/500',
        title: 'Bad request',
        admin: true,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT id, display_order FROM staff WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.redirect('/admin/staff?error=notfound');
      }
      const order = target.rows[0].display_order;

      const neighborSql =
        direction === 'up'
          ? 'SELECT id, display_order FROM staff WHERE display_order < $1 ORDER BY display_order DESC LIMIT 1 FOR UPDATE'
          : 'SELECT id, display_order FROM staff WHERE display_order > $1 ORDER BY display_order ASC LIMIT 1 FOR UPDATE';
      const neighbor = await client.query(neighborSql, [order]);

      if (neighbor.rows.length === 0) {
        // Already at the top/bottom — nothing to swap.
        await client.query('COMMIT');
        return res.redirect('/admin/staff');
      }

      // Confirm adjacency: no other row sits strictly between the two orders.
      const lo = Math.min(order, neighbor.rows[0].display_order);
      const hi = Math.max(order, neighbor.rows[0].display_order);
      const between = await client.query(
        'SELECT COUNT(*)::int AS c FROM staff WHERE display_order > $1 AND display_order < $2',
        [lo, hi]
      );
      if (between.rows[0].c !== 0) {
        await client.query('ROLLBACK');
        return res.status(400).render('layouts/main', {
          bodyPath: '../pages/500',
          title: 'Bad request',
          admin: true,
        });
      }

      // Swap the two display_order values.
      await client.query('UPDATE staff SET display_order = $1, last_modified = NOW() WHERE id = $2', [
        neighbor.rows[0].display_order,
        id,
      ]);
      await client.query('UPDATE staff SET display_order = $1, last_modified = NOW() WHERE id = $2', [
        order,
        neighbor.rows[0].id,
      ]);
      await client.query('COMMIT');
      return res.redirect('/admin/staff');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ── SUNDAY SCHOOL CLASSES (editor-accessible: list + move + CRUD w/ conflict) ─
// Mirrors the ministries CRUD plus the staff-style display_order reorder.
const sundaySchoolDisplayFields = [
  { key: 'name', label: 'Name' },
  { key: 'age_group', label: 'Age group' },
  { key: 'location', label: 'Room / location' },
  { key: 'teacher', label: 'Teacher' },
  { key: 'description', label: 'Description' },
];

function parseSundaySchool(body) {
  const schema = z.object({
    name: z.string().trim().min(1).max(200),
    age_group: optionalShort(100),
    location: optionalShort(200),
    teacher: optionalShort(100),
    description: optionalText(10000),
  });
  return schema.safeParse(body);
}

router.get(
  '/admin/sunday-school',
  auth,
  catchAsync(async (req, res) => {
    const page = pageFrom(req);
    const offset = (page - 1) * PER_PAGE;
    const [rows, count] = await Promise.all([
      pool.query(
        'SELECT * FROM sunday_school_classes ORDER BY display_order ASC, id ASC LIMIT $1 OFFSET $2',
        [PER_PAGE, offset]
      ),
      pool.query('SELECT COUNT(*)::int AS count FROM sunday_school_classes'),
    ]);
    const total = count.rows[0].count;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    res.render('layouts/main', {
      bodyPath: '../pages/admin/sunday-school',
      title: 'Sunday School',
      admin: true,
      rows: rows.rows,
      page,
      totalPages,
      offset,
      total,
    });
  })
);

router.get('/admin/sunday-school/new', auth, (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/admin/sunday-school-form',
    title: 'New Sunday School Class',
    admin: true,
    mode: 'new',
    record: {},
  });
});

router.post(
  '/admin/sunday-school',
  auth,
  catchAsync(async (req, res) => {
    const parsed = parseSundaySchool(req.body);
    if (!parsed.success) {
      return res.redirect('/admin/sunday-school/new?error=1');
    }
    const { name, age_group, location, teacher, description } = parsed.data;
    // New classes go to the bottom of the list. Compute the order inside the
    // INSERT so concurrent creates cannot read the same MAX.
    await pool.query(
      `INSERT INTO sunday_school_classes
         (name, age_group, location, teacher, description, display_order, created_at, last_modified)
       SELECT $1, $2, $3, $4, $5, COALESCE(MAX(display_order), 0) + 10, NOW(), NOW()
       FROM sunday_school_classes`,
      [name, age_group, location, teacher, description]
    );
    return res.redirect('/admin/sunday-school?success=1');
  })
);

router.get(
  '/admin/sunday-school/:id/edit',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const result = await pool.query('SELECT * FROM sunday_school_classes WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.redirect('/admin/sunday-school?error=notfound');
    const record = result.rows[0];
    record.last_modified = isoOrEmpty(record.last_modified);
    res.render('layouts/main', {
      bodyPath: '../pages/admin/sunday-school-form',
      title: 'Edit Sunday School Class',
      admin: true,
      mode: 'edit',
      record,
    });
  })
);

router.post(
  '/admin/sunday-school/:id',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const parsed = parseSundaySchool(req.body);
    if (!parsed.success) return res.redirect(`/admin/sunday-school/${id}/edit?error=1`);

    // Atomic optimistic-concurrency check: the UPDATE only matches when the
    // submitted last_modified still equals the stored value (ms precision).
    const { name, age_group, location, teacher, description } = parsed.data;
    const submittedModified = new Date(req.body.last_modified || '');
    let updated = { rowCount: 0 };
    if (!isNaN(submittedModified.getTime())) {
      updated = await pool.query(
        `UPDATE sunday_school_classes
           SET name = $1, age_group = $2, location = $3, teacher = $4, description = $5,
               last_modified = NOW()
         WHERE id = $6 AND date_trunc('milliseconds', last_modified) = $7`,
        [name, age_group, location, teacher, description, id, submittedModified]
      );
    }

    if (updated.rowCount === 0) {
      const current = await pool.query('SELECT id FROM sunday_school_classes WHERE id = $1', [id]);
      if (current.rows.length === 0) return res.redirect('/admin/sunday-school?error=notfound');
      const pending = await pool.query(
        `INSERT INTO pending_edits (table_name, record_id, submitted_data)
         VALUES ($1, $2, $3) RETURNING id`,
        ['sunday_school_classes', id, JSON.stringify(parsed.data)]
      );
      return res.redirect(`/admin/sunday-school/${id}/conflict?token=${pending.rows[0].id}`);
    }
    return res.redirect('/admin/sunday-school?success=1');
  })
);

router.get(
  '/admin/sunday-school/:id/conflict',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const token = uuidOrNull(req.query.token);
    if (!token) return res.redirect('/admin/sunday-school?error=conflictexpired');
    const pending = await pool.query(
      `SELECT * FROM pending_edits WHERE id = $1 AND table_name = 'sunday_school_classes' AND record_id = $2`,
      [token, id]
    );
    if (pending.rows.length === 0) return res.redirect('/admin/sunday-school?error=conflictexpired');
    const current = await pool.query('SELECT * FROM sunday_school_classes WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.redirect('/admin/sunday-school?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/sermons-conflict',
      title: 'Conflict — Sunday School',
      admin: true,
      base: '/admin/sunday-school',
      entityTitle: 'Sunday School',
      token,
      id,
      fields: sundaySchoolDisplayFields,
      current: current.rows[0],
      submitted: pending.rows[0].submitted_data,
    });
  })
);

router.post(
  '/admin/sunday-school/:id/conflict/keep',
  auth,
  catchAsync(async (req, res) => {
    const token = uuidOrNull(req.body.token || req.query.token);
    if (!token) return res.redirect('/admin/sunday-school?error=conflictexpired');
    await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
    return res.redirect('/admin/sunday-school?success=1');
  })
);

router.post(
  '/admin/sunday-school/:id/conflict/save',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const token = uuidOrNull(req.body.token || req.query.token);
    if (!token) return res.redirect('/admin/sunday-school?error=conflictexpired');
    const pending = await pool.query(
      `SELECT * FROM pending_edits WHERE id = $1 AND table_name = 'sunday_school_classes' AND record_id = $2`,
      [token, id]
    );
    if (pending.rows.length === 0) return res.redirect('/admin/sunday-school?error=conflictexpired');
    const d = pending.rows[0].submitted_data;
    await pool.query(
      `UPDATE sunday_school_classes
         SET name = $1, age_group = $2, location = $3, teacher = $4, description = $5,
             last_modified = NOW()
       WHERE id = $6`,
      [d.name, d.age_group, d.location, d.teacher, d.description, id]
    );
    await pool.query('DELETE FROM pending_edits WHERE id = $1', [token]);
    return res.redirect('/admin/sunday-school?success=1');
  })
);

router.get(
  '/admin/sunday-school/:id/delete',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const result = await pool.query('SELECT * FROM sunday_school_classes WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.redirect('/admin/sunday-school?error=notfound');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/delete-confirm',
      title: 'Delete — Sunday School',
      admin: true,
      base: '/admin/sunday-school',
      id,
      label: result.rows[0].name,
    });
  })
);

router.post(
  '/admin/sunday-school/:id/delete-confirm',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    await pool.query('DELETE FROM sunday_school_classes WHERE id = $1', [id]);
    return res.redirect('/admin/sunday-school?success=1');
  })
);

// Reorder — swap display_order with the adjacent neighbor in a transaction.
router.post(
  '/admin/sunday-school/:id/move',
  auth,
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/sunday-school?error=notfound');
    const direction = req.body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).render('layouts/main', {
        bodyPath: '../pages/500',
        title: 'Bad request',
        admin: true,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT id, display_order FROM sunday_school_classes WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.redirect('/admin/sunday-school?error=notfound');
      }
      const order = target.rows[0].display_order;

      const neighborSql =
        direction === 'up'
          ? 'SELECT id, display_order FROM sunday_school_classes WHERE display_order < $1 ORDER BY display_order DESC LIMIT 1 FOR UPDATE'
          : 'SELECT id, display_order FROM sunday_school_classes WHERE display_order > $1 ORDER BY display_order ASC LIMIT 1 FOR UPDATE';
      const neighbor = await client.query(neighborSql, [order]);

      if (neighbor.rows.length === 0) {
        await client.query('COMMIT');
        return res.redirect('/admin/sunday-school');
      }

      const lo = Math.min(order, neighbor.rows[0].display_order);
      const hi = Math.max(order, neighbor.rows[0].display_order);
      const between = await client.query(
        'SELECT COUNT(*)::int AS c FROM sunday_school_classes WHERE display_order > $1 AND display_order < $2',
        [lo, hi]
      );
      if (between.rows[0].c !== 0) {
        await client.query('ROLLBACK');
        return res.status(400).render('layouts/main', {
          bodyPath: '../pages/500',
          title: 'Bad request',
          admin: true,
        });
      }

      await client.query(
        'UPDATE sunday_school_classes SET display_order = $1, last_modified = NOW() WHERE id = $2',
        [neighbor.rows[0].display_order, id]
      );
      await client.query(
        'UPDATE sunday_school_classes SET display_order = $1, last_modified = NOW() WHERE id = $2',
        [order, neighbor.rows[0].id]
      );
      await client.query('COMMIT');
      return res.redirect('/admin/sunday-school');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ── CHURCH INFO (superadmin only) ───────────────────────────────────────────
const US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

router.get(
  '/admin/church',
  auth,
  requireRole('superadmin'),
  catchAsync(async (req, res) => {
    const result = await pool.query('SELECT * FROM church_info ORDER BY id ASC LIMIT 1');
    res.render('layouts/main', {
      bodyPath: '../pages/admin/church',
      title: 'Church Info',
      admin: true,
      church_info: result.rows[0] || {},
      timezones: US_TIMEZONES,
    });
  })
);

router.post(
  '/admin/church',
  auth,
  requireRole('superadmin'),
  catchAsync(async (req, res) => {
    const schema = z.object({
      church_name: z.string().max(200).optional().transform((v) => v || null),
      tagline: z.string().max(200).optional().transform((v) => v || null),
      about: z.string().max(20000).optional().transform((v) => v || null),
      mission_statement: z.string().max(20000).optional().transform((v) => v || null),
      address: z.string().max(2000).optional().transform((v) => v || null),
      phone: z.string().max(50).optional().transform((v) => v || null),
      email: z
        .union([z.literal(''), z.string().email().max(200)])
        .optional()
        .transform((v) => v || null),
      service_times: z.string().max(5000).optional().transform((v) => v || null),
      // Restrict to the known-good list: an invalid timezone would make the
      // public pages' NOW() AT TIME ZONE queries error site-wide.
      timezone: z.enum(US_TIMEZONES),
      maps_embed_url: z
        .string()
        .max(5000)
        .optional()
        .transform((v) => (v == null ? '' : v))
        .refine(
          (v) => v === '' || (v.startsWith('https') && v.includes('google.com/maps')),
          { message: 'maps_embed_url must be https and contain google.com/maps' }
        ),
      giving_embed_url: z
        .string()
        .max(5000)
        .optional()
        .transform((v) => v || null)
        .refine(
          (v) => {
            if (v === null) return true;
            try {
              const u = new URL(v);
              return u.protocol === 'https:' && /(^|\.)(pushpay\.com|tithe\.ly)$/.test(u.hostname);
            } catch {
              return false;
            }
          },
          { message: 'giving_embed_url must be an https URL on pushpay.com or tithe.ly' }
        ),
      give_intro: z.string().max(20000).optional().transform((v) => v || null),
      hero_cta_label: z.string().max(50).optional().transform((v) => v || 'Plan Your Visit'),
      logo_url: z.string().max(2000).optional().transform((v) => v || null),
      favicon_url: z.string().max(2000).optional().transform((v) => v || null),
      // TMPC additions
      statement_of_faith: z.string().max(20000).optional().transform((v) => v || null),
      visit_info: z.string().max(20000).optional().transform((v) => v || null),
      sunday_school_intro: z.string().max(20000).optional().transform((v) => v || null),
      sunday_school_schedule: z.string().max(20000).optional().transform((v) => v || null),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      console.error(
        `[${new Date().toISOString()}] church update validation failed:`,
        parsed.error.flatten()
      );
      return res.redirect('/admin/church?error=1');
    }
    const d = parsed.data;

    const existing = await pool.query('SELECT id FROM church_info ORDER BY id ASC LIMIT 1');
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO church_info
          (church_name, tagline, about, mission_statement, address, phone, email,
           service_times, timezone, maps_embed_url, giving_embed_url, give_intro,
           hero_cta_label, logo_url, favicon_url,
           statement_of_faith, visit_info, sunday_school_intro, sunday_school_schedule)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          d.church_name, d.tagline, d.about, d.mission_statement, d.address, d.phone, d.email,
          d.service_times, d.timezone, d.maps_embed_url || null, d.giving_embed_url, d.give_intro,
          d.hero_cta_label, d.logo_url, d.favicon_url,
          d.statement_of_faith, d.visit_info, d.sunday_school_intro, d.sunday_school_schedule,
        ]
      );
    } else {
      await pool.query(
        `UPDATE church_info SET
          church_name = $1, tagline = $2, about = $3, mission_statement = $4, address = $5,
          phone = $6, email = $7, service_times = $8, timezone = $9, maps_embed_url = $10,
          giving_embed_url = $11, give_intro = $12, hero_cta_label = $13, logo_url = $14,
          favicon_url = $15, statement_of_faith = $16, visit_info = $17,
          sunday_school_intro = $18, sunday_school_schedule = $19
         WHERE id = $20`,
        [
          d.church_name, d.tagline, d.about, d.mission_statement, d.address, d.phone, d.email,
          d.service_times, d.timezone, d.maps_embed_url || null, d.giving_embed_url, d.give_intro,
          d.hero_cta_label, d.logo_url, d.favicon_url,
          d.statement_of_faith, d.visit_info, d.sunday_school_intro, d.sunday_school_schedule,
          existing.rows[0].id,
        ]
      );
    }
    return res.redirect('/admin/church?success=1');
  })
);

// ── USERS (superadmin only) ─────────────────────────────────────────────────
router.get(
  '/admin/users',
  auth,
  requireRole('superadmin'),
  catchAsync(async (req, res) => {
    const result = await pool.query(
      'SELECT id, username, role, created_at FROM admins ORDER BY created_at ASC, id ASC'
    );
    res.render('layouts/main', {
      bodyPath: '../pages/admin/users',
      title: 'Users',
      admin: true,
      users: result.rows,
    });
  })
);

router.post(
  '/admin/users',
  auth,
  requireRole('superadmin'),
  catchAsync(async (req, res) => {
    const schema = z.object({
      username: z
        .string()
        .max(50)
        .regex(/^[a-zA-Z0-9_]+$/, 'Username may contain only letters, numbers, and underscore'),
      password: z.string().min(12),
      role: z.enum(['superadmin', 'editor']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.redirect('/admin/users?error=invalid');
    }
    const { username, password, role } = parsed.data;
    const hashed = await bcrypt.hash(password, 12);
    try {
      await pool.query(
        'INSERT INTO admins (username, hashed_password, role) VALUES ($1, $2, $3)',
        [username, hashed, role]
      );
    } catch (err) {
      if (err && err.code === '23505') {
        return res.redirect('/admin/users?error=duplicate');
      }
      throw err;
    }
    return res.redirect('/admin/users?success=1');
  })
);

router.post(
  '/admin/users/:id/delete',
  auth,
  requireRole('superadmin'),
  catchAsync(async (req, res) => {
    const id = idFrom(req);
    if (id === null) return res.redirect('/admin/users?error=notfound');
    const target = await pool.query('SELECT id, role FROM admins WHERE id = $1', [id]);
    if (target.rows.length === 0) {
      return res.redirect('/admin/users?error=notfound');
    }
    if (target.rows[0].role === 'superadmin') {
      const count = await pool.query(
        "SELECT COUNT(*)::int AS c FROM admins WHERE role = 'superadmin'"
      );
      if (count.rows[0].c <= 1) {
        return res.redirect('/admin/users?error=lastsuperadmin');
      }
    }
    await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    return res.redirect('/admin/users?success=1');
  })
);

// ── BACKUP (superadmin cookie OR Bearer BACKUP_SECRET) ──────────────────────
// Constant-time string comparison. Hashing both sides first yields equal-length
// buffers so crypto.timingSafeEqual can be used regardless of input lengths.
function timingSafeStringEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

async function authorizeBackup(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (process.env.BACKUP_SECRET && timingSafeStringEqual(token, process.env.BACKUP_SECRET)) {
      return true;
    }
  }
  const cookie = req.cookies && req.cookies.token;
  if (cookie) {
    try {
      const payload = jwt.verify(cookie, process.env.JWT_SECRET);
      // Don't trust the role baked into the token — confirm against the DB
      // that the admin still exists, is still superadmin, and the token has
      // not been revoked (token_version mismatch).
      const result = await pool.query(
        'SELECT role, token_version FROM admins WHERE id = $1',
        [payload.id]
      );
      const admin = result.rows[0];
      if (
        admin &&
        admin.role === 'superadmin' &&
        payload.token_version === admin.token_version
      ) {
        return true;
      }
    } catch (err) {
      /* fall through */
    }
  }
  return false;
}

router.post(
  '/admin/backup',
  catchAsync(async (req, res) => {
    // Dashboard form posts want a redirect back to /admin; the machine
    // (Bearer-token) flow keeps its JSON contract.
    const wantsHtml = (req.headers.accept || '').includes('text/html');

    if (!(await authorizeBackup(req))) {
      if (wantsHtml) return res.redirect('/admin/login');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [services, events, ministries, staff, sundaySchool, announcements, churchInfo] =
      await Promise.all([
        pool.query('SELECT * FROM services'),
        pool.query('SELECT * FROM events'),
        pool.query('SELECT * FROM ministries'),
        pool.query('SELECT * FROM staff'),
        pool.query('SELECT * FROM sunday_school_classes'),
        pool.query('SELECT * FROM announcements'),
        pool.query('SELECT * FROM church_info'),
      ]);

    const payload = {
      generated_at: new Date().toISOString(),
      services: services.rows,
      events: events.rows,
      ministries: ministries.rows,
      staff: staff.rows,
      sunday_school_classes: sundaySchool.rows,
      announcements: announcements.rows,
      church_info: churchInfo.rows,
    };

    // Persist to the DB FIRST so the backup exists regardless of email outcome.
    const inserted = await pool.query(
      'INSERT INTO backups (payload, email_sent) VALUES ($1, false) RETURNING id',
      [JSON.stringify(payload)]
    );
    const backupId = inserted.rows[0].id;

    let emailSent = false;
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const json = JSON.stringify(payload, null, 2);
      // Resend resolves with { data, error } instead of throwing on API
      // failures, so check the error explicitly before marking the email sent.
      const { error } = await resend.emails.send({
        from: `Church Backup <${process.env.CHURCH_CONTACT_EMAIL}>`,
        to: process.env.BACKUP_EMAIL,
        subject: `Church website backup — ${payload.generated_at}`,
        text: 'Automated database backup attached as JSON.',
        attachments: [
          {
            filename: `backup-${payload.generated_at}.json`,
            content: Buffer.from(json).toString('base64'),
          },
        ],
      });
      if (error) throw error;
      emailSent = true;
      await pool.query('UPDATE backups SET email_sent = true WHERE id = $1', [backupId]);
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] backup email failed (backup row ${backupId} retained):`,
        err && err.stack ? err.stack : err
      );
    }

    if (wantsHtml) {
      return res.redirect(`/admin?backup=1&backupemail=${emailSent ? '1' : '0'}`);
    }
    return res.status(200).json({ backed_up: true, email_sent: emailSent });
  })
);

module.exports = router;
