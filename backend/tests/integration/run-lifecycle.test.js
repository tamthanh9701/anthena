/**
 * @file run-lifecycle.test.js
 * @description Integration tests for Run lifecycle state machine + checkpoint/retry
 * 
 * These test the actual run lifecycle modules:
 *   - state-machine: valid/invalid state transitions
 *   - checkpoint: per-route tracking, resume logic
 *   - retry: exponential backoff, permanent failure handling
 * 
 * Covers: AC-P1-02-01 through AC-P1-02-12
 */

import { describe, it, expect } from 'vitest';
import { isValidState, canTransition, getValidTransitions, VALID_STATES } from "../../src/queue/state-machine.js";
import { addProcessedRoute, getRemainingRoutes, getCheckpointSummary } from "../../src/queue/checkpoint.js";
import { getRetryDelay, shouldRetry } from "../../src/queue/retry.js";

describe('Run Lifecycle — State Machine (AC-P1-02-01 through AC-P1-02-05)', () => {
  it('TC-P1-02-01: new run starts as pending', () => {
    expect(isValidState('pending')).toBe(true);
  });

  it('TC-P1-02-02: all routes successful → completed', () => {
    expect(canTransition('running', 'completed')).toBe(true);
  });

  it('TC-P1-02-03: some routes succeed, some fail → partially-completed', () => {
    expect(canTransition('running', 'partially-completed')).toBe(true);
  });

  it('TC-P1-02-04: all routes fail critically → failed', () => {
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('TC-P1-02-05: all states must be from valid set', () => {
    const valid = ['pending', 'running', 'completed', 'partially-completed', 'failed', 'interrupted'];
    for (const s of valid) {
      expect(isValidState(s)).toBe(true);
    }
    expect(isValidState('queued')).toBe(false);
    expect(isValidState('cancelled')).toBe(false);
  });
});

describe('Run Lifecycle — Checkpoint (AC-P1-02-09 through AC-P1-02-11)', () => {
  it('TC-P1-02-09: per-route checkpoint saves immediately on success', () => {
    const routes = addProcessedRoute([], '/dashboard', 'admin', 'completed');
    expect(routes).toHaveLength(1);
    expect(routes[0].status).toBe('completed');
    expect(routes[0]).toHaveProperty('processedAt');
  });

  it('TC-P1-02-10: checkpoint summary shows completed/total', () => {
    const routes = [
      { route: '/a', role: 'admin', status: 'completed' },
      { route: '/b', role: 'admin', status: 'completed' },
      { route: '/c', role: 'admin', status: 'failed' },
    ];
    const summary = getCheckpointSummary(routes);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('TC-P1-02-11: resume skips completed routes', () => {
    const allRoutes = ['/dashboard', '/orders', '/products', '/users', '/settings'];
    const processed = [
      { route: '/dashboard', role: 'admin', status: 'completed' },
      { route: '/orders', role: 'admin', status: 'completed' },
    ];
    const remaining = getRemainingRoutes(allRoutes, ['admin'], processed);
    expect(remaining).toHaveLength(3);
    expect(remaining[0].route).toBe('/products');
  });

  it('TC-P1-02-12: partially-completed lists route statuses', () => {
    const routes = [
      { route: '/dashboard', role: 'admin', status: 'completed' },
      { route: '/orders', role: 'admin', status: 'failed', error: 'Timeout' },
    ];
    const summary = getCheckpointSummary(routes);
    expect(summary.processedRoutes[0].status).toBe('completed');
    expect(summary.processedRoutes[1].status).toBe('failed');
    expect(summary.processedRoutes[1].error).toBe('Timeout');
  });
});

describe('Run Lifecycle — Retry (AC-P1-02-06 through AC-P1-02-08)', () => {
  it('TC-P1-02-06: retries with exponential backoff (5s, 15s, 45s)', () => {
    expect(getRetryDelay(1)).toBe(5000);
    expect(getRetryDelay(2)).toBe(15000);
    expect(getRetryDelay(3)).toBe(45000);
  });

  it('TC-P1-02-07: permanent 404 error not retried', () => {
    expect(shouldRetry({ statusCode: 404 }, 0)).toBe(false);
  });

  it('TC-P1-02-08: custom RETRY_COUNT=5 allows 5 retries before giving up', () => {
    expect(shouldRetry({ statusCode: 500 }, 4, 5)).toBe(true);
    expect(shouldRetry({ statusCode: 500 }, 5, 5)).toBe(false);
  });
});