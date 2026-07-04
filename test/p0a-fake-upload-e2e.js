/**
 * P0-A Fake Upload E2E Test
 *
 * Flow: health → create session → upload fake page → complete → poll → verify
 * Negative 1: upload with admin token (should fail)
 * Negative 2: complete empty session (should become failed)
 *
 * Usage: node test/p0a-fake-upload-e2e.js
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'anthena-dev-token-2026';

// ─── Helpers ────────────────────────────────────────────────────────────────

function request(method, urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const headers = { ...opts.headers };
    let body = opts.body;

    if (body && typeof body === 'object' && !(body instanceof Buffer)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const req = http.request(url, {
      method,
      headers: { ...headers, 'Content-Length': body ? Buffer.byteLength(body) : 0 },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartRequest(method, urlPath, fields, files, authToken) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + crypto.randomBytes(16).toString('hex');
    const url = new URL(urlPath, BASE);
    const chunks = [];

    for (const [name, value] of Object.entries(fields || {})) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    for (const [name, { filename, content, contentType }] of Object.entries(files || {})) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
      chunks.push(content instanceof Buffer ? content : Buffer.from(content, 'utf8'));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    }, (res) => {
      const respChunks = [];
      res.on('data', c => respChunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(respChunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Fake package generator ─────────────────────────────────────────────────

function generateFakeSnapshot() {
  const tags = ['button', 'div', 'input', 'span', 'table', 'tr', 'td', 'a', 'img', 'label'];
  const classes = [
    ['ant-btn', 'ant-btn-primary'],
    ['ant-btn', 'ant-btn-default'],
    ['ant-input'],
    ['ant-card', 'ant-card-bordered'],
    ['ant-table'],
    ['ant-modal'],
    ['ant-form-item'],
    ['ant-select'],
    ['ant-checkbox'],
    ['ant-radio'],
    [],
    ['nav-link', 'active'],
    ['sidebar-item'],
    ['page-header'],
    ['stats-card'],
    ['data-grid-cell'],
    ['btn', 'btn-sm'],
    ['card', 'shadow-sm'],
    ['table-row'],
    ['filter-bar'],
  ];
  const texts = [
    'Create Order', 'Submit', 'Cancel', 'Search...', 'Customer Name',
    'Order #1234', 'Status: Pending', '$ 1,250.00', 'View Details', 'Export CSV',
    'Filter by date', 'Apply', 'Reset', 'Page 1 of 10', 'Rows per page: 25',
    'Total: 247 records', 'Dashboard', 'Orders', 'Products', 'Settings',
  ];
  const colors = [
    'rgb(22, 119, 255)', 'rgb(255, 77, 79)', 'rgb(82, 196, 26)',
    'rgb(250, 173, 20)', 'rgb(114, 46, 209)', 'rgb(245, 245, 245)',
    'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(102, 102, 102)',
    'rgb(230, 247, 255)',
  ];

  const nodes = [];
  for (let i = 1; i <= 30; i++) {
    const tag = tags[Math.floor(Math.random() * tags.length)];
    const cls = classes[Math.floor(Math.random() * classes.length)];
    const text = texts[Math.floor(Math.random() * texts.length)];
    const bgColor = colors[Math.floor(Math.random() * colors.length)];
    const x = Math.floor(Math.random() * 800);
    const y = Math.floor(Math.random() * 2000);
    nodes.push({
      id: `node-${String(i).padStart(3, '0')}`,
      tagName: tag,
      classList: cls,
      text: i <= 20 ? text : '',
      rect: { x, y, width: Math.floor(80 + Math.random() * 200), height: Math.floor(20 + Math.random() * 40) },
      computedStyles: {
        backgroundColor: bgColor,
        color: i % 3 === 0 ? 'rgb(255,255,255)' : 'rgb(0,0,0)',
        borderRadius: cls.includes('ant-btn') ? '6px' : '0px',
        fontSize: '14px',
      },
    });
  }
  return { nodes };
}

function createFakePackage() {
  const metadata = {
    url: 'https://internal.example.com/orders',
    title: 'Order Management',
    routeKey: '/orders',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1.0 },
    extractedAt: new Date().toISOString(),
    extractorVersion: '1.0.0',
  };

  const snapshot = generateFakeSnapshot();
  const snapshotGz = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));

  // 800x600 blue gradient-ish webp-like buffer (minimal valid-ish binary)
  const screenshotBuffer = createFakeScreenshot();

  return { metadata, snapshotGz, screenshotBuffer };
}

function createFakeScreenshot() {
  // Minimal valid PNG (1x1 pixel transparent) for upload test
  // This is a valid PNG: IHDR + IDAT + IEND
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0x68, 0x60, 0x00, 0x00,
    0x00, 0x02, 0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
    0xAE, 0x42, 0x60, 0x82,
  ]);
  return png;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, ok, detail) {
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: ${detail || 'FAIL'}`);
    failed++;
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  P0-A FAKE UPLOAD E2E TEST');
  console.log('═══════════════════════════════════════════\n');

  let sessionId, runId, captureId, uploadToken;

  // ─── 1. Health check ──────────────────────────────────────────────────────
  console.log('── 1. Health Check ──');
  let res = await request('GET', '/health');
  assert('Health returns 200', res.status === 200, `got ${res.status}`);
  assert('Health body has status', res.body && res.body.status, JSON.stringify(res.body));

  // ─── 2. Ready check ───────────────────────────────────────────────────────
  console.log('\n── 2. Ready Check ──');
  res = await request('GET', '/ready');
  assert('Ready returns 200', res.status === 200, `got ${res.status}`);
  assert('DB connected', res.body && res.body.db === 'connected', JSON.stringify(res.body));

  // ─── 3. Pilot Contract (create if not already signed) ─────────────
  console.log('\n── 3. Pilot Contract ──');
  // Check if already signed
  let statusRes = await request('GET', '/api/pilot-contract/status', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (statusRes.body && statusRes.body.signed) {
    console.log('  → contract already signed, skipping');
  } else {
    res = await request('POST', '/api/pilot-contract', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: {
        operatorName: 'e2e-tester', operatorRole: 'dev',
        environment: 'dev',
        routeList: [
          'https://example.com/orders',
          'https://example.com/products',
          'https://example.com/users',
          'https://example.com/settings',
          'https://example.com/dashboard',
        ],
        reviewBudgetMinutes: 30, maxCandidates: 10,
        reviewMode: 'component-cluster',
        definitionOfInsight: ['Identify components that diverge from defaults'],
        phase0DoD: ['Signal reliability report generated'],
        pilotDoD: ['All routes crawled successfully'],
        topN: 30,
      },
    });
    assert('Create contract 200', res.status === 200, `got ${res.status}`);
    console.log(`  → contractId: ${res.body.id}`);

    res = await request('POST', '/api/pilot-contract/co-sign', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: { operatorName: 'e2e-tester', operatorRole: 'dev' },
    });
    assert('Co-sign contract 200', res.status === 200, `got ${res.status}`);
  }
  console.log('  → pilot contract OK');

  // ─── 4. Create run ────────────────────────────────────────────
  console.log('\n── 4. Create Run ──');
  res = await request('POST', '/api/runs', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: { routeList: ['/orders', '/products'], roleList: ['admin'] },
  });
  assert('Create run 201 or 200', res.status === 201 || res.status === 200, `got ${res.status}`);
  runId = res.body.id || res.body.runId;
  assert('Has run id', !!runId, JSON.stringify(res.body));
  console.log(`  → runId: ${runId}`);

  // ─── 5. Create capture session ─────────────────────────────────
  console.log('\n── 5. Create Capture Session ──');
  res = await request('POST', '/api/capture-sessions', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: { runId, moduleName: 'orders', environment: 'dev' },
  });
  assert('Create session 201', res.status === 201, `got ${res.status}`);
  assert('Has sessionId', res.body && res.body.sessionId, JSON.stringify(res.body));
  assert('Has runId', res.body && res.body.runId, JSON.stringify(res.body));
  assert('uploadToken starts with cap_upload_', res.body && res.body.uploadToken && res.body.uploadToken.startsWith('cap_upload_'), JSON.stringify(res.body));
  assert('Has uploadUrl', res.body && res.body.uploadUrl, JSON.stringify(res.body));

  sessionId = res.body.sessionId;
  runId = res.body.runId;
  uploadToken = res.body.uploadToken;
  console.log(`  → sessionId: ${sessionId}`);
  console.log(`  → runId: ${runId}`);
  console.log(`  → uploadToken: ${uploadToken}`);

  // ─── 5. Generate fake package ─────────────────────────────────────────────
  console.log('\n── 5. Generate Fake Package ──');
  const pkg = createFakePackage();
  assert('metadata generated', !!pkg.metadata, '');
  assert('snapshot.gz generated (' + pkg.snapshotGz.length + ' bytes)', pkg.snapshotGz.length > 100, '');
  assert('screenshot generated (' + pkg.screenshotBuffer.length + ' bytes)', pkg.screenshotBuffer.length > 20, '');
  console.log(`  → snapshot nodes: ${JSON.parse(zlib.gunzipSync(pkg.snapshotGz).toString('utf8')).nodes.length}`);

  // ─── 6. Upload page with upload token ─────────────────────────────────────
  console.log('\n── 6. Upload Page ──');
  res = await multipartRequest('POST', `/api/capture-sessions/${sessionId}/pages`, {
    metadata: JSON.stringify(pkg.metadata),
  }, {
    snapshot: { filename: 'snapshot.json.gz', content: pkg.snapshotGz, contentType: 'application/gzip' },
    screenshot: { filename: 'screenshot.png', content: pkg.screenshotBuffer, contentType: 'image/png' },
  }, uploadToken);  // use cap_upload_ token, not admin
  assert('Upload 201', res.status === 201, `got ${res.status}`);
  assert('Has captureId', res.body && res.body.captureId, JSON.stringify(res.body));
  assert('status is uploaded', res.body && res.body.status === 'uploaded', JSON.stringify(res.body));

  captureId = res.body.captureId;
  console.log(`  → captureId: ${captureId}`);

  // ─── 7. Complete session ──────────────────────────────────────────────────
  console.log('\n── 7. Complete Session ──');
  res = await request('POST', `/api/capture-sessions/${sessionId}/complete`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert('Complete 202', res.status === 202, `got ${res.status}`);
  assert('Analysis started message', res.body && res.body.message && res.body.message.includes('analysis'), JSON.stringify(res.body));
  console.log(`  → message: ${res.body.message}`);

  // ─── 8. Poll session status ───────────────────────────────────────────────
  console.log('\n── 8. Poll Session Status ──');
  let finalStatus;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    res = await request('GET', `/api/capture-sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    finalStatus = res.body && res.body.status;
    console.log(`  poll ${i + 1}: status = ${finalStatus}`);
    if (finalStatus === 'ready_for_review' || finalStatus === 'failed') break;
  }
  assert('Final status is ready_for_review', finalStatus === 'ready_for_review', `got ${finalStatus}`);

  // ─── 9. Verify outputs ────────────────────────────────────────────────────
  console.log('\n── 8. Verify Outputs ──');

  // Check page_captures
  assert('Page captures exist', res.body && res.body.pageCaptures && res.body.pageCaptures.length > 0, JSON.stringify(res.body.pageCaptures));
  if (res.body && res.body.pageCaptures) {
    const pc = res.body.pageCaptures[0];
    console.log(`  → page status: ${pc.status}`);
    assert('Page status is uploaded or normalized', ['uploaded', 'normalized', 'analyzed'].includes(pc.status), `got ${pc.status}`);
  }

  // Check clusters/findings via /api/runs/:runId/summary
  console.log('\n── 9. Verify Review Summary ──');
  res = await request('GET', `/api/runs/${runId}/summary`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert('Summary 200', res.status === 200, `got ${res.status}`);
  const summary = res.body;
  const clusterCount = summary && summary.metrics && summary.metrics.totalClusters || 0;
  const findingCount = summary && summary.metrics && summary.metrics.totalFindings || 0;
  console.log(`  → clusters: ${clusterCount}`);
  console.log(`  → findings: ${findingCount}`);
  assert('Has clusters (summary)', clusterCount >= 1, `clusters=${clusterCount}`);
  assert('Has findings (summary)', findingCount >= 1, `findings=${findingCount}`);

// Check files on disk (skip if remote — files only exist on ZimaOS)
  const isRemote = BASE.includes('anthena.net') || BASE.includes('cloudflare');
  if (isRemote) {
    console.log('  → remote mode: skipping file storage check');
  } else {
    // Try Docker container path first (ZimaOS), fall back to local path
    const containerPath = `/data/evidence/snapshots/runs/${runId}/pages/${captureId}`;
    const localPath = path.join(__dirname, '..', 'backend', 'storage', 'snapshots', 'runs', runId, 'pages', captureId);
    const storageBase = fs.existsSync(containerPath) ? containerPath : localPath;
    console.log(`  → storage path: ${storageBase}`);
    const filesOk = [];
    for (const f of ['full.webp', 'snapshot.json.gz', 'metadata.json']) {
    const fp = path.join(storageBase, f);
    const exists = fs.existsSync(fp);
    filesOk.push(exists);
    console.log(`  → ${f}: ${exists ? 'EXISTS' : 'MISSING'}`);
  }
  assert('All storage files exist', filesOk.every(Boolean), filesOk.map((ok, i) => (['full.webp', 'snapshot.json.gz', 'metadata.json'][i]) + (ok ? '' : ' MISSING')).join(', '));
  }

  // ─── 10. Negative 1: Upload with admin token (should fail) ────────────────
  console.log('\n── Negative 1: Upload with admin token (expect 403) ──');
  const pkg2 = createFakePackage();
  res = await multipartRequest('POST', `/api/capture-sessions/${sessionId}/pages`, {
    metadata: JSON.stringify(pkg2.metadata),
  }, {
    snapshot: { filename: 'snapshot.json.gz', content: pkg2.snapshotGz, contentType: 'application/gzip' },
    screenshot: { filename: 'screenshot.png', content: pkg2.screenshotBuffer, contentType: 'image/png' },
  }, ADMIN_TOKEN);  // use admin token — should fail
  assert('Upload with admin token is not 201', res.status !== 201, `got ${res.status}`);
  assert('Upload with admin token returns error', res.status === 403 || res.status === 401 || res.status === 400, `got ${res.status}`);

  // ─── Negative 2: Complete empty session (no uploads) ──────────────────────
  console.log('\n── Negative 2: Complete empty session (expect failed) ──');
  res = await request('POST', '/api/runs', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: { routeList: ['/orders'], roleList: ['admin'] },
  });
  const emptyRunId = res.body.id || res.body.runId;
  console.log(`  → empty runId: ${emptyRunId}`);

  res = await request('POST', '/api/capture-sessions', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: { runId: emptyRunId, moduleName: 'empty', environment: 'dev' },
  });
  const emptySessionId = res.body.sessionId;
  console.log(`  → empty sessionId: ${emptySessionId}`);

  res = await request('POST', `/api/capture-sessions/${emptySessionId}/complete`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert('Empty session complete 202', res.status === 202, `got ${res.status}`);

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    res = await request('GET', `/api/capture-sessions/${emptySessionId}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const st = res.body && res.body.status;
    console.log(`  poll ${i + 1}: status = ${st}`);
    if (st === 'failed' || st === 'ready_for_review') break;
  }
  assert('Empty session final status is failed', res.body && res.body.status === 'failed', `got ${res.body && res.body.status}`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});