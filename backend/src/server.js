// src/server.js — SmartSpend Backend (Fixed & Production-Ready)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Rate Limiting — generous limits, skipSuccessfulRequests on auth
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 50,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// 🔥 FIXED Maintenance middleware
app.use((req, res, next) => {
  if (
    req.path === '/api/health' ||
    req.path.startsWith('/api/admin') ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/register' ||
    req.path === '/api/auth/refresh'
  ) return next();

  try {
    const db = require('./db/database');
    const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'maintenance_mode'").get();

    if (setting?.value === 'true') {
      const jwt = require('jsonwebtoken');
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

      if (token) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET);
          const user = db.prepare('SELECT role FROM users WHERE id = ? AND is_active = 1').get(payload.sub);

          if (user?.role === 'admin') {
            return next(); // ✅ allow admin
          }
        } catch (_) {}
      }

      return res.status(503).json({
        error: 'System is under maintenance.',
        code: 'MAINTENANCE_MODE'
      });
    }
  } catch (_) {}

  next();
});

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/budgets',  require('./routes/budgets'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/currency', require('./routes/currency'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SmartSpend API', version: '2.0.0', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({ name: 'SmartSpend REST API', version: '2.0.0', status: 'running' });
});

app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀  SmartSpend API  →  http://localhost:${PORT}`);
  console.log(`📋  Health check   →  http://localhost:${PORT}/api/health`);
  console.log(`🌱  Seed data      →  npm run seed\n`);
});

module.exports = app;