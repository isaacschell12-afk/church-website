'use strict';

// Central error handler. Logs the full error + stack with a timestamp server-side
// and renders the generic 500 page — never leaks error details to the client.
module.exports = function errorHandler(err, req, res, next) {
  const ts = new Date().toISOString();
  console.error(
    `[${ts}] ERROR handling ${req.method} ${req.originalUrl}\n`,
    err && err.stack ? err.stack : err
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status((err && (err.status || err.statusCode)) || 500);
  try {
    return res.render('layouts/main', {
      bodyPath: '../pages/500',
      title: 'Something went wrong',
    });
  } catch (renderErr) {
    console.error(`[${ts}] failed to render 500 page:`, renderErr);
    return res.type('text/plain').send('Something went wrong. Please try again later.');
  }
};
