'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');
const { logger } = require('../utils/logger');

let db = null;

function getDbPath() {
  const dbDir = config.dbPath;
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, 'pipeline.db');
}

function createConnection() {
  const dbPath = getDbPath();
  logger.info({ dbPath }, 'Opening SQLite database');
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  return conn;
}

function getDb() {
  if (!db) {
    db = createConnection();
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Schema version 1.0.0 — 14 tables ──────────────────────────────────────

const MIGRATION_1_0_0 = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Table 1: runs
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    startedAt TEXT,
    completedAt TEXT,
    error TEXT,
    routeList TEXT NOT NULL,
    roleList TEXT NOT NULL,
    processedRoutes TEXT DEFAULT '[]',
    retryCount INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    totalRoutes INTEGER NOT NULL,
    completedRoutes INTEGER DEFAULT 0,
    configSnapshot TEXT,
    pilotContractId TEXT,
    schemaVersion TEXT DEFAULT '1.0.0'
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_createdAt ON runs(createdAt);
CREATE INDEX IF NOT EXISTS idx_runs_pilotContractId ON runs(pilotContractId);

-- Table 2: snapshots
CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    url TEXT NOT NULL,
    role TEXT NOT NULL,
    capturedAt TEXT NOT NULL,
    schemaVersion TEXT NOT NULL DEFAULT '1.0.0',
    extractorVersion TEXT,
    analyzerVersion TEXT,
    filePath TEXT NOT NULL,
    screenshotPath TEXT NOT NULL,
    cropDirPath TEXT NOT NULL,
    thumbDirPath TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'captured',
    nodeCount INTEGER DEFAULT 0,
    viewportWidth INTEGER NOT NULL,
    viewportHeight INTEGER NOT NULL,
    deviceScaleFactor REAL DEFAULT 1.0,
    error TEXT,
    isLegacy INTEGER DEFAULT 0,
    feedback TEXT,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshots_runId ON snapshots(runId);
CREATE INDEX IF NOT EXISTS idx_snapshots_url_role ON snapshots(url, role);
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(status);
CREATE INDEX IF NOT EXISTS idx_snapshots_capturedAt ON snapshots(capturedAt);

-- Table 3: nodes
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    snapshotId TEXT NOT NULL,
    nodeIdentifier TEXT,
    identity TEXT NOT NULL,
    classification TEXT NOT NULL,
    rectX REAL NOT NULL,
    rectY REAL NOT NULL,
    rectW REAL NOT NULL,
    rectH REAL NOT NULL,
    computedStyles TEXT NOT NULL,
    driftScore REAL,
    cropPath TEXT,
    visualHash TEXT,
    domTag TEXT,
    classList TEXT,
    extractedAt TEXT NOT NULL,
    FOREIGN KEY (snapshotId) REFERENCES snapshots(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nodes_snapshotId ON nodes(snapshotId);
CREATE INDEX IF NOT EXISTS idx_nodes_visualHash ON nodes(visualHash);
CREATE INDEX IF NOT EXISTS idx_nodes_driftScore ON nodes(driftScore);
CREATE INDEX IF NOT EXISTS idx_nodes_domTag ON nodes(domTag);

-- Table 4: clusters
CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    name TEXT NOT NULL,
    representativeNodeId TEXT,
    usageCount INTEGER NOT NULL DEFAULT 0,
    driftScore REAL,
    driftClassification TEXT,
    driftedProperties TEXT,
    evidenceCitations TEXT,
    priorityScore REAL,
    approvalStatus TEXT DEFAULT 'pending',
    approvalNote TEXT,
    approvedAt TEXT,
    screens TEXT NOT NULL,
    confidenceMin REAL,
    confidenceMax REAL,
    confidenceAvg REAL,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (representativeNodeId) REFERENCES nodes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_clusters_runId ON clusters(runId);
CREATE INDEX IF NOT EXISTS idx_clusters_approvalStatus ON clusters(approvalStatus);
CREATE INDEX IF NOT EXISTS idx_clusters_driftClassification ON clusters(driftClassification);
CREATE INDEX IF NOT EXISTS idx_clusters_priorityScore ON clusters(priorityScore DESC);

-- Table 5: cluster_members
CREATE TABLE IF NOT EXISTS cluster_members (
    clusterId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    PRIMARY KEY (clusterId, nodeId),
    FOREIGN KEY (clusterId) REFERENCES clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cluster_members_clusterId ON cluster_members(clusterId);
CREATE INDEX IF NOT EXISTS idx_cluster_members_nodeId ON cluster_members(nodeId);

-- Table 6: findings
CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    clusterId TEXT NOT NULL,
    priorityScore REAL NOT NULL,
    rank INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    designerFeedback TEXT,
    feedbackAt TEXT,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (clusterId) REFERENCES clusters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_findings_runId ON findings(runId);
CREATE INDEX IF NOT EXISTS idx_findings_priorityScore ON findings(priorityScore DESC);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);

-- Table 7: pilot_contracts
CREATE TABLE IF NOT EXISTS pilot_contracts (
    id TEXT PRIMARY KEY,
    operator TEXT NOT NULL,
    environment TEXT NOT NULL,
    routeList TEXT NOT NULL,
    reviewBudgetMinutes INTEGER NOT NULL,
    maxCandidates INTEGER NOT NULL,
    reviewMode TEXT NOT NULL,
    definitionOfInsight TEXT NOT NULL,
    phase0DoD TEXT NOT NULL,
    pilotDoD TEXT NOT NULL,
    topN INTEGER DEFAULT 30,
    cosignedAt TEXT,
    cosignedBy TEXT,
    createdAt TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pilot_contracts_cosignedAt ON pilot_contracts(cosignedAt);

-- Table 8: extraction_log
CREATE TABLE IF NOT EXISTS extraction_log (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    signal TEXT NOT NULL,
    confidence REAL NOT NULL,
    extractedAt TEXT NOT NULL,
    evidence TEXT,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_extraction_log_runId ON extraction_log(runId);
CREATE INDEX IF NOT EXISTS idx_extraction_log_nodeId ON extraction_log(nodeId);
CREATE INDEX IF NOT EXISTS idx_extraction_log_signal ON extraction_log(signal);

-- Table 9: delta_log
CREATE TABLE IF NOT EXISTS delta_log (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    previousRunId TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    entityId TEXT,
    description TEXT NOT NULL,
    oldValue TEXT,
    newValue TEXT,
    oldCropPath TEXT,
    newCropPath TEXT,
    url TEXT NOT NULL,
    role TEXT NOT NULL,
    detectedAt TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (previousRunId) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_delta_log_runId ON delta_log(runId);
CREATE INDEX IF NOT EXISTS idx_delta_log_type ON delta_log(type);
CREATE INDEX IF NOT EXISTS idx_delta_log_url_role ON delta_log(url, role);

-- Table 10: figma_sync_log
CREATE TABLE IF NOT EXISTS figma_sync_log (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    tokenName TEXT NOT NULL,
    tokenValue TEXT NOT NULL,
    tokenType TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    errorCode TEXT,
    errorMessage TEXT,
    syncedAt TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_figma_sync_log_runId ON figma_sync_log(runId);
CREATE INDEX IF NOT EXISTS idx_figma_sync_log_status ON figma_sync_log(status);

-- Table 11: review_rules
CREATE TABLE IF NOT EXISTS review_rules (
    id TEXT PRIMARY KEY,
    releaseId TEXT,
    type TEXT NOT NULL,
    criteriaComponentName TEXT,
    criteriaComponentType TEXT,
    criteriaScreen TEXT,
    criteriaRegex TEXT,
    description TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (releaseId) REFERENCES releases(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_review_rules_releaseId ON review_rules(releaseId);
CREATE INDEX IF NOT EXISTS idx_review_rules_type ON review_rules(type);

-- Table 12: releases
CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    versionScheme TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',
    createdAt TEXT NOT NULL,
    exportedAt TEXT,
    carrierForward INTEGER DEFAULT 0,
    description TEXT
);
CREATE INDEX IF NOT EXISTS idx_releases_state ON releases(state);

-- Table 13: governance_audit_log
CREATE TABLE IF NOT EXISTS governance_audit_log (
    id TEXT PRIMARY KEY,
    releaseId TEXT NOT NULL,
    previousState TEXT NOT NULL,
    newState TEXT NOT NULL,
    operatorId TEXT NOT NULL,
    notes TEXT,
    transitionedAt TEXT NOT NULL,
    FOREIGN KEY (releaseId) REFERENCES releases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_governance_audit_releaseId ON governance_audit_log(releaseId);

-- Table 14: designer_feedback
CREATE TABLE IF NOT EXISTS designer_feedback (
    id TEXT PRIMARY KEY,
    targetType TEXT NOT NULL,
    targetId TEXT NOT NULL,
    runId TEXT NOT NULL,
    feedbackType TEXT NOT NULL,
    feedbackValue TEXT NOT NULL,
    operatorId TEXT NOT NULL,
    recordedAt TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_designer_feedback_target ON designer_feedback(targetType, targetId);
CREATE INDEX IF NOT EXISTS idx_designer_feedback_runId ON designer_feedback(runId);
`;

// ── Schema version 1.1.0 — Capture Session tables ────────────────────────

const MIGRATION_1_1_0 = `
-- Table 15: capture_sessions
CREATE TABLE IF NOT EXISTS capture_sessions (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'extension-direct-upload',
    status TEXT NOT NULL DEFAULT 'created',
    uploadTokenHash TEXT,
    expiresAt TEXT,
    createdAt TEXT NOT NULL,
    completedAt TEXT,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_capture_sessions_runId ON capture_sessions(runId);
CREATE INDEX IF NOT EXISTS idx_capture_sessions_status ON capture_sessions(status);

-- Table 16: page_captures
CREATE TABLE IF NOT EXISTS page_captures (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    sessionId TEXT NOT NULL,
    routeKey TEXT NOT NULL,
    url TEXT,
    title TEXT,
    capturedAt TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    uploadStatus TEXT,
    stitchStatus TEXT,
    screenshotPath TEXT,
    snapshotPath TEXT,
    viewportWidth INTEGER,
    viewportHeight INTEGER,
    deviceScaleFactor REAL DEFAULT 1.0,
    FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (sessionId) REFERENCES capture_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_page_captures_runId ON page_captures(runId);
CREATE INDEX IF NOT EXISTS idx_page_captures_sessionId ON page_captures(sessionId);
CREATE INDEX IF NOT EXISTS idx_page_captures_routeKey ON page_captures(routeKey);
CREATE INDEX IF NOT EXISTS idx_page_captures_status ON page_captures(status);

-- Table 17: upload_tokens
CREATE TABLE IF NOT EXISTS upload_tokens (
    id TEXT PRIMARY KEY,
    tokenHash TEXT NOT NULL UNIQUE,
    sessionId TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'upload:page',
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    revokedAt TEXT,
    FOREIGN KEY (sessionId) REFERENCES capture_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_sessionId ON upload_tokens(sessionId);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_tokenHash ON upload_tokens(tokenHash);
`;

function runMigrations() {
  const conn = getDb();
  
  // First, ensure schema_version table exists (better-sqlite3 throws if table missing)
  conn.exec("CREATE TABLE IF NOT EXISTS schema_version (version TEXT PRIMARY KEY, appliedAt TEXT NOT NULL DEFAULT (datetime('now')))");
  
  // Check current schema version
  const currentVersion = conn.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
  
  if (!currentVersion) {
    logger.info('Applying initial schema migration v1.0.0');
    conn.exec(MIGRATION_1_0_0);
    conn.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES ('1.0.0')").run();
    logger.info('Schema migration v1.0.0 applied');
    // Apply v1.1.0 immediately for fresh installs
    logger.info('Applying schema migration v1.1.0');
    conn.exec(MIGRATION_1_1_0);
    conn.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES ('1.1.0')").run();
    logger.info('Schema migration v1.1.0 applied');
  } else {
    const version = currentVersion.version;
    logger.info({ version }, 'Current database schema version');
    
    if (version === '1.0.0' || version < '1.1.0') {
      logger.info('Applying schema migration v1.1.0');
      conn.exec(MIGRATION_1_1_0);
      conn.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES ('1.1.0')").run();
      logger.info('Schema migration v1.1.0 applied');
    } else {
      logger.info({ version }, 'Database schema already up to date');
    }
  }
}

function seedDefaults() {
  const conn = getDb();
  // Seed a default pilot contract draft if none exists
  const existing = conn.prepare("SELECT id FROM pilot_contracts LIMIT 1").get();
  if (!existing) {
    const now = new Date().toISOString();
    conn.prepare(`
      INSERT INTO pilot_contracts (id, operator, environment, routeList, reviewBudgetMinutes, maxCandidates, reviewMode, definitionOfInsight, phase0DoD, pilotDoD, topN, createdAt, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ctr-draft-0000', '', 'dev', '[]', 30, 50, 'component-cluster',
      '["Identify components that diverge from Ant Design defaults"]',
      '["Signal reliability report generated"]',
      '["All routes crawled successfully"]',
      30, now, 1
    );
    logger.info('Seeded default pilot contract draft');
  }
}

/**
 * Get the capture_sessions db helper — returns same connection.
 * Convenience for routes needing capture_sessions queries.
 */
function getCaptureSessionDb() {
  return getDb();
}

/**
 * Get the page_captures db helper — returns same connection.
 * Convenience for routes needing page_captures queries.
 */
function getPageCaptureDb() {
  return getDb();
}

function initialize() {
  runMigrations();
  seedDefaults();
  return getDb();
}

module.exports = { getDb, closeDb, initialize, getCaptureSessionDb, getPageCaptureDb };