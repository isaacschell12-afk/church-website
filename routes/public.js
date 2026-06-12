'use strict';

const express = require('express');
const pool = require('../db/pool');
const catchAsync = require('../middleware/catchAsync');

const router = express.Router();

const SERMONS_PER_PAGE = 20;

function timezoneOf(church) {
  return (church && church.timezone) || 'America/New_York';
}

// Collapse whitespace and cap at ~160 chars for meta descriptions.
function metaText(text, fallback) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback || '';
  return t.length > 158 ? `${t.slice(0, 157).trimEnd()}…` : t;
}

function churchName(church) {
  return (church && church.church_name) || 'Our Church';
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
      metaDescription: metaText(
        `${churchName(church)}${church && church.tagline ? ` — ${church.tagline}` : ''} Find service times, directions, recent sermons, and upcoming events.`
      ),
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
      metaDescription: metaText(
        res.locals.church && res.locals.church.about,
        `Our story, our heart, and the people who serve at ${churchName(res.locals.church)}.`
      ),
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
      metaDescription: metaText(
        `Watch and revisit recent sermons from ${churchName(res.locals.church)} — browse by title, speaker, and date.`
      ),
      sermons: rows,
      search,
      page,
      totalPages,
    });
  })
);

// GET /sermons/feed.xml — RSS 2.0 feed of the latest sermons.
// Registered before /sermons/:id so "feed.xml" is never parsed as an id.
router.get(
  '/sermons/feed.xml',
  catchAsync(async (req, res) => {
    const base = res.locals.baseUrl;
    const name = churchName(res.locals.church);
    const result = await pool.query(
      'SELECT id, title, pastor, description, date, last_modified FROM services ORDER BY date DESC, id DESC LIMIT 20'
    );

    const items = result.rows.map((s) => {
      const link = `${base}/sermons/${s.id}`;
      const desc = metaText(s.description, `A sermon by ${s.pastor}.`);
      return [
        '    <item>',
        `      <title>${xmlEscape(s.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${new Date(s.date).toUTCString()}</pubDate>`,
        `      <description>${xmlEscape(`${desc} — ${s.pastor}`)}</description>`,
        '    </item>',
      ].join('\n');
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${xmlEscape(`${name} — Sermons`)}</title>`,
      `    <link>${xmlEscape(`${base}/sermons`)}</link>`,
      `    <atom:link href="${xmlEscape(`${base}/sermons/feed.xml`)}" rel="self" type="application/rss+xml" />`,
      `    <description>${xmlEscape(`Recent sermons from ${name}.`)}</description>`,
      '    <language>en-us</language>',
      ...items,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n');

    res.type('application/rss+xml').send(xml);
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
    const sermon = result.rows[0];
    res.render('layouts/main', {
      bodyPath: '../pages/sermon-detail',
      title: sermon.title,
      metaDescription: metaText(
        sermon.description,
        `A sermon by ${sermon.pastor} at ${churchName(res.locals.church)}.`
      ),
      ogType: 'article',
      ogImage: sermon.youtube_id
        ? `https://img.youtube.com/vi/${sermon.youtube_id}/hqdefault.jpg`
        : null,
      sermon,
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
      metaDescription: metaText(
        `Upcoming events at ${churchName(res.locals.church)} — dates, times, and where to find us.`
      ),
      events: result.rows,
    });
  })
);

// GET /events.ics — iCalendar feed of upcoming events, so anyone can subscribe
// from Google/Apple/Outlook calendars.
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 lines must stay within 75 octets; continuation lines start with a space.
function icsFold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

router.get(
  '/events.ics',
  catchAsync(async (req, res) => {
    const church = res.locals.church;
    const tz = timezoneOf(church);
    const result = await pool.query(
      `SELECT * FROM events
       WHERE date >= (NOW() AT TIME ZONE $1)::DATE
       ORDER BY date ASC`,
      [tz]
    );

    const host = res.locals.baseUrl.replace(/^https?:\/\//, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${icsEscape(churchName(church))}//Events//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(`${churchName(church)} Events`)}`,
    ];

    result.rows.forEach((e) => {
      const ymd = String(e.date).slice(0, 10).replace(/-/g, '');
      const stamp = new Date(e.last_modified || e.created_at || Date.now())
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:event-${e.id}@${host}`);
      lines.push(`DTSTAMP:${stamp}`);
      if (e.time) {
        const hms = String(e.time).slice(0, 8).replace(/:/g, '');
        lines.push(`DTSTART;TZID=${tz}:${ymd}T${hms}`);
      } else {
        // No time recorded — publish as an all-day event.
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      }
      lines.push(`SUMMARY:${icsEscape(e.title)}`);
      if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
      if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
      lines.push(`URL:${res.locals.baseUrl}/events/${e.id}`);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    res
      .type('text/calendar')
      .setHeader('Content-Disposition', 'inline; filename="events.ics"');
    res.send(`${lines.map(icsFold).join('\r\n')}\r\n`);
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
    const event = result.rows[0];
    res.render('layouts/main', {
      bodyPath: '../pages/event-detail',
      title: event.title,
      metaDescription: metaText(
        event.description,
        `${event.title} at ${churchName(res.locals.church)}.`
      ),
      ogType: 'article',
      event,
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
      metaDescription: metaText(
        `The ministries of ${churchName(res.locals.church)} — find a place to serve, grow, and belong.`
      ),
      ministries: result.rows,
    });
  })
);

// GET /visit — Plan a Visit
router.get('/visit', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/visit',
    title: 'Plan a Visit',
    metaDescription: metaText(
      `Planning your first visit to ${churchName(res.locals.church)}? What to expect, what to wear, where to park, and when we meet.`
    ),
  });
});

// GET /beliefs — What We Believe
router.get('/beliefs', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/beliefs',
    title: 'What We Believe',
    metaDescription: metaText(
      `The statement of faith of ${churchName(res.locals.church)} — what we believe and why it matters.`
    ),
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
      metaDescription: metaText(
        (res.locals.church && res.locals.church.sunday_school_intro),
        `Sunday School classes for every age at ${churchName(res.locals.church)}.`
      ),
      classes: classes.rows,
    });
  })
);

// GET /give
router.get('/give', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/give',
    title: 'Give',
    metaDescription: metaText(
      `Give online to support the ministry of ${churchName(res.locals.church)}.`
    ),
  });
});

// GET /contact
router.get('/contact', (req, res) => {
  res.render('layouts/main', {
    bodyPath: '../pages/contact',
    title: 'Contact',
    metaDescription: metaText(
      `Get in touch with ${churchName(res.locals.church)} — send a message, call, or visit.`
    ),
  });
});

// ── SEO: robots.txt + sitemap.xml ────────────────────────────────────────────
const SITEMAP_STATIC_PATHS = [
  '/', '/about', '/beliefs', '/visit', '/sunday-school',
  '/ministries', '/sermons', '/events', '/give', '/contact',
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      '',
      `Sitemap: ${res.locals.baseUrl}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

router.get(
  '/sitemap.xml',
  catchAsync(async (req, res) => {
    const base = res.locals.baseUrl;
    const [sermons, events] = await Promise.all([
      pool.query('SELECT id, last_modified FROM services ORDER BY id ASC'),
      pool.query('SELECT id, last_modified FROM events ORDER BY id ASC'),
    ]);

    const urls = SITEMAP_STATIC_PATHS.map((p) => ({ loc: base + p }));
    sermons.rows.forEach((r) =>
      urls.push({ loc: `${base}/sermons/${r.id}`, lastmod: r.last_modified })
    );
    events.rows.forEach((r) =>
      urls.push({ loc: `${base}/events/${r.id}`, lastmod: r.last_modified })
    );

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => {
        const lastmod = u.lastmod
          ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>`
          : '';
        return `  <url><loc>${xmlEscape(u.loc)}</loc>${lastmod}</url>`;
      }),
      '</urlset>',
      '',
    ].join('\n');

    res.type('application/xml').send(xml);
  })
);

module.exports = router;
