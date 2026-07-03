// ─── Viewport Capture ─────────────────────────────────────────────────
// Captures visible viewport as WebP blob via chrome.tabs.captureVisibleTab().
// Handles Chrome API limit: ≤ 2 calls/second.
// Runs in service worker (background) context.

/**
 * @typedef {import('../shared/schema.js').Screenshot} Screenshot
 */

// ─── Throttle ─────────────────────────────────────────────────────────

/**
 * Throttle queue for captureVisibleTab (max 2 calls/sec)
 * @type {{ timestamps: number[], queue: Array<() => void> }}
 */
const captureThrottle = { timestamps: [], queue: [] };

/**
 * Acquire throttle slot — resolves when ≤ 2 calls in last 1s window
 * @returns {Promise<void>}
 */
async function acquireThrottleSlot() {
  const now = Date.now();
  const window = 1000;

  // Prune timestamps older than 1s
  captureThrottle.timestamps = captureThrottle.timestamps.filter(t => now - t < window);

  if (captureThrottle.timestamps.length < 2) {
    captureThrottle.timestamps.push(now);
    return;
  }

  // Wait until oldest timestamp falls out of window
  const oldest = captureThrottle.timestamps[0];
  const waitMs = window - (now - oldest) + 50; // +50ms buffer
  await new Promise(resolve => setTimeout(resolve, waitMs));

  captureThrottle.timestamps.push(Date.now());
}

/**
 * Reset throttle state (e.g., after capture completes or errors)
 */
export function resetThrottle() {
  captureThrottle.timestamps = [];
  captureThrottle.queue = [];
}

// ─── Capture ──────────────────────────────────────────────────────────

/**
 * Capture current viewport as WebP blob
 * Must be called from service worker context where chrome.tabs is available.
 * Throttled to ≤ 2 calls/second per Chrome API limits.
 *
 * @param {number} [tabId] - Optional tab ID. If omitted, captures active tab.
 * @returns {Promise<{blob: Blob, dataUrl: string, width: number, height: number}>}
 * @throws {Error} If capture fails or chrome.tabs API unavailable
 */
export async function captureViewport(tabId) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    throw new Error('chrome.tabs.captureVisibleTab unavailable — not in extension context');
  }

  await acquireThrottleSlot();

  let dataUrl;
  try {
    const options = { format: 'webp', quality: 85 };
    if (tabId) {
      // Capture specific tab via tabs API
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.id) throw new Error(`Tab ${tabId} not found`);
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, options);
    } else {
      dataUrl = await chrome.tabs.captureVisibleTab(null, options);
    }
  } catch (err) {
    // If webp format fails (rare), fallback to png
    if (err.message?.includes('format') || err.message?.includes('webp')) {
      const options = { format: 'png' };
      dataUrl = tabId
        ? await chrome.tabs.captureVisibleTab((await chrome.tabs.get(tabId)).windowId, options)
        : await chrome.tabs.captureVisibleTab(null, options);
    } else {
      throw new Error(`Viewport capture failed: ${err.message}`);
    }
  }

  // Decode to get dimensions
  const img = await decodeDataUrl(dataUrl);

  // Convert to blob for upload
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return {
    blob,
    dataUrl,
    width: img.width,
    height: img.height,
  };
}

/**
 * Decode a data URL to get image dimensions
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function decodeDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image(); // Image() is available in service workers via createImageBitmap, but we use OffscreenCanvas approach
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode capture data URL'));
    img.src = dataUrl;
  });
}

/**
 * Capture multiple viewport chunks at given scroll positions
 * Automatically throttles to ≤ 2 calls/second.
 *
 * @param {number} tabId
 * @param {Array<{y: number, index: number}>} segments
 * @returns {Promise<Array<{dataUrl: string, yOffset: number, width: number, height: number}>>}
 */
export async function captureViewportChunks(tabId, segments) {
  const chunks = [];

  for (const seg of segments) {
    const result = await captureViewport(tabId);
    chunks.push({
      dataUrl: result.dataUrl,
      yOffset: seg.y,
      width: result.width,
      height: result.height,
      segmentIndex: seg.index,
    });
  }

  return chunks;
}

// ─── Exports ──────────────────────────────────────────────────────────

export default { captureViewport, captureViewportChunks, resetThrottle };
