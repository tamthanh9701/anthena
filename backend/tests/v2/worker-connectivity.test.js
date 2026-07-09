/**
 * V2 Worker Tests — Postgres + MinIO connectivity, worker processing
 *
 * Requirements:
 *   - POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD env vars
 *   - MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY env vars
 *   - Running Postgres and MinIO instances
 *
 * Run with: npx vitest run tests/v2/worker-connectivity.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const describeInfra = process.env.RUN_V2_INFRA_TESTS === '1' ? describe : describe.skip;

let Pool = null;
let S3Client = null;
let PutObjectCommand = null;
let GetObjectCommand = null;
let DeleteObjectCommand = null;

beforeAll(async () => {
  try {
    const pgMod = await import('pg');
    Pool = pgMod.default?.Pool || pgMod.Pool;
  } catch (_) { /* pg not installed */ }

  try {
    const s3Mod = await import('@aws-sdk/client-s3');
    S3Client = s3Mod.S3Client;
    PutObjectCommand = s3Mod.PutObjectCommand;
    GetObjectCommand = s3Mod.GetObjectCommand;
    DeleteObjectCommand = s3Mod.DeleteObjectCommand;
  } catch (_) { /* s3 not installed */ }
});

// ── Postgres Connectivity ──────────────────────────────────────────────────

describeInfra('V2 Worker: Postgres Connectivity', () => {
  let pool = null;

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('pg module is installed', () => {
    expect(Pool).not.toBeNull();
  });

  it('connects to Postgres and runs SELECT 1', async () => {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
      database: process.env.POSTGRES_DB || 'anthena_v2',
      user: process.env.POSTGRES_USER || 'anthena',
      password: process.env.POSTGRES_PASSWORD || 'anthena_secret',
      max: 2,
      connectionTimeoutMillis: 5000,
    });

    const { rows } = await pool.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  }, 10000);

  it('has expected V2 tables after migration', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    const names = rows.map(r => r.table_name);

    expect(names).toContain('evidence_packages');
    expect(names).toContain('signals');
    expect(names).toContain('nodes');
    expect(names).toContain('clusters');
    expect(names).toContain('releases');
    expect(names).toContain('release_clusters');
    expect(names).toContain('tokens');
    expect(names).toContain('figma_logs');
    expect(names).toContain('users');
    expect(names).toContain('upload_tokens');
  });
});

// ── MinIO Connectivity ─────────────────────────────────────────────────────

describeInfra('V2 Worker: MinIO Connectivity', () => {
  let s3 = null;
  const bucket = 'evidence-pkg';
  const testKey = 'connectivity-test/package.json';
  const testBody = JSON.stringify({ test: 'connectivity', ts: Date.now() });

  afterAll(async () => {
    if (s3) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
      } catch (_) { /* cleanup best-effort */ }
      s3.destroy();
    }
  });

  it('@aws-sdk/client-s3 module is installed', () => {
    expect(S3Client).not.toBeNull();
  });

  it('connects to MinIO, writes and reads an object', async () => {
    s3 = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true,
    });

    // Write test object
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: testBody,
      ContentType: 'application/json',
    }));

    // Read it back
    const resp = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: testKey,
    }));

    const chunks = [];
    for await (const chunk of resp.Body) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');
    const parsed = JSON.parse(body);

    expect(parsed.test).toBe('connectivity');
  }, 15000);
});

// ── Worker Logic (unit) ────────────────────────────────────────────────────

describe('V2 Worker: Processing Logic', () => {
  let worker;

  beforeAll(async () => {
    worker = await import('../../src/v2/worker.js');
  });

  it('computeSignalStatus handles full package', () => {
    const pkg = {
      dom: { nodes: [{ nodeId: 'n1', rect: { x: 0, y: 0, w: 100, h: 40 } }], extractorVersion: '2.0.0' },
      css: { computed: { 'n1': { color: 'red' } }, extractorVersion: '2.0.0' },
      antd: { classMatches: { 'n1': {} }, tokens: { colorPrimary: { value: '#1677ff' } }, extractorVersion: '2.0.0' },
      fiber: { nodes: { 'n1': { confidence: 0.8 } }, extractorVersion: '2.0.0' },
      a11y: { nodes: { 'n1': {} }, extractorVersion: '2.0.0' },
    };

    const { signals, derivedStatus } = worker.computeSignalStatus(pkg);
    expect(derivedStatus).toBe('full');
    expect(signals.length).toBe(7);
    expect(signals.every(s => s.status === 'present')).toBe(true);
  });

  it('computeClusters groups by tag+class+size', () => {
    const pkg = {
      dom: {
        nodes: [
          { nodeId: 'n1', tag: 'button', classList: ['ant-btn'], rect: { x: 0, y: 0, w: 100, h: 40 } },
          { nodeId: 'n2', tag: 'button', classList: ['ant-btn'], rect: { x: 0, y: 0, w: 100, h: 40 } },
        ],
      },
    };

    const clusters = worker.computeClusters(pkg, 'ev-001');
    expect(clusters.length).toBe(1);
    expect(clusters[0].name).toBe('button');
    expect(clusters[0].usage_count).toBe(2);
  });

  it('computeTokenInventory extracts tokens', () => {
    const pkg = {
      antd: { tokens: { colorPrimary: { value: '#1677ff', source: 'runtime', confidence: 0.95 } } },
      packageId: 'pkg-001',
    };

    const tokens = worker.computeTokenInventory(pkg);
    expect(tokens.size).toBe(1);
    expect(tokens.get('colorPrimary').canonicalValue).toBe('#1677ff');
  });
});
