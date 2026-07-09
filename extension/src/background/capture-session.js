/**
 * Capture Session Manager V2
 * Manages capture session state, coordinates capture flow.
 *
 * @typedef {import('../shared/schema.js').CaptureSessionResponse} CaptureSessionResponse
 */

import { uploadCapturePackage } from './upload-client.js';
import { randomId } from '../shared/schema.js';

/**
 * Create a new capture session via the backend API.
 * @param {string} apiBaseUrl
 * @param {string} runId
 * @param {string} moduleName
 * @param {string} environment
 * @param {string} adminToken
 * @returns {Promise<CaptureSessionResponse>}
 */
export async function createCaptureSession(apiBaseUrl, runId, moduleName, environment, adminToken) {
  const response = await fetch(`${apiBaseUrl}/api/capture-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ runId, moduleName, environment }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}: Failed to create capture session`);
  }

  return await response.json();
}

/**
 * V1 legacy capture current page and upload.
 * @param {{
 *   uploadUrl: string,
 *   uploadToken: string,
 *   runId: string,
 *   sessionId: string,
 *   routeKey: string,
 *   apiBaseUrl: string,
 * }} config
 * @returns {Promise<{captureId: string, status: string}>}
 */
export async function captureCurrentPage(config) {
  const captureId = `cap_${randomId(8)}`;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error('No active tab found');

  const extraction = await chrome.tabs.sendMessage(tabs[0].id, {
    type: 'EXTRACT_EVIDENCE',
    maxNodes: 200,
  });

  if (extraction.type === 'ERROR') {
    throw new Error(`Extraction failed: ${extraction.error}`);
  }

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  const screenshotBlob = await (await fetch(screenshotDataUrl)).blob();

  const result = await uploadCapturePackage({
    uploadUrl: config.uploadUrl,
    uploadToken: config.uploadToken,
    routeKey: config.routeKey,
    url: tabs[0].url || '',
    title: tabs[0].title || '',
    viewport: {
      width: extraction.metadata.viewport.width,
      height: extraction.metadata.viewport.height,
      deviceScaleFactor: extraction.metadata.viewport.deviceScaleFactor,
    },
    nodes: extraction.nodes,
    screenshotBlob,
    runId: config.runId,
    sessionId: config.sessionId,
    captureId,
  });

  chrome.runtime.sendMessage({
    type: 'CAPTURE_COMPLETE',
    captureId: result.captureId || captureId,
    status: result.status || 'uploaded',
    url: tabs[0].url,
  });

  return result;
}
