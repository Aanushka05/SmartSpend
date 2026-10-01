// src/routes/expenses.js
// Full CRUD for expenses + aggregation for dashboard charts

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { validate, expenseRules, idParam } = require('../middleware/validate');
const audit = require('../utils/audit');

// All expense routes require auth
router.use(requireAuth);

// ── GET /api/expenses ─────────────────────────────────────────────────
// Query params: category, month (YYYY-MM), search, sort, order, page, limit
router.get('/', (req, res) => {
  const { category, month, search, sort = 'date', order = 'desc', page = 1, limit = 50 } = req.query;

  const conditions = ['user_id = ?'];
  const params = [req.user.id];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (month) {
    conditions.push("strftime('%Y-%m', date) = ?");
    params.push(month);
  }
  if (search) {
    conditions.push('(description LIKE ? OR category LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const allowedSorts = ['date', 'amount', 'category', 'created_at'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'date';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
  const pageLimit = Math.min(100, parseInt(limit));

  const where = conditions.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM expenses WHERE ${where}`).get(...params).cnt;
  const expenses = db.prepare(`
    SELECT * FROM expenses WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, pageLimit, offset);

  res.json({
    data: expenses,
    pagination: {
      total,
      page: parseInt(page),
      limit: pageLimit,
      pages: Math.ceil(total / pageLimit),
    }
  });
});

// ── GET /api/expenses/summary ─────────────────────────────────────────
// Dashboard numbers: total expenses, savings, budget remaining, by-category
router.get('/summary', (req, res) => {
  const { month } = req.query;
  const userId = req.user.id;

  // Get user's budget and income settings
  const user = db.prepare('SELECT monthly_income, monthly_budget FROM users WHERE id = ?').get(userId);

  const monthFilter = month || new Date().toISOString().slice(0, 7);

  const expenses = db.prepare(`
    SELECT amount, category FROM expenses
    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
  `).all(userId, monthFilter);

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalSavings = user.monthly_income - totalExpenses;
  const budgetRemaining = Math.max(0, user.monthly_budget - totalExpenses);
  const budgetUsedPct = user.monthly_budget > 0
    ? Math.min(100, (totalExpenses / user.monthly_budget) * 100)
    : 0;

  // Category breakdown
  const byCategory = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }

  // Monthly trend (last 6 months)
  const trend = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM expenses
    WHERE user_id = ? AND date >= date('now', '-6 months')
    GROUP BY month
    ORDER BY month ASC
  `).all(userId);

  res.json({
    month: monthFilter,
    totalExpenses,
    totalSavings,
    budgetRemaining,
    budgetUsedPct: parseFloat(budgetUsedPct.toFixed(2)),
    monthlyIncome: user.monthly_income,
    monthlyBudget: user.monthly_budget,
    byCategory,
    trend,
    transactionCount: expenses.length,
  });
});

// ── GET /api/expenses/:id ─────────────────────────────────────────────
router.get('/:id', idParam, validate, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  res.json({ data: expense });
});

// ── POST /api/expenses ────────────────────────────────────────────────
router.post('/', expenseRules, validate, (req, res) => {
  const { amount, category, date, description, currency = 'USD', notes, is_recurring = false } = req.body;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO expenses (id, user_id, amount, category, date, description, currency, notes, is_recurring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, amount, category, date, description.trim(), currency, notes || null, is_recurring ? 1 : 0);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);

  audit.log({ userId: req.user.id, action: 'expense.create', entity: 'expense', entityId: id, details: { amount, category }, ip: req.ip });

  res.status(201).json({ message: 'Expense added.', data: expense });
});

// ── PUT /api/expenses/:id ─────────────────────────────────────────────
router.put('/:id', [idParam, ...expenseRules], validate, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });

  const { amount, category, date, description, currency = 'USD', notes, is_recurring } = req.body;

  db.prepare(`
    UPDATE expenses SET amount=?, category=?, date=?, description=?, currency=?, notes=?, is_recurring=?
    WHERE id = ? AND user_id = ?
  `).run(amount, category, date, description.trim(), currency, notes || null, is_recurring ? 1 : 0, req.params.id, req.user.id);

  const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);

  audit.log({ userId: req.user.id, action: 'expense.update', entity: 'expense', entityId: req.params.id, ip: req.ip });

  res.json({ message: 'Expense updated.', data: updated });
});

// ── PATCH /api/expenses/:id ───────────────────────────────────────────
// Partial update
router.patch('/:id', idParam, validate, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });

  const allowed = ['amount', 'category', 'date', 'description', 'currency', 'notes', 'is_recurring'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided.' });
  }

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE expenses SET ${setClause} WHERE id = ? AND user_id = ?`)
    .run(...Object.values(updates), req.params.id, req.user.id);

  const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  res.json({ message: 'Expense patched.', data: updated });
});

// ── DELETE /api/expenses/:id ──────────────────────────────────────────
router.delete('/:id', idParam, validate, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });

  db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  audit.log({ userId: req.user.id, action: 'expense.delete', entity: 'expense', entityId: req.params.id, details: { amount: expense.amount, category: expense.category }, ip: req.ip });

  res.json({ message: 'Expense deleted.' });
});

// ── DELETE /api/expenses (bulk) ───────────────────────────────────────
router.delete('/', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required.' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM expenses WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);

  audit.log({ userId: req.user.id, action: 'expense.bulk_delete', details: { count: result.changes }, ip: req.ip });

  res.json({ message: `${result.changes} expense(s) deleted.` });
});

module.exports = router;
