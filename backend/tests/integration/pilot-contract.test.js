/**
 * @file pilot-contract.test.js
 * @description Integration tests for Pilot Contract CRUD + co-sign gate
 * 
 * These are API contract verification tests. They test:
 *   - Pilot Contract CRUD (US-P0-03)
 *   - Co-sign gate (AC-P0-03-01 through AC-P0-03-11)
 *   - Route list validation (5-10 URLs, absolute URLs)
 *   - Phase 1 gate enforcement (AC-P0-03-05)
 * 
 * These tests verify the business logic in the helpers module.
 * When the Express app is ready, these should be converted to supertest calls.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  validateRouteList,
  validatePilotContractForCosign,
  isValidAbsoluteUrl,
  createErrorResponse,
} = require('../../src/utils/helpers.js');

describe('Pilot Contract — Validation Rules (AC-P0-03-01 through AC-P0-03-11)', () => {
  const validContract = {
    operatorName: 'Jane Doe',
    operatorRole: 'Design Lead',
    environment: 'staging',
    routeList: [
      'https://staging.example.com/dashboard',
      'https://staging.example.com/orders',
      'https://staging.example.com/orders/create',
      'https://staging.example.com/products',
      'https://staging.example.com/users',
      'https://staging.example.com/settings',
      'https://staging.example.com/profile',
    ],
    reviewBudgetMinutes: 30,
    maxCandidates: 50,
    reviewMode: 'component-cluster',
    definitionOfInsight: ['Identify components that diverge from Ant Design defaults'],
    phase0DoD: ['Signal reliability report generated for at least 1 route'],
    pilotDoD: ['All routes crawled successfully', 'Token inventory generated'],
    topN: 30,
  };

  it('TC-P0-03-03: all required fields filled → contract is valid for co-sign', () => {
    const err = validatePilotContractForCosign(validContract);
    expect(err).toBeNull();
  });

  it('TC-P0-03-02: each missing BR-003 field is flagged', () => {
    const err = validatePilotContractForCosign({});
    expect(err).not.toBeNull();
    expect(err).toContain('operatorName');
    expect(err).toContain('operatorRole');
    expect(err).toContain('environment');
    expect(err).toContain('reviewBudgetMinutes');
    expect(err).toContain('maxCandidates');
    expect(err).toContain('reviewMode');
    expect(err).toContain('definitionOfInsight');
    expect(err).toContain('phase0DoD');
    expect(err).toContain('pilotDoD');
  });

  it('TC-P0-03-06: route list with 4 URLs is rejected', () => {
    const err = validateRouteList([
      'https://example.com/a', 'https://example.com/b',
      'https://example.com/c', 'https://example.com/d',
    ]);
    expect(err).toContain('5-10');
  });

  it('TC-P0-03-07: route list with 11 URLs is rejected', () => {
    const routes = Array.from({ length: 11 }, (_, i) => `https://example.com/r-${i}`);
    const err = validateRouteList(routes);
    expect(err).toContain('5-10');
  });

  it('TC-P0-03-08: route list with 7 absolute URLs is accepted', () => {
    const err = validateRouteList(validContract.routeList);
    expect(err).toBeNull();
  });

  it('TC-P0-03-09: route list with a relative URL is rejected', () => {
    const err = validateRouteList([
      '/dashboard',
      'https://example.com/b', 'https://example.com/c',
      'https://example.com/d', 'https://example.com/e',
    ]);
    expect(err).toContain('absolute URL');
  });

  it('TC-P0-03-10: empty Definition of Insight checklist is rejected', () => {
    const contract = { ...validContract, definitionOfInsight: [] };
    const err = validatePilotContractForCosign(contract);
    expect(err).toContain('definitionOfInsight');
  });

  it('TC-P0-03-10: empty Phase 0 DoD checklist is rejected', () => {
    const contract = { ...validContract, phase0DoD: [] };
    const err = validatePilotContractForCosign(contract);
    expect(err).toContain('phase0DoD');
  });

  it('TC-P0-03-10: empty Pilot DoD checklist is rejected', () => {
    const contract = { ...validContract, pilotDoD: [] };
    const err = validatePilotContractForCosign(contract);
    expect(err).toContain('pilotDoD');
  });

  it('TC-P0-03-11: all checklists with at least 1 item → accepted', () => {
    const err = validatePilotContractForCosign(validContract);
    expect(err).toBeNull();
  });
});

describe('Pilot Contract — Co-Sign Logic', () => {
  it('TC-P0-03-04: co-signed contract returns null (valid)', () => {
    const cosigned = {
      operatorName: 'Jane Doe',
      operatorRole: 'Design Lead',
      environment: 'staging',
      routeList: ['https://example.com/a','https://example.com/b','https://example.com/c','https://example.com/d','https://example.com/e'],
      reviewBudgetMinutes: 30,
      maxCandidates: 50,
      reviewMode: 'component-cluster',
      definitionOfInsight: ['test'],
      phase0DoD: ['test'],
      pilotDoD: ['test'],
      cosignedAt: '2026-07-02T14:30:00.000Z',
    };
    const err = validatePilotContractForCosign(cosigned);
    expect(err).toBeNull();
  });

  it('TC-P0-03-05: null contract triggers "No pilot contract exists"', () => {
    const err = validatePilotContractForCosign(null);
    expect(err).toBe('No pilot contract exists');
  });
});

describe('Pilot Contract — URL Validation', () => {
  it('accepts valid https URLs', () => {
    expect(isValidAbsoluteUrl('https://staging.example.com/dashboard')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isValidAbsoluteUrl('/dashboard')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAbsoluteUrl('')).toBe(false);
  });

  it('rejects non-URL strings', () => {
    expect(isValidAbsoluteUrl('not-a-url')).toBe(false);
  });
});

describe('Pilot Contract — Error Response Format', () => {
  it('ErrorResponse contains error, code, requestId', () => {
    const resp = createErrorResponse('Phase 1 action requires a co-signed pilot contract', 'PILOT_CONTRACT_REQUIRED', 'req-test-123');
    expect(resp).toHaveProperty('error');
    expect(resp).toHaveProperty('code', 'PILOT_CONTRACT_REQUIRED');
    expect(resp).toHaveProperty('requestId', 'req-test-123');
  });
});