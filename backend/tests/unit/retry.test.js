/**
 * @file retry.test.js
 * @description Unit tests for retry logic with exponential backoff
 * 
 * Imports the real retry module from src/queue/retry.js
 * 
 * Covers AC-P1-02-06 through AC-P1-02-08:
 *   - Exponential backoff: 5s, 15s, 45s defaults
 *   - Permanent failures not retried (404, 401, 403)
 *   - Max retry count enforcement
 */

import { describe, it, expect } from 'vitest';

const { getRetryDelay, getDefaultBackoff, shouldRetry } = require('../../src/queue/retry.js');

describe('Retry — Exponential Backoff (AC-P1-02-06)', () => {
  it('first retry delay = baseDelay (5s default)', () => {
    expect(getRetryDelay(1)).toBe(5000);
    expect(getRetryDelay(1, 5000)).toBe(5000);
  });

  it('second retry delay = base × 3 (15s)', () => {
    expect(getRetryDelay(2)).toBe(15000);
  });

  it('third retry delay = base × 9 (45s)', () => {
    expect(getRetryDelay(3)).toBe(45000);
  });

  it('uses custom base delay', () => {
    expect(getRetryDelay(1, 10000)).toBe(10000);
    expect(getRetryDelay(2, 10000)).toBe(30000);
    expect(getRetryDelay(3, 10000)).toBe(90000);
  });

  it('default backoff array matches expected values', () => {
    expect(getDefaultBackoff()).toEqual([5000, 15000, 45000]);
  });
});

describe('Retry — shouldRetry (AC-P1-02-07, AC-P1-02-08)', () => {
  it('retries transient errors up to maxRetries', () => {
    const error = { statusCode: 500 };
    expect(shouldRetry(error, 0)).toBe(true);
    expect(shouldRetry(error, 1)).toBe(true);
    expect(shouldRetry(error, 2)).toBe(true);
  });

  it('stops retrying when attempt >= maxRetries', () => {
    const error = { statusCode: 500 };
    expect(shouldRetry(error, 3)).toBe(false);
    expect(shouldRetry(error, 3, 3)).toBe(false);
  });

  it('default maxRetries is 3', () => {
    const error = { statusCode: 500 };
    expect(shouldRetry(error, 0)).toBe(true);
    expect(shouldRetry(error, 1)).toBe(true);
    expect(shouldRetry(error, 2)).toBe(true);
    expect(shouldRetry(error, 3)).toBe(false);
  });

  it('TC-P1-02-07: does not retry permanent 404 error', () => {
    const error = { statusCode: 404 };
    expect(shouldRetry(error, 0)).toBe(false);
  });

  it('does not retry 401 (auth) errors', () => {
    expect(shouldRetry({ statusCode: 401 }, 0)).toBe(false);
  });

  it('does not retry 403 (forbidden) errors', () => {
    expect(shouldRetry({ statusCode: 403 }, 0)).toBe(false);
  });

  it('does not retry 400 (bad request) errors', () => {
    expect(shouldRetry({ statusCode: 400 }, 0)).toBe(false);
  });

  it('does not retry 422 (validation) errors', () => {
    expect(shouldRetry({ statusCode: 422 }, 0)).toBe(false);
  });

  it('does not retry permanent errors flagged with permanent=true', () => {
    expect(shouldRetry({ permanent: true }, 0)).toBe(false);
  });

  it('TC-P1-02-08: uses custom maxRetries=5', () => {
    const error = { statusCode: 500 };
    expect(shouldRetry(error, 4, 5)).toBe(true);
    expect(shouldRetry(error, 5, 5)).toBe(false);
  });

  it('does not retry if retryCount=0', () => {
    const error = { statusCode: 500 };
    expect(shouldRetry(error, 0, 0)).toBe(false);
  });
});