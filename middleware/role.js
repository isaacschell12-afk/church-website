'use strict';

// Role gate. Usage: router.get('/admin/church', auth, requireRole('superadmin'), handler)
// On insufficient role, renders the friendly 403 page. Must run after auth so
// req.user is populated.
module.exports = function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).render('layouts/main', {
        bodyPath: '../pages/403',
        title: 'Access denied',
      });
    }
    return next();
  };
};
