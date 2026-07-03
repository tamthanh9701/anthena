'use strict';

const { createErrorResponse } = require('../utils/helpers');
const { logger } = require('../utils/logger');

/**
 * Global error handler. Catches unhandled errors, logs them securely,
 * and returns a sanitized error response (no stack trace leak).
 */
function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'unknown';

  logger.error({
    requestId,
    path: req.path,
    method: req.method,
    err: err.message,
    stack: err.stack,
  }, 'Unhandled error');

  // Determine status code
  let statusCode = err.statusCode || err.status || 500;
  if (statusCode < 400) statusCode = 500;

  const errorBody = createErrorResponse(
    statusCode === 500 ? 'Internal server error' : err.message,
    err.code || 'INTERNAL_ERROR',
    requestId
  );

  res.status(statusCode).json(errorBody);
}

/**
 * 404 handler for unknown routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json(createErrorResponse(
    `Route not found: ${req.method} ${req.path}`,
    'NOT_FOUND',
    req.requestId
  ));
}

module.exports = { errorHandler, notFoundHandler };