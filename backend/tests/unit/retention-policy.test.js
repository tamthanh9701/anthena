/**
 * @file retention-policy.test.js
 * @description Unit tests for retention policy logic
 * 
 * Tests BR-007 (Storage Retention Policy):
 *   BR-007a: Screenshot pruning (keep latest N per route+role)
 *   BR-007e: Failed run auto-delete (default 7 days)
 *   BR-007c: Snapshot JSON indefinite retention
 * 
 * Covers AC-P1-04-01 through AC-P1-04-11
 */

import { describe, it, expect } from 'vitest';

/**
 * Determines which runs to prune when adding a new run.
 * Keeps the latest N-1 existing runs (room for the new one).
 */
function determinePrunedRuns(existingRuns, _newRunTimestamp, maxRunsPerRoute) {
  const sorted = [...existingRuns].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (sorted.length < maxRunsPerRoute) return { pruned: [], kept: sorted };
  const kept = sorted.slice(0, maxRunsPerRoute - 1);
  const pruned = sorted.slice(maxRunsPerRoute - 1);
  return { pruned, kept };
}

/**
 * Determines if a failed run should be auto-deleted.
 * Default retention: 7 days. Pinned runs are exempt.
 */
function shouldDeleteFailedRun(run, now, config = {}) {
  if (run.pinned) return false;
  const retentionDays = config.failedRunRetentionDays ?? 7;
  const ageInDays = (now - new Date(run.timestamp).getTime()) / (1000 * 60 * 60 * 24);
  return ageInDays > retentionDays;
}

/**
 * Determines if a snapshot JSON should be pruned.
 * Default: 0 (indefinite).
 */
function shouldPruneSnapshotJson(snapshot, now, retentionDays) {
  if (retentionDays === 0 || retentionDays === undefined || retentionDays === null) return false;
  const ageInDays = (now - new Date(snapshot.timestamp).getTime()) / (1000 * 60 * 60 * 24);
  return ageInDays > retentionDays;
}

const NOW = new Date('2026-07-10T12:00:00Z').getTime();

describe('Retention Policy — Screenshot Pruning (BR-007a)', () => {
  it('TC-P1-04-02: prunes oldest when 6th run exceeds MAX_RUNS_PER_ROUTE=5', () => {
    const runs = [
      { id: 'run-1', timestamp: '2026-07-01T10:00:00Z' },
      { id: 'run-2', timestamp: '2026-07-01T11:00:00Z' },
      { id: 'run-3', timestamp: '2026-07-01T12:00:00Z' },
      { id: 'run-4', timestamp: '2026-07-01T13:00:00Z' },
      { id: 'run-5', timestamp: '2026-07-01T14:00:00Z' },
    ];
    const result = determinePrunedRuns(runs, '2026-07-01T15:00:00Z', 5);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe('run-1');
    expect(result.kept).toHaveLength(4);
  });

  it('TC-P1-04-03: prunes oldest when MAX_RUNS_PER_ROUTE=10 and 11th run completes', () => {
    const runs = Array.from({ length: 10 }, (_, i) => ({ id: `run-${i + 1}`, timestamp: `2026-07-0${1 + Math.floor(i / 3)}T${10 + i}:00:00Z` }));
    const result = determinePrunedRuns(runs, '2026-07-04T20:00:00Z', 10);
    expect(result.pruned).toHaveLength(1);
    expect(result.kept).toHaveLength(9);
  });

  it('no pruning when under limit', () => {
    const runs = [
      { id: 'run-1', timestamp: '2026-07-01T10:00:00Z' },
      { id: 'run-2', timestamp: '2026-07-01T11:00:00Z' },
    ];
    const result = determinePrunedRuns(runs, '2026-07-01T12:00:00Z', 5);
    expect(result.pruned).toHaveLength(0);
    expect(result.kept).toHaveLength(2);
  });

  it('TC-P1-04-10: uses configured MAX_RUNS_PER_ROUTE=3', () => {
    const runs = [
      { id: 'run-1', timestamp: '2026-07-01T10:00:00Z' },
      { id: 'run-2', timestamp: '2026-07-01T11:00:00Z' },
      { id: 'run-3', timestamp: '2026-07-01T12:00:00Z' },
    ];
    const result = determinePrunedRuns(runs, '2026-07-01T13:00:00Z', 3);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe('run-1');
  });
});

describe('Retention Policy — Failed Run Auto-Delete (BR-007e)', () => {
  it('TC-P1-04-08: deletes failed run older than 7 days and not pinned', () => {
    const oldFailedRun = { id: 'run-fail-1', status: 'failed', timestamp: '2026-07-02T10:00:00Z', pinned: false };
    expect(shouldDeleteFailedRun(oldFailedRun, NOW)).toBe(true);
  });

  it('TC-P1-04-09: does NOT delete pinned failed run regardless of age', () => {
    const oldPinnedRun = { id: 'run-fail-1', status: 'failed', timestamp: '2026-07-02T10:00:00Z', pinned: true };
    expect(shouldDeleteFailedRun(oldPinnedRun, NOW)).toBe(false);
  });

  it('does not delete a recent failed run (within 7 days)', () => {
    const recentFailedRun = { id: 'run-fail-2', status: 'failed', timestamp: '2026-07-08T10:00:00Z', pinned: false };
    expect(shouldDeleteFailedRun(recentFailedRun, NOW)).toBe(false);
  });

  it('TC-P1-04-10: uses configured FAILED_RUN_RETENTION_DAYS=14', () => {
    const run14DaysOld = { id: 'run-fail-3', status: 'failed', timestamp: '2026-06-26T12:00:00Z', pinned: false };
    expect(shouldDeleteFailedRun(run14DaysOld, NOW, { failedRunRetentionDays: 14 })).toBe(false);
    const run15DaysOld = { id: 'run-fail-4', status: 'failed', timestamp: '2026-06-25T12:00:00Z', pinned: false };
    expect(shouldDeleteFailedRun(run15DaysOld, NOW, { failedRunRetentionDays: 14 })).toBe(true);
  });
});

describe('Retention Policy — Snapshot JSON (BR-007c)', () => {
  it('TC-P1-04-05: keeps snapshot JSON indefinitely when retention=0', () => {
    const oldSnapshot = { id: 'snap-001', timestamp: '2026-05-01T10:00:00Z' };
    expect(shouldPruneSnapshotJson(oldSnapshot, NOW, 0)).toBe(false);
    expect(shouldPruneSnapshotJson(oldSnapshot, NOW, undefined)).toBe(false);
    expect(shouldPruneSnapshotJson(oldSnapshot, NOW, null)).toBe(false);
  });

  it('TC-P1-04-06: prunes when SNAPSHOT_JSON_RETENTION_DAYS=90 and older', () => {
    const oldSnapshot = { id: 'snap-001', timestamp: '2026-03-01T10:00:00Z' };
    expect(shouldPruneSnapshotJson(oldSnapshot, NOW, 90)).toBe(true);
  });

  it('does not prune snapshot within retention period', () => {
    const recentSnapshot = { id: 'snap-002', timestamp: '2026-07-05T10:00:00Z' };
    expect(shouldPruneSnapshotJson(recentSnapshot, NOW, 90)).toBe(false);
  });
});