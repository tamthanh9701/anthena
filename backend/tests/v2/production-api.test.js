import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import pg from 'pg';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const describeInfra = process.env.RUN_V2_INFRA_TESTS === '1' ? describe : describe.skip;
const routes = require('../../src/v2/routes.js');
const {
  PostgresMetadataDB,
  MinIOS3EvidenceStore,
  FigmaMockPublisher,
  forceInit,
} = require('../../src/v2/storage-adapters.js');

describeInfra('V2 production-adapter API vertical slice', () => {
  let pool;
  let metadataDb;
  let evidenceStore;
  let request;
  const packageId = `pkg-infra-${Date.now()}`;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'anthena_v2',
      user: process.env.POSTGRES_USER || 'anthena',
      password: process.env.POSTGRES_PASSWORD || 'anthena_secret',
      max: 2,
    });
    metadataDb = new PostgresMetadataDB({ pool });
    evidenceStore = new MinIOS3EvidenceStore({
      endpoint: process.env.MINIO_ENDPOINT || 'http://127.0.0.1:9000',
      accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'evidence-pkg',
    });
    await metadataDb.clear();
    await evidenceStore.clear();
    forceInit({
      metadataDb,
      evidenceStore,
      figmaPublisher: new FigmaMockPublisher(),
    });

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, _res, next) => {
      req.requestId = 'infra-api-test';
      next();
    });
    app.use('/api/v2', routes);
    request = supertest(app);
  });

  afterAll(async () => {
    if (metadataDb) await metadataDb.clear();
    if (evidenceStore) await evidenceStore.clear();
    if (pool) await pool.end();
  });

  it('persists and reads canonical evidence through Postgres and MinIO', async () => {
    const pkg = {
      schemaVersion: '2.0.0',
      packageId,
      capturedAt: new Date().toISOString(),
      url: 'https://infra.example.test/route',
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      scenario: {
        manifestId: 'infra-manifest',
        route: '/route',
        role: 'admin',
        theme: 'light',
        locale: 'en-US',
      },
      redaction: {
        enabled: true,
        textNodesRedacted: 1,
        imagesRedacted: 1,
        survivingSignals: ['dom-structure', 'css-computed', 'rect', 'antd-classes', 'antd-tokens'],
      },
      screenshot: 'data:image/webp;base64,UklGRg==',
      dom: {
        nodes: [{
          nodeId: 'infra-node-1',
          tag: 'button',
          classList: ['ant-btn', 'ant-btn-primary'],
          attributes: {},
          rect: { x: 10, y: 20, w: 120, h: 40 },
          parentId: null,
          childIds: [],
          textContent: '[REDACTED]',
        }],
        captureEvidence: 'dom/nodes.json',
        extractorVersion: 'extension-v2.0.0',
      },
      css: {
        computed: {
          'infra-node-1': {
            backgroundColor: '#1677ff',
            color: '#ffffff',
            width: '120px',
            height: '40px',
          },
        },
        captureEvidence: 'css/computed.json',
        extractorVersion: 'extension-v2.0.0',
      },
      antd: {
        tokens: {
          colorPrimary: { value: '#1677ff', source: 'runtime', confidence: 0.95 },
        },
        version: '5.0.0',
        classMatches: {
          'infra-node-1': { patterns: ['ant-btn'], confidence: 0.95 },
        },
        captureEvidence: 'antd/tokens.json',
        extractorVersion: 'extension-v2.0.0',
      },
      fiber: null,
      a11y: null,
      provenance: {
        everySignalBackedBy: 'persisted evidence in this package',
        noMetadataClaimWithoutEvidence: true,
        packageHash: 'sha256-infra',
        integrityVerifiedAt: new Date().toISOString(),
      },
    };

    const created = await request.post('/api/v2/evidence').send(pkg).expect(201);
    expect(created.body.captureId).toBe(packageId);

    const duplicate = await request.post('/api/v2/evidence').send(pkg).expect(200);
    expect(duplicate.body.existed).toBe(true);

    const list = await request.get('/api/v2/evidence').expect(200);
    expect(list.body.evidence.some(item => item.captureId === packageId)).toBe(true);

    const detail = await request
      .get(`/api/v2/evidence/${created.body.id}`)
      .expect(200);
    expect(detail.body.captureId).toBe(packageId);

    const signals = await request
      .get(`/api/v2/evidence/${created.body.id}/signals`)
      .expect(200);
    expect(signals.body.signals.some(signal => signal.signal === 'dom-structure')).toBe(true);

    const clusters = await request.get('/api/v2/clusters').expect(200);
    expect(clusters.body.clusters.length).toBeGreaterThan(0);

    const stored = await evidenceStore.get(packageId);
    expect(JSON.parse(stored.toString('utf8')).screenshot).toMatch(/^data:image\/webp;base64,/);
  });
});
