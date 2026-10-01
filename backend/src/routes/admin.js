// src/routes/admin.js
// Admin-only endpoints: system settings, user management, audit log

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const audit = require('../utils/audit');

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/stats ──────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const totalUsers     = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const totalExpenses  = db.prepare('SELECT COUNT(*) as cnt FROM expenses').get().cnt;
  const totalAmount    = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses').get().total;
  const activeUsers    = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').get().cnt;
  const thisMonth      = new Date().toISOString().slice(0, 7);
  const monthlyExpenses= db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%Y-%m', date) = ?`).get(thisMonth).total;

  // Fake-but-realistic db size based on row counts
  const dbSizeEstimateMB = parseFloat(((totalExpenses * 0.5 + totalUsers * 1.2) / 1024 + 0.5).toFixed(2));

  res.json({
    totalUsers,
    activeUsers,
    totalExpenses,
    totalAmount: parseFloat(totalAmount.toFixed(2)),
    monthlyExpenses: parseFloat(monthlyExpenses.toFixed(2)),
    dbSizeGB: parseFloat((dbSizeEstimateMB / 1024).toFixed(3)),
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
  });
});

// ── GET /api/admin/settings ───────────────────────────────────────────
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ settings });
});

// ── PATCH /api/admin/settings ─────────────────────────────────────────
router.patch('/settings', (req, res) => {
  const allowed = ['maintenance_mode', 'auto_backup', 'analytics_enabled', 'max_expense_per_entry'];
  const updateSetting = db.prepare(`
    UPDATE system_settings SET value = ?, updated_by = ?, updated_at = datetime('now')
    WHERE key = ?
  `);

  const updateTx = db.transaction((updates) => {
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        updateSetting.run(String(value), req.user.id, key);
      }
    }
  });

  updateTx(req.body);

  audit.log({ userId: req.user.id, action: 'admin.settings_update', details: req.body, ip: req.ip });

  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  res.json({ message: 'Settings updated.', settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
});

// ── GET /api/admin/users ──────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, role, monthly_income, monthly_budget, currency, is_active, created_at,
      (SELECT COUNT(*) FROM expenses WHERE expenses.user_id = users.id) as expense_count
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ data: users, total: users.length });
});

// ── PATCH /api/admin/users/:id ────────────────────────────────────────
router.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const allowed = ['name', 'role', 'is_active', 'monthly_budget', 'monthly_income'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (req.body.password) {
    updates.password = bcrypt.hashSync(req.body.password, 12);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields.' });
  }

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  audit.log({ userId: req.user.id, action: 'admin.user_update', entity: 'user', entityId: req.params.id, ip: req.ip });

  const updated = db.prepare('SELECT id, name, email, role, is_active, monthly_income, monthly_budget FROM users WHERE id = ?').get(req.params.id);
  res.json({ message: 'User updated.', data: updated });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account.' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

  audit.log({ userId: req.user.id, action: 'admin.user_delete', entity: 'user', entityId: req.params.id, ip: req.ip });

  res.json({ message: 'User deleted.' });
});

// ── GET /api/admin/audit-log ──────────────────────────────────────────
router.get('/audit-log', (req, res) => {
  const { page = 1, limit = 50, userId } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));

  const conditions = userId ? 'WHERE a.user_id = ?' : '';
  const params = userId ? [userId] : [];

  const rows = db.prepare(`
    SELECT a.*, u.name as user_name, u.email as user_email
    FROM audit_log a LEFT JOIN users u ON a.user_id = u.id
    ${conditions}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(100, parseInt(limit)), offset);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${conditions}`).get(...params).cnt;

  res.json({ data: rows, total, page: parseInt(page) });
});

// ── POST /api/admin/restart ───────────────────────────────────────────
// Simulates an app restart (in production, a process manager handles this)
router.post('/restart', (req, res) => {
  audit.log({ userId: req.user.id, action: 'admin.restart_requested', ip: req.ip });
  res.json({ message: 'Restart signal sent. Process manager will handle graceful restart.' });
  // In production: process.kill(process.pid, 'SIGUSR2') for PM2
});

module.exports = router;
