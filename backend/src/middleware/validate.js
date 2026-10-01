// src/middleware/validate.js
// express-validator helpers for clean request validation

const { validationResult, body, param, query } = require('express-validator');

/**
 * Runs express-validator checks and short-circuits with 422 on failure.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

// ── Rule sets ────────────────────────────────────────────────────────

const CATEGORIES = ['Housing', 'Food & Dining', 'Transportation', 'Utilities', 'Entertainment', 'Healthcare', 'Other'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'MXN'];

const expenseRules = [
  body('amount')
    .isFloat({ gt: 0, max: 999999 })
    .withMessage('Amount must be a positive number (max 999,999).'),
  body('category')
    .isIn(CATEGORIES)
    .withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
  body('date')
    .isISO8601()
    .withMessage('Date must be a valid ISO 8601 date (YYYY-MM-DD).'),
  body('description')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Description must be 2–200 characters.'),
  body('currency')
    .optional()
    .isIn(CURRENCIES)
    .withMessage(`Currency must be one of: ${CURRENCIES.join(', ')}`),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
  body('is_recurring')
    .optional()
    .isBoolean()
    .withMessage('is_recurring must be a boolean.'),
];

const registerRules = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Name must be 2–80 characters.'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('A valid email is required.'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
];

const budgetRules = [
  body('category').isIn(CATEGORIES).withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
  body('limit_amount').isFloat({ gt: 0 }).withMessage('Limit must be a positive number.'),
  body('month').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Month must be YYYY-MM format.'),
];

const idParam = param('id').notEmpty().withMessage('ID required.');

module.exports = { validate, expenseRules, registerRules, loginRules, budgetRules, idParam };
