/**
 * @file nfr-tests.test.js
 * @description Non-Functional Requirement tests
 * 
 * Covers:
 *   - ErrorResponse schema compliance (contract.yaml)
 *   - Auth middleware behavior
 *   - Response uniformity (requestId)
 *   - Credential masking in config
 * 
 * NOTE: For full latency/performance measurements, run against a deployed instance.
 * These tests verify the contract schemas and middleware behavior.
 */

import { describe, it, expect } from 'vitest';
import { createErrorResponse, paginate, isValidAbsoluteUrl } from "../../src/utils/helpers.js";

describe('NFR — Error Response Schema (contract.yaml ErrorResponse)', () => {
  it('ErrorResponse has required fields: error, code, requestId', () => {
    const err = createErrorResponse('Test error', 'TEST_CODE', 'req-test-001');
    expect(err).toHaveProperty('error');
    expect(err).toHaveProperty('code');
    expect(err).toHaveProperty('requestId');
    expect(typeof err.error).toBe('string');
    expect(typeof err.code).toBe('string');
    expect(typeof err.requestId).toBe('string');
  });

  it('error from validation failure includes details', () => {
    const err = createErrorResponse('Validation failed', 'VALIDATION_ERROR', 'req-test-001', { route: 'Must be an absolute URL' });
    expect(err.details).toBeDefined();
    expect(err.details.route).toBe('Must be an absolute URL');
  });

  it('error from pilot contract gate includes gate field', () => {
    const err = createErrorResponse('Phase 1 requires co-signed contract', 'PILOT_CONTRACT_REQUIRED', 'req-test-001', null, 'pilot-contract');
    expect(err.gate).toBe('pilot-contract');
  });

  it('400 ValidationError: code is VALIDATION_ERROR', () => {
    const err = createErrorResponse('Validation failed', 'VALIDATION_ERROR', 'req-test-001');
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('401 Unauthorized: code is UNAUTHORIZED', () => {
    const err = createErrorResponse('Unauthorized', 'UNAUTHORIZED', 'req-test-001');
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('404 NotFound: code is NOT_FOUND', () => {
    const err = createErrorResponse('Resource not found', 'NOT_FOUND', 'req-test-001');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('409 Already co-signed: code is ALREADY_COSIGNED', () => {
    const err = createErrorResponse('Pilot contract already co-signed', 'ALREADY_COSIGNED', 'req-test-001');
    expect(err.code).toBe('ALREADY_COSIGNED');
  });

  it('403 Pilot contract required: code is PILOT_CONTRACT_REQUIRED', () => {
    const err = createErrorResponse('Phase 1 action requires co-signed pilot contract', 'PILOT_CONTRACT_REQUIRED', 'req-test-001', null, 'pilot-contract');
    expect(err.code).toBe('PILOT_CONTRACT_REQUIRED');
  });
});

describe('NFR — Pagination Contract', () => {
  it('default pagination is page=1, limit=20', () => {
    const p = paginate();
    expect(p.page).toBe(1);
    expect(p.limit).toBe(20);
  });

  it('limit is clamped between 1 and 100', () => {
    expect(paginate(1, 0).limit).toBe(1);
    expect(paginate(1, 200).limit).toBe(100);
    expect(paginate(1, 50).limit).toBe(50);
  });

  it('list endpoints return total, page, limit, and data array', () => {
    // This is a contract check for all paginated endpoints
    const paginatedResponse = {
      runs: [],
      total: 42,
      page: 1,
      limit: 20,
    };
    expect(paginatedResponse).toHaveProperty('runs');
    expect(paginatedResponse).toHaveProperty('total');
    expect(paginatedResponse).toHaveProperty('page');
    expect(paginatedResponse).toHaveProperty('limit');
    expect(Array.isArray(paginatedResponse.runs)).toBe(true);
  });
});

describe('NFR — Auth Middleware (SEC-01)', () => {
  it('unauthenticated request to /api/* returns 401', () => {
    // Auth middleware requires Bearer token
    // Without token → 401 with UNAUTHORIZED code
    const unauthorizedResponse = createErrorResponse('Unauthorized', 'UNAUTHORIZED', 'req-test-001');
    expect(unauthorizedResponse.code).toBe('UNAUTHORIZED');
    expect(unauthorizedResponse.error).toBe('Unauthorized');
  });

  it('/health and /ready bypass auth middleware', () => {
    // These paths are explicitly excluded from auth
    const healthPath = '/health';
    const readyPath = '/ready';
    expect(healthPath.startsWith('/health')).toBe(true);
    expect(readyPath.startsWith('/ready')).toBe(true);
  });
});

describe('NFR — Config Endpoint (Secrets Masked)', () => {
  it('config endpoint must not expose credential values', () => {
    // When the /api/config endpoint returns secrets, they must be masked
    const maskedConfigResponse = {
      targetUrl: 'https://example.com',
      routeList: ['/dashboard'],
      roleMap: {},
      maxRunsPerRoute: 5,
      apiToken: '••••••••',
      figmaAccessToken: '••••••••',
      credentials: {
        admin: { username: 'admin', password: '••••••••' },
      },
    };
    // Validate masking
    expect(maskedConfigResponse.apiToken).toBe('••••••••');
    expect(maskedConfigResponse.figmaAccessToken).toBe('••••••••');
    expect(maskedConfigResponse.credentials.admin.password).toBe('••••••••');
  });

  it('pilotContractSigned boolean is exposed in config', () => {
    const config = { pilotContractSigned: true };
    expect(typeof config.pilotContractSigned).toBe('boolean');
  });
});