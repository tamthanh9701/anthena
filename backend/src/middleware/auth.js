'use strict';

const config = require('../config');
const crypto = require('crypto');
const { createErrorResponse } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const { getDb } = require('../db');

/**
 * Auth middleware: validates Bearer token on all endpoints except /health, /ready.
 * Accepts two token types:
 *   - admin API token (config.apiToken) — constant-time comparison
 *   - cap_upload_ token (upload_tokens table) — SHA-256 hash lookup
 */
function authMiddleware(req, res, next) {
  // Skip auth for health and readiness endpoints
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    logger.warn({ path: req.path, ip: req.ip }, 'Auth failure: no authorization header');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    logger.warn({ path: req.path }, 'Auth failure: malformed authorization header');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  const token = parts[1];

  // Check admin API token first (constant-time comparison)
  if (config.apiToken && token.length === config.apiToken.length) {
    let match = 0;
    for (let i = 0; i < token.length; i++) {
      match |= token.charCodeAt(i) ^ config.apiToken.charCodeAt(i);
    }
    if (match === 0) {
      req.auth = { type: 'admin' };
      return next();
    }
  }

  // Check upload token (starts with cap_upload_)
  if (token.startsWith('cap_upload_')) {
    try {
      const db = getDb();
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const tokenRow = db.prepare("SELECT * FROM upload_tokens WHERE tokenHash = ?").get(hash);
      if (tokenRow && new Date(tokenRow.expiresAt) > new Date() && !tokenRow.revokedAt) {
        req.auth = { type: 'upload', sessionId: tokenRow.sessionId, tokenId: tokenRow.id };
        return next();
      }
    } catch (e) {
      logger.warn({ path: req.path, err: e.message }, 'Upload token validation failed');
    }
  }

  return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
}

module.exports = authMiddleware;