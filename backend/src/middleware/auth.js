'use strict';

const config = require('../config');
const { createErrorResponse } = require('../utils/helpers');
const { logger } = require('../utils/logger');

/**
 * Auth middleware: validates Bearer token on all endpoints except /health, /ready.
 * Uses constant-time comparison to prevent timing side-channels.
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

  // Constant-time comparison
  if (token.length !== config.apiToken.length) {
    logger.warn({ path: req.path }, 'Auth failure: invalid token length');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  let match = 0;
  for (let i = 0; i < token.length; i++) {
    match |= token.charCodeAt(i) ^ config.apiToken.charCodeAt(i);
  }

  if (match !== 0) {
    logger.warn({ path: req.path }, 'Auth failure: invalid token');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  next();
}

module.exports = authMiddleware;