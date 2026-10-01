// src/utils/audit.js
// Writes to the audit_log table for traceability

const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const insert = db.prepare(`
  INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, ip_address)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.action   - e.g. 'expense.create'
 * @param {string} [opts.entity] - e.g. 'expense'
 * @param {string} [opts.entityId]
 * @param {object} [opts.details]
 * @param {string} [opts.ip]
 */
function log({ userId, action, entity, entityId, details, ip }) {
  try {
    insert.run(
      uuidv4(),
      userId || null,
      action,
      entity || null,
      entityId || null,
      details ? JSON.stringify(details) : null,
      ip || null
    );
  } catch (err) {
    console.error('[Audit] Failed to write log:', err.message);
  }
}

module.exports = { log };
