/**
 * @file setup.test.js
 * @description Integration test setup with in-memory SQLite and Express app
 * 
 * Creates an in-memory database and seeds schema for integration tests.
 * Tests requiring the full Express app should import from here and create
 * their own supertest instance.
 * 
 * NOTE: The integration tests are designed as contract tests.
 * They verify the API contracts defined in contract.yaml.
 * To run against the real Express app, the test setup needs to:
 *   1. Create an in-memory SQLite database
 *   2. Mock the config to use test values
 *   3. Create the Express app with all routes
 * 
 * These are currently structured as behavior-verification tests
 * that validate the expected API contract responses.
 * They can be run as-is once the Express app is created, or paired
 * with a simple Express stub for early validation.
 */

import Database from "better-sqlite3";
import path from "path";

/**
 * Creates an in-memory SQLite database with the full schema from db-schema.md.
 */
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  db.exec(`
    CREATE TABLE pilot_contracts (
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

    CREATE TABLE runs (
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

    CREATE INDEX idx_runs_status ON runs(status);
    CREATE INDEX idx_runs_pilotContractId ON runs(pilotContractId);

    CREATE TABLE snapshots (
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

    CREATE TABLE nodes (
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

    CREATE TABLE clusters (
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

    CREATE TABLE clusters_members (
      clusterId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      PRIMARY KEY (clusterId, nodeId),
      FOREIGN KEY (clusterId) REFERENCES clusters(id) ON DELETE CASCADE,
      FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE findings (
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

    CREATE TABLE designer_feedback (
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
  `);

  return db;
}

module.exports = { createTestDb };
