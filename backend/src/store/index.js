'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Evidence Store — filesystem I/O for snapshots, crops, and reports.
 */

function getRunDir(runId) {
  return path.join(config.storagePath, 'runs', runId);
}

function getSnapshotPath(runId) {
  return path.join(getRunDir(runId), 'snapshot.json.gz');
}

function getScreenshotPath(runId) {
  return path.join(getRunDir(runId), 'full.webp');
}

function getCropDir(runId) {
  return path.join(getRunDir(runId), 'crops');
}

function getThumbDir(runId) {
  return path.join(getRunDir(runId), 'thumbnails');
}

function getReportsDir(runId) {
  return path.join(getRunDir(runId), 'reports');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read a snapshot JSON (gzipped).
 */
function readSnapshotJson(runId) {
  const filePath = getSnapshotPath(runId);
  if (!fs.existsSync(filePath)) return null;
  
  const zlib = require('zlib');
  const gzipped = fs.readFileSync(filePath);
  return JSON.parse(zlib.gunzipSync(gzipped).toString());
}

/**
 * Read screenshot as buffer.
 */
function readScreenshot(runId) {
  const filePath = getScreenshotPath(runId);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

/**
 * Read a crop image.
 */
function readCrop(runId, nodeId) {
  const filePath = path.join(getCropDir(runId), `${nodeId}.webp`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

/**
 * Read a thumbnail.
 */
function readThumbnail(runId, nodeId) {
  const filePath = path.join(getThumbDir(runId), `${nodeId}.webp`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

/**
 * Write report JSON to reports directory.
 */
function writeReport(runId, reportName, data) {
  const reportsDir = getReportsDir(runId);
  ensureDir(reportsDir);
  
  const filePath = path.join(reportsDir, reportName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  
  return filePath;
}

/**
 * Read a report JSON.
 */
function readReport(runId, reportName) {
  const filePath = path.join(getReportsDir(runId), reportName);
  if (!fs.existsSync(filePath)) return null;
  
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Delete run directory and all contents.
 */
function deleteRun(runId) {
  const runDir = getRunDir(runId);
  if (fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
    logger.info({ runId }, 'Run directory deleted');
  }
}

module.exports = {
  getRunDir,
  getSnapshotPath,
  getScreenshotPath,
  getCropDir,
  getThumbDir,
  getReportsDir,
  ensureDir,
  readSnapshotJson,
  readScreenshot,
  readCrop,
  readThumbnail,
  writeReport,
  readReport,
  deleteRun,
};