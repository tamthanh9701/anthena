/**
 * Anthena V2 Content Script
 * Collects ALL signals into one package:
 * - DOM (text redacted when redact=true)
 * - Computed CSS (55+ props)
 * - Rects
 * - Accessibility tree
 * - AntD detection (55+ classes)
 * - Fiber tree (via injected world)
 * - Runtime tokens (via injected world)
 * - Redaction confirmation (via injected world)
 *
 * Message protocol:
 *   { type: 'EXTRACT_EVIDENCE_V2', manifest: object, redact: boolean }
 *   → { type: 'EVIDENCE_EXTRACTED_V2', metadata, signals, redaction }
 *
 * @typedef {import('../shared/schema.js').DomNode} DomNode
 * @typedef {import('../shared/schema.js').ComputedStyleEntry} ComputedStyleEntry
 * @typedef {import('../shared/schema.js').RectEntry} RectEntry
 * @typedef {import('../shared/schema.js').A11yEntry} A11yEntry
 * @typedef {import('../shared/schema.js').AntdComponentEntry} AntdComponentEntry
 * @typedef {import('../shared/schema.js').FiberInfo} FiberInfo
 * @typedef {import('../shared/schema.js').TokenInfo} TokenInfo
 */

import { collectDomNodes } from './dom-extractor.js';
import { extractComputedStyles, STYLE_PROPS_V2 } from './css-extractor.js';
import { extractRects } from './rect-extractor.js';
import { extractAccessibility } from './accessibility-extractor.js';
import { detectAntdComponents } from './antd-detector.js';

// ─── Message Handler ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_EVIDENCE_V2':
      handleExtractEvidenceV2(message, sendResponse);
      return true; // keep channel open for async

    case 'PING':
      sendResponse({ type: 'PONG', url: window.location.href, version: '2.0.0' });
      return true;

    default:
      sendResponse({ type: 'ERROR', error: `Unknown message type: ${message.type}` });
      return true;
  }
});

// ─── Evidence Extraction V2 ───────────────────────────────────

/**
 * Full evidence extraction with injected-world signals.
 * @param {{ manifest: import('../shared/schema.js').ScenarioManifest, redact: boolean }} message
 * @param {(response: any) => void} sendResponse
 */
async function handleExtractEvidenceV2(message, sendResponse) {
  try {
    const redact = message.redact !== false; // default true
    const manifest = message.manifest || null;

    // 1. Inject page-world scripts and wait for results
    const injectedResults = await injectAndWait(redact);

    // 2. Extract DOM (with or without text)
    const domNodes = collectDomNodes(200, redact);

    // 3. Extract computed CSS for the collected nodes
    const computedStyles = extractComputedStyles(domNodes);

    // 4. Extract rects
    const rects = extractRects(200);

    // 5. Extract accessibility
    const a11y = extractAccessibility();

    // 6. Detect AntD components
    const antdComponents = detectAntdComponents();

    // 7. Redaction info
    const redaction = injectedResults.redaction || {
      applied: false,
      textNodes: 0,
      images: 0,
      bgImages: 0,
      piiAttrs: 0,
    };

    // 8. Viewport metadata
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio || 1,
    };

    const metadata = {
      url: window.location.href,
      title: document.title,
      viewport,
      nodeCount: domNodes.length,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      manifestId: manifest?.id || 'none',
      redacted: redaction.applied,
    };

    // 9. Send complete package back
    sendResponse({
      type: 'EVIDENCE_EXTRACTED_V2',
      metadata,
      signals: {
        domNodes,
        computedStyles,
        rects,
        accessibility: a11y,
        antdComponents,
        fiber: injectedResults.fiber || { available: false },
        tokens: injectedResults.tokens || { available: false },
      },
      redaction,
    });
  } catch (err) {
    sendResponse({
      type: 'ERROR',
      error: err.message || 'V2 extraction failed',
      stack: err.stack,
    });
  }
}

// ─── Injected World Scripts ───────────────────────────────────

/**
 * Inject page-world scripts and collect their results via CustomEvent dispatch.
 * @param {boolean} redact - Whether to inject text-redactor
 * @returns {Promise<{ fiber: FiberInfo|null, tokens: TokenInfo|null, redaction: any|null }>}
 */
function injectAndWait(redact) {
  return new Promise((resolve) => {
    const results = { fiber: null, tokens: null, redaction: null };
    let pending = redact ? 3 : 2; // fiber + tokens + (redact)
    let settled = false;

    const onRedaction = (e) => {
      window.removeEventListener('__ANTHENA_REDACTION', onRedaction);
      results.redaction = e.detail;
      checkDone();
    };
    const onFiber = (e) => {
      window.removeEventListener('__ANTHENA_FIBER', onFiber);
      results.fiber = e.detail;
      checkDone();
    };
    const onTokens = (e) => {
      window.removeEventListener('__ANTHENA_TOKENS', onTokens);
      results.tokens = e.detail;
      checkDone();
    };

    function checkDone() {
      if (settled) return;
      const fiberDone = results.fiber !== null;
      const tokensDone = results.tokens !== null;
      const redactDone = !redact || results.redaction !== null;
      if (fiberDone && tokensDone && redactDone) {
        settled = true;
        resolve(results);
      }
    }

    // Listen before injecting (race-free ordering)
    window.addEventListener('__ANTHENA_FIBER', onFiber);
    window.addEventListener('__ANTHENA_TOKENS', onTokens);
    if (redact) window.addEventListener('__ANTHENA_REDACTION', onRedaction);

    // Inject scripts into page world
    try {
      const inject = (scriptName) => {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL(`injected/${scriptName}.js`);
        s.onload = () => s.remove();
        document.documentElement.appendChild(s);
      };

      inject('fiber-extractor');
      inject('token-probe');
      if (redact) inject('text-redactor');
    } catch (_) {
      // Fallback if chrome.runtime unavailable
    }

    // Safety timeout — resolve after 5s even if some events never fire
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(results);
      }
    }, 5000);
  });
}