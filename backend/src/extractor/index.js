'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const config = require('../config');
const { getDb } = require('../db');
const antdMatcher = require('./antd-matcher');
const heuristic = require('./heuristic');
const cropper = require('./cropper');

/**
 * Extract nodes from a snapshot: compute identity, classification, crop, and visualHash.
 * Runs after collection for a given snapshot.
 */
async function extractSnapshot(runId, snapshotId) {
  const log = logger.child({ module: 'extractor', runId, snapshotId });
  log.info('Starting extraction');
  
  const db = getDb();
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);
  if (!snapshot) throw Object.assign(new Error('Snapshot not found'), { statusCode: 404, code: 'NOT_FOUND' });
  
  // Read snapshot JSON
  const storagePath = config.storagePath;
  const snapshotPath = path.join(storagePath, snapshot.filePath);
  let snapshotData;
  
  try {
    const zlib = require('zlib');
    const gzipped = fs.readFileSync(snapshotPath);
    snapshotData = JSON.parse(zlib.gunzipSync(gzipped).toString());
  } catch (err) {
    log.error({ err: err.message }, 'Failed to read snapshot JSON');
    throw Object.assign(new Error('Failed to read snapshot JSON'), { statusCode: 500, code: 'SNAPSHOT_READ_ERROR' });
  }
  
  const screenshotPath = path.join(storagePath, snapshot.screenshotPath);
  const cropDir = path.join(storagePath, snapshot.cropDirPath);
  const thumbDir = path.join(storagePath, snapshot.thumbDirPath);
  
  // We need the nodes from the snapshot. If they don't exist yet,
  // we create synthetic nodes from the DOM data.
  // In a full run, the collector would have stored extracted nodes already.
  // Here we create placeholder nodes for the extraction pipeline.
  
  const now = new Date().toISOString();
  let nodeCount = 0;
  
  // For each node in the snapshot data, extract and classify
  if (snapshotData.nodes && snapshotData.nodes.length > 0) {
    for (const nodeData of snapshotData.nodes) {
      const nodeId = `node-${uuidv4().slice(0, 8)}`;
      
      // Compute AntD match for classification
      const antdMatch = antdMatcher.matchAntdClasses(nodeData.classList || []);
      
      // Build identity
      let identity = {
        name: nodeData.identity?.name || nodeData.nodeIdentifier || null,
        source: nodeData.identity?.source || 'heuristic',
        confidence: nodeData.identity?.confidence || 0.3,
        ownerPath: nodeData.identity?.ownerPath || null,
        evidence: nodeData.identity?.evidence || [],
      };
      
      // Build classification (ensemble)
      let classification;
      let driftScore = null;
      
      if (antdMatch.classificationType === 'antd') {
        classification = {
          type: 'antd',
          source: 'antd-class',
          confidence: antdMatch.confidence,
          evidence: antdMatch.matched.map(m => `antd-class:${m.class}`),
        };
      } else {
        // Try heuristic fallback
        const fallback = heuristic.heuristicClassify(nodeData);
        classification = fallback.classification;
        
        // If we have identity confidence, boost classification
        if (identity.confidence > 0.5) {
          classification.confidence = Math.min(1.0, classification.confidence + 0.1);
          classification.evidence.push('identity-boost');
        }
      }
      
      // Compute classification source as 'ensemble' if multiple sources
      if (identity.source !== 'heuristic') {
        classification.source = 'ensemble';
        classification.evidence.push(`identity-from-${identity.source}`);
      }
      
      // Crop node
      const { cropPath: cropFilename, visualHash } = await cropper.cropNode(
        screenshotPath, cropDir, nodeId, 
        { x: nodeData.rectX || nodeData.rect?.x || 0, 
          y: nodeData.rectY || nodeData.rect?.y || 0, 
          w: nodeData.rectW || nodeData.rect?.w || 10, 
          h: nodeData.rectH || nodeData.rect?.h || 10 },
        snapshot.deviceScaleFactor || 1
      );
      
      // Create thumbnail
      const thumbFilename = await cropper.createThumbnail(
        screenshotPath, thumbDir, nodeId,
        { x: nodeData.rectX || nodeData.rect?.x || 0, 
          y: nodeData.rectY || nodeData.rect?.y || 0, 
          w: nodeData.rectW || nodeData.rect?.w || 10, 
          h: nodeData.rectH || nodeData.rect?.h || 10 },
        snapshot.deviceScaleFactor || 1
      );
      
      // Store node in database
      db.prepare(`
        INSERT INTO nodes (id, snapshotId, nodeIdentifier, identity, classification, rectX, rectY, rectW, rectH, computedStyles, driftScore, cropPath, visualHash, domTag, classList, extractedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nodeId, snapshotId,
        identity.name,
        JSON.stringify(identity),
        JSON.stringify(classification),
        nodeData.rect?.x || nodeData.rectX || 0,
        nodeData.rect?.y || nodeData.rectY || 0,
        nodeData.rect?.w || nodeData.rectW || 10,
        nodeData.rect?.h || nodeData.rectH || 10,
        JSON.stringify(nodeData.computedStyles || nodeData.css || {}),
        driftScore,
        cropFilename ? path.relative(path.dirname(snapshot.filePath), path.join(cropDir, cropFilename)) : null,
        visualHash,
        nodeData.tag || nodeData.domTag || 'div',
        JSON.stringify(nodeData.classList || []),
        now
      );
      
      // Log extraction
      db.prepare(`
        INSERT INTO extraction_log (id, runId, nodeId, signal, confidence, extractedAt, evidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        `elog-${uuidv4().slice(0, 8)}`,
        runId, nodeId,
        classification.source,
        classification.confidence,
        now,
        JSON.stringify(classification.evidence)
      );
      
      nodeCount++;
    }
  }
  
  // Update snapshot status
  db.prepare(`
    UPDATE snapshots SET status = 'extracted', nodeCount = ?, extractorVersion = ?, analyzerVersion = NULL WHERE id = ?
  `).run(nodeCount, config.extractorVersion, snapshotId);
  
  log.info({ nodeCount }, 'Extraction complete');
  
  return { nodeCount };
}

module.exports = { extractSnapshot };