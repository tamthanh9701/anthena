/**
 * Evidence Package — Canonical Payload Validator & Model
 *
 * Schema version "2.0.0" — lossless, provenance-backed.
 * Every signal references persisted captureEvidence path.
 * No metadata claim without evidence.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

const SUPPORTED_SCHEMA_VERSIONS = ['2.0.0'];

const SIGNAL_DEFINITIONS = {
  'dom-structure': { required: true, severity: 'required' },
  'css-computed':  { required: true, severity: 'required' },
  'rect':          { required: true, severity: 'required' },
  'antd-classes':  { required: false, severity: 'strong' },
  'antd-tokens':   { required: false, severity: 'strong' },
  'react-fiber':   { required: false, severity: 'medium' },
  'a11y-tree':     { required: false, severity: 'low' },
};

/**
 * Validates a raw Evidence Package payload.
 * Returns { valid: boolean, errors: string[], package: object|null }
 */
function validateEvidencePackage(raw) {
  const errors = [];

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Payload must be a JSON object'], package: null };
  }

  // Schema version
  if (!raw.schemaVersion) {
    errors.push('Missing schemaVersion');
  } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(raw.schemaVersion)) {
    errors.push(`Unsupported schemaVersion: ${raw.schemaVersion}. Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }

  // Package ID
  if (!raw.packageId) {
    errors.push('Missing packageId');
  }

  // Capture timestamp
  if (!raw.capturedAt) {
    errors.push('Missing capturedAt');
  } else if (isNaN(Date.parse(raw.capturedAt))) {
    errors.push('capturedAt is not valid ISO8601');
  }

  // URL
  if (!raw.url) {
    errors.push('Missing url');
  }

  // Viewport
  if (!raw.viewport || typeof raw.viewport !== 'object') {
    errors.push('Missing viewport object');
  } else {
    if (!raw.viewport.width || !raw.viewport.height) {
      errors.push('viewport must include width and height');
    }
  }

  // Scenario
  if (!raw.scenario || typeof raw.scenario !== 'object') {
    errors.push('Missing scenario object');
  }

  // Screenshot
  if (!raw.screenshot) {
    errors.push('Missing screenshot filename');
  }

  // DOM
  if (!raw.dom || typeof raw.dom !== 'object') {
    errors.push('Missing dom signal');
  } else {
    if (!raw.dom.nodes || !Array.isArray(raw.dom.nodes)) {
      errors.push('dom.nodes must be an array');
    }
    if (!raw.dom.captureEvidence) {
      errors.push('dom.captureEvidence path is required');
    }
  }

  // CSS
  if (!raw.css || typeof raw.css !== 'object') {
    errors.push('Missing css signal');
  } else {
    if (!raw.css.computed || typeof raw.css.computed !== 'object') {
      errors.push('css.computed must be an object (nodeId → computed)');
    }
    if (!raw.css.captureEvidence) {
      errors.push('css.captureEvidence path is required');
    }
  }

  // AntD
  if (raw.antd) {
    if (typeof raw.antd !== 'object') {
      errors.push('antd must be an object');
    } else {
      if (!raw.antd.captureEvidence) {
        errors.push('antd.captureEvidence path is required');
      }
    }
  }

  // Fiber
  if (raw.fiber) {
    if (typeof raw.fiber !== 'object') {
      errors.push('fiber must be an object');
    } else {
      if (!raw.fiber.captureEvidence) {
        errors.push('fiber.captureEvidence path is required');
      }
    }
  }

  // A11y
  if (raw.a11y) {
    if (typeof raw.a11y !== 'object') {
      errors.push('a11y must be an object');
    } else {
      if (!raw.a11y.captureEvidence) {
        errors.push('a11y.captureEvidence path is required');
      }
    }
  }

  // Provenance
  if (!raw.provenance || typeof raw.provenance !== 'object') {
    errors.push('Missing provenance object');
  } else {
    if (!raw.provenance.packageHash) {
      errors.push('provenance.packageHash is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    package: errors.length === 0 ? raw : null,
  };
}

/**
 * Compute derived signal status from a validated package.
 * Returns { signals: SignalStatus[], derivedStatus: string }
 *
 * SignalStatus = { signal, severity, status, confidence, nodeCount, captureEvidencePath, extractorVersion, error }
 * derivedStatus = 'full' | 'degraded' | 'minimal' | 'failed'
 */
function computeSignalStatus(pkg) {
  const signals = [];

  // DOM
  const domPresent = !!(pkg.dom && pkg.dom.nodes && pkg.dom.nodes.length > 0);
  signals.push({
    signal: 'dom-structure',
    severity: 'required',
    status: domPresent ? 'present' : 'absent',
    confidence: domPresent ? 1.0 : null,
    nodeCount: domPresent ? pkg.dom.nodes.length : 0,
    captureEvidencePath: pkg.dom?.captureEvidence || null,
    extractorVersion: pkg.dom?.extractorVersion || null,
    error: domPresent ? null : 'DOM signal missing or empty',
  });

  // CSS
  const cssPresent = !!(pkg.css && pkg.css.computed && Object.keys(pkg.css.computed).length > 0);
  signals.push({
    signal: 'css-computed',
    severity: 'required',
    status: cssPresent ? 'present' : 'absent',
    confidence: cssPresent ? 1.0 : null,
    nodeCount: cssPresent ? Object.keys(pkg.css.computed).length : 0,
    captureEvidencePath: pkg.css?.captureEvidence || null,
    extractorVersion: pkg.css?.extractorVersion || null,
    error: cssPresent ? null : 'CSS signal missing or empty',
  });

  // Rect (derived from DOM)
  const rectPresent = domPresent && pkg.dom.nodes.every(n => n.rect && typeof n.rect.x === 'number');
  signals.push({
    signal: 'rect',
    severity: 'required',
    status: rectPresent ? 'present' : 'absent',
    confidence: rectPresent ? 1.0 : null,
    nodeCount: rectPresent ? pkg.dom.nodes.length : 0,
    captureEvidencePath: pkg.dom?.captureEvidence || null,
    extractorVersion: null,
    error: rectPresent ? null : 'Some nodes missing rect data',
  });

  // AntD classes
  const antdPresent = !!(pkg.antd && pkg.antd.classMatches);
  signals.push({
    signal: 'antd-classes',
    severity: 'strong',
    status: antdPresent ? 'present' : 'absent',
    confidence: antdPresent ? (pkg.antd.classMatches?.confidence || 0.8) : null,
    nodeCount: antdPresent ? Object.keys(pkg.antd.classMatches || {}).length : 0,
    captureEvidencePath: pkg.antd?.captureEvidence || null,
    extractorVersion: pkg.antd?.extractorVersion || null,
    error: antdPresent ? null : 'AntD class matching not available',
  });

  // AntD tokens
  const antdTokensPresent = !!(pkg.antd && pkg.antd.tokens);
  signals.push({
    signal: 'antd-tokens',
    severity: 'strong',
    status: antdTokensPresent ? 'present' : 'absent',
    confidence: antdTokensPresent ? 0.85 : null,
    nodeCount: antdTokensPresent ? Object.keys(pkg.antd.tokens).length : 0,
    captureEvidencePath: pkg.antd?.captureEvidence || null,
    extractorVersion: pkg.antd?.extractorVersion || null,
    error: antdTokensPresent ? null : 'AntD runtime tokens not captured',
  });

  // Fiber
  const fiberPresent = !!(pkg.fiber && pkg.fiber.nodes && Object.keys(pkg.fiber.nodes).length > 0);
  signals.push({
    signal: 'react-fiber',
    severity: 'medium',
    status: fiberPresent ? 'present' : 'absent',
    confidence: fiberPresent ? (pkg.fiber.nodes[Object.keys(pkg.fiber.nodes)[0]]?.confidence || 0.7) : null,
    nodeCount: fiberPresent ? Object.keys(pkg.fiber.nodes).length : 0,
    captureEvidencePath: pkg.fiber?.captureEvidence || null,
    extractorVersion: pkg.fiber?.extractorVersion || null,
    error: fiberPresent ? null : 'React Fiber introspection not available',
  });

  // A11y
  const a11yPresent = !!(pkg.a11y && pkg.a11y.nodes && Object.keys(pkg.a11y.nodes).length > 0);
  signals.push({
    signal: 'a11y-tree',
    severity: 'low',
    status: a11yPresent ? 'present' : 'absent',
    confidence: a11yPresent ? 0.6 : null,
    nodeCount: a11yPresent ? Object.keys(pkg.a11y.nodes).length : 0,
    captureEvidencePath: pkg.a11y?.captureEvidence || null,
    extractorVersion: pkg.a11y?.extractorVersion || null,
    error: a11yPresent ? null : 'Accessibility tree not captured',
  });

  // Derive overall status
  const requiredSignals = signals.filter(s => s.severity === 'required');
  const allRequiredPresent = requiredSignals.every(s => s.status === 'present');

  if (!allRequiredPresent) {
    return { signals, derivedStatus: 'failed' };
  }

  const strongSignals = signals.filter(s => s.severity === 'strong');
  const allStrongPresent = strongSignals.every(s => s.status === 'present');
  const mediumPresent = signals.some(s => s.severity === 'medium' && s.status === 'present');

  if (allRequiredPresent && allStrongPresent && mediumPresent) {
    return { signals, derivedStatus: 'full' };
  }
  if (allRequiredPresent && allStrongPresent) {
    return { signals, derivedStatus: 'full' };
  }
  if (allRequiredPresent) {
    return { signals, derivedStatus: 'degraded' };
  }
  return { signals, derivedStatus: 'minimal' };
}

/**
 * Compute lossless token inventory from a validated package.
 * Returns Map<tokenName, TokenInventory>
 *
 * TokenInventory = { tokenName, canonicalValue, variants[], usageAcrossScreens[], driftStatus, antdDefaultValue }
 */
function computeTokenInventory(pkg, antdDefaults = {}) {
  const tokens = new Map();

  // Extract from antd.tokens
  if (pkg.antd && pkg.antd.tokens) {
    for (const [tokenName, tokenData] of Object.entries(pkg.antd.tokens)) {
      const existing = tokens.get(tokenName) || {
        tokenName,
        canonicalValue: tokenData.value,
        antdDefaultValue: antdDefaults[tokenName] || null,
        dataType: tokenData.type || 'string',
        variantCount: 1,
        variants: [],
        usageAcrossScreens: [],
        usageCount: 0,
        driftStatus: null,
        driftDetail: null,
        lastEvidenceId: null,
      };

      existing.variants.push({
        value: tokenData.value,
        evidencePackageId: pkg.packageId,
        source: tokenData.source || 'inferred',
        confidence: tokenData.confidence || 0.5,
      });

      // Update canonical value if this variant is more confident
      const topVariant = existing.variants.reduce((a, b) => (a.confidence > b.confidence ? a : b));
      existing.canonicalValue = topVariant.value;

      // Count distinct values
      const distinctValues = new Set(existing.variants.map(v => v.value));
      existing.variantCount = distinctValues.size;

      // Drift status
      if (existing.antdDefaultValue && existing.antdDefaultValue !== existing.canonicalValue) {
        existing.driftStatus = 'drifted';
        existing.driftDetail = `AntD default: ${existing.antdDefaultValue}, got: ${existing.canonicalValue}`;
      } else if (existing.variantCount > 1) {
        existing.driftStatus = 'variant-collision';
        existing.driftDetail = `${existing.variantCount} distinct values found`;
      } else {
        existing.driftStatus = 'aligned';
      }

      existing.usageCount = existing.variants.length;
      existing.lastEvidenceId = pkg.packageId;
      tokens.set(tokenName, existing);
    }
  }

  return tokens;
}

/**
 * Compute clusters from a package's DOM nodes.
 * Groups by: DOM tag + class signature + rect size bucket.
 * Returns Cluster[]
 */
function computeClusters(pkg, evidenceId) {
  if (!pkg.dom || !pkg.dom.nodes) return [];

  const clusters = new Map(); // key → Cluster

  for (const node of pkg.dom.nodes) {
    if (!node.tag) continue;

    // Build fingerprint
    const classKey = (node.classList || []).sort().join(',');
    const rectW = node.rect ? node.rect.w : 0;
    const rectH = node.rect ? node.rect.h : 0;
    const sizeBucket = `${Math.round(rectW / 10) * 10}x${Math.round(rectH / 10) * 10}`;
    const key = `${node.tag}|${classKey}|${sizeBucket}`;

    if (!clusters.has(key)) {
      clusters.set(key, {
        id: `clust-${uuidv4().slice(0, 8)}`,
        name: node.tag,
        evidence_package_ids: [evidenceId],
        member_node_ids: [node.nodeId],
        usage_count: 0,
        drift_classification: null,
        drift_score: null,
        priority_score: null,
        confidence_distribution: { min: 1, max: 1, avg: 1, stddev: 0 },
        approval_status: 'pending',
        screens: pkg.url ? [{ url: pkg.url, role: pkg.scenario?.role || 'anonymous', evidencePackageId: evidenceId }] : [],
        fingerprint: { tag: node.tag, classKey, sizeBucket },
        created_at: new Date().toISOString(),
      });
    } else {
      const c = clusters.get(key);
      if (!c.member_node_ids.includes(node.nodeId)) {
        c.member_node_ids.push(node.nodeId);
      }
      if (pkg.url && !c.screens.some(s => s.url === pkg.url)) {
        c.screens.push({ url: pkg.url, role: pkg.scenario?.role || 'anonymous', evidencePackageId: evidenceId });
      }
      // Update confidence
      const avg = c.confidence_distribution.avg;
      c.confidence_distribution.avg = avg;
    }
  }

  const result = Array.from(clusters.values());
  for (const c of result) {
    c.usage_count = c.member_node_ids.length;
  }
  return result;
}

/**
 * Compute drift classification for a cluster.
 * Returns { drift_classification, drift_score, drifted_properties }
 */
function computeDrift(cluster, pkg) {
  if (!pkg.antd || !pkg.antd.tokens) {
    return {
      drift_classification: 'custom',
      drift_score: 0,
      drifted_properties: [],
    };
  }

  const driftedProps = [];
  const antdVersion = pkg.antd.version || '5';

  // Check token-level drift
  if (pkg.antd.tokens) {
    for (const [tokenName, tokenData] of Object.entries(pkg.antd.tokens)) {
      if (tokenData.source === 'inferred' && tokenData.confidence < 0.7) {
        driftedProps.push({
          property: tokenName,
          expected: 'AntD default (inferred)',
          actual: tokenData.value,
          confidence: tokenData.confidence,
        });
      }
    }
  }

  if (driftedProps.length > 0) {
    return {
      drift_classification: 'drifted',
      drift_score: Math.min(1, driftedProps.length * 0.2),
      drifted_properties: driftedProps,
    };
  }

  // Check if cluster nodes have AntD class matches (per-cluster, not global)
  const clusterHasAntdClasses = cluster.member_node_ids &&
    cluster.member_node_ids.some(nid => pkg.antd.classMatches && pkg.antd.classMatches[nid]);
  if (clusterHasAntdClasses) {
    return {
      drift_classification: 'antd-aligned',
      drift_score: 0,
      drifted_properties: [],
    };
  }

  return {
    drift_classification: 'custom',
    drift_score: 0,
    drifted_properties: [],
  };
}

module.exports = {
  validateEvidencePackage,
  computeSignalStatus,
  computeTokenInventory,
  computeClusters,
  computeDrift,
  SIGNAL_DEFINITIONS,
  SUPPORTED_SCHEMA_VERSIONS,
};