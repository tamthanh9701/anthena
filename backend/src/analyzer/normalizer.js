'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * @typedef {import('./normalizer').NormalizedSnapshot} NormalizedSnapshot
 * @typedef {import('./normalizer').ComponentNode} ComponentNode
 * @typedef {import('./normalizer').SnapshotMetadata} SnapshotMetadata
 * @typedef {import('./normalizer').EvidenceNode} EvidenceNode
 * @typedef {import('./normalizer').StyleEntry} StyleEntry
 * @typedef {import('./normalizer').FiberData} FiberData
 */

// ──────────────────────────────────────────────
// Normalizer: converts extension snapshots to Schema v1.1
// ──────────────────────────────────────────────

/**
 * Normalize an extension snapshot package to Schema UI Graph v1.1.
 *
 * @param {NormalizerInput} input - raw snapshot package
 * @returns {NormalizedSnapshot}
 */
function normalizeExtensionSnapshot(input) {
  const log = logger.child({ module: 'normalizer', runId: input.runId, captureId: input.captureId });
  log.info('Normalizing extension snapshot');

  const { metadata, nodes, styles, screenshotPath, snapshotPath, runId, sessionId, captureId } = input;

  // 1. Merge evidence: pair DOM nodes with computed styles
  const componentTree = buildComponentTree(nodes, styles, runId, captureId, metadata);

  // 2. Determine antdTokens source
  const antdSource = detectAntdSource(metadata, nodes);

  // 3. Build viewport / fullPage info from metadata
  const viewport = {
    width: metadata.viewport?.width || 1440,
    height: metadata.viewport?.height || 900,
  };
  const fullPage = {
    width: metadata.fullPage?.width || viewport.width,
    height: metadata.fullPage?.height || viewport.height,
  };

  // 4. Build screenshot metadata from metadata signals
  const screenshot = buildScreenshotInfo(screenshotPath, metadata, viewport, fullPage);

  // 5. Build browser info
  const browser = {
    name: metadata.browser?.name || 'Chrome',
    extensionVersion: metadata.browser?.extensionVersion || '0.1.0',
  };

  // 6. Build antdTokens block
  const antdTokens = {
    _source: antdSource,
    _note: antdSource === 'runtime'
      ? 'Captured via runtime token probe'
      : antdSource === 'inferred'
        ? 'Inferred from antd CSS classes on detected nodes'
        : 'Token extraction unavailable — no antd classes or probe data found',
  };

  // 7. Assemble full normalized snapshot
  const normalized = {
    schemaVersion: '1.1.0',
    extractorVersion: metadata.extractorVersion || 'extension-0.1.0',
    analyzerVersion: null,
    captureMode: 'chrome-extension',
    captureSessionId: sessionId,
    captureId,
    runId,
    url: metadata.url || '',
    routeKey: metadata.routeKey || null,
    title: metadata.title || '',
    capturedAt: metadata.capturedAt || new Date().toISOString(),
    browser,
    screenshot,
    antdTokens,
    componentTree,
  };

  log.info({ nodeCount: componentTree.length, antdSource }, 'Normalization complete');
  return normalized;
}

// ──────────────────────────────────────────────
// Component Tree Builder
// ──────────────────────────────────────────────

/**
 * Build the componentTree array from raw evidence nodes and computed styles.
 *
 * @param {Array<object>} nodes - evidence nodes from snapshot.json
 * @param {Array<{selector: string, styles: Record<string, string>}>} styles - computed style entries
 * @param {string} runId
 * @param {string} captureId
 * @param {object} metadata
 * @returns {Array<ComponentNode>}
 */
function buildComponentTree(nodes, styles, runId, captureId, metadata) {
  // Index styles by selector for O(1) lookup
  const styleMap = indexStyles(styles);

  // Deduplicate nodes by selector (keep first occurrence)
  const seenSelectors = new Set();
  const dedupedNodes = nodes.filter(n => {
    const sel = n.selector || n.cssSelector || n.evidence?.selector || null;
    if (!sel) return true;
    if (seenSelectors.has(sel)) return false;
    seenSelectors.add(sel);
    return true;
  });

  // Extract fiber data map if available
  const fiberMap = extractFiberMap(metadata);

  const componentTree = [];
  let nodeIndex = 0;

  for (const rawNode of dedupedNodes) {
    const selector = rawNode.selector || rawNode.cssSelector || rawNode.evidence?.selector || '';
    const matchedStyles = styleMap.get(selector) || {};

    // Skip nodes with no computed styles (likely invisible / non-rendered)
    if (Object.keys(matchedStyles).length === 0 && !rawNode.tagName) {
      continue;
    }

    // Determine identity from Fiber data (if available) or fall back to DOM info
    const fiberInfo = fiberMap?.get(selector);
    const identity = buildIdentity(rawNode, fiberInfo);

    // Build rect from available position info
    const rect = buildRect(rawNode);

    // Build computedStyles (subset of meaningful CSS properties)
    const computedStyles = extractMeaningfulStyles(matchedStyles, rawNode.computedStyles);

    // Build classification
    const classification = classifyNode(rawNode, identity);

    // Build visual evidence
    const visualHash = computeVisualHash(rawNode, matchedStyles, rect);
    const cropPath = `/snapshots/runs/${runId}/pages/${captureId}/crops/node-${nodeIndex}.webp`;
    const visualEvidence = buildVisualEvidence(screenshotPath, cropPath, runId, captureId, nodeIndex, visualHash);

    // Build evidence block
    const evidence = buildEvidence(rawNode, matchedStyles);

    // Build component node
    const componentNode = {
      identity,
      rect,
      computedStyles,
      visualEvidence,
      classification,
      evidence,
    };

    componentTree.push(componentNode);
    nodeIndex++;
  }

  return componentTree;
}

// ──────────────────────────────────────────────
// Helper: index styles by selector
// ──────────────────────────────────────────────

/**
 * @param {Array<{selector: string, styles: Record<string, string>}>} styles
 * @returns {Map<string, Record<string, string>>}
 */
function indexStyles(styles) {
  const map = new Map();
  if (!Array.isArray(styles)) return map;
  for (const entry of styles) {
    if (entry.selector && entry.styles) {
      map.set(entry.selector, entry.styles);
    }
  }
  return map;
}

// ──────────────────────────────────────────────
// Helper: extract Fiber data from metadata
// ──────────────────────────────────────────────

/**
 * Extract Fiber data from metadata.signal.fiber.
 * Returns a Map<selector, fiberInfo> or null.
 *
 * @param {object} metadata
 * @returns {Map<string, object>|null}
 */
function extractFiberMap(metadata) {
  const fiberSignal = metadata?.signals?.fiber || metadata?.signal?.fiber;
  if (!fiberSignal || fiberSignal === 'unavailable') return null;

  // Fiber data can be an array of node entries, each with a selector + component info
  if (Array.isArray(fiberSignal)) {
    const map = new Map();
    for (const entry of fiberSignal) {
      const sel = entry.selector || entry.cssSelector || null;
      if (sel) {
        map.set(sel, entry);
      }
    }
    return map.size > 0 ? map : null;
  }

  // Fiber data could also be structured as { nodes: [...] }
  if (fiberSignal.nodes && Array.isArray(fiberSignal.nodes)) {
    const map = new Map();
    for (const entry of fiberSignal.nodes) {
      const sel = entry.selector || entry.cssSelector || null;
      if (sel) {
        map.set(sel, entry);
      }
    }
    return map.size > 0 ? map : null;
  }

  return null;
}

// ──────────────────────────────────────────────
// Helper: build identity
// ──────────────────────────────────────────────

/**
 * Build identity block from node data + optional fiber info.
 *
 * @param {object} rawNode
 * @param {object|null} fiberInfo
 * @returns {{name: string, source: string, confidence: number, ownerPath: string|null}}
 */
function buildIdentity(rawNode, fiberInfo) {
  // If Fiber data has a component name, use it with 'fiber' source
  if (fiberInfo && fiberInfo.componentName) {
    return {
      name: fiberInfo.componentName,
      source: 'fiber',
      confidence: fiberInfo.confidence ?? 0.9,
      ownerPath: fiberInfo.ownerPath || null,
    };
  }

  // If node has antd classes, derive from class
  const antdClasses = extractAntdClasses(rawNode);
  if (antdClasses.length > 0) {
    const antdName = antdClasses[0].replace(/^ant-/, '');
    const baseName = antdName.charAt(0).toUpperCase() + antdName.slice(1);
    return {
      name: baseName,
      source: 'antd-class',
      confidence: 0.85,
      ownerPath: null,
    };
  }

  // Use tagName
  const tag = rawNode.tagName || rawNode.tag || 'div';
  return {
    name: tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase(),
    source: 'tag',
    confidence: 0.7,
    ownerPath: null,
  };
}

// ──────────────────────────────────────────────
// Helper: build rect
// ──────────────────────────────────────────────

/**
 * Build rect from node position data.
 *
 * @param {object} rawNode
 * @returns {{top: number, left: number, width: number, height: number}}
 */
function buildRect(rawNode) {
  const rect = rawNode.rect || rawNode.boundingRect || rawNode.boundingClientRect || {};
  return {
    top: rect.top ?? rect.y ?? 0,
    left: rect.left ?? rect.x ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
  };
}

// ──────────────────────────────────────────────
// Helper: extract meaningful computed styles
// ──────────────────────────────────────────────

/**
 * Extract meaningful CSS properties from matched styles.
 * Prioritizes extension-computed styles over rawNode styles.
 *
 * @param {Record<string, string>} matchedStyles
 * @param {Record<string, string>} [fallbackStyles]
 * @returns {Record<string, string>}
 */
function extractMeaningfulStyles(matchedStyles, fallbackStyles) {
  const meaningfulKeys = [
    'color', 'background-color', 'backgroundColor',
    'font-size', 'fontSize',
    'border-radius', 'borderRadius',
    'line-height', 'lineHeight',
    'font-family', 'fontFamily',
    'padding', 'margin',
    'border',
    'display',
    'flex-direction', 'flexDirection',
    'align-items', 'alignItems',
    'justify-content', 'justifyContent',
    'gap',
    'width', 'height',
    'min-width', 'minWidth',
    'min-height', 'minHeight',
  ];

  const out = {};
  const source = Object.keys(matchedStyles).length > 0 ? matchedStyles : (fallbackStyles || {});

  for (const key of meaningfulKeys) {
    if (source[key] != null && source[key] !== '') {
      // Normalize key: prefer camelCase for consistency
      const normalized = camelCaseCssProp(key);
      out[normalized] = source[key];
    }
  }

  return out;
}

// ──────────────────────────────────────────────
// Helper: CSS prop normalization
// ──────────────────────────────────────────────

/**
 * Convert CSS property name to camelCase.
 *
 * @param {string} prop
 * @returns {string}
 */
function camelCaseCssProp(prop) {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ──────────────────────────────────────────────
// Helper: classify node
// ──────────────────────────────────────────────

/**
 * Classify a node into category + type.
 *
 * @param {object} rawNode
 * @param {{name: string, source: string}} identity
 * @returns {{type: string, category: string, componentName: string, isDrifted: boolean, driftScore: number}}
 */
function classifyNode(rawNode, identity) {
  const tag = (rawNode.tagName || rawNode.tag || '').toLowerCase();
  const antdClasses = extractAntdClasses(rawNode);

  // Interactive HTML elements (button, input, select, a with href)
  const interactiveTags = ['button', 'input', 'select', 'a'];

  // Container HTML elements
  const containerTags = ['div', 'section', 'article', 'nav', 'header', 'footer', 'main', 'aside', 'ul', 'ol', 'li', 'form', 'fieldset'];

  if (antdClasses.length > 0) {
    const antdName = antdClasses[0].replace(/^ant-/, '');
    const componentName = antdName.charAt(0).toUpperCase() + antdName.slice(1);
    return {
      type: 'component',
      category: 'antd',
      componentName,
      isDrifted: false,
      driftScore: 0,
    };
  }

  if (interactiveTags.includes(tag)) {
    return {
      type: 'component',
      category: 'custom',
      componentName: identity.name,
      isDrifted: false,
      driftScore: 0,
    };
  }

  if (containerTags.includes(tag)) {
    return {
      type: 'container',
      category: 'html-native',
      componentName: identity.name,
      isDrifted: false,
      driftScore: 0,
    };
  }

  // Fallback: text, span, img, hr, br, or unknown tags
  return {
    type: tag === 'img' ? 'component' : 'container',
    category: 'html-native',
    componentName: identity.name,
    isDrifted: false,
    driftScore: 0,
  };
}

// ──────────────────────────────────────────────
// Helper: extract antd classes from node
// ──────────────────────────────────────────────

/**
 * Extract antd CSS class names from a raw node.
 *
 * @param {object} rawNode
 * @returns {string[]}
 */
function extractAntdClasses(rawNode) {
  // Check multiple possible locations for class info
  const classCandidates = [
    rawNode.className,
    rawNode.classList,
    rawNode.classes,
    rawNode.evidence?.antdClasses,
    rawNode.evidence?.classes,
  ];

  const antdClasses = new Set();

  for (const candidate of classCandidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      for (const cls of candidate.split(/\s+/)) {
        if (cls.startsWith('ant-')) {
          // Extract base antd class (e.g., 'ant-btn' from 'ant-btn-primary')
          const parts = cls.split('-');
          const base = parts.length >= 2 ? `ant-${parts[1]}` : cls;
          antdClasses.add(base);
        }
      }
    }

    if (Array.isArray(candidate)) {
      for (const cls of candidate) {
        if (typeof cls === 'string' && cls.startsWith('ant-')) {
          const parts = cls.split('-');
          const base = parts.length >= 2 ? `ant-${parts[1]}` : cls;
          antdClasses.add(base);
        }
      }
    }
  }

  return Array.from(antdClasses);
}

// ──────────────────────────────────────────────
// Helper: build visual evidence
// ──────────────────────────────────────────────

/**
 * Build visualEvidence block for a component node.
 *
 * @param {string} screenshotPath
 * @param {string} cropPath
 * @param {string} runId
 * @param {string} captureId
 * @param {number} nodeIndex
 * @param {string} visualHash
 * @returns {{cropPath: string, visualHash: string, screenshotPath: string}}
 */
function buildVisualEvidence(screenshotPath, cropPath, runId, captureId, nodeIndex, visualHash) {
  return {
    cropPath,
    visualHash,
    screenshotPath,
  };
}

// ──────────────────────────────────────────────
// Helper: build evidence block
// ──────────────────────────────────────────────

/**
 * Build evidence block for a component node.
 *
 * @param {object} rawNode
 * @param {Record<string, string>} matchedStyles
 * @returns {object}
 */
function buildEvidence(rawNode, matchedStyles) {
  const tag = (rawNode.tagName || rawNode.tag || 'div').toLowerCase();
  const evidence = rawNode.evidence || {};
  const selector = rawNode.selector || rawNode.cssSelector || evidence.selector || '';
  const classList = Array.isArray(rawNode.classList)
    ? rawNode.classList
    : typeof rawNode.className === 'string'
      ? rawNode.className.split(/\s+/).filter(Boolean)
      : [];

  // Determine antd classes from classList
  const antdClasses = classList.filter(c => c.startsWith('ant-'));

  return {
    selector,
    tagName: tag,
    ariaRole: evidence.ariaRole || rawNode.ariaRole || rawNode.role || null,
    textContent: evidence.textContent || rawNode.textContent || rawNode.innerText || null,
    childCount: evidence.childCount ?? rawNode.childCount ?? rawNode.childElementCount ?? null,
    antdClasses,
    detectorVersion: evidence.detectorVersion || 'extension-0.1.0',
  };
}

// ──────────────────────────────────────────────
// Helper: compute deterministic visual hash
// ──────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hash from tagName + className + key styles + rect.
 * NOT a real image hash — placeholder until image processor runs.
 *
 * @param {object} rawNode
 * @param {Record<string, string>} matchedStyles
 * @param {{top: number, left: number, width: number, height: number}} rect
 * @returns {string}
 */
function computeVisualHash(rawNode, matchedStyles, rect) {
  const tag = rawNode.tagName || rawNode.tag || 'div';
  const className = typeof rawNode.className === 'string' ? rawNode.className : '';
  const classList = Array.isArray(rawNode.classList) ? rawNode.classList.join(' ') : '';
  const allClasses = className || classList;

  const color = matchedStyles.color || matchedStyles.Color || '';
  const bgColor = matchedStyles['background-color'] || matchedStyles.backgroundColor || '';

  const payload = JSON.stringify({
    tag,
    class: allClasses,
    color,
    bgColor,
    rect,
  });

  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return `sha256_${hash}`;
}

// ──────────────────────────────────────────────
// Helper: detect antd token source
// ──────────────────────────────────────────────

/**
 * Determine the antdTokens._source value based on metadata signals and node data.
 *
 * @param {object} metadata
 * @param {Array<object>} nodes
 * @returns {'runtime'|'inferred'|'unavailable'}
 */
function detectAntdSource(metadata, nodes) {
  // Check metadata.signal.fiber for runtime token probe
  const fiberSignal = metadata?.signals?.fiber || metadata?.signal?.fiber;
  if (fiberSignal && fiberSignal !== 'unavailable') {
    // If fiber has token data, it's runtime
    if (typeof fiberSignal === 'object' && fiberSignal.tokens) {
      return 'runtime';
    }
    // If fiber gives component names but no tokens, still runtime probe was available
    if (typeof fiberSignal === 'object' && (Array.isArray(fiberSignal) || fiberSignal.nodes)) {
      return 'runtime';
    }
  }

  // Check if any node has antd CSS classes
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (extractAntdClasses(node).length > 0) {
        return 'inferred';
      }
    }
  }

  // Check metadata for explicit antd detection
  if (metadata.antdDetected || metadata.hasAntd) {
    return 'inferred';
  }

  return 'unavailable';
}

// ──────────────────────────────────────────────
// Helper: build screenshot info
// ──────────────────────────────────────────────

/**
 * Build the screenshot block from metadata and filesystem paths.
 *
 * @param {string} screenshotPath
 * @param {object} metadata
 * @param {{width: number, height: number}} viewport
 * @param {{width: number, height: number}} fullPage
 * @returns {object}
 */
function buildScreenshotInfo(screenshotPath, metadata, viewport, fullPage) {
  // Determine capture mode (scroll-stitch vs viewport)
  const mode = metadata.screenshotMode || metadata.screenshot?.mode || 'scroll-stitch';

  // Stitch confidence (only relevant for scroll-stitch mode)
  const stitchConfidence = mode === 'scroll-stitch'
    ? metadata.screenshot?.stitchConfidence ?? 0.86
    : null;

  // Known issues (sticky header duplication, etc.)
  const issues = metadata.screenshot?.issues || [];

  return {
    path: screenshotPath,
    mode,
    viewport,
    fullPage,
    ...(stitchConfidence != null ? { stitchConfidence } : {}),
    ...(issues.length > 0 ? { issues } : {}),
  };
}

// ──────────────────────────────────────────────
// Helper: decompress gzipped snapshot JSON
// ──────────────────────────────────────────────

/**
 * Decompress a gzipped snapshot buffer and parse as JSON.
 *
 * @param {Buffer} compressed - gzipped buffer
 * @returns {Promise<object>} parsed snapshot data
 */
function decompressSnapshot(compressed) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(compressed, (err, decompressed) => {
      if (err) {
        reject(new Error(`Failed to decompress snapshot: ${err.message}`));
        return;
      }
      try {
        const parsed = JSON.parse(decompressed.toString('utf8'));
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(`Failed to parse snapshot JSON: ${parseErr.message}`));
      }
    });
  });
}

// ──────────────────────────────────────────────
// Type Definitions (JSDoc)
// ──────────────────────────────────────────────

/**
 * @typedef {object} NormalizerInput
 * @property {object} metadata - parsed metadata.json
 * @property {Array<object>} nodes - evidence nodes from snapshot.json
 * @property {Array<{selector: string, styles: Record<string, string>}>} styles - computed style entries
 * @property {string} screenshotPath - path to full.webp
 * @property {string} snapshotPath - path to snapshot.json.gz
 * @property {string} runId
 * @property {string} sessionId
 * @property {string} captureId
 */

/**
 * @typedef {object} NormalizedSnapshot
 * @property {string} schemaVersion - "1.1.0"
 * @property {string} extractorVersion
 * @property {string|null} analyzerVersion
 * @property {string} captureMode - "chrome-extension"
 * @property {string} captureSessionId
 * @property {string} captureId
 * @property {string} runId
 * @property {string} url
 * @property {string|null} routeKey
 * @property {string} title
 * @property {string} capturedAt
 * @property {{name: string, extensionVersion: string}} browser
 * @property {{path: string, mode: string, viewport: {width: number, height: number}, fullPage: {width: number, height: number}, stitchConfidence?: number, issues?: string[]}} screenshot
 * @property {{_source: string, _note: string}} antdTokens
 * @property {Array<ComponentNode>} componentTree
 */

/**
 * @typedef {object} ComponentNode
 * @property {{name: string, source: string, confidence: number, ownerPath: string|null}} identity
 * @property {{top: number, left: number, width: number, height: number}} rect
 * @property {Record<string, string>} computedStyles
 * @property {{cropPath: string, visualHash: string, screenshotPath: string}} visualEvidence
 * @property {{type: string, category: string, componentName: string, isDrifted: boolean, driftScore: number}} classification
 * @property {{selector: string, tagName: string, ariaRole: string|null, textContent: string|null, childCount: number|null, antdClasses: string[], detectorVersion: string}} evidence
 */

module.exports = {
  normalizeExtensionSnapshot,
  decompressSnapshot,
  buildComponentTree,
  detectAntdSource,
  computeVisualHash,
  extractAntdClasses,
  classifyNode,
  // Exposed for testing
  _internals: {
    indexStyles,
    extractFiberMap,
    buildIdentity,
    buildRect,
    extractMeaningfulStyles,
    buildVisualEvidence,
    buildEvidence,
    buildScreenshotInfo,
    camelCaseCssProp,
  },
};
