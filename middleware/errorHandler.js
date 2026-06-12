'use strict';

// Email the admin when a 500 happens in production, throttled to one email per
// 15 minutes (further errors in the window are counted and reported in the
// next email). Fire-and-forget: alerting must never delay or break the response.
const ALERT_WINDOW_MS = 15 * 60 * 1000;
let lastAlertAt = 0;
let suppressedCount = 0;

function sendErrorAlert(err, req, ts) {
  if (
    process.env.NODE_ENV !== 'production' ||
    !process.env.RESEND_API_KEY ||
    !process.env.BACKUP_EMAIL
  ) {
    return;
  }
  const now = Date.now();
  if (now - lastAlertAt < ALERT_WINDOW_MS) {
    suppressedCount += 1;
    return;
  }
  const suppressed = suppressedCount;
  suppressedCount = 0;
  lastAlertAt = now;

  const { Resend } = require('resend');
  const body = [
    `Time: ${ts}`,
    `Request: ${req.method} ${req.originalUrl}`,
    suppressed > 0 ? `(${suppressed} additional error(s) suppressed since the last alert)` : '',
    '',
    err && err.stack ? err.stack : String(err),
  ]
    .filter(Boolean)
    .join('\n');

  new Resend(process.env.RESEND_API_KEY).emails
    .send({
      from: `Church Website <${process.env.CHURCH_CONTACT_EMAIL}>`,
      to: process.env.BACKUP_EMAIL,
      subject: `[website error] ${req.method} ${req.originalUrl}`,
      text: body,
    })
    .then(({ error }) => {
      if (error) console.error(`[${ts}] error-alert email failed:`, error);
    })
    .catch((mailErr) => {
      console.error(`[${ts}] error-alert email failed:`, mailErr);
    });
}

// Central error handler. Logs the full error + stack with a timestamp server-side
// and renders the generic 500 page — never leaks error details to the client.
module.exports = function errorHandler(err, req, res, next) {
  const ts = new Date().toISOString();
  console.error(
    `[${ts}] ERROR handling ${req.method} ${req.originalUrl}\n`,
    err && err.stack ? err.stack : err
  );

  const status = (err && (err.status || err.statusCode)) || 500;
  if (status >= 500) {
    sendErrorAlert(err, req, ts);
  }

  if (res.headersSent) {
    return next(err);
  }

  res.status(status);
  // Errors thrown before the res.locals middleware leave `church` undefined,
  // which the layout reads directly — default it so the 500 page can render.
  res.locals.church = res.locals.church || null;
  // res.render reports template failures via callback (not a throw), so a
  // try/catch can't intercept them — handle them here instead.
  res.render(
    'layouts/main',
    {
      bodyPath: '../pages/500',
      title: 'Something went wrong',
    },
    (renderErr, html) => {
      if (renderErr) {
        console.error(`[${ts}] failed to render 500 page:`, renderErr);
        return res.type('text/plain').send('Something went wrong. Please try again later.');
      }
      res.send(html);
    }
  );
};
