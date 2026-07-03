/**
 * @file helpers.test.js
 * @description Unit tests for utility helpers
 * 
 * Imports the real helpers module from src/utils/helpers.js
 * 
 * Covers:
 *   - createErrorResponse (requestId, error, code)
 *   - paginate (page/limit/offset)
 *   - isValidAbsoluteUrl
 *   - isValidUuid
 *   - validateRouteList
 *   - validatePilotContractForCosign
 */

import { describe, it, expect } from 'vitest';

const {
  createErrorResponse,
  paginate,
  isValidAbsoluteUrl,
  isValidUuid,
  validateRouteList,
  validatePilotContractForCosign,
} = require('../../src/utils/helpers.js');

describe('createErrorResponse', () => {
  it('returns object with error, code, and requestId', () => {
    const resp = createErrorResponse('Not found', 'NOT_FOUND', 'req-abc-123');
    expect(resp).toEqual({
      error: 'Not found',
      code: 'NOT_FOUND',
      requestId: 'req-abc-123',
    });
  });

  it('generates requestId when not provided', () => {
    const resp = createErrorResponse('Error', 'ERROR');
    expect(resp.requestId).toMatch(/^req-/);
  });

  it('includes gate when provided', () => {
    const resp = createErrorResponse('Blocked', 'PILOT_CONTRACT_REQUIRED', 'req-1', null, 'pilot-contract');
    expect(resp.gate).toBe('pilot-contract');
  });

  it('includes details when provided', () => {
    const details = { field: 'routeList', reason: 'Must have 5-10 items' };
    const resp = createErrorResponse('Validation failed', 'VALIDATION', 'req-1', details);
    expect(resp.details).toEqual(details);
  });
});

describe('paginate', () => {
  it('returns default page=1, limit=20, offset=0', () => {
    expect(paginate()).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it('calculates offset correctly', () => {
    expect(paginate(2, 20)).toEqual({ page: 2, limit: 20, offset: 20 });
    expect(paginate(3, 10)).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  it('clamps minimum page to 1', () => {
    expect(paginate(0)).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(paginate(-5)).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it('handles limit=0 by falling back to default 20', () => {
    expect(paginate(1, 0)).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it('clamps limit to max 100', () => {
    expect(paginate(1, 200)).toEqual({ page: 1, limit: 100, offset: 0 });
  });

  it('handles string inputs by parsing', () => {
    expect(paginate('2', '10')).toEqual({ page: 2, limit: 10, offset: 10 });
  });
});

describe('isValidAbsoluteUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidAbsoluteUrl('https://example.com/dashboard')).toBe(true);
    expect(isValidAbsoluteUrl('http://example.com')).toBe(true);
  });

  it('rejects relative URLs', () => {
    expect(isValidAbsoluteUrl('/dashboard')).toBe(false);
    expect(isValidAbsoluteUrl('dashboard')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAbsoluteUrl('')).toBe(false);
  });

  it('rejects invalid strings', () => {
    expect(isValidAbsoluteUrl('not-a-url')).toBe(false);
  });

  it('rejects other protocols', () => {
    expect(isValidAbsoluteUrl('ftp://example.com')).toBe(false);
    expect(isValidAbsoluteUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('isValidUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('rejects short strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidUuid('')).toBe(false);
  });
});

describe('validateRouteList', () => {
  it('returns null for valid route list (5-10 absolute URLs)', () => {
    const routes = [
      'https://example.com/a', 'https://example.com/b', 'https://example.com/c',
      'https://example.com/d', 'https://example.com/e',
    ];
    expect(validateRouteList(routes)).toBeNull();
  });

  it('returns error for < 5 routes', () => {
    expect(validateRouteList(['https://example.com/a'])).toContain('5-10');
  });

  it('returns error for > 10 routes', () => {
    const routes = Array.from({ length: 11 }, (_, i) => `https://example.com/r-${i}`);
    expect(validateRouteList(routes)).toContain('5-10');
  });

  it('returns error for relative URL', () => {
    const routes = ['https://example.com/a', 'https://example.com/b', '/relative', 'https://example.com/d', 'https://example.com/e'];
    expect(validateRouteList(routes)).toContain('absolute URL');
  });

  it('returns error for non-array input', () => {
    expect(validateRouteList('not-array')).toContain('array');
  });
});

describe('validatePilotContractForCosign', () => {
  const validContract = {
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
  };

  it('returns null for valid contract', () => {
    expect(validatePilotContractForCosign(validContract)).toBeNull();
  });

  it('returns null if already co-signed (already valid)', () => {
    const cosigned = { ...validContract, cosignedAt: '2026-07-02T14:30:00.000Z' };
    expect(validatePilotContractForCosign(cosigned)).toBeNull();
  });

  it('returns error for missing operatorName', () => {
    const err = validatePilotContractForCosign({ ...validContract, operatorName: '' });
    expect(err).toContain('operatorName');
  });

  it('returns error for empty checklists', () => {
    const err = validatePilotContractForCosign({ ...validContract, definitionOfInsight: [] });
    expect(err).toContain('definitionOfInsight');
  });

  it('returns error for null/undefined', () => {
    const err = validatePilotContractForCosign(null);
    expect(err).toBe('No pilot contract exists');
  });
});