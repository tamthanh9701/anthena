/**
 * Shared Core — Self-contained token processing logic for Anthena Sync.
 *
 * No dependencies on extension/, backend/, or any workspace packages.
 * Runs in Figma sandbox and Node test runner identically.
 *
 * Uses readNodePluginData / writeNodePluginData adapters for Figma runtime.
 * Never accesses node.pluginData directly outside these adapters.
 */

'use strict';

var SOURCE_KIT_NAME = 'Ant Design 5 Kit';
var CLONE_PREFIX = 'Anthena Sync — ';
var TOKEN_NODE_TYPE = 'TOKEN';

// ─── Runtime PluginData Adapters ────────
// Real Figma nodes expose getPluginData(key) / setPluginData(key, value).
// Test/simulator nodes expose node.pluginData directly.

function readNodePluginData(node, key) {
  if (node.getPluginData && typeof node.getPluginData === 'function') {
    var raw = node.getPluginData(key);
    try { return raw ? JSON.parse(raw) : undefined; } catch (e) { return raw; }
  }
  // Fallback: direct property for test harness
  return (node.pluginData && node.pluginData[key]);
}

function writeNodePluginData(node, key, value) {
  if (node.setPluginData && typeof node.setPluginData === 'function') {
    var raw = typeof value === 'string' ? value : JSON.stringify(value);
    node.setPluginData(key, raw);
    return;
  }
  // Fallback: direct property for test harness
  node.pluginData = node.pluginData || {};
  node.pluginData[key] = value;
}

// Convenience: write multiple keys at once on root node
function writeNodePluginDataBulk(node, data) {
  for (var key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      writeNodePluginData(node, key, data[key]);
    }
  }
}

// ─── Clone Identity ───────────

function computeCloneId(sourceFileKey, releaseHash) {
  var h = 0;
  var s = sourceFileKey + ':' + releaseHash;
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return 'anthena-clone-' + Math.abs(h).toString(36);
}

// ─── Conflict Detection ─────────

function detectSourceConflict(sourceKitRoot, cloneManifest) {
  if (!cloneManifest) {
    return { hasConflict: false, reason: null };
  }
  var currentKitVersion = readNodePluginData(sourceKitRoot, 'anthenaKitVersion') || '0';
  var clonedKitVersion = cloneManifest.sourceKitVersion || '0';
  if (currentKitVersion !== clonedKitVersion) {
    return {
      hasConflict: true,
      reason: 'Source kit version changed: ' + clonedKitVersion + ' → ' + currentKitVersion + '. Re-clone required.'
    };
  }
  var currentHash = hashSourceStructure(sourceKitRoot);
  var clonedHash = cloneManifest.sourceStructureHash;
  if (currentHash !== clonedHash) {
    return {
      hasConflict: true,
      reason: 'Source kit structure changed (hash mismatch). Re-clone required.'
    };
  }
  return { hasConflict: false, reason: null };
}

function hashSourceStructure(root) {
  var tokenNodes = [];
  walkTokens(root, function (node) {
    tokenNodes.push({
      id: node.id,
      name: node.name,
      tokenPath: readNodePluginData(node, 'tokenPath') || null
    });
  });
  tokenNodes.sort(function (a, b) { return (a.id || '').localeCompare(b.id || ''); });
  var json = JSON.stringify(tokenNodes);
  var h = 0;
  for (var i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── Clone Creation ────────────

function createOwnedClone(sourceKitRoot, cloneId, releaseUrl) {
  var cloneRoot = deepCloneTokenNodes(sourceKitRoot);
  cloneRoot.name = CLONE_PREFIX + cloneId;
  writeNodePluginData(cloneRoot, 'anthenaCloneId', cloneId);
  writeNodePluginData(cloneRoot, 'anthenaSourceKitVersion', readNodePluginData(sourceKitRoot, 'anthenaKitVersion') || '0');
  writeNodePluginData(cloneRoot, 'anthenaSourceStructureHash', hashSourceStructure(sourceKitRoot));
  writeNodePluginData(cloneRoot, 'anthenaReleaseUrl', releaseUrl);
  writeNodePluginData(cloneRoot, 'anthenaCreatedAt', new Date().toISOString());
  writeNodePluginData(cloneRoot, 'anthenaLastSyncAt', null);
  writeNodePluginData(cloneRoot, 'anthenaAppliedTokenCount', 0);
  return cloneRoot;
}

function deepCloneTokenNodes(node) {
  var clone = {
    id: 'clone-' + node.id,
    name: node.name,
    type: node.type,
    children: [],
    fills: node.fills ? JSON.parse(JSON.stringify(node.fills)) : null,
    strokes: node.strokes ? JSON.parse(JSON.stringify(node.strokes)) : null,
    effects: node.effects ? JSON.parse(JSON.stringify(node.effects)) : null,
    cornerRadius: node.cornerRadius,
    tokenValue: node.tokenValue
  };
  // Also clone plugin data (both paths for test compatibility)
  clone.pluginData = extend({}, node.pluginData || {});
  if (node.setPluginData && node.getPluginData) {
    clone.setPluginData = node.setPluginData.bind ? node.setPluginData.bind(node) : node.setPluginData;
    clone.getPluginData = node.getPluginData.bind ? node.getPluginData.bind(node) : node.getPluginData;
  }
  if (node.children) {
    for (var i = 0; i < node.children.length; i++) {
      clone.children.push(deepCloneTokenNodes(node.children[i]));
    }
  }
  return clone;
}

function extend(target, source) {
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  }
  return target;
}

// ─── Token Application ──────────

function applyTokensToClone(cloneRoot, tokens) {
  var result = { applied: 0, skipped: 0, unchanged: 0, errors: [] };
  if (!cloneRoot || !tokens || tokens.length === 0) {
    return result;
  }
  var tokenIndex = {};
  walkTokens(cloneRoot, function (node) {
    var path = readNodePluginData(node, 'tokenPath');
    if (path) {
      tokenIndex[path] = node;
    }
  });
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    try {
      var tokenPath = token.tokenName;
      var entry = tokenIndex[tokenPath];
      if (!entry) {
        result.skipped++;
        continue;
      }
      var lastApplied = readNodePluginData(entry, 'anthenaAppliedValue');
      if (lastApplied === token.canonicalValue) {
        result.unchanged++;
        continue;
      }
      // Apply value
      entry.tokenValue = token.canonicalValue;
      writeNodePluginData(entry, 'anthenaLastAppliedAt', new Date().toISOString());
      writeNodePluginData(entry, 'anthenaAppliedValue', token.canonicalValue);
      writeNodePluginData(entry, 'anthenaSource', 'anthena');
      applyTokenToPaint(entry, token);
      result.applied++;
    } catch (err) {
      result.errors.push('Failed to apply ' + token.tokenName + ': ' + err.message);
    }
  }
  writeNodePluginData(cloneRoot, 'anthenaLastSyncAt', new Date().toISOString());
  var prevCount = readNodePluginData(cloneRoot, 'anthenaAppliedTokenCount') || 0;
  writeNodePluginData(cloneRoot, 'anthenaAppliedTokenCount', prevCount + result.applied);
  return result;
}

function applyTokenToPaint(node, token) {
  var val = token.canonicalValue;
  var type = token.dataType;
  if (type === 'color' && val.charAt(0) === '#') {
    var rgb = hexToRgb(val);
    // Clone fills array and reassign (do not mutate in-place)
    if (node.fills && node.fills.length > 0) {
      var newFills = JSON.parse(JSON.stringify(node.fills));
      newFills[0].color = rgb;
      newFills[0].type = 'SOLID';
      node.fills = newFills;
    }
    if (node.strokes && node.strokes.length > 0) {
      var newStrokes = JSON.parse(JSON.stringify(node.strokes));
      if (newStrokes[0].color) newStrokes[0].color = rgb;
      node.strokes = newStrokes;
    }
  } else if (type === 'dimension' && val.slice(-2) === 'px') {
    var px = parseFloat(val);
    if (!isNaN(px)) {
      var lower = token.tokenName.toLowerCase();
      if (lower.indexOf('radius') !== -1 || lower.indexOf('borderradius') !== -1) {
        node.cornerRadius = px;
      }
    }
  }
}

// ─── Conflict Prevention on Apply ───

/**
 * Check whether it is safe to apply tokens to the clone.
 * - If sourceKitRoot is provided (test/source-aware mode), compare hashes.
 * - If only paramsSourceHash is provided, compare against clone's stored hash.
 * - If neither sourceKitRoot nor paramsSourceHash, skip hash comparison and trust clone identity.
 */
function checkApplyPrecondition(cloneRoot, sourceKitRoot, paramsSourceHash) {
  if (sourceKitRoot) {
    // Explicit source kit provided (test or full Figma context)
    var currentHash = hashSourceStructure(sourceKitRoot);
    var clonedHash = readNodePluginData(cloneRoot, 'anthenaSourceStructureHash');
    if (currentHash !== clonedHash) {
      return {
        canApply: false,
        reason: 'Source kit structure changed since clone. Re-clone first. (hash: ' + clonedHash + ' → ' + currentHash + ')'
      };
    }
  } else if (paramsSourceHash) {
    // Payload includes a source hash for comparison
    var clonedHash2 = readNodePluginData(cloneRoot, 'anthenaSourceStructureHash');
    if (paramsSourceHash !== clonedHash2) {
      return {
        canApply: false,
        reason: 'Source structure hash mismatch. Re-clone first. (payload: ' + paramsSourceHash + ' vs clone: ' + clonedHash2 + ')'
      };
    }
  }
  // No source kit, no source hash — trust clone identity (owned clone guard in code.js)
  return { canApply: true, reason: null };
}

// ─── Helpers ──────────────

function walkTokens(node, callback) {
  if (!node) return;
  var hasTokenPath = readNodePluginData(node, 'tokenPath');
  if (hasTokenPath || node.type === TOKEN_NODE_TYPE) {
    callback(node);
  }
  if (node.children) {
    for (var i = 0; i < node.children.length; i++) {
      walkTokens(node.children[i], callback);
    }
  }
}

function hexToRgb(hex) {
  var clean = hex.replace('#', '');
  var r = parseInt(clean.substring(0, 2), 16) / 255;
  var g = parseInt(clean.substring(2, 4), 16) / 255;
  var b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r: r, g: g, b: b };
}

// ─── Exports ──────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    readNodePluginData: readNodePluginData,
    writeNodePluginData: writeNodePluginData,
    writeNodePluginDataBulk: writeNodePluginDataBulk,
    computeCloneId: computeCloneId,
    detectSourceConflict: detectSourceConflict,
    hashSourceStructure: hashSourceStructure,
    createOwnedClone: createOwnedClone,
    applyTokensToClone: applyTokensToClone,
    applyTokenToPaint: applyTokenToPaint,
    checkApplyPrecondition: checkApplyPrecondition,
    walkTokens: walkTokens,
    hexToRgb: hexToRgb,
    deepCloneTokenNodes: deepCloneTokenNodes,
    SOURCE_KIT_NAME: SOURCE_KIT_NAME,
    CLONE_PREFIX: CLONE_PREFIX,
    TOKEN_NODE_TYPE: TOKEN_NODE_TYPE
  };
}
