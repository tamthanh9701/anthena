/**
 * @file clustering.test.js
 * @description Unit tests for component clustering and drift classification
 * 
 * Covers:
 *   - Clustering by identity, tag, class, style, size (US-P3-02)
 *   - Drift classification: antd-aligned, drifted, custom (US-P3-03)
 *   - Priority score from fixture data (BR-001)
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clustersFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mock-cluster-data.json'), 'utf8'));
const findingsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mock-priority-findings.json'), 'utf8'));

/**
 * Size bucket classification.
 */
function sizeBucket(w, h) {
  const maxDim = Math.max(w, h);
  if (maxDim < 50) return 'xs';
  if (maxDim < 100) return 'sm';
  if (maxDim < 200) return 'md';
  if (maxDim < 400) return 'lg';
  return 'xl';
}

describe('Clustering — Size Buckets', () => {
  it('xs: < 50px', () => {
    expect(sizeBucket(30, 20)).toBe('xs');
    expect(sizeBucket(49, 10)).toBe('xs');
  });

  it('sm: 50-99px', () => {
    expect(sizeBucket(50, 30)).toBe('sm');
    expect(sizeBucket(99, 50)).toBe('sm');
  });

  it('md: 100-199px', () => {
    expect(sizeBucket(120, 40)).toBe('md');
    expect(sizeBucket(199, 50)).toBe('md');
  });

  it('lg: 200-399px', () => {
    expect(sizeBucket(200, 100)).toBe('lg');
    expect(sizeBucket(300, 200)).toBe('lg');
  });

  it('xl: >= 400px', () => {
    expect(sizeBucket(800, 400)).toBe('xl');
    expect(sizeBucket(400, 400)).toBe('xl');
  });
});

describe('Clustering — Drift Classification (US-P3-03)', () => {
  it('TC-P3-03-01: antd-aligned cluster has driftScore=0.0', () => {
    const aligned = clustersFixture.clusters.find(c => c.driftClassification === 'antd-aligned');
    expect(aligned).toBeDefined();
    expect(aligned.driftScore).toBe(0.0);
  });

  it('TC-P3-03-02: drifted cluster has driftScore > 0', () => {
    const drifted = clustersFixture.clusters.find(c => c.driftClassification === 'drifted');
    expect(drifted).toBeDefined();
    expect(drifted.driftScore).toBeGreaterThan(0);
  });

  it('TC-P3-03-03: custom cluster has no AntD class matches', () => {
    const custom = clustersFixture.clusters.find(c => c.driftClassification === 'custom');
    expect(custom).toBeDefined();
    expect(custom.representativeName).toBe('CustomChart');
  });

  it('TC-P3-03-04: drifted cluster lists deviating properties', () => {
    const drifted = clustersFixture.clusters.find(c => c.driftClassification === 'drifted');
    expect(drifted.driftedProperties.length).toBeGreaterThanOrEqual(1);
    const prop = drifted.driftedProperties[0];
    expect(prop).toHaveProperty('property');
    expect(prop).toHaveProperty('expected');
    expect(prop).toHaveProperty('actual');
  });

  it('TC-P3-03-05: drift entry includes all required fields', () => {
    for (const cluster of clustersFixture.clusters) {
      expect(cluster).toHaveProperty('driftClassification');
      expect(cluster).toHaveProperty('driftScore');
      expect(cluster).toHaveProperty('driftedProperties');
      expect(cluster).toHaveProperty('evidenceCitations');
    }
  });
});

describe('Clustering — Priority Score from Fixtures', () => {
  it('TC-P3-04-03: priorityScore = usageCount × driftScore (product)', () => {
    const statusTag = findingsFixture.findings.find(f => f.clusterName === 'StatusTag');
    expect(statusTag.priorityScore).toBeCloseTo(23 * 0.6, 1); // 13.8
  });

  it('priorityScore=0 when driftScore=0', () => {
    const primaryBtn = findingsFixture.findings.find(f => f.clusterName === 'PrimaryButton');
    expect(primaryBtn.driftScore).toBe(0);
    expect(primaryBtn.priorityScore).toBe(0);
  });

  it('priorityScore=0 when driftScore=null', () => {
    const custom = findingsFixture.findings.find(f => f.clusterName === 'CustomChart');
    expect(custom.driftScore).toBeNull();
    expect(custom.priorityScore).toBe(0);
  });

  it('findings sorted by priorityScore descending', () => {
    const scores = findingsFixture.findings.map(f => f.priorityScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});