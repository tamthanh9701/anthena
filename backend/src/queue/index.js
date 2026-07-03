'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { logger, childLogger } = require('../utils/logger');
const config = require('../config');
const stateMachine = require('./state-machine');
const retry = require('./retry');
const checkpoint = require('./checkpoint');

let pollInterval = null;
let isRunning = false;
let activeBrowserCount = 0;
const pipelineCallbacks = {};

/**
 * Register pipeline stage callbacks.
 * Called by the Pipeline Executor to wire up collector, extractor, analyzer.
 */
function registerPipelineCallbacks(cbs) {
  if (cbs.collect) pipelineCallbacks.collect = cbs.collect;
  if (cbs.extract) pipelineCallbacks.extract = cbs.extract;
  if (cbs.analyze) pipelineCallbacks.analyze = cbs.analyze;
}

/**
 * Create and enqueue a new run.
 */
function createRun(mode, route, roles) {
  const db = getDb();
  const now = new Date().toISOString();
  const runId = `run-${uuidv4().slice(0, 8)}`;
  
  // Build route+role combinations
  const allRoles = roles && roles.length > 0 ? roles : Object.keys(config.roleMap);
  const roleRoutes = [];
  const routeSet = new Set();
  
  for (const role of allRoles) {
    const routes = config.roleMap[role] || config.routeList;
    for (const r of routes) {
      if (mode === 'route' && r !== route) continue;
      roleRoutes.push({ route: r, role });
      routeSet.add(r);
    }
  }
  
  const totalRoutes = roleRoutes.length;
  const routeList = JSON.stringify([...routeSet]);
  const roleList = JSON.stringify(allRoles);
  
  // Check pilot contract is signed
  const contract = db.prepare("SELECT id, cosignedAt FROM pilot_contracts ORDER BY createdAt DESC LIMIT 1").get();
  
  db.prepare(`
    INSERT INTO runs (id, status, createdAt, routeList, roleList, totalRoutes, completedRoutes, configSnapshot, pilotContractId, schemaVersion)
    VALUES (?, 'pending', ?, ?, ?, ?, 0, ?, ?, '1.0.0')
  `).run(runId, now, routeList, roleList, totalRoutes, JSON.stringify(config.getMaskedConfig()), contract?.id || null);
  
  logger.info({ runId, totalRoutes, roles: allRoles }, 'Run created and enqueued');
  
  return { runId, status: 'pending', totalRoutes };
}

/**
 * Dequeue: transition a pending run to running.
 */
function dequeueRun(runId) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404, code: 'NOT_FOUND' });
  if (run.status !== 'pending') throw Object.assign(new Error('Run is not in pending state'), { statusCode: 400, code: 'INVALID_STATE' });
  
  const now = new Date().toISOString();
  db.prepare("UPDATE runs SET status = 'running', startedAt = ? WHERE id = ?").run(now, runId);
  
  logger.info({ runId }, 'Run dequeued, now running');
  return { runId, status: 'running' };
}

/**
 * Resume an interrupted run.
 */
function resumeRun(runId) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404, code: 'NOT_FOUND' });
  if (run.status !== 'interrupted') throw Object.assign(new Error('Run is not in interrupted state'), { statusCode: 400, code: 'INVALID_STATE' });
  
  const processed = JSON.parse(run.processedRoutes || '[]');
  const completed = processed.filter(r => r.status === 'completed').length;
  const remaining = checkpoint.getRemainingRoutes(JSON.parse(run.routeList), JSON.parse(run.roleList), processed);
  
  db.prepare("UPDATE runs SET status = 'running', error = NULL WHERE id = ?").run(runId);
  
  logger.info({ runId, completed, remaining: remaining.length }, 'Run resumed from checkpoint');
  
  return { runId, status: 'running', checkpoint: { completedRoutes: completed, remainingRoutes: remaining.length } };
}

/**
 * Update run state.
 */
function transitionRun(runId, newStatus, error = null) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404, code: 'NOT_FOUND' });
  
  if (!stateMachine.canTransition(run.status, newStatus)) {
    throw Object.assign(
      new Error(`Cannot transition from '${run.status}' to '${newStatus}'`),
      { statusCode: 400, code: 'INVALID_TRANSITION' }
    );
  }
  
  const now = new Date().toISOString();
  const updates = { status: newStatus };
  if (newStatus === 'completed' || newStatus === 'partially-completed' || newStatus === 'failed') {
    updates.completedAt = now;
  }
  if (error) updates.error = error;
  
  db.prepare(`UPDATE runs SET status = ?, completedAt = COALESCE(?, completedAt), error = ? WHERE id = ?`)
    .run(newStatus, updates.completedAt || null, error, runId);
  
  logger.info({ runId, from: run.status, to: newStatus, error }, 'Run state transition');
}

/**
 * Update processed routes checkpoint for a run.
 */
function updateCheckpoint(runId, route, role, status, error = null, retryCount = 0) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) return;
  
  const processed = JSON.parse(run.processedRoutes || '[]');
  const updated = checkpoint.addProcessedRoute(processed, route, role, status, error, retryCount);
  
  const completedCount = updated.filter(r => r.status === 'completed').length;
  
  db.prepare("UPDATE runs SET processedRoutes = ?, completedRoutes = ? WHERE id = ?")
    .run(JSON.stringify(updated), completedCount, runId);
}

/**
 * Check if a run is currently in progress.
 */
function isRunInProgress() {
  const db = getDb();
  const run = db.prepare("SELECT id FROM runs WHERE status = 'running' LIMIT 1").get();
  return !!run;
}

/**
 * Get active run IDs.
 */
function getActiveRunIds() {
  const db = getDb();
  const runs = db.prepare("SELECT id FROM runs WHERE status IN ('running', 'pending')").all();
  return runs.map(r => r.id);
}

/**
 * Mark all running runs as interrupted (on restart).
 */
function markInterruptedRuns() {
  const db = getDb();
  const running = db.prepare("SELECT id FROM runs WHERE status = 'running'").all();
  for (const r of running) {
    db.prepare("UPDATE runs SET status = 'interrupted', error = 'System restarted mid-run' WHERE id = ?").run(r.id);
    logger.info({ runId: r.id }, 'Marked run as interrupted on restart');
  }
}

/**
 * Queue poller: picks up pending runs.
 */
async function pollQueue() {
  if (isRunning) return;
  if (activeBrowserCount >= config.maxConcurrentBrowsers) return;
  
  isRunning = true;
  try {
    const db = getDb();
    const nextRun = db.prepare("SELECT * FROM runs WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 1").get();
    
    if (!nextRun) return;
    
    logger.info({ runId: nextRun.id }, 'Queue poller picked up run');
    dequeueRun(nextRun.id);
    
    // Execute pipeline in background (fire and forget)
    executePipeline(nextRun.id).catch(err => {
      logger.error({ runId: nextRun.id, err: err.message }, 'Pipeline execution error');
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Queue poll error');
  } finally {
    isRunning = false;
  }
}

/**
 * Execute the full pipeline for a run.
 */
async function executePipeline(runId) {
  const log = childLogger({ runId, module: 'pipeline' });
  
  try {
    const db = getDb();
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!run) return;
    
    const routeList = JSON.parse(run.routeList || '[]');
    const roleList = JSON.parse(run.roleList || '[]');
    const processed = JSON.parse(run.processedRoutes || '[]');
    const remaining = checkpoint.getRemainingRoutes(routeList, roleList, processed);
    
    if (remaining.length === 0) {
      transitionRun(runId, 'completed');
      return;
    }
    
    let allFailed = true;
    let anyFailed = false;
    
    for (const { route, role } of remaining) {
      log.info({ route, role }, 'Processing route');
      
      let lastError = null;
      let success = false;
      
      for (let attempt = 0; attempt <= config.retryCount; attempt++) {
        if (attempt > 0) {
          const delay = retry.getRetryDelay(attempt);
          log.warn({ route, role, attempt, delay }, 'Retrying route after delay');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
          activeBrowserCount++;
          
          // Stage 1: Collect (screenshot + snapshot JSON)
          const snapshot = await pipelineCallbacks.collect(runId, route, role);
          
          // Update checkpoint
          updateCheckpoint(runId, route, role, 'completed');
          db.prepare("UPDATE runs SET retryCount = retryCount + ? WHERE id = ?").run(attempt, runId);
          
          // Stage 2: Extract (DOM/CSS/Fiber — runs inline on snapshot data)
          if (pipelineCallbacks.extract) {
            await pipelineCallbacks.extract(runId, snapshot.id);
          }
          
          // Stage 3: Analyze (clustering, drift, priority)
          if (pipelineCallbacks.analyze) {
            await pipelineCallbacks.analyze(runId);
          }
          
          success = true;
          allFailed = false;
          break;
        } catch (err) {
          lastError = err;
          log.error({ route, role, attempt, err: err.message }, 'Route failed');
          
          const isPermanent = err.statusCode === 404 || err.statusCode === 401 || err.statusCode === 403;
          if (isPermanent) break; // Don't retry permanent failures
        } finally {
          activeBrowserCount--;
        }
      }
      
      if (!success) {
        anyFailed = true;
        updateCheckpoint(runId, route, role, 'failed', lastError?.message || 'Unknown error');
        log.error({ route, role, error: lastError?.message }, 'Route permanently failed');
      }
    }
    
    // Determine final state
    if (!anyFailed) {
      transitionRun(runId, 'completed');
    } else if (!allFailed) {
      transitionRun(runId, 'partially-completed');
    } else {
      transitionRun(runId, 'failed', 'All routes failed critically');
    }
    
  } catch (err) {
    log.error({ err: err.message }, 'Pipeline fatal error');
    try { transitionRun(runId, 'failed', err.message); } catch (_) {}
  }
}

/**
 * Start the queue poller.
 */
function startPoller() {
  if (pollInterval) return;
  
  // Mark interrupted runs from previous session
  markInterruptedRuns();
  
  pollInterval = setInterval(pollQueue, config.queuePollIntervalMs);
  logger.info({ interval: config.queuePollIntervalMs }, 'Queue poller started');
  
  // Do an immediate poll
  pollQueue();
}

/**
 * Stop the queue poller (for graceful shutdown).
 */
function stopPoller() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Queue poller stopped');
  }
}

module.exports = {
  createRun,
  dequeueRun,
  resumeRun,
  transitionRun,
  updateCheckpoint,
  isRunInProgress,
  getActiveRunIds,
  markInterruptedRuns,
  registerPipelineCallbacks,
  startPoller,
  stopPoller,
  executePipeline,
};