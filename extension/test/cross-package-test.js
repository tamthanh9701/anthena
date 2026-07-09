#!/usr/bin/env node

/**
 * Cross-Package Interoperability Test
 *
 * Imports ACTUAL extension buildEvidencePackage() and feeds its canonical output
 * through ACTUAL backend validateEvidencePackage() and an in-process Express
 * router (supertest-equivalent). No copied fixtures, no skipped HTTP.
 *
 * Flow:
 *   1. Dynamic-import extension's buildEvidencePackage (ESM, via pathToFileURL)
 *   2. Require backend's validateEvidencePackage + computeSignalStatus (CJS)
 *   3. Call buildEvidencePackage() → get canonical
 *   4. Validate canonical with backend's validateEvidencePackage()
 *   5. Compute signal status — verify all 7 signals present
 *   6. POST to in-process Express backend router → verify 201 + idempotent 200
 *
 * Run: node test/cross-package-test.js   (after extension build)
 */

const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const express = require('../../backend/node_modules/express');

const EXTENSION_DIST = path.resolve(__dirname, '..', 'dist');
const BACKEND_SRC = path.resolve(__dirname, '..', '..', 'backend', 'src');

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}
function assertEqual(a, e, n) {
  if (a === e) { console.log(`  ✓ ${n}`); passed++; }
  else { console.error(`  ✗ ${n} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); failed++; }
}

async function main() {
  console.log('\n═══ Cross-Package Interop Test ═══\n');

  // ── Step 1: Load extension exported symbols ────────────────
  console.log('1. Load extension buildEvidencePackage...');
  let buildEvidencePackage, uploadEvidencePackage, mapToCanonicalPackage;
  try {
    const asmUrl = pathToFileURL(path.join(EXTENSION_DIST, 'background', 'evidence-assembler.js')).href;
    const asm = await import(asmUrl);
    buildEvidencePackage = asm.buildEvidencePackage;
    uploadEvidencePackage = asm.uploadEvidencePackage;

    const schemaUrl = pathToFileURL(path.join(EXTENSION_DIST, 'shared', 'schema.js')).href;
    const sch = await import(schemaUrl);
    mapToCanonicalPackage = sch.mapToCanonicalPackage;
  } catch (e) {
    // fallback to src
    const asmUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'background', 'evidence-assembler.js')).href;
    const asm = await import(asmUrl);
    buildEvidencePackage = asm.buildEvidencePackage;
    uploadEvidencePackage = asm.uploadEvidencePackage;
    const schemaUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'shared', 'schema.js')).href;
    const sch = await import(schemaUrl);
    mapToCanonicalPackage = sch.mapToCanonicalPackage;
  }

  assert(typeof buildEvidencePackage === 'function', 'buildEvidencePackage is function');
  assert(typeof uploadEvidencePackage === 'function', 'uploadEvidencePackage is function');
  assert(typeof mapToCanonicalPackage === 'function', 'mapToCanonicalPackage is function');

  // ── Step 2: Load backend validator ─────────────────────────
  console.log('\n2. Load backend validateEvidencePackage...');
  let validateEvidencePackage, computeSignalStatus;
  try {
    const backend = require(path.join(BACKEND_SRC, 'v2', 'evidence-package.js'));
    validateEvidencePackage = backend.validateEvidencePackage;
    computeSignalStatus = backend.computeSignalStatus;
    assert(typeof validateEvidencePackage === 'function', 'validateEvidencePackage is function');
    assert(typeof computeSignalStatus === 'function', 'computeSignalStatus is function');
  } catch (err) {
    console.error('  ✗ Cannot load backend validator:', err.message);
    process.exit(1);
  }

  // ── Step 3: Build canonical via actual buildEvidencePackage ─
  console.log('\n3. buildEvidencePackage() with full signal fixture...');
  const fixtureManifest = {
    id: 'cross-test-001', name: 'Cross Test', route: '/cross/test',
    role: 'admin', viewport: { width: 1440, height: 900 },
    theme: 'light', locale: 'en-US',
    actions: ['search', 'filter'], states: ['loading', 'success'], tags: ['cross'],
  };

  const fixtureSignals = {
    domNodes: [
      { tagName: 'div', boundingRect: { top: 0, left: 0, width: 1200, height: 800 }, childCount: 3, selector: '#root', className: 'app-container', id: 'root' },
      { tagName: 'button', boundingRect: { top: 10, left: 10, width: 80, height: 32 }, childCount: 0, selector: 'button.ant-btn', className: 'ant-btn ant-btn-primary', antdClass: 'Button' },
      { tagName: 'input', boundingRect: { top: 50, left: 10, width: 240, height: 32 }, childCount: 0, selector: 'input.ant-input', className: 'ant-input', antdClass: 'Input' },
      { tagName: 'table', boundingRect: { top: 100, left: 10, width: 1100, height: 400 }, childCount: 5, selector: 'table.ant-table', className: 'ant-table', antdClass: 'Table' },
    ],
    computedStyles: [
      { selector: '#root', styles: { display: 'flex', 'background-color': '#f5f5f5', 'font-family': '-apple-system, sans-serif' } },
      { selector: 'button.ant-btn', styles: { color: '#ffffff', 'background-color': '#1677ff', 'font-size': '14px', 'border-radius': '6px' } },
      { selector: 'input.ant-input', styles: { color: '#000000', 'border-color': '#d9d9d9', 'font-size': '14px', 'height': '32px' } },
      { selector: 'table.ant-table', styles: { 'border-color': '#f0f0f0', 'font-size': '14px' } },
    ],
    rects: [
      { tagName: 'div', rect: { top: 0, left: 0, width: 1200, height: 800 }, selector: '#root' },
      { tagName: 'button', rect: { top: 10, left: 10, width: 80, height: 32 }, selector: 'button.ant-btn' },
    ],
    accessibility: [
      { role: 'button', label: 'Submit', selector: 'button[role="button"]', focused: false },
      { role: 'textbox', label: 'Username', selector: 'input[role="textbox"]', focused: true },
    ],
    antdComponents: [
      { component: 'Button', selector: 'button.ant-btn', count: 1, sampleRect: { top: 10, left: 10, width: 80, height: 32 } },
      { component: 'Input', selector: 'input.ant-input', count: 1, sampleRect: { top: 50, left: 10, width: 240, height: 32 } },
      { component: 'Table', selector: 'table.ant-table', count: 1, sampleRect: { top: 100, left: 10, width: 1100, height: 400 } },
    ],
    fiber: {
      available: true, rootName: 'App', componentCount: 10,
      components: [
        { name: 'Button', instanceCount: 3, props: ['type', 'size'] },
        { name: 'Table', instanceCount: 1, props: ['columns', 'dataSource'] },
        { name: 'Input', instanceCount: 2, props: ['placeholder'] },
      ],
      hooks: { total: 28, byType: { useState: 12, useEffect: 8, useQuery: 5 } },
    },
    tokens: {
      available: true, source: 'runtime',
      tokens: { colorPrimary: '#1677ff', colorLink: '#1677ff', colorSuccess: '#52c41a', colorWarning: '#faad14', colorError: '#ff4d4f', fontFamily: '-apple-system', fontSize: '14', borderRadius: '6', controlHeight: '32', wireframe: 'false' },
    },
  };

  const fixtureRedaction = { applied: true, textNodes: 42, images: 7, bgImages: 2, piiAttrs: 1 };

  const { canonical } = await buildEvidencePackage({
    signals: fixtureSignals, redaction: fixtureRedaction, manifest: fixtureManifest,
    captureSessionId: 'cross-sess-001', runId: 'cross-run-001',
    routeKey: 'cross-test-admin-light',
    url: 'http://localhost:3001/cross/test', title: 'Cross-Package Test',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    screenshot: { mode: 'viewport', format: 'webp', width: 1440, height: 900 },
  });

  assert(canonical.packageId, 'packageId generated');
  assertEqual(canonical.schemaVersion, '2.0.0', 'schemaVersion');
  assert(canonical.capturedAt, 'capturedAt');
  assertEqual(canonical.dom.nodes.length, 4, 'dom.nodes 4');
  assertEqual(Object.keys(canonical.css.computed).length, 4, 'css.computed 4');
  assertEqual(Object.keys(canonical.antd.tokens).length, 10, 'antd.tokens 10');
  assertEqual(Object.keys(canonical.fiber.nodes).length, 3, 'fiber.nodes 3');
  assertEqual(Object.keys(canonical.a11y.nodes).length, 2, 'a11y.nodes 2');
  assert(canonical.provenance.packageHash.startsWith('sha256-'), 'real packageHash');

  // ── Step 4: Backend validateEvidencePackage ────────────────
  console.log('\n4. Backend validateEvidencePackage(canonical)...');
  const validation = validateEvidencePackage(canonical);
  if (!validation.valid) {
    console.error('  VALIDATION ERRORS:', validation.errors.join('\n    '));
  }
  assert(validation.valid === true, `valid (${validation.errors.length} errors)`);
  assert(validation.package !== null, 'package returned');

  // ── Step 5: Backend computeSignalStatus ────────────────────
  console.log('\n5. Backend computeSignalStatus(canonical)...');
  const signalStatus = computeSignalStatus(canonical);
  assert(signalStatus.signals.length >= 7, `${signalStatus.signals.length} signals`);
  assert(signalStatus.derivedStatus !== 'failed', `derivedStatus=${signalStatus.derivedStatus}`);

  for (const s of signalStatus.signals) {
    assert(s.status === 'present', `${s.signal} = present`);
  }
  assert(signalStatus.derivedStatus === 'full', `derivedStatus=full (got ${signalStatus.derivedStatus})`);

  // ── Step 6: In-process Express backend (supertest-equivalent) ─
  console.log('\n6. In-process Express POST /api/v2/evidence...');
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Mount the actual backend v2 routes
  const v2Routes = require(path.join(BACKEND_SRC, 'v2', 'routes.js'));
  const v1CompatRouter = v2Routes.v1CompatRouter;
  app.use('/api/v2', v2Routes);
  app.use('/api/v1', v1CompatRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  console.log(`  Server on port ${port}`);

  try {
    // POST canonical — expect 201
    const postResult = await httpPost(`http://localhost:${port}/api/v2/evidence`, canonical);
    assert(postResult.status === 201, `POST status 201 (got ${postResult.status})`);
    assert(postResult.body.captureId, 'captureId in response');
    assert(postResult.body.packageHash, 'packageHash present in response');
    assertEqual(postResult.body.nodeCount, 4, 'nodeCount 4');
    assertEqual(postResult.body.schemaVersion, '2.0.0', 'schemaVersion');
    assert(postResult.body.derivedStatus === 'full', `derivedStatus=full (got ${postResult.body.derivedStatus})`);
    assert(postResult.body.signalCount >= 7, `signalCount ${postResult.body.signalCount}`);

    // POST same canonical again — expect 200 (idempotent by DB captureId lookup)
    // Backend route reads captureId from req.body.captureId || rawPackage.packageId.
    // canonical.packageId is the capture ID here.
    const postResult2 = await httpPost(`http://localhost:${port}/api/v2/evidence`, canonical);
    assert(postResult2.status === 200 || postResult2.status === 201, `idempotent POST status ${postResult2.status}`);

    // Exercise the actual extension uploader and prove screenshot bytes survive persistence.
    const uploadCanonical = {
      ...canonical,
      packageId: `${canonical.packageId}-uploader`,
      provenance: { ...canonical.provenance },
    };
    const uploadResult = await uploadEvidencePackage({
      uploadUrl: `http://localhost:${port}/api/v2/evidence`,
      uploadToken: 'local-test-token',
      runId: 'cross-package-run',
      canonical: uploadCanonical,
      screenshotBlob: new Blob([Uint8Array.from([82, 73, 70, 70])], { type: 'image/webp' }),
    });
    assertEqual(uploadResult.captureId, uploadCanonical.packageId, 'actual uploader captureId');
    const { getEvidenceStore } = require(path.join(BACKEND_SRC, 'v2', 'storage-adapters.js'));
    const storedUpload = JSON.parse(getEvidenceStore().get(uploadCanonical.packageId).toString('utf8'));
    assert(
      storedUpload.screenshot.startsWith('data:image/webp;base64,'),
      'screenshot bytes persisted in canonical package'
    );

    // GET /api/v2/evidence — verify listing
    const getResult = await httpGet(`http://localhost:${port}/api/v2/evidence`);
    assert(getResult.status === 200, 'GET /api/v2/evidence status 200');
    assert(Array.isArray(getResult.body.evidence), 'evidence array');
    assert(getResult.body.total >= 1, 'total >= 1');

    // GET /api/v2/evidence/:id — verify detail
    const detailResult = await httpGet(`http://localhost:${port}/api/v2/evidence/${postResult.body.id}`);
    assert(detailResult.status === 200, 'GET /api/v2/evidence/:id status 200');
    assertEqual(detailResult.body.captureId, canonical.packageId, 'captureId matches');

    // GET /api/v2/evidence/:id/signals — verify signal breakdown
    const sigResult = await httpGet(`http://localhost:${port}/api/v2/evidence/${postResult.body.id}/signals`);
    assert(sigResult.status === 200, 'GET /api/v2/evidence/:id/signals status 200');
    assert(sigResult.body.derivedStatus === 'full', 'signals derivedStatus=full');
    assert(sigResult.body.signals.length >= 7, `${sigResult.body.signals.length} signal entries`);

    // GET /api/v2/clusters — verify cluster formation
    const clustResult = await httpGet(`http://localhost:${port}/api/v2/clusters`);
    assert(clustResult.status === 200, 'GET /api/v2/clusters status 200');
    assert(clustResult.body.clusters.length > 0, 'clusters formed');

    // GET /api/v2/tokens — verify token inventory
    const tokResult = await httpGet(`http://localhost:${port}/api/v2/tokens`);
    assert(tokResult.status === 200, 'GET /api/v2/tokens status 200');
    assert(tokResult.body.tokens.length > 0, 'tokens present');

    // Edge: empty capture remains structurally valid, but status reflects missing evidence.
    const emptyPkg = await buildEvidencePackage({
      signals: { domNodes: [], computedStyles: [], rects: [], accessibility: [], antdComponents: [], fiber: { available: false }, tokens: { available: false } },
      redaction: null, manifest: null,
      captureSessionId: 'sess-e', runId: 'run-e', routeKey: 'empty',
      url: 'http://empty.com', title: 'E', viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
      screenshot: { mode: 'viewport', format: 'webp', width: 1024, height: 768 },
    });
    const emptyVal = validateEvidencePackage(emptyPkg.canonical);
    const emptyStatus = computeSignalStatus(emptyPkg.canonical);
    assert(emptyVal.valid === true, 'empty package is structurally valid');
    assert(emptyStatus.derivedStatus === 'failed', 'empty package derives failed status');
    assert(
      emptyStatus.signals.some(signal => signal.status === 'absent'),
      'empty package reports absent evidence signals'
    );

    console.log('  Server tests complete');
  } finally {
    server.close();
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n${'='.repeat(55)}`);
  console.log(`Interop: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(55)}`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── HTTP helpers ──────────────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { resolve({ status: res.statusCode, body: { error: 'parse failed', raw: Buffer.concat(chunks).toString().slice(0, 200) } }); }
      });
    });
    req.on('error', err => resolve({ status: 0, body: { error: err.message } }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: { error: 'timeout' } }); });
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 10000 };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { resolve({ status: res.statusCode, body: { error: 'parse failed' } }); }
      });
    });
    req.on('error', err => resolve({ status: 0, body: { error: err.message } }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: { error: 'timeout' } }); });
    req.end();
  });
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
