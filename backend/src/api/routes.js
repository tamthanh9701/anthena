'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const config = require('../config');
const queue = require('../queue');
const store = require('../store');
const browser = require('../collector/browser');
const tokenSync = require('../token-sync');
const reportBuilder = require('../analyzer/report-builder');
const { createErrorResponse, paginate, validateRouteList, validatePilotContractForCosign, isValidUuid } = require('../utils/helpers');
const idempotencyMiddleware = require('../middleware/idempotency');
const captureSessionRouter = require('./capture-session');

// Apply idempotency middleware to all POST routes
router.post('*', idempotencyMiddleware);

// Mount capture session routes
router.use('/capture-sessions', captureSessionRouter);

// ── Database helpers ───────────────────────────────────────────────────────

function getDbSafe() {
  try { return getDb(); } catch { return null; }
}

function dbCheckRes(res, db) {
  if (!db) return res.status(503).json(createErrorResponse('Database not available', 'SERVICE_UNAVAILABLE', res.req?.requestId));
  return true;
}

const PipelineCollect = queue.registerPipelineCallbacks;

// ===========================================================================
// Health & Operations
// ===========================================================================

// GET /health
router.get('/health', (_req, res) => {
  const db = getDbSafe();
  const data = {
    status: 'ok',
    uptime: process.uptime(),
    database: { status: 'ok', latency: 0 },
    playwright: { status: browser.isBrowserReady() ? 'ok' : 'not-launched', version: null },
  };

  if (!db) {
    data.status = 'degraded';
    data.database = { status: 'error', latency: 0 };
    return res.status(503).json(data);
  }
  
  try {
    db.prepare("SELECT 1").get();
    data.status = 'ok';
    data.database.status = 'ok';
    data.database.latency = 1;
  } catch {
    data.status = 'degraded';
    data.database.status = 'error';
    return res.status(503).json(data);
  }
  
  if (!browser.isBrowserReady()) {
    data.status = 'degraded';
  }
  
  res.json(data);
});

// GET /ready
router.get('/ready', async (_req, res) => {
  const db = getDbSafe();
  const ready = {
    status: 'ready',
    browser: browser.isBrowserReady(),
    database: false,
    uptime: process.uptime(),
  };
  
  if (db) {
    try {
      db.prepare("SELECT 1").get();
      ready.database = true;
    } catch {}
  }
  
  if (ready.browser && ready.database) {
    res.json(ready);
  } else {
    res.status(503).json({
      ...createErrorResponse('Application not fully ready', 'NOT_READY', _req.requestId),
      browser: ready.browser,
      database: ready.database,
    });
  }
});

// GET /api/config
router.get('/config', (_req, res) => {
  dbCheckRes(res, getDbSafe());
  // Build config response matching AppConfig schema
  const mc = config.getMaskedConfig();
  res.json({
    port: mc.port,
    targetUrl: mc.targetUrl,
    routeList: mc.routeList,
    roleMap: mc.roleMap,
    maxRunsPerRoute: mc.maxRunsPerRoute,
    failedRunRetentionDays: mc.failedRunRetentionDays,
    retryCount: mc.retryCount,
    routeTimeoutMs: mc.routeTimeoutMs,
    queuePollIntervalMs: mc.queuePollIntervalMs,
    logLevel: mc.logLevel,
    playwrightHeadless: mc.playwrightHeadless,
    figmaConfigured: mc.figmaConfigured,
    pilotContractSigned: isPilotContractSigned(),
  });
});

// ===========================================================================
// Pilot Contract
// ===========================================================================

// GET /api/pilot-contract
router.get('/pilot-contract', (_req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const contract = db.prepare("SELECT * FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  if (!contract) {
    return res.status(404).json(createErrorResponse('No pilot contract exists yet', 'NOT_FOUND', _req.requestId));
  }
  
  res.json(formatContract(contract));
});

// POST /api/pilot-contract
router.post('/pilot-contract', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const body = req.body || {};
  const existing = db.prepare("SELECT * FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  
  if (existing && existing.cosignedAt) {
    // Already signed — cannot update
    return res.status(409).json(createErrorResponse(
      `Pilot contract already co-signed at ${existing.cosignedAt}`,
      'ALREADY_COSIGNED',
      req.requestId
    ));
  }
  
  const now = new Date().toISOString();
  const id = uuidv4();
  
  // Validate required fields
  const input = {
    id,
    operator: body.operatorName || '',
    environment: body.environment || 'dev',
    routeList: JSON.stringify(body.routeList || []),
    reviewBudgetMinutes: body.reviewBudgetMinutes || 30,
    maxCandidates: body.maxCandidates || 50,
    reviewMode: body.reviewMode || 'component-cluster',
    definitionOfInsight: JSON.stringify(body.definitionOfInsight || []),
    phase0DoD: JSON.stringify(body.phase0DoD || []),
    pilotDoD: JSON.stringify(body.pilotDoD || []),
    topN: body.topN || 30,
    cosignedAt: null,
    cosignedBy: null,
    createdAt: now,
    version: 1,
  };
  
  db.prepare(`
    INSERT INTO pilot_contracts (id, operator, environment, routeList, reviewBudgetMinutes, maxCandidates, reviewMode, definitionOfInsight, phase0DoD, pilotDoD, topN, cosignedAt, cosignedBy, createdAt, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.id, input.operator, input.environment, input.routeList, input.reviewBudgetMinutes, input.maxCandidates, input.reviewMode, input.definitionOfInsight, input.phase0DoD, input.pilotDoD, input.topN, input.cosignedAt, input.cosignedBy, input.createdAt, input.version);
  
  res.json({ status: 'draft', id });
});

// POST /api/pilot-contract/co-sign
router.post('/pilot-contract/co-sign', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const contract = db.prepare("SELECT * FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  if (!contract) {
    return res.status(400).json(createErrorResponse('No pilot contract exists', 'VALIDATION_ERROR', req.requestId));
  }
  
  if (contract.cosignedAt) {
    return res.status(409).json(createErrorResponse(
      `Pilot contract already co-signed at ${contract.cosignedAt}`,
      'ALREADY_COSIGNED',
      req.requestId
    ));
  }
  
  const body = req.body || {};
  const operatorName = body.operatorName || '';
  const operatorRole = body.operatorRole || '';
  
  if (!operatorName || !operatorRole) {
    return res.status(400).json(createErrorResponse('operatorName and operatorRole are required', 'VALIDATION_ERROR', req.requestId));
  }
  
  // Validate contract fields
  const validationErr = validatePilotContractForCosign({
    ...contract,
    operatorName: contract.operator || '',
    operatorRole: contract.environment || '',
    cosignedAt: null,
    cosignedBy: null,
    routeList: safeParse(contract.routeList || '[]'),
    definitionOfInsight: safeParse(contract.definitionOfInsight || '[]'),
    phase0DoD: safeParse(contract.phase0DoD || '[]'),
    pilotDoD: safeParse(contract.pilotDoD || '[]'),
  });
  
  if (validationErr) {
    return res.status(400).json(createErrorResponse(`Cannot co-sign: ${validationErr}`, 'VALIDATION_ERROR', req.requestId));
  }
  
  const now = new Date().toISOString();
  const cosignedBy = `${operatorName} (${operatorRole})`;
  
  db.prepare("UPDATE pilot_contracts SET cosignedAt = ?, cosignedBy = ? WHERE id = ?").run(now, cosignedBy, contract.id);
  
  logger.info({ contractId: contract.id, cosignedBy }, 'Pilot contract co-signed');
  
  res.json({ status: 'signed', cosignedAt: now, cosignedBy });
});

// GET /api/pilot-contract/status
router.get('/pilot-contract/status', (_req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const contract = db.prepare("SELECT * FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  
  res.json({
    signed: !!(contract && contract.cosignedAt),
    cosignedAt: contract?.cosignedAt || null,
    cosignedBy: contract?.cosignedBy || null,
  });
});

// ===========================================================================
// Runs
// ===========================================================================

// GET /api/runs
router.get('/runs', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);
  const status = req.query.status;
  const search = req.query.search;
  
  let sql = "SELECT * FROM runs";
  const params = [];
  const conditions = [];
  
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  
  if (search) {
    conditions.push("(id LIKE ? OR routeList LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  
  sql += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  
  const runs = db.prepare(sql).all(...params);
  
  const totalSql = conditions.length > 0 
    ? "SELECT COUNT(*) as total FROM runs WHERE " + conditions.join(" AND ") 
    : "SELECT COUNT(*) as total FROM runs";
  const total = db.prepare(totalSql).get(...params.slice(0, conditions.length));
  
  res.json({
    runs: runs.map(r => ({
      runId: r.id,
      status: r.status,
      totalRoutes: r.totalRoutes,
      completedRoutes: r.completedRoutes,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      duration: r.completedAt && r.startedAt ? (new Date(r.completedAt) - new Date(r.startedAt)) / 1000 : null,
      error: r.error,
      pinned: !!r.pinned,
    })),
    total: total?.total || runs.length,
    page,
    limit,
  });
});

// POST /api/runs
router.post('/runs', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  // Check pilot contract is signed
  if (!isPilotContractSigned()) {
    return res.status(403).json(createErrorResponse(
      'Phase 1 action requires a co-signed pilot contract',
      'PILOT_CONTRACT_REQUIRED',
      req.requestId,
      null,
      'pilot-contract'
    ));
  }
  
  // Check no run is in progress
  if (queue.isRunInProgress()) {
    return res.status(409).json(createErrorResponse(
      'A run is already in progress. Wait for it to complete or cancel it first.',
      'RUN_IN_PROGRESS',
      req.requestId
    ));
  }
  
  const body = req.body || {};
  const mode = body.mode || 'all';
  const route = body.route || null;
  const roles = body.roles || null;
  
  if (mode === 'route' && !route) {
    return res.status(400).json(createErrorResponse('route is required when mode=route', 'VALIDATION_ERROR', req.requestId));
  }
  
  try {
    const result = queue.createRun(mode, route, roles);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(createErrorResponse(err.message, 'INTERNAL_ERROR', req.requestId));
  }
});

// GET /api/runs/:runId
router.get('/runs/:runId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) {
    return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  }
  
  const processed = safeParse(run.processedRoutes || '[]');
  
  res.json({
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    routeList: safeParse(run.routeList || '[]'),
    roleList: safeParse(run.roleList || '[]'),
    processedRoutes: processed,
    retryCount: run.retryCount,
    totalRoutes: run.totalRoutes,
    completedRoutes: run.completedRoutes,
    pinned: !!run.pinned,
    pilotContractId: run.pilotContractId,
    schemaVersion: run.schemaVersion,
  });
});

// DELETE /api/runs/:runId
router.delete('/runs/:runId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) {
    return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  }
  
  if (run.status === 'running') {
    return res.status(409).json(createErrorResponse(
      'Run is currently running. Cancel it first or wait for completion.',
      'RUN_IN_PROGRESS',
      req.requestId
    ));
  }
  
  const runId = run.id;
  store.deleteRun(runId);
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  
  res.json({ success: true, runId });
});

// POST /api/runs/:runId/start
router.post('/runs/:runId/start', (req, res) => {
  if (config.disableCrawler) {
    return res.status(503).json(createErrorResponse(
      'Crawler is disabled via DISABLE_CRAWLER environment variable',
      'CRAWLER_DISABLED',
      req.requestId
    ));
  }
  try {
    const result = queue.dequeueRun(req.params.runId);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json(createErrorResponse(err.message, 'NOT_FOUND', req.requestId));
    if (err.statusCode === 400) return res.status(400).json(createErrorResponse(err.message, 'INVALID_STATE', req.requestId));
    res.status(500).json(createErrorResponse(err.message, 'INTERNAL_ERROR', req.requestId));
  }
});

// POST /api/runs/:runId/resume
router.post('/runs/:runId/resume', (req, res) => {
  try {
    const result = queue.resumeRun(req.params.runId);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json(createErrorResponse(err.message, 'NOT_FOUND', req.requestId));
    if (err.statusCode === 400) return res.status(400).json(createErrorResponse(err.message, 'INVALID_STATE', req.requestId));
    res.status(500).json(createErrorResponse(err.message, 'INTERNAL_ERROR', req.requestId));
  }
});

// GET /api/runs/:runId/progress
router.get('/runs/:runId/progress', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) {
    return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  }
  
  const progress = run.totalRoutes > 0 ? (run.completedRoutes / run.totalRoutes) * 100 : 0;
  
  res.json({
    runId: run.id,
    status: run.status,
    totalRoutes: run.totalRoutes,
    completedRoutes: run.completedRoutes,
    progress: Math.round(progress * 10) / 10,
    currentStage: run.status === 'running' ? 'collecting' : undefined,
    startedAt: run.startedAt,
    estimatedRemainingSeconds: run.totalRoutes > 0 ? ((run.totalRoutes - run.completedRoutes) * 8) : null,
    errors: [],
  });
});

// GET /api/runs/:runId/status (alias for /progress)
router.get('/runs/:runId/status', (req, res) => {
  // Inline the same logic as /progress to avoid recursion
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  const progress = run.totalRoutes > 0 ? (run.completedRoutes / run.totalRoutes) * 100 : 0;
  res.json({
    runId: run.id, status: run.status, totalRoutes: run.totalRoutes,
    completedRoutes: run.completedRoutes, progress: Math.round(progress * 10) / 10,
    currentStage: run.status === 'running' ? 'collecting' : undefined,
    startedAt: run.startedAt, estimatedRemainingSeconds: run.totalRoutes > 0 ? ((run.totalRoutes - run.completedRoutes) * 8) : null, errors: [],
  });
});

// GET /api/runs/:runId/summary
router.get('/runs/:runId/summary', (req, res) => {
  const summary = reportBuilder.buildRunSummary(req.params.runId);
  if (!summary) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  res.json(summary);
});

// ===========================================================================
// Snapshots
// ===========================================================================

// GET /api/runs/:runId/snapshots
router.get('/runs/:runId/snapshots', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);
  let sql = "SELECT * FROM snapshots WHERE runId = ?";
  const params = [req.params.runId];
  
  if (req.query.role) { sql += " AND role = ?"; params.push(req.query.role); }
  if (req.query.url) { sql += " AND url = ?"; params.push(req.query.url); }
  if (req.query.status) { sql += " AND status = ?"; params.push(req.query.status); }
  
  sql += " ORDER BY capturedAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  
  const snapshots = db.prepare(sql).all(...params);
  
  const countSql = sql.split("LIMIT")[0].replace("SELECT *", "SELECT COUNT(*) as count");
  const total = db.prepare(countSql).get(...params.slice(0, params.length - 2));
  
  res.json({
    snapshots: snapshots.map(s => ({
      id: s.id, runId: s.runId, url: s.url, role: s.role, status: s.status,
      capturedAt: s.capturedAt, nodeCount: s.nodeCount,
      viewportWidth: s.viewportWidth, viewportHeight: s.viewportHeight,
      schemaVersion: s.schemaVersion, error: s.error, isLegacy: !!s.isLegacy,
    })),
    total: total?.count || snapshots.length, page, limit,
  });
});

// GET /api/snapshots/:snapshotId
router.get('/snapshots/:snapshotId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(req.params.snapshotId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const nodes = db.prepare("SELECT * FROM nodes WHERE snapshotId = ?").all(snapshot.id);
  
  res.json({
    id: snapshot.id, runId: snapshot.runId, url: snapshot.url, role: snapshot.role,
    capturedAt: snapshot.capturedAt, schemaVersion: snapshot.schemaVersion,
    extractorVersion: snapshot.extractorVersion, analyzerVersion: snapshot.analyzerVersion,
    status: snapshot.status, nodeCount: snapshot.nodeCount,
    viewport: { width: snapshot.viewportWidth, height: snapshot.viewportHeight, deviceScaleFactor: snapshot.deviceScaleFactor },
    screenshotUrl: `/api/runs/${snapshot.runId}/snapshots/${snapshot.id}/screenshot`,
    nodes: nodes.map(formatNodeSummary),
    error: snapshot.error, isLegacy: !!snapshot.isLegacy, feedback: safeParse(snapshot.feedback),
  });
});

// POST /api/snapshots/:snapshotId/feedback
router.post('/snapshots/:snapshotId/feedback', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(req.params.snapshotId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const body = req.body || {};
  const feedbackId = `fb-${uuidv4().slice(0, 8)}`;
  
  db.prepare(`
    INSERT INTO designer_feedback (id, targetType, targetId, runId, feedbackType, feedbackValue, operatorId, recordedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(feedbackId, body.targetType || 'snapshot', body.targetId || snapshot.id, snapshot.runId, body.feedbackType, JSON.stringify(body.feedbackValue), body.operatorId, new Date().toISOString());
  
  res.status(201).json({ status: 'recorded', feedbackId });
});

// GET /api/runs/:runId/snapshots/:snapshotId/screenshot
router.get('/runs/:runId/snapshots/:snapshotId/screenshot', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ? AND runId = ?").get(req.params.snapshotId, req.params.runId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const screenshotBuffer = store.readScreenshot(snapshot.runId);
  if (!screenshotBuffer) return res.status(404).json(createErrorResponse('Screenshot file not found', 'NOT_FOUND', req.requestId));
  
  // Handle resizing if width param is provided
  const width = parseInt(req.query.w);
  if (width) {
    const sharp = require('sharp');
    sharp(screenshotBuffer)
      .resize(Math.min(width, 4096), null, { fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer()
      .then(buf => {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('ETag', `"${snapshot.id}-w${width}"`);
        res.send(buf);
      })
      .catch(() => sendScreenshotRaw(res, screenshotBuffer, snapshot));
  } else {
    sendScreenshotRaw(res, screenshotBuffer, snapshot);
  }
});

function sendScreenshotRaw(res, buffer, snapshot) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('ETag', `"${snapshot.id}"`);
  // Check if-none-match
  if (res.req.headers['if-none-match'] === `"${snapshot.id}"`) return res.status(304).end();
  res.send(buffer);
}

// ===========================================================================
// Nodes
// ===========================================================================

// GET /api/snapshots/:snapshotId/nodes
router.get('/snapshots/:snapshotId/nodes', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT id FROM snapshots WHERE id = ?").get(req.params.snapshotId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);
  let sql = "SELECT * FROM nodes WHERE snapshotId = ?";
  const params = [req.params.snapshotId];
  
  if (req.query.domTag) { sql += " AND domTag = ?"; params.push(req.query.domTag); }
  if (req.query.classificationType) {
    // Classification type is embedded in JSON — match via classList / classification
    sql += " AND classification LIKE ?";
    params.push(`%"type":"${req.query.classificationType}"%`);
  }
  
  sql += " ORDER BY rectY ASC, rectX ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  
  const nodes = db.prepare(sql).all(...params);
  
  const countSql = "SELECT COUNT(*) as count FROM nodes WHERE snapshotId = ?";
  const total = db.prepare(countSql).get(req.params.snapshotId);
  
  res.json({
    nodes: nodes.map(formatNodeSummary),
    total: total?.count || nodes.length,
    page, limit,
  });
});

// GET /api/nodes/:nodeId
router.get('/nodes/:nodeId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const node = db.prepare("SELECT * FROM nodes WHERE id = ?").get(req.params.nodeId);
  if (!node) return res.status(404).json(createErrorResponse('Node not found', 'NOT_FOUND', req.requestId));
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(node.snapshotId);
  
  res.json({
    id: node.id, snapshotId: node.snapshotId,
    nodeIdentifier: node.nodeIdentifier,
    identity: safeParse(node.identity || '{}'),
    classification: safeParse(node.classification || '{}'),
    rectX: node.rectX, rectY: node.rectY, rectW: node.rectW, rectH: node.rectH,
    computedStyles: safeParse(node.computedStyles || '{}'),
    driftScore: node.driftScore,
    cropUrl: node.cropPath ? `/api/snapshots/${node.snapshotId}/crops/${node.id}` : null,
    thumbnailUrl: node.cropPath ? `/api/snapshots/${node.snapshotId}/thumbnails/${node.id}` : null,
    visualHash: node.visualHash, domTag: node.domTag,
    classList: safeParse(node.classList || '[]'),
    extractedAt: node.extractedAt,
  });
});

// GET /api/snapshots/:snapshotId/crops/:nodeId
router.get('/snapshots/:snapshotId/crops/:nodeId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(req.params.snapshotId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const node = db.prepare("SELECT * FROM nodes WHERE id = ? AND snapshotId = ?").get(req.params.nodeId, req.params.snapshotId);
  if (!node) return res.status(404).json(createErrorResponse('Node not found', 'NOT_FOUND', req.requestId));
  
  const cropBuffer = store.readCrop(snapshot.runId, node.id);
  if (!cropBuffer) return res.status(404).json(createErrorResponse('Crop not found', 'NOT_FOUND', req.requestId));
  
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(cropBuffer);
});

// GET /api/snapshots/:snapshotId/thumbnails/:nodeId
router.get('/snapshots/:snapshotId/thumbnails/:nodeId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(req.params.snapshotId);
  if (!snapshot) return res.status(404).json(createErrorResponse('Snapshot not found', 'NOT_FOUND', req.requestId));
  
  const node = db.prepare("SELECT * FROM nodes WHERE id = ? AND snapshotId = ?").get(req.params.nodeId, req.params.snapshotId);
  if (!node) return res.status(404).json(createErrorResponse('Node not found', 'NOT_FOUND', req.requestId));
  
  const thumbBuffer = store.readThumbnail(snapshot.runId, node.id);
  if (!thumbBuffer) return res.status(404).json(createErrorResponse('Thumbnail not found', 'NOT_FOUND', req.requestId));
  
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(thumbBuffer);
});

// ===========================================================================
// Clusters
// ===========================================================================

// GET /api/runs/:runId/clusters
router.get('/runs/:runId/clusters', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);
  let sql = "SELECT * FROM clusters WHERE runId = ?";
  const params = [req.params.runId];
  
  if (req.query.driftClassification) { sql += " AND driftClassification = ?"; params.push(req.query.driftClassification); }
  if (req.query.approvalStatus) { sql += " AND approvalStatus = ?"; params.push(req.query.approvalStatus); }
  
  const sortBy = ['priorityScore', 'usageCount', 'driftScore', 'name'].includes(req.query.sortBy) ? req.query.sortBy : 'priorityScore';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  
  sql += ` ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const clusters = db.prepare(sql).all(...params);
  const total = db.prepare("SELECT COUNT(*) as count FROM clusters WHERE runId = ?").get(req.params.runId);
  
  res.json({
    clusters: clusters.map(c => formatClusterDetail(c)),
    total: total?.count || clusters.length,
    page, limit,
  });
});

// GET /api/clusters/:clusterId
router.get('/clusters/:clusterId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(req.params.clusterId);
  if (!cluster) return res.status(404).json(createErrorResponse('Cluster not found', 'NOT_FOUND', req.requestId));
  
  res.json(formatClusterDetail(cluster));
});

// PATCH /api/clusters/:clusterId
router.patch('/clusters/:clusterId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(req.params.clusterId);
  if (!cluster) return res.status(404).json(createErrorResponse('Cluster not found', 'NOT_FOUND', req.requestId));
  
  if (cluster.approvalStatus !== 'pending') {
    return res.status(409).json(createErrorResponse('Cluster has already been reviewed', 'ALREADY_REVIEWED', req.requestId));
  }
  
  const body = req.body || {};
  const action = body.action;
  if (!['approve', 'reject', 'defer'].includes(action)) {
    return res.status(400).json(createErrorResponse('action must be approve, reject, or defer', 'VALIDATION_ERROR', req.requestId));
  }
  
  const now = new Date().toISOString();
  
  db.prepare("UPDATE clusters SET approvalStatus = ?, approvalNote = ?, approvedAt = ? WHERE id = ?").run(
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'deferred',
    body.note || null, action === 'approve' ? now : null, cluster.id
  );
  
  // Also update findings status
  db.prepare("UPDATE findings SET status = ? WHERE clusterId = ?").run(
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending', cluster.id
  );
  
  res.json({
    clusterId: cluster.id,
    approvalStatus: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'deferred',
    updatedAt: now,
  });
});

// POST /api/runs/:runId/clusters/batch-review
router.post('/runs/:runId/clusters/batch-review', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  const body = req.body || {};
  const { clusterIds, action, note } = body;
  
  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    return res.status(400).json(createErrorResponse('clusterIds must be a non-empty array', 'VALIDATION_ERROR', req.requestId));
  }
  
  if (!['approve', 'reject', 'defer'].includes(action)) {
    return res.status(400).json(createErrorResponse('action must be approve, reject, or defer', 'VALIDATION_ERROR', req.requestId));
  }
  
  const results = [];
  for (const cid of clusterIds) {
    try {
      const cluster = db.prepare("SELECT * FROM clusters WHERE id = ? AND runId = ?").get(cid, req.params.runId);
      if (!cluster) { results.push({ clusterId: cid, success: false, error: 'Cluster not found' }); continue; }
      
      db.prepare("UPDATE clusters SET approvalStatus = ?, approvalNote = ? WHERE id = ?").run(
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'deferred',
        note || null, cid
      );
      db.prepare("UPDATE findings SET status = ? WHERE clusterId = ?").run(
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending', cid
      );
      results.push({ clusterId: cid, success: true, error: null });
    } catch (e) {
      results.push({ clusterId: cid, success: false, error: e.message });
    }
  }
  
  res.json({ results, totalProcessed: results.length, totalErrors: results.filter(r => !r.success).length });
});

// ===========================================================================
// Findings
// ===========================================================================

// GET /api/runs/:runId/findings
router.get('/runs/:runId/findings', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  const topN = parseInt(req.query.topN);
  let sql, params;
  
  if (topN && topN > 0 && topN <= 200) {
    sql = `
      SELECT f.*, c.name as clusterName, c.usageCount, c.driftScore, c.driftClassification, c.confidenceAvg
      FROM findings f
      JOIN clusters c ON f.clusterId = c.id
      WHERE f.runId = ?
      ORDER BY f.priorityScore DESC LIMIT ?
    `;
    params = [req.params.runId, topN];
  } else {
    const { page, limit, offset } = paginate(req.query.page, req.query.limit);
    sql = `
      SELECT f.*, c.name as clusterName, c.usageCount, c.driftScore, c.driftClassification, c.confidenceAvg
      FROM findings f
      JOIN clusters c ON f.clusterId = c.id
      WHERE f.runId = ?
      ORDER BY f.priorityScore DESC LIMIT ? OFFSET ?
    `;
    params = [req.params.runId, limit, offset];
  }
  
  const findings = db.prepare(sql).all(...params);
  
  res.json({
    findings: findings.map(f => ({
      findingId: f.id, clusterId: f.clusterId, clusterName: f.clusterName,
      priorityScore: f.priorityScore, rank: f.rank,
      usageCount: f.usageCount, driftScore: f.driftScore,
      driftClassification: f.driftClassification,
      representativeCrop: f.clusterId ? `/api/clusters/${f.clusterId}` : null,
      screens: [], roles: [],
      status: f.status, confidenceAvg: f.confidenceAvg,
    })),
    total: findings.length, page: 1, limit: findings.length, topN: topN || null,
  });
});

// GET /api/runs/:runId/findings/:findingId
router.get('/runs/:runId/findings/:findingId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const finding = db.prepare(`
    SELECT f.*, c.name as clusterName, c.usageCount, c.driftScore, c.driftClassification, c.confidenceMin, c.confidenceMax, c.confidenceAvg
    FROM findings f
    JOIN clusters c ON f.clusterId = c.id
    WHERE f.id = ? AND f.runId = ?
  `).get(req.params.findingId, req.params.runId);
  
  if (!finding) return res.status(404).json(createErrorResponse('Finding not found', 'NOT_FOUND', req.requestId));
  
  res.json({
    findingId: finding.id, clusterId: finding.clusterId, clusterName: finding.clusterName,
    priorityScore: finding.priorityScore, rank: finding.rank,
    usageCount: finding.usageCount, driftScore: finding.driftScore,
    driftClassification: finding.driftClassification,
    representativeCrop: finding.clusterId ? `/api/clusters/${finding.clusterId}` : null,
    screens: [], roles: [], status: finding.status,
    identity: {}, classification: {},
    evidence: [],
    confidenceDistribution: { min: finding.confidenceMin, max: finding.confidenceMax, avg: finding.confidenceAvg },
    designerFeedback: finding.designerFeedback,
    feedbackAt: finding.feedbackAt,
  });
});

// PATCH /api/findings/:findingId
router.patch('/findings/:findingId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const finding = db.prepare("SELECT * FROM findings WHERE id = ?").get(req.params.findingId);
  if (!finding) return res.status(404).json(createErrorResponse('Finding not found', 'NOT_FOUND', req.requestId));
  
  const body = req.body || {};
  const feedback = body.feedback || null;
  const note = body.note || null;
  const now = new Date().toISOString();
  
  db.prepare("UPDATE findings SET status = 'reviewed', designerFeedback = ?, feedbackAt = ? WHERE id = ?").run(
    JSON.stringify({ feedback, note }), now, finding.id
  );
  
  res.json({ findingId: finding.id, status: 'reviewed', feedbackAt: now });
});

// ===========================================================================
// Approve Queue
// ===========================================================================

// GET /api/runs/:runId/approve-queue
router.get('/runs/:runId/approve-queue', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  if (!run) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  const clusters = db.prepare("SELECT * FROM clusters WHERE runId = ? ORDER BY priorityScore DESC").all(req.params.runId);
  const pending = [], approved = [], rejected = [], deferred = [];
  
  for (const c of clusters) {
    const item = {
      id: c.id, type: 'component', name: c.name, clusterId: c.id,
      priorityScore: c.priorityScore || 0,
      cropPath: c.representativeNodeId ? `/api/nodes/${c.representativeNodeId}` : null,
      submittedAt: c.priorityScore ? new Date().toISOString() : null, note: c.approvalNote,
    };
    
    switch (c.approvalStatus) {
      case 'approved': approved.push(item); break;
      case 'rejected': rejected.push(item); break;
      case 'deferred': deferred.push(item); break;
      default: pending.push(item); break;
    }
  }
  
  res.json({
    pending, approved, rejected, deferred,
    figmaLicenseConfirmed: config.figmaConfigured,
    total: clusters.length,
  });
});

// ===========================================================================
// Reports
// ===========================================================================

router.get('/runs/:runId/reports/signal-reliability', (req, res) => {
  const report = reportBuilder.buildSignalReliabilityReport(req.params.runId);
  res.json(report);
});

router.get('/runs/:runId/reports/token-inventory', (req, res) => {
  const report = reportBuilder.buildTokenReport(req.params.runId);
  res.json(report);
});

router.get('/runs/:runId/reports/components', (req, res) => {
  const report = reportBuilder.buildComponentReport(req.params.runId);
  res.json(report);
});

router.get('/runs/:runId/reports/drift', (req, res) => {
  const report = reportBuilder.buildDriftReport(req.params.runId);
  res.json(report);
});

// ===========================================================================
// Delta
// ===========================================================================

router.get('/runs/:runId/delta', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const baselineRunId = req.query.baselineRunId;
  if (!baselineRunId) {
    return res.status(400).json(createErrorResponse('baselineRunId query parameter is required', 'VALIDATION_ERROR', req.requestId));
  }
  
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(req.params.runId);
  const prevRun = db.prepare("SELECT id FROM runs WHERE id = ?").get(baselineRunId);
  if (!run || !prevRun) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  
  // Simplified delta — in production, full comparison across entities
  res.json({
    runId: req.params.runId,
    previousRunId: baselineRunId,
    comparedAt: new Date().toISOString(),
    categories: { newComponents: [], missingComponents: [], tokenChanges: [], driftScoreChanges: [] },
    changelog: [],
  });
});

// ===========================================================================
// Token Sync (Phase 5)
// ===========================================================================

router.post('/runs/:runId/sync/figma', async (req, res) => {
  try {
    const result = await tokenSync.syncToFigma(req.params.runId);
    res.status(202).json(result);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json(createErrorResponse(err.message, err.code, req.requestId));
    res.status(500).json(createErrorResponse(err.message, 'INTERNAL_ERROR', req.requestId));
  }
});

router.post('/runs/:runId/sync/export', (req, res) => {
  try {
    const body = req.body || {};
    const format = body.format || 'w3c-tokens';
    const data = tokenSync.exportTokens(req.params.runId, format);
    res.json(data);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json(createErrorResponse(err.message, err.code, req.requestId));
    res.status(500).json(createErrorResponse(err.message, 'INTERNAL_ERROR', req.requestId));
  }
});

router.get('/sync/status', (req, res) => {
  res.json({
    syncActive: false,
    lastSyncAt: null,
    lastSyncResult: null,
    figmaConfigured: config.figmaConfigured,
    figmaFileKey: config.figmaConfigured ? config.figmaFileKey : null,
    pendingTokenCount: 0,
  });
});

router.get('/sync/log', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);
  let sql = "SELECT * FROM figma_sync_log WHERE 1=1";
  const params = [];
  
  if (req.query.runId) { sql += " AND runId = ?"; params.push(req.query.runId); }
  if (req.query.status) { sql += " AND status = ?"; params.push(req.query.status); }
  
  sql += " ORDER BY syncedAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  
  const entries = db.prepare(sql).all(...params);
  
  res.json({ entries, total: entries.length, page, limit });
});

// ===========================================================================
// Governance: Releases (Phase 6)
// ===========================================================================

router.get('/releases', (_req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const releases = db.prepare("SELECT * FROM releases ORDER BY createdAt DESC").all();
  res.json({ releases: releases.map(formatRelease), total: releases.length });
});

router.get('/releases/:releaseId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const release = db.prepare("SELECT * FROM releases WHERE id = ?").get(req.params.releaseId);
  if (!release) return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  
  res.json(formatRelease(release));
});

router.post('/releases', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const body = req.body || {};
  const version = body.version;
  if (!version) return res.status(400).json(createErrorResponse('version is required', 'VALIDATION_ERROR', req.requestId));
  
  const existing = db.prepare("SELECT id FROM releases WHERE version = ?").get(version);
  if (existing) {
    return res.status(409).json(createErrorResponse(`Release version ${version} already exists`, 'VERSION_CONFLICT', req.requestId));
  }
  
  const now = new Date().toISOString();
  const id = `rel-${uuidv4().slice(0, 8)}`;
  
  db.prepare(`
    INSERT INTO releases (id, version, versionScheme, state, createdAt, carrierForward, description)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, version, body.versionScheme || 'semantic', now, body.carrierForward ? 1 : 0, body.description || null);
  
  res.status(201).json(formatRelease(db.prepare("SELECT * FROM releases WHERE id = ?").get(id)));
});

router.post('/releases/:releaseId/transition', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const release = db.prepare("SELECT * FROM releases WHERE id = ?").get(req.params.releaseId);
  if (!release) return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  
  if (release.state === 'exported') {
    return res.status(409).json(createErrorResponse("Release is already in 'exported' state and cannot be modified", 'IMMUTABLE_RELEASE', req.requestId));
  }
  
  const body = req.body || {};
  const newState = body.newState;
  if (!newState) return res.status(400).json(createErrorResponse('newState is required', 'VALIDATION_ERROR', req.requestId));
  
  const VALID_TRANSITIONS = {
    'draft': ['reviewed'],
    'reviewed': ['approved'],
    'approved': ['versioned'],
    'versioned': ['exported'],
  };
  
  if (!VALID_TRANSITIONS[release.state]?.includes(newState)) {
    return res.status(400).json(createErrorResponse(
      `Cannot transition from '${release.state}' to '${newState}'. Must go through intermediate states.`,
      'INVALID_TRANSITION', req.requestId
    ));
  }
  
  const now = new Date().toISOString();
  db.prepare("UPDATE releases SET state = ?, exportedAt = ? WHERE id = ?").run(newState, newState === 'exported' ? now : null, release.id);
  
  // Log audit
  const auditId = `galog-${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO governance_audit_log (id, releaseId, previousState, newState, operatorId, notes, transitionedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(auditId, release.id, release.state, newState, 'operator', body.notes || null, now);
  
  res.json({ releaseId: release.id, previousState: release.state, newState, transitionedAt: now });
});

// ===========================================================================
// Governance: Review Rules (Phase 6)
// ===========================================================================

router.get('/review-rules', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  let sql = "SELECT * FROM review_rules WHERE 1=1";
  const params = [];
  
  if (req.query.releaseId) { sql += " AND releaseId = ?"; params.push(req.query.releaseId); }
  if (req.query.type) { sql += " AND type = ?"; params.push(req.query.type); }
  
  const rules = db.prepare(sql).all(...params);
  res.json({ rules: rules.map(formatReviewRule), total: rules.length });
});

router.get('/review-rules/:ruleId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const rule = db.prepare("SELECT * FROM review_rules WHERE id = ?").get(req.params.ruleId);
  if (!rule) return res.status(404).json(createErrorResponse('Review rule not found', 'NOT_FOUND', req.requestId));
  
  res.json(formatReviewRule(rule));
});

router.post('/review-rules', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const body = req.body || {};
  if (!body.type) return res.status(400).json(createErrorResponse('type is required', 'VALIDATION_ERROR', req.requestId));
  
  const now = new Date().toISOString();
  const id = `rule-${uuidv4().slice(0, 8)}`;
  
  db.prepare(`
    INSERT INTO review_rules (id, releaseId, type, criteriaComponentName, criteriaComponentType, criteriaScreen, criteriaRegex, description, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.releaseId || null, body.type, body.criteriaComponentName || null, body.criteriaComponentType || null, body.criteriaScreen || null, body.criteriaRegex || null, body.description || null, now);
  
  res.status(201).json(formatReviewRule(db.prepare("SELECT * FROM review_rules WHERE id = ?").get(id)));
});

router.put('/review-rules/:ruleId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const rule = db.prepare("SELECT * FROM review_rules WHERE id = ?").get(req.params.ruleId);
  if (!rule) return res.status(404).json(createErrorResponse('Review rule not found', 'NOT_FOUND', req.requestId));
  
  const body = req.body || {};
  db.prepare(`
    UPDATE review_rules SET type = COALESCE(?, type), criteriaComponentName = ?, criteriaComponentType = ?, criteriaScreen = ?, criteriaRegex = ?, description = COALESCE(?, description)
    WHERE id = ?
  `).run(body.type || rule.type, body.criteriaComponentName ?? rule.criteriaComponentName, body.criteriaComponentType ?? rule.criteriaComponentType, body.criteriaScreen ?? rule.criteriaScreen, body.criteriaRegex ?? rule.criteriaRegex, body.description ?? rule.description, rule.id);
  
  res.json(formatReviewRule(db.prepare("SELECT * FROM review_rules WHERE id = ?").get(rule.id)));
});

router.delete('/review-rules/:ruleId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;
  
  const rule = db.prepare("SELECT * FROM review_rules WHERE id = ?").get(req.params.ruleId);
  if (!rule) return res.status(404).json(createErrorResponse('Review rule not found', 'NOT_FOUND', req.requestId));
  
  db.prepare("DELETE FROM review_rules WHERE id = ?").run(rule.id);
  res.json({ success: true });
});

// ===========================================================================
// Helpers
// ===========================================================================

function isPilotContractSigned() {
  const db = getDbSafe();
  if (!db) return false;
  const contract = db.prepare("SELECT cosignedAt FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  return !!(contract && contract.cosignedAt);
}

function formatContract(contract) {
  return {
    id: contract.id,
    operatorName: contract.operator || '',
    operatorRole: '',
    environment: contract.environment,
    routeList: safeParse(contract.routeList || '[]'),
    reviewBudgetMinutes: contract.reviewBudgetMinutes,
    maxCandidates: contract.maxCandidates,
    reviewMode: contract.reviewMode,
    definitionOfInsight: safeParse(contract.definitionOfInsight || '[]'),
    phase0DoD: safeParse(contract.phase0DoD || '[]'),
    pilotDoD: safeParse(contract.pilotDoD || '[]'),
    topN: contract.topN,
    cosignedAt: contract.cosignedAt,
    cosignedBy: contract.cosignedBy,
    createdAt: contract.createdAt,
    version: contract.version,
  };
}

function formatNodeSummary(node) {
  const identity = safeParse(node.identity || '{}');
  const classification = safeParse(node.classification || '{}');
  return {
    id: node.id,
    nodeIdentifier: node.nodeIdentifier,
    domTag: node.domTag,
    classList: safeParse(node.classList || '[]'),
    identity: identity.name ? identity : { name: null, source: 'heuristic', confidence: 0 },
    classification: classification.type ? classification : { type: 'unknown', source: 'heuristic', confidence: 0 },
    rectX: node.rectX, rectY: node.rectY, rectW: node.rectW, rectH: node.rectH,
    thumbnailUrl: node.cropPath ? `/api/snapshots/${node.snapshotId}/thumbnails/${node.id}` : null,
    cropUrl: node.cropPath ? `/api/snapshots/${node.snapshotId}/crops/${node.id}` : null,
    driftScore: node.driftScore,
    confidence: classification.confidence || identity.confidence || 0,
  };
}

function formatClusterDetail(cluster) {
  const screens = safeParse(cluster.screens || '[]');
  const memberRows = cluster.id ? (() => {
    try {
      const db = getDbSafe();
      if (!db) return [];
      return db.prepare(`
        SELECT n.* FROM nodes n
        JOIN cluster_members cm ON n.id = cm.nodeId
        WHERE cm.clusterId = ?
        LIMIT 50
      `).all(cluster.id).map(formatNodeSummary);
    } catch { return []; }
  })() : [];
  
  return {
    clusterId: cluster.id,
    name: cluster.name,
    usageCount: cluster.usageCount,
    driftScore: cluster.driftScore,
    driftClassification: cluster.driftClassification,
    driftedProperties: safeParse(cluster.driftedProperties || '[]'),
    priorityScore: cluster.priorityScore,
    approvalStatus: cluster.approvalStatus,
    approvalNote: cluster.approvalNote,
    approvedAt: cluster.approvedAt,
    representativeNodeId: cluster.representativeNodeId,
    representativeCrop: cluster.representativeNodeId ? `/api/nodes/${cluster.representativeNodeId}` : null,
    confidenceDistribution: { min: cluster.confidenceMin, max: cluster.confidenceMax, avg: cluster.confidenceAvg },
    screens,
    memberNodes,
    evidenceCitations: safeParse(cluster.evidenceCitations || '[]'),
  };
}

function formatRelease(release) {
  const db = getDbSafe();
  const rules = db ? db.prepare("SELECT * FROM review_rules WHERE releaseId = ?").all(release.id).map(formatReviewRule) : [];
  const audit = db ? db.prepare("SELECT * FROM governance_audit_log WHERE releaseId = ? ORDER BY transitionedAt DESC").all(release.id) : [];
  
  return {
    id: release.id, version: release.version, versionScheme: release.versionScheme,
    state: release.state, createdAt: release.createdAt, exportedAt: release.exportedAt,
    carrierForward: !!release.carrierForward, description: release.description,
    rules, auditHistory: audit,
  };
}

function formatReviewRule(rule) {
  return {
    id: rule.id, releaseId: rule.releaseId, type: rule.type,
    criteriaComponentName: rule.criteriaComponentName,
    criteriaComponentType: rule.criteriaComponentType,
    criteriaScreen: rule.criteriaScreen,
    criteriaRegex: rule.criteriaRegex,
    description: rule.description,
    createdAt: rule.createdAt,
  };
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = router;