#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('../../backend/node_modules/express');
const { chromium } = require('../../backend/node_modules/playwright');

const root = path.resolve(__dirname, '..', '..');
const extensionDir = path.join(root, 'extension', 'dist');
const backendV2 = path.join(root, 'backend', 'src', 'v2');
const routes = require(path.join(backendV2, 'routes.js'));
const adapters = require(path.join(backendV2, 'storage-adapters.js'));

function check(value, message) {
  if (!value) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

async function json(url) {
  const response = await fetch(url);
  const body = await response.json();
  check(response.ok, `HTTP ${response.status} ${new URL(url).pathname}`);
  return body;
}

async function main() {
  check(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'built unpacked extension exists');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  check(manifest.permissions.includes('sidePanel'), 'manifest declares sidePanel permission');
  check(manifest.side_panel?.default_path === 'popup/index.html', 'manifest declares side panel default path');
  check(!manifest.action?.default_popup, 'action click is reserved for side panel, not popup');

  const metadataDb = new adapters.InMemoryMetadataDB();
  const evidenceStore = new adapters.InMemoryEvidenceStore();
  adapters.forceInit({
    metadataDb,
    evidenceStore,
    figmaPublisher: new adapters.FigmaMockPublisher(),
  });

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.post('/api/capture-sessions', (req, res) => res.json({
    sessionId: 'real-extension-session',
    runId: req.body.runId,
    uploadUrl: '/api/v2/evidence',
    uploadToken: 'local-e2e-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  app.use('/api/v2', routes);
  app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html>
    <html><head><title>Anthena Real Extension Fixture</title>
    <style>
      :root { --ant-color-primary: #1677ff; --ant-border-radius: 6px; }
      body { font: 14px Arial; padding: 24px; }
      .ant-card { width: 420px; padding: 20px; border: 1px solid #d9d9d9; }
      .ant-btn { color: white; background: #1677ff; border-radius: 6px; padding: 8px 16px; }
      .ant-input { width: 240px; padding: 8px; }
    </style></head><body>
      <main class="ant-card" aria-label="Account card">
        <h1>Private account 4111 1111 1111 1111</h1>
        <label for="email">Email</label>
        <input id="email" class="ant-input" aria-label="Email" value="secret@example.com">
        <button class="ant-btn ant-btn-primary" aria-label="Save account">Save</button>
      </main>
    </body></html>`));

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthena-extension-e2e-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    check(worker.url().startsWith('chrome-extension://'), 'actual MV3 service worker loaded');
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup/index.html`);

    const page = await context.newPage();
    await page.goto(`${baseUrl}/fixture`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForTimeout(1_000);

    const ping = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    });
    check(ping?.type === 'PONG', 'actual content script responds');

    const configured = await extensionPage.evaluate(
      payload => chrome.runtime.sendMessage(payload),
      {
        type: 'CONFIGURE_SESSION',
        apiBaseUrl: baseUrl,
        runId: 'real-extension-run',
        moduleName: 'account',
        environment: 'local-e2e',
        adminToken: 'local-admin-token',
      }
    );
    check(configured?.type === 'SESSION_CONFIGURED', 'service worker configured capture session');

    await page.bringToFront();
    const captured = await extensionPage.evaluate(
      payload => chrome.runtime.sendMessage(payload),
      {
        type: 'CAPTURE_NOW_V2',
        redact: true,
        manifest: {
          id: 'real-route-account',
          name: 'Account fixture',
          route: '/fixture',
          role: 'admin',
          viewport: { width: 1280, height: 800 },
          theme: 'light',
          locale: 'en-US',
          actions: ['save'],
          states: ['ready'],
          tags: ['real-extension-e2e'],
        },
      }
    );
    check(captured?.type === 'CAPTURE_COMPLETE', captured?.error || 'CAPTURE_NOW_V2 completed');

    const rows = await json(`${baseUrl}/api/v2/evidence`);
    check(rows.total === 1, 'one canonical package persisted');
    const detail = await json(`${baseUrl}/api/v2/evidence/${rows.evidence[0].id}`);
    const stored = JSON.parse((await evidenceStore.get(captured.captureId)).toString('utf8'));
    const signals = await json(`${baseUrl}/api/v2/evidence/${rows.evidence[0].id}/signals`);

    check(stored.dom.nodes.length > 0, 'DOM evidence persisted');
    check(Object.keys(stored.css.computed).length > 0, 'computed CSS evidence persisted');
    check(stored.dom.nodes.some(node => node.rect.w > 0 && node.rect.h > 0), 'rect evidence persisted');
    check(Object.keys(stored.a11y.nodes).length > 0, 'accessibility evidence persisted');
    check(Object.keys(stored.antd.classMatches).length > 0, 'AntD class evidence persisted');
    check(stored.redaction?.applied === true, 'redaction applied by default');
    check(/^data:image\/png;base64,/.test(stored.screenshot), 'nonempty PNG screenshot persisted');
    check(stored.screenshot.length > 100, 'screenshot contains bytes');
    const bySignal = Object.fromEntries(signals.signals.map(signal => [signal.signal, signal]));
    for (const name of ['dom-structure', 'css-computed', 'rect', 'antd-classes', 'antd-tokens', 'a11y-tree']) {
      check(bySignal[name]?.status === 'present', `${name} status derives present from data`);
    }
    check(bySignal['react-fiber']?.status === 'absent', 'React Fiber truthfully reports absent on non-React fixture');
    check(signals.derivedStatus === 'full', 'backend derives full package status');
    console.log('\nReal unpacked extension E2E: PASS');
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('\nReal unpacked extension E2E: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
});
