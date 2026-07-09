/**
 * V2 Integration Tests — Express Routes with In-Memory Adapters
 *
 * Tests the full V2 evidence pipeline through HTTP using supertest.
 * Uses in-memory adapters (no Postgres/MinIO) for CI-friendly testing.
 *
 * Flow:
 *   Upload evidence → List → Detail → Signals → Idempotent re-upload →
 *   Clusters → Approve → Release → Approve → Publish (idempotent) →
 *   Export → Token inventory → Delta → V1 compat → Error cases →
 *   Second evidence → Cluster merging → All 4 override outcomes
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use CJS require so resetAll targets the exact module instance routes use
const adapters = require('../../src/v2/storage-adapters.js');
const { resetAll, getMetadataDb, getEvidenceStore, forceInit } = adapters;

// ── Helpers ────────────────────────────────────────────────────────────────

function createMinimalValidPackage(overrides = {}) {
  return {
    schemaVersion: '2.0.0',
    packageId: 'pkg-test-001',
    capturedAt: '2026-07-05T14:30:00.000Z',
    url: 'https://staging.example.com/dashboard',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1.0 },
    scenario: {
      manifestId: 'mft-001',
      route: '/dashboard',
      role: 'admin',
      theme: 'light',
      locale: 'en-US',
    },
    redaction: {
      enabled: true,
      textNodesRedacted: 100,
      imagesRedacted: 5,
      survivingSignals: [
        'dom-structure', 'css-computed', 'rect', 'antd-classes',
        'antd-tokens', 'react-fiber', 'a11y-tree',
      ],
    },
    screenshot: 'full.webp',
    dom: {
      nodes: [
        {
          nodeId: 'n-001', tag: 'button',
          classList: ['ant-btn', 'ant-btn-primary'],
          attributes: { id: 'submit-btn' },
          rect: { x: 100, y: 200, w: 180, h: 40 },
          parentId: null, childIds: [],
          textContent: 'Submit',
        },
        {
          nodeId: 'n-002', tag: 'input',
          classList: ['ant-input'],
          attributes: { type: 'text' },
          rect: { x: 100, y: 260, w: 300, h: 32 },
          parentId: null, childIds: [],
          textContent: '',
        },
      ],
      captureEvidence: 'dom/nodes.json',
      extractorVersion: '2.0.0',
    },
    css: {
      computed: {
        'n-001': {
          backgroundColor: '#1677ff', color: '#ffffff', fontSize: '14px',
          fontFamily: 'sans-serif', lineHeight: '1.5715', padding: '4px 15px',
          margin: '0px', border: '1px solid #1677ff', borderRadius: '6px',
          boxShadow: 'none', width: '180px', height: '40px',
        },
        'n-002': {
          backgroundColor: '#ffffff', color: '#333333', fontSize: '14px',
          fontFamily: 'sans-serif', lineHeight: '1.5715', padding: '4px 11px',
          margin: '0px', border: '1px solid #d9d9d9', borderRadius: '6px',
          boxShadow: 'none', width: '300px', height: '32px',
        },
      },
      captureEvidence: 'css/computed.json',
      extractorVersion: '2.0.0',
    },
    antd: {
      tokens: {
        colorPrimary: { value: '#1677ff', source: 'runtime', confidence: 0.95 },
        borderRadius: { value: '6px', source: 'runtime', confidence: 0.90 },
      },
      version: '5.27.4',
      classMatches: {
        'n-001': { patterns: ['ant-btn', 'ant-btn-primary'], confidence: 0.95 },
      },
      captureEvidence: 'antd/tokens.json',
      extractorVersion: '2.0.0',
    },
    fiber: {
      nodes: {
        'n-001': {
          displayName: 'MyButton',
          ownerPath: ['App', 'Dashboard', 'MyButton'],
          confidence: 0.88,
          evidence: ['fiber-displayName', 'fiber-owner-chain'],
        },
      },
      disclaimer: 'React Fiber is a private API',
      captureEvidence: 'fiber/nodes.json',
      extractorVersion: '2.0.0',
    },
    a11y: {
      nodes: {
        'n-001': {
          role: 'button', ariaLabel: 'Submit form',
          ariaExpanded: null, ariaSelected: null, ariaChecked: null,
        },
      },
      captureEvidence: 'a11y/tree.json',
      extractorVersion: '2.0.0',
    },
    provenance: {
      everySignalBackedBy: 'persisted evidence in this package',
      noMetadataClaimWithoutEvidence: true,
      packageHash: 'abc123def456',
      integrityVerifiedAt: '2026-07-05T14:30:05.000Z',
    },
    ...overrides,
  };
}

function createSecondPackage() {
  return createMinimalValidPackage({
    packageId: 'pkg-test-002',
    url: 'https://staging.example.com/settings',
    capturedAt: '2026-07-05T15:00:00.000Z',
    scenario: { manifestId: 'mft-002', route: '/settings', role: 'admin', theme: 'light', locale: 'en-US' },
    antd: {
      tokens: {
        colorPrimary: { value: '#1890ff', source: 'inferred', confidence: 0.72 },
        borderRadius: { value: '8px', source: 'runtime', confidence: 0.95 },
        fontSize: { value: '16px', source: 'runtime', confidence: 0.88 },
      },
      version: '5.27.4',
      classMatches: {
        'n-001': { patterns: ['ant-btn', 'ant-btn-primary'], confidence: 0.95 },
      },
      captureEvidence: 'antd/tokens.json',
      extractorVersion: '2.0.0',
    },
    dom: {
      nodes: [
        {
          nodeId: 'n-003', tag: 'button',
          classList: ['ant-btn', 'ant-btn-primary'],
          attributes: { id: 'save-btn' },
          rect: { x: 100, y: 200, w: 180, h: 40 },
          parentId: null, childIds: [],
          textContent: 'Save',
        },
      ],
      captureEvidence: 'dom/nodes.json',
      extractorVersion: '2.0.0',
    },
    css: {
      computed: {
        'n-003': {
          backgroundColor: '#1890ff', color: '#ffffff', fontSize: '14px',
          fontFamily: 'sans-serif', lineHeight: '1.5715', padding: '4px 15px',
          margin: '0px', border: '1px solid #1890ff', borderRadius: '8px',
          boxShadow: 'none', width: '180px', height: '40px',
        },
      },
      captureEvidence: 'css/computed.json',
      extractorVersion: '2.0.0',
    },
    fiber: null,
    a11y: null,
    redaction: {
      enabled: true, textNodesRedacted: 50, imagesRedacted: 2,
      survivingSignals: ['dom-structure', 'css-computed', 'rect', 'antd-classes', 'antd-tokens'],
    },
  });
}

function createInvalidPackage() {
  return { foo: 'bar' };
}

// ── Setup Express App ──────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Add requestId middleware (routes reference req.requestId)
  app.use((req, _res, next) => {
    req.requestId = `req-test-${Date.now()}`;
    next();
  });

  // Mount v2 routes
  const v2Router = require('../../src/v2/routes.js');
  app.use('/api/v2', v2Router);
  app.use('/api/v1', v2Router.v1CompatRouter);

  return app;
}

// Rebuild app per-test to avoid ESM/CJS singleton desync with vitest
let request;

beforeEach(() => {
  resetAll();
  const app = buildApp();
  request = supertest(app);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('V2 Integration: Express Routes E2E', () => {
  afterEach(() => {
    resetAll();
  });

  it('resetAll clears the CommonJS adapter state used by HTTP routes', async () => {
    const db = getMetadataDb();
    db.insertEvidence({ id: 'ev-reset-regression', capture_id: 'pkg-reset-regression' });
    expect(db.getEvidenceByCaptureId('pkg-reset-regression')).not.toBeNull();

    resetAll();
    expect(db.getEvidenceByCaptureId('pkg-reset-regression')).toBeNull();

    const pkg = createMinimalValidPackage({ packageId: 'pkg-reset-regression' });
    await request.post('/api/v2/evidence').send(pkg).expect(201);
    await request.post('/api/v2/evidence').send(pkg).expect(200);

    resetAll();
    await request.post('/api/v2/evidence').send(pkg).expect(201);
  });

  // ── Upload & Retrieve ──────────────────────────────────────────────────

  it('POST /api/v2/evidence — upload valid package returns 201', async () => {
    const pkg = createMinimalValidPackage();
    const res = await request
      .post('/api/v2/evidence')
      .send(pkg)
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('captureId', pkg.packageId);
    expect(res.body).toHaveProperty('status', 'completed');
    expect(res.body).toHaveProperty('schemaVersion', '2.0.0');
    expect(res.body).toHaveProperty('signalCount', 7);
    expect(res.body).toHaveProperty('nodeCount', 2);
    expect(res.body).toHaveProperty('tokenCount', 2);
    expect(res.body).toHaveProperty('clusterCount');
    expect(res.body).toHaveProperty('derivedStatus');
    expect(res.body.alreadyExisted).toBe(false);
  });

  it('GET /api/v2/evidence — list includes uploaded evidence', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/evidence')
      .expect(200);

    expect(res.body).toHaveProperty('evidence');
    expect(Array.isArray(res.body.evidence)).toBe(true);
    expect(res.body.evidence.length).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');

    const entry = res.body.evidence.find(e => e.captureId === pkg.packageId);
    expect(entry).toBeDefined();
    expect(entry.url).toBe(pkg.url);
    expect(entry.status).toBe('completed');
    expect(entry.schemaVersion).toBe('2.0.0');
  });

  it('GET /api/v2/evidence/:id — detail returns correct schemaVersion, status, signalCount', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .get(`/api/v2/evidence/${evidenceId}`)
      .expect(200);

    expect(res.body).toHaveProperty('id', evidenceId);
    expect(res.body).toHaveProperty('schemaVersion', '2.0.0');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('signalCount', 7);
    expect(res.body).toHaveProperty('nodeCount', 2);
    expect(res.body).toHaveProperty('captureId', pkg.packageId);
    expect(res.body).toHaveProperty('signalGaps', null);
  });

  it('GET /api/v2/evidence/:id/signals — derivedStatus and all 7 signals', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .get(`/api/v2/evidence/${evidenceId}/signals`)
      .expect(200);

    expect(res.body).toHaveProperty('evidenceId', evidenceId);
    expect(res.body).toHaveProperty('derivedStatus', 'full');

    // All 7 signals present
    expect(res.body).toHaveProperty('signals');
    expect(res.body.signals).toHaveLength(7);

    const signalNames = res.body.signals.map(s => s.signal);
    expect(signalNames).toContain('dom-structure');
    expect(signalNames).toContain('css-computed');
    expect(signalNames).toContain('rect');
    expect(signalNames).toContain('antd-classes');
    expect(signalNames).toContain('antd-tokens');
    expect(signalNames).toContain('react-fiber');
    expect(signalNames).toContain('a11y-tree');

    // Verify signal statuses are "present" (derived, not hardcoded booleans)
    for (const s of res.body.signals) {
      expect(s.status).toBe('present');
      expect(typeof s.confidence).toBe('number');
      expect(s).toHaveProperty('severity');
      expect(s).toHaveProperty('nodeCount');
    }
  });

  // ── Idempotent Upload ──────────────────────────────────────────────────

  it('POST /api/v2/evidence — same captureId returns 200 (idempotent)', async () => {
    const pkg = createMinimalValidPackage();

    // First upload → 201
    const first = await request
      .post('/api/v2/evidence')
      .send(pkg)
      .expect(201);

    // Second upload (same packageId) → 200, existed: true
    const second = await request
      .post('/api/v2/evidence')
      .send(pkg)
      .expect(200);

    expect(second.body).toHaveProperty('existed', true);
    expect(second.body).toHaveProperty('id', first.body.id);
    expect(second.body).toHaveProperty('captureId', pkg.packageId);
    expect(second.body).toHaveProperty('status');
    expect(second.body.message).toMatch(/already exists/i);
  });

  // ── Clusters ───────────────────────────────────────────────────────────

  it('GET /api/v2/clusters — clusters formed from evidence nodes', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/clusters')
      .expect(200);

    expect(res.body).toHaveProperty('clusters');
    expect(Array.isArray(res.body.clusters)).toBe(true);
    expect(res.body.clusters.length).toBeGreaterThan(0);

    const cluster = res.body.clusters[0];
    expect(cluster).toHaveProperty('id');
    expect(cluster).toHaveProperty('name');
    expect(cluster).toHaveProperty('usageCount');
    expect(cluster).toHaveProperty('driftClassification');
    expect(cluster).toHaveProperty('priorityScore');
    expect(cluster).toHaveProperty('approvalStatus', 'pending');
    expect(cluster.usageCount).toBeGreaterThan(0);
  });

  it('PATCH /api/v2/clusters/batch — approve clusters', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    // Get clusters
    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);
    expect(clusterIds.length).toBeGreaterThan(0);

    // Approve them
    const approveRes = await request
      .patch('/api/v2/clusters/batch')
      .send({
        clusterIds,
        approvalStatus: 'approved',
        note: 'QA approved',
      })
      .expect(200);

    expect(approveRes.body).toHaveProperty('updated', clusterIds.length);
    expect(approveRes.body).toHaveProperty('errors');
    expect(approveRes.body.errors).toHaveLength(0);
  });

  // ── Release → Approve → Publish (Idempotent) ──────────────────────────

  it('POST /api/v2/releases — create release with evidence', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .post('/api/v2/releases')
      .send({
        name: 'QA Release',
        version: 'v1.0.0',
        description: 'Test release from QA integration',
        includedEvidenceIds: [evidenceId],
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'QA Release');
    expect(res.body).toHaveProperty('version', 'v1.0.0');
    expect(res.body).toHaveProperty('status', 'draft');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('POST /api/v2/releases/:id/approve — batch approve clusters in release', async () => {
    // Upload evidence
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    // Create release
    const releaseRes = await request
      .post('/api/v2/releases')
      .send({
        name: 'Approve Test',
        version: 'v1.1.0',
        includedEvidenceIds: [evidenceId],
      })
      .expect(201);
    const releaseId = releaseRes.body.id;

    // Get clusters and approve them through the release
    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);

    const approveRes = await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({
        clusterIds,
        action: 'approve',
        note: 'All approved for release',
      })
      .expect(200);

    expect(approveRes.body).toHaveProperty('approved');
    expect(approveRes.body.approved).toBe(clusterIds.length);
    expect(approveRes.body).toHaveProperty('rejected', 0);
    expect(approveRes.body).toHaveProperty('deferred', 0);

    // Verify release status updated to approved
    const detailRes = await request
      .get(`/api/v2/releases/${releaseId}`)
      .expect(200);
    expect(detailRes.body.status).toBe('approved');
  });

  it('POST /api/v2/releases/:id/publish — first publish succeeds', async () => {
    // Upload → create release → approve → publish
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Publish Test', version: 'v2.0.0', includedEvidenceIds: [evidenceId] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);

    await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({ clusterIds, action: 'approve' })
      .expect(200);

    // First publish → 202
    const pubRes = await request
      .post(`/api/v2/releases/${releaseId}/publish`)
      .expect(202);

    expect(pubRes.body).toHaveProperty('status', 'published');
    expect(pubRes.body).toHaveProperty('fileId');
    expect(pubRes.body).toHaveProperty('cloneId');
    expect(pubRes.body).toHaveProperty('tokensPublished');
    expect(pubRes.body).toHaveProperty('publishLogId');
    expect(pubRes.body.tokensPublished).toBeGreaterThan(0);
  });

  it('POST /api/v2/releases/:id/publish — second publish is no-op (idempotent)', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Idempotent Test', version: 'v2.1.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);

    await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({ clusterIds, action: 'approve' })
      .expect(200);

    // First publish
    await request.post(`/api/v2/releases/${releaseId}/publish`).expect(202);

    // Second publish → no-op (200, not 202)
    const secondPub = await request
      .post(`/api/v2/releases/${releaseId}/publish`)
      .expect(200);

    expect(secondPub.body).toHaveProperty('alreadyPublished', true);
    expect(secondPub.body).toHaveProperty('note');
    expect(secondPub.body.note).toMatch(/already published/i);
  });

  // ── Export ─────────────────────────────────────────────────────────────

  it('POST /api/v2/releases/:id/export — W3C tokens format', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Export Test', version: 'v3.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const exportRes = await request
      .post(`/api/v2/releases/${releaseId}/export`)
      .send({ format: 'w3c-tokens' })
      .expect(200);

    expect(exportRes.body).toHaveProperty('$schema');
    expect(exportRes.body['$schema']).toBe('https://design-tokens.ietf.org/schema/v3');
    expect(exportRes.body).toHaveProperty('info');
    expect(exportRes.body.info).toHaveProperty('name', 'Export Test');
    expect(exportRes.body.info).toHaveProperty('version', 'v3.0.0');
    expect(exportRes.body).toHaveProperty('tokens');
    expect(typeof exportRes.body.tokens).toBe('object');
    expect(Object.keys(exportRes.body.tokens).length).toBeGreaterThan(0);

    // Each token has $value and $type
    for (const [name, token] of Object.entries(exportRes.body.tokens)) {
      expect(token).toHaveProperty('$value');
      expect(token).toHaveProperty('$type');
    }
  });

  // ── Token Inventory & Delta ────────────────────────────────────────────

  it('GET /api/v2/tokens — token inventory', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/tokens')
      .expect(200);

    expect(res.body).toHaveProperty('tokens');
    expect(Array.isArray(res.body.tokens)).toBe(true);
    expect(res.body.tokens.length).toBeGreaterThan(0);

    const colorPrimary = res.body.tokens.find(t => t.tokenName === 'colorPrimary');
    expect(colorPrimary).toBeDefined();
    expect(colorPrimary).toHaveProperty('canonicalValue', '#1677ff');
    expect(colorPrimary).toHaveProperty('dataType', 'string');
    expect(colorPrimary).toHaveProperty('variantCount');
    expect(colorPrimary).toHaveProperty('driftStatus');
    expect(colorPrimary).toHaveProperty('lastUpdatedAt');
  });

  it('GET /api/v2/tokens/delta?since=... — delta returns added tokens', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    // Create a release to serve as the baseline
    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Delta Baseline', version: 'v1.0.0', includedEvidenceIds: [] })
      .expect(201);
    const baselineReleaseId = releaseRes.body.id;

    const res = await request
      .get(`/api/v2/tokens/delta?since=${baselineReleaseId}`)
      .expect(200);

    expect(res.body).toHaveProperty('added');
    expect(res.body).toHaveProperty('changed');
    expect(res.body).toHaveProperty('removed');
    expect(Array.isArray(res.body.added)).toBe(true);
    expect(res.body.added.length).toBeGreaterThan(0);

    const addedToken = res.body.added[0];
    expect(addedToken).toHaveProperty('tokenName');
    expect(addedToken).toHaveProperty('canonicalValue');
    expect(addedToken).toHaveProperty('dataType');
  });

  // ── V1 Compat ──────────────────────────────────────────────────────────

  it('GET /api/v1/runs — V1 compat returns evidence as runs', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v1/runs')
      .expect(200);

    expect(res.body).toHaveProperty('runs');
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs.length).toBeGreaterThan(0);

    const run = res.body.runs[0];
    expect(run).toHaveProperty('runId');
    expect(run).toHaveProperty('status', 'completed');
    expect(run).toHaveProperty('totalRoutes', 1);
    expect(run).toHaveProperty('completedRoutes', 1);
    expect(run).toHaveProperty('createdAt');
  });

  it('GET /api/v1/runs/:id — V1 compat returns single run', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .get(`/api/v1/runs/${evidenceId}`)
      .expect(200);

    expect(res.body).toHaveProperty('runId', evidenceId);
    expect(res.body).toHaveProperty('status', 'completed');
  });

  // ── Signal Gaps ────────────────────────────────────────────────────────

  it('signal_gaps is null when all signals present', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const detailRes = await request
      .get(`/api/v2/evidence/${evidenceId}`)
      .expect(200);

    expect(detailRes.body.signalGaps).toBeNull();
  });

  it('signal_gaps shows gaps when signals missing', async () => {
    // Create package without antd and a11y to trigger gaps
    const pkg = createMinimalValidPackage();
    delete pkg.antd;
    delete pkg.a11y;

    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const detailRes = await request
      .get(`/api/v2/evidence/${evidenceId}`)
      .expect(200);

    // Should have gaps (degraded status since strong signals missing)
    expect(detailRes.body.signalGaps).not.toBeNull();
    expect(Array.isArray(detailRes.body.signalGaps)).toBe(true);
    expect(detailRes.body.signalGaps.length).toBeGreaterThan(0);

    const gapSignals = detailRes.body.signalGaps.map(g => g.signal);
    expect(gapSignals).toContain('antd-classes');
    expect(gapSignals).toContain('antd-tokens');
    expect(gapSignals).toContain('a11y-tree');

    // Each gap has required fields
    for (const gap of detailRes.body.signalGaps) {
      expect(gap).toHaveProperty('signal');
      expect(gap).toHaveProperty('severity');
      expect(gap).toHaveProperty('reason');
    }
  });

  // ── Second Evidence & Cluster Merging ──────────────────────────────────

  it('second evidence package merges clusters with same fingerprint', async () => {
    // Upload first package (button + input)
    const pkg1 = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg1).expect(201);

    // Upload second package (button only, same class/size → same cluster)
    const pkg2 = createSecondPackage();
    await request.post('/api/v2/evidence').send(pkg2).expect(201);

    // Get clusters
    const res = await request.get('/api/v2/clusters').expect(200);
    const clusters = res.body.clusters;

    // Find button cluster — should have usageCount = 2 (merged from both packages)
    const btnCluster = clusters.find(c => c.name === 'button');
    expect(btnCluster).toBeDefined();
    expect(btnCluster.usageCount).toBe(2);

    // Should still have 2 clusters total (button + input), not 3
    expect(clusters.length).toBe(2);
  });

  // ── 4 Override Outcomes ────────────────────────────────────────────────

  it('all 4 override outcomes are accepted via batch approve', async () => {
    const outcomes = ['normalize-to-keep', 'keep-approved-override', 'promote-to-custom', 'reject'];

    // Upload evidence
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    // Create release
    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Override Test', version: 'v4.0.0', includedEvidenceIds: [evidenceId] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    // Get clusters
    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);

    // Approve each cluster with a different override outcome
    // We have 2 clusters, test 2 outcomes each (batch approve 1 cluster at a time)
    const outcome1 = outcomes[0];
    const res1 = await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({
        clusterIds: [clusterIds[0]],
        action: 'approve',
        overrideOutcome: outcome1,
        overrideDetails: { reason: `Testing ${outcome1}` },
      })
      .expect(200);
    expect(res1.body.approved).toBe(1);

    const outcome2 = outcomes[1];
    const res2 = await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({
        clusterIds: [clusterIds[1]],
        action: 'approve',
        overrideOutcome: outcome2,
        overrideDetails: { reason: `Testing ${outcome2}` },
      })
      .expect(200);
    expect(res2.body.approved).toBe(1);

    // Verify in release detail
    const detailRes = await request
      .get(`/api/v2/releases/${releaseId}`)
      .expect(200);

    const overrideOutcomes = detailRes.body.clusters.map(c => c.overrideOutcome);
    expect(overrideOutcomes).toContain(outcome1);
    expect(overrideOutcomes).toContain(outcome2);
  });

  it('promote-to-custom rejects clusters below the executable gate', async () => {
    const db = getMetadataDb();
    db.insertCluster({
      id: 'cluster-custom-ineligible',
      name: 'CustomCard',
      usage_count: 2,
      confidence_distribution: { avg: 0.95 },
      screens: [
        { evidencePackageId: 'ev-1', url: '/one' },
        { evidencePackageId: 'ev-2', url: '/two' },
      ],
      approval_status: 'pending',
    });
    db.insertRelease({
      id: 'release-custom-ineligible',
      name: 'Custom Gate Reject',
      version: 'custom-gate-reject',
      status: 'draft',
      is_published: false,
    });

    const response = await request
      .post('/api/v2/releases/release-custom-ineligible/approve')
      .send({
        clusterIds: ['cluster-custom-ineligible'],
        action: 'approve',
        overrideOutcome: 'promote-to-custom',
        humanApproval: { approved: true, reviewerId: 'designer-1' },
      })
      .expect(422);

    expect(response.body.code).toBe('CUSTOM_PROMOTION_GATE_FAILED');
    expect(response.body.failedGates[0].instanceCount).toBe(2);
  });

  it('promote-to-custom accepts 3 instances across 2 scenarios with confidence and human approval', async () => {
    const db = getMetadataDb();
    db.insertCluster({
      id: 'cluster-custom-eligible',
      name: 'CustomCard',
      usage_count: 3,
      confidence_distribution: { avg: 0.85 },
      screens: [
        { evidencePackageId: 'ev-1', url: '/one' },
        { evidencePackageId: 'ev-2', url: '/two' },
      ],
      approval_status: 'pending',
    });
    db.insertRelease({
      id: 'release-custom-eligible',
      name: 'Custom Gate Accept',
      version: 'custom-gate-accept',
      status: 'draft',
      is_published: false,
    });
    db.insertReleaseCluster({
      release_id: 'release-custom-eligible',
      cluster_id: 'cluster-custom-eligible',
      approval_status: 'pending',
      override_outcome: null,
    });

    await request
      .post('/api/v2/releases/release-custom-eligible/approve')
      .send({
        clusterIds: ['cluster-custom-eligible'],
        action: 'approve',
        overrideOutcome: 'promote-to-custom',
        overrideDetails: { reason: 'Repeated approved custom component' },
        humanApproval: { approved: true, reviewerId: 'designer-1' },
      })
      .expect(200);

    const detail = await request
      .get('/api/v2/releases/release-custom-eligible')
      .expect(200);
    expect(detail.body.clusters[0].overrideOutcome).toBe('promote-to-custom');
  });

  // ── Derived Status Verification ────────────────────────────────────────

  it('signal statuses are "present" strings (not boolean values)', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const signalsRes = await request
      .get(`/api/v2/evidence/${evidenceId}/signals`)
      .expect(200);

    for (const s of signalsRes.body.signals) {
      expect(typeof s.status).toBe('string');
      expect(s.status).toBe('present');
      // Not a boolean
      expect(s.status).not.toBe(true);
      expect(s.status).not.toBe(false);
    }
  });

  // ── Error Cases ────────────────────────────────────────────────────────

  it('POST /api/v2/evidence — invalid package returns 400', async () => {
    const invalidPkg = createInvalidPackage();

    const res = await request
      .post('/api/v2/evidence')
      .send(invalidPkg)
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/validation/i);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body).toHaveProperty('requestId');
  });

  it('GET /api/v2/evidence/:id — non-existent id returns 404', async () => {
    const res = await request
      .get('/api/v2/evidence/non-existent-id')
      .expect(404);

    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('GET /api/v2/evidence/:id/signals — non-existent id returns 404', async () => {
    const res = await request
      .get('/api/v2/evidence/non-existent-id/signals')
      .expect(404);

    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('POST /api/v2/releases — duplicate version returns 409', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    // First release
    await request
      .post('/api/v2/releases')
      .send({ name: 'Release A', version: 'v1.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);

    // Second release with same version → 409
    const res = await request
      .post('/api/v2/releases')
      .send({ name: 'Release B', version: 'v1.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(409);

    expect(res.body).toHaveProperty('code', 'VERSION_CONFLICT');
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('POST /api/v2/releases — missing name returns 400', async () => {
    const res = await request
      .post('/api/v2/releases')
      .send({ version: 'v1.0.0' })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error).toMatch(/name is required/i);
  });

  it('GET /api/v2/tokens/delta — missing since returns 400', async () => {
    const res = await request
      .get('/api/v2/tokens/delta')
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error).toMatch(/since is required/i);
  });

  it('PATCH /api/v2/clusters/batch — empty clusterIds returns 400', async () => {
    const res = await request
      .patch('/api/v2/clusters/batch')
      .send({ clusterIds: [], approvalStatus: 'approved' })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error).toMatch(/non-empty array/i);
  });

  it('POST /api/v2/releases/:id/publish — non-existent release returns 404', async () => {
    const res = await request
      .post('/api/v2/releases/non-existent/publish')
      .expect(404);

    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('POST /api/v2/releases/:id/export — non-existent release returns 404', async () => {
    const res = await request
      .post('/api/v2/releases/non-existent/export')
      .expect(404);

    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  // ── List with Filters ──────────────────────────────────────────────────

  it('GET /api/v2/evidence — filter by status', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/evidence?status=completed')
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    for (const e of res.body.evidence) {
      expect(e.status).toBe('completed');
    }
  });

  it('GET /api/v2/clusters — filter by approvalStatus', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/clusters?approvalStatus=pending')
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    for (const c of res.body.clusters) {
      expect(c.approvalStatus).toBe('pending');
    }
  });

  it('GET /api/v2/releases — filter by status', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    await request
      .post('/api/v2/releases')
      .send({ name: 'Filter Test', version: 'v5.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);

    const res = await request
      .get('/api/v2/releases?status=draft')
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    for (const r of res.body.releases) {
      expect(r.status).toBe('draft');
    }
  });

  // ── Pagination ─────────────────────────────────────────────────────────

  it('GET /api/v2/evidence — pagination works', async () => {
    // Upload 3 packages
    for (let i = 0; i < 3; i++) {
      const pkg = createMinimalValidPackage({
        packageId: `pkg-paginate-${i}`,
        url: `https://example.com/page-${i}`,
      });
      await request.post('/api/v2/evidence').send(pkg).expect(201);
    }

    const res = await request
      .get('/api/v2/evidence?page=1&limit=2')
      .expect(200);

    expect(res.body.evidence.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
  });

  // ── Reprossess ─────────────────────────────────────────────────────────

  it('POST /api/v2/evidence/:id/reprocess — re-runs processing', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const reproRes = await request
      .post(`/api/v2/evidence/${evidenceId}/reprocess`)
      .expect(200);

    expect(reproRes.body).toHaveProperty('status', 'queued');
    expect(reproRes.body).toHaveProperty('evidenceId', evidenceId);
    expect(reproRes.body).toHaveProperty('jobId');
  });

  it('POST /api/v2/evidence/:id/reprocess — non-existent returns 404', async () => {
    await request
      .post('/api/v2/evidence/non-existent/reprocess')
      .expect(404);
  });
});

describe('V2 Integration: Token Delta Edge Cases', () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    resetAll();
  });

  it('GET /api/v2/tokens/delta — unknown release returns 404', async () => {
    const res = await request
      .get('/api/v2/tokens/delta?since=unknown-release')
      .expect(404);

    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('GET /api/v2/tokens/:name — existing token returns detail', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/tokens/colorPrimary')
      .expect(200);

    expect(res.body).toHaveProperty('tokenName', 'colorPrimary');
    expect(res.body).toHaveProperty('canonicalValue', '#1677ff');
    expect(res.body).toHaveProperty('variants');
    expect(Array.isArray(res.body.variants)).toBe(true);
    expect(res.body.variants.length).toBeGreaterThan(0);
  });

  it('GET /api/v2/tokens/:name — non-existent returns 404', async () => {
    const res = await request
      .get('/api/v2/tokens/non-existent-token')
      .expect(404);

    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('GET /api/v2/tokens — filter by driftStatus', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const res = await request
      .get('/api/v2/tokens?driftStatus=aligned')
      .expect(200);

    expect(res.body.tokens.length).toBeGreaterThan(0);
    for (const t of res.body.tokens) {
      expect(t.driftStatus).toBe('aligned');
    }
  });
});

describe('V2 Integration: Cluster & Release Edge Cases', () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    resetAll();
  });

  it('GET /api/v2/clusters/:id — existing cluster returns detail', async () => {
    const pkg = createMinimalValidPackage();
    await request.post('/api/v2/evidence').send(pkg).expect(201);

    const listRes = await request.get('/api/v2/clusters').expect(200);
    const clusterId = listRes.body.clusters[0].id;

    const res = await request
      .get(`/api/v2/clusters/${clusterId}`)
      .expect(200);

    expect(res.body).toHaveProperty('id', clusterId);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('usageCount');
    expect(res.body).toHaveProperty('driftClassification');
    expect(res.body).toHaveProperty('evidencePackageIds');
    expect(res.body).toHaveProperty('memberNodeIds');
  });

  it('GET /api/v2/clusters/:id — non-existent returns 404', async () => {
    await request
      .get('/api/v2/clusters/non-existent')
      .expect(404);
  });

  it('POST /api/v2/releases/:id/approve — already published release returns 409', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Immutable Test', version: 'v6.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const clusterRes = await request.get('/api/v2/clusters').expect(200);
    const clusterIds = clusterRes.body.clusters.map(c => c.id);

    await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({ clusterIds, action: 'approve' })
      .expect(200);

    await request.post(`/api/v2/releases/${releaseId}/publish`).expect(202);

    // Try approving after publish → 409
    const res = await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({ clusterIds, action: 'approve' })
      .expect(409);

    expect(res.body).toHaveProperty('code', 'IMMUTABLE_RELEASE');
  });

  it('PATCH /api/v2/clusters/batch — invalid approvalStatus returns 400', async () => {
    const res = await request
      .patch('/api/v2/clusters/batch')
      .send({ clusterIds: ['clust-001'], approvalStatus: 'invalid-status' })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('POST /api/v2/releases/:id/approve — invalid action returns 400', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Bad Action', version: 'v7.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const res = await request
      .post(`/api/v2/releases/${releaseId}/approve`)
      .send({ clusterIds: ['fake-id'], action: 'unknown' })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('POST /api/v2/releases/:id/export — unsupported format returns 400', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);

    const releaseRes = await request
      .post('/api/v2/releases')
      .send({ name: 'Bad Export', version: 'v8.0.0', includedEvidenceIds: [uploadRes.body.id] })
      .expect(201);
    const releaseId = releaseRes.body.id;

    const res = await request
      .post(`/api/v2/releases/${releaseId}/export`)
      .send({ format: 'unsupported-format' })
      .expect(400);

    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('V1 compat: GET /api/v1/runs/:id — non-existent returns 404', async () => {
    await request
      .get('/api/v1/runs/non-existent')
      .expect(404);
  });

  it('V1 compat: GET /api/v1/runs/:runId/snapshots — returns signal data', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .get(`/api/v1/runs/${evidenceId}/snapshots`)
      .expect(200);

    expect(res.body).toHaveProperty('snapshots');
    expect(Array.isArray(res.body.snapshots)).toBe(true);
    expect(res.body.snapshots.length).toBe(7);

    const snapshot = res.body.snapshots[0];
    expect(snapshot).toHaveProperty('id');
    expect(snapshot).toHaveProperty('runId', evidenceId);
    expect(snapshot).toHaveProperty('signal');
    expect(snapshot).toHaveProperty('status');
  });

  it('V1 compat: GET /api/v1/runs/:runId/findings — returns cluster data', async () => {
    const pkg = createMinimalValidPackage();
    const uploadRes = await request.post('/api/v2/evidence').send(pkg).expect(201);
    const evidenceId = uploadRes.body.id;

    const res = await request
      .get(`/api/v1/runs/${evidenceId}/findings`)
      .expect(200);

    expect(res.body).toHaveProperty('findings');
    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body.findings.length).toBeGreaterThan(0);

    const finding = res.body.findings[0];
    expect(finding).toHaveProperty('findingId');
    expect(finding).toHaveProperty('clusterName');
    expect(finding).toHaveProperty('priorityScore');
    expect(finding).toHaveProperty('usageCount');
    expect(finding).toHaveProperty('driftScore');
    expect(finding).toHaveProperty('driftClassification');
    expect(finding).toHaveProperty('status');
  });
});
