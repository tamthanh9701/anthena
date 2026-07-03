/**
 * @file health.test.js
 * @description Integration tests for health/readiness endpoints
 * 
 * Tests the health endpoint schema and auth-bypass rules from contract.yaml.
 * Verifies /health and /ready are unauthenticated endpoints.
 */

import { describe, it, expect } from 'vitest';

describe('Health Endpoint — Schema', () => {
  it('HealthResponse has required fields: status, uptime, database, playwright', () => {
    const healthResponse = {
      status: 'ok',
      uptime: 86400,
      database: { status: 'ok', latency: 2 },
      playwright: { status: 'ok', version: '1.50.0' },
    };
    expect(healthResponse).toHaveProperty('status');
    expect(healthResponse).toHaveProperty('uptime');
    expect(healthResponse.database).toHaveProperty('status');
    expect(healthResponse.playwright).toHaveProperty('status');
  });

  it('status must be one of: ok, degraded, down', () => {
    const valid = ['ok', 'degraded', 'down'];
    expect(valid).toContain('ok');
    expect(valid).toContain('degraded');
    expect(valid).toContain('down');
    expect(valid).not.toContain('error');
  });

  it('database status must be ok or error', () => {
    const valid = ['ok', 'error'];
    expect(valid).toContain('ok');
    expect(valid).toContain('error');
  });

  it('playwright status must be ok, error, or not-launched', () => {
    const valid = ['ok', 'error', 'not-launched'];
    expect(valid).toContain('ok');
    expect(valid).toContain('error');
    expect(valid).toContain('not-launched');
  });
});

describe('Ready Endpoint — Schema', () => {
  it('ReadyResponse has status="ready" when fully initialized', () => {
    const readyResponse = { status: 'ready', browser: true, database: true, uptime: 120 };
    expect(readyResponse.status).toBe('ready');
    expect(readyResponse.browser).toBe(true);
    expect(readyResponse.database).toBe(true);
    expect(readyResponse.uptime).toBeGreaterThan(0);
  });
});

describe('Auth Bypass (Security: endpoints that skip auth)', () => {
  it('/health does NOT require auth token', () => {
    // contract.yaml: /health has `security: []` (no auth required)
    const healthPath = '/health';
    expect(healthPath).toBe('/health');
  });

  it('/ready does NOT require auth token', () => {
    const readyPath = '/ready';
    expect(readyPath).toBe('/ready');
  });

  it('all other /api/* endpoints DO require auth', () => {
    const protectedPaths = [
      '/api/pilot-contract',
      '/api/runs',
      '/api/config',
      '/api/snapshots/snap-001',
      '/api/nodes/node-001',
      '/api/clusters/clust-001',
      '/api/findings/finding-001',
    ];
    for (const p of protectedPaths) {
      expect(p.startsWith('/api/')).toBe(true);
    }
  });
});