'use strict';

/**
 * Collector module — complete route collection flow.
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const config = require('../config');
const { getDb } = require('../db');
const browser = require('./browser');
const login = require('./login');
const navigator = require('./navigator');
const screenshot = require('./screenshot');

/**
 * Collect a single route+role combination.
 * Logs in, navigates, captures screenshot, saves snapshot JSON.
 */
async function collectRoute(runId, routeUrl, role) {
  const log = logger.child({ module: 'collector', runId, role, url: routeUrl });
  log.info('Starting collection');
  
  const snapshotId = `snap-${uuidv4().slice(0, 8)}`;
  const now = new Date().toISOString();
  
  const storagePath = config.storagePath;
  const runDir = path.join(storagePath, 'runs', runId);
  const snapshotPath = path.join(runDir, 'snapshot.json.gz');
  const screenshotPath = path.join(runDir, 'full.webp');
  const cropDirPath = path.join(runDir, 'crops');
  const thumbDirPath = path.join(runDir, 'thumbnails');
  
  // Ensure directories
  for (const dir of [runDir, cropDirPath, thumbDirPath]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  
  // Create context and page
  const ctx = await browser.createContext(role);
  const page = await ctx.newPage();
  
  try {
    // Login
    await login(page, role);
    
    // Navigate
    await navigator.navigate(page, routeUrl);
    
    // Capture screenshot
    const viewport = await screenshot.captureScreenshot(page, screenshotPath);
    
    // Build snapshot JSON
    const snapshotJson = {
      id: snapshotId,
      runId,
      url: routeUrl,
      role,
      capturedAt: now,
      schemaVersion: config.schemaVersion,
      extractorVersion: null,
      analyzerVersion: null,
      status: 'captured',
      nodeCount: 0,
      viewport,
      metadata: {
        schemaVersion: config.schemaVersion,
        extractorVersion: null,
        analyzerVersion: null,
        generatedAt: now,
        disclaimer: {
          fiber: 'React Fiber (__reactFiber$) is a private API and may break across React versions',
        },
      },
      nodes: [],
    };
    
    // Compress and save snapshot JSON
    const zlib = require('zlib');
    const gzipped = zlib.gzipSync(JSON.stringify(snapshotJson));
    fs.writeFileSync(snapshotPath, gzipped);
    
    // Insert into database
    const db = getDb();
    const relativeRunDir = `runs/${runId}`;
    db.prepare(`
      INSERT INTO snapshots (id, runId, url, role, capturedAt, schemaVersion, filePath, screenshotPath, cropDirPath, thumbDirPath, status, nodeCount, viewportWidth, viewportHeight, deviceScaleFactor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', 0, ?, ?, ?)
    `).run(
      snapshotId, runId, routeUrl, role, now, config.schemaVersion,
      `${relativeRunDir}/snapshot.json.gz`,
      `${relativeRunDir}/full.webp`,
      `${relativeRunDir}/crops`,
      `${relativeRunDir}/thumbnails`,
      viewport.width, viewport.height, viewport.deviceScaleFactor
    );
    
    log.info({ snapshotId }, 'Collection complete');
    
    return { id: snapshotId, snapshotJson };
    
  } catch (err) {
    log.error({ err: err.message }, 'Collection failed');
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

/**
 * Extract visible DOM node bounding rects (pre-extraction).
 * Used for Phase 0 spike.
 */
async function extractNodeRects(page) {
  return page.evaluate(() => {
    const nodes = [];
    const allElements = document.querySelectorAll('body *:not(script):not(style):not(head):not(link):not(meta)');
    
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      
      // Skip invisible / zero-dimension elements
      if (rect.width === 0 || rect.height === 0) continue;
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      
      nodes.push({
        tag: el.tagName.toLowerCase(),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        visible: true,
      });
    }
    
    return nodes;
  });
}

module.exports = { collectRoute, extractNodeRects };