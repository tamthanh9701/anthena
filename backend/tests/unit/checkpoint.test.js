/**
 * @file checkpoint.test.js
 * @description Unit tests for checkpoint/resume logic
 * 
 * Imports the real checkpoint module from src/queue/checkpoint.js
 * 
 * Covers AC-P1-02-09 through AC-P1-02-11:
 *   - Per-route checkpoint saving
 *   - Remaining route calculation for resume
 *   - Checkpoint summary
 */

import { describe, it, expect } from 'vitest';

const { addProcessedRoute, getRemainingRoutes, getCheckpointSummary } = require('../../src/queue/checkpoint.js');

describe('Checkpoint — addProcessedRoute', () => {
  it('TC-P1-02-09: adds a completed route to processed list', () => {
    const routes = addProcessedRoute([], '/dashboard', 'admin', 'completed');
    expect(routes).toHaveLength(1);
    expect(routes[0].route).toBe('/dashboard');
    expect(routes[0].role).toBe('admin');
    expect(routes[0].status).toBe('completed');
    expect(routes[0]).toHaveProperty('processedAt');
  });

  it('adds multiple routes in sequence', () => {
    let routes = addProcessedRoute([], '/dashboard', 'admin', 'completed');
    routes = addProcessedRoute(routes, '/orders', 'admin', 'completed');
    routes = addProcessedRoute(routes, '/products', 'admin', 'failed', 'Timeout');
    expect(routes).toHaveLength(3);
  });

  it('updates existing route entry on re-process', () => {
    let routes = addProcessedRoute([], '/dashboard', 'admin', 'failed', 'First attempt timeout');
    expect(routes[0].retryCount).toBe(0);
    routes = addProcessedRoute(routes, '/dashboard', 'admin', 'completed', null, 1);
    expect(routes).toHaveLength(1);
    expect(routes[0].status).toBe('completed');
    expect(routes[0].retryCount).toBe(1);
  });

  it('includes error message for failed routes', () => {
    const routes = addProcessedRoute([], '/dashboard', 'admin', 'failed', '404 Not Found');
    expect(routes[0].error).toBe('404 Not Found');
  });

  it('handles empty initial list', () => {
    const routes = addProcessedRoute(null, '/dashboard', 'admin', 'completed');
    expect(routes).toHaveLength(1);
  });
});

describe('Checkpoint — getRemainingRoutes (AC-P1-02-10, AC-P1-02-11)', () => {
  const allRoutes = ['/dashboard', '/orders', '/products', '/users', '/settings'];
  const allRoles = ['admin'];

  it('returns all routes when none processed', () => {
    const remaining = getRemainingRoutes(allRoutes, allRoles, []);
    expect(remaining).toHaveLength(5);
  });

  it('returns remaining routes after some completed', () => {
    const processed = [
      { route: '/dashboard', role: 'admin', status: 'completed' },
      { route: '/orders', role: 'admin', status: 'completed' },
    ];
    const remaining = getRemainingRoutes(allRoutes, allRoles, processed);
    expect(remaining).toHaveLength(3);
    expect(remaining.map(r => r.route)).toEqual(['/products', '/users', '/settings']);
  });

  it('includes failed routes in remaining (must be retried)', () => {
    const processed = [
      { route: '/dashboard', role: 'admin', status: 'completed' },
      { route: '/orders', role: 'admin', status: 'failed' },
    ];
    const remaining = getRemainingRoutes(allRoutes, allRoles, processed);
    expect(remaining).toHaveLength(4); // orders (failed) + 3 not started
  });

  it('returns empty when all routes completed', () => {
    const processed = allRoutes.map(r => ({ route: r, role: 'admin', status: 'completed' }));
    const remaining = getRemainingRoutes(allRoutes, allRoles, processed);
    expect(remaining).toHaveLength(0);
  });

  it('handles multiple roles', () => {
    const multiRoles = ['admin', 'user'];
    const processed = [
      { route: '/dashboard', role: 'admin', status: 'completed' },
    ];
    const remaining = getRemainingRoutes(['/dashboard'], multiRoles, processed);
    expect(remaining).toHaveLength(1); // user/dashboard still pending
    expect(remaining[0]).toEqual({ route: '/dashboard', role: 'user' });
  });
});

describe('Checkpoint — getCheckpointSummary', () => {
  it('returns zero counts for empty processed routes', () => {
    const summary = getCheckpointSummary([]);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.total).toBe(0);
  });

  it('counts completed and failed routes correctly', () => {
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

  it('returns the processed routes array', () => {
    const routes = [{ route: '/a', role: 'admin', status: 'completed' }];
    const summary = getCheckpointSummary(routes);
    expect(summary.processedRoutes).toEqual(routes);
  });
});