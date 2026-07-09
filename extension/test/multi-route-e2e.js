#!/usr/bin/env node
'use strict';

/**
 * Multi-Route Extension E2E — Manifest-Driven Replay + State Coverage
 *
 * Extends the single-route E2E harness to:
 *   - 2+ routes with distinct HTML fixtures
 *   - Multiple states per route (ready, loading, error)
 *   - Deterministic replay detection (same manifest → idempotent)
 *   - Provenance/routeKey/state separation assertions
 *   - Redaction confirmed per capture
 *
 * Run: node test/multi-route-e2e.js   (after extension build, backend node_modules)
 */

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

// Delay between captures to avoid blinking content-script race.
// captureVisibleTab has its own 1-per-second quota.
const capDelay = 1_000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function json(url) {
  const response = await fetch(url);
  const body = await response.json();
  check(response.ok, `HTTP ${response.status} ${new URL(url).pathname}`);
  return body;
}

// ─── Route Fixtures ────────────────────────────────────────────────────────

/**
 * Deterministic HTML fixtures for 3 routes, each with 2 states.
 * Returns middleware that serves /fixture/login, /fixture/dashboard, /fixture/settings
 * each with query param ?state=ready|loading|error.
 */
function fixtureRouter() {
  const router = express.Router();

  // Fixture: Login (ready state — input + button; loading state — spinner)
  router.get('/login', (req, res) => {
    const state = req.query.state || 'ready';
    if (state === 'loading') {
      return res.type('html').send(`<!doctype html>
        <html><head><title>Login — Loading</title>
        <style>body{font:14px Arial;padding:24px;background:#f5f5f5}.ant-spin{display:inline-block;width:32px;height:32px;border:4px solid #d9d9d9;border-top-color:#1677ff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>
        <main class="ant-card" aria-label="Login loading"><h1>Signing in...</h1><div class="ant-spin" role="status" aria-label="Loading indicator"></div></main>
      </body></html>`);
    }
    // ready state
    res.type('html').send(`<!doctype html>
      <html><head><title>Login</title>
      <style>body{font:14px Arial;padding:24px;background:#f5f5f5}.ant-btn{color:white;background:#1677ff;border-radius:6px;padding:8px 16px;border:none}.ant-input{width:240px;padding:8px;border:1px solid #d9d9d9;border-radius:6px;margin:4px 0}.ant-card{width:400px;padding:24px;background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}</style></head><body>
      <main class="ant-card" aria-label="Login form">
        <h1>Sign in to Anthena</h1>
        <label for="username">Username</label>
        <input id="username" class="ant-input" aria-label="Username" value="admin@anthena.io">
        <label for="password">Password</label>
        <input id="password" type="password" class="ant-input" aria-label="Password" value="s3cret!x">
        <button class="ant-btn ant-btn-primary" aria-label="Sign in">Sign in</button>
      </main>
    </body></html>`);
  });

  // Fixture: Dashboard (ready state with cards; error state with alert)
  router.get('/dashboard', (req, res) => {
    const state = req.query.state || 'ready';
    if (state === 'error') {
      return res.type('html').send(`<!doctype html>
        <html><head><title>Dashboard — Error</title>
        <style>body{font:14px Arial;padding:24px;background:#f5f5f5}.ant-alert-error{background:#fff2f0;border:1px solid #ffccc7;padding:12px 16px;border-radius:6px;color:#ff4d4f}.ant-btn{color:white;background:#ff4d4f;border-radius:6px;padding:8px 16px;border:none}</style></head><body>
        <main class="ant-card" aria-label="Error state">
          <div class="ant-alert-error" role="alert" aria-label="Connection failed">
            <strong>Connection failed</strong> — Unable to load dashboard data.
          </div>
          <button class="ant-btn ant-btn-dangerous" aria-label="Retry">Retry</button>
        </main>
      </body></html>`);
    }
    // ready state
    res.type('html').send(`<!doctype html>
      <html><head><title>Dashboard</title>
      <style>body{font:14px Arial;padding:24px;background:#f5f5f5;display:flex;gap:16px;flex-wrap:wrap}.ant-card{width:260px;padding:16px;background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:1px solid #f0f0f0}.ant-statistic{font-size:28px;font-weight:bold;color:#1677ff}.ant-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:#f6ffed;border:1px solid #b7eb8f;color:#389e0d}</style></head><body>
      <main class="ant-card" aria-label="Total users">
        <h3>Total Users</h3><div class="ant-statistic" aria-label="1,234 users">1,234</div>
        <span class="ant-tag" aria-label="+12% this week">+12%</span>
      </main>
      <main class="ant-card" aria-label="Active sessions">
        <h3>Active Sessions</h3><div class="ant-statistic" aria-label="56 active">56</div>
        <span class="ant-tag" aria-label="-3% this week">-3%</span>
      </main>
      <main class="ant-card" aria-label="Pending reviews">
        <h3>Pending Reviews</h3><div class="ant-statistic" aria-label="8 pending">8</div>
        <span class="ant-tag" aria-label="+2 from yesterday">+2</span>
      </main>
    </body></html>`);
  });

  // Fixture: Settings (ready state with form; loading state with skeleton)
  router.get('/settings', (req, res) => {
    const state = req.query.state || 'ready';
    if (state === 'loading') {
      return res.type('html').send(`<!doctype html>
        <html><head><title>Settings — Loading</title>
        <style>body{font:14px Arial;padding:24px;background:#f5f5f5}.ant-skeleton{background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;height:24px;margin:8px 0}.ant-skeleton-title{width:40%}.ant-skeleton-paragraph{width:80%}@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style></head><body>
        <main class="ant-card" aria-label="Settings loading">
          <h1>Settings</h1>
          <div class="ant-skeleton ant-skeleton-title" aria-label="Loading field"></div>
          <div class="ant-skeleton ant-skeleton-paragraph" aria-label="Loading value"></div>
          <div class="ant-skeleton ant-skeleton-paragraph" aria-label="Loading value" style="width:60%"></div>
        </main>
      </body></html>`);
    }
    // ready state
    res.type('html').send(`<!doctype html>
      <html><head><title>Settings</title>
      <style>body{font:14px Arial;padding:24px;background:#f5f5f5}.ant-card{width:500px;padding:24px;background:white;border-radius:8px}.ant-form-item{margin:12px 0}.ant-btn{color:white;background:#1677ff;border-radius:6px;padding:8px 16px;border:none}.ant-input{width:300px;padding:8px;border:1px solid #d9d9d9;border-radius:6px}.ant-switch{display:inline-block;width:44px;height:22px;background:#d9d9d9;border-radius:11px;position:relative;cursor:pointer}.ant-switch-checked{background:#1677ff}.ant-switch::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:white;top:2px;left:2px;transition:0.2s}.ant-switch-checked::after{left:24px}</style></head><body>
      <main class="ant-card" aria-label="Settings form">
        <h1>User Settings</h1>
        <div class="ant-form-item"><label>Display name</label><input class="ant-input" aria-label="Display name" value="Admin User"></div>
        <div class="ant-form-item"><label>Email notifications</label><div class="ant-switch ant-switch-checked" role="switch" aria-label="Email notifications on" aria-checked="true"></div></div>
        <div class="ant-form-item"><label>Dark mode</label><div class="ant-switch" role="switch" aria-label="Dark mode off" aria-checked="false"></div></div>
        <button class="ant-btn ant-btn-primary" aria-label="Save settings">Save</button>
      </main>
    </body></html>`);
  });

  return router;
}

// ─── Manifests ──────────────────────────────────────────────────────────────

const MANIFESTS = {
  login: {
    id: 'e2e-route-login',
    name: 'Login Page',
    route: '/login',
    role: 'public',
    viewport: { width: 1280, height: 800 },
    theme: 'light',
    locale: 'en-US',
    actions: ['sign-in'],
    states: ['ready', 'loading'],
    tags: ['multi-route-e2e'],
  },
  dashboard: {
    id: 'e2e-route-dashboard',
    name: 'Dashboard Overview',
    route: '/dashboard',
    role: 'admin',
    viewport: { width: 1280, height: 800 },
    theme: 'light',
    locale: 'en-US',
    actions: ['view', 'retry'],
    states: ['ready', 'error'],
    tags: ['multi-route-e2e'],
  },
  settings: {
    id: 'e2e-route-settings',
    name: 'User Settings',
    route: '/settings',
    role: 'admin',
    viewport: { width: 1280, height: 800 },
    theme: 'light',
    locale: 'en-US',
    actions: ['save', 'toggle'],
    states: ['ready', 'loading'],
    tags: ['multi-route-e2e'],
  },
};

function manifestToRouteKey(m) {
  return [m.route.replace(/^\//,'').replace(/\//g,'-'), m.role, m.theme, m.locale].filter(Boolean).join('-');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  check(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'built unpacked extension exists');

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
    sessionId: 'multi-route-session',
    runId: req.body.runId,
    uploadUrl: '/api/v2/evidence',
    uploadToken: 'local-e2e-token',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  }));
  app.use('/api/v2', routes);
  app.use('/fixture', fixtureRouter());

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthena-multi-e2e-'));
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

    // Wait for service worker
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    check(worker.url().startsWith('chrome-extension://'), 'actual MV3 service worker loaded');
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup/index.html`);

    // ── Create session ──────────────────────────────────────────────
    const configured = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      {
        type: 'CONFIGURE_SESSION',
        apiBaseUrl: baseUrl,
        runId: 'multi-route-run',
        moduleName: 'multi-route-e2e',
        environment: 'local-e2e',
        adminToken: 'local-admin-token',
      }
    );
    check(configured?.type === 'SESSION_CONFIGURED', 'service worker configured capture session');

    // ── Capture 1: Login / ready ──────────────────────────────────
    const loginPage = await context.newPage();
    await loginPage.goto(`${baseUrl}/fixture/login?state=ready`, { waitUntil: 'domcontentloaded' });
    await loginPage.bringToFront();
    await sleep(capDelay);

    const cap1 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.login, state: 'ready' } }
    );
    check(cap1?.type === 'CAPTURE_COMPLETE', cap1?.error || 'login/ready captured');
    await sleep(capDelay);

    // ── Capture 2: Login / loading ────────────────────────────────
    await loginPage.goto(`${baseUrl}/fixture/login?state=loading`, { waitUntil: 'domcontentloaded' });
    await loginPage.bringToFront();
    await loginPage.waitForTimeout(800);

    const cap2 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.login, state: 'loading' } }
    );
    check(cap2?.type === 'CAPTURE_COMPLETE', cap2?.error || 'login/loading captured');
    await sleep(capDelay);

    // ── Capture 3: Dashboard / ready ─────────────────────────────
    const dashPage = await context.newPage();
    await dashPage.goto(`${baseUrl}/fixture/dashboard?state=ready`, { waitUntil: 'domcontentloaded' });
    await dashPage.bringToFront();
    await dashPage.waitForTimeout(800);

    const cap3 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.dashboard, state: 'ready' } }
    );
    check(cap3?.type === 'CAPTURE_COMPLETE', cap3?.error || 'dashboard/ready captured');
    await sleep(capDelay);

    // ── Capture 4: Dashboard / error ─────────────────────────────
    await dashPage.goto(`${baseUrl}/fixture/dashboard?state=error`, { waitUntil: 'domcontentloaded' });
    await dashPage.bringToFront();
    await dashPage.waitForTimeout(800);

    const cap4 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.dashboard, state: 'error' } }
    );
    check(cap4?.type === 'CAPTURE_COMPLETE', cap4?.error || 'dashboard/error captured');
    await sleep(capDelay);

    // ── Capture 5: Settings / ready ──────────────────────────────
    const settingsPage = await context.newPage();
    await settingsPage.goto(`${baseUrl}/fixture/settings?state=ready`, { waitUntil: 'domcontentloaded' });
    await settingsPage.bringToFront();
    await settingsPage.waitForTimeout(800);

    const cap5 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.settings, state: 'ready' } }
    );
    check(cap5?.type === 'CAPTURE_COMPLETE', cap5?.error || 'settings/ready captured');
    await sleep(capDelay);

    // ── Capture 6: Settings / loading ──────────────────────────────
    await settingsPage.goto(`${baseUrl}/fixture/settings?state=loading`, { waitUntil: 'domcontentloaded' });
    await settingsPage.bringToFront();
    await settingsPage.waitForTimeout(800);

    const cap6 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.settings, state: 'loading' } }
    );
    check(cap6?.type === 'CAPTURE_COMPLETE', cap6?.error || 'settings/loading captured');
    await sleep(capDelay);

    // ── Replay: same manifest, new immutable observation ─────────
    await loginPage.goto(`${baseUrl}/fixture/login?state=ready`, { waitUntil: 'domcontentloaded' });
    await loginPage.bringToFront();
    await sleep(capDelay);
    const cap7 = await extensionPage.evaluate(
      p => chrome.runtime.sendMessage(p),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: { ...MANIFESTS.login, state: 'ready' } }
    );
    check(cap7?.type === 'CAPTURE_COMPLETE', cap7?.error || 'login/ready replay captured');

    // ── Exact retry: same canonical packageId → backend no-op ────
    const exactPackage = JSON.parse((await evidenceStore.get(cap7.captureId)).toString('utf8'));
    const exactRetry = await fetch(`${baseUrl}/api/v2/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exactPackage),
    });
    check(exactRetry.status === 200, 'exact package retry is idempotent');

    // ── Verify ─────────────────────────────────────────────────────
    const rows = await json(`${baseUrl}/api/v2/evidence`);
    check(rows.total === 7, '7 canonical packages persisted (6 unique + 1 replay)');

    // ── Verify each route/state evidence ──────────────────────────
    const allEvidence = rows.evidence;

    // Route separation: all 3 routes have evidence
    const routeKeys = new Set();
    for (const ev of allEvidence) {
      const detail = await json(`${baseUrl}/api/v2/evidence/${ev.id}`);
      const scenario = detail.metadata?.scenario || {};
      const rk = manifestToRouteKey(scenario);
      if (rk) routeKeys.add(rk);
    }
    check(routeKeys.has('login-public-light-en-US'), 'login routeKey present');
    check(routeKeys.has('dashboard-admin-light-en-US'), 'dashboard routeKey present');
    check(routeKeys.has('settings-admin-light-en-US'), 'settings routeKey present');

    // Verify each evidence package has correct structure
    for (const ev of allEvidence) {
      const detail = await json(`${baseUrl}/api/v2/evidence/${ev.id}`);
      const stored = JSON.parse((await evidenceStore.get(ev.captureId)).toString('utf8'));

      // Provenance preserved
      check(stored.provenance?.captureSessionId === 'multi-route-session', 'provenance sessionId preserved');
      check(stored.provenance?.capturedVia === 'popup', 'provenance capturedVia preserved');
      check(['ready', 'loading', 'error'].includes(stored.scenario?.state), 'scenario state provenance preserved');

      // Signals present
      check(stored.dom.nodes.length > 0, 'DOM evidence persisted');
      check(Object.keys(stored.css.computed).length > 0, 'CSS evidence persisted');
      check(stored.dom.nodes.some(n => n.rect.w > 0 && n.rect.h > 0), 'rect evidence persisted');
      check(Object.keys(stored.a11y.nodes).length > 0, 'a11y evidence persisted');

      // Redaction applied
      check(stored.redaction?.applied === true, 'redaction applied by default');

      // Screenshot present
      check(/^data:image\/png;base64,/.test(stored.screenshot), 'screenshot persisted');
      check(stored.screenshot.length > 100, 'screenshot has content');
    }

    // Verify state-specific content
    // login/ready: has input fields
    const loginReadyDetail = JSON.parse((await evidenceStore.get(cap1.captureId)).toString('utf8'));
    const loginInputs = loginReadyDetail.dom.nodes.filter(n => n.tag === 'input');
    check(loginInputs.length > 0, 'login/ready has input fields');

    // login/loading: has spinner
    const loginLoadingDetail = JSON.parse((await evidenceStore.get(cap2.captureId)).toString('utf8'));
    const loginSpinners = loginLoadingDetail.dom.nodes.filter(n => n.tag === 'div' && n.classList?.includes('ant-spin'));
    check(loginSpinners.length > 0, 'login/loading has spinner (ant-spin)');

    // dashboard/ready: has cards
    const dashReadyDetail = JSON.parse((await evidenceStore.get(cap3.captureId)).toString('utf8'));
    const dashCards = dashReadyDetail.dom.nodes.filter(n => n.classList?.includes('ant-card'));
    check(dashCards.length >= 3, 'dashboard/ready has 3 card elements');

    // dashboard/error: has alert
    const dashErrorDetail = JSON.parse((await evidenceStore.get(cap4.captureId)).toString('utf8'));
    const dashAlerts = dashErrorDetail.dom.nodes.filter(n => n.classList?.includes('ant-alert-error'));
    check(dashAlerts.length > 0, 'dashboard/error has alert element');

    // settings/ready: has switch
    const settingsReadyDetail = JSON.parse((await evidenceStore.get(cap5.captureId)).toString('utf8'));
    const switches = settingsReadyDetail.dom.nodes.filter(n => n.classList?.includes('ant-switch'));
    check(switches.length > 0, 'settings/ready has switch elements');

    // settings/loading: has skeleton
    const settingsLoadingDetail = JSON.parse((await evidenceStore.get(cap6.captureId)).toString('utf8'));
    const skeletons = settingsLoadingDetail.dom.nodes.filter(n => n.classList?.includes('ant-skeleton'));
    check(skeletons.length > 0, 'settings/loading has skeleton elements');

    // ── Replay identity ─────────────────────────────────────────────
    // A new capture is an immutable observation and receives a new package ID.
    // Exact retry idempotency is asserted separately using the same package ID.
    // or a new ID that results in the same fingerprint cluster.
    check(cap7.captureId !== cap1.captureId, 'new replay observation produces a new captureId');

    // Verify evidence status derived correctly
    for (const ev of allEvidence) {
      const signals = await json(`${baseUrl}/api/v2/evidence/${ev.id}/signals`);
      check(signals.derivedStatus === 'full', 'backend derives full package status');
      const bySignal = Object.fromEntries(signals.signals.map(s => [s.signal, s]));
      for (const name of ['dom-structure', 'css-computed', 'rect', 'antd-classes', 'a11y-tree']) {
        check(bySignal[name]?.status === 'present', `${name} status present for ${ev.id}`);
      }
    }

    console.log('\nMulti-route extension E2E: PASS');
    console.log('  Routes: login, dashboard, settings (3)');
    console.log('  States: ready, loading, error (6 unique captures)');
    console.log('  Replay: 1 new observation + 1 exact idempotent retry → 7 total packages');
    console.log('  Provenance: sessionId, capturedVia preserved');
    console.log('  Route/state separation: unique content verified per capture');

  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('\nMulti-route extension E2E: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
});
