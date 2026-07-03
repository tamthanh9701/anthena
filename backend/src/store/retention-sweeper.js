'use strict';

/**
 * Retention sweeper: cleanup old runs, dedupe crops by visualHash.
 */

const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const config = require('../config');

/**
 * Prune failed runs older than FAILED_RUN_RETENTION_DAYS.
 */
function pruneFailedRuns() {
  const db = getDb();
  const retentionDays = config.failedRunRetentionDays;
  
  if (retentionDays <= 0) {
    logger.info('Failed run retention is disabled (0 days)');
    return;
  }
  
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  
  const oldFailedRuns = db.prepare(`
    SELECT id FROM runs WHERE status = 'failed' AND completedAt IS NOT NULL AND completedAt < ? AND pinned = 0
  `).all(cutoff);
  
  for (const run of oldFailedRuns) {
    // Delete from storage
    const runDir = path.join(config.storagePath, 'runs', run.id);
    if (fs.existsSync(runDir)) {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
    
    // Delete from database (cascades to snapshots, nodes, etc.)
    db.prepare("DELETE FROM runs WHERE id = ?").run(run.id);
    
    logger.info({ runId: run.id }, 'Pruned failed run');
  }
  
  return oldFailedRuns.length;
}

/**
 * Prune old runs per route+role beyond MAX_RUNS_PER_ROUTE.
 */
function pruneExcessRuns() {
  const db = getDb();
  const maxRuns = config.maxRunsPerRoute;
  
  if (maxRuns <= 0) return 0;
  
  // For each route+role combo, keep the latest maxRuns completed runs
  const routeRoles = db.prepare(`
    SELECT DISTINCT url, role FROM snapshots
    WHERE runId IN (SELECT id FROM runs WHERE status IN ('completed', 'partially-completed'))
  `).all();
  
  let pruned = 0;
  
  for (const rr of routeRoles) {
    const runs = db.prepare(`
      SELECT DISTINCT r.id, r.createdAt FROM runs r
      JOIN snapshots s ON s.runId = r.id
      WHERE s.url = ? AND s.role = ? AND r.status IN ('completed', 'partially-completed')
      ORDER BY r.createdAt DESC
    `).all(rr.url, rr.role);
    
    if (runs.length > maxRuns) {
      const toDelete = runs.slice(maxRuns);
      for (const run of toDelete) {
        const runDir = path.join(config.storagePath, 'runs', run.id);
        if (fs.existsSync(runDir)) {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
        db.prepare("DELETE FROM runs WHERE id = ?").run(run.id);
        pruned++;
      }
    }
  }
  
  if (pruned > 0) {
    logger.info({ pruned }, 'Pruned excess runs');
  }
  
  return pruned;
}

/**
 * Run all retention tasks.
 */
function runRetentionSweep() {
  logger.info('Running retention sweep');
  
  const failedPruned = pruneFailedRuns();
  const excessPruned = pruneExcessRuns();
  
  logger.info({ failedPruned, excessPruned }, 'Retention sweep complete');
}

module.exports = { pruneFailedRuns, pruneExcessRuns, runRetentionSweep };