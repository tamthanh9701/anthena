'use strict';

const { createErrorResponse } = require('../utils/helpers');
const { logger } = require('../utils/logger');

/**
 * Simple in-memory rate limiter.
 * 100 req/min per client IP (generous for single operator).
 */
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

const ipCounts = new Map();

// Cleanup old entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCounts) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      ipCounts.delete(ip);
    }
  }
}, 60 * 1000);

function rateLimiter(req, res, next) {
  // Skip rate limiting for health/ready
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  let entry = ipCounts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    ipCounts.set(ip, entry);
  }

  entry.count++;
  
  // Set rate limit headers
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + WINDOW_MS) / 1000));

  if (entry.count > MAX_REQUESTS) {
    logger.warn({ ip, path: req.path }, 'Rate limit exceeded');
    return res.status(429).json(createErrorResponse(
      'Too many requests. Please slow down.',
      'RATE_LIMITED',
      req.requestId
    ));
  }

  next();
}

module.exports = rateLimiter;