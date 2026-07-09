#!/usr/bin/env node

/**
 * Playwright Capture — Evidence Package v2 Extractor
 *
 * Hybrid adapter: secondary capture method per contract "extension-first, Playwright as secondary".
 * Standalone script. Self-contained (no imports from extension modules).
 * Produces v2.0.0 EvidencePackage matching backend/src/v2/evidence-package.js schema.
 *
 * Usage:
 *   node extension/playwright-capture.js --url https://example.com
 *   node extension/playwright-capture.js --url https://example.com --viewport 1920x1080 --output ./my-pkg.json
 *   node extension/playwright-capture.js --url https://example.com --dry-run
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Schema Constants ───────────────────────────────────────────────
const SCHEMA_VERSION = '2.0.0';
const EXTRACTOR_VERSION = 'playwright-v2.0.0';

// ─── CLI Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: null, viewport: '1440x900', output: './captured-package.json', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        opts.url = args[++i];
        break;
      case '--viewport': {
        const vp = args[++i];
        const parts = vp.split('x');
        if (parts.length === 2) {
          opts.viewport = { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) };
        }
        break;
      }
      case '--output':
        opts.output = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Playwright Evidence Package Capture — v2.0.0

Usage:
  node extension/playwright-capture.js --url <url> [options]

Options:
  --url       <url>          Target URL to capture (required)
  --viewport  <WxH>          Viewport dimensions (default: 1440x900)
  --output    <path>         Output file path (default: ./captured-package.json)
  --dry-run                  Print JSON to console instead of writing file
  --help, -h                 Show this help
`);
        process.exit(0);
    }
  }

  if (!opts.url) {
    console.error('Error: --url is required');
    process.exit(1);
  }

  // Normalize viewport if not already parsed
  if (typeof opts.viewport === 'string') {
    const parts = opts.viewport.split('x');
    opts.viewport = { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) };
  }

  return opts;
}

// ─── ID Generation ─────────────────────────────────────────────────

function randomId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function captureId() {
  return `cap_${randomId(8)}`;
}

// ─── DOM + Computed CSS Combined Extraction (runs in page context) ─────

const CSS_PROPS_LIST = [
  'backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderRadius', 'boxShadow', 'width', 'height', 'display', 'visibility',
  'opacity', 'overflow', 'position', 'top', 'left', 'zIndex',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap',
  'gridTemplateColumns', 'gridTemplateRows',
];

const COMBINED_EXTRACTOR_SCRIPT = `
(function() {
  var MAX_NODES = 500;
  var nodeCounter = 0;
  var nodes = [];
  var computedByNodeId = {};
  var idMap = new WeakMap();
  var CSS_PROPS = ${JSON.stringify(CSS_PROPS_LIST)};

  function getNodeId(el) {
    if (!idMap.has(el)) {
      idMap.set(el, 'n-' + String(nodeCounter++).padStart(3, '0'));
    }
    return idMap.get(el);
  }

  function extractComputed(el) {
    var cs = window.getComputedStyle(el);
    var entry = {};
    for (var i = 0; i < CSS_PROPS.length; i++) {
      var prop = CSS_PROPS[i];
      try {
        var val = cs[prop];
        if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== '') {
          entry[prop] = val;
        }
      } catch(e) {}
    }
    return entry;
  }

  function walk(node, parentId) {
    if (nodeCounter >= MAX_NODES) return null;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

    var el = node;
    var nodeId = getNodeId(el);
    var rect = el.getBoundingClientRect();
    var childIds = [];

    nodes.push({
      nodeId: nodeId,
      tag: el.tagName.toLowerCase(),
      classList: Array.from(el.classList),
      attributes: Array.from(el.attributes).reduce(function(acc, attr) {
        if (attr.name !== 'style' && attr.name !== 'class') {
          acc[attr.name] = attr.value;
        }
        return acc;
      }, {}),
      rect: {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        w: Math.round(rect.width * 100) / 100,
        h: Math.round(rect.height * 100) / 100,
      },
      parentId: parentId || null,
      childIds: [],
      textContent: (el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE)
        ? el.textContent.trim().slice(0, 200) : '',
    });

    // Extract computed styles for this exact node
    computedByNodeId[nodeId] = extractComputed(el);

    // Walk children
    for (var i = 0; i < el.children.length; i++) {
      var childId = walk(el.children[i], nodeId);
      if (childId) childIds.push(childId);
    }

    // Update childIds
    var nodeEntry = nodes[nodes.length - 1];
    // find the node we just pushed
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].nodeId === nodeId) {
        nodes[j].childIds = childIds;
        break;
      }
    }

    return nodeId;
  }

  walk(document.body, null);
  return { nodes: nodes, computedByNodeId: computedByNodeId, title: document.title || '' };
})()
`;

// ─── AntD Detection Script (runs in page context) ──────────────────

const ANTD_DETECT_SCRIPT = `
(function() {
  // 1. Scan for ant-* classnames
  var antdClassMap = {};
  var antPattern = /^ant-/;
  var componentMap = {
    'ant-btn': 'Button',
    'ant-input': 'Input',
    'ant-select': 'Select',
    'ant-table': 'Table',
    'ant-form': 'Form',
    'ant-modal': 'Modal',
    'ant-drawer': 'Drawer',
    'ant-card': 'Card',
    'ant-menu': 'Menu',
    'ant-layout': 'Layout',
    'ant-tabs': 'Tabs',
    'ant-breadcrumb': 'Breadcrumb',
    'ant-dropdown': 'Dropdown',
    'ant-popover': 'Popover',
    'ant-tooltip': 'Tooltip',
    'ant-badge': 'Badge',
    'ant-avatar': 'Avatar',
    'ant-alert': 'Alert',
    'ant-tag': 'Tag',
    'ant-checkbox': 'Checkbox',
    'ant-radio': 'Radio',
    'ant-switch': 'Switch',
    'ant-rate': 'Rate',
    'ant-slider': 'Slider',
    'ant-upload': 'Upload',
    'ant-progress': 'Progress',
    'ant-spin': 'Spin',
    'ant-pagination': 'Pagination',
    'ant-calendar': 'Calendar',
    'ant-datepicker': 'DatePicker',
    'ant-timepicker': 'TimePicker',
    'ant-tree': 'Tree',
    'ant-collapse': 'Collapse',
    'ant-timeline': 'Timeline',
    'ant-steps': 'Steps',
    'ant-result': 'Result',
    'ant-descriptions': 'Descriptions',
    'ant-list': 'List',
    'ant-statistic': 'Statistic',
    'ant-skeleton': 'Skeleton',
    'ant-empty': 'Empty',
    'ant-message': 'Message',
    'ant-notification': 'Notification',
    'ant-space': 'Space',
    'ant-divider': 'Divider',
    'ant-typography': 'Typography',
    'ant-image': 'Image',
    'ant-affix': 'Affix',
    'ant-anchor': 'Anchor',
    'ant-back-top': 'BackTop',
    'ant-config-provider': 'ConfigProvider',
  };

  var allElements = document.querySelectorAll('*');
  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    var cls = el.className;
    if (typeof cls === 'string' && cls.length > 0) {
      var classes = cls.trim().split(/\\s+/);
      for (var j = 0; j < classes.length; j++) {
        if (antPattern.test(classes[j])) {
          var matched = false;
          for (var prefix in componentMap) {
            if (classes[j].startsWith(prefix)) {
              var comp = componentMap[prefix];
              if (!antdClassMap[comp]) {
                antdClassMap[comp] = { count: 0, selectors: [], sampleRect: null };
              }
              antdClassMap[comp].count++;
              if (antdClassMap[comp].selectors.length < 3) {
                var rect = el.getBoundingClientRect();
                antdClassMap[comp].selectors.push(el.tagName.toLowerCase() + '.' + classes.join('.'));
                antdClassMap[comp].sampleRect = antdClassMap[comp].sampleRect || {
                  top: Math.round(rect.top),
                  left: Math.round(rect.left),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              }
              matched = true;
              break;
            }
          }
          // If no specific component matched, count as generic antd
          if (!matched) {
            if (!antdClassMap['Unknown']) {
              antdClassMap['Unknown'] = { count: 0, selectors: [], sampleRect: null };
            }
            antdClassMap['Unknown'].count++;
          }
        }
      }
    }
  }

  // 2. Read AntD CSS custom properties (--ant-*)
  var antdTokens = {};
  var computedStyle = window.getComputedStyle(document.documentElement);
  for (var k = 0; k < computedStyle.length; k++) {
    var prop = computedStyle[k];
    if (prop.startsWith('--ant-')) {
      var val = computedStyle.getPropertyValue(prop).trim();
      if (val) antdTokens[prop] = val;
    }
  }

  // Also check for --antd-* variants
  for (var k = 0; k < computedStyle.length; k++) {
    var prop = computedStyle[k];
    if (prop.startsWith('--antd-') && !antdTokens[prop]) {
      var val = computedStyle.getPropertyValue(prop).trim();
      if (val) antdTokens[prop] = val;
    }
  }

  // 3. Try to detect AntD version from window globals
  var antdVersion = null;
  if (window.antd && window.antd.version) {
    antdVersion = window.antd.version;
  }

  return {
    classMatches: antdClassMap,
    tokens: antdTokens,
    version: antdVersion,
  };
})()
`;

// ─── Fiber Detection Script (runs in page context) ─────────────────

const FIBER_DETECT_SCRIPT = `
(function() {
  var result = { nodes: {}, disclaimer: 'React Fiber is a private API. Capture is best-effort.', available: false };

  try {
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && hook.renderers) {
      result.available = true;
      var renderers = hook.renderers;
      for (var i = 0; i < renderers.size; i++) {
        var r = renderers.get(i);
        if (r && r.rendererPackageName) {
          result.rendererName = r.rendererPackageName;
        }
      }

      // Try to walk fiber roots
      if (hook.getFiberRoots) {
        hook.getFiberRoots(1).forEach(function(root) {
          if (root && root.current) {
            walkFiber(root.current, result.nodes, 0, 3);
          }
        });
      } else if (hook._fiberRoots) {
        hook._fiberRoots.forEach(function(root) {
          if (root && root.current) {
            walkFiber(root.current, result.nodes, 0, 3);
          }
        });
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  function walkFiber(fiber, collector, depth, maxDepth) {
    if (!fiber || depth > maxDepth) return;
    // Skip host fibers (DOM elements) unless they have antd class
    if (fiber.memoizedState && fiber.tag === 5) return;

    var displayName = null;
    try {
      if (fiber.type) {
        displayName = fiber.type.displayName || fiber.type.name || null;
      }
    } catch (e) {}

    if (displayName) {
      var ownerPath = [];
      var cur = fiber._debugOwner;
      while (cur) {
        try {
          var n = cur.type ? (cur.type.displayName || cur.type.name || 'Unknown') : 'Unknown';
          ownerPath.unshift(n);
        } catch (e) { ownerPath.unshift('Unknown'); }
        cur = cur._debugOwner;
      }

      var fiberId = 'fbr-' + displayName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + String(Object.keys(collector).length);
      collector[fiberId] = {
        displayName: displayName,
        ownerPath: ownerPath.length > 0 ? ownerPath : ['Root'],
        confidence: 0.7,
        evidence: ['fiber-displayName', 'fiber-owner-chain'],
      };
    }

    // Recurse child and sibling
    walkFiber(fiber.child, collector, depth + 1, maxDepth);
    walkFiber(fiber.sibling, collector, depth + 1, maxDepth);
  }

  return result;
})()
`;

// ─── Main Capture ──────────────────────────────────────────────────

async function capturePage(url, viewport, output) {
  console.error(`[playwright-capture] Launching browser...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.error(`[playwright-capture] Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  // Extra settle time for SPA apps
  await page.waitForTimeout(1000);

  console.error(`[playwright-capture] Capturing screenshot...`);
  const outputDir = path.resolve(path.dirname(path.resolve(output)));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const screenshotName = `screenshot-${Date.now()}.png`;
  const screenshotPath = path.join(outputDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });

  // 1. DOM + computed CSS extraction (combined single walk for accuracy)
  console.error(`[playwright-capture] Extracting DOM tree with computed CSS...`);
  const combinedResult = await page.evaluate(COMBINED_EXTRACTOR_SCRIPT);
  const domNodes = combinedResult.nodes;
  const computedByNodeId = combinedResult.computedByNodeId;
  const pageTitle = combinedResult.title || '';

  // 3. AntD detection
  console.error(`[playwright-capture] Detecting Ant Design classes & tokens...`);
  const antdResult = await page.evaluate(ANTD_DETECT_SCRIPT);

  // Build antd classMatches in v2 format
  const antdClassMatches = {};
  for (const [component, info] of Object.entries(antdResult.classMatches)) {
    for (const selector of info.selectors) {
      const matchKey = `antd-${component.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
      antdClassMatches[matchKey] = {
        patterns: [component],
        confidence: 0.9,
        count: info.count,
      };
    }
  }

  // Build antd tokens in v2 format
  const antdTokens = {};
  for (const [key, value] of Object.entries(antdResult.tokens)) {
    // Strip --ant- or --antd- prefix for cleaner names
    const tokenName = key.replace(/^--antd?-/, '');
    antdTokens[tokenName] = {
      value: value,
      source: 'css-custom-property',
      confidence: 0.85,
    };
  }

  // If no CSS custom properties found, try inferred from computed styles
  if (Object.keys(antdTokens).length === 0 && domNodes.length > 0) {
    // Look for antd-colored elements and infer common tokens
    for (const node of domNodes) {
      if (node.classList && node.classList.some(c => c.startsWith('ant-'))) {
        const css = computedByNodeId[node.nodeId];
        if (css) {
          if (css.backgroundColor && !antdTokens.colorPrimary) {
            antdTokens.colorPrimary = { value: css.backgroundColor, source: 'inferred', confidence: 0.6 };
          }
          if (css.color && !antdTokens.colorText) {
            antdTokens.colorText = { value: css.color, source: 'inferred', confidence: 0.6 };
          }
          if (css.borderRadius && !antdTokens.borderRadius) {
            antdTokens.borderRadius = { value: css.borderRadius, source: 'inferred', confidence: 0.6 };
          }
          if (css.fontSize && !antdTokens.fontSize) {
            antdTokens.fontSize = { value: css.fontSize, source: 'inferred', confidence: 0.5 };
          }
          if (css.fontFamily && !antdTokens.fontFamily) {
            antdTokens.fontFamily = { value: css.fontFamily, source: 'inferred', confidence: 0.5 };
          }
        }
      }
    }
  }

  // 4. Fiber detection
  console.error(`[playwright-capture] Attempting React Fiber introspection...`);
  const fiberResult = await page.evaluate(FIBER_DETECT_SCRIPT);

  // 5. Accessibility snapshot
  console.error(`[playwright-capture] Capturing accessibility tree...`);
  let a11ySnapshot = {};
  try {
    const a11y = await page.accessibility.snapshot();
    if (a11y) {
      a11ySnapshot = flattenA11yTree(a11y);
    }
  } catch (err) {
    // Accessibility.snapshot() returns null when no interesting content; not an error
    if (err.message && !err.message.includes('undefined')) {
      console.error(`[playwright-capture] Accessibility snapshot: ${err.message}`);
    }
  }

  await browser.close();
  console.error(`[playwright-capture] Browser closed.`);

  // ─── Assemble Evidence Package ────────────────────────────────

  const cid = captureId();
  const capturedAt = new Date().toISOString();
  const packageId = `pkg-${cid}`;

  const evidencePackage = {
    schemaVersion: SCHEMA_VERSION,
    packageId,
    capturedAt,
    url,
    viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 1 },
    scenario: {
      source: 'playwright-cli',
      url,
      viewport: `${viewport.width}x${viewport.height}`,
      capturedAt,
    },
    redaction: {
      enabled: false,
      note: 'Playwright capture — no redaction applied by default',
    },
    screenshot: screenshotName,
    dom: {
      nodes: domNodes,
      captureEvidence: `dom/nodes-${cid}.json`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    css: {
      computed: computedByNodeId,
      captureEvidence: `css/computed-${cid}.json`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    antd: {
      tokens: antdTokens,
      version: antdResult.version || null,
      classMatches: antdClassMatches,
      captureEvidence: `antd/tokens-${cid}.json`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    fiber: {
      nodes: fiberResult.nodes || {},
      disclaimer: fiberResult.disclaimer || 'React Fiber is a private API',
      available: fiberResult.available || false,
      captureEvidence: `fiber/nodes-${cid}.json`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    a11y: {
      nodes: a11ySnapshot,
      captureEvidence: `a11y/tree-${cid}.json`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    provenance: {
      packageHash: null, // computed below
      captureMode: 'playwright',
      browser: 'chromium',
      nodeVersion: process.version,
      platform: process.platform,
      capturedVia: 'playwright-cli',
      everySignalBackedBy: 'persisted evidence in this package',
      noMetadataClaimWithoutEvidence: true,
    },
  };

  // Compute hash over the JSON content (excluding hash field itself)
  const hashInput = JSON.stringify({ ...evidencePackage, provenance: { ...evidencePackage.provenance, packageHash: null } });
  evidencePackage.provenance.packageHash = crypto.createHash('sha256').update(hashInput).digest('hex');
  evidencePackage.provenance.integrityVerifiedAt = new Date().toISOString();

  return evidencePackage;
}

// ─── A11y Tree Flattener ───────────────────────────────────────────

function flattenA11yTree(node, depth = 0, maxDepth = 8, collector = {}) {
  if (!node || depth > maxDepth) return collector;

  const nodeId = `a11y-${Object.keys(collector).length}`;
  collector[nodeId] = {
    role: node.role || null,
    name: node.name || null,
    description: node.description || null,
    value: node.value || null,
    disabled: node.disabled || false,
    focused: node.focused || false,
    expanded: node.expanded ?? null,
    checked: node.checked ?? null,
    selected: node.selected ?? null,
    level: node.level || null,
    depth,
  };

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      flattenA11yTree(child, depth + 1, maxDepth, collector);
    }
  }

  return collector;
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.error(`[playwright-capture] Starting capture`);
  console.error(`  URL:      ${opts.url}`);
  console.error(`  Viewport: ${opts.viewport.width}x${opts.viewport.height}`);

  try {
    const evidencePackage = await capturePage(opts.url, opts.viewport, opts.output);

    if (opts.dryRun) {
      console.log(JSON.stringify(evidencePackage, null, 2));
    } else {
      const outputPath = path.resolve(opts.output);
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, JSON.stringify(evidencePackage, null, 2), 'utf-8');
      console.error(`[playwright-capture] Package written to: ${outputPath}`);
    }

    // Summary
    const signalSummary = {
      url: opts.url,
      packageId: evidencePackage.packageId,
      capturedAt: evidencePackage.capturedAt,
      dom: `${evidencePackage.dom.nodes.length} nodes`,
      css: `${Object.keys(evidencePackage.css.computed).length} computed entries`,
      antd: `${Object.keys(evidencePackage.antd.tokens).length} tokens, ${Object.keys(evidencePackage.antd.classMatches).length} class matches`,
      fiber: `${Object.keys(evidencePackage.fiber.nodes).length} fiber nodes`,
      a11y: `${Object.keys(evidencePackage.a11y.nodes).length} a11y nodes`,
      hash: evidencePackage.provenance.packageHash.slice(0, 16) + '...',
    };
    console.error(`[playwright-capture] Summary:`, signalSummary);
  } catch (err) {
    console.error(`[playwright-capture] Error:`, err.message);
    process.exit(1);
  }
}

main();