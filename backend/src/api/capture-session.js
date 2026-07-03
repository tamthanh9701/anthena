'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const config = require('../config');
const { createErrorResponse } = require('../utils/helpers');
const { analyzeSession } = require('../analyzer/analyze-session');

// ── Multer: store in temp then move after validation ──────────────────────


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
    files: 3, // metadata + screenshot + snapshot
  },
});

// ── Shared helpers ─────────────────────────────────────────────────────────

function getDbSafe() {
  try { return getDb(); } catch { return null; }
}

function dbCheckRes(res, db) {
  if (!db) return res.status(503).json(createErrorResponse('Database not available', 'SERVICE_UNAVAILABLE', res.req?.requestId));
  return true;
}

function nowISO() {
  return new Date().toISOString();
}

function randomBytes(n) {
  return crypto.randomBytes(n).toString('hex');
}

/**
 * Generate session ID: cs_YYYYMMDD_{random6}
 */
function generateSessionId() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = randomBytes(3); // 6 hex chars
  return `cs_${y}${m}${d}_${suffix}`;
}

/**
 * Generate upload token: cap_upload_{random32}
 */
function generateUploadToken() {
  const suffix = randomBytes(16); // 32 hex chars
  return `cap_upload_${suffix}`;
}

/**
 * SHA-256 hash
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Generate capture ID: cap_{random8}
 */
function generateCaptureId() {
  return `cap_${randomBytes(4)}`; // 8 hex chars
}

/**
 * Validate metadata fields required for page capture
 */
function validatePageMetadata(metadata) {
  const errors = [];
  if (!metadata.routeKey) errors.push('routeKey is required');
  if (!metadata.url) errors.push('url is required');
  if (!metadata.title) errors.push('title is required');
  if (!metadata.viewport) errors.push('viewport is required');
  if (metadata.viewport && (!metadata.viewport.width || !metadata.viewport.height)) {
    errors.push('viewport must include width and height');
  }
  return errors.length > 0 ? errors : null;
}

/**
 * Resolve auth: check admin token first, then upload token.
 * Sets req.auth = { type: 'admin' | 'upload', sessionId, tokenId }
 */
function resolveAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json(createErrorResponse(
      'Authorization header required', 'UNAUTHORIZED', req.requestId
    ));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json(createErrorResponse(
      'Malformed Authorization header, expected: Bearer <token>', 'UNAUTHORIZED', req.requestId
    ));
  }

  const token = parts[1];

  // Check admin API token first
  if (config.apiToken && token === config.apiToken) {
    req.auth = { type: 'admin' };
    return next();
  }

  // Check upload token (starts with cap_upload_)
  if (token.startsWith('cap_upload_')) {
    const db = getDbSafe();
    if (!db) return res.status(503).json(createErrorResponse('Database not available', 'SERVICE_UNAVAILABLE', req.requestId));

    const hash = sha256(token);
    const tokenRow = db.prepare(
      "SELECT * FROM upload_tokens WHERE tokenHash = ?"
    ).get(hash);

    if (!tokenRow) {
      return res.status(401).json(createErrorResponse(
        'Invalid upload token', 'INVALID_TOKEN', req.requestId
      ));
    }

    // Check expiry
    const now = new Date();
    if (new Date(tokenRow.expiresAt) <= now) {
      return res.status(401).json(createErrorResponse(
        'Upload token expired', 'TOKEN_EXPIRED', req.requestId
      ));
    }

    // Check revoked
    if (tokenRow.revokedAt) {
      return res.status(403).json(createErrorResponse(
        'Upload token revoked', 'TOKEN_REVOKED', req.requestId
      ));
    }

    req.auth = { type: 'upload', sessionId: tokenRow.sessionId, tokenId: tokenRow.id };
    return next();
  }

  return res.status(401).json(createErrorResponse(
    'Invalid authentication token', 'UNAUTHORIZED', req.requestId
  ));
}

// ── All capture-session endpoints require auth ─────────────────────────────

router.use(resolveAuth);

// ===========================================================================
// POST /api/capture-sessions
// Create a new capture session
// ===========================================================================

router.post('/', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  // Only admin can create sessions
  if (req.auth.type !== 'admin') {
    return res.status(403).json(createErrorResponse(
      'Only admin can create capture sessions', 'FORBIDDEN', req.requestId
    ));
  }

  const body = req.body || {};
  const { runId, moduleName, environment } = body;

  if (!runId) {
    return res.status(400).json(createErrorResponse(
      'runId is required', 'VALIDATION_ERROR', req.requestId
    ));
  }

  // Verify run exists
  const run = db.prepare("SELECT id FROM runs WHERE id = ?").get(runId);
  if (!run) {
    return res.status(404).json(createErrorResponse(
      `Run not found: ${runId}`, 'NOT_FOUND', req.requestId
    ));
  }

  const sessionId = generateSessionId();
  const now = nowISO();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  // Create capture session with status='created' then flip to 'active'
  db.prepare(`
    INSERT INTO capture_sessions (id, runId, mode, status, expiresAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, runId, 'extension-direct-upload', 'created', expiresAt, now);

  db.prepare(`
    UPDATE capture_sessions SET status = ? WHERE id = ?
  `).run('active', sessionId);

  // Generate upload token, store hash
  const uploadToken = generateUploadToken();
  const tokenHash = sha256(uploadToken);

  db.prepare(`
    INSERT INTO upload_tokens (id, tokenHash, sessionId, scope, expiresAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`ut_${randomBytes(4)}`, tokenHash, sessionId, 'upload:page', expiresAt, now);

  db.prepare(`
    UPDATE capture_sessions SET uploadTokenHash = ? WHERE id = ?
  `).run(tokenHash, sessionId);

  logger.info({ sessionId, runId, moduleName, environment }, 'Capture session created');

  res.status(201).json({
    sessionId,
    runId,
    uploadToken,
    expiresAt,
    uploadUrl: `/api/capture-sessions/${sessionId}/pages`,
  });
});

// ===========================================================================
// GET /api/capture-sessions/:sessionId
// Get session details + list of page captures
// ===========================================================================

router.get('/:sessionId', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  const { sessionId } = req.params;

  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    return res.status(404).json(createErrorResponse(
      'Capture session not found', 'NOT_FOUND', req.requestId
    ));
  }

  // Auth: upload token must be scoped to this session
  if (req.auth.type === 'upload' && req.auth.sessionId !== sessionId) {
    return res.status(403).json(createErrorResponse(
      'Token not scoped to this session', 'FORBIDDEN', req.requestId
    ));
  }

  const pages = db.prepare(
    "SELECT * FROM page_captures WHERE sessionId = ? ORDER BY capturedAt ASC"
  ).all(sessionId);

  res.json({
    sessionId: session.id,
    runId: session.runId,
    status: session.status,
    mode: session.mode,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    pageCaptures: pages.map(p => ({
      captureId: p.id,
      routeKey: p.routeKey,
      url: p.url,
      title: p.title,
      status: p.status,
      viewport: p.viewportWidth ? { width: p.viewportWidth, height: p.viewportHeight, deviceScaleFactor: p.deviceScaleFactor } : null,
      capturedAt: p.capturedAt,
      uploadStatus: p.uploadStatus,
    })),
  });
});

// ===========================================================================
// POST /api/capture-sessions/:sessionId/pages
// Multipart upload for a page capture
// ===========================================================================

router.post('/:sessionId/pages', upload.fields([
  { name: 'metadata', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 },
  { name: 'snapshot', maxCount: 1 },
]), (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  const { sessionId } = req.params;

  // Auth: upload token must be scoped to this session
  if (req.auth.type === 'upload' && req.auth.sessionId !== sessionId) {
    return res.status(403).json(createErrorResponse(
      'Token not scoped to this session', 'FORBIDDEN', req.requestId
    ));
  }

  // Validate session exists and is active
  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    return res.status(404).json(createErrorResponse(
      'Capture session not found', 'NOT_FOUND', req.requestId
    ));
  }

  if (!['active', 'uploading'].includes(session.status)) {
    return res.status(400).json(createErrorResponse(
      `Session is not active (status: ${session.status})`, 'INVALID_STATE', req.requestId
    ));
  }

  // Parse metadata
  const metaRaw = req.files?.metadata?.[0]?.buffer?.toString('utf-8') || req.body?.metadata;
  if (!metaRaw) {
    return res.status(400).json(createErrorResponse(
      'metadata field is required (JSON string)', 'VALIDATION_ERROR', req.requestId
    ));
  }

  let metadata;
  try {
    metadata = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
  } catch {
    return res.status(400).json(createErrorResponse(
      'metadata must be valid JSON', 'VALIDATION_ERROR', req.requestId
    ));
  }

  const metaErrors = validatePageMetadata(metadata);
  if (metaErrors) {
    return res.status(400).json(createErrorResponse(
      `Invalid metadata: ${metaErrors.join('; ')}`, 'VALIDATION_ERROR', req.requestId
    ));
  }

  // Validate screenshot file
  const screenshotFile = req.files?.screenshot?.[0];
  if (!screenshotFile) {
    return res.status(400).json(createErrorResponse(
      'screenshot file is required (field name: screenshot)', 'VALIDATION_ERROR', req.requestId
    ));
  }

  const allowedMimeTypes = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg'];
  if (!allowedMimeTypes.includes(screenshotFile.mimetype)) {
    return res.status(400).json(createErrorResponse(
      `Invalid screenshot format: ${screenshotFile.mimetype}. Allowed: webp, png, jpg`,
      'VALIDATION_ERROR', req.requestId
    ));
  }

  const captureId = generateCaptureId();
  const now = nowISO();

  // Determine screenshot extension from mimetype
  let screenshotExt = 'webp';
  if (screenshotFile.mimetype === 'image/png') screenshotExt = 'png';
  else if (screenshotFile.mimetype === 'image/jpeg' || screenshotFile.mimetype === 'image/jpg') screenshotExt = 'jpg';

  // Create page_captures row
  db.prepare(`
    INSERT INTO page_captures (id, runId, sessionId, routeKey, url, title, capturedAt, status, viewportWidth, viewportHeight, deviceScaleFactor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    captureId,
    session.runId,
    sessionId,
    metadata.routeKey,
    metadata.url,
    metadata.title,
    now,
    'uploaded',
    metadata.viewport?.width || null,
    metadata.viewport?.height || null,
    metadata.viewport?.deviceScaleFactor || 1.0
  );

  // Set session to uploading on first page upload
  if (session.status === "active") {
    db.prepare("UPDATE capture_sessions SET status = ? WHERE id = ?").run("uploading", sessionId);
  }

  // Store files on disk
  const pageDir = path.join(config.storagePath, 'snapshots', 'runs', session.runId, 'pages', captureId);
  if (!fs.existsSync(pageDir)) {
    fs.mkdirSync(pageDir, { recursive: true });
  }

  const screenshotName = `full.${screenshotExt}`;
  fs.writeFileSync(path.join(pageDir, screenshotName), screenshotFile.buffer);

  // Snapshot (optional gzip JSON)
  const snapshotFile = req.files?.snapshot?.[0];
  if (snapshotFile) {
    fs.writeFileSync(path.join(pageDir, 'snapshot.json.gz'), snapshotFile.buffer);
  }

  // Write metadata JSON
  fs.writeFileSync(
    path.join(pageDir, 'metadata.json'),
    JSON.stringify({
      ...metadata,
      capturedAt: now,
      captureId,
      sessionId,
      extractorVersion: metadata.extractorVersion || config.extractorVersion,
    }, null, 2)
  );

  // Update page_captures with file paths
  db.prepare(`
    UPDATE page_captures SET screenshotPath = ?, snapshotPath = ? WHERE id = ?
  `).run(
    path.join(pageDir, screenshotName),
    snapshotFile ? path.join(pageDir, 'snapshot.json.gz') : null,
    captureId
  );

  logger.info({ captureId, sessionId, routeKey: metadata.routeKey }, 'Page capture uploaded');

  res.status(201).json({
    captureId,
    status: 'uploaded',
  });
});

// ===========================================================================
// POST /api/capture-sessions/:sessionId/complete
// Mark session completed, enqueue analysis
// ===========================================================================

router.post('/:sessionId/complete', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  const { sessionId } = req.params;

  if (req.auth.type !== 'admin') {
    return res.status(403).json(createErrorResponse(
      'Only admin can complete capture sessions', 'FORBIDDEN', req.requestId
    ));
  }

  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    return res.status(404).json(createErrorResponse(
      'Capture session not found', 'NOT_FOUND', req.requestId
    ));
  }

  if (!['active', 'uploading'].includes(session.status)) {
    return res.status(400).json(createErrorResponse(
      `Session cannot be completed (status: ${session.status})`, 'INVALID_STATE', req.requestId
    ));
  }

  // Check all pages are uploaded
  const pendingPages = db.prepare(
    "SELECT id, routeKey FROM page_captures WHERE sessionId = ? AND status != 'uploaded'"
  ).all(sessionId);

  if (pendingPages.length > 0) {
    return res.status(400).json(createErrorResponse(
      'Some page captures are not yet uploaded',
      'PAGES_PENDING',
      req.requestId,
      { pendingCaptures: pendingPages.map(p => ({ captureId: p.id, routeKey: p.routeKey })) }
    ));
  }

  const now = nowISO();

  db.prepare(`
    UPDATE capture_sessions SET status = ?, completedAt = ? WHERE id = ?
  `).run('completed', now, sessionId);

  // Set analyzing status before async analysis
  db.prepare('UPDATE capture_sessions SET status = ? WHERE id = ?').run('analyzing', sessionId);

  logger.info({ sessionId, runId: session.runId }, 'Capture session completed, analysis queued');

  // Enqueue async analysis (non-blocking)
  analyzeSession(sessionId).then(result => {
    logger.info({ sessionId, status: result.status, clusters: result.clusters.length, findings: result.findings.length }, 'Session analysis complete');
        const finalStatus = result.status === 'no_data' ? 'failed' : 'ready_for_review';
    db.prepare('UPDATE capture_sessions SET status = ? WHERE id = ?').run(finalStatus, sessionId);
  }).catch(err => {
    logger.error({ sessionId, err: err.message, stack: err.stack }, 'Session analysis failed');
    db.prepare("UPDATE capture_sessions SET status = 'failed' WHERE id = ?").run(sessionId);
  });

  res.status(202).json({
    message: 'Session completed, analysis queued',
    sessionId,
    runId: session.runId,
    completedAt: now,
  });
});

// ===========================================================================
// POST /api/capture-sessions/:sessionId/cancel
// Cancel active session, revoke all tokens
// ===========================================================================

router.post('/:sessionId/cancel', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  const { sessionId } = req.params;

  if (req.auth.type !== 'admin') {
    return res.status(403).json(createErrorResponse(
      'Only admin can cancel capture sessions', 'FORBIDDEN', req.requestId
    ));
  }

  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    return res.status(404).json(createErrorResponse(
      'Capture session not found', 'NOT_FOUND', req.requestId
    ));
  }

  if (session.status === 'cancelled') {
    return res.status(400).json(createErrorResponse(
      'Session is already cancelled', 'INVALID_STATE', req.requestId
    ));
  }

  const now = nowISO();

  // Revoke all tokens for this session
  db.prepare(`
    UPDATE upload_tokens SET revokedAt = ? WHERE sessionId = ? AND revokedAt IS NULL
  `).run(now, sessionId);

  db.prepare(`
    UPDATE capture_sessions SET status = ?, completedAt = ? WHERE id = ?
  `).run('cancelled', now, sessionId);

  logger.info({ sessionId, runId: session.runId }, 'Capture session cancelled, tokens revoked');

  res.json({
    sessionId,
    status: 'cancelled',
    cancelledAt: now,
  });
});

// ===========================================================================
// POST /api/capture-sessions/:sessionId/retry-page
// Retry a failed page capture
// ===========================================================================

router.post('/:sessionId/retry-page', (req, res) => {
  const db = getDbSafe();
  if (!dbCheckRes(res, db)) return;

  const { sessionId } = req.params;

  if (req.auth.type !== 'admin') {
    return res.status(403).json(createErrorResponse(
      'Only admin can retry page captures', 'FORBIDDEN', req.requestId
    ));
  }

  const session = db.prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId);
  if (!session) {
    return res.status(404).json(createErrorResponse(
      'Capture session not found', 'NOT_FOUND', req.requestId
    ));
  }

  const body = req.body || {};
  const { captureId } = body;

  if (!captureId) {
    return res.status(400).json(createErrorResponse(
      'captureId is required', 'VALIDATION_ERROR', req.requestId
    ));
  }

  const pageCapture = db.prepare(
    "SELECT * FROM page_captures WHERE id = ? AND sessionId = ?"
  ).get(captureId, sessionId);

  if (!pageCapture) {
    return res.status(404).json(createErrorResponse(
      'Page capture not found in this session', 'NOT_FOUND', req.requestId
    ));
  }

  if (pageCapture.status !== 'failed') {
    return res.status(400).json(createErrorResponse(
      `Page capture cannot be retried (status: ${pageCapture.status})`, 'INVALID_STATE', req.requestId
    ));
  }

  // Reset status to 'pending'
  db.prepare(`
    UPDATE page_captures SET status = ? WHERE id = ?
  `).run('pending', captureId);

  // Optionally generate a new upload token
  let newToken = null;
  if (body.generateNewToken) {
    newToken = generateUploadToken();
    const tokenHash = sha256(newToken);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO upload_tokens (id, tokenHash, sessionId, scope, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`ut_${randomBytes(4)}`, tokenHash, sessionId, 'upload:page', expiresAt, nowISO());
  }

  logger.info({ captureId, sessionId, generateNewToken: !!newToken }, 'Page capture reset for retry');

  res.json({
    captureId,
    status: 'pending',
    newUploadToken: newToken || undefined,
  });
});

module.exports = router;
