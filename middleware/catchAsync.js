'use strict';

// Wraps an async route handler so any rejected promise is forwarded to the
// central Express error handler instead of crashing the process.
module.exports = function catchAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
