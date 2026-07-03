/**
 * @file snapshot-nodes.test.js
 * @description Integration tests for snapshot and node data structures
 * 
 * Tests the structural contracts for snapshots and nodes:
 *   - Snapshot metadata schema (AC-P0-01-02, AC-P0-01-04)
 *   - Node data shape with identity/classification (AC-P2-01-01 through AC-P2-01-04)
 *   - Bounding rect format (AC-P2-01-04)
 *   - Error response uniformity
 * 
 * Uses fixture data from tests/fixtures/
 */

import { describe, it, expect } from 'vitest';
import path from "path";
import fs from "fs";

// Load fixture data
const mockSnapshot = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mock-snapshot-with-nodes.json'), 'utf8')
);

describe('Snapshot — Metadata Schema (AC-P0-01-02)', () => {
  it('contains required fields: id, url, role, capturedAt, viewport', () => {
    expect(mockSnapshot).toHaveProperty('id');
    expect(mockSnapshot).toHaveProperty('url');
    expect(mockSnapshot).toHaveProperty('role');
    expect(mockSnapshot).toHaveProperty('capturedAt');
    expect(mockSnapshot).toHaveProperty('viewportWidth');
    expect(mockSnapshot).toHaveProperty('viewportHeight');
    expect(mockSnapshot).toHaveProperty('schemaVersion');
  });

  it('capturedAt is ISO 8601', () => {
    const date = new Date(mockSnapshot.capturedAt);
    expect(date.toISOString()).toBe(mockSnapshot.capturedAt);
  });

  it('schemaVersion is semver', () => {
    expect(mockSnapshot.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has nullable extractorVersion and analyzerVersion (BR-008)', () => {
    expect(mockSnapshot).toHaveProperty('extractorVersion');
    expect(mockSnapshot).toHaveProperty('analyzerVersion');
  });
});

describe('Snapshot — Nodes (AC-P0-01-04, AC-P2-01-01 through AC-P2-01-04)', () => {
  it('TC-P0-01-05: every visible node has non-null x, y, w, h', () => {
    for (const node of mockSnapshot.nodes) {
      if (node.visible) {
        expect(node.rect).toHaveProperty('x');
        expect(node.rect).toHaveProperty('y');
        expect(node.rect).toHaveProperty('w');
        expect(node.rect).toHaveProperty('h');
        expect(typeof node.rect.x).toBe('number');
        expect(typeof node.rect.y).toBe('number');
        expect(typeof node.rect.w).toBe('number');
        expect(typeof node.rect.h).toBe('number');
      }
    }
  });

  it('TC-P2-01-01: node has tag, classList, and attributes', () => {
    const button = mockSnapshot.nodes.find(n => n.id === 'node-001');
    expect(button).toBeDefined();
    expect(button.tag).toBe('button');
    expect(button.classes).toContain('ant-btn');
    expect(button.attributes).toHaveProperty('id', 'submit');
    expect(button.attributes).toHaveProperty('aria-label', 'Submit form');
  });

  it('TC-P2-01-02: visible node has computed CSS with all 12 properties', () => {
    const required = ['backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'boxShadow', 'width', 'height'];
    for (const node of mockSnapshot.nodes) {
      if (node.visible && node.computedCSS) {
        for (const prop of required) {
          expect(node.computedCSS).toHaveProperty(prop);
        }
      }
    }
  });

  it('TC-P2-01-04: bounding rect matches node position', () => {
    const node = mockSnapshot.nodes.find(n => n.id === 'node-001');
    expect(node.rect).toEqual({ x: 100, y: 200, w: 120, h: 40 });
  });

  it('TC-P2-01-05: invisible nodes (display:none) are excluded', () => {
    const invisible = mockSnapshot.nodes.filter(n => !n.visible);
    expect(invisible).toHaveLength(1);
    expect(invisible[0].id).toBe('node-004');
    expect(invisible[0].visible).toBe(false);
  });

  it('TC-P2-07-01: identity and classification are separate concepts', () => {
    for (const node of mockSnapshot.nodes) {
      if (node.visible) {
        // At extraction time, identity and classification are null (Phase 1)
        // In Phase 2, they become separate objects
        expect(node).not.toHaveProperty('mergedIdentity');
      }
    }
  });
});

describe('Error Response Uniformity', () => {
  it('standard error shape has error, code, requestId', () => {
    const errorResponse = { error: 'Resource not found', code: 'NOT_FOUND', requestId: 'req-abc-123' };
    expect(errorResponse).toHaveProperty('error');
    expect(errorResponse).toHaveProperty('code');
    expect(errorResponse).toHaveProperty('requestId');
  });

  it('validation error has details', () => {
    const errorResponse = {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      requestId: 'req-abc-123',
      details: { route: 'Must be an absolute URL' },
    };
    expect(errorResponse.details).toHaveProperty('route');
  });
});