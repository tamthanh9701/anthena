'use strict';

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const normalizer = require('./normalizer');
const { clusterAcrossPages } = require('./clusterer');
const { calculateDriftFromClusters } = require('./drift-calculator');
const { extractTokens } = require('./token-inventory');
const { calculatePriorityScore } = require('./priority-scorer');
const { buildReport } = require('./report-builder');

/**
 * Run full analysis for a completed capture session.
 *
 * @param {string} sessionId
 * @returns {Promise<{sessionId: string, status: string, clusters: Array, findings: Array, tokenInventory: object}>}
 */
async function analyzeSession(sessionId) {
  const log = logger.child({ module: 'analyze-session', sessionId });
  log.info('Starting session analysis');

  const db = getDb();
  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const runId = session.runId;

  // 1. Load all uploaded page_captures
  const pages = db.prepare(
    "SELECT * FROM page_captures WHERE sessionId = ? AND status = 'uploaded'"
  ).all(sessionId);

  if (pages.length === 0) {
    log.warn('No uploaded pages found to analyze');
    db.prepare("UPDATE capture_sessions SET status = 'failed', completedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), sessionId);
    return { sessionId, status: 'no_data', clusters: [], findings: [], tokenInventory: {} };
  }

  log.info({ pageCount: pages.length }, 'Loading page captures for analysis');

  // 2. Normalize each page capture
  const normalizedSnapshots = [];

  for (const page of pages) {
    const captureId = page.id;
    const pageDir = path.dirname(page.screenshotPath || '');
    const snapshotPath = page.snapshotPath;
    const metadataPath = path.join(pageDir, 'metadata.json');

    let metadata = {};
    try {
      const metaRaw = fs.readFileSync(metadataPath, 'utf8');
      metadata = JSON.parse(metaRaw);
    } catch (err) {
      log.warn({ captureId, err: err.message }, 'Failed to read metadata, using defaults');
      metadata = {
        url: page.url || '',
        routeKey: page.routeKey || '',
        title: page.title || '',
        capturedAt: page.capturedAt || new Date().toISOString(),
        viewport: { width: page.viewportWidth || 1440, height: page.viewportHeight || 900 },
      };
    }

    let nodes = [];
    let styles = [];
    if (snapshotPath && fs.existsSync(snapshotPath)) {
      try {
        const compressed = fs.readFileSync(snapshotPath);
        const snapshot = await decompress(compressed);
        nodes = snapshot.nodes || snapshot.elements || [];
        styles = snapshot.styles || [];
      } catch (err) {
        log.warn({ captureId, err: err.message }, 'Failed to decompress/parse snapshot, empty nodes');
      }
    } else {
      log.warn({ captureId }, 'No snapshot file found, empty nodes');
    }

    const screenshotPath = page.screenshotPath || '';

    try {
      const normalized = normalizer.normalizeExtensionSnapshot({
        metadata,
        nodes,
        styles,
        screenshotPath,
        snapshotPath: snapshotPath || '',
        runId,
        sessionId,
        captureId,
      });

      // Mark page as normalized
      db.prepare("UPDATE page_captures SET status = 'normalized' WHERE id = ?").run(captureId);

      normalizedSnapshots.push(normalized);
      log.info({ captureId, nodeCount: normalized.componentTree.length }, 'Page normalized');
    } catch (err) {
      log.error({ captureId, err: err.message }, 'Normalization failed for page, marking page as failed');
      db.prepare("UPDATE page_captures SET status = 'failed' WHERE id = ?").run(captureId);
    }
  }

  if (normalizedSnapshots.length === 0) {
    log.error('No pages could be normalized');
    db.prepare("UPDATE capture_sessions SET status = 'failed' WHERE id = ?").run(sessionId);
    return { sessionId, status: 'failed', clusters: [], findings: [], tokenInventory: {} };
  }

  // 3. Cluster across all normalized snapshots
  log.info('Running multi-page clustering');
  const clusters = clusterAcrossPages(normalizedSnapshots);

  // 4. Calculate drift
  log.info('Calculating drift');
  const drift = calculateDriftFromClusters(clusters, normalizedSnapshots);

  // 5. Extract token inventory
  log.info('Extracting token inventory');
  const tokenInventory = extractTokens(normalizedSnapshots);

  // 6. Score priority for each cluster
  log.info('Scoring priority');
  const findings = [];
  for (const cluster of clusters) {
    const priorityScore = cluster.driftScore != null && cluster.usageCount > 0
      ? calculatePriorityScore(cluster.usageCount, cluster.driftScore)
      : 0;

    cluster.priorityScore = priorityScore;

    if (priorityScore > 0) {
      findings.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        priorityScore,
        driftScore: cluster.driftScore || 0,
        driftClassification: cluster.driftClassification || 'unknown',
        usageCount: cluster.usageCount,
        description: cluster.driftClassification === 'drifted'
          ? `${cluster.name} has drifted from Ant Design defaults (score: ${cluster.driftScore?.toFixed(2)})`
          : `${cluster.name} appears ${cluster.driftClassification || 'custom'}`,
      });
    }
  }

  // Sort findings by priority score descending
  findings.sort((a, b) => b.priorityScore - a.priorityScore);

  // Assign ranks
  findings.forEach((f, i) => { f.rank = i + 1; });

  // Fallback: if no priority findings but clusters exist, show top clusters by usageCount
  if (findings.length === 0 && clusters.length > 0) {
    log.info({ clusterCount: clusters.length }, 'No priority findings, using top clusters as reviewable evidence fallback');
    const sorted = [...clusters].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    for (const cluster of sorted.slice(0, 10)) {
      findings.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        priorityScore: 0,
        driftScore: cluster.driftScore || 0,
        driftClassification: cluster.driftClassification || 'unknown',
        usageCount: cluster.usageCount || 0,
        description: 'Cluster ' + cluster.name + ' appears in ' + (cluster.usageCount || 0) + ' pages (fallback, no drift detected)',
        fallback: true,
      });
    }
  }

  // 7. Build report
  log.info('Building report');
  const report = buildReport(runId, {
    clusters,
    drift,
    tokens: tokenInventory,
    findings,
  });

  // 8. Update session status
  db.prepare("UPDATE capture_sessions SET status = 'ready_for_review', completedAt = ? WHERE id = ?")
    .run(new Date().toISOString(), sessionId);

  // 9. Persist analysis results to DB for later retrieval
  persistResults(db, runId, sessionId, clusters, findings, report);

  log.info({ sessionId, clusters: clusters.length, findings: findings.length }, 'Session analysis complete');

  return {
    sessionId,
    status: 'ready_for_review',
    clusters,
    findings,
    tokenInventory,
    report,
  };
}

/**
 * Decompress gzipped buffer and parse JSON.
 */
function decompress(compressed) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(compressed, (err, decompressed) => {
      if (err) {
        reject(new Error(`Decompress failed: ${err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(decompressed.toString('utf8')));
      } catch (parseErr) {
        reject(new Error(`JSON parse failed: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Persist analysis results to database for report retrieval.
 */
function persistResults(db, runId, sessionId, clusters, findings, report) {
  // Store clusters in the clusters table if they don't already exist
  for (const cluster of clusters) {
    const existing = db.prepare("SELECT id FROM clusters WHERE id = ?").get(cluster.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO clusters (id, runId, name, usageCount, driftScore, driftClassification, driftedProperties, evidenceCitations, priorityScore, approvalStatus, screens, confidenceMin, confidenceMax, confidenceAvg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        cluster.id, runId, cluster.name,
        cluster.usageCount, cluster.driftScore, cluster.driftClassification,
        JSON.stringify(cluster.driftedProperties || []),
        JSON.stringify(cluster.evidenceCitations || []),
        cluster.priorityScore,
        JSON.stringify(cluster.screens || []),
        cluster.confidenceMin || 0, cluster.confidenceMax || 0, cluster.confidenceAvg || 0
      );
    }
  }

  // Store findings in the findings table
  for (const finding of findings) {
    const existing = db.prepare("SELECT id FROM findings WHERE clusterId = ? AND runId = ?").get(finding.clusterId, runId);
    if (!existing) {
      const findingId = `find-${require('crypto').randomBytes(4).toString('hex')}`;
      db.prepare(`
        INSERT INTO findings (id, runId, clusterId, priorityScore, rank, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(findingId, runId, finding.clusterId, finding.priorityScore, finding.rank);
    }
  }
}

module.exports = { analyzeSession };
