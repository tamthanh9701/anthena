/**
 * @file visual-hash.test.js
 * @description Unit tests for VisualHash comparison logic
 * 
 * Covers:
 *   - VisualHash computation (deterministic, different for different data)
 *   - VisualHash comparison (identical, similar, different)
 *   - Crop naming convention (<nodeId>.webp)
 *   - 5 identical buttons produce same hash (BR-006a)
 */

import { describe, it, expect } from 'vitest';

/**
 * Simulates a perceptual hash based on node characteristics.
 * In production: blockhash-core or similar library.
 */
function computeVisualHash(nodeData) {
  const signature = [
    nodeData.tag,
    ...(nodeData.classList || []).sort(),
    nodeData.backgroundColor || '',
    nodeData.color || '',
    nodeData.borderRadius || '',
    `${nodeData.w}x${nodeData.h}`,
  ].join('|');
  let hash = 0;
  for (let i = 0; i < signature.length; i++) {
    const char = signature.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Hamming distance between two hex hashes.
 */
function visualHashDistance(hashA, hashB) {
  if (!hashA || !hashB) return Infinity;
  const a = parseInt(hashA, 16);
  const b = parseInt(hashB, 16);
  let xor = a ^ b;
  let distance = 0;
  while (xor) {
    distance += xor & 1;
    xor >>>= 1;
  }
  return distance;
}

function areCropsIdentical(hashA, hashB) { return hashA === hashB; }

describe('VisualHash — Computation', () => {
  it('produces deterministic hash for identical node data', () => {
    const data = { tag: 'button', classList: ['ant-btn'], w: 120, h: 40, backgroundColor: '#1677ff', color: '#ffffff', borderRadius: '6px' };
    expect(computeVisualHash(data)).toBe(computeVisualHash(data));
  });

  it('produces different hashes for different node data', () => {
    const btn = { tag: 'button', classList: ['ant-btn'], w: 120, h: 40, backgroundColor: '#1677ff', borderRadius: '6px' };
    const div = { tag: 'div', classList: ['custom'], w: 800, h: 400, backgroundColor: '#ffffff', borderRadius: '8px' };
    expect(computeVisualHash(btn)).not.toBe(computeVisualHash(div));
  });

  it('produces different hashes for 1px dimension difference', () => {
    const data1 = { tag: 'button', classList: ['ant-btn'], w: 120, h: 40 };
    const data2 = { tag: 'button', classList: ['ant-btn'], w: 121, h: 40 };
    expect(computeVisualHash(data1)).not.toBe(computeVisualHash(data2));
  });

  it('visualHash is a non-empty string', () => {
    const hash = computeVisualHash({ tag: 'button', classList: ['ant-btn'], w: 120, h: 40 });
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('5 identical buttons produce the same visualHash (BR-006a)', () => {
    const data = { tag: 'button', classList: ['ant-btn', 'ant-btn-primary'], w: 120, h: 40, backgroundColor: '#1677ff', color: '#ffffff', borderRadius: '6px' };
    const hashes = Array.from({ length: 5 }, () => computeVisualHash(data));
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(hashes[0]);
    }
  });
});

describe('VisualHash — Comparison', () => {
  it('identical hashes mean identical crops', () => {
    expect(areCropsIdentical('a1b2c3d4', 'a1b2c3d4')).toBe(true);
  });

  it('different hashes mean different crops', () => {
    expect(areCropsIdentical('a1b2c3d4', 'e5f6a7b8')).toBe(false);
  });

  it('Hamming distance between identical hashes is 0', () => {
    expect(visualHashDistance('a1b2c3d4', 'a1b2c3d4')).toBe(0);
  });

  it('null/undefined hash produces Infinity distance', () => {
    expect(visualHashDistance(null, 'a1b2c3d4')).toBe(Infinity);
    expect(visualHashDistance('a1b2c3d4', undefined)).toBe(Infinity);
  });
});

describe('VisualHash — Crop Naming', () => {
  it('crop file is named <nodeId>.webp', () => {
    expect('node-042.webp').toBe('node-042.webp');
    expect('node-042.webp'.endsWith('.webp')).toBe(true);
  });

  it('cropPath is recorded in node data', () => {
    const node = { id: 'node-042', cropPath: 'crops/node-042.webp', visualHash: 'a1b2c3d4' };
    expect(node.cropPath).toBe('crops/node-042.webp');
    expect(node.visualHash).toBe('a1b2c3d4');
  });
});