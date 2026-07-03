'use strict';

const path = require('path');

// Load .env if present (Docker secrets or env vars take precedence)
try {
  require('fs').accessSync(path.join(__dirname, '..', '..', '.env'));
  require('dotenv').config();
} catch (_) {
  // .env not required in Docker/production
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  apiToken: process.env.API_TOKEN || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Target application
  targetUrl: process.env.TARGET_URL || '',
  routeList: parseJsonArray(process.env.ROUTE_LIST, []),
  roleMap: parseJsonObject(process.env.ROLE_MAP, {}),

  // Retention
  maxRunsPerRoute: parseInt(process.env.MAX_RUNS_PER_ROUTE || '5', 10),
  failedRunRetentionDays: parseInt(process.env.FAILED_RUN_RETENTION_DAYS || '7', 10),
  jsonRetentionDays: parseInt(process.env.JSON_RETENTION_DAYS || '0', 10),

  // Crawler / Queue
  retryCount: parseInt(process.env.RETRY_COUNT || '3', 10),
  routeTimeoutMs: parseInt(process.env.ROUTE_TIMEOUT_MS || '30000', 10),
  queuePollIntervalMs: parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '5000', 10),
  playwrightHeadless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  maxConcurrentBrowsers: parseInt(process.env.MAX_CONCURRENT_BROWSERS || '2', 10),
  disableCrawler: process.env.DISABLE_CRAWLER === 'true',

  // Figma (Phase 5)
  figmaAccessToken: process.env.FIGMA_ACCESS_TOKEN || '',
  figmaFileKey: process.env.FIGMA_FILE_KEY || '',

  // Storage
  storagePath: process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage'),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data'),

  // Credential map (constructed from env)
  credentials: {},

  // Schema versions
  schemaVersion: '1.0.0',
  extractorVersion: '0.1.0',
  analyzerVersion: '0.1.0',
};

// Build credential map from CREDENTIALS_* or ROLE_*_USERNAME/PASSWORD pattern
function buildCredentials() {
  const creds = {};
  const roleKeys = Object.keys(config.roleMap);
  for (const role of roleKeys) {
    const upperRole = role.toUpperCase();
    const username = process.env[`${upperRole}_USERNAME`] || process.env[`CREDENTIALS_${upperRole}_USERNAME`] || '';
    const password = process.env[`${upperRole}_PASSWORD`] || process.env[`CREDENTIALS_${upperRole}_PASSWORD`] || '';
    if (username && password) {
      creds[role] = { username, password };
    }
  }
  config.credentials = creds;
}
buildCredentials();

// Getters for figma status
config.figmaConfigured = !!(config.figmaAccessToken && config.figmaFileKey);

function parseJsonArray(val, def) {
  if (!val) return def;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : def; } catch { return def; }
}

function parseJsonObject(val, def) {
  if (!val) return def;
  try { const p = JSON.parse(val); return typeof p === 'object' && !Array.isArray(p) ? p : def; } catch { return def; }
}

// Get config with secrets masked
function getMaskedConfig() {
  const masked = { ...config };
  masked.apiToken = '••••••••';
  masked.figmaAccessToken = masked.figmaAccessToken ? '••••••••' : '';
  masked.credentials = {};
  for (const [role, _creds] of Object.entries(config.credentials)) {
    masked.credentials[role] = { username: _creds.username, password: '••••••••' };
  }
  return masked;
}

config.getMaskedConfig = getMaskedConfig;

module.exports = config;