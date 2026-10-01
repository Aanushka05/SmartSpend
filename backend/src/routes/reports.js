// src/routes/reports.js — SmartSpend Reports + Download
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/reports/overview ──────────────────────────────────
router.get('/overview', (req, res) => {
  const userId = req.user.id;
  const { month } = req.query;
  const thisMonth = month || new Date().toISOString().slice(0, 7);

  const [year, mon] = thisMonth.split('-').map(Number);
  const prevDate = new Date(year, mon - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const user = db.prepare('SELECT monthly_income, monthly_budget FROM users WHERE id = ?').get(userId);

  const thisMonthData = db.prepare(`
    SELECT SUM(amount) as total, COUNT(*) as count, AVG(amount) as avg_per_tx
    FROM expenses WHERE user_id = ? AND strftime('%Y-%m', date) = ?
  `).get(userId, thisMonth);

  const prevMonthData = db.prepare(`
    SELECT SUM(amount) as total FROM expenses
    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
  `).get(userId, prevMonth);

  const thisTotal = thisMonthData.total || 0;
  const prevTotal = prevMonthData.total || 0;
  const cashFlow = user.monthly_income - thisTotal;
  const vsLastMonth = prevTotal > 0
    ? parseFloat(((thisTotal - prevTotal) / prevTotal * 100).toFixed(1))
    : 0;

  const byCategory = db.prepare(`
    SELECT category, SUM(amount) as total, COUNT(*) as count,
           ROUND(SUM(amount) * 100.0 / ?, 1) as pct
    FROM expenses WHERE user_id = ? AND strftime('%Y-%m', date) = ?
    GROUP BY category ORDER BY total DESC
  `).all(thisTotal || 1, userId, thisMonth);

  const daily = db.prepare(`
    SELECT date, SUM(amount) as total
    FROM expenses WHERE user_id = ? AND strftime('%Y-%m', date) = ?
    GROUP BY date ORDER BY date ASC
  `).all(userId, thisMonth);

  const trend = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM expenses WHERE user_id = ? AND date >= date('now', '-5 months', 'start of month')
    GROUP BY month ORDER BY month ASC
  `).all(userId);

  const topTransactions = db.prepare(`
    SELECT * FROM expenses WHERE user_id = ? AND strftime('%Y-%m', date) = ?
    ORDER BY amount DESC LIMIT 5
  `).all(userId, thisMonth);

  const insights = generateInsights({ thisTotal, prevTotal, byCategory, user, vsLastMonth, daily });

  res.json({
    month: thisMonth,
    totalExpenses: thisTotal,
    cashFlow,
    avgDailySpend: daily.length > 0 ? parseFloat((thisTotal / daily.length).toFixed(2)) : 0,
    avgPerTransaction: parseFloat((thisMonthData.avg_per_tx || 0).toFixed(2)),
    transactionCount: thisMonthData.count || 0,
    vsLastMonth,
    topCategory: byCategory[0]?.category || null,
    topCategoryPct: byCategory[0]?.pct || 0,
    byCategory,
    daily,
    trend,
    topTransactions,
    insights,
    monthlyIncome: user.monthly_income,
    monthlyBudget: user.monthly_budget,
  });
});

// ── GET /api/reports/monthly ───────────────────────────────────
router.get('/monthly', (req, res) => {
  const userId = req.user.id;

  const months = db.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(amount) as total,
      COUNT(*) as count,
      AVG(amount) as avg
    FROM expenses
    WHERE user_id = ? AND date >= date('now', '-11 months', 'start of month')
    GROUP BY month
    ORDER BY month ASC
  `).all(userId);

  const filled = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = months.find(x => x.month === m);
    filled.push({
      month: m,
      label: d.toLocaleString('default', { month: 'short' }),
      total: existing ? parseFloat(existing.total.toFixed(2)) : 0,
      count: existing ? existing.count : 0,
    });
  }

  res.json({ data: filled });
});

// ── GET /api/reports/health ────────────────────────────────────
router.get('/health', (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT monthly_income, monthly_budget FROM users WHERE id = ?').get(userId);
  const thisMonth = new Date().toISOString().slice(0, 7);

  const totalExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expenses
    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
  `).get(userId, thisMonth).total;

  const savingsRatio = user.monthly_income > 0
    ? Math.max(0, (user.monthly_income - totalExpenses) / user.monthly_income * 100)
    : 0;

  const budgetAdherence = user.monthly_budget > 0
    ? Math.max(0, 100 - Math.max(0, (totalExpenses - user.monthly_budget) / user.monthly_budget * 100))
    : 100;

  const byCategory = db.prepare(`
    SELECT category, SUM(amount) as total FROM expenses
    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
    GROUP BY category
  `).all(userId, thisMonth);

  let diversityScore = 100;
  if (totalExpenses > 0 && byCategory.length > 0) {
    const maxPct = Math.max(...byCategory.map(c => c.total / totalExpenses * 100));
    diversityScore = maxPct > 60 ? Math.max(0, 100 - (maxPct - 60) * 2) : 100;
  }

  const txCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM expenses
    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
  `).get(userId, thisMonth).cnt;

  const consistencyScore = Math.min(100, txCount * 5);

  const score = Math.round(
    savingsRatio    * 0.40 +
    budgetAdherence * 0.35 +
    diversityScore  * 0.15 +
    consistencyScore * 0.10
  );

  const grade =
    score >= 85 ? 'Excellent' :
    score >= 70 ? 'Good' :
    score >= 55 ? 'Fair' :
    score >= 40 ? 'Poor' : 'Critical';

  res.json({
    score,
    grade,
    components: {
  savingsRatio: {
    raw: Math.round(savingsRatio),
    score: Math.round((savingsRatio / 100) * 40),
    weight: 40,
    label: 'Savings Rate'
  },
  budgetAdherence: {
    raw: Math.round(budgetAdherence),
    score: Math.round((budgetAdherence / 100) * 35),
    weight: 35,
    label: 'Budget Adherence'
  },
  diversity: {
    raw: Math.round(diversityScore),
    score: Math.round((diversityScore / 100) * 15),
    weight: 15,
    label: 'Spending Diversity'
  },
  consistency: {
    raw: Math.round(consistencyScore),
    score: Math.round((consistencyScore / 100) * 10),
    weight: 10,
    label: 'Tracking Consistency'
  },
},
    tips: generateTips({ savingsRatio, budgetAdherence, totalExpenses, user }),
  });
});

// ── GET /api/reports/download ──────────────────────────────────
// Query params: month (YYYY-MM), format (csv|json)
// Downloads expense report for the logged-in user only
router.get('/download', (req, res) => {
  const userId = req.user.id;
  const { month, format = 'csv' } = req.query;

  // Build query — filter by month if provided, else all time
  let expenses;
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    expenses = db.prepare(`
      SELECT date, category, amount, description, notes, currency, created_at
      FROM expenses
      WHERE user_id = ? AND strftime('%Y-%m', date) = ?
      ORDER BY date DESC
    `).all(userId, month);
  } else {
    expenses = db.prepare(`
      SELECT date, category, amount, description, notes, currency, created_at
      FROM expenses
      WHERE user_id = ?
      ORDER BY date DESC
    `).all(userId);
  }

  // Build filename  e.g. SmartSpend_Report_March_2026.csv
  let fileLabel;
  if (month) {
    const d = new Date(month + '-01');
    fileLabel = d.toLocaleString('default', { month: 'long' }) + '_' + d.getFullYear();
  } else {
    fileLabel = 'All_Time';
  }

  if (format === 'json') {
    // JSON download
    const filename = `SmartSpend_Report_${fileLabel}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    return res.json({
      report: {
        generated: new Date().toISOString(),
        user: req.user.email,
        period: month || 'All Time',
        totalRecords: expenses.length,
        totalAmount: expenses.reduce((s, e) => s + e.amount, 0),
        expenses,
      }
    });
  }

  // CSV download (default)
  const filename = `SmartSpend_Report_${fileLabel}.csv`;
  const headers = ['Date', 'Category', 'Amount (INR)', 'Description', 'Notes'];

  const escCsv = (v) => {
    const s = String(v == null ? '' : v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = [
    headers.join(','),
    ...expenses.map(e => [
      escCsv(e.date),
      escCsv(e.category),
      escCsv(e.amount.toFixed(2)),
      escCsv(e.description),
      escCsv(e.notes || ''),
    ].join(','))
  ];

  // Add summary footer
  if (expenses.length > 0) {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    rows.push('');
    rows.push(`Total,,,${total.toFixed(2)},`);
    rows.push(`Records,,,${expenses.length},`);
    rows.push(`Generated,,,${new Date().toISOString()},`);
  }

  const csv = rows.join('\n');

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // UTF-8 BOM so Excel opens ₹ correctly
  res.send('\uFEFF' + csv);
});

// ── Helpers ───────────────────────────────────────────────────
function generateInsights({ thisTotal, prevTotal, byCategory, user, vsLastMonth, daily }) {
  const insights = [];
  if (thisTotal === 0) {
    insights.push({ type: 'info', message: 'Start adding expenses to see smart insights.' });
    return insights;
  }
  if (vsLastMonth > 10)
    insights.push({ type: 'warning', message: `You spent ${vsLastMonth}% more than last month.` });
  else if (vsLastMonth < -10)
    insights.push({ type: 'success', message: `Great! You spent ${Math.abs(vsLastMonth)}% less than last month.` });
  if (byCategory.length > 0)
    insights.push({ type: 'info', message: `Top spending category: ${byCategory[0].category} (${byCategory[0].pct}%)` });
  if (user.monthly_budget > 0) {
    const pct = (thisTotal / user.monthly_budget) * 100;
    if (pct >= 100)
      insights.push({ type: 'danger', message: `⚠️ You have exceeded your monthly budget!` });
    else if (pct >= 80)
      insights.push({ type: 'warning', message: `You have used ${pct.toFixed(0)}% of your monthly budget.` });
  }
  if (daily.length > 0) {
    const avgDaily = thisTotal / daily.length;
    insights.push({ type: 'info', message: `Average daily spend: ₹${avgDaily.toFixed(2)}` });
  }
  return insights;
}

function generateTips({ savingsRatio, budgetAdherence, totalExpenses, user }) {
  const tips = [];
  if (savingsRatio < 20) tips.push('Aim to save at least 20% of your income each month.');
  if (budgetAdherence < 80) tips.push("You've exceeded your budget. Review non-essential expenses.");
  if (totalExpenses === 0) tips.push('Start logging expenses to get accurate health insights.');
  if (user.monthly_income === 0) tips.push('Set your monthly income in settings for accurate savings tracking.');
  if (tips.length === 0) tips.push('Great work! Keep maintaining your financial discipline.');
  return tips;
}

module.exports = router;
