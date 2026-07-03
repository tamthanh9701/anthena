'use strict';

const { logger } = require('../utils/logger');

const MAX_ENTRIES = 1000;
const TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map();

function prune() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > TTL_MS) {
      cache.delete(key);
    }
  }
  if (cache.size > MAX_ENTRIES) {
    const iter = cache.keys();
    while (cache.size > MAX_ENTRIES) {
      cache.delete(iter.next().value);
    }
  }
}

function idempotencyMiddleware(req, res, next) {
  if (req.method !== 'POST') {
    return next();
  }

  const key = req.headers['idempotency-key'];
  if (!key) {
    return next();
  }

  const existing = cache.get(key);
  if (existing) {
    return res.status(409).json({
      error: 'Idempotency-Key already processed',
      code: 'IDEMPOTENCY_CONFLICT',
      requestId: req.requestId,
    });
  }

  cache.set(key, { timestamp: Date.now() });
  prune();

  res.on('finish', () => {
    if (res.statusCode >= 500) {
      cache.delete(key);
    }
  });

  next();
}

module.exports = idempotencyMiddleware;