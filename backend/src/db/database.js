// src/db/database.js
// ─────────────────────────────────────────────────────────────────
//  SQLite database initializer using better-sqlite3 (synchronous,
//  zero-config, production-grade for single-server deployments).
// ─────────────────────────────────────────────────────────────────

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/smartspend.db';
const dbDir = path.dirname(path.resolve(DB_PATH));

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ─── Schema ────────────────────────────────────────────────────────

db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    monthly_income  REAL NOT NULL DEFAULT 0,
    monthly_budget  REAL NOT NULL DEFAULT 5000,
    currency    TEXT NOT NULL DEFAULT 'USD',
    avatar_initials TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Refresh tokens (for multi-device logout)
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Expenses
  CREATE TABLE IF NOT EXISTS expenses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      REAL NOT NULL CHECK(amount > 0),
    category    TEXT NOT NULL,
    date        TEXT NOT NULL,
    description TEXT NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    notes       TEXT,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Budget categories (per user)
  CREATE TABLE IF NOT EXISTS budgets (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    limit_amount REAL NOT NULL CHECK(limit_amount > 0),
    month       TEXT NOT NULL,  -- YYYY-MM format
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, category, month)
  );

  -- System settings (admin-controlled)
  CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  TEXT REFERENCES users(id),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Audit log
  CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity      TEXT,
    entity_id   TEXT,
    details     TEXT,
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date    ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
  CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

  -- Default system settings
  INSERT OR IGNORE INTO system_settings(key, value) VALUES
    ('maintenance_mode', 'false'),
    ('auto_backup', 'true'),
    ('analytics_enabled', 'true'),
    ('app_version', '1.0.0'),
    ('max_expense_per_entry', '999999');
`);

// Auto-update updated_at trigger for users
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_users_updated
  AFTER UPDATE ON users
  BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_expenses_updated
  AFTER UPDATE ON expenses
  BEGIN
    UPDATE expenses SET updated_at = datetime('now') WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_budgets_updated
  AFTER UPDATE ON budgets
  BEGIN
    UPDATE budgets SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`);

module.exports = db;
