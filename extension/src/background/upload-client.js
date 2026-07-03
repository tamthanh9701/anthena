// ─── Upload Client ──────────────────────────────────────────────────────
// Handles uploading capture packages to the ZimaOS backend.
// Used by both service-worker and popup.

import { NetworkError, AuthError, fetchWithTimeout } from '../shared/errors.js';
import { SCHEMA_VERSION, EXTRACTOR_VERSION } from '../shared/schema.js';

/**
 * @typedef {import('../shared/schema.js').SnapshotMetadata} SnapshotMetadata
 * @typedef {import('../shared/schema.js').CaptureSessionResponse} CaptureSessionResponse
 */

/**
 * Upload a capture package to the backend
 * @param {{
 *   uploadUrl: string,
 *   uploadToken: string,
 *   routeKey: string,
 *   url: string,
 *   title: string,
 *   viewport: { width: number, height: number, deviceScaleFactor: number },
 *   nodes: Array<any>,
 *   screenshotBlob?: Blob,
 *   runId: string,
 *   sessionId: string,
 *   captureId: string,
 * }} params
 * @returns {Promise<{captureId: string, status: string}>}
 */
export async function uploadCapturePackage({
  uploadUrl,
  uploadToken,
  routeKey,
  url,
  title,
  viewport,
  nodes,
  screenshotBlob,
  runId,
  sessionId,
  captureId,
}) {
  if (!uploadUrl || !uploadToken) {
    throw new AuthError('No upload token configured. Create a capture session first.');
  }

  // Build metadata
  const metadata = {
    captureId,
    runId,
    routeKey,
    url,
    title,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
    },
    screenshot: {
      mode: 'viewport',
      format: screenshotBlob ? screenshotBlob.type === 'image/webp' ? 'webp' : 'png' : 'none',
      width: viewport.width,
      height: viewport.height,
    },
    signals: {
      dom: true,
      computedCss: true,
      accessibility: true,
      fiber: 'unavailable',
      antdTokens: 'inferred-only',
    },
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    nodeCount: nodes.length,
  };

  // Build multipart form
  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));

  // Gzip the snapshot data
  const snapshotData = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    captureMode: 'chrome-extension',
    captureSessionId: sessionId,
    captureId,
    runId,
    url,
    routeKey,
    title,
    capturedAt: metadata.capturedAt,
    viewport,
    screenshot: metadata.screenshot,
    signals: metadata.signals,
    nodeCount: nodes.length,
    nodes,
  });

  const gzipBlob = await gzipCompress(snapshotData);
  formData.append('snapshot', gzipBlob, `snapshot.json.gz`);

  if (screenshotBlob) {
    formData.append('screenshot', screenshotBlob, 'full.webp');
  }

  // Upload
  const response = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${uploadToken}`,
      'X-Anthena-Run-Id': runId,
      'X-Anthena-Capture-Id': captureId,
    },
    body: formData,
  }, 60000); // 60s timeout for upload

  return await response.json();
}

/**
 * Gzip compress a string
 * @param {string} data
 * @returns {Promise<Blob>}
 */
async function gzipCompress(data) {
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(data);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(uint8);
  writer.close();
  return new Response(cs.readable).blob();
}