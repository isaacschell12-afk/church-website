'use strict';

const express = require('express');
const pool = require('../db/pool');
const catchAsync = require('../middleware/catchAsync');

const router = express.Router();

const SERMONS_PER_PAGE = 20;

function timezoneOf(church) {
  return (church && church.timezone) || 'America/New_York';
}

// GET / — Home
router.get(
  '/',
  catchAsync(async (req, res) => {
    const church = res.locals.church;
    const tz = timezoneOf(church);

    const [latestSermons, upcomingEvents, announcements] = await Promise.all([
      pool.query('SELECT * FROM services ORDER BY date DESC, id DESC LIMIT 3'),
      pool.query(
        `SELECT * FROM events
         WHERE date >= (NOW() AT TIME ZONE $1)::DATE
         ORDER BY date ASC LIMIT 3`,
        [tz]
      ),
      pool.query(
        `SELECT * FROM announcements
         WHERE active = true AND (expiry_utc IS NULL OR expiry_utc > NOW())
         ORDER BY created_at DESC`
      ),
    ]);

    res.render('layouts/main', {
      bodyPath: '../pages/home',
      title: (church && church.church_name) || 'Home',
      latestSermons: latestSermons.rows,
      upcomingEvents: upcomingEvents.rows,
      announcements: announcements.rows,
    });
  })
);

// GET /about
router.get(
  '/about',
  catchAsync(async (req, res) => {
    const staff = await pool.query(
      'SELECT * FROM staff ORDER BY display_order ASC, id ASC'
    );
    res.render('layouts/main', {
      bodyPath: '../pages/about',
      title: 'About Us',
      staff: staff.rows,
    });
  })
);

// GET /sermons — search + pagination
router.get(
  '/sermons',
  catchAsync(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    let page = parseInt(req.query.page, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    const offset = (page - 1) * SERMONS_PER_PAGE;

    let rows;
    let total;
    if (search) {
      const like = `%${search}%`;
      const result = await pool.query(
        `SELECT * FROM services
         WHERE title ILIKE $1 OR pastor ILIKE $1
         ORDER BY date DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [like, SERMONS_PER_PAGE, offset]
      );
      const count = await pool.query(
        `SELECT COUNT(*)::int AS count FROM services
         WHERE title ILIKE $1 OR pastor ILIKE $1`,
        [like]
      );
      rows = result.rows;
      total = count.rows[0].count;
    } else {
      const result = await pool.query(
        `SELECT * FROM services
         ORDER BY date DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [SERMONS_PER_PAGE, offset]
      );
      const count = await pool.query('SELECT COUNT(*)::int AS count FROM services');
      rows = result.rows;
      total = count.rows[0].count;
    }

    const totalPages = Math.max(1, Math.ceil(total / SERMONS_PER_PAGE));

    res.render('layouts/main', {
      bodyPath: '../pages/sermons',
      title: 'Sermons',
      sermons: rows,
      search,
      page,
      totalPages,
    });
  })
);

// GET /sermons/:id
router.get(
  '/sermons/:id',
  catchAsync(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res
        .status(404)
        .render('layouts/main', { bodyPath: '../pages/404', title: 'Not found' });
    }
    const result = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .render('layouts/main', { bodyPath: '../pages/404', title: 'Not found' });
    }
    res.render('layouts/main', {
      bodyPath: '../pages/sermon-detail',
      title: result.rows[0].title,
      sermon: result.rows[0],
    });
  })
);

// GET /events
router.get(
  '/events',
  catchAsync(async (req, res) => {
    const tz = timezoneOf(res.locals.church);
    const result = await pool.query(
      `SELECT * FROM events
       WHERE date >= (NOW() AT TIME ZONE $1)::DATE
       ORDER BY date ASC`,
      [tz]
    );
    res.render('layouts/main', {
      bodyPath: '../pages/events',
      title: 'Events',
      events: result.rows,
    });
  })
);

// GET /events/:id — event detail
router.get(
  '/events/:id',
  catchAsync(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res
        .status(404)
        .render('layouts/main', { bodyPath: '../pages/404', title: 'Not found' });
    }
    const result = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .render('layouts/main', { bodyPath: '../pages/404', title: 'Not found' });
    }
    res.render('layouts/main', {
      bodyPath: '../pages/event-detail',
      title: result.rows[0].title,
      event: result.rows[0],
    });
  })
);

// GET /ministries
router.get(
  '/ministries',
  catchAsync(async (req, res) => {
    const result = await pool.query('SELECT * FROM ministries ORDER BY name ASC');
    res.render('layouts/main', {
      bodyPath: '../pages/ministries',
      title: 'Ministries',
      ministries: result.rows,
    });
  })
);

// GET /visit — Plan a Visit
router.get('/visit', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/visit',
    title: 'Plan a Visit',
  });
});

// GET /beliefs — What We Believe
router.get('/beliefs', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/beliefs',
    title: 'What We Believe',
  });
});

// GET /sunday-school — Sunday School (intro + schedule + class list)
router.get(
  '/sunday-school',
  catchAsync(async (req, res) => {
    const classes = await pool.query(
      'SELECT * FROM sunday_school_classes ORDER BY display_order ASC, id ASC'
    );
    res.render('layouts/main', {
      bodyPath: '../pages/sunday-school',
      title: 'Sunday School',
      classes: classes.rows,
    });
  })
);

// GET /give
router.get('/give', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/give',
    title: 'Give',
  });
});

// GET /contact
router.get('/contact', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/contact',
    title: 'Contact',
  });
});

module.exports = router;
