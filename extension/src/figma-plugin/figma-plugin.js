/**
 * Anthena Figma Plugin — Owned Clone Workflow
 *
 * Runs inside Figma's plugin sandbox. Reads tokens from the AntD kit source,
 * writes to an owned clone. Deterministic, idempotent, conflict-detecting.
 *
 * Contract (contract-v2.yaml):
 *   - "Figma plugin: write to owned clone of AntD Figma kit"
 *   - "correct clone IDs, idempotent apply, conflict prevention"
 *
 * This file exports pure functions that operate on a Figma-like document model.
 * The local-figma-engine.js provides the simulated figma API for testing.
 *
 * @typedef {import('./local-figma-engine.js').FigmaDocument} FigmaDocument
 * @typedef {import('./local-figma-engine.js').FigmaNode} FigmaNode
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCE_KIT_NAME = 'Ant Design 5 Kit';
const CLONE_PREFIX = 'Anthena Sync — ';
const TOKEN_NODE_TYPE = 'TOKEN';

// ─── Clone Identity ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic cloneId from the source kit file key and a release hash.
 * @param {string} sourceFileKey - Figma file key of the source AntD kit
 * @param {string} releaseHash - Deterministic hash of the release content
 * @returns {string}
 */
function computeCloneId(sourceFileKey, releaseHash) {
  let h = 0;
  const s = `${sourceFileKey}:${releaseHash}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `anthena-clone-${Math.abs(h).toString(36).padStart(10, '0')}`;
}

// ─── Conflict Detection ──────────────────────────────────────────────────────

/**
 * Check if the source kit has changed since the clone was created.
 * @param {FigmaNode} sourceKitRoot - Root node of the source AntD kit
 * @param {object} cloneManifest - Stored manifest from when clone was created
 * @returns {{ hasConflict: boolean, reason: string|null }}
 */
function detectSourceConflict(sourceKitRoot, cloneManifest) {
  if (!cloneManifest) {
    return { hasConflict: false, reason: null }; // First clone — no conflict possible
  }

  const currentKitVersion = sourceKitRoot?.pluginData?.anthenaKitVersion || '0';
  const clonedKitVersion = cloneManifest.sourceKitVersion || '0';

  if (currentKitVersion !== clonedKitVersion) {
    return {
      hasConflict: true,
      reason: `Source kit version changed: ${clonedKitVersion} → ${currentKitVersion}. Re-clone required.`,
    };
  }

  // Check structural hash of the source kit's token nodes
  const currentHash = hashSourceStructure(sourceKitRoot);
  const clonedHash = cloneManifest.sourceStructureHash;

  if (currentHash !== clonedHash) {
    return {
      hasConflict: true,
      reason: `Source kit structure changed (hash mismatch). Re-clone required.`,
    };
  }

  return { hasConflict: false, reason: null };
}

/**
 * Hash the structure of the source kit's token nodes for conflict detection.
 * @param {FigmaNode} root
 * @returns {string}
 */
function hashSourceStructure(root) {
  const tokenNodes = [];
  walkTokens(root, (node) => {
    tokenNodes.push({
      id: node.id,
      name: node.name,
      tokenPath: node.pluginData?.tokenPath || null,
    });
  });

  // Deterministic hash
  const json = JSON.stringify(tokenNodes.sort((a, b) => (a.id || '').localeCompare(b.id || '')));
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── Clone Creation ──────────────────────────────────────────────────────────

/**
 * Create an owned clone of the source AntD kit.
 * @param {FigmaNode} sourceKitRoot - Root of the source AntD kit
 * @param {string} cloneId - Deterministic clone ID
 * @param {string} releaseUrl - URL to the release in the backend
 * @returns {FigmaNode} - The cloned document root
 */
function createOwnedClone(sourceKitRoot, cloneId, releaseUrl) {
  // Deep clone the structure (token nodes only)
  const cloneRoot = deepCloneTokenNodes(sourceKitRoot);

  // Mark with ownership metadata
  cloneRoot.name = `${CLONE_PREFIX}${cloneId}`;
  cloneRoot.pluginData = cloneRoot.pluginData || {};
  Object.assign(cloneRoot.pluginData, {
    anthenaCloneId: cloneId,
    anthenaSourceKitVersion: sourceKitRoot.pluginData?.anthenaKitVersion || '0',
    anthenaSourceStructureHash: hashSourceStructure(sourceKitRoot),
    anthenaReleaseUrl: releaseUrl,
    anthenaCreatedAt: new Date().toISOString(),
    anthenaLastSyncAt: null,
    anthenaAppliedTokenCount: 0,
  });

  return cloneRoot;
}

/**
 * Deep clone only token nodes from a source tree.
 * @param {FigmaNode} node
 * @returns {FigmaNode}
 */
function deepCloneTokenNodes(node) {
  const clone = {
    id: `clone-${node.id}`,
    name: node.name,
    type: node.type,
    children: [],
    pluginData: { ...(node.pluginData || {}) },
    fills: node.fills ? JSON.parse(JSON.stringify(node.fills)) : null,
    strokes: node.strokes ? JSON.parse(JSON.stringify(node.strokes)) : null,
    effects: node.effects ? JSON.parse(JSON.stringify(node.effects)) : null,
    cornerRadius: node.cornerRadius,
    tokenValue: node.tokenValue,
  };

  if (node.children) {
    for (const child of node.children) {
      clone.children.push(deepCloneTokenNodes(child));
    }
  }

  return clone;
}

// ─── Token Application ───────────────────────────────────────────────────────

/**
 * Apply tokens to the owned clone.
 * Deterministic: same tokens + same clone = same result.
 * Idempotent: applying same tokens twice = no-op.
 *
 * @param {FigmaNode} cloneRoot - The owned clone document root
 * @param {Array<{tokenName: string, canonicalValue: string, dataType: string}>} tokens
 * @returns {{ applied: number, skipped: number, unchanged: number, errors: string[] }}
 */
function applyTokensToClone(cloneRoot, tokens) {
  const result = { applied: 0, skipped: 0, unchanged: 0, errors: [] };

  if (!cloneRoot || !tokens || tokens.length === 0) {
    return result;
  }

  // Build index of existing token nodes in the clone by tokenPath
  const tokenIndex = new Map(); // tokenPath → { node, currentValue }
  walkTokens(cloneRoot, (node) => {
    const path = node.pluginData?.tokenPath;
    if (path) {
      tokenIndex.set(path, { node, currentValue: node.tokenValue });
    }
  });

  for (const token of tokens) {
    try {
      const tokenPath = token.tokenName;
      const entry = tokenIndex.get(tokenPath);

      if (!entry) {
        result.skipped++;
        continue;
      }

      // Only a value previously applied by Anthena is an idempotent no-op.
      // A pristine kit value still needs provenance on the first release apply.
      if (entry.node.pluginData?.anthenaAppliedValue === token.canonicalValue) {
        result.unchanged++;
        continue;
      }

      // Apply the value
      entry.node.tokenValue = token.canonicalValue;
      entry.node.pluginData = entry.node.pluginData || {};
      entry.node.pluginData.anthenaLastAppliedAt = new Date().toISOString();
      entry.node.pluginData.anthenaAppliedValue = token.canonicalValue;
      entry.node.pluginData.anthenaSource = 'anthena';

      // Update fills/strokes if token maps to a paint property
      applyTokenToPaint(entry.node, token);

      result.applied++;
    } catch (err) {
      result.errors.push(`Failed to apply ${token.tokenName}: ${err.message}`);
    }
  }

  // Update clone manifest
  cloneRoot.pluginData = cloneRoot.pluginData || {};
  cloneRoot.pluginData.anthenaLastSyncAt = new Date().toISOString();
  cloneRoot.pluginData.anthenaAppliedTokenCount = (cloneRoot.pluginData.anthenaAppliedTokenCount || 0) + result.applied;

  return result;
}

/**
 * Apply a token value to the node's paint properties if the token maps to a fill/stroke.
 * @param {FigmaNode} node
 * @param {{tokenName: string, canonicalValue: string, dataType: string}} token
 */
function applyTokenToPaint(node, token) {
  const val = token.canonicalValue;
  const type = token.dataType;

  if (type === 'color' && val.startsWith('#')) {
    const rgb = hexToRgb(val);
    if (node.fills && node.fills.length > 0) {
      node.fills[0].color = rgb;
      node.fills[0].type = 'SOLID';
    }
    if (node.strokes && node.strokes.length > 0) {
      // Only update stroke if it has a color (not width/pattern)
      if (node.strokes[0].color) {
        node.strokes[0].color = rgb;
      }
    }
  } else if (type === 'dimension' && val.endsWith('px')) {
    const px = parseFloat(val);
    if (!isNaN(px)) {
      if (token.tokenName.toLowerCase().includes('radius') || token.tokenName.toLowerCase().includes('borderradius')) {
        node.cornerRadius = px;
      }
    }
  }
}

// ─── Conflict Prevention on Apply ────────────────────────────────────────────

/**
 * Before applying tokens, check that the clone is still based on the current source kit.
 * @param {FigmaNode} cloneRoot
 * @param {FigmaNode} sourceKitRoot
 * @returns {{ canApply: boolean, reason: string|null }}
 */
function checkApplyPrecondition(cloneRoot, sourceKitRoot) {
  const cloneManifest = cloneRoot.pluginData || {};
  const currentSourceHash = hashSourceStructure(sourceKitRoot);
  const clonedSourceHash = cloneManifest.anthenaSourceStructureHash;

  if (currentSourceHash !== clonedSourceHash) {
    return {
      canApply: false,
      reason: `Source kit structure changed since clone. Re-clone first. (hash: ${clonedSourceHash} → ${currentSourceHash})`,
    };
  }

  return { canApply: true, reason: null };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk the token tree and call a callback for each token node.
 * @param {FigmaNode} node
 * @param {(node: FigmaNode) => void} callback
 */
function walkTokens(node, callback) {
  if (!node) return;
  if (node.pluginData?.tokenPath || node.type === TOKEN_NODE_TYPE) {
    callback(node);
  }
  if (node.children) {
    for (const child of node.children) {
      walkTokens(child, callback);
    }
  }
}

/**
 * Convert hex color to Figma RGB object.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r, g, b };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  computeCloneId,
  detectSourceConflict,
  hashSourceStructure,
  createOwnedClone,
  applyTokensToClone,
  applyTokenToPaint,
  checkApplyPrecondition,
  walkTokens,
  hexToRgb,
  deepCloneTokenNodes,
  SOURCE_KIT_NAME,
  CLONE_PREFIX,
  TOKEN_NODE_TYPE,
};
