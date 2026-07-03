'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const { Clusterer } = require('./clusterer');
const { calculateAllDrift } = require('./drift-calculator');
const { calculateClusterPriority } = require('./priority-scorer');
const reportBuilder = require('./report-builder');

/**
 * Run full analysis pipeline for a run:
 * 1. Cluster nodes
 * 2. Calculate drift
 * 3. Score priorities
 * 4. Create findings
 * 5. Build reports
 */
async function analyzeRun(runId) {
  const log = logger.child({ module: 'analyzer', runId });
  log.info('Starting analysis');
  
  const db = getDb();
  
  // Step 1: Cluster nodes
  const clusterer = new Clusterer(runId);
  const clusters = await clusterer.cluster();
  
  // Step 2: Calculate drift for each cluster
  calculateAllDrift(runId);
  
  // Step 3: Score priorities
  const updatedClusters = db.prepare("SELECT * FROM clusters WHERE runId = ?").all(runId);
  for (const cluster of updatedClusters) {
    const priorityScore = calculateClusterPriority(cluster);
    db.prepare("UPDATE clusters SET priorityScore = ? WHERE id = ?").run(priorityScore, cluster.id);
  }
  
  // Step 4: Create findings (ranked by priorityScore)
  const rankedClusters = db.prepare(`
    SELECT * FROM clusters WHERE runId = ? ORDER BY priorityScore DESC
  `).all(runId);
  
  // Delete old findings for this run
  db.prepare("DELETE FROM findings WHERE runId = ?").run(runId);
  
  for (let i = 0; i < rankedClusters.length; i++) {
    const cluster = rankedClusters[i];
    const findingId = `find-${uuidv4().slice(0, 8)}`;
    
    db.prepare(`
      INSERT INTO findings (id, runId, clusterId, priorityScore, rank, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(findingId, runId, cluster.id, cluster.priorityScore || 0, i + 1);
  }
  
  // Step 5: Build reports (stored in DB, also must be written to storage)
  const tokenReport = reportBuilder.buildTokenReport(runId);
  const componentReport = reportBuilder.buildComponentReport(runId);
  const driftReport = reportBuilder.buildDriftReport(runId);
  
  // Update snapshot status to 'analyzed'
  db.prepare("UPDATE snapshots SET status = 'analyzed', analyzerVersion = ? WHERE runId = ?").run('0.1.0', runId);
  
  log.info({
    clusters: rankedClusters.length,
    findings: rankedClusters.length,
  }, 'Analysis complete');
  
  return { clusters: rankedClusters.length, findings: rankedClusters.length };
}

// Simple single-run analysis (for the API pipeline)
async function analyze(runId) {
  return analyzeRun(runId);
}

module.exports = { analyzeRun, analyze };