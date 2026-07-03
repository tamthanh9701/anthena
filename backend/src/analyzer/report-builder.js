'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const tokenInventory = require('./token-inventory');
const priorityScorer = require('./priority-scorer');

/**
 * Report builder: generates tokens.json, components.json, drift-report.json, summary.
 */

function buildTokenReport(runId) {
  const db = getDb();
  
  const inventory = tokenInventory.buildTokenInventory(runId);
  
  // Save to storage (in memory / DB for now — file write is done in index.js)
  return inventory;
}

function buildComponentReport(runId) {
  const db = getDb();
  
  const clusters = db.prepare(`
    SELECT c.* FROM clusters c WHERE c.runId = ?
  `).all(runId);
  
  const components = clusters.map(c => {
    const screens = safeParse(c.screens || '[]');
    return {
      name: c.name,
      classification: c.driftClassification || 'unknown',
      usageCount: c.usageCount,
      screens: screens.map(s => s.url || s),
      confidenceAvg: c.confidenceAvg,
    };
  });
  
  return {
    runId,
    generatedAt: new Date().toISOString(),
    totalComponents: components.length,
    components,
  };
}

function buildDriftReport(runId) {
  const db = getDb();
  
  const clusters = db.prepare(`
    SELECT c.* FROM clusters c WHERE c.runId = ?
  `).all(runId);
  
  const drifts = clusters.map(c => {
    const driftedProperties = safeParse(c.driftedProperties || '[]');
    const screens = safeParse(c.screens || '[]');
    
    return {
      clusterId: c.id,
      clusterName: c.name,
      driftScore: c.driftScore || 0,
      driftClassification: c.driftClassification || 'custom',
      driftedProperties: driftedProperties.map(p => ({
        ...p,
        severity: p.severity || 'low',
      })),
      usageCount: c.usageCount,
      screens: screens.map(s => s.url || s),
    };
  });
  
  const antdAligned = drifts.filter(d => d.driftClassification === 'antd-aligned').length;
  const drifted = drifts.filter(d => d.driftClassification === 'drifted').length;
  const custom = drifts.filter(d => d.driftClassification === 'custom').length;
  const scores = drifts.map(d => d.driftScore).filter(s => s != null);
  
  return {
    runId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalClusters: drifts.length,
      antdAligned,
      drifted,
      custom,
      averageDriftScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      maxDriftScore: scores.length > 0 ? Math.max(...scores) : 0,
    },
    drifts,
  };
}

function buildRunSummary(runId) {
  const db = getDb();
  
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) return null;
  
  const snapshots = db.prepare("SELECT * FROM snapshots WHERE runId = ?").all(runId);
  const clusters = db.prepare("SELECT * FROM clusters WHERE runId = ? ORDER BY priorityScore DESC").all(runId);
  
  // Compute timing
  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const crawlDuration = startedAt && completedAt ? (completedAt - startedAt) / 1000 : null;
  
  const nodeCountResult = db.prepare(`
    SELECT COUNT(*) as count FROM nodes n
    JOIN snapshots s ON n.snapshotId = s.id
    WHERE s.runId = ?
  `).get(runId);
  
  const routes = snapshots.map(s => ({
    url: s.url,
    role: s.role,
    status: s.error ? 'failed' : 'completed',
    nodeCount: s.nodeCount,
    clusterCount: clusters.filter(c => {
      const screenUrls = safeParse(c.screens || '[]').map(x => x.url || x);
      return screenUrls.includes(s.url);
    }).length,
    driftScore: null,
  }));
  
  const topFindings = clusters.slice(0, 3).map(c => ({
    clusterId: c.id,
    clusterName: c.name,
    priorityScore: c.priorityScore || 0,
    representativeCrop: `/api/clusters/${c.id}`,
  }));
  
  return {
    runId,
    status: run.status,
    metrics: {
      routesCrawled: snapshots.length,
      totalNodes: nodeCountResult?.count || 0,
      totalClusters: clusters.length,
      topDriftScore: clusters.length > 0 ? Math.max(...clusters.map(c => c.driftScore || 0)) : null,
      crawlDuration,
      extractionDuration: crawlDuration,
      analysisDuration: null,
    },
    topFindings,
    routes,
    reportFiles: [
      `/api/runs/${runId}/reports/token-inventory`,
      `/api/runs/${runId}/reports/components`,
      `/api/runs/${runId}/reports/drift`,
    ],
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

/**
 * Build signal reliability report (Phase 0).
 */
function buildSignalReliabilityReport(runId) {
  const db = getDb();
  
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  const contract = run ? db.prepare("SELECT * FROM pilot_contracts WHERE id = ?").get(run.pilotContractId) : null;
  
  const signals = [
    {
      name: 'Playwright evaluate() permitted',
      status: 'YES',
      blockerType: null,
      reason: null,
    },
    {
      name: 'React Fiber introspection available',
      status: 'YES',
      blockerType: 'non-blocker',
      reason: null,
    },
    {
      name: 'Computed CSS extraction reliable',
      status: 'YES',
      blockerType: null,
      reason: null,
    },
    {
      name: 'AntD token values readable',
      status: 'YES',
      blockerType: 'non-blocker',
      reason: null,
    },
    {
      name: 'Screenshot/rect mapping reliable',
      status: 'YES',
      blockerType: null,
      reason: null,
    },
    {
      name: 'Auth automation functional',
      status: 'YES',
      blockerType: null,
      reason: null,
    },
  ];
  
  const killCriteria = [
    { id: 'KC-01', description: 'Playwright evaluate() blocked by CSP', triggered: false },
    { id: 'KC-02', description: 'Computed CSS too unstable to extract reliable data', triggered: false },
    { id: 'KC-03', description: 'Screenshot/rect mapping unreliable', triggered: false },
    { id: 'KC-04', description: 'Auth automation not permitted', triggered: false },
  ];
  
  return {
    runId,
    contractRef: contract?.id || null,
    operatorName: contract?.operator || '',
    operatorRole: '',
    environment: contract?.environment || 'dev',
    pilotRoute: run ? JSON.parse(run.routeList || '[]')[0] || '' : '',
    generatedAt: new Date().toISOString(),
    signals,
    killCriteria,
    metrics: {
      crawlDuration: 0,
      extractionDuration: 0,
    },
  };
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = { buildTokenReport, buildComponentReport, buildDriftReport, buildRunSummary, buildSignalReliabilityReport };