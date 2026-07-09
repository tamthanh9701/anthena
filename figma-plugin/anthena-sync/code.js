/**
 * Anthena Sync — Figma Plugin Code Entry
 *
 * Receives curated release JSON via figma.ui.postMessage from UI panel.
 * Uses core.readNodePluginData / core.writeNodePluginData for Figma runtime.
 * No backend fetch. No globalThis.__ANTHENA_PLUGIN_PARAMS__.
 *
 * For testing: imports from shared-core.js; Figma API stubs in test harness.
 */

'use strict';

var core = require('./shared-core.js');

var SOURCE_KIT_FILE_KEY = 'antd-kit-source';
var CLONE_FILE_NAME_PREFIX = 'Anthena Sync — ';
var PROTECTED_SOURCE_NODE_NAMES = ['Ant Design 5 Kit', 'Ant Design Kit'];

// ─── Main Entry Point ─────────

function main(params) {
  var p = params || {};
  var releaseId = p.releaseId;
  var releaseHash = p.releaseHash;
  var tokens = p.tokens;
  var action = p.action || 'apply';
  var sourceStructureHash = p.sourceStructureHash;

  if (!releaseId || !releaseHash || !Array.isArray(tokens)) {
    reportError('Missing required parameters: releaseId, releaseHash, tokens array');
    return;
  }

  var currentDoc = getCurrentDocument();
  if (!currentDoc) {
    reportError('No document open');
    return;
  }

  // ── 1. Refuse source/live kit ────
  if (PROTECTED_SOURCE_NODE_NAMES.indexOf(currentDoc.name) !== -1) {
    reportError(
      'REFUSED: target document "' + currentDoc.name + '" appears to be a source/live kit. ' +
      'The plugin only writes to an Anthena-owned clone. Create a clone first.'
    );
    return;
  }

  // ── 2. Validate clone identity ──
  var cloneId = core.computeCloneId(SOURCE_KIT_FILE_KEY, releaseHash);
  var expectedPrefix = CLONE_FILE_NAME_PREFIX + cloneId;

  if (currentDoc.name.indexOf(expectedPrefix) !== 0) {
    reportError(
      'IDENTITY_MISMATCH: Document "' + currentDoc.name + '" does not match expected clone ' +
      '"' + expectedPrefix + '". The release must be applied to an Anthena-owned clone ' +
      'created for release "' + releaseId + '" (cloneId: ' + cloneId + ').'
    );
    return;
  }

  // ── 3. Verify clone metadata ──
  var storedCloneId = core.readNodePluginData(currentDoc, 'anthenaCloneId');
  if (!storedCloneId || storedCloneId !== cloneId) {
    reportError(
      'CLONE_METADATA_MISMATCH: Document has cloneId "' + storedCloneId +
      '" but release expects "' + cloneId + '". Re-clone with correct release.'
    );
    return;
  }

  // ── 4. Precondition check ──
  // Resolve source kit: test stub takes priority; otherwise pass sourceStructureHash from payload
  var sourceKitRoot = getSourceKitRoot();
  var precondition = core.checkApplyPrecondition(currentDoc, sourceKitRoot, sourceStructureHash);

  if (!precondition.canApply) {
    reportError((action === 'verify' || action === 'dry-run') ? 'CONFLICT: ' + precondition.reason : 'CONFLICT_BLOCK: ' + precondition.reason);
    return;
  }

  // ── 5. Execute action ──
  var result;

  switch (action) {
    case 'verify':
      reportResult({
        action: 'verify',
        releaseId: releaseId,
        cloneId: cloneId,
        canApply: true,
        tokenCount: tokens.length
      });
      return;

    case 'dry-run':
      var sim = simulateApply(currentDoc, tokens);
      reportResult({
        action: 'dry-run',
        releaseId: releaseId,
        cloneId: cloneId,
        canApply: true,
        wouldApply: sim.wouldApply,
        wouldSkip: sim.wouldSkip,
        wouldBeUnchanged: sim.wouldBeUnchanged,
        tokenCount: tokens.length
      });
      return;

    case 'apply':
    default:
      result = core.applyTokensToClone(currentDoc, tokens);

      // Report result to UI BEFORE saving version history
      reportResult({
        action: 'apply',
        releaseId: releaseId,
        cloneId: cloneId,
        applied: result.applied,
        unchanged: result.unchanged,
        skipped: result.skipped,
        errors: result.errors,
        tokenCount: tokens.length,
        documentName: currentDoc.name
      });

      // Save version history (fire-and-forget, keep UI open)
      if (typeof figma !== 'undefined') {
        try {
          figma.saveVersionHistoryAsync('Anthena sync: ' + releaseId);
        } catch (e) {
          // Non-fatal: version history save failed but tokens applied
        }
      }
      return;
  }
}

// ─── Simulate Application (dry-run) ─

function simulateApply(cloneRoot, tokens) {
  var tokenIndex = {};
  core.walkTokens(cloneRoot, function (node) {
    var path = core.readNodePluginData(node, 'tokenPath');
    if (path) {
      tokenIndex[path] = node.tokenValue;
    }
  });

  var wouldApply = 0;
  var wouldSkip = 0;
  var wouldBeUnchanged = 0;

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var entry = tokenIndex[token.tokenName];
    if (entry === undefined) {
      wouldSkip++;
    } else if (entry === token.canonicalValue) {
      wouldBeUnchanged++;
    } else {
      wouldApply++;
    }
  }

  return { wouldApply: wouldApply, wouldSkip: wouldSkip, wouldBeUnchanged: wouldBeUnchanged };
}

// ─── Environment Helpers ─────

function getCurrentDocument() {
  if (typeof figma !== 'undefined') {
    return figma.root || (figma.currentPage && figma.currentPage.parent);
  }
  return null;
}

function getSourceKitRoot() {
  // Test stub only — real Figma never hashes figma.root as source
  if (typeof globalThis.__ANTHENA_SOURCE_KIT__ !== 'undefined' && globalThis.__ANTHENA_SOURCE_KIT__ !== null) {
    return globalThis.__ANTHENA_SOURCE_KIT__;
  }
  return null;
}

// ─── Report helpers ─────────

function reportResult(data) {
  var msg = JSON.stringify({ type: 'ANTHENA_RESULT' });
  var parsed = JSON.parse(msg);
  for (var key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) parsed[key] = data[key];
  }
  var finalMsg = JSON.stringify(parsed);
  if (typeof figma !== 'undefined') { figma.ui.postMessage(finalMsg); }
  else { globalThis.__ANTHENA_LAST_RESULT__ = JSON.parse(finalMsg); }
}

function reportError(message) {
  if (typeof figma !== 'undefined') {
    figma.notify(message, { error: true });
    figma.ui.postMessage(JSON.stringify({ type: 'ANTHENA_ERROR', error: message }));
  } else {
    globalThis.__ANTHENA_LAST_ERROR__ = message;
  }
}

// ─── Plugin Lifecycle ──────

if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 480, height: 640 });
  figma.ui.onmessage = function (msg) {
    if (msg.type === 'run') main(msg.params);
  };
}

module.exports = { main: main, simulateApply: simulateApply };
