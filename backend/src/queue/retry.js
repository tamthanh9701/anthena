'use strict';

/**
 * Exponential backoff for retry logic.
 * Default: 5s → 15s → 45s
 */

function getRetryDelay(attempt, baseDelay = 5000) {
  // Exponential: base * 3^(attempt-1)
  return baseDelay * Math.pow(3, attempt - 1);
}

function getDefaultBackoff() {
  return [5000, 15000, 45000];
}

function shouldRetry(error, attempt, maxRetries = 3) {
  if (attempt >= maxRetries) return false;
  
  // Permanent failures: don't retry
  const permanentErrors = [404, 401, 403, 400, 422];
  if (error.statusCode && permanentErrors.includes(error.statusCode)) return false;
  if (error.permanent) return false;
  
  return true;
}

module.exports = { getRetryDelay, getDefaultBackoff, shouldRetry };