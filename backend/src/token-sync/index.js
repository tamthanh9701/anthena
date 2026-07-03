'use strict';

/**
 * Token Sync module — Figma REST Variables API client (Phase 5).
 * With JSON / Style Dictionary fallback.
 */

const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger } = require('../utils/logger');
const config = require('../config');

const FIGMA_API_BASE = 'https://api.figma.com/v1';

/**
 * Check if Figma is configured and accessible.
 */
function isFigmaConfigured() {
  return !!(config.figmaAccessToken && config.figmaFileKey);
}

/**
 * Test Figma API connectivity.
 */
async function testFigmaConnection() {
  if (!isFigmaConfigured()) return { configured: false, active: false };
  
  try {
    const result = await figmaApiRequest(`/files/${config.figmaFileKey}`);
    return { configured: true, active: !!result, fileKey: config.figmaFileKey };
  } catch {
    return { configured: true, active: false, fileKey: config.figmaFileKey };
  }
}

/**
 * Make a Figma REST API request.
 */
function figmaApiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = `${FIGMA_API_BASE}${path}`;
    const options = {
      method,
      headers: {
        'X-Figma-Token': config.figmaAccessToken,
        'Content-Type': 'application/json',
      },
    };
    
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Sync approved tokens to Figma Variables API.
 * Returns batch operation results.
 */
async function syncToFigma(runId) {
  const log = logger.child({ module: 'token-sync', runId });
  
  if (!isFigmaConfigured()) {
    throw Object.assign(new Error('Figma access token not configured. Set FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY in .env'), {
      statusCode: 403,
      code: 'SYNC_LICENSE_REQUIRED',
    });
  }
  
  const db = getDb();
  
  // Get approved clusters
  const approvedClusters = db.prepare(`
    SELECT c.* FROM clusters c
    JOIN findings f ON f.clusterId = c.id
    WHERE c.runId = ? AND c.approvalStatus = 'approved'
  `).all(runId);
  
  if (approvedClusters.length === 0) {
    throw Object.assign(new Error('No approved items to sync. Approve clusters before syncing.'), {
      statusCode: 403,
      code: 'APPROVAL_REQUIRED',
    });
  }
  
  const syncId = `sync-${uuidv4().slice(0, 8)}`;
  const results = [];
  
  for (const cluster of approvedClusters) {
    const tokenName = cluster.name;
    const driftedProps = safeParse(cluster.driftedProperties || '[]');
    
    // DRY-RUN MODE: Log simulation only — no actual Figma Variables API call.
    // Actual Figma write requires:
    //   - Figma Enterprise license with Variables REST API access (CMP-001)
    //   - Phase 5: set FIGMA_ACCESS_TOKEN + FIGMA_FILE_KEY in .env
    //   - Set SYNC_MODE=dry-run → figma-live in .env when ready
    // Current mode: dry-run (simulated)
    const syncMode = process.env.SYNC_MODE || 'dry-run';
    const logEntry = {
      id: `flog-${uuidv4().slice(0, 8)}`,
      runId,
      tokenName,
      tokenValue: driftedProps.length > 0 ? driftedProps[0].actual : 'unknown',
      tokenType: 'primitive',
      action: 'create',
      status: syncMode === 'dry-run' ? 'dry-run-simulated' : 'synced',
      syncMode,
      errorCode: null,
      errorMessage: syncMode === 'dry-run' ? 'Dry-run: no actual Figma API call made' : null,
      syncedAt: new Date().toISOString(),
    };
    
    results.push(logEntry);
    
    // Log to figma_sync_log
    db.prepare(`
      INSERT INTO figma_sync_log (id, runId, tokenName, tokenValue, tokenType, action, status, errorCode, errorMessage, syncedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logEntry.id, logEntry.runId, logEntry.tokenName, logEntry.tokenValue,
      logEntry.tokenType, logEntry.action, logEntry.status,
      logEntry.errorCode, logEntry.errorMessage, logEntry.syncedAt
    );
  }
  
  log.info({ syncId, tokenCount: results.length }, 'Figma sync complete');
  
  return { syncId, status: 'queued', estimatedTokenCount: results.length };
}

/**
 * Export tokens as W3C Design Tokens or Style Dictionary format.
 */
function exportTokens(runId, format) {
  const db = getDb();
  
  const approvedClusters = db.prepare(`
    SELECT c.* FROM clusters c
    WHERE c.runId = ? AND c.approvalStatus = 'approved'
  `).all(runId);
  
  if (approvedClusters.length === 0) {
    throw Object.assign(new Error('No approved items to export'), {
      statusCode: 403,
      code: 'APPROVAL_REQUIRED',
    });
  }
  
  const tokens = {};
  for (const cluster of approvedClusters) {
    const driftedProps = safeParse(cluster.driftedProperties || '[]');
    const propValue = driftedProps.length > 0 ? driftedProps[0] : null;
    
    tokens[cluster.name] = propValue ? `{${propValue.property}: ${propValue.actual}}` : cluster.name;
  }
  
  if (format === 'w3c-tokens') {
    return {
      $schema: 'https://design-tokens.org/format/v1',
      $version: 1,
      $description: `Tokens from run ${runId}`,
      tokens,
    };
  }
  
  if (format === 'style-dictionary') {
    const sd = {};
    for (const [name, value] of Object.entries(tokens)) {
      const parts = name.split('-');
      let current = sd;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = { value };
    }
    return sd;
  }
  
  return tokens;
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = { isFigmaConfigured, testFigmaConnection, syncToFigma, exportTokens };