// src/middleware/auth.js
// Verifies JWT on protected routes and injects req.user

const jwt = require('jsonwebtoken');
const db = require('../db/database');

/**
 * Middleware: require a valid JWT access token.
 * On success, injects { id, email, role, name } into req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Confirm user still exists and is active
    const user = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(payload.sub);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated.' });
    }

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid access token.' });
  }
}

/**
 * Middleware: require admin role.
 * Must be used AFTER requireAuth.
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

/**
 * Middleware: optionally authenticate (doesn't fail if no token).
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ? AND is_active = 1').get(payload.sub);
      if (user) req.user = user;
    } catch (_) { /* ignore */ }
  }
  next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
