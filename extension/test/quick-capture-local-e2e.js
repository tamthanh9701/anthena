#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('../../backend/node_modules/express');
const { chromium } = require('../../backend/node_modules/playwright');

const root = path.resolve(__dirname, '..', '..');
const extensionDir = path.join(root, 'extension', 'dist');

function check(value, message) {
  if (!value) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

async function main() {
  check(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'built unpacked extension exists');

  const app = express();
  app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html>
    <html><head><title>Anthena Quick Capture Fixture</title>
    <style>
      :root { --ant-color-primary: #1677ff; }
      body { font: 14px Arial; padding: 24px; }
      .ant-card { width: 420px; padding: 20px; border: 1px solid #d9d9d9; }
      .ant-btn { color: white; background: #1677ff; border-radius: 6px; padding: 8px 16px; }
    </style></head><body>
      <main class="ant-card" aria-label="Quick capture card">
        <h1>Private quick capture text</h1>
        <button class="ant-btn ant-btn-primary" aria-label="Save quick capture">Save</button>
      </main>
    </body></html>`));

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthena-quick-capture-'));
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
    await page.waitForTimeout(500);

    const ping = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    });
    check(ping?.type === 'PONG', 'actual content script responds');

    const captured = await extensionPage.evaluate(
      payload => chrome.runtime.sendMessage(payload),
      { type: 'CAPTURE_NOW_V2', redact: true, manifest: null }
    );

    check(captured?.type === 'CAPTURE_COMPLETE', captured?.error || 'quick CAPTURE_NOW_V2 completed');
    check(captured.status === 'captured-local', 'quick capture returns captured-local without session');
    check(captured.uploaded === false, 'quick capture reports uploaded=false');
    check(Boolean(captured.captureId), 'quick capture returns captureId');

    const stored = await extensionPage.evaluate(() => chrome.storage.local.get(['anthena_quick_captures']));
    const captures = stored.anthena_quick_captures;
    check(Array.isArray(captures), 'quick capture history stored');
    check(captures.length === 1, 'one quick capture stored');
    check(captures[0].captureId === captured.captureId, 'stored captureId matches response');
    check(captures[0].canonical?.dom?.nodes?.length > 0, 'stored canonical DOM evidence');
    check(Object.keys(captures[0].canonical?.css?.computed || {}).length > 0, 'stored canonical CSS evidence');
    check(Object.keys(captures[0].canonical?.antd?.classMatches || {}).length > 0, 'stored canonical AntD evidence');
    check(captures[0].canonical?.redaction?.applied === true, 'redaction applied by default');
    check(captures[0].canonical?.scenario?.route?.startsWith('quick-'), 'fallback quick scenario route created');

    console.log('\nQuick local capture E2E: PASS');
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('\nQuick local capture E2E: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
});
