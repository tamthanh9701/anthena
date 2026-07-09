/**
 * V2 Routes — /api/v2/* Evidence Pipeline
 *
 * Endpoints:
 *   POST /api/v2/evidence          — Upload evidence (idempotent)
 *   GET  /api/v2/evidence          — List evidence
 *   GET  /api/v2/evidence/:id      — Get detail + signal status
 *   GET  /api/v2/evidence/:id/signals — Signal breakdown
 *   POST /api/v2/evidence/:id/reprocess — Re-run processing
 *   GET  /api/v2/clusters          — List clusters
 *   GET  /api/v2/clusters/:id      — Cluster detail
 *   PATCH /api/v2/clusters/batch   — Batch approve clusters
 *   POST /api/v2/releases          — Create release
 *   GET  /api/v2/releases          — List releases
 *   GET  /api/v2/releases/:id      — Release detail
 *   POST /api/v2/releases/:id/approve — Batch approve
 *   POST /api/v2/releases/:id/publish — Publish to (mock) Figma
 *   POST /api/v2/releases/:id/export  — Export tokens
 *   GET  /api/v2/tokens            — Token inventory
 *   GET  /api/v2/tokens/:name      — Token detail
 *   GET  /api/v2/tokens/delta      — Token changes
 */

'use strict';

const express = require('express');
const router = express.Router();
const v1CompatRouter = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const adapters = require('./storage-adapters');
const {
  validateEvidencePackage,
  computeSignalStatus,
  computeTokenInventory,
  computeClusters,
  computeDrift,
} = require('./evidence-package');
const { createErrorResponse, paginate, asyncHandler } = require('../utils/helpers');

// ── Per-request adapter resolution ──────────────────────────────────────────
// Avoids singleton stale-ref problem during test isolation.
// Routes call these helpers which resolve lazily at request time.

function getStore(req) {
  return req.__evidenceStore || adapters.getEvidenceStore();
}

function getDb(req) {
  return req.__metadataDb || adapters.getMetadataDb();
}

function getFigma(req) {
  return req.__figmaPub || adapters.getFigmaPublisher();
}

function fingerprintKey(fingerprint) {
  if (!fingerprint) return null;
  return [fingerprint.tag, fingerprint.classKey, fingerprint.sizeBucket].join('|');
}

function parseJsonField(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function evaluateCustomPromotion(cluster, humanApproval) {
  const screens = parseJsonField(cluster.screens, []);
  const confidenceDistribution = parseJsonField(cluster.confidence_distribution, {});
  const scenarioCount = new Set(
    screens.map(screen => screen.evidencePackageId || screen.evidence_package_id || screen.url)
      .filter(Boolean)
  ).size;
  const instanceCount = Number(cluster.usage_count || 0);
  const confidence = Number(confidenceDistribution.avg || 0);
  const humanApproved = humanApproval?.approved === true
    && typeof humanApproval?.reviewerId === 'string'
    && humanApproval.reviewerId.length > 0;

  const reasons = [];
  if (instanceCount < 3) reasons.push('requires at least 3 observed instances');
  if (scenarioCount < 2) reasons.push('requires observations across at least 2 scenarios');
  if (confidence < 0.8) reasons.push('requires confidence >= 0.8');
  if (!humanApproved) reasons.push('requires explicit human approval with reviewerId');

  return { eligible: reasons.length === 0, instanceCount, scenarioCount, confidence, reasons };
}

async function persistClusters(db, clusters) {
  for (const cluster of clusters) {
    const key = fingerprintKey(cluster.fingerprint);
    const existing = key
      ? (await db.listClusters()).find(candidate => fingerprintKey(candidate.fingerprint) === key)
      : null;

    if (!existing) {
      await db.insertCluster(cluster);
      continue;
    }

    const memberNodeIds = [...new Set([
      ...(existing.member_node_ids || []),
      ...(cluster.member_node_ids || []),
    ])];
    const evidencePackageIds = [...new Set([
      ...(existing.evidence_package_ids || []),
      ...(cluster.evidence_package_ids || []),
    ])];
    const screensByKey = new Map();
    for (const screen of [...(existing.screens || []), ...(cluster.screens || [])]) {
      screensByKey.set(
        `${screen.evidencePackageId || ''}|${screen.url || ''}|${screen.role || ''}`,
        screen
      );
    }
    const usageCount = memberNodeIds.length;
    const driftScore = Math.max(existing.drift_score || 0, cluster.drift_score || 0);

    await db.updateCluster(existing.id, {
      evidence_package_ids: evidencePackageIds,
      member_node_ids: memberNodeIds,
      screens: [...screensByKey.values()],
      usage_count: usageCount,
      drift_classification: cluster.drift_classification || existing.drift_classification,
      drift_score: driftScore,
      priority_score: usageCount * (driftScore || 1),
    });
  }
}

// ── V1 read-only proxy helpers ─────────────────────────────────────────────

function mapV1EvidenceToRun(evidence) {
  return {
    runId: evidence.id,
    status: evidence.status === 'completed' ? 'completed' : evidence.status === 'failed' ? 'failed' : evidence.status === 'received' ? 'pending' : 'running',
    totalRoutes: 1,
    completedRoutes: evidence.status === 'completed' ? 1 : 0,
    createdAt: evidence.created_at,
    completedAt: evidence.processing_completed_at,
  };
}

// ===========================================================================
// POST /api/v2/evidence — Upload (idempotent by captureId)
// ===========================================================================

router.post('/evidence', asyncHandler(async (req, res) => {
  const store = getStore(req);
  const db = getDb(req);

  let rawPackage = req.body;

  // Accept either direct JSON body or JSON under 'package' field
  if (req.body && req.body.package) {
    try {
      rawPackage = typeof req.body.package === 'string' ? JSON.parse(req.body.package) : req.body.package;
    } catch {
      return res.status(400).json(createErrorResponse('Invalid package JSON', 'VALIDATION_ERROR', req.requestId));
    }
  }

  // Capture ID from request or body
  const captureId = req.body?.captureId || rawPackage?.packageId;

  // Check idempotency
  if (captureId) {
    const existing = await db.getEvidenceByCaptureId(captureId);
    if (existing) {
      return res.status(200).json({
        id: existing.id,
        captureId: existing.capture_id,
        status: existing.status,
        existed: true,
        message: 'Evidence package already exists with this captureId',
      });
    }
  }

  // Validate package
  const validation = validateEvidencePackage(rawPackage);
  if (!validation.valid) {
    return res.status(400).json(createErrorResponse(
      `Evidence package validation failed: ${validation.errors.join('; ')}`,
      'VALIDATION_ERROR',
      req.requestId,
      { errors: validation.errors }
    ));
  }

  const pkg = validation.package;
  const evidenceId = `ev-${uuidv4().slice(0, 12)}`;
  const finalCaptureId = captureId || pkg.packageId || evidenceId;

  // Serialize package to buffer for storage
  const pkgBuffer = Buffer.from(JSON.stringify(pkg), 'utf-8');
  const pkgHash = crypto.createHash('sha256').update(pkgBuffer).digest('hex');

  // Store in MinIO adapter
  const storeResult = await store.put(finalCaptureId, pkgBuffer, { hash: pkgHash });

  // Compute signal status
  const { signals, derivedStatus } = computeSignalStatus(pkg);

  // Create evidence metadata row
  const evidenceRow = {
    id: evidenceId,
    capture_id: finalCaptureId,
    manifest_id: pkg.scenario?.manifestId || null,
    url: pkg.url,
    status: derivedStatus === 'failed' ? 'failed' : 'received',
    schema_version: pkg.schemaVersion,
    metadata: JSON.stringify({
      scenario: pkg.scenario,
      viewport: pkg.viewport,
      redaction: pkg.redaction,
    }),
    minio_bucket: 'evidence-pkg',
    minio_package_key: `${finalCaptureId}/package.json`,
    minio_screenshot_key: `${finalCaptureId}/full.webp`,
    package_hash: pkgHash,
    integrity_verified: true,
    captured_at: pkg.capturedAt,
    processing_completed_at: null,
    signal_gaps: JSON.stringify(signals.filter(s => s.status !== 'present').map(s => ({
      signal: s.signal,
      severity: s.severity,
      reason: s.error,
    }))),
    created_at: new Date().toISOString(),
  };

  await db.insertEvidence(evidenceRow);

  // Insert signals
  for (const s of signals) {
    await db.insertSignal({
      id: `sig-${uuidv4().slice(0, 8)}`,
      evidence_package_id: evidenceId,
      signal: s.signal,
      severity: s.severity,
      status: s.status,
      confidence: s.confidence,
      node_count: s.nodeCount,
      capture_evidence_path: s.captureEvidencePath,
      extractor_version: s.extractorVersion,
      error: s.error,
    });
  }

  // Insert nodes
  if (pkg.dom && pkg.dom.nodes) {
    for (const node of pkg.dom.nodes) {
      const cssData = pkg.css?.computed?.[node.nodeId] || null;
      const antdMatches = pkg.antd?.classMatches?.[node.nodeId] || null;
      const fiberData = pkg.fiber?.nodes?.[node.nodeId] || null;
      const a11yData = pkg.a11y?.nodes?.[node.nodeId] || null;

      await db.insertNode({
        id: `nd-${uuidv4().slice(0, 8)}`,
        evidence_package_id: evidenceId,
        node_id: node.nodeId,
        parent_node_id: node.parentId || null,
        tag: node.tag,
        class_list: JSON.stringify(node.classList || []),
        attributes: JSON.stringify(node.attributes || {}),
        rect: JSON.stringify(node.rect || {}),
        text_content: node.textContent || null,
        computed_styles: JSON.stringify(cssData || {}),
        antd_class_matches: JSON.stringify(antdMatches),
        antd_tokens: JSON.stringify(null),
        fiber_identity: JSON.stringify(fiberData || {}),
        a11y_properties: JSON.stringify(a11yData || {}),
        drift_score: null,
        drift_classification: null,
        visual_hash: null,
      });
    }
  }

  // Compute token inventory and clusters (simulated processing)
  const antdDefaults = {};
  const tokenInventory = computeTokenInventory(pkg, antdDefaults);
  for (const [tokenName, tokenData] of tokenInventory) {
    await db.upsertToken(tokenName, tokenData);
  }

  const clusters = computeClusters(pkg, evidenceId);
  for (const cluster of clusters) {
    const driftData = computeDrift(cluster, pkg);
    cluster.drift_classification = driftData.drift_classification;
    cluster.drift_score = driftData.drift_score;
    cluster.drifted_properties = JSON.stringify(driftData.drifted_properties);
    cluster.priority_score = cluster.usage_count * (driftData.drift_score || 1);
    cluster.approval_status = 'pending';
  }
  await persistClusters(db, clusters);

  // Mark evidence as completed
  const finalStatus = derivedStatus === 'failed' ? 'degraded' : 'completed';
  await db.updateEvidenceStatus(evidenceId, finalStatus, {
    processing_completed_at: new Date().toISOString(),
  });

  const statusCode = storeResult.existed ? 200 : 201;

  return res.status(statusCode).json({
    id: evidenceId,
    captureId: finalCaptureId,
    url: pkg.url,
    status: finalStatus,
    schemaVersion: pkg.schemaVersion,
    capturedAt: pkg.capturedAt,
    uploadedAt: evidenceRow.created_at,
    packageHash: pkgHash,
    derivedStatus,
    signalCount: signals.length,
    nodeCount: pkg.dom?.nodes?.length || 0,
    tokenCount: tokenInventory.size,
    clusterCount: clusters.length,
    alreadyExisted: storeResult.existed,
  });
}));

// ===========================================================================
// GET /api/v2/evidence — List
// ===========================================================================

router.get('/evidence', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);

  let evidenceList = await db.listEvidence();

  // Apply filters
  if (req.query.status) {
    evidenceList = evidenceList.filter(e => e.status === req.query.status);
  }
  if (req.query.url) {
    evidenceList = evidenceList.filter(e => e.url === req.query.url);
  }

  const total = evidenceList.length;
  const pageItems = evidenceList.slice(offset, offset + limit);

  res.json({
    evidence: pageItems.map(e => ({
      id: e.id,
      captureId: e.capture_id,
      url: e.url,
      status: e.status,
      schemaVersion: e.schema_version,
      capturedAt: e.captured_at,
      uploadedAt: e.created_at,
      packageHash: e.package_hash,
    })),
    total,
    page,
    limit,
  });
}));

// ===========================================================================
// GET /api/v2/evidence/:id — Detail
// ===========================================================================

router.get('/evidence/:id', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.id);
  if (!evidence) {
    return res.status(404).json(createErrorResponse('Evidence not found', 'NOT_FOUND', req.requestId));
  }

  const signals = await db.getSignalsByEvidence(evidence.id);
  const nodes = await db.getNodesByEvidence(evidence.id);

  const signalGaps = signals
    .filter(s => s.status !== 'present')
    .map(s => ({ signal: s.signal, severity: s.severity, reason: s.error }));

  res.json({
    id: evidence.id,
    captureId: evidence.capture_id,
    url: evidence.url,
    status: evidence.status,
    schemaVersion: evidence.schema_version,
    metadata: parseJsonField(evidence.metadata),
    signalGaps: signalGaps.length > 0 ? signalGaps : null,
    processingCompletedAt: evidence.processing_completed_at,
    capturedAt: evidence.captured_at,
    uploadedAt: evidence.created_at,
    packageHash: evidence.package_hash,
    signalCount: signals.length,
    nodeCount: nodes.length,
  });
}));

// ===========================================================================
// GET /api/v2/evidence/:id/signals — Signal breakdown
// ===========================================================================

router.get('/evidence/:id/signals', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.id);
  if (!evidence) {
    return res.status(404).json(createErrorResponse('Evidence not found', 'NOT_FOUND', req.requestId));
  }

  const signals = await db.getSignalsByEvidence(evidence.id);
  const requiredPresent = signals.filter(s => s.severity === 'required' && s.status === 'present');
  const allRequired = requiredPresent.length === signals.filter(s => s.severity === 'required').length;

  let derivedStatus = 'full';
  if (!allRequired) derivedStatus = 'failed';
  else {
    const strongPresent = signals.filter(s => s.severity === 'strong' && s.status === 'present').length;
    const strongTotal = signals.filter(s => s.severity === 'strong').length;
    if (strongPresent < strongTotal) derivedStatus = 'degraded';
  }

  res.json({
    evidenceId: evidence.id,
    derivedStatus,
    signals: signals.map(s => ({
      signal: s.signal,
      severity: s.severity,
      status: s.status,
      confidence: s.confidence,
      nodeCount: s.node_count,
      captureEvidencePath: s.capture_evidence_path,
      extractorVersion: s.extractor_version,
      error: s.error,
    })),
  });
}));

// ===========================================================================
// POST /api/v2/evidence/:id/reprocess — Re-process evidence
// ===========================================================================

router.post('/evidence/:id/reprocess', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.id);
  if (!evidence) {
    return res.status(404).json(createErrorResponse('Evidence not found', 'NOT_FOUND', req.requestId));
  }

  // Re-process by updating status
  await db.updateEvidenceStatus(evidence.id, 'received', {
    processing_completed_at: null,
  });

  // In a real system, this would enqueue a PgBoss job.
  // For this in-memory implementation, we'll re-do processing immediately.
  const store = getStore(req);
  const pkgBuffer = await store.get(evidence.capture_id);
  if (pkgBuffer) {
    try {
      const pkg = JSON.parse(pkgBuffer.toString('utf-8'));
      const { signals, derivedStatus } = computeSignalStatus(pkg);

      // Re-insert signals
      for (const s of signals) {
        await db.insertSignal({
          id: `sig-${uuidv4().slice(0, 8)}`,
          evidence_package_id: evidence.id,
          signal: s.signal,
          severity: s.severity,
          status: s.status,
          confidence: s.confidence,
          node_count: s.nodeCount,
          capture_evidence_path: s.captureEvidencePath,
          extractor_version: s.extractorVersion,
          error: s.error,
        });
      }

      // Re-compute tokens
      const tokens = computeTokenInventory(pkg);
      for (const [name, data] of tokens) {
        await db.upsertToken(name, data);
      }

      // Re-compute clusters
      const clusters = computeClusters(pkg, evidence.id);
      for (const c of clusters) {
        const drift = computeDrift(c, pkg);
        c.drift_classification = drift.drift_classification;
        c.drift_score = drift.drift_score;
        c.priority_score = c.usage_count * (drift.drift_score || 1);
      }
      await persistClusters(db, clusters);

      const finalStatus = derivedStatus === 'failed' ? 'degraded' : 'completed';
      await db.updateEvidenceStatus(evidence.id, finalStatus, {
        processing_completed_at: new Date().toISOString(),
      });

      return res.json({ status: 'queued', evidenceId: evidence.id, jobId: `reprocess-${evidence.id}` });
    } catch (e) {
      await db.updateEvidenceStatus(evidence.id, 'failed', { error: e.message });
      return res.status(500).json(createErrorResponse(`Reprocess failed: ${e.message}`, 'PROCESSING_ERROR', req.requestId));
    }
  }

  return res.status(202).json({ status: 'queued', evidenceId: evidence.id });
}));

// ===========================================================================
// GET /api/v2/clusters — List clusters
// ===========================================================================

router.get('/clusters', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);

  const filter = {};
  if (req.query.releaseId) filter.releaseId = req.query.releaseId;
  if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
  if (req.query.driftClassification) filter.driftClassification = req.query.driftClassification;

  let clusterList = await db.listClusters(filter);
  const total = clusterList.length;
  const pageItems = clusterList.slice(offset, offset + limit);

  res.json({
    clusters: pageItems.map(c => ({
      id: c.id,
      name: c.name,
      usageCount: c.usage_count,
      driftClassification: c.drift_classification,
      driftScore: c.drift_score,
      priorityScore: c.priority_score,
      approvalStatus: c.approval_status,
      evidencePackageCount: c.evidence_package_ids?.length || 0,
      screens: c.screens || [],
    })),
    total,
    page,
    limit,
  });
}));

// ===========================================================================
// GET /api/v2/clusters/:id — Cluster detail
// ===========================================================================

router.get('/clusters/:id', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const cluster = await db.getCluster(req.params.id);
  if (!cluster) {
    return res.status(404).json(createErrorResponse('Cluster not found', 'NOT_FOUND', req.requestId));
  }

  res.json({
    id: cluster.id,
    name: cluster.name,
    usageCount: cluster.usage_count,
    driftClassification: cluster.drift_classification,
    driftScore: cluster.drift_score,
    priorityScore: cluster.priority_score,
    approvalStatus: cluster.approval_status,
    evidencePackageIds: cluster.evidence_package_ids || [],
    memberNodeIds: cluster.member_node_ids || [],
    driftedProperties: parseJsonField(cluster.drifted_properties, []),
    confidenceDistribution: cluster.confidence_distribution,
    screens: cluster.screens || [],
    createdAt: cluster.created_at,
  });
}));

// ===========================================================================
// PATCH /api/v2/clusters/batch — Batch approve/update
// ===========================================================================

router.patch('/clusters/batch', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { clusterIds, approvalStatus, note, overrideOutcome, overrideDetails } = req.body || {};

  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    return res.status(400).json(createErrorResponse('clusterIds must be a non-empty array', 'VALIDATION_ERROR', req.requestId));
  }

  if (!['approved', 'rejected', 'deferred'].includes(approvalStatus)) {
    return res.status(400).json(createErrorResponse('approvalStatus must be approved, rejected, or deferred', 'VALIDATION_ERROR', req.requestId));
  }

  const results = [];
  for (const cid of clusterIds) {
    const cluster = await db.getCluster(cid);
    if (!cluster) {
      results.push({ clusterId: cid, success: false, error: 'Cluster not found' });
      continue;
    }
    await db.updateCluster(cid, {
      approval_status: approvalStatus,
      approval_note: note || null,
    });
    results.push({ clusterId: cid, success: true, error: null });
  }

  res.json({
    updated: results.filter(r => r.success).length,
    errors: results.filter(r => !r.success),
  });
}));

// ===========================================================================
// POST /api/v2/releases — Create curated release
// ===========================================================================

router.post('/releases', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { name, version, description, includedEvidenceIds, tokenOverrides } = req.body || {};

  if (!name) return res.status(400).json(createErrorResponse('name is required', 'VALIDATION_ERROR', req.requestId));
  if (!version) return res.status(400).json(createErrorResponse('version is required', 'VALIDATION_ERROR', req.requestId));

  // Check duplicate version
  const existing = (await db.listReleases()).find(r => r.version === version);
  if (existing) {
    return res.status(409).json(createErrorResponse(`Release version ${version} already exists`, 'VERSION_CONFLICT', req.requestId));
  }

  const releaseId = `rel-${uuidv4().slice(0, 12)}`;
  const releaseRow = {
    id: releaseId,
    name,
    version,
    description: description || null,
    status: 'draft',
    included_evidence_ids: includedEvidenceIds || [],
    token_overrides: tokenOverrides || null,
    created_at: new Date().toISOString(),
    published_at: null,
    is_published: false,
  };

  await db.insertRelease(releaseRow);

  // Link clusters to release via release_clusters
  const allClusters = await db.listClusters();
  for (const cluster of allClusters) {
    // Only link clusters from included evidence
    const evidenceMatch = cluster.evidence_package_ids?.some(eid =>
      (includedEvidenceIds || []).includes(eid)
    );
    if (includedEvidenceIds && includedEvidenceIds.length > 0 && !evidenceMatch) continue;

    await db.insertReleaseCluster({
      release_id: releaseId,
      cluster_id: cluster.id,
      approval_status: cluster.approval_status || 'pending',
      override_outcome: null,
      override_details: null,
    });
  }

  res.status(201).json({
    id: releaseId,
    name,
    version,
    status: 'draft',
    description: releaseRow.description,
    includedEvidenceIds: releaseRow.included_evidence_ids,
    tokenOverrides: releaseRow.token_overrides,
    createdAt: releaseRow.created_at,
  });
}));

// ===========================================================================
// GET /api/v2/releases — List releases
// ===========================================================================

router.get('/releases', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);

  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const releaseList = await db.listReleases(filter);
  const total = releaseList.length;
  const pageItems = releaseList.slice(offset, offset + limit);
  const tokens = await db.listTokens();
  const releases = await Promise.all(pageItems.map(async r => ({
    id: r.id,
    name: r.name,
    version: r.version,
    status: r.status,
    clusterCount: (await db.getReleaseClusters(r.id)).length,
    tokenCount: tokens.length,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    isPublished: r.is_published,
  })));

  res.json({
    releases,
    total,
    page,
    limit,
  });
}));

// ===========================================================================
// GET /api/v2/releases/:id — Release detail
// ===========================================================================

router.get('/releases/:id', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const release = await db.getRelease(req.params.id);
  if (!release) {
    return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  }

  const releaseClusters = await db.getReleaseClusters(release.id);
  const figmaLogs = await getFigma(req).getPublished(release.id);
  const tokens = await db.listTokens();
  const clusters = (await Promise.all(releaseClusters.map(async rc => {
    const cluster = await db.getCluster(rc.cluster_id);
    return cluster ? {
      id: cluster.id,
      name: cluster.name,
      approvalStatus: rc.approval_status,
      overrideOutcome: rc.override_outcome,
      usageCount: cluster.usage_count,
      driftClassification: cluster.drift_classification,
      priorityScore: cluster.priority_score,
    } : null;
  }))).filter(Boolean);

  res.json({
    id: release.id,
    name: release.name,
    version: release.version,
    status: release.status,
    description: release.description,
    includedEvidenceIds: release.included_evidence_ids,
    tokenOverrides: release.token_overrides,
    clusters,
    tokens: tokens.map(t => ({
      tokenName: t.tokenName,
      canonicalValue: t.canonicalValue,
      variantCount: t.variant_count || t.variantCount,
      driftStatus: t.drift_status || t.driftStatus,
    })),
    figmaPublish: figmaLogs.result || null,
    createdAt: release.created_at,
    publishedAt: release.published_at,
    isPublished: release.is_published,
  });
}));

// ===========================================================================
// POST /api/v2/releases/:id/approve — Batch approve clusters in release
// ===========================================================================

router.post('/releases/:id/approve', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const release = await db.getRelease(req.params.id);
  if (!release) {
    return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  }

  if (release.is_published) {
    return res.status(409).json(createErrorResponse('Release already published (immutable)', 'IMMUTABLE_RELEASE', req.requestId));
  }

  const {
    clusterIds,
    action,
    overrideOutcome,
    overrideDetails,
    note,
    humanApproval,
  } = req.body || {};

  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    return res.status(400).json(createErrorResponse('clusterIds must be a non-empty array', 'VALIDATION_ERROR', req.requestId));
  }

  if (!['approve', 'reject', 'defer'].includes(action)) {
    return res.status(400).json(createErrorResponse('action must be approve, reject, or defer', 'VALIDATION_ERROR', req.requestId));
  }

  // Validate override outcomes for approve action
  if (action === 'approve' && overrideOutcome) {
    const validOutcomes = ['normalize-to-keep', 'keep-approved-override', 'promote-to-custom', 'reject'];
    if (!validOutcomes.includes(overrideOutcome)) {
      return res.status(400).json(createErrorResponse(
        `Invalid overrideOutcome: ${overrideOutcome}. Valid: ${validOutcomes.join(', ')}`,
        'VALIDATION_ERROR',
        req.requestId
      ));
    }
  }

  const apprMap = { approve: 'approved', reject: 'rejected', defer: 'deferred' };
  const newStatus = apprMap[action];
  let approved = 0; let rejected = 0; let deferred = 0;
  const selectedClusters = [];

  for (const cid of clusterIds) {
    const cluster = await db.getCluster(cid);
    if (cluster) selectedClusters.push(cluster);
  }

  if (action === 'approve' && overrideOutcome === 'promote-to-custom') {
    const failedGates = selectedClusters
      .map(cluster => ({ clusterId: cluster.id, ...evaluateCustomPromotion(cluster, humanApproval) }))
      .filter(result => !result.eligible);
    if (failedGates.length > 0) {
      return res.status(422).json({
        error: 'Custom promotion gate failed',
        code: 'CUSTOM_PROMOTION_GATE_FAILED',
        requestId: req.requestId,
        failedGates,
      });
    }
  }

  for (const cluster of selectedClusters) {
    const cid = cluster.id;

    await db.updateCluster(cid, {
      approval_status: newStatus,
      approval_note: note || null,
    });

    // Update in release_clusters as well
    const rcKey = `${release.id}:${cid}`;
    // We need to update or create release_cluster entry
    // Since this is simple in-memory, just record it
    const existingRC = (await db.getReleaseClusters(release.id)).find(rc => rc.cluster_id === cid);
    if (existingRC) {
      await db.insertReleaseCluster({
        ...existingRC,
        approval_status: newStatus,
        override_outcome: overrideOutcome || existingRC.override_outcome || null,
        override_details: overrideDetails
          ? JSON.stringify(overrideDetails)
          : existingRC.override_details || null,
      });
    } else {
      await db.insertReleaseCluster({
        release_id: release.id,
        cluster_id: cid,
        approval_status: newStatus,
        override_outcome: overrideOutcome || null,
        override_details: overrideDetails ? JSON.stringify(overrideDetails) : null,
      });
    }

    if (action === 'approve') approved++;
    else if (action === 'reject') rejected++;
    else deferred++;
  }

  // If approved clusters exist, auto-transition status to approved
  if (approved > 0 && release.status === 'draft') {
    await db.updateReleaseStatus(release.id, 'approved');
  }

  res.json({ approved, rejected, deferred });
}));

// ===========================================================================
// POST /api/v2/releases/:id/publish — Publish to Figma (mock, idempotent)
// ===========================================================================

router.post('/releases/:id/publish', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const release = await db.getRelease(req.params.id);
  if (!release) {
    return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  }

  if (release.is_published) {
    // Second publish = no-op (idempotent)
    const existingPub = await getFigma(req).getPublished(release.id);
    return res.json({
      status: existingPub.result?.status || 'published',
      publishLogId: `figma-${release.id}`,
      note: 'Release already published. No-op.',
      alreadyPublished: true,
    });
  }

  // Collect tokens from release-approved clusters
  const releaseClusters = await db.getReleaseClusters(release.id);
  const approvedClusters = releaseClusters.filter(rc => rc.approval_status === 'approved');
  const allTokens = await db.listTokens();

  const tokensToPublish = allTokens.filter(t => {
    // Only publish tokens that have evidence in this release scope
    return true; // Simplification: publish all tracked tokens
  });

  // Publish (deterministic, idempotent)
  const figmaPub = getFigma(req);
  const pubResult = await figmaPub.publish(release.id, tokensToPublish);

  // Update release
  await db.updateReleaseStatus(release.id, 'published', {
    is_published: true,
    published_at: pubResult.publishedAt,
    figma_file_id: pubResult.fileId,
    figma_clone_id: pubResult.cloneId,
  });

  // Log
  await db.insertFigmaLog({
    id: `figma-${uuidv4().slice(0, 8)}`,
    release_id: release.id,
    status: 'published',
    file_id: pubResult.fileId,
    clone_id: pubResult.cloneId,
    token_count: pubResult.tokensPublished,
    cluster_count: approvedClusters.length,
    published_at: pubResult.publishedAt,
  });

  res.status(202).json({
    status: pubResult.status,
    fileId: pubResult.fileId,
    cloneId: pubResult.cloneId,
    tokensPublished: pubResult.tokensPublished,
    publishLogId: `figma-${release.id}`,
  });
}));

// ===========================================================================
// POST /api/v2/releases/:id/export — Export tokens
// ===========================================================================

router.post('/releases/:id/export', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const release = await db.getRelease(req.params.id);
  if (!release) {
    return res.status(404).json(createErrorResponse('Release not found', 'NOT_FOUND', req.requestId));
  }

  const format = req.body?.format || 'w3c-tokens';
  const tokens = await db.listTokens();

  let exportData;
  if (format === 'w3c-tokens') {
    exportData = {
      $schema: 'https://design-tokens.ietf.org/schema/v3',
      info: { name: release.name, version: release.version, exportedAt: new Date().toISOString() },
      tokens: {},
    };
    for (const t of tokens) {
      exportData.tokens[t.tokenName] = { $value: t.canonicalValue, $type: t.dataType || 'string' };
    }
  } else if (format === 'style-dictionary') {
    exportData = { info: { name: release.name, version: release.version }, tokens: {} };
    for (const t of tokens) {
      exportData.tokens[t.tokenName] = { value: t.canonicalValue, type: t.dataType || 'string' };
    }
  } else {
    return res.status(400).json(createErrorResponse(`Unsupported format: ${format}`, 'VALIDATION_ERROR', req.requestId));
  }

  res.json(exportData);
}));

// ===========================================================================
// GET /api/v2/tokens — Token inventory
// ===========================================================================

router.get('/tokens', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const { page, limit, offset } = paginate(req.query.page, req.query.limit);

  let tokens = await db.listTokens();
  if (req.query.driftStatus) {
    tokens = tokens.filter(t => (t.drift_status || t.driftStatus) === req.query.driftStatus);
  }

  const total = tokens.length;
  const pageItems = tokens.slice(offset, offset + limit);

  res.json({
    tokens: pageItems.map(t => ({
      tokenName: t.tokenName,
      canonicalValue: t.canonicalValue,
      antdDefaultValue: t.antdDefaultValue || null,
      dataType: t.dataType || 'string',
      variantCount: t.variant_count || t.variantCount || t.variants?.length || 1,
      usageCount: t.usage_count || t.usageCount || 0,
      driftStatus: t.drift_status || t.driftStatus || null,
      lastUpdatedAt: t.lastUpdatedAt || null,
    })),
    total,
    page,
    limit,
  });
}));

// ===========================================================================
// GET /api/v2/tokens/delta — Token changes since release
// NOTE: must be registered BEFORE /tokens/:name to avoid route conflict
// ===========================================================================

router.get('/tokens/delta', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const since = req.query.since;
  if (!since) {
    return res.status(400).json(createErrorResponse('since is required (release ID)', 'VALIDATION_ERROR', req.requestId));
  }

  const sinceRelease = await db.getRelease(since);
  if (!sinceRelease) {
    return res.status(404).json(createErrorResponse(`Release not found: ${since}`, 'NOT_FOUND', req.requestId));
  }

  const allTokens = await db.listTokens();
  const delta = { added: [], changed: [], removed: [] };

  // In this simple implementation, all tracked tokens are "added" relative to a release
  // A real implementation would compare against previous release's token snapshot
  for (const t of allTokens) {
    delta.added.push({
      tokenName: t.tokenName,
      canonicalValue: t.canonicalValue,
      dataType: t.dataType,
    });
  }

  res.json(delta);
}));

// ===========================================================================
// GET /api/v2/tokens/:name — Token detail
// ===========================================================================

router.get('/tokens/:name', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const token = await db.getToken(req.params.name);
  if (!token) {
    return res.status(404).json(createErrorResponse('Token not found', 'NOT_FOUND', req.requestId));
  }

  res.json({
    tokenName: token.tokenName,
    canonicalValue: token.canonicalValue,
    antdDefaultValue: token.antdDefaultValue || null,
    dataType: token.dataType || 'string',
    variants: token.variants || [],
    usageAcrossScreens: token.usageAcrossScreens || [],
    usageCount: token.usage_count || token.usageCount || 0,
    driftStatus: token.drift_status || token.driftStatus || null,
    driftDetail: token.driftDetail || null,
    lastEvidenceId: token.lastEvidenceId || null,
  });
}));

// ===========================================================================
// V1 Read-Only Compat (proxy to v2 data)
// ===========================================================================

// GET /api/v1/runs
v1CompatRouter.get('/runs', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.listEvidence();
  res.json({
    runs: evidence.map(mapV1EvidenceToRun),
    total: evidence.length,
    page: 1,
    limit: 100,
  });
}));

// GET /api/v1/runs/:runId
v1CompatRouter.get('/runs/:runId', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.runId);
  if (!evidence) {
    return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));
  }
  res.json(mapV1EvidenceToRun(evidence));
}));

// GET /api/v1/runs/:runId/snapshots — proxy to signals
v1CompatRouter.get('/runs/:runId/snapshots', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.runId);
  if (!evidence) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));

  const signals = await db.getSignalsByEvidence(evidence.id);
  res.json({
    snapshots: signals.map(s => ({
      id: s.id,
      runId: evidence.id,
      signal: s.signal,
      status: s.status === 'present' ? 'analyzed' : 'failed',
    })),
  });
}));

// GET /api/v1/runs/:runId/findings — proxy to clusters
v1CompatRouter.get('/runs/:runId/findings', asyncHandler(async (req, res) => {
  const db = getDb(req);
  const evidence = await db.getEvidence(req.params.runId);
  if (!evidence) return res.status(404).json(createErrorResponse('Run not found', 'NOT_FOUND', req.requestId));

  const clusters = (await db.listClusters()).filter(c =>
    c.evidence_package_ids?.includes(evidence.id)
  );

  res.json({
    findings: clusters.map((c, i) => ({
      findingId: c.id,
      clusterId: c.id,
      clusterName: c.name,
      priorityScore: c.priority_score || 0,
      rank: i + 1,
      usageCount: c.usage_count,
      driftScore: c.drift_score,
      driftClassification: c.drift_classification,
      status: c.approval_status,
    })),
  });
}));

module.exports = router;
module.exports.v1CompatRouter = v1CompatRouter;
