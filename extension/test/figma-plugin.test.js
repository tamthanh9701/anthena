/**
 * Figma Plugin Tests — Owned Clone Workflow
 *
 * Tests:
 * 1. cloneId is deterministic for same source + release
 * 2. cloneId differs for different source file keys
 * 3. createOwnedClone produces owned document with correct metadata
 * 4. Deep clone preserves all token nodes
 * 5. applyTokensToClone applies values to corresponding token nodes
 * 6. Idempotent apply: same tokens twice = unchanged (no-op)
 * 7. Idempotent apply: changed value = applied
 * 8. detectSourceConflict detects version change
 * 9. detectSourceConflict detects structure change
 * 10. checkApplyPrecondition blocks apply after source change
 * 11. checkApplyPrecondition allows apply when source unchanged
 * 12. applyTokenToPaint converts hex color to Figma RGB fill
 * 13. applyTokenToPaint sets cornerRadius for border-radius tokens
 * 14. Unknown token paths are skipped (not errored)
 * 15. Multiple tokens apply correctly
 * 16. walkTokens only visits TOKEN-type nodes
 */

import { describe, it, expect } from 'vitest';
import {
  computeCloneId,
  detectSourceConflict,
  hashSourceStructure,
  createOwnedClone,
  applyTokensToClone,
  applyTokenToPaint,
  checkApplyPrecondition,
  walkTokens,
  hexToRgb,
  TOKEN_NODE_TYPE,
} from '../src/figma-plugin/figma-plugin.js';
import { buildSourceKit, buildTokenNode } from '../src/figma-plugin/local-figma-engine.js';

// ─── 1. Deterministic cloneId ────────────────────────────────────────────────

describe('computeCloneId', () => {
  it('is deterministic for same source and release', () => {
    const a = computeCloneId('antd-kit-v5', 'abc123');
    const b = computeCloneId('antd-kit-v5', 'abc123');
    expect(a).toBe(b);
  });

  it('differs for different source file keys', () => {
    const a = computeCloneId('antd-kit-v5', 'abc123');
    const b = computeCloneId('antd-kit-v6', 'abc123');
    expect(a).not.toBe(b);
  });

  it('differs for different release hashes', () => {
    const a = computeCloneId('antd-kit-v5', 'abc123');
    const b = computeCloneId('antd-kit-v5', 'def456');
    expect(a).not.toBe(b);
  });

  it('returns a string starting with anthena-clone-', () => {
    const id = computeCloneId('antd-kit-v5', 'abc123');
    expect(id).toMatch(/^anthena-clone-/);
  });
});

// ─── 2. Source Conflict Detection ────────────────────────────────────────────

describe('detectSourceConflict', () => {
  it('returns no conflict when cloneManifest is null (first clone)', () => {
    const kit = buildSourceKit();
    const result = detectSourceConflict(kit, null);
    expect(result.hasConflict).toBe(false);
  });

  it('detects version change', () => {
    const kitV1 = buildSourceKit({ kitVersion: '1.0.0' });
    const kitV2 = buildSourceKit({ kitVersion: '2.0.0' });
    const manifest = { sourceKitVersion: '1.0.0', sourceStructureHash: hashSourceStructure(kitV1) };
    const result = detectSourceConflict(kitV2, manifest);
    expect(result.hasConflict).toBe(true);
    expect(result.reason).toContain('Source kit version changed');
  });

  it('detects structure change (different hash)', () => {
    const kit = buildSourceKit({ kitVersion: '1.0.0' });
    const manifest = { sourceKitVersion: '1.0.0', sourceStructureHash: 'different-hash' };
    const result = detectSourceConflict(kit, manifest);
    expect(result.hasConflict).toBe(true);
    expect(result.reason).toContain('hash mismatch');
  });

  it('returns no conflict when version and hash match', () => {
    const kit = buildSourceKit({ kitVersion: '1.0.0' });
    const hash = hashSourceStructure(kit);
    const manifest = { sourceKitVersion: '1.0.0', sourceStructureHash: hash };
    const result = detectSourceConflict(kit, manifest);
    expect(result.hasConflict).toBe(false);
  });
});

// ─── 3. hashSourceStructure ──────────────────────────────────────────────────

describe('hashSourceStructure', () => {
  it('is deterministic for same source', () => {
    const kit1 = buildSourceKit();
    const kit2 = buildSourceKit();
    expect(hashSourceStructure(kit1)).toBe(hashSourceStructure(kit2));
  });

  it('differs for sources with different token counts', () => {
    const kit1 = buildSourceKit();
    const kit2 = buildSourceKit({ kitVersion: '2.0.0' });
    // Add an extra token
    kit2.children.push({
      id: 'extra-group',
      name: 'extra',
      type: 'GROUP',
      children: [buildTokenNode('extraToken', '#000', 'color', ['extra'])],
      pluginData: { groupType: 'token-category' },
    });
    expect(hashSourceStructure(kit1)).not.toBe(hashSourceStructure(kit2));
  });

  it('returns a string', () => {
    const kit = buildSourceKit();
    expect(typeof hashSourceStructure(kit)).toBe('string');
  });
});

// ─── 4. createOwnedClone ─────────────────────────────────────────────────────

describe('createOwnedClone', () => {
  it('produces a clone with correct name', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, 'http://localhost:3001/api/v2/releases/rel-test');
    expect(clone.name).toContain(cloneId);
    expect(clone.name).toContain('Anthena Sync');
  });

  it('preserves all token nodes from source', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, 'http://localhost:3001/api/v2/releases/rel-test');

    // Count all TOKEN-type nodes in source vs clone
    const sourceTokens = [];
    walkTokens(kit, (n) => sourceTokens.push(n));
    const cloneTokens = [];
    walkTokens(clone, (n) => cloneTokens.push(n));

    expect(cloneTokens.length).toBe(sourceTokens.length);
  });

  it('marks clone with ownership pluginData', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, 'http://localhost:3001/api/v2/releases/rel-test');

    expect(clone.pluginData.anthenaCloneId).toBe(cloneId);
    expect(clone.pluginData.anthenaSourceKitVersion).toBe('1.0.0');
    expect(clone.pluginData.anthenaReleaseUrl).toBe('http://localhost:3001/api/v2/releases/rel-test');
    expect(clone.pluginData.anthenaCreatedAt).toBeTruthy();
    expect(clone.pluginData.anthenaLastSyncAt).toBeNull();
    expect(clone.pluginData.anthenaAppliedTokenCount).toBe(0);
  });

  it('clone node IDs have clone- prefix', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');
    expect(clone.id).toMatch(/^clone-/);
  });
});

// ─── 5. applyTokensToClone ───────────────────────────────────────────────────

describe('applyTokensToClone', () => {
  it('applies values to corresponding token nodes', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');

    const tokens = [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
      { tokenName: 'borderRadius', canonicalValue: '8px', dataType: 'dimension' },
    ];

    const result = applyTokensToClone(clone, tokens);
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);

    // Verify values were applied
    const colorNode = findCloneToken(clone, 'colorPrimary');
    expect(colorNode.tokenValue).toBe('#1890ff');
    expect(colorNode.pluginData.anthenaAppliedValue).toBe('#1890ff');
    expect(colorNode.pluginData.anthenaSource).toBe('anthena');
    expect(colorNode.pluginData.anthenaLastAppliedAt).toBeTruthy();

    const radiusNode = findCloneToken(clone, 'borderRadius');
    expect(radiusNode.tokenValue).toBe('8px');
  });

  it('idempotent: same tokens twice = unchanged (no-op)', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');

    // First apply a DIFFERENT value to change it
    const tokensV1 = [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
    ];
    const first = applyTokensToClone(clone, tokensV1);
    expect(first.applied).toBe(1);
    expect(first.unchanged).toBe(0);

    // Second apply — same value again => no-op (unchanged)
    const second = applyTokensToClone(clone, tokensV1);
    expect(second.applied).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.skipped).toBe(0);

    // Verify clone manifest updated
    expect(clone.pluginData.anthenaLastSyncAt).toBeTruthy();
  });

  it('applies when value changes between applies', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');

    // Clone starts with source defaults (#1677ff). Apply a different value.
    const tokensV1 = [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
    ];
    const first = applyTokensToClone(clone, tokensV1);
    expect(first.applied).toBe(1);

    const tokensV2 = [
      { tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' },
    ];
    const second = applyTokensToClone(clone, tokensV2);
    expect(second.applied).toBe(1);
    expect(second.unchanged).toBe(0);

    expect(findCloneToken(clone, 'colorPrimary').tokenValue).toBe('#1677ff');
  });

  it('skips unknown token paths', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');

    const tokens = [
      { tokenName: 'nonExistentToken', canonicalValue: '#000', dataType: 'color' },
    ];

    const result = applyTokensToClone(clone, tokens);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it('handles empty tokens array', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');
    const result = applyTokensToClone(clone, []);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('handles null clone root gracefully', () => {
    const result = applyTokensToClone(null, [{ tokenName: 'colorPrimary', canonicalValue: '#000', dataType: 'color' }]);
    expect(result.applied).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('updates clone manifest after apply', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');

    expect(clone.pluginData.anthenaAppliedTokenCount).toBe(0);

    applyTokensToClone(clone, [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
      { tokenName: 'borderRadius', canonicalValue: '8px', dataType: 'dimension' },
    ]);

    expect(clone.pluginData.anthenaLastSyncAt).toBeTruthy();
    expect(clone.pluginData.anthenaAppliedTokenCount).toBe(2);
  });
});

// ─── 6. applyTokenToPaint ────────────────────────────────────────────────────

describe('applyTokenToPaint', () => {
  it('converts hex color to Figma RGB fill', () => {
    const node = {
      id: 'test',
      name: 'colorPrimary',
      type: 'TOKEN',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      pluginData: {},
    };
    applyTokenToPaint(node, { tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' });
    expect(node.fills[0].color.r).toBeCloseTo(0.086, 2);
    expect(node.fills[0].color.g).toBeCloseTo(0.467, 2);
    expect(node.fills[0].color.b).toBeCloseTo(1.0, 2);
    expect(node.fills[0].type).toBe('SOLID');
  });

  it('sets cornerRadius for border-radius token', () => {
    const node = {
      id: 'test',
      name: 'borderRadius',
      type: 'TOKEN',
      cornerRadius: 0,
      pluginData: {},
    };
    applyTokenToPaint(node, { tokenName: 'borderRadius', canonicalValue: '8px', dataType: 'dimension' });
    expect(node.cornerRadius).toBe(8);
  });

  it('does not set cornerRadius for non-radius dimension tokens', () => {
    const node = {
      id: 'test',
      name: 'fontSizeMD',
      type: 'TOKEN',
      cornerRadius: 0,
      pluginData: {},
    };
    applyTokenToPaint(node, { tokenName: 'fontSizeMD', canonicalValue: '14px', dataType: 'dimension' });
    expect(node.cornerRadius).toBe(0);
  });

  it('handles node with no fills array', () => {
    const node = {
      id: 'test',
      name: 'colorPrimary',
      type: 'TOKEN',
      pluginData: {},
    };
    // Should not throw
    applyTokenToPaint(node, { tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' });
    expect(node.fills).toBeUndefined();
  });

  it('updates stroke color when strokes have color', () => {
    const node = {
      id: 'test',
      name: 'colorPrimary',
      type: 'TOKEN',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      pluginData: {},
    };
    applyTokenToPaint(node, { tokenName: 'colorPrimary', canonicalValue: '#ff4d4f', dataType: 'color' });
    expect(node.strokes[0].color.r).toBeCloseTo(1.0, 2);
    expect(node.strokes[0].color.g).toBeCloseTo(0.302, 2);
  });
});

// ─── 7. checkApplyPrecondition ───────────────────────────────────────────────

describe('checkApplyPrecondition', () => {
  it('allows apply when source structure unchanged', () => {
    const kit = buildSourceKit();
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kit, cloneId, '');
    const result = checkApplyPrecondition(clone, kit);
    expect(result.canApply).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('blocks apply when source structure changed', () => {
    const kitV1 = buildSourceKit({ kitVersion: '1.0.0' });
    const cloneId = computeCloneId('antd-kit-source', 'abc');
    const clone = createOwnedClone(kitV1, cloneId, '');

    // Simulate source kit structure change (new token)
    const kitV2 = buildSourceKit({ kitVersion: '1.0.0' });
    kitV2.children.push({
      id: 'extra-group',
      name: 'extra',
      type: 'GROUP',
      children: [buildTokenNode('newToken', '#000', 'color', ['extra'])],
      pluginData: { groupType: 'token-category' },
    });

    const result = checkApplyPrecondition(clone, kitV2);
    expect(result.canApply).toBe(false);
    expect(result.reason).toContain('Re-clone first');
  });
});

// ─── 8. hexToRgb ─────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('converts #1677ff correctly', () => {
    const rgb = hexToRgb('#1677ff');
    expect(rgb.r).toBeCloseTo(0.086, 2);
    expect(rgb.g).toBeCloseTo(0.467, 2);
    expect(rgb.b).toBeCloseTo(1.0, 2);
  });

  it('converts #ffffff correctly', () => {
    const rgb = hexToRgb('#ffffff');
    expect(rgb.r).toBe(1);
    expect(rgb.g).toBe(1);
    expect(rgb.b).toBe(1);
  });

  it('converts #000000 correctly', () => {
    const rgb = hexToRgb('#000000');
    expect(rgb.r).toBe(0);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
  });
});

// ─── 9. walkTokens ───────────────────────────────────────────────────────────

describe('walkTokens', () => {
  it('only visits nodes with TOKEN type or tokenPath pluginData', () => {
    const kit = buildSourceKit();
    const visited = [];
    walkTokens(kit, (n) => visited.push(n.name));
    expect(visited.length).toBeGreaterThan(0);
    expect(visited).toContain('colorPrimary');
    expect(visited).toContain('borderRadius');
    expect(visited).not.toContain('Ant Design 5 Kit'); // DOCUMENT — not a token
  });

  it('handles null node gracefully', () => {
    let called = false;
    walkTokens(null, () => { called = true; });
    expect(called).toBe(false);
  });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function findCloneToken(root, tokenName) {
  let found = null;
  walkTokens(root, (n) => {
    if (n.pluginData?.tokenPath === tokenName) found = n;
  });
  return found;
}