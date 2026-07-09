#!/usr/bin/env node

/**
 * Evidence Package Builder — Deterministic Unit Test
 *
 * Imports ACTUAL extension exports (buildEvidencePackage, mapToCanonicalPackage,
 * deriveSignalFlags) from built dist using pathToFileURL for Windows compat.
 * Tests: buildEvidencePackage -> canonical -> all signals -> edge cases.
 *
 * Run: node test/verify-evidence-package.js   (after extension build)
 */

const path = require('path');
const { pathToFileURL } = require('url');

const EXTENSION_DIST = path.resolve(__dirname, '..', 'dist');

let passed = 0, failed = 0;

function assert(condition, name) { if (condition) { console.log(`  ✓ ${name}`); passed++; } else { console.error(`  ✗ ${name}`); failed++; } }
function assertEqual(a, e, n) { a === e ? (console.log(`  ✓ ${n}`), passed++) : (console.error(`  ✗ ${n} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`), failed++); }

async function main() {
  console.log('\n═══ Evidence Package Unit Test ═══\n');

  // ── Import actual extension modules ────────────────────────
  console.log('Loading extension modules...');
  let extSchema, extAssembler;
  try {
    const schemaUrl = pathToFileURL(path.join(EXTENSION_DIST, 'shared', 'schema.js')).href;
    const asmUrl = pathToFileURL(path.join(EXTENSION_DIST, 'background', 'evidence-assembler.js')).href;
    extSchema = await import(schemaUrl);
    extAssembler = await import(asmUrl);
  } catch (e) {
    // fallback to src
    const schemaUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'shared', 'schema.js')).href;
    const asmUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'background', 'evidence-assembler.js')).href;
    extSchema = await import(schemaUrl);
    extAssembler = await import(asmUrl);
  }

  const { mapToCanonicalPackage, deriveSignalFlags } = extSchema;
  const { buildEvidencePackage } = extAssembler;

  assert(typeof mapToCanonicalPackage === 'function', 'mapToCanonicalPackage exported');
  assert(typeof deriveSignalFlags === 'function', 'deriveSignalFlags exported');
  assert(typeof buildEvidencePackage === 'function', 'buildEvidencePackage exported');

  const manifest = {
    id: 'unit-test-001', name: 'Test', route: '/test',
    role: 'admin', viewport: { width: 1440, height: 900 },
    theme: 'light', locale: 'en-US',
    actions: ['search'], states: ['loading'], tags: ['test'],
  };

  const signals = {
    domNodes: [
      { tagName: 'div', boundingRect: { top: 0, left: 0, width: 100, height: 100 }, childCount: 2, selector: '#root' },
      { tagName: 'button', boundingRect: { top: 10, left: 10, width: 80, height: 30 }, childCount: 0, selector: 'button.ant-btn', className: 'ant-btn ant-btn-primary', antdClass: 'Button' },
    ],
    computedStyles: [
      { selector: '#root', styles: { display: 'flex', 'background-color': '#ffffff' } },
      { selector: 'button.ant-btn', styles: { color: '#ffffff', 'background-color': '#1677ff', 'font-size': '14px' } },
    ],
    rects: [{ tagName: 'div', rect: { top: 0, left: 0, width: 100, height: 100 }, selector: '#root' }],
    accessibility: [{ role: 'button', label: 'Submit', selector: 'button[role="button"]', focused: false }],
    antdComponents: [{ component: 'Button', selector: 'button.ant-btn', count: 1, sampleRect: { top: 10, left: 10, width: 80, height: 30 } }],
    fiber: { available: true, rootName: 'App', componentCount: 2, components: [{ name: 'Button', instanceCount: 3, props: ['type'] }], hooks: { total: 10, byType: { useState: 5 } } },
    tokens: { available: true, source: 'runtime', tokens: { colorPrimary: '#1677ff', fontSize: '14', borderRadius: '6' } },
  };

  const redactionInfo = { applied: true, textNodes: 12, images: 3, bgImages: 1, piiAttrs: 0 };

  // ── Test 1: deriveSignalFlags ───────────────────────────────
  console.log('\n1. deriveSignalFlags');
  const flags = deriveSignalFlags(signals, redactionInfo);
  assert(flags.dom === true, 'dom flag true');
  assert(flags.computedCss === true, 'computedCss flag true');
  assert(flags.rects === true, 'rects flag true');
  assert(flags.accessibility === true, 'accessibility flag true');
  assert(flags.antdClasses === true, 'antdClasses flag true');
  assertEqual(flags.fiber, 'best-effort', 'fiber best-effort');
  assertEqual(flags.antdTokens, 'runtime', 'antdTokens runtime');
  assert(flags.redaction === true, 'redaction flag true');

  // ── Test 2: buildEvidencePackage — calls canonical mapper ───
  console.log('\n2. buildEvidencePackage → canonical');
  const pkgResult = await buildEvidencePackage({
    signals, redaction: redactionInfo, manifest,
    captureSessionId: 'sess-test', runId: 'run-test',
    routeKey: 'test-admin-light',
    url: 'http://test.com', title: 'Test',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    screenshot: { mode: 'viewport', format: 'webp', width: 1440, height: 900 },
  });

  const canon = pkgResult.canonical;
  assert(canon.packageId, 'packageId present');
  assertEqual(canon.schemaVersion, '2.0.0', 'schemaVersion 2.0.0');
  assert(canon.capturedAt, 'capturedAt present');
  assertEqual(canon.url, 'http://test.com', 'url preserved');
  assertEqual(canon.screenshot, 'full.webp', 'screenshot filename');
  assert(canon.provenance.packageHash.startsWith('sha256-'), 'real hash computed (starts with sha256-)');
  assert(canon.provenance.packageHash.length > 70, 'hash is 64 hex chars + prefix');

  // ── Test 3: Canonical DOM ──────────────────────────────────
  console.log('\n3. Canonical dom signal');
  assert(Array.isArray(canon.dom.nodes), 'dom.nodes is array');
  assertEqual(canon.dom.nodes.length, 2, 'dom.nodes.length 2');
  assert(canon.dom.captureEvidence, 'dom.captureEvidence path');
  assert(canon.dom.extractorVersion, 'dom.extractorVersion');

  const node0 = canon.dom.nodes[0];
  assert(node0.nodeId, 'nodeId present');
  assertEqual(node0.tag, 'div', 'first node tag div');
  assert(node0.rect.x === 0 && node0.rect.y === 0 && node0.rect.w === 100 && node0.rect.h === 100, 'rect preserved');

  const node1 = canon.dom.nodes[1];
  assertEqual(node1.tag, 'button', 'second node tag button');
  assert(node1.classList.includes('ant-btn'), 'classList has ant-btn');

  // ── Test 4: Canonical CSS ──────────────────────────────────
  console.log('\n4. Canonical css signal');
  assert(typeof canon.css.computed === 'object', 'css.computed is object');
  for (const nid of canon.dom.nodes.map(n => n.nodeId)) {
    assert(canon.css.computed[nid] !== undefined, `css.computed has entry for ${nid}`);
  }

  // ── Test 5: Canonical AntD ──────────────────────────────────
  console.log('\n5. Canonical antd signal');
  assert(Object.keys(canon.antd.classMatches).length > 0, 'antd.classMatches non-empty');
  assertEqual(Object.keys(canon.antd.tokens).length, 3, 'antd.tokens has 3');
  assertEqual(canon.antd.tokens.colorPrimary.value, '#1677ff', 'colorPrimary value');

  // ── Test 6: Canonical Fiber ─────────────────────────────────
  console.log('\n6. Canonical fiber signal');
  assert(Object.keys(canon.fiber.nodes).length > 0, 'fiber.nodes non-empty');
  const firstFiber = Object.values(canon.fiber.nodes)[0];
  assert(firstFiber.componentName, 'fiber node has componentName');

  // ── Test 7: Canonical A11y ─────────────────────────────────
  console.log('\n7. Canonical a11y signal');
  assert(Object.keys(canon.a11y.nodes).length > 0, 'a11y.nodes non-empty');
  const firstA11y = Object.values(canon.a11y.nodes)[0];
  assert(firstA11y.role, 'a11y node has role');

  // ── Test 8: Provenance ─────────────────────────────────────
  console.log('\n8. Provenance');
  assertEqual(canon.provenance.extensionVersion, '2.0.0', 'extensionVersion');
  assertEqual(canon.provenance.captureSessionId, 'sess-test', 'captureSessionId');
  assertEqual(canon.provenance.runId, 'run-test', 'runId');

  // ── Test 9: Redaction ──────────────────────────────────────
  console.log('\n9. Redaction');
  assert(canon.redaction.applied === true, 'redaction applied=true');
  assertEqual(canon.redaction.textNodes, 12, 'textNodes 12');

  // ── Test 10: Edge cases ────────────────────────────────────
  console.log('\n10. Edge cases');
  const emptySignals = {
    domNodes: [], computedStyles: [], rects: [], accessibility: [],
    antdComponents: [], fiber: { available: false }, tokens: { available: false },
  };
  const emptyPkg = await buildEvidencePackage({
    signals: emptySignals, redaction: null, manifest: null,
    captureSessionId: 'sess-e', runId: 'run-e', routeKey: 'empty',
    url: 'http://empty.com', title: 'E', viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
    screenshot: { mode: 'viewport', format: 'webp', width: 1024, height: 768 },
  });
  const ec = emptyPkg.canonical;
  assertEqual(ec.dom.nodes.length, 0, 'empty dom');
  assertEqual(Object.keys(ec.css.computed).length, 0, 'empty css');
  assertEqual(Object.keys(ec.antd.tokens).length, 0, 'empty tokens');
  assert(ec.redaction === null, 'redaction null');

  // Inferred tokens
  const inferSig = { ...signals, tokens: { available: true, source: 'inferred', tokens: { colorPrimary: '#1677ff' } } };
  const inferPkg = await buildEvidencePackage({
    signals: inferSig, redaction: { applied: true, textNodes: 0, images: 0, bgImages: 0, piiAttrs: 0 },
    manifest: null,
    captureSessionId: 'sess-i', runId: 'run-i', routeKey: 'infer',
    url: 'http://i.com', title: 'I', viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    screenshot: { mode: 'viewport', format: 'webp', width: 1280, height: 800 },
  });
  assertEqual(inferPkg.canonical.antd.tokens.colorPrimary.source, 'inferred', 'inferred source');

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Unit: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });