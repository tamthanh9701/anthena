'use strict';

/**
 * Collector module — complete route collection flow.
 * End-to-end: login → navigate → extract DOM/CSS/Fiber/A11y → screenshot → save.
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

// Extractor scripts (run in-page via page.evaluate)
const { getDomWalkerScript } = require('../extractor/dom-walker');
const { getCssExtractorScript, getComputedCssForElementsScript } = require('../extractor/css-extractor');
const { getFiberIntrospectionScript } = require('../extractor/fiber-introspector');
const { getA11yExtractorScript } = require('../extractor/a11y-extractor');
const { matchAntdClasses } = require('../extractor/antd-matcher');

/**
 * Collect a single route+role combination.
 * Logs in, navigates, extracts all signal data, captures screenshot, saves snapshot JSON.
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
    
    // ===================================================================
    // EXTRACTION PHASE: Hybrid D+C+B signal pipeline
    // Primary: DOM + computed CSS + screenshot
    // High: AntD class / CSS variable / token match
    // Medium: Accessibility tree
    // Best-effort: React Fiber component identity
    // ===================================================================
    
    const extractionLog = { signals: {}, timing: {} };
    
    // 1. DOM Walker — primary signal (always runs)
    const t1 = Date.now();
    const domNodes = await page.evaluate(getDomWalkerScript());
    extractionLog.timing.domWalker = Date.now() - t1;
    extractionLog.signals.domWalker = { available: true, nodeCount: domNodes.length };
    log.info({ nodeCount: domNodes.length }, 'DOM walker completed');
    
    // 2. Computed CSS — primary signal (runs per-element)
    const t2 = Date.now();
    const cssData = await page.evaluate(getComputedCssForElementsScript());
    extractionLog.timing.cssExtractor = Date.now() - t2;
    extractionLog.signals.cssExtractor = { available: true, elementCount: cssData.length };
    log.info({ elementCount: cssData.length }, 'CSS extractor completed');
    
    // 3. React Fiber — best-effort identity signal
    let fiberResult = { available: false, nodes: [], disclaimer: 'Fiber not attempted' };
    try {
      const t3 = Date.now();
      fiberResult = await page.evaluate(getFiberIntrospectionScript());
      extractionLog.timing.fiber = Date.now() - t3;
      extractionLog.signals.fiber = { available: fiberResult.available, nodeCount: fiberResult.nodes.length };
      log.info({ fiberAvailable: fiberResult.available, nodeCount: fiberResult.nodes.length }, 'Fiber introspection completed');
    } catch (fiberErr) {
      log.warn({ err: fiberErr.message }, 'Fiber introspection failed (non-blocking)');
      extractionLog.signals.fiber = { available: false, error: fiberErr.message };
    }
    
    // 4. Accessibility tree — medium signal
    let a11yResult = [];
    try {
      const t4 = Date.now();
      a11yResult = await page.evaluate(getA11yExtractorScript());
      extractionLog.timing.a11y = Date.now() - t4;
      extractionLog.signals.a11y = { available: true, elementCount: a11yResult.length };
      log.info({ elementCount: a11yResult.length }, 'A11y extractor completed');
    } catch (a11yErr) {
      log.warn({ err: a11yErr.message }, 'A11y extraction failed (non-blocking)');
      extractionLog.signals.a11y = { available: false, error: a11yErr.message };
    }
    
    // ===================================================================
    // BUILD SNAPSHOT NODES: merge all signals per DOM node
    // Schema follows UI Graph v3 (identity + classification separate)
    // ===================================================================
    
    const cssMap = new Map();
    for (const css of cssData) {
      cssMap.set(css.index, css);
    }
    
    const a11yMap = new Map();
    for (const a of a11yResult) {
      a11yMap.set(a.index, a);
    }
    
    const fiberMap = new Map();
    for (const f of (fiberResult.nodes || [])) {
      if (f.displayName) fiberMap.set(f.displayName, f);
    }
    
    const snapshotNodes = [];
    
    for (let i = 0; i < domNodes.length; i++) {
      const dom = domNodes[i];
      const css = cssMap.get(i) || { css: {}, confidence: 0, tag: dom.tag, classList: dom.classList };
      const a11y = a11yMap.get(i) || null;
      
      // Compute AntD match
      const antdMatch = matchAntdClasses(dom.classList || css.classList || []);
      
      // Build IDENTITY (Component identity — "what React calls this")
      // Primary source: Fiber > heuristic
      let identity = {
        name: null,
        source: 'heuristic',
        confidence: 0.0,
        ownerPath: null,
        evidence: [],
      };
      
      if (fiberResult.available && fiberResult.nodes.length > 0) {
        // Try to match Fiber identity to this DOM node by tag/class proximity
        // Best-effort: use first matched Fiber name that looks right
        for (const fnode of fiberResult.nodes) {
          if (fnode.displayName) {
            identity.name = fnode.displayName;
            identity.source = 'react-fiber';
            identity.confidence = 0.72;
            identity.ownerPath = fnode.ownerPath || null;
            identity.evidence = ['fiber-displayName'];
            if (fnode.ownerPath && fnode.ownerPath.length > 0) {
              identity.evidence.push('fiber-owner-chain');
            }
            break; // Use first Fiber match
          }
        }
      }
      
      if (!identity.name) {
        // Fallback: use AntD match or tag-based heuristic
        if (antdMatch.matched.length > 0) {
          identity.name = antdMatch.matched[0].prefix; // e.g., ant-btn
          identity.source = 'antd-class';
          identity.confidence = 0.65;
          identity.evidence = ['antd-class-matched'];
        } else {
          identity.name = dom.tag;
          identity.source = 'dom-tag';
          identity.confidence = 0.35;
          identity.evidence = ['dom-tag-name'];
        }
      }
      
      // Build CLASSIFICATION ("what kind of UI component is this?")
      let classification = {
        type: 'custom',
        source: 'ensemble',
        confidence: 0.0,
        evidence: [],
      };
      
      if (antdMatch.classificationType === 'antd') {
        classification = {
          type: 'antd',
          source: 'antd-class',
          confidence: antdMatch.confidence,
          evidence: antdMatch.matched.map(m => `antd-class:${m.class}`),
        };
      } else {
        classification.type = 'custom';
        classification.source = 'ensemble';
        classification.confidence = 0.68;
        classification.evidence = ['no-antd-class'];
        
        if (identity.source === 'react-fiber') {
          classification.evidence.push('fiber-name');
          classification.confidence = Math.max(classification.confidence, 0.72);
        }
        
        // Check if styles resemble AntD patterns
        if (css.css && css.css.borderRadius && css.css.fontSize) {
          classification.evidence.push('style-extracted');
          classification.confidence = Math.max(classification.confidence, 0.5);
        }
      }
      
      // Build the Schema UI Graph v3 node
      const node = {
        id: `node-${uuidv4().slice(0, 8)}`,
        identity: {
          name: identity.name,
          source: identity.source,
          confidence: identity.confidence,
          ownerPath: identity.ownerPath,
          evidence: identity.evidence,
        },
        classification: {
          type: classification.type,
          source: classification.source,
          confidence: classification.confidence,
          evidence: classification.evidence,
        },
        rect: {
          x: Math.round(dom.rect.x),
          y: Math.round(dom.rect.y),
          w: Math.round(dom.rect.w),
          h: Math.round(dom.rect.h),
        },
        tag: dom.tag,
        classList: dom.classList || [],
        text: dom.text || '',
        computedStyles: {
          backgroundColor: css.css?.backgroundColor || null,
          color: css.css?.color || null,
          fontSize: css.css?.fontSize || null,
          borderRadius: css.css?.borderRadius || null,
          border: css.css?.border || null,
          padding: css.css?.padding || null,
          margin: css.css?.margin || null,
          boxShadow: css.css?.boxShadow || null,
          fontFamily: css.css?.fontFamily || null,
          lineHeight: css.css?.lineHeight || null,
          width: css.css?.width || null,
          height: css.css?.height || null,
        },
        a11y: a11y ? {
          role: a11y.role || null,
          'aria-label': a11y['aria-label'] || null,
          confidence: a11y.confidence || 0,
          hasAria: a11y.hasAria || false,
        } : null,
        cssConfidence: css.confidence || 0,
        driftScore: null, // Computed later by analyzer
      };
      
      snapshotNodes.push(node);
    }
    
    // ===================================================================
    // CAPTURE SCREENSHOT (after extraction to get final visual state)
    // ===================================================================
    const viewport = await screenshot.captureScreenshot(page, screenshotPath);
    
    // Build snapshot JSON (Schema UI Graph v3)
    const snapshotJson = {
      snapshotId,
      url: routeUrl,
      role,
      extractedAt: now,
      schemaVersion: config.schemaVersion,
      extractorVersion: config.extractorVersion || '0.1.0',
      analyzerVersion: null,
      screenshot: {
        path: `runs/${runId}/full.webp`,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      },
      metadata: {
        schemaVersion: config.schemaVersion,
        extractorVersion: config.extractorVersion || '0.1.0',
        analyzerVersion: null,
        generatedAt: now,
        disclaimer: {
          fiber: 'React Fiber (__reactFiber$) is a private API and may break across React versions',
        },
        extraction: extractionLog,
      },
      nodes: snapshotNodes,
      nodeCount: snapshotNodes.length,
      status: 'extracted',
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId, runId, routeUrl, role, now, config.schemaVersion,
      `${relativeRunDir}/snapshot.json.gz`,
      `${relativeRunDir}/full.webp`,
      `${relativeRunDir}/crops`,
      `${relativeRunDir}/thumbnails`,
      snapshotJson.status,
      snapshotNodes.length,
      viewport.width, viewport.height, viewport.deviceScaleFactor || 1
    );
    
    // Insert nodes into DB (for direct DB queries, not just JSON in snapshot)
    const insertNode = db.prepare(`
      INSERT INTO nodes (id, snapshotId, nodeIdentifier, identity, classification, rectX, rectY, rectW, rectH, computedStyles, driftScore, domTag, classList, extractedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertExtractionLog = db.prepare(`
      INSERT INTO extraction_log (id, runId, nodeId, signal, confidence, extractedAt, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const node of snapshotNodes) {
      insertNode.run(
        node.id, snapshotId,
        node.identity.name,
        JSON.stringify(node.identity),
        JSON.stringify(node.classification),
        node.rect.x, node.rect.y, node.rect.w, node.rect.h,
        JSON.stringify(node.computedStyles),
        node.driftScore,
        node.tag,
        JSON.stringify(node.classList),
        now
      );
      
      insertExtractionLog.run(
        `elog-${uuidv4().slice(0, 8)}`,
        runId, node.id,
        node.classification.source,
        node.classification.confidence,
        now,
        JSON.stringify(node.classification.evidence)
      );
    }
    
    log.info({ snapshotId, nodeCount: snapshotNodes.length, timing: extractionLog.timing }, 'Collection complete');
    
    return { id: snapshotId, snapshotJson, extractionLog };
    
  } catch (err) {
    log.error({ err: err.message }, 'Collection failed');
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

/**
 * Extract visible DOM node bounding rects (lightweight Phase 0 spike).
 */
async function extractNodeRects(page) {
  return page.evaluate(getDomWalkerScript());
}

module.exports = { collectRoute, extractNodeRects };