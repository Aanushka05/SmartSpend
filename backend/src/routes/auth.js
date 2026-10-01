// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, revokeRefreshToken, revokeAllUserTokens } = require('../utils/tokens');
const { requireAuth } = require('../middleware/auth');
const { validate, registerRules, loginRules } = require('../middleware/validate');
const audit = require('../utils/audit');

// POST /api/auth/register
router.post('/register', registerRules, validate, (req, res) => {
  const { name, email, password } = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = bcrypt.hashSync(password, 12);
  const id = uuidv4();
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  db.prepare(`
    INSERT INTO users (id, name, email, password, role, monthly_income, monthly_budget, currency, avatar_initials)
    VALUES (?, ?, ?, ?, 'user', 0, 5000, 'USD', ?)
  `).run(id, name.trim(), email, hash, initials);

  const user = db.prepare('SELECT id, name, email, role, monthly_income, monthly_budget, currency, avatar_initials, created_at FROM users WHERE id = ?').get(id);
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user.id);

  audit.log({ userId: id, action: 'auth.register', entity: 'user', entityId: id, ip: req.ip });
  res.status(201).json({ message: 'Account created successfully.', user, accessToken, refreshToken });
});

// POST /api/auth/login
router.post('/login', loginRules, validate, (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated.' });

  // 🔥 ADDED: Maintenance Mode Check (ONLY THIS PART)
  if (user.role !== 'admin') {
    const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'maintenance_mode'").get();
    if (setting?.value === 'true') {
      return res.status(503).json({
        error: 'System is under maintenance.',
        code: 'MAINTENANCE_MODE'
      });
    }
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user.id);
  const { password: _, ...safeUser } = user;

  audit.log({ userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip: req.ip });
  res.json({ message: 'Logged in successfully.', user: safeUser, accessToken, refreshToken });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ? AND is_active = 1').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    revokeRefreshToken(refreshToken);
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user.id);
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  const { refreshToken, allDevices } = req.body;
  if (allDevices) revokeAllUserTokens(req.user.id);
  else if (refreshToken) revokeRefreshToken(refreshToken);
  audit.log({ userId: req.user.id, action: 'auth.logout', ip: req.ip });
  res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, email, role, monthly_income, monthly_budget, currency, avatar_initials, is_active, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// PATCH /api/auth/me — update profile/password
router.patch('/me', requireAuth, (req, res) => {
  const allowed = ['name', 'monthly_income', 'monthly_budget', 'currency', 'avatar_initials'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (req.body.password) {
    if (!req.body.current_password) return res.status(400).json({ error: 'current_password required.' });
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(req.body.current_password, user.password))
      return res.status(401).json({ error: 'Current password is incorrect.' });
    updates.password = bcrypt.hashSync(req.body.password, 12);
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.user.id);

  const updated = db.prepare(`
    SELECT id, name, email, role, monthly_income, monthly_budget, currency, avatar_initials, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);
  res.json({ message: 'Profile updated.', user: updated });
});

// PATCH /api/auth/settings — update income/budget settings
router.patch('/settings', requireAuth, (req, res) => {
  const { monthly_income, monthly_budget, currency } = req.body;
  const updates = {};
  if (monthly_income !== undefined) updates.monthly_income = parseFloat(monthly_income);
  if (monthly_budget !== undefined) updates.monthly_budget = parseFloat(monthly_budget);
  if (currency !== undefined) updates.currency = currency;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No settings provided.' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.user.id);

  const user = db.prepare('SELECT id, name, email, role, monthly_income, monthly_budget, currency, avatar_initials FROM users WHERE id = ?').get(req.user.id);
  audit.log({ userId: req.user.id, action: 'auth.settings_update', details: updates, ip: req.ip });
  res.json({ message: 'Settings updated.', user });
});

module.exports = router;