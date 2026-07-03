'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique requestId to every request.
 */
function requestIdMiddleware(req, res, next) {
  req.requestId = `req-${uuidv4().slice(0, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestIdMiddleware;