'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const config = require('./config');
const { logger } = require('./utils/logger');
const { initialize, closeDb } = require('./db');
const authMiddleware = require('./middleware/auth');
const requestIdMiddleware = require('./middleware/requestId');
const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./api/routes');
const queue = require('./queue');
const browser = require('./collector/browser');
const { collectRoute } = require('./collector');
const { extractSnapshot } = require('./extractor');
const { analyze } = require('./analyzer');
const { runRetentionSweep } = require('./store/retention-sweeper');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    /^chrome-extension:\/\/[a-z]+$/,
    process.env.CORS_ORIGIN || undefined,
  ].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Anthena-Run-Id', 'X-Anthena-Capture-Id'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(requestIdMiddleware);
app.use(rateLimiter);
app.use(authMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────

app.use('/api', routes);

// Serve production Web UI static build (if exists)
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    // Skip API, health, ready paths
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/ready') return next();
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
  logger.info({ publicDir }, 'Serving production Web UI');
} else {
  logger.info('No production Web UI build found — API-only mode. Run `cd web-ui && npx vite build --outDir ../backend/public`');
}

// Also mount at root level for health/ready
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: config.schemaVersion,
  });
});
app.get('/ready', (req, res) => {
  try {
    const db = require('./db').getDb();
    db.prepare('SELECT 1').get();
    res.json({ status: 'ready', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', db: e.message });
  }
});

// ── Error Handling ────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────

let server = null;

async function start() {
  try {
    // Initialize database (migrations + seeds)
    logger.info('Initializing database...');
    initialize();
    
    // Create storage directories
    for (const dir of [config.storagePath, config.dbPath, path.join(config.storagePath, 'runs')]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Start Express
    server = app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Express API server started');
    });
    
    // Launch Playwright browser (async, non-blocking)
    browser.getBrowser().catch(err => {
      logger.warn({ err: err.message }, 'Playwright browser not immediately available — will retry on demand');
    });
    
    // Register pipeline callbacks
    queue.registerPipelineCallbacks({
      collect: async (runId, route, role) => {
        const result = await collectRoute(runId, route, role);
        return result;
      },
      extract: async (runId, snapshotId) => {
        await extractSnapshot(runId, snapshotId);
      },
      analyze: async (runId) => {
        await analyze(runId);
      },
    });
    
    // Start queue poller
    queue.startPoller();
    
    // Run retention sweep on startup
    try {
      runRetentionSweep();
    } catch (err) {
      logger.warn({ err: err.message }, 'Retention sweep on startup had errors');
    }
    
    // Schedule retention sweep every 24 hours
    setInterval(() => {
      try {
        runRetentionSweep();
      } catch (err) {
        logger.error({ err: err.message }, 'Scheduled retention sweep failed');
      }
    }, 24 * 60 * 60 * 1000);
    
  } catch (err) {
    logger.fatal({ err: err.message }, 'Failed to start server');
    process.exit(1);
  }
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal');
  
  // Stop queue poller
  queue.stopPoller();
  
  // Close browser
  await browser.closeBrowser();
  
  // Close database
  closeDb();
  
  // Close server
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.warn('Forced exit after shutdown timeout');
      process.exit(1);
    }, 10000).unref();
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception');
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason?.message || reason }, 'Unhandled rejection');
});

// ── Start ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  start();
}

module.exports = { app, start };