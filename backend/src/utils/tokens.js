// src/utils/tokens.js
// JWT generation and refresh token management

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function generateRefreshToken(userId) {
  const tokenId = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti: tokenId },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' }
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, userId, token, expiresAt.toISOString());

  return token;
}

function revokeRefreshToken(token) {
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
}

function revokeAllUserTokens(userId) {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  const record = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(token);
  if (!record || new Date(record.expires_at) < new Date()) {
    throw new Error('Refresh token invalid or expired.');
  }
  return payload;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  verifyRefreshToken,
};
