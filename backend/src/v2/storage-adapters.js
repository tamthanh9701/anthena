/**
 * V2 Storage Adapters — In-Memory (Test), MinIO (S3), Postgres (Production)
 *
 * Deterministic in-memory adapters for local dev/test.
 * Production uses MinIO S3 + Postgres via env vars:
 *   - V2_ENABLED=true + POSTGRES_HOST=...  → PostgresMetadataDB
 *   - MINIO_ENDPOINT=...                   → MinIOS3EvidenceStore
 */

'use strict';

const crypto = require('crypto');

// ── Lazy optional deps ─────────────────────────────────────────────────────

let S3Client = null;
let PutObjectCommand = null;
let GetObjectCommand = null;
let HeadObjectCommand = null;
let DeleteObjectCommand = null;
let ListObjectsV2Command = null;
let DeleteObjectsCommand = null;
let NoSuchKey = null;

try {
  const s3 = require('@aws-sdk/client-s3');
  S3Client = s3.S3Client;
  PutObjectCommand = s3.PutObjectCommand;
  GetObjectCommand = s3.GetObjectCommand;
  HeadObjectCommand = s3.HeadObjectCommand;
  DeleteObjectCommand = s3.DeleteObjectCommand;
  ListObjectsV2Command = s3.ListObjectsV2Command;
  DeleteObjectsCommand = s3.DeleteObjectsCommand;
  NoSuchKey = s3.NoSuchKey;
} catch (_) { /* optional dep — not installed in test/CI */ }

let pgPool = null;
const PG = (() => {
  try { return require('pg'); } catch (_) { return null; }
})();

// ── In-Memory Evidence Store ───────────────────────────────────────────────

class InMemoryEvidenceStore {
  constructor() {
    this._store = new Map(); // captureId → Buffer
    this._meta = new Map();  // captureId → metadata object
  }

  /**
   * Store evidence package bytes.
   * @param {string} captureId
   * @param {Buffer} buffer
   * @param {object} metadata
   * @returns {{ captureId: string, size: number, stored: boolean }}
   */
  put(captureId, buffer, metadata = {}) {
    const exists = this._store.has(captureId);
    this._store.set(captureId, buffer);
    this._meta.set(captureId, {
      ...metadata,
      captureId,
      size: buffer.length,
      storedAt: new Date().toISOString(),
      hash: metadata.hash || this._sha256(buffer),
    });
    return {
      captureId,
      size: buffer.length,
      stored: !exists, // true for new, false for idempotent overwrite
      existed: exists,
    };
  }

  /**
   * Get evidence package bytes.
   * @param {string} captureId
   * @returns {Buffer|null}
   */
  get(captureId) {
    return this._store.get(captureId) || null;
  }

  /**
   * Get metadata for a capture.
   */
  getMeta(captureId) {
    return this._meta.get(captureId) || null;
  }

  /**
   * Check if capture exists.
   */
  has(captureId) {
    return this._store.has(captureId);
  }

  /**
   * Delete evidence package.
   */
  delete(captureId) {
    const existed = this._store.has(captureId);
    this._store.delete(captureId);
    this._meta.delete(captureId);
    return existed;
  }

  /**
   * List all captures.
   */
  list() {
    return Array.from(this._meta.values());
  }

  /**
   * Clear all stored data.
   */
  clear() {
    this._store.clear();
    this._meta.clear();
  }

  _sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

// ── MinIO S3 Evidence Store ────────────────────────────────────────────────

class MinIOS3EvidenceStore {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint         — e.g. 'http://localhost:9000'
   * @param {string} opts.region           — default 'us-east-1'
   * @param {string} opts.accessKeyId
   * @param {string} opts.secretAccessKey
   * @param {string} opts.bucket           — default 'evidence-pkg'
   * @param {boolean} opts.forcePathStyle  — default true (MinIO requirement)
   */
  constructor(opts = {}) {
    if (!S3Client) {
      throw new Error(
        '@aws-sdk/client-s3 not installed. Run: npm install @aws-sdk/client-s3'
      );
    }
    this._bucket = opts.bucket || 'evidence-pkg';
    this._client = new S3Client({
      endpoint: opts.endpoint || process.env.MINIO_ENDPOINT || 'http://localhost:9000',
      region: opts.region || process.env.MINIO_REGION || 'us-east-1',
      credentials: {
        accessKeyId: opts.accessKeyId || process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: opts.secretAccessKey || process.env.MINIO_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: opts.forcePathStyle !== undefined ? opts.forcePathStyle : true,
    });
  }

  _objectKey(captureId) {
    return `${captureId}/package.json`;
  }

  async put(captureId, buffer, metadata = {}) {
    const key = this._objectKey(captureId);
    let existed = false;

    try {
      await this._client.send(new HeadObjectCommand({
        Bucket: this._bucket,
        Key: key,
      }));
      existed = true;
    } catch (err) {
      // NotFound/NoSuchKey means new object — expected path
    }

    const hash = metadata.hash || crypto.createHash('sha256').update(buffer).digest('hex');

    const s3Metadata = {
      'capture-id': captureId,
      hash,
      'stored-at': new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(metadata)) {
      if (k !== 'hash') s3Metadata[k] = String(v);
    }

    await this._client.send(new PutObjectCommand({
      Bucket: this._bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/json',
      Metadata: s3Metadata,
    }));

    return {
      captureId,
      size: buffer.length,
      stored: !existed,
      existed,
    };
  }

  async get(captureId) {
    const key = this._objectKey(captureId);
    try {
      const resp = await this._client.send(new GetObjectCommand({
        Bucket: this._bucket,
        Key: key,
      }));
      const chunks = [];
      for await (const chunk of resp.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.name === 'NotFound') return null;
      throw err;
    }
  }

  async getMeta(captureId) {
    const key = this._objectKey(captureId);
    try {
      const resp = await this._client.send(new HeadObjectCommand({
        Bucket: this._bucket,
        Key: key,
      }));
      return {
        captureId,
        size: resp.ContentLength,
        storedAt: resp.Metadata?.['stored-at'] || null,
        hash: resp.Metadata?.hash || null,
        contentType: resp.ContentType,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async has(captureId) {
    const meta = await this.getMeta(captureId);
    return meta !== null;
  }

  async delete(captureId) {
    const key = this._objectKey(captureId);
    try {
      await this._client.send(new DeleteObjectCommand({
        Bucket: this._bucket,
        Key: key,
      }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') return false;
      throw err;
    }
  }

  async list() {
    const results = [];
    let continuationToken;
    do {
      const resp = await this._client.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: '',
        ContinuationToken: continuationToken,
      }));
      for (const obj of (resp.Contents || [])) {
        const captureId = obj.Key ? obj.Key.split('/')[0] : null;
        if (captureId) {
          results.push({
            captureId,
            size: obj.Size,
            storedAt: obj.LastModified?.toISOString(),
            hash: null,
          });
        }
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return results;
  }

  async clear() {
    const toDelete = [];
    let continuationToken;
    do {
      const resp = await this._client.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        ContinuationToken: continuationToken,
      }));
      for (const obj of (resp.Contents || [])) {
        if (obj.Key) toDelete.push({ Key: obj.Key });
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);

    if (toDelete.length > 0) {
      await this._client.send(new DeleteObjectsCommand({
        Bucket: this._bucket,
        Delete: { Objects: toDelete },
      }));
    }
  }
}

// ── In-Memory Metadata DB ─────────────────────────────────────────────────

class InMemoryMetadataDB {
  constructor() {
    this.evidence = new Map();       // evidenceId → row
    this.signals = new Map();        // signalId → row
    this.nodes = new Map();          // nodeId → row
    this.clusters = new Map();       // clusterId → row
    this.releases = new Map();       // releaseId → row
    this.releaseClusters = new Map(); // `${releaseId}:${clusterId}` → row
    this.tokens = new Map();         // tokenName → row
    this.figmaLog = new Map();       // logId → row
  }

  // Evidence
  insertEvidence(row) {
    this.evidence.set(row.id, { ...row, created_at: new Date().toISOString() });
    return row;
  }

  getEvidence(id) {
    return this.evidence.get(id) || null;
  }

  getEvidenceByCaptureId(captureId) {
    for (const e of this.evidence.values()) {
      if (e.capture_id === captureId) return e;
    }
    return null;
  }

  listEvidence(filter = {}) {
    let results = Array.from(this.evidence.values());
    if (filter.status) results = results.filter(e => e.status === filter.status);
    if (filter.manifestId) results = results.filter(e => e.manifest_id === filter.manifestId);
    if (filter.url) results = results.filter(e => e.url === filter.url);
    return results.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  }

  updateEvidenceStatus(id, status, extra = {}) {
    const e = this.evidence.get(id);
    if (!e) return null;
    Object.assign(e, { status, ...extra });
    return e;
  }

  // Signals
  insertSignal(row) {
    this.signals.set(row.id, row);
    return row;
  }

  getSignalsByEvidence(evidenceId) {
    return Array.from(this.signals.values()).filter(s => s.evidence_package_id === evidenceId);
  }

  // Nodes
  insertNode(row) {
    this.nodes.set(row.id, row);
    return row;
  }

  getNodesByEvidence(evidenceId) {
    return Array.from(this.nodes.values()).filter(n => n.evidence_package_id === evidenceId);
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  // Clusters
  insertCluster(row) {
    this.clusters.set(row.id, row);
    return row;
  }

  listClusters(filter = {}) {
    let results = Array.from(this.clusters.values());
    if (filter.releaseId) {
      const clusterIds = new Set(
        Array.from(this.releaseClusters.values())
          .filter(rc => rc.release_id === filter.releaseId)
          .map(rc => rc.cluster_id)
      );
      results = results.filter(c => clusterIds.has(c.id));
    }
    if (filter.approvalStatus) results = results.filter(c => c.approval_status === filter.approvalStatus);
    if (filter.driftClassification) results = results.filter(c => c.drift_classification === filter.driftClassification);
    return results.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  }

  updateCluster(id, updates) {
    const c = this.clusters.get(id);
    if (!c) return null;
    Object.assign(c, updates);
    return c;
  }

  getCluster(id) {
    return this.clusters.get(id) || null;
  }

  // Release Clusters
  insertReleaseCluster(row) {
    const key = `${row.release_id}:${row.cluster_id}`;
    this.releaseClusters.set(key, row);
    return row;
  }

  getReleaseClusters(releaseId) {
    return Array.from(this.releaseClusters.values())
      .filter(rc => rc.release_id === releaseId);
  }

  // Releases
  insertRelease(row) {
    this.releases.set(row.id, row);
    return row;
  }

  getRelease(id) {
    return this.releases.get(id) || null;
  }

  listReleases(filter = {}) {
    let results = Array.from(this.releases.values());
    if (filter.status) results = results.filter(r => r.status === filter.status);
    return results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  updateReleaseStatus(id, status, extra = {}) {
    const r = this.releases.get(id);
    if (!r) return null;
    Object.assign(r, { status, ...extra });
    return r;
  }

  // Tokens
  upsertToken(tokenName, row) {
    this.tokens.set(tokenName, row);
    return row;
  }

  getToken(tokenName) {
    return this.tokens.get(tokenName) || null;
  }

  listTokens() {
    return Array.from(this.tokens.values());
  }

  // Figma Log
  insertFigmaLog(row) {
    this.figmaLog.set(row.id, row);
    return row;
  }

  getFigmaLogByRelease(releaseId) {
    return Array.from(this.figmaLog.values())
      .filter(l => l.release_id === releaseId);
  }

  clear() {
    this.evidence.clear();
    this.signals.clear();
    this.nodes.clear();
    this.clusters.clear();
    this.releases.clear();
    this.releaseClusters.clear();
    this.tokens.clear();
    this.figmaLog.clear();
  }
}

// ── Postgres Metadata DB ──────────────────────────────────────────────────

class PostgresMetadataDB {
  /**
   * @param {object} opts
   * @param {import('pg').Pool} opts.pool — shared pg.Pool instance
   */
  constructor(opts = {}) {
    this._pool = opts.pool;
    if (!this._pool) {
      throw new Error('PostgresMetadataDB requires a pg.Pool');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _json(val) {
    if (val === undefined || val === null) return null;
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  _jsonDefault(val, def) {
    if (val === undefined || val === null) return def;
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  // ── Evidence ───────────────────────────────────────────────────────────

  async insertEvidence(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO evidence_packages (
        id, capture_id, manifest_id, url, status, schema_version, metadata,
        minio_bucket, minio_package_key, minio_screenshot_key,
        package_hash, integrity_verified, captured_at,
        processing_completed_at, signal_gaps, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        signal_gaps = EXCLUDED.signal_gaps,
        updated_at = now()
      RETURNING *`,
      [
        row.id, row.capture_id, row.manifest_id || null, row.url,
        row.status || 'received', row.schema_version || '2.0.0',
        this._json(row.metadata),
        row.minio_bucket || null, row.minio_package_key || null, row.minio_screenshot_key || null,
        row.package_hash || null, row.integrity_verified ? true : false,
        row.captured_at, row.processing_completed_at || null,
        this._jsonDefault(row.signal_gaps, '[]'),
        row.created_at || new Date().toISOString(),
      ]
    );
    return rows[0];
  }

  async getEvidence(id) {
    const { rows } = await this._pool.query(
      'SELECT * FROM evidence_packages WHERE id = $1', [id]
    );
    return rows[0] || null;
  }

  async getEvidenceByCaptureId(captureId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM evidence_packages WHERE capture_id = $1', [captureId]
    );
    return rows[0] || null;
  }

  async listEvidence(filter = {}) {
    const clauses = [];
    const params = [];
    let idx = 1;
    if (filter.status) { clauses.push(`status = $${idx++}`); params.push(filter.status); }
    if (filter.manifestId) { clauses.push(`manifest_id = $${idx++}`); params.push(filter.manifestId); }
    if (filter.url) { clauses.push(`url = $${idx++}`); params.push(filter.url); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this._pool.query(
      `SELECT * FROM evidence_packages ${where} ORDER BY captured_at DESC`,
      params
    );
    return rows;
  }

  async updateEvidenceStatus(id, status, extra = {}) {
    const setClauses = ['status = $2'];
    const params = [id, status];
    let idx = 3;
    for (const [key, value] of Object.entries(extra)) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
    const { rows } = await this._pool.query(
      `UPDATE evidence_packages SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  // ── Signals ────────────────────────────────────────────────────────────

  async insertSignal(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO signals (
        id, evidence_package_id, signal, severity, status,
        confidence, node_count, capture_evidence_path,
        extractor_version, error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        confidence = EXCLUDED.confidence,
        error = EXCLUDED.error
      RETURNING *`,
      [
        row.id, row.evidence_package_id, row.signal, row.severity, row.status,
        row.confidence, row.node_count || 0, row.capture_evidence_path || null,
        row.extractor_version || null, row.error || null,
      ]
    );
    return rows[0];
  }

  async getSignalsByEvidence(evidenceId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM signals WHERE evidence_package_id = $1', [evidenceId]
    );
    return rows;
  }

  // ── Nodes ──────────────────────────────────────────────────────────────

  async insertNode(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO nodes (
        id, evidence_package_id, node_id, parent_node_id, tag,
        class_list, attributes, rect, text_content,
        computed_styles, antd_class_matches, antd_tokens,
        fiber_identity, a11y_properties,
        drift_score, drift_classification, visual_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        tag = EXCLUDED.tag,
        class_list = EXCLUDED.class_list,
        computed_styles = EXCLUDED.computed_styles,
        drift_score = EXCLUDED.drift_score,
        drift_classification = EXCLUDED.drift_classification
      RETURNING *`,
      [
        row.id, row.evidence_package_id, row.node_id, row.parent_node_id || null,
        row.tag,
        this._jsonDefault(row.class_list, '[]'),
        this._jsonDefault(row.attributes, '{}'),
        this._jsonDefault(row.rect, '{}'),
        row.text_content || null,
        this._jsonDefault(row.computed_styles, '{}'),
        this._json(row.antd_class_matches),
        this._json(row.antd_tokens),
        this._jsonDefault(row.fiber_identity, '{}'),
        this._jsonDefault(row.a11y_properties, '{}'),
        row.drift_score !== undefined ? row.drift_score : null,
        row.drift_classification || null,
        row.visual_hash || null,
      ]
    );
    return rows[0];
  }

  async getNodesByEvidence(evidenceId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM nodes WHERE evidence_package_id = $1', [evidenceId]
    );
    return rows;
  }

  async getNode(id) {
    const { rows } = await this._pool.query(
      'SELECT * FROM nodes WHERE id = $1', [id]
    );
    return rows[0] || null;
  }

  // ── Clusters ───────────────────────────────────────────────────────────

  async insertCluster(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO clusters (
        id, name, evidence_package_ids, member_node_ids,
        usage_count, drift_classification, drift_score,
        drifted_properties, priority_score,
        confidence_distribution, approval_status, approval_note,
        screens, fingerprint, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        usage_count = EXCLUDED.usage_count,
        drift_classification = EXCLUDED.drift_classification,
        drift_score = EXCLUDED.drift_score,
        drifted_properties = EXCLUDED.drifted_properties,
        priority_score = EXCLUDED.priority_score,
        approval_status = EXCLUDED.approval_status,
        updated_at = now()
      RETURNING *`,
      [
        row.id, row.name,
        this._jsonDefault(row.evidence_package_ids, '[]'),
        this._jsonDefault(row.member_node_ids, '[]'),
        row.usage_count || 0,
        row.drift_classification || null,
        row.drift_score !== undefined ? row.drift_score : null,
        this._jsonDefault(row.drifted_properties, '[]'),
        row.priority_score !== undefined ? row.priority_score : null,
        this._json(row.confidence_distribution),
        row.approval_status || 'pending',
        row.approval_note || null,
        this._jsonDefault(row.screens, '[]'),
        this._json(row.fingerprint),
        row.created_at || new Date().toISOString(),
      ]
    );
    return rows[0];
  }

  async listClusters(filter = {}) {
    const clauses = [];
    const params = [];
    let idx = 1;

    if (filter.releaseId) {
      clauses.push(`id IN (SELECT cluster_id FROM release_clusters WHERE release_id = $${idx++})`);
      params.push(filter.releaseId);
    }
    if (filter.approvalStatus) {
      clauses.push(`approval_status = $${idx++}`);
      params.push(filter.approvalStatus);
    }
    if (filter.driftClassification) {
      clauses.push(`drift_classification = $${idx++}`);
      params.push(filter.driftClassification);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this._pool.query(
      `SELECT * FROM clusters ${where} ORDER BY COALESCE(priority_score, 0) DESC`,
      params
    );
    return rows;
  }

  async updateCluster(id, updates) {
    const setClauses = [];
    const params = [id];
    let idx = 2;
    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
    if (setClauses.length === 0) return null;
    const { rows } = await this._pool.query(
      `UPDATE clusters SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async getCluster(id) {
    const { rows } = await this._pool.query(
      'SELECT * FROM clusters WHERE id = $1', [id]
    );
    return rows[0] || null;
  }

  // ── Release Clusters ──────────────────────────────────────────────────

  async insertReleaseCluster(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO release_clusters (
        id, release_id, cluster_id, approval_status,
        override_outcome, override_details, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (release_id, cluster_id) DO UPDATE SET
        approval_status = EXCLUDED.approval_status,
        override_outcome = EXCLUDED.override_outcome,
        override_details = EXCLUDED.override_details
      RETURNING *`,
      [
        row.id || `${row.release_id}:${row.cluster_id}`,
        row.release_id, row.cluster_id,
        row.approval_status || 'pending',
        row.override_outcome || null,
        typeof row.override_details === 'string' ? row.override_details : this._json(row.override_details),
        row.created_at || new Date().toISOString(),
      ]
    );
    return rows[0];
  }

  async getReleaseClusters(releaseId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM release_clusters WHERE release_id = $1', [releaseId]
    );
    return rows;
  }

  // ── Releases ───────────────────────────────────────────────────────────

  async insertRelease(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO releases (
        id, name, version, description, status,
        included_evidence_ids, token_overrides,
        created_at, published_at, is_published,
        figma_file_id, figma_clone_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        description = EXCLUDED.description,
        updated_at = now()
      RETURNING *`,
      [
        row.id, row.name, row.version, row.description || null,
        row.status || 'draft',
        this._jsonDefault(row.included_evidence_ids, '[]'),
        this._json(row.token_overrides),
        row.created_at || new Date().toISOString(),
        row.published_at || null,
        row.is_published ? true : false,
        row.figma_file_id || null,
        row.figma_clone_id || null,
      ]
    );
    return rows[0];
  }

  async getRelease(id) {
    const { rows } = await this._pool.query(
      'SELECT * FROM releases WHERE id = $1', [id]
    );
    return rows[0] || null;
  }

  async listReleases(filter = {}) {
    const clauses = [];
    const params = [];
    let idx = 1;
    if (filter.status) { clauses.push(`status = $${idx++}`); params.push(filter.status); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this._pool.query(
      `SELECT * FROM releases ${where} ORDER BY created_at DESC`,
      params
    );
    return rows;
  }

  async updateReleaseStatus(id, status, extra = {}) {
    const setClauses = ['status = $2'];
    const params = [id, status];
    let idx = 3;
    for (const [key, value] of Object.entries(extra)) {
      setClauses.push(`${key} = $${idx++}`);
      params.push(value);
    }
    const { rows } = await this._pool.query(
      `UPDATE releases SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  // ── Tokens ─────────────────────────────────────────────────────────────

  async upsertToken(tokenName, row) {
    const { rows } = await this._pool.query(
      `INSERT INTO tokens (
        token_name, canonical_value, antd_default_value, data_type,
        variant_count, variants, usage_across_screens,
        usage_count, drift_status, drift_detail,
        last_evidence_id, last_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (token_name) DO UPDATE SET
        canonical_value = EXCLUDED.canonical_value,
        variant_count = EXCLUDED.variant_count,
        variants = EXCLUDED.variants,
        usage_across_screens = EXCLUDED.usage_across_screens,
        usage_count = EXCLUDED.usage_count,
        drift_status = EXCLUDED.drift_status,
        drift_detail = EXCLUDED.drift_detail,
        last_evidence_id = EXCLUDED.last_evidence_id,
        last_updated_at = EXCLUDED.last_updated_at
      RETURNING *`,
      [
        tokenName,
        row.canonicalValue,
        row.antdDefaultValue || null,
        row.dataType || 'string',
        row.variantCount || (Array.isArray(row.variants) ? row.variants.length : 1),
        this._jsonDefault(row.variants, '[]'),
        this._jsonDefault(row.usageAcrossScreens, '[]'),
        row.usageCount || 0,
        row.driftStatus || null,
        row.driftDetail || null,
        row.lastEvidenceId || null,
        new Date().toISOString(),
      ]
    );
    return rows[0];
  }

  async getToken(tokenName) {
    const { rows } = await this._pool.query(
      'SELECT * FROM tokens WHERE token_name = $1', [tokenName]
    );
    return rows[0] || null;
  }

  async listTokens() {
    const { rows } = await this._pool.query(
      'SELECT * FROM tokens ORDER BY token_name'
    );
    return rows;
  }

  // ── Figma Log ──────────────────────────────────────────────────────────

  async insertFigmaLog(row) {
    const { rows } = await this._pool.query(
      `INSERT INTO figma_logs (
        id, release_id, status, file_id, clone_id,
        token_count, cluster_count, error, published_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        row.id, row.release_id, row.status || 'published',
        row.file_id || null, row.clone_id || null,
        row.token_count || 0, row.cluster_count || 0,
        row.error || null,
        row.published_at || new Date().toISOString(),
        row.created_at || new Date().toISOString(),
      ]
    );
    return rows[0];
  }

  async getFigmaLogByRelease(releaseId) {
    const { rows } = await this._pool.query(
      'SELECT * FROM figma_logs WHERE release_id = $1 ORDER BY created_at DESC',
      [releaseId]
    );
    return rows;
  }

  // ── Clear ───────────────────────────────────────────────────────────────

  async clear() {
    // Disable FK checks for truncation safety
    await this._pool.query('SET session_replication_role = replica');
    await this._pool.query('TRUNCATE TABLE figma_logs, release_clusters, tokens, releases, clusters, nodes, signals, evidence_packages, upload_tokens, users RESTART IDENTITY CASCADE');
    await this._pool.query('SET session_replication_role = DEFAULT');
  }
}

// ── Figma Mock Publisher (Deterministic, Idempotent) ───────────────────────

class FigmaMockPublisher {
  constructor() {
    this._published = new Map(); // releaseId → publish result
    this._tokens = new Map();    // releaseId → tokens published
  }

  /**
   * Publish tokens to (mock) Figma.
   * Idempotent: second publish for same release is no-op.
   * @param {string} releaseId
   * @param {object[]} tokens
   * @returns {{ status: string, fileId: string, cloneId: string, tokensPublished: number, published: boolean }}
   */
  publish(releaseId, tokens = []) {
    if (this._published.has(releaseId)) {
      const prev = this._published.get(releaseId);
      return {
        ...prev,
        published: false,
        note: 'Release already published. No-op.',
      };
    }

    const fileId = `figma-file-${releaseId.slice(0, 8)}`;
    const cloneId = `figma-clone-${releaseId.slice(0, 8)}`;
    const result = {
      status: 'published',
      fileId,
      cloneId,
      tokensPublished: tokens.length,
      published: true,
      publishedAt: new Date().toISOString(),
    };

    this._published.set(releaseId, result);
    this._tokens.set(releaseId, [...tokens]);
    return result;
  }

  /**
   * Get published tokens for a release.
   */
  getPublished(releaseId) {
    return {
      result: this._published.get(releaseId) || null,
      tokens: this._tokens.get(releaseId) || [],
    };
  }

  clear() {
    this._published.clear();
    this._tokens.clear();
  }
}

// ── Lazy singleton pool for Postgres ───────────────────────────────────────

function _getPgPool() {
  if (pgPool) return pgPool;
  if (!PG) {
    throw new Error('pg module not installed. Run: npm install pg');
  }
  pgPool = new PG.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'evidence_pipeline',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: parseInt(process.env.POSTGRES_POOL_MAX, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return pgPool;
}

// ── Singleton exports ──────────────────────────────────────────────────────

let _evidenceStore = null;
let _metadataDb = null;
let _figmaPublisher = null;
let _initialized = false;

function _initAdapters() {
  if (_initialized) return;
  _initialized = true;

  const v2Enabled = process.env.V2_ENABLED === 'true' || process.env.V2_ENABLED === '1';
  const pgHost = process.env.POSTGRES_HOST;
  const minioEndpoint = process.env.MINIO_ENDPOINT;

  // Evidence store: MinIO if configured, else in-memory
  if (v2Enabled && minioEndpoint) {
    _evidenceStore = new MinIOS3EvidenceStore();
  } else {
    _evidenceStore = new InMemoryEvidenceStore();
  }

  // Metadata DB: Postgres if configured, else in-memory
  if (v2Enabled && pgHost) {
    const pool = _getPgPool();
    _metadataDb = new PostgresMetadataDB({ pool });
  } else {
    _metadataDb = new InMemoryMetadataDB();
  }

  // Figma publisher is always mock for now
  _figmaPublisher = new FigmaMockPublisher();
}

function getEvidenceStore() {
  if (!_evidenceStore) _initAdapters();
  return _evidenceStore;
}

function getMetadataDb() {
  if (!_metadataDb) _initAdapters();
  return _metadataDb;
}

function getFigmaPublisher() {
  if (!_figmaPublisher) _initAdapters();
  return _figmaPublisher;
}

function resetAll() {
  if (_evidenceStore) _evidenceStore.clear();
  if (_metadataDb) _metadataDb.clear();
  if (_figmaPublisher) _figmaPublisher.clear();
  // Do NOT null singletons — routes hold function references that resolve per call.
  // Clearing internal state is sufficient for test isolation.
  // _initialized stays true so that the same object identities are reused.
}

function forceInit(opts = {}) {
  // For testing: force a specific adapter configuration
  if (opts.evidenceStore) _evidenceStore = opts.evidenceStore;
  if (opts.metadataDb) _metadataDb = opts.metadataDb;
  if (opts.figmaPublisher) _figmaPublisher = opts.figmaPublisher;
  _initialized = true;
}

module.exports = {
  InMemoryEvidenceStore,
  MinIOS3EvidenceStore,
  InMemoryMetadataDB,
  PostgresMetadataDB,
  FigmaMockPublisher,
  getEvidenceStore,
  getMetadataDb,
  getFigmaPublisher,
  resetAll,
  forceInit,
};
