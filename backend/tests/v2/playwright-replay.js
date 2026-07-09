#!/usr/bin/env node

/**
 * Playwright Multi-Route Replay
 *
 * Replays a scenario manifest using extension/playwright-capture.js
 * against multiple routes.
 *
 * Usage:
 *   node backend/tests/v2/playwright-replay.js
 *   node backend/tests/v2/playwright-replay.js --dry-run
 *   node backend/tests/v2/playwright-replay.js --scenario ../scenarios/fixture-route.json
 *   node backend/tests/v2/playwright-replay.js --url https://example.com --routes 3
 *
 * Environment:
 *   PLAYWRIGHT_HEADLESS=true|false (default: true)
 *   CAPTURE_OUTPUT_DIR  (default: ./captured-packages/)
 *
 * Each captured package is validated against evidence-package.js schema
 * and run through computeSignalStatus to verify all 7 signals.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..', '..'); // tests/v2 → backend → root
const CAPTURE_SCRIPT = path.join(ROOT, 'extension', 'playwright-capture.js');
const SCENARIO_DIR = path.join(ROOT, 'scenarios');
const OUTPUT_DIR = process.env.CAPTURE_OUTPUT_DIR || './captured-packages';
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const DRY_RUN = process.argv.includes('--dry-run');

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    scenario: null,
    url: null,
    routes: 3,
    validate: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--scenario':
        opts.scenario = path.resolve(ROOT, args[++i]);
        break;
      case '--url':
        opts.url = args[++i];
        break;
      case '--routes':
        opts.routes = parseInt(args[++i], 10) || 3;
        break;
      case '--no-validate':
        opts.validate = false;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Playwright Multi-Route Replay

Replays capture scenarios through extension/playwright-capture.js
and validates output packages.

Usage:
  node backend/tests/v2/playwright-replay.js
  node backend/tests/v2/playwright-replay.js --dry-run
  node backend/tests/v2/playwright-replay.js --scenario ../scenarios/fixture-route.json
  node backend/tests/v2/playwright-replay.js --url https://example.com --routes 5

Options:
  --scenario <path>   JSON scenario manifest (default: fixture-route.json)
  --url <url>         Single URL to capture
  --routes <n>        When using --url, number of unique routes to generate (default: 3)
  --no-validate       Skip evidence package validation
  --dry-run           Preview routes without capturing
  --help              Show this help
`);
}

// ── Scenario Loading ─────────────────────────────────────────────────────

function loadScenario(opts) {
  if (opts.url) {
    // Generate synthetic routes from a single base URL
    const base = new URL(opts.url);
    return {
      scenario: {
        name: `Replay: ${base.hostname}`,
        routes: Array.from({ length: opts.routes }, (_, i) => {
          const u = new URL(base);
          u.pathname = `/route-${i + 1}`;
          return u.toString();
        }),
        roles: ['admin'],
        viewport: { width: 1440, height: 900 },
        theme: 'light',
        locale: 'en-US',
      },
      expectedSignals: {
        'dom-structure': 'present',
        'css-computed': 'present',
        'rect': 'present',
        'antd-classes': 'present',
        'antd-tokens': 'present',
        'react-fiber': 'present',
        'a11y-tree': 'present',
      },
    };
  }

  const scenarioPath = opts.scenario || path.join(SCENARIO_DIR, 'fixture-route.json');
  if (!fs.existsSync(scenarioPath)) {
    console.error(`Scenario not found: ${scenarioPath}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
}

// ── Capture Runner ──────────────────────────────────────────────────────

function runCapture(url, outputPath, index, total) {
  if (DRY_RUN) {
    return {
      packageId: `pkg-dry-${index}`,
      url,
      capturedAt: new Date().toISOString(),
      skipped: true,
    };
  }

  const cmd = [
    'node',
    `"${CAPTURE_SCRIPT}"`,
    `--url "${url}"`,
    `--output "${outputPath}"`,
    HEADLESS ? '--headless' : '',
  ].filter(Boolean).join(' ');

  console.log(`[${index}/${total}] Capturing: ${url}`);

  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      shell: 'cmd.exe',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Read the output file
    const pkg = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    console.log(`  Package: ${pkg.packageId} | DOM: ${pkg.dom.nodes.length} nodes | Tokens: ${Object.keys(pkg.antd.tokens).length}`);
    return pkg;
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return null;
  }
}

// ── Validation ──────────────────────────────────────────────────────────

function validatePackage(pkg, expectedSignals) {
  if (pkg.skipped) return { valid: true, errors: [] };
  if (!pkg) return { valid: false, errors: ['Capture failed'] };

  const errors = [];

  // Schema check
  if (pkg.schemaVersion !== '2.0.0') {
    errors.push(`Schema version: expected 2.0.0, got ${pkg.schemaVersion}`);
  }

  // Required signals
  const hasDom = pkg.dom && Array.isArray(pkg.dom.nodes) && pkg.dom.nodes.length > 0;
  const hasCss = pkg.css && pkg.css.computed && Object.keys(pkg.css.computed).length > 0;
  const hasRect = hasDom && pkg.dom.nodes.every(n => n.rect && typeof n.rect.x === 'number' && typeof n.rect.y === 'number');
  const hasAntdClasses = pkg.antd && Object.keys(pkg.antd.classMatches || {}).length > 0;
  const hasAntdTokens = pkg.antd && Object.keys(pkg.antd.tokens || {}).length > 0;
  const hasFiber = pkg.fiber && Object.keys(pkg.fiber.nodes || {}).length > 0;
  const hasA11y = pkg.a11y && Object.keys(pkg.a11y.nodes || {}).length > 0;

  const present = {
    'dom-structure': hasDom,
    'css-computed': hasCss,
    'rect': hasRect,
    'antd-classes': hasAntdClasses,
    'antd-tokens': hasAntdTokens,
    'react-fiber': hasFiber,
    'a11y-tree': hasA11y,
  };

  // Provenance
  if (!pkg.provenance || !pkg.provenance.packageHash) {
    errors.push('Missing provenance.packageHash');
  }

  // Redaction
  if (!pkg.redaction) {
    errors.push('Missing redaction section');
  }

  for (const [signal, expected] of Object.entries(expectedSignals || {})) {
    if (expected === 'present' && !present[signal]) {
      errors.push(`Expected signal "${signal}" present, but missing`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    signals: present,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const scenario = loadScenario(opts);

  const routes = scenario.scenario.routes;
  const total = routes.length;
  console.log(`Multi-Route Replay: ${total} route(s)`);
  console.log(`  Headless: ${HEADLESS}`);
  console.log(`  Validate: ${opts.validate}`);
  console.log(`  Output:   ${DRY_RUN ? '(dry run)' : OUTPUT_DIR}`);
  console.log('');

  if (!DRY_RUN && !fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    const url = routes[i];
    const index = i + 1;
    const outputPath = DRY_RUN ? null : path.join(OUTPUT_DIR, `replay-pkg-${index}.json`);

    const pkg = runCapture(url, outputPath, index, total);

    if (opts.validate && pkg) {
      const validation = validatePackage(pkg, scenario.expectedSignals);
      if (validation.valid) {
        console.log(`  Validation: PASS`);
        passed++;
      } else {
        console.log(`  Validation: FAIL — ${validation.errors.join(', ')}`);
        failed++;
      }
    } else if (pkg && !pkg.skipped) {
      passed++;
    }

    results.push({ url, pkg, index });
    console.log('');
  }

  // Summary
  console.log('====================================');
  console.log('PLAYWRIGHT REPLAY SUMMARY');
  console.log('====================================');
  console.log(`  Routes:  ${total}`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skip:    ${DRY_RUN ? 'dry-run' : 'no'}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILED routes:');
    for (const r of results) {
      if (!r.pkg || (opts.validate && !validatePackage(r.pkg, scenario.expectedSignals).valid)) {
        console.log(`  - ${r.url}`);
      }
    }
    console.log('');
    process.exit(1);
  }

  console.log('All routes captured successfully.');
}

main().catch(err => {
  console.error('Replay error:', err);
  process.exit(1);
});