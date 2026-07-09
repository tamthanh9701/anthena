/**
 * Anthena V2 Service Worker
 * Handles extension lifecycle, storage, and Evidence Package assembly.
 * V2 changes:
 * - Evidence Package builder (metadata.json + snapshot.json.gz + full.webp)
 * - Scenario Manifest integration
 * - Derived signal flags
 * - Redact-by-default messaging
 *
 * @typedef {import('../shared/schema.js').ScenarioManifest} ScenarioManifest
 * @typedef {import('../shared/schema.js').EvidenceMetadata} EvidenceMetadata
 * @typedef {import('../shared/schema.js').SnapshotPayload} SnapshotPayload
 * @typedef {import('../shared/schema.js').SignalFlags} SignalFlags
 */

import { captureCurrentPage, createCaptureSession } from './capture-session.js';
import { buildEvidencePackage, uploadEvidencePackage } from './evidence-assembler.js';

const QUICK_CAPTURE_STORAGE_KEY = 'anthena_quick_captures';
const QUICK_CAPTURE_LIMIT = 20;

// ─── State ─────────────────────────────────────────────────────

/** @type {{ sessionId?: string, runId?: string, uploadUrl?: string, uploadToken?: string, apiBaseUrl?: string, adminToken?: string, manifestId?: string }} */
let sessionState = {};

// Load persisted state on startup
chrome.storage.local.get(['sessionStateV2'], (result) => {
  if (result.sessionStateV2) {
    sessionState = normalizeSessionState(result.sessionStateV2);
    if (sessionState !== result.sessionStateV2) {
      chrome.storage.local.set({ sessionStateV2: sessionState });
    }
    // eslint-disable-next-line no-console
    console.log('[Anthena V2] Loaded session state:', sessionState.sessionId);
  }
});

async function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Anthena V2] Failed to enable side panel action behavior:', err?.message || err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick();
});

chrome.runtime.onStartup?.addListener(() => {
  enableSidePanelOnActionClick();
});

chrome.action?.onClicked?.addListener(async (tab) => {
  if (!chrome.sidePanel?.open) return;

  try {
    await chrome.sidePanel.open(tab?.windowId ? { windowId: tab.windowId } : {});
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Anthena V2] Failed to open side panel:', err?.message || err);
  }
});

// ─── Message Handlers ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CONFIGURE_SESSION':
      handleConfigureSession(message, sendResponse);
      return true;

    case 'CAPTURE_NOW':
      handleCaptureNow(message, sendResponse);
      return true;

    case 'CAPTURE_NOW_V2':
      handleCaptureNowV2(message, sendResponse);
      return true;

    case 'GET_SESSION_STATE':
      sendResponse({ type: 'SESSION_STATE', ...sessionState });
      return true;

    case 'CLEAR_SESSION':
      sessionState = {};
      chrome.storage.local.remove(['sessionStateV2']);
      sendResponse({ type: 'SESSION_CLEARED' });
      return true;

    default:
      return false;
  }
});

// ─── Handlers ──────────────────────────────────────────────────

/**
 * Configure a capture session (V1 compat).
 */
async function handleConfigureSession(message, sendResponse) {
  try {
    const { apiBaseUrl, runId, moduleName, environment, adminToken } = message;

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
      // V2 quick capture uploads a canonical JSON Evidence Package. The
      // capture-session endpoint still returns the legacy multipart page
      // upload URL, so route V2 uploads directly to the canonical endpoint
      // while keeping the scoped upload token created by the session.
      uploadUrl: `${apiBaseUrl}/api/v2/evidence`,
      legacyUploadUrl: `${apiBaseUrl}${session.uploadUrl}`,
      uploadToken: session.uploadToken,
      apiBaseUrl,
      adminToken,
    };

    chrome.storage.local.set({ sessionStateV2: sessionState });

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
 * V1 legacy capture.
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

/**
 * V2 Evidence Package capture with full signal collection.
 * @param {{ manifest?: ScenarioManifest, redact?: boolean }} message
 */
async function handleCaptureNowV2(message, sendResponse) {
  try {
    const manifest = message.manifest || null;
    const redact = message.redact !== false; // default true
    const hasUploadSession = Boolean(sessionState.sessionId && sessionState.uploadUrl && sessionState.uploadToken);

    // 1. Extract evidence from content script
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) throw new Error('No active tab found');
    await ensureContentScript(tabs[0]);

    const extraction = await chrome.tabs.sendMessage(tabs[0].id, {
      type: 'EXTRACT_EVIDENCE_V2',
      manifest,
      redact,
    });

    if (extraction.type === 'ERROR') {
      throw new Error(`Extraction failed: ${extraction.error}`);
    }

    // 2. Capture screenshot
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const screenshotBlob = await (await fetch(screenshotDataUrl)).blob();

    // 3. Build Evidence Package (async now — hash computation)
    const pkg = await buildEvidencePackage({
      signals: extraction.signals,
      metadata: extraction.metadata,
      redaction: extraction.redaction,
      manifest,
      captureSessionId: sessionState.sessionId || `quick-session-${Date.now()}`,
      runId: sessionState.runId || quickRunId(),
      routeKey: message.routeKey || (manifest ? `${manifest.route}_${manifest.role}_${manifest.theme}` : quickRouteKey(tabs[0].url || '')),
      url: tabs[0].url || '',
      title: tabs[0].title || '',
      viewport: extraction.metadata.viewport,
      screenshot: { mode: 'viewport', format: 'png', width: extraction.metadata.viewport.width, height: extraction.metadata.viewport.height },
    });

    if (!hasUploadSession) {
      const response = {
        type: 'CAPTURE_COMPLETE',
        captureId: pkg.canonical.packageId,
        status: 'captured-local',
        uploaded: false,
        url: tabs[0].url,
      };

      await saveQuickCapture({
        ...response,
        title: tabs[0].title || '',
        capturedAt: pkg.canonical.capturedAt,
        canonical: pkg.canonical,
      });

      chrome.runtime.sendMessage(response);
      sendResponse(response);
      return;
    }

    // 4. Upload Evidence Package
    const result = await uploadEvidencePackage({
      uploadUrl: sessionState.uploadUrl,
      uploadToken: sessionState.uploadToken,
      runId: sessionState.runId || pkg.canonical.provenance.runId,
      canonical: pkg.canonical,
      screenshotBlob,
    });

    // 5. Notify popup
    chrome.runtime.sendMessage({
      type: 'CAPTURE_COMPLETE',
      captureId: pkg.canonical.packageId,
      status: result.status || 'uploaded',
      uploaded: true,
      url: tabs[0].url,
    });

    sendResponse({
      type: 'CAPTURE_COMPLETE',
      captureId: pkg.canonical.packageId,
      status: result.status || 'uploaded',
      uploaded: true,
    });
  } catch (err) {
    sendResponse({
      type: 'ERROR',
      error: `V2 capture failed: ${err.message}`,
    });
  }
}

function quickRunId() {
  return `quick-run-${new Date().toISOString().slice(0, 10)}`;
}

function quickRouteKey(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+/g, '-') || 'home';
    return `quick-${path}-${Date.now()}`;
  } catch {
    return `quick-route-${Date.now()}`;
  }
}

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

async function saveQuickCapture(entry) {
  const current = await getStorage([QUICK_CAPTURE_STORAGE_KEY]);
  const captures = Array.isArray(current[QUICK_CAPTURE_STORAGE_KEY])
    ? current[QUICK_CAPTURE_STORAGE_KEY]
    : [];

  const next = [entry, ...captures].slice(0, QUICK_CAPTURE_LIMIT);
  await setStorage({ [QUICK_CAPTURE_STORAGE_KEY]: next });
}

async function ensureContentScript(tab) {
  if (!tab?.id) throw new Error('No active tab found');
  if (!isInjectableUrl(tab.url || '')) {
    throw new Error('This page cannot be captured. Open a normal http/https page, then try again.');
  }

  const firstPing = await pingContentScript(tab.id);
  if (firstPing) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content-script.js'],
    });
  } catch (err) {
    throw new Error(`Could not inject Anthena content script: ${err.message}`);
  }

  const secondPing = await pingContentScript(tab.id);
  if (!secondPing) {
    throw new Error('Could not establish connection to the page content script. Reload the page and try again.');
  }
}

function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(response?.type === 'PONG');
    });
  });
}

function isInjectableUrl(url) {
  return /^https?:\/\//i.test(url);
}

function normalizeSessionState(state) {
  if (!state?.apiBaseUrl || !state?.uploadUrl) return state || {};
  if (!state.uploadUrl.includes('/api/capture-sessions/')) return state;
  return {
    ...state,
    legacyUploadUrl: state.legacyUploadUrl || state.uploadUrl,
    uploadUrl: `${state.apiBaseUrl}/api/v2/evidence`,
  };
}
