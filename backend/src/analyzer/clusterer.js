'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');

/**
 * Clusterer: groups nodes by identity name + DOM tag + class signature + style fingerprint.
 */
class Clusterer {
  constructor(runId) {
    this.runId = runId;
    this.clusters = [];
    this.nodeToCluster = new Map();
  }

  /**
   * Run clustering on all nodes for a run.
   */
  async cluster() {
    const db = getDb();
    const log = logger.child({ module: 'analyzer', runId: this.runId });
    
    // Get all nodes from the run's snapshots
    const nodes = db.prepare(`
      SELECT n.* FROM nodes n
      JOIN snapshots s ON n.snapshotId = s.id
      WHERE s.runId = ?
    `).all(this.runId);
    
    log.info({ totalNodes: nodes.length }, 'Clustering nodes');
    
    for (const node of nodes) {
      await this.processNode(node);
    }
    
    // Save clusters to database
    await this.saveClusters();
    
    log.info({ clusterCount: this.clusters.length }, 'Clustering complete');
    return this.clusters;
  }

  /**
   * Process a single node: find matching cluster or create new one.
   */
  async processNode(node) {
    const identity = safeParse(node.identity || '{}');
    const classification = safeParse(node.classification || '{}');
    const computedStyles = safeParse(node.computedStyles || '{}');
    const classList = safeParse(node.classList || '[]');
    
    // Build a fingerprint for matching
    const name = identity.name || '';
    const tag = node.domTag || '';
    const classes = Array.isArray(classList) ? classList.sort().join('.') : '';
    const styleFingerprint = this.styleFingerprint(computedStyles);
    
    // Size bucket
    const sizeBucket = this.sizeBucket(node.rectW, node.rectH);
    
    // Try to find a matching cluster
    let matchedCluster = null;
    
    for (const cluster of this.clusters) {
      const matchScore = this.calculateMatchScore(cluster, name, tag, classes, styleFingerprint, sizeBucket);
      if (matchScore >= 0.6) {
        matchedCluster = cluster;
        break;
      }
    }
    
    if (matchedCluster) {
      matchedCluster.usageCount++;
      matchedCluster.memberIds.push(node.id);
      
      // Update fingerprints if this is a representative
      if (matchedCluster.memberIds.length <= 3) {
        matchedCluster.name = name || tag || 'unknown';
        matchedCluster.classFingerprints.push(classes);
        matchedCluster.styleFingerprints.push(styleFingerprint);
      }
      
      // Track screens
      const snap = this.getSnapshot(node.snapshotId);
      if (snap && !matchedCluster.screens.some(s => s.url === snap.url && s.role === snap.role)) {
        matchedCluster.screens.push({ url: snap.url, role: snap.role });
      }
      
      this.nodeToCluster.set(node.id, matchedCluster);
    } else {
      // Create new cluster
      const snap = this.getSnapshot(node.snapshotId);
      const newCluster = {
        id: `clust-${uuidv4().slice(0, 8)}`,
        name: name || tag || 'unknown',
        usageCount: 1,
        memberIds: [node.id],
        representativeNodeId: node.id,
        classFingerprints: [classes],
        styleFingerprints: [styleFingerprint],
        sizeBuckets: [sizeBucket],
        screens: snap ? [{ url: snap.url, role: snap.role }] : [],
        priorityScore: null,
        driftScore: null,
        driftClassification: classification.type === 'antd' ? 'antd-aligned' : (classification.type === 'custom' ? 'custom' : null),
        driftedProperties: [],
        evidenceCitations: [],
        approvalStatus: 'pending',
        confidenceMin: classification.confidence || 0,
        confidenceMax: classification.confidence || 0,
        confidenceAvg: classification.confidence || 0,
      };
      
      this.clusters.push(newCluster);
      this.nodeToCluster.set(node.id, newCluster);
    }
  }

  calculateMatchScore(cluster, name, tag, classes, styleFp, sizeBucket) {
    let score = 0;
    let factors = 0;
    
    // Name match (highest weight)
    if (cluster.name && name && (cluster.name === name || cluster.name.includes(name) || name.includes(cluster.name))) {
      score += 0.5;
    } else if (cluster.name && name) {
      score += 0.1;
    }
    factors += 0.5;
    
    // Tag match
    if (cluster.memberIds.length > 0) {
      const firstNode = { domTag: null }; // We don't have easy access, use fingerprint
      if (cluster.classFingerprints.some(c => classes === c)) {
        score += 0.2;
      }
    }
    factors += 0.2;
    
    // Size bucket match
    if (cluster.sizeBuckets.includes(sizeBucket)) {
      score += 0.15;
    }
    factors += 0.15;
    
    // Style fingerprint match
    if (cluster.styleFingerprints.some(s => s === styleFp)) {
      score += 0.3;
    }
    factors += 0.3;
    
    return factors > 0 ? score / factors : 0;
  }

  styleFingerprint(styles) {
    if (!styles) return '';
    const keys = ['backgroundColor', 'color', 'fontSize', 'borderRadius', 'width', 'height'];
    return keys.map(k => styles[k] || '').join('|');
  }

  sizeBucket(w, h) {
    if (!w || !h) return 'unknown';
    const area = w * h;
    if (area < 500) return 'tiny';
    if (area < 2000) return 'small';
    if (area < 10000) return 'medium';
    if (area < 50000) return 'large';
    return 'xlarge';
  }

  getSnapshot(snapshotId) {
    if (!this._snapshotCache) {
      const db = getDb();
      this._snapshotCache = {};
      const snapshots = db.prepare("SELECT id, url, role FROM snapshots WHERE runId = ?").all(this.runId);
      for (const s of snapshots) {
        this._snapshotCache[s.id] = s;
      }
    }
    return this._snapshotCache[snapshotId];
  }

  async saveClusters() {
    const db = getDb();
    
    for (const cluster of this.clusters) {
      // Compute confidence stats
      const nodeIds = cluster.memberIds;
      if (nodeIds.length > 0) {
        const placeholders = nodeIds.map(() => '?').join(',');
        const confs = db.prepare(`SELECT classification FROM nodes WHERE id IN (${placeholders})`).all(...nodeIds);
        const scores = confs.map(c => safeParse(c.classification || '{}').confidence || 0);
        cluster.confidenceMin = Math.min(...scores);
        cluster.confidenceMax = Math.max(...scores);
        cluster.confidenceAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
      
      const now = new Date().toISOString();
      
      db.prepare(`
        INSERT INTO clusters (id, runId, name, representativeNodeId, usageCount, driftScore, driftClassification, driftedProperties, evidenceCitations, priorityScore, approvalStatus, screens, confidenceMin, confidenceMax, confidenceAvg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        cluster.id, this.runId, cluster.name, cluster.representativeNodeId,
        cluster.usageCount, cluster.driftScore, cluster.driftClassification,
        JSON.stringify(cluster.driftedProperties), JSON.stringify(cluster.evidenceCitations),
        cluster.priorityScore,
        JSON.stringify(cluster.screens),
        cluster.confidenceMin, cluster.confidenceMax, cluster.confidenceAvg
      );
      
      // Insert cluster members
      for (const nodeId of cluster.memberIds) {
        db.prepare("INSERT OR IGNORE INTO cluster_members (clusterId, nodeId) VALUES (?, ?)").run(cluster.id, nodeId);
      }
    }
  }
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = { Clusterer };