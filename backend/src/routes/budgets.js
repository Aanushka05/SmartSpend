// src/routes/budgets.js
// Budget CRUD + spending vs budget comparison

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { validate, budgetRules, idParam } = require('../middleware/validate');

router.use(requireAuth);

// ── GET /api/budgets ──────────────────────────────────────────────────
// Returns budgets for a month with actual spending merged in
router.get('/', (req, res) => {
  const userId = req.user.id;
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const budgets = db.prepare(`
    SELECT b.*,
      COALESCE(SUM(e.amount), 0) as spent,
      ROUND(COALESCE(SUM(e.amount), 0) / b.limit_amount * 100, 1) as used_pct
    FROM budgets b
    LEFT JOIN expenses e
      ON e.user_id = b.user_id
      AND e.category = b.category
      AND strftime('%Y-%m', e.date) = b.month
    WHERE b.user_id = ? AND b.month = ?
    GROUP BY b.id
    ORDER BY b.category ASC
  `).all(userId, month);

  res.json({ month, data: budgets });
});

// ── POST /api/budgets ─────────────────────────────────────────────────
router.post('/', budgetRules, validate, (req, res) => {
  const { category, limit_amount, month } = req.body;
  const userId = req.user.id;

  // Upsert: update if exists, insert if not
  const existing = db.prepare('SELECT id FROM budgets WHERE user_id = ? AND category = ? AND month = ?').get(userId, category, month);

  if (existing) {
    db.prepare('UPDATE budgets SET limit_amount = ? WHERE id = ?').run(limit_amount, existing.id);
    const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(existing.id);
    return res.json({ message: 'Budget updated.', data: updated });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO budgets (id, user_id, category, limit_amount, month)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, category, limit_amount, month);

  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  res.status(201).json({ message: 'Budget created.', data: budget });
});

// ── PUT /api/budgets/:id ──────────────────────────────────────────────
router.put('/:id', [idParam, ...budgetRules], validate, (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found.' });

  const { category, limit_amount, month } = req.body;
  db.prepare('UPDATE budgets SET category=?, limit_amount=?, month=? WHERE id = ?')
    .run(category, limit_amount, month, req.params.id);

  const updated = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  res.json({ message: 'Budget updated.', data: updated });
});

// ── DELETE /api/budgets/:id ───────────────────────────────────────────
router.delete('/:id', idParam, validate, (req, res) => {
  const budget = db.prepare('SELECT id FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found.' });

  db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
  res.json({ message: 'Budget deleted.' });
});

module.exports = router;
