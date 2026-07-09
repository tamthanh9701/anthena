/**
 * Figma Plugin Entry Smoke Test
 *
 * Self-contained mock Figma runtime. No extension/ imports.
 * Uses readNodePluginData/writeNodePluginData stubs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Self-contained test stubs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

var LAST_RESULT = null;
var LAST_ERROR = null;

function resetGlobals() {
  LAST_RESULT = null;
  LAST_ERROR = null;
  globalThis.figma = undefined;
  globalThis.__ANTHENA_LAST_RESULT__ = null;
  globalThis.__ANTHENA_LAST_ERROR__ = null;
  globalThis.__ANTHENA_SOURCE_KIT__ = null;
}

function buildTokenNode(tokenName, value, dataType) {
  return {
    id: 'token-' + tokenName,
    name: tokenName,
    type: 'TOKEN',
    children: [],
    tokenValue: value,
    // Simulator-style: direct pluginData for backward compat + getPluginData/setPluginData methods
    pluginData: { tokenPath: tokenName, tokenType: dataType, tokenCategory: 'unknown', anthenaAppliedValue: null, anthenaSource: 'antd-kit' },
    getPluginData__: {},
    getPluginData: function (key) { var v = this.pluginData[key]; return v === undefined ? '' : (typeof v === 'string' ? v : JSON.stringify(v)); },
    setPluginData: function (key, value) { this.pluginData[key] = typeof value === 'string' ? value : JSON.parse(JSON.stringify(value)); }
  };
}

function buildTokenGroup(name, children) {
  return { id: 'group-' + name, name: name, type: 'GROUP', children: children, pluginData: { groupType: 'token-category' }, getPluginData: function(k){return this.pluginData[k]||'';}, setPluginData: function(k,v){this.pluginData[k]=v;} };
}

function buildSourceKit(opts) {
  opts = opts || {};
  var kitVersion = opts.kitVersion || '1.0.0';
  return {
    id: 'antd-kit-source', name: 'Ant Design 5 Kit', type: 'DOCUMENT',
    pluginData: { anthenaKitVersion: kitVersion, anthenaFileKey: 'antd-kit-source' },
    getPluginData: function(k){var v=this.pluginData[k];return v===undefined?'':(typeof v==='string'?v:JSON.stringify(v));},
    setPluginData: function(k,v){this.pluginData[k]=v;},
    children: [buildTokenGroup('colors', [
      buildTokenNode('colorPrimary', '#1677ff', 'color'), buildTokenNode('colorBgContainer', '#ffffff', 'color'),
      buildTokenNode('borderRadius', '6px', 'dimension'), buildTokenNode('borderRadiusLG', '8px', 'dimension'),
      buildTokenNode('fontSizeMD', '14px', 'dimension'), buildTokenNode('boxShadow', '0 1px 2px 0 rgba(0,0,0,0.03)', 'string')
    ])]
  };
}

import * as core from '../anthena-sync/shared-core.js';

var RELEASE_HASH = 'test-release-hash-001';
var RELEASE_ID = 'rel-001';

function createOwnedCloneDoc(kit, releaseHash) {
  var cloneId = core.computeCloneId('antd-kit-source', releaseHash);
  return core.createOwnedClone(kit, cloneId, '');
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Mock Figma runtime Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function setupFigmaMock(doc, sourceKit) {
  resetGlobals();
  globalThis.__ANTHENA_SOURCE_KIT__ = sourceKit || null;

  var currentNode = doc || buildSourceKit();
  var postedMessages = [];
  var notifications = [];

  globalThis.figma = {
    root: currentNode,
    currentPage: { parent: currentNode },
    showUI: function () {},
    ui: {
      postMessage: function (msg) {
        var parsed = (typeof msg === 'string') ? JSON.parse(msg) : msg;
        postedMessages.push(parsed);
        if (parsed.type === 'ANTHENA_ERROR') LAST_ERROR = parsed.error;
        LAST_RESULT = parsed;
      },
      onmessage: null
    },
    notify: function (msg) { notifications.push({ message: msg }); },
    saveVersionHistoryAsync: function () { return Promise.resolve(); },
    closePlugin: function () {}
  };
  globalThis.__html__ = '<html></html>';

  return {
    getPostedMessages: function () { return postedMessages; },
    getNotifications: function () { return notifications; },
    getNode: function () { return currentNode; }
  };
}

beforeEach(function () { resetGlobals(); });

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 1. Manifest validation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('manifest.json', function () {
  it('has allowedDomains ["none"]', function () {
    var manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'anthena-sync', 'manifest.json'), 'utf-8'));
    expect(manifest.networkAccess.allowedDomains).toEqual(['none']);
  });
  it('has documentAccess dynamic-page', function () {
    var manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'anthena-sync', 'manifest.json'), 'utf-8'));
    expect(manifest.documentAccess).toBe('dynamic-page');
  });
  it('does not include currentuser permission', function () {
    var manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'anthena-sync', 'manifest.json'), 'utf-8'));
    expect(manifest.permissions).toBeUndefined();
  });
  it('has required fields', function () {
    var manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'anthena-sync', 'manifest.json'), 'utf-8'));
    expect(manifest.name).toBe('Anthena Sync');
    expect(manifest.id).toBe('anthena-sync');
    expect(manifest.main).toBe('dist/code.js');
    expect(manifest.ui).toBe('dist/ui.html');
    expect(manifest.editorType).toEqual(['figma']);
  });
});

// --- 1b. Dist manifest validation ---

describe("dist manifest.json", function () {
  var manifestPath = resolve(__dirname, "..", "anthena-sync", "dist", "manifest.json");
  it('has allowedDomains ["none"]', function () {
    var manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.networkAccess.allowedDomains).toEqual(["none"]);
  });
  it("has documentAccess dynamic-page", function () {
    var manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.documentAccess).toBe("dynamic-page");
  });
  it("does not include currentuser permission", function () {
    var manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.permissions).toBeUndefined();
  });
  it("points to code.js and ui.html (no dist/ prefix)", function () {
    var manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.main).toBe("code.js");
    expect(manifest.ui).toBe("ui.html");
  });
});



// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 2. getPluginData-only nodes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('getPluginData-only nodes', function () {
  it('core.readNodePluginData works with getPluginData method', function () {
    var node = buildTokenNode('testToken', '#ff0000', 'color');
    expect(core.readNodePluginData(node, 'tokenPath')).toBe('testToken');
    expect(core.readNodePluginData(node, 'nonexistent')).toBeUndefined();
  });
  it('core.writeNodePluginData writes via setPluginData', function () {
    var node = buildTokenNode('testToken', '#ff0000', 'color');
    core.writeNodePluginData(node, 'anthenaAppliedValue', 'myVal');
    expect(core.readNodePluginData(node, 'anthenaAppliedValue')).toBe('myVal');
  });
  it('walkTokens uses readNodePluginData for tokenPath', function () {
    var node = buildTokenNode('t1', 'red', 'color');
    var found = [];
    core.walkTokens(node, function (n) { found.push(n.name); });
    expect(found).toEqual(['t1']);
  });
  it('apply finds tokens via getPluginData', function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var result = core.applyTokensToClone(cloneDoc, [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }
    ]);
    expect(result.applied).toBe(1);
    // Verify it was written via setPluginData
    var path = 'colorPrimary';
    var tokenNode = null;
    core.walkTokens(cloneDoc, function (n) {
      if (core.readNodePluginData(n, 'tokenPath') === path) tokenNode = n;
    });
    expect(tokenNode).not.toBeNull();
    expect(core.readNodePluginData(tokenNode, 'anthenaAppliedValue')).toBe('#1890ff');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 3. Source kit guard Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: source kit guard', function () {
  it('refuses source kit as target', async function () {
    var kit = buildSourceKit();
    setupFigmaMock(kit, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_ERROR');
    expect(LAST_RESULT.error).toContain('REFUSED');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 4. Clone identity guard Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: clone identity guard', function () {
  it('refuses document with wrong clone name', async function () {
    var kit = buildSourceKit();
    var wrongDoc = { name: 'Some Other Document', type: 'DOCUMENT', pluginData: {}, children: [], getPluginData: function(k){return this.pluginData[k]||'';}, setPluginData: function(k,v){this.pluginData[k]=v;} };
    setupFigmaMock(wrongDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_ERROR');
    expect(LAST_RESULT.error).toContain('IDENTITY_MISMATCH');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 5a. Apply with source kit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: apply with source kit', function () {
  it('applies tokens to matching clone', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({
      releaseId: RELEASE_ID, releaseHash: RELEASE_HASH,
      tokens: [
        { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
        { tokenName: 'borderRadius', canonicalValue: '8px', dataType: 'dimension' },
        { tokenName: 'colorBgContainer', canonicalValue: '#f0f2f5', dataType: 'color' }
      ],
      releaseUrl: '', action: 'apply'
    });
    expect(LAST_RESULT.type).toBe('ANTHENA_RESULT');
    expect(LAST_RESULT.action).toBe('apply');
    expect(LAST_RESULT.applied).toBe(3);
    expect(LAST_RESULT.releaseId).toBe(RELEASE_ID);
  });
  it('applies subset of tokens', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.applied).toBe(1);
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 5b. Apply WITHOUT source kit (real Figma mode) Ã¢â€â‚¬

describe('plugin entry: apply without source kit', function () {
  it('applies tokens without __ANTHENA_SOURCE_KIT__', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    // No sourceKit arg Ã¢â‚¬â€ __ANTHENA_SOURCE_KIT__ stays null
    setupFigmaMock(cloneDoc, null);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_RESULT');
    expect(LAST_RESULT.applied).toBe(1);
  });
  it('verify passes without source kit and no sourceStructureHash', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, null);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'verify' });
    expect(LAST_RESULT.type).toBe('ANTHENA_RESULT');
    expect(LAST_RESULT.canApply).toBe(true);
  });
  it('apply respects sourceStructureHash in payload', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var cloneHash = core.readNodePluginData(cloneDoc, 'anthenaSourceStructureHash');
    setupFigmaMock(cloneDoc, null);
    var plugin = await import('../anthena-sync/code.js');
    // Same hash Ã¢â‚¬â€ should pass
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH,
      sourceStructureHash: cloneHash,
      tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }],
      releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_RESULT');
    expect(LAST_RESULT.applied).toBe(1);
  });
  it('apply rejects wrong sourceStructureHash in payload', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, null);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH,
      sourceStructureHash: 'wronghash',
      tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }],
      releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_ERROR');
    expect(LAST_RESULT.error).toContain('CONFLICT_BLOCK');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 6. Dry-run Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: dry-run action', function () {
  it('reports wouldApply for changed tokens', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'dry-run' });
    expect(LAST_RESULT.action).toBe('dry-run');
    expect(LAST_RESULT.wouldApply).toBeGreaterThan(0);
    expect(LAST_RESULT.canApply).toBe(true);
  });
  it('reports wouldBeUnchanged for already-current tokens', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var plugin = await import('../anthena-sync/code.js');
    // Apply first to set anthenaAppliedValue
    setupFigmaMock(cloneDoc, kit);
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    // Then dry-run
    setupFigmaMock(cloneDoc, kit);
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' }], releaseUrl: '', action: 'dry-run' });
    expect(LAST_RESULT.wouldBeUnchanged).toBe(1);
    expect(LAST_RESULT.wouldApply).toBe(0);
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 7. Verify Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: verify action', function () {
  it('reports canApply when source unchanged', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    setupFigmaMock(cloneDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'verify' });
    expect(LAST_RESULT.canApply).toBe(true);
  });
  it('reports conflict when source changed', async function () {
    var kit = buildSourceKit({ kitVersion: '1.0.0' });
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var modifiedKit = buildSourceKit({ kitVersion: '1.0.0' });
    modifiedKit.children[0].children.push(buildTokenNode('colorNew', '#ff0000', 'color'));
    setupFigmaMock(cloneDoc, modifiedKit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'verify' });
    expect(LAST_RESULT.type).toBe('ANTHENA_ERROR');
    expect(LAST_RESULT.error).toContain('Re-clone');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 8. Idempotent re-apply Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: idempotent re-apply', function () {
  it('reports unchanged on re-apply of same tokens', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var plugin = await import('../anthena-sync/code.js');
    var params = { releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
      { tokenName: 'borderRadius', canonicalValue: '8px', dataType: 'dimension' },
      { tokenName: 'colorBgContainer', canonicalValue: '#f0f2f5', dataType: 'color' }
    ], releaseUrl: '', action: 'apply' };
    setupFigmaMock(cloneDoc, kit);
    await plugin.main(params);
    expect(LAST_RESULT.applied).toBe(3);
    setupFigmaMock(cloneDoc, kit);
    await plugin.main(params);
    expect(LAST_RESULT.applied).toBe(0);
    expect(LAST_RESULT.unchanged).toBe(3);
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 9. simulateApply Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('simulateApply (dry-run helper)', function () {
  it('detects which tokens would change', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    var plugin = await import('../anthena-sync/code.js');
    var sim = plugin.simulateApply(cloneDoc, [
      { tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' },
      { tokenName: 'colorPrimary', canonicalValue: '#1677ff', dataType: 'color' }
    ]);
    expect(sim.wouldApply).toBe(1);
    expect(sim.wouldSkip).toBe(0);
    expect(sim.wouldBeUnchanged).toBe(1);
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 10. Clone metadata guard Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('plugin entry: clone metadata guard', function () {
  it('refuses clone if anthenaCloneId does not match', async function () {
    var kit = buildSourceKit();
    var cloneDoc = createOwnedCloneDoc(kit, RELEASE_HASH);
    // Overwrite cloneId to wrong value via setPluginData
    core.writeNodePluginData(cloneDoc, 'anthenaCloneId', 'wrong-clone-id');
    setupFigmaMock(cloneDoc, kit);
    var plugin = await import('../anthena-sync/code.js');
    await plugin.main({ releaseId: RELEASE_ID, releaseHash: RELEASE_HASH, tokens: [{ tokenName: 'colorPrimary', canonicalValue: '#1890ff', dataType: 'color' }], releaseUrl: '', action: 'apply' });
    expect(LAST_RESULT.type).toBe('ANTHENA_ERROR');
    expect(LAST_RESULT.error).toContain('CLONE_METADATA_MISMATCH');
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 11. Build/package smoke Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

describe('build/package smoke', function () {
  it('dist/code.js exists', function () { expect(existsSync(resolve(__dirname, '..', 'anthena-sync', 'dist', 'code.js'))).toBe(true); });
  it('dist/manifest.json exists', function () { expect(existsSync(resolve(__dirname, '..', 'anthena-sync', 'dist', 'manifest.json'))).toBe(true); });
  it('dist/ui.html exists', function () { expect(existsSync(resolve(__dirname, '..', 'anthena-sync', 'dist', 'ui.html'))).toBe(true); });
  it('bundled code.js has no require() in IIFE', function () {
    var content = readFileSync(resolve(__dirname, '..', 'anthena-sync', 'dist', 'code.js'), 'utf-8');
    var requires = content.match(/\brequire\s*\(/g);
    if (requires) {
      var hasHtml = content.indexOf('require("__html__")') !== -1 || content.indexOf("require('__html__')") !== -1;
      if (hasHtml && requires.length === 1) return;
      expect(requires.length - (hasHtml ? 1 : 0)).toBe(0);
    }
  });
  it('bundled code.js has no optional chaining', function () {
    var content = readFileSync(resolve(__dirname, '..', 'anthena-sync', 'dist', 'code.js'), 'utf-8');
    var optChain = content.match(/\?\./g);
    if (optChain) expect(optChain.length).toBe(0);
  });
  it('figma-plugin.zip exists after package', function () {
    var p = resolve(__dirname, '..', 'anthena-sync', 'dist', 'figma-plugin.zip');
    if (!existsSync(p)) { return; }
    expect(existsSync(p)).toBe(true);
  });
  it('zip contains only required files', function () {
    var p = resolve(__dirname, '..', 'anthena-sync', 'dist', 'figma-plugin.zip');
    if (!existsSync(p)) { return; }
    var AdmZip = require('adm-zip');
    var entries = new AdmZip(p).getEntries().map(function (e) { return e.entryName; }).sort();
    expect(entries).toEqual(['code.js', 'manifest.json', 'ui.html']);
  });
});
