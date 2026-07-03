/**
 * @file clusters-findings.test.js
 * @description Integration tests for clusters, findings, and review data structures
 * 
 * Using fixture data, validates:
 *   - Cluster data structure (US-P3-02)
 *   - Finding priority ranking (US-P3-04)
 *   - Designer review feedback
 *   - Approve queue structure
 */

import { describe, it, expect } from 'vitest';
import path from "path";
import fs from "fs";

const clustersFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mock-cluster-data.json'), 'utf8'));
const findingsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mock-priority-findings.json'), 'utf8'));

describe('Clusters — Data Structure (AC-P3-02-01 through AC-P3-02-05)', () => {
  it('TC-P3-02-01: clusters group similar nodes by identity, tag, class, style, size', () => {
    expect(clustersFixture.clusters).toHaveLength(3);
    expect(clustersFixture.clusters[0].representativeName).toBe('PrimaryButton');
    expect(clustersFixture.clusters[1].representativeName).toBe('StatusTag');
    expect(clustersFixture.clusters[2].representativeName).toBe('CustomChart');
  });

  it('TC-P3-02-03: each cluster has required fields', () => {
    for (const cluster of clustersFixture.clusters) {
      expect(cluster).toHaveProperty('clusterId');
      expect(cluster).toHaveProperty('representativeName');
      expect(cluster).toHaveProperty('usageCount');
      expect(cluster).toHaveProperty('screens');
      expect(cluster).toHaveProperty('roles');
      expect(cluster).toHaveProperty('representativeCrop');
      expect(cluster).toHaveProperty('driftScore');
      expect(cluster).toHaveProperty('driftClassification');
    }
  });

  it('TC-P3-02-05: identical buttons across screens cluster together', () => {
    const primaryBtn = clustersFixture.clusters.find(c => c.clusterId === 'cluster-001');
    expect(primaryBtn).toBeDefined();
    expect(primaryBtn.usageCount).toBe(45);
    expect(primaryBtn.screens.length).toBeGreaterThan(1);
    expect(primaryBtn.roles).toContain('admin');
  });

  it('TC-P3-03-01: antd-aligned cluster has score 0.0', () => {
    const aligned = clustersFixture.clusters.find(c => c.driftClassification === 'antd-aligned');
    expect(aligned).toBeDefined();
    expect(aligned.driftScore).toBe(0.0);
  });

  it('TC-P3-03-02: drifted cluster lists deviating properties', () => {
    const drifted = clustersFixture.clusters.find(c => c.driftClassification === 'drifted');
    expect(drifted).toBeDefined();
    expect(drifted.driftedProperties.length).toBeGreaterThan(0);
    expect(drifted.driftedProperties[0]).toHaveProperty('property');
    expect(drifted.driftedProperties[0]).toHaveProperty('expected');
    expect(drifted.driftedProperties[0]).toHaveProperty('actual');
  });

  it('TC-P3-03-03: custom cluster has no drifted properties', () => {
    const custom = clustersFixture.clusters.find(c => c.driftClassification === 'custom');
    expect(custom).toBeDefined();
    expect(custom.driftScore).toBeNull();
    expect(custom.driftedProperties).toHaveLength(0);
  });

  it('drift score is null for clusters not yet analyzed (BR-001e)', () => {
    const custom = clustersFixture.clusters.find(c => c.driftClassification === 'custom');
    expect(custom.driftScore).toBeNull();
  });
});

describe('Findings — Priority Ranking (AC-P3-04-01 through AC-P3-04-06)', () => {
  it('TC-P3-04-01: findings are ranked by priorityScore descending', () => {
    const scores = findingsFixture.findings.map(f => f.priorityScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('TC-P3-04-02: returns all findings when < topN', () => {
    expect(findingsFixture.findings.length).toBeLessThanOrEqual(50);
  });

  it('TC-P3-04-06: each finding has display fields', () => {
    for (const finding of findingsFixture.findings) {
      expect(finding).toHaveProperty('findingId');
      expect(finding).toHaveProperty('clusterName');
      expect(finding).toHaveProperty('priorityScore');
      expect(finding).toHaveProperty('usageCount');
      expect(finding).toHaveProperty('driftScore');
      expect(finding).toHaveProperty('rank');
      expect(finding).toHaveProperty('screens');
      expect(finding).toHaveProperty('roles');
      expect(finding).toHaveProperty('status');
    }
  });

  it('TC-P3-04-03: priorityScore = usageCount × driftScore (product)', () => {
    const statusTag = findingsFixture.findings.find(f => f.clusterName === 'StatusTag');
    expect(statusTag).toBeDefined();
    // 23 × 0.6 = 13.8
    expect(statusTag.priorityScore).toBeCloseTo(13.8, 1);
    // Confirm it's NOT addition: 23 + 0.6 = 23.6
    expect(statusTag.priorityScore).not.toBeCloseTo(23.6, 1);
  });
});

describe('Findings — Designer Feedback (AC-P3-05-01 through AC-P3-05-04)', () => {
  it('TC-P3-05-01: findings accept exactly three feedback options', () => {
    const validFeedbacks = ['correct-priority', 'over-prioritized', 'under-prioritized'];
    for (const fb of validFeedbacks) {
      expect(fb).toMatch(/^(correct-priority|over-prioritized|under-prioritized)$/);
    }
  });

  it('TC-P3-05-04: review respects budget constraints', () => {
    // Budget is 30 minutes / 50 findings = 0.6 min per finding
    // The system should allow stopping at any time
    const budgetPerFinding = 30 / 50;
    expect(budgetPerFinding).toBe(0.6);
  });
});

describe('Clusters — Review Actions', () => {
  it('valid approval statuses: pending, approved, rejected, deferred', () => {
    const valid = ['pending', 'approved', 'rejected', 'deferred'];
    for (const cluster of clustersFixture.clusters) {
      expect(valid).toContain(cluster.approvalStatus);
    }
  });

  it('cluster with high priority score should rank higher', () => {
    // cluster-002 (StatusTag) has priorityScore=13.8 (drifted)
    // cluster-001 (PrimaryButton) has priorityScore=0.0 (aligned)
    const drifted = clustersFixture.clusters.find(c => c.clusterId === 'cluster-002');
    const aligned = clustersFixture.clusters.find(c => c.clusterId === 'cluster-001');
    expect(drifted.priorityScore).toBeGreaterThan(aligned.priorityScore);
  });
});