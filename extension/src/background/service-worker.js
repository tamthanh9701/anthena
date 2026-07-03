// ─── Service Worker (Background) ────────────────────────────────────────
// Handles extension lifecycle, storage, and coordinates capture operations.

import { captureCurrentPage, createCaptureSession } from './capture-session.js';

// ─── State ──────────────────────────────────────────────────────────────

/** @type {{ sessionId?: string, runId?: string, uploadUrl?: string, uploadToken?: string, apiBaseUrl?: string, adminToken?: string }} */
let sessionState = {};

// Load persisted state on startup
chrome.storage.local.get(['sessionState'], (result) => {
  if (result.sessionState) {
    sessionState = result.sessionState;
    console.log('[Anthena] Loaded session state:', sessionState.sessionId);
  }
});

// ─── Message Handlers ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CONFIGURE_SESSION':
      handleConfigureSession(message, sendResponse);
      return true;

    case 'CAPTURE_NOW':
      handleCaptureNow(message, sendResponse);
      return true;

    case 'GET_SESSION_STATE':
      sendResponse({ type: 'SESSION_STATE', ...sessionState });
      return true;

    case 'CLEAR_SESSION':
      sessionState = {};
      chrome.storage.local.remove(['sessionState']);
      sendResponse({ type: 'SESSION_CLEARED' });
      return true;

    case 'CAPTURE_COMPLETE':
      // Forward to popup if open
      sendResponse({ type: 'FORWARDED' });
      return true;

    default:
      return false;
  }
});

// ─── Handlers ──────────────────────────────────────────────────────────

/**
 * Configure a capture session from the popup
 */
async function handleConfigureSession(message, sendResponse) {
  try {
    const { apiBaseUrl, runId, moduleName, environment, adminToken } = message;

    // Create session via backend
    const session = await createCaptureSession(
      apiBaseUrl,
      runId,
      moduleName,
      environment,
      adminToken
    );

    sessionState = {
      sessionId: session.sessionId,
      runId: session.runId,
      uploadUrl: `${apiBaseUrl}${session.uploadUrl}`,
      uploadToken: session.uploadToken,
      apiBaseUrl,
      adminToken,
    };

    // Persist
    chrome.storage.local.set({ sessionState });

    sendResponse({
      type: 'SESSION_CONFIGURED',
      sessionId: session.sessionId,
      runId: session.runId,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    sendResponse({
      type: 'ERROR',
      error: `Failed to configure session: ${err.message}`,
    });
  }
}

/**
 * Capture the current page
 */
async function handleCaptureNow(message, sendResponse) {
  try {
    if (!sessionState.sessionId || !sessionState.uploadUrl || !sessionState.uploadToken) {
      sendResponse({
        type: 'ERROR',
        error: 'No active capture session. Configure a session first.',
      });
      return;
    }

    const routeKey = message.routeKey || `route-${Date.now()}`;

    const result = await captureCurrentPage({
      uploadUrl: sessionState.uploadUrl,
      uploadToken: sessionState.uploadToken,
      runId: sessionState.runId,
      sessionId: sessionState.sessionId,
      routeKey,
      apiBaseUrl: sessionState.apiBaseUrl,
    });

    sendResponse({
      type: 'CAPTURE_COMPLETE',
      captureId: result.captureId,
      status: result.status,
    });
  } catch (err) {
    sendResponse({
      type: 'ERROR',
      error: `Capture failed: ${err.message}`,
    });
  }
}