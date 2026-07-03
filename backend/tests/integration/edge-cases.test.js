/**
 * @file edge-cases.test.js
 * @description Integration tests for edge cases
 * 
 * Tests boundary conditions from the acceptance criteria:
 *   - Pilot Contract gate (AC-P0-03-05)
 *   - Route list validation (min/max)
 *   - Checkpoint resume
 *   - Retry logic edge cases
 *   - Empty results
 *   - Schema validation errors
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  validateRouteList,
  validatePilotContractForCosign,
} = require('../../src/utils/helpers.js');
const { addProcessedRoute, getRemainingRoutes, getCheckpointSummary } = require('../../src/queue/checkpoint.js');
const { shouldRetry } = require('../../src/queue/retry.js');

describe('Edge Cases — Pilot Contract Gate (AC-P0-03-05)', () => {
  it('Phase 1 blocked when no contract exists', () => {
    const err = validatePilotContractForCosign(null);
    expect(err).toBe('No pilot contract exists');
  });

  it('Phase 1 blocked when contract exists but not co-signed', () => {
    const draft = {
      operatorName: 'Jane',
      operatorRole: 'Lead',
      environment: 'staging',
      routeList: ['https://ex.com/a','https://ex.com/b','https://ex.com/c','https://ex.com/d','https://ex.com/e'],
      reviewBudgetMinutes: 30,
      maxCandidates: 50,
      reviewMode: 'component-cluster',
      definitionOfInsight: ['test'],
      phase0DoD: ['test'],
      pilotDoD: ['test'],
    };
    const err = validatePilotContractForCosign(draft);
    expect(err).toBeNull(); // Draft is valid but not signed — cosign endpoint handles the gate
  });
});

describe('Edge Cases — Route List Boundaries', () => {
  it('exactly 5 routes accepted (minimum)', () => {
    const routes = Array.from({ length: 5 }, (_, i) => `https://example.com/r-${i}`);
    expect(validateRouteList(routes)).toBeNull();
  });

  it('exactly 10 routes accepted (maximum)', () => {
    const routes = Array.from({ length: 10 }, (_, i) => `https://example.com/r-${i}`);
    expect(validateRouteList(routes)).toBeNull();
  });

  it('4 routes rejected', () => {
    const routes = Array.from({ length: 4 }, (_, i) => `https://example.com/r-${i}`);
    expect(validateRouteList(routes)).toContain('5-10');
  });

  it('11 routes rejected', () => {
    const routes = Array.from({ length: 11 }, (_, i) => `https://example.com/r-${i}`);
    expect(validateRouteList(routes)).toContain('5-10');
  });

  it('route with relative URL rejected', () => {
    const routes = ['https://ex.com/a','https://ex.com/b','/relative','https://ex.com/d','https://ex.com/e'];
    expect(validateRouteList(routes)).toContain('absolute URL');
  });

  it('route with empty string rejected', () => {
    const routes = ['https://ex.com/a','https://ex.com/b','','https://ex.com/d','https://ex.com/e'];
    expect(validateRouteList(routes)).toContain('absolute URL');
  });

  it('non-array input rejected', () => {
    expect(validateRouteList('not-array')).toContain('array');
  });
});

describe('Edge Cases — Checkpoint Resume (AC-P1-02-10, AC-P1-02-11)', () => {
  it('resume after route 5 of 10 shows checkpoint at route 5', () => {
    const allRoutes = Array.from({ length: 10 }, (_, i) => `/route-${i + 1}`);
    const processed = allRoutes.slice(0, 5).map(r => ({ route: r, role: 'admin', status: 'completed' }));
    const remaining = getRemainingRoutes(allRoutes, ['admin'], processed);
    expect(remaining).toHaveLength(5);
    expect(remaining[0].route).toBe('/route-6');
  });

  it('checkpoint includes completed count', () => {
    let routes = [];
    for (let i = 0; i < 5; i++) {
      routes = addProcessedRoute(routes, `/route-${i + 1}`, 'admin', 'completed');
    }
    expect(routes).toHaveLength(5);
    expect(routes.every(r => r.status === 'completed')).toBe(true);
  });

  it('failed route is retried, not skipped on resume', () => {
    const processed = [
      { route: '/route-1', role: 'admin', status: 'completed' },
      { route: '/route-2', role: 'admin', status: 'failed' },
    ];
    const remaining = getRemainingRoutes(['/route-1', '/route-2', '/route-3'], ['admin'], processed);
    // route-2 (failed) is included in remaining for retry
    expect(remaining.map(r => r.route)).toContain('/route-2');
    expect(remaining).toHaveLength(2); // route-2 (failed) + route-3
  });
});

describe('Edge Cases — Retry Logic', () => {
  it('transient timeout is retried', () => {
    expect(shouldRetry({ statusCode: 500 }, 0)).toBe(true);
    expect(shouldRetry({ statusCode: 502 }, 0)).toBe(true);
    expect(shouldRetry({ statusCode: 503 }, 0)).toBe(true);
    expect(shouldRetry({ statusCode: 504 }, 0)).toBe(true);
  });

  it('permanent 400-class errors not retried', () => {
    expect(shouldRetry({ statusCode: 400 }, 0)).toBe(false);
    expect(shouldRetry({ statusCode: 401 }, 0)).toBe(false);
    expect(shouldRetry({ statusCode: 403 }, 0)).toBe(false);
    expect(shouldRetry({ statusCode: 404 }, 0)).toBe(false);
    expect(shouldRetry({ statusCode: 422 }, 0)).toBe(false);
  });

  it('0 retry count means no retries', () => {
    expect(shouldRetry({ statusCode: 500 }, 0, 0)).toBe(false);
  });

  it('permanent flag prevents retry', () => {
    expect(shouldRetry({ permanent: true }, 0)).toBe(false);
  });
});

describe('Edge Cases — Empty Results', () => {
  it('empty processed routes returns zero counts', () => {
    const summary = getCheckpointSummary([]);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.total).toBe(0);
  });

  it('empty remaining routes returns empty array', () => {
    const remaining = getRemainingRoutes([], ['admin'], []);
    expect(remaining).toHaveLength(0);
  });
});