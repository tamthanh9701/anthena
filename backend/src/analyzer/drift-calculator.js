'use strict';

const { getDb } = require('../db');
const { logger } = require('../utils/logger');

/**
 * Drift calculator: compares computed CSS against expected Ant Design defaults.
 * NOTE: Current baseline is HARDCODED_ANT_DEFAULTS (Phase 0 approximation).
 *       In Phase 2+, replace with observed/runtime token baseline from
 *       ConfigProvider or Ant Design token extraction.
 */

// Baseline metadata
const BASELINE_SOURCE = 'hardcoded-ant-defaults';
const BASELINE_DISCLAIMER = 'Phase 0 approximation. Replace with observed token inventory in Phase 2+. Values from Ant Design v5.27.4 default theme.';

// Ant Design default values for common component properties
const ANT_DEFAULTS = {
  'ant-btn': {
    backgroundColor: '#1677ff',
    color: '#ffffff',
    borderRadius: '6px',
    fontSize: '14px',
    lineHeight: '1.5715',
    border: '1px solid #1677ff',
  },
  'ant-input': {
    backgroundColor: '#ffffff',
    color: '#000000d9',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    fontSize: '14px',
  },
  'ant-select': {
    backgroundColor: '#ffffff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    fontSize: '14px',
  },
  'ant-table': {
    backgroundColor: '#ffffff',
    color: '#000000d9',
    fontSize: '14px',
  },
  'ant-card': {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
  },
  'ant-modal': {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
  },
};

/**
 * Calculate drift for a cluster.
 */
function calculateDrift(clusterId) {
  const db = getDb();
  const log = logger.child({ module: 'analyzer', clusterId });
  
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(clusterId);
  if (!cluster) return null;
  
  const members = db.prepare(`
    SELECT n.* FROM nodes n
    JOIN cluster_members cm ON n.id = cm.nodeId
    WHERE cm.clusterId = ?
  `).all(clusterId);
  
  if (members.length === 0) return null;
  
  // Get the first member as representative
  const representative = members[0];
  const styles = safeParse(representative.computedStyles || '{}');
  const classList = safeParse(representative.classList || '[]');
  const classification = safeParse(representative.classification || '{}');
  
  // Determine which AntD component this maps to
  const antdComponent = findAntdComponent(classification, classList, cluster.name);
  
  if (!antdComponent) {
    // No AntD mapping — this is a custom component
    return {
      driftScore: 0,
      driftClassification: 'custom',
      driftedProperties: [],
    };
  }
  
  const defaults = ANT_DEFAULTS[antdComponent];
  if (!defaults) {
    return {
      driftScore: 0,
      driftClassification: 'custom',
      driftedProperties: [],
      baselineSource: BASELINE_SOURCE,
      baselineDisclaimer: BASELINE_DISCLAIMER,
    };
  }
  
  // Compare computed CSS against defaults
  const driftedProperties = [];
  let totalDrift = 0;
  let propCount = 0;
  
  for (const [prop, expected] of Object.entries(defaults)) {
    const actual = styles[prop];
    if (actual && actual !== expected) {
      driftedProperties.push({
        property: prop,
        expected,
        actual,
        severity: calculateSeverity(prop, expected, actual),
      });
      totalDrift += 1;
    }
    propCount++;
  }
  
  const driftScore = propCount > 0 ? totalDrift / propCount : 0;
  const driftClassification = driftScore === 0 ? 'antd-aligned' : 'drifted';
  
  return {
    driftScore,
    driftClassification,
    driftedProperties,
    baselineSource: BASELINE_SOURCE,
    baselineDisclaimer: BASELINE_DISCLAIMER,
  };
}

function findAntdComponent(classification, classList, name) {
  // First check by AntD class prefixes
  if (Array.isArray(classList)) {
    for (const cls of classList) {
      for (const [component, _defaults] of Object.entries(ANT_DEFAULTS)) {
        if (cls.includes(component)) return component;
      }
    }
  }
  
  // Check by classification type
  if (classification.type === 'antd') {
    // Try to match by name
    for (const [component] of Object.entries(ANT_DEFAULTS)) {
      if (name && name.includes(component.replace('ant-', ''))) return component;
    }
  }
  
  return null;
}

function calculateSeverity(prop, expected, actual) {
  // Color severity
  if (prop.includes('color') || prop === 'backgroundColor') {
    if (expected.toLowerCase() !== actual.toLowerCase()) return 'high';
  }
  
  // Border radius severity
  if (prop === 'borderRadius') {
    const expectedVal = parseFloat(expected);
    const actualVal = parseFloat(actual);
    if (!isNaN(expectedVal) && !isNaN(actualVal) && Math.abs(expectedVal - actualVal) > 4) return 'high';
    return 'medium';
  }
  
  // Spacing severity
  if (prop === 'border') {
    return 'medium';
  }
  
  return 'low';
}

function calculateClusterDrift(clusterId) {
  const drift = calculateDrift(clusterId);
  if (!drift) return;
  
  const db = getDb();
  db.prepare(`
    UPDATE clusters SET driftScore = ?, driftClassification = ?, driftedProperties = ? WHERE id = ?
  `).run(
    drift.driftScore,
    drift.driftClassification,
    JSON.stringify(drift.driftedProperties),
    clusterId
  );
}

function calculateAllDrift(runId) {
  const db = getDb();
  const clusters = db.prepare("SELECT id FROM clusters WHERE runId = ?").all(runId);
  
  for (const cluster of clusters) {
    calculateClusterDrift(cluster.id);
  }
  
  logger.info({ runId, clusterCount: clusters.length }, 'Drift calculation complete');
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = { calculateDrift, calculateClusterDrift, calculateAllDrift };