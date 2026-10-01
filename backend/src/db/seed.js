// src/db/seed.js
// Seeds the database with the admin user and sample expenses.
// Run once: node src/db/seed.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

console.log('🌱  Seeding SmartSpend database...\n');

// ── Admin User ─────────────────────────────────────────────────────
const adminEmail = process.env.ADMIN_EMAIL || 'admin@smartspend.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'anushka';
const adminName = process.env.ADMIN_NAME || 'System Administrator';

const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

let adminId;
if (!existingAdmin) {
  adminId = uuidv4();
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, monthly_income, monthly_budget, currency, avatar_initials)
    VALUES (?, ?, ?, ?, 'admin', 8450, 5000, 'USD', 'SA')
  `).run(adminId, adminName, adminEmail, hash);
  console.log(`✅  Admin user created: ${adminEmail} / ${adminPassword}`);
} else {
  adminId = existingAdmin.id;
  console.log(`ℹ️   Admin user already exists, skipping.`);
}

// ── Demo User ──────────────────────────────────────────────────────
const demoEmail = 'alex@smartspend.com';
const existingDemo = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);

let demoId;
if (!existingDemo) {
  demoId = uuidv4();
  const hash = bcrypt.hashSync('password123', 12);
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, monthly_income, monthly_budget, currency, avatar_initials)
    VALUES (?, 'Alex Carter', ?, ?, 'user', 8450, 5000, 'USD', 'AC')
  `).run(demoId, demoEmail, hash);
  console.log(`✅  Demo user created: ${demoEmail} / password123`);
} else {
  demoId = existingDemo.id;
  console.log(`ℹ️   Demo user already exists, skipping.`);
}

// ── Sample Expenses ────────────────────────────────────────────────
const existingExpenses = db.prepare('SELECT COUNT(*) as cnt FROM expenses WHERE user_id = ?').get(demoId);

if (existingExpenses.cnt === 0) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = now.getMonth() === 0
    ? `${now.getFullYear() - 1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

  const sampleExpenses = [
    { amount: 1850, category: 'Housing',          date: `${thisMonth}-01`, description: 'Monthly Rent',         currency: 'USD' },
    { amount: 125,  category: 'Food & Dining',    date: `${thisMonth}-03`, description: 'Grocery Shopping',     currency: 'USD' },
    { amount: 45,   category: 'Transportation',   date: `${thisMonth}-04`, description: 'Fuel - Toyota',        currency: 'USD' },
    { amount: 85,   category: 'Utilities',        date: `${thisMonth}-05`, description: 'Electricity Bill',     currency: 'USD' },
    { amount: 15,   category: 'Entertainment',    date: `${thisMonth}-06`, description: 'Netflix Subscription', currency: 'USD' },
    { amount: 60,   category: 'Healthcare',       date: `${thisMonth}-08`, description: 'Pharmacy',             currency: 'USD' },
    { amount: 220,  category: 'Food & Dining',    date: `${thisMonth}-10`, description: 'Restaurant - Birthday',currency: 'USD' },
    { amount: 35,   category: 'Transportation',   date: `${thisMonth}-12`, description: 'Uber Rides',           currency: 'USD' },
    { amount: 99,   category: 'Entertainment',    date: `${thisMonth}-14`, description: 'Spotify + Apple TV',   currency: 'USD' },
    { amount: 150,  category: 'Utilities',        date: `${thisMonth}-15`, description: 'Internet & Phone',     currency: 'USD' },
    // Last month
    { amount: 1850, category: 'Housing',          date: `${lastMonth}-01`, description: 'Monthly Rent',         currency: 'USD' },
    { amount: 95,   category: 'Food & Dining',    date: `${lastMonth}-05`, description: 'Supermarket',          currency: 'USD' },
    { amount: 300,  category: 'Healthcare',       date: `${lastMonth}-10`, description: 'Dentist Visit',        currency: 'USD' },
    { amount: 80,   category: 'Transportation',   date: `${lastMonth}-15`, description: 'Monthly Transit Pass', currency: 'USD' },
    { amount: 45,   category: 'Entertainment',    date: `${lastMonth}-20`, description: 'Cinema & Dinner',      currency: 'USD' },
  ];

  const insert = db.prepare(`
    INSERT INTO expenses (id, user_id, amount, category, date, description, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((expenses) => {
    for (const e of expenses) {
      insert.run(uuidv4(), demoId, e.amount, e.category, e.date, e.description, e.currency);
    }
  });

  insertMany(sampleExpenses);
  console.log(`✅  ${sampleExpenses.length} sample expenses seeded for Alex Carter.`);
} else {
  console.log(`ℹ️   Expenses already exist, skipping.`);
}

// ── Sample Budgets ─────────────────────────────────────────────────
const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const existingBudgets = db.prepare('SELECT COUNT(*) as cnt FROM budgets WHERE user_id = ? AND month = ?').get(demoId, thisMonth);

if (existingBudgets.cnt === 0) {
  const budgets = [
    { category: 'Housing',        limit_amount: 2000 },
    { category: 'Food & Dining',  limit_amount: 500  },
    { category: 'Transportation', limit_amount: 200  },
    { category: 'Utilities',      limit_amount: 300  },
    { category: 'Entertainment',  limit_amount: 150  },
    { category: 'Healthcare',     limit_amount: 200  },
  ];

  const insertBudget = db.prepare(`
    INSERT OR IGNORE INTO budgets (id, user_id, category, limit_amount, month)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const b of budgets) {
    insertBudget.run(uuidv4(), demoId, b.category, b.limit_amount, thisMonth);
  }
  console.log(`✅  ${budgets.length} budget categories seeded.`);
}

console.log('\n🚀  Seed complete! Start the server with: npm run dev\n');
process.exit(0);
