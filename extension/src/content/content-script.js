// ─── Content Script ─────────────────────────────────────────────────────
// Main content script injected into every page.
// Listens for capture commands from popup/background and extracts evidence.

import { extractDomNodes } from './dom-extractor.js';
import { extractComputedStyles } from './css-extractor.js';
import { extractRects } from './rect-extractor.js';
import { extractAccessibility } from './accessibility-extractor.js';
import { detectAntdComponents } from './antd-detector.js';

// ─── Message Handler ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_EVIDENCE':
      handleExtractEvidence(message, sendResponse);
      return true; // keep channel open for async response

    case 'PING':
      sendResponse({ type: 'PONG', url: window.location.href });
      return true;

    default:
      sendResponse({ type: 'ERROR', error: `Unknown message type: ${message.type}` });
      return true;
  }
});

// ─── Evidence Extraction ──────────────────────────────────────────────

/**
 * Extract all evidence from the current page
 * @param {any} message
 * @param {(response: any) => void} sendResponse
 */
async function handleExtractEvidence(message, sendResponse) {
  try {
    const maxNodes = message.maxNodes || 200;

    // 1. Extract DOM nodes
    const nodes = extractDomNodes(maxNodes);

    // 2. Extract computed styles for the nodes
    const styles = extractComputedStyles(nodes);

    // 3. Extract rects
    const rects = extractRects(maxNodes);

    // 4. Extract accessibility info
    const a11y = extractAccessibility();

    // 5. Detect Ant Design components
    const antdComponents = detectAntdComponents();

    // 6. Build page metadata
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio || 1,
    };

    const metadata = {
      url: window.location.href,
      title: document.title,
      viewport,
      nodeCount: nodes.length,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };

    sendResponse({
      type: 'EVIDENCE_EXTRACTED',
      metadata,
      nodes,
      styles,
      rects,
      accessibility: a11y,
      antdComponents,
    });
  } catch (err) {
    sendResponse({
      type: 'ERROR',
      error: err.message || 'Extraction failed',
      stack: err.stack,
    });
  }
}