/**
 * Anthena V2 — Canonical Evidence Package schema
 * All signals collected into one lossless package.
 */

// ─── Scenario Manifest ─────────────────────────────────────

/** @typedef {{
  id: string,
  name: string,
  route: string,
  role: 'admin'|'operator'|'viewer'|'public',
  viewport: { width: number, height: number },
  theme: 'light'|'dark',
  locale: string,
  actions: string[],
  states: string[],
  tags: string[]
}} ScenarioManifest */

// ─── Signal flags — DERIVED from actual payload content ──

/** @typedef {{
  dom: boolean,
  computedCss: boolean,
  rects: boolean,
  accessibility: boolean,
  antdClasses: boolean,
  fiber: 'best-effort'|'unavailable',
  antdTokens: 'runtime'|'inferred-only'|'unavailable',
  redaction: boolean
}} SignalFlags */

// ─── Evidence Package (canonical, uploaded as multipart) ──

/** @typedef {{
  schemaVersion: string,
  extractorVersion: string,
  captureMode: 'chrome-extension-v2',
  captureSessionId: string,
  captureId: string,
  runId: string,
  manifestId: string,
  manifest: ScenarioManifest,
  url: string,
  routeKey: string,
  title: string,
  capturedAt: string,
  viewport: { width: number, height: number, deviceScaleFactor: number },
  signals: SignalFlags,
  nodeCount: number,
  redaction: { applied: boolean, textNodes: number, images: number, bgImages: number, piiAttrs: number, inputsRedacted: number, piiPatternsRedacted: number } | null,
  screenshot: { mode: 'viewport', format: 'webp'|'png', width: number, height: number }
}} EvidenceMetadata */

// ─── DOM Signal ────────────────────────────────────────────

/** @typedef {{
  tagName: string,
  id?: string,
  className?: string,
  antdClass?: string,
  boundingRect: { top: number, left: number, width: number, height: number },
  childCount: number,
  selector: string,
  textContent?: string
}} DomNode */

// ─── Computed CSS Signal ───────────────────────────────────

/** @typedef {{
  selector: string,
  styles: Record<string, string>
}} ComputedStyleEntry */

// ─── Rect Signal ───────────────────────────────────────────

/** @typedef {{
  tagName: string,
  rect: { top: number, left: number, width: number, height: number },
  selector: string
}} RectEntry */

// ─── Accessibility Signal ──────────────────────────────────

/** @typedef {{
  role: string,
  label: string,
  selector: string,
  focused: boolean
}} A11yEntry */

// ─── AntD Component Signal ─────────────────────────────────

/** @typedef {{
  component: string,
  selector: string,
  count: number,
  sampleRect: { top: number, left: number, width: number, height: number }
}} AntdComponentEntry */

// ─── Fiber Signal ──────────────────────────────────────────

/** @typedef {{
  available: boolean,
  rootName?: string,
  componentCount?: number,
  components?: { name: string, instanceCount: number, props?: string[] }[],
  hooks?: { total: number, byType: Record<string, number> }
}} FiberInfo */

// ─── Token Signal ──────────────────────────────────────────

/** @typedef {{
  available: boolean,
  source?: 'runtime'|'inferred',
  tokens?: Record<string, string>
}} TokenInfo */

// ─── Full Snapshot Payload (inside snapshot.json.gz) ──────

/** @typedef {{
  schemaVersion: string,
  extractorVersion: string,
  captureMode: 'chrome-extension-v2',
  captureSessionId: string,
  captureId: string,
  runId: string,
  manifestId: string,
  manifest: ScenarioManifest,
  url: string,
  routeKey: string,
  title: string,
  capturedAt: string,
  viewport: { width: number, height: number, deviceScaleFactor: number },
  signals: SignalFlags,
  nodeCount: number,
  redaction: { applied: boolean, textNodes: number, images: number, bgImages: number, piiAttrs: number, inputsRedacted: number, piiPatternsRedacted: number } | null,
  screenshot: { mode: 'viewport', format: 'webp', width: number, height: number },
  domNodes: DomNode[],
  computedStyles: ComputedStyleEntry[],
  rects: RectEntry[],
  accessibility: A11yEntry[],
  antdComponents: AntdComponentEntry[],
  fiber: FiberInfo | null,
  tokens: TokenInfo | null,
  provenance: {
    extensionVersion: string,
    browser: string,
    os: string,
    capturedVia: 'popup' | 'playwright',
    manifestSnapshot: string
  }
}} SnapshotPayload */

// ─── Helpers ───────────────────────────────────────────────

export function randomId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) result += chars[arr[i] % chars.length];
  return result;
}

export function captureId() {
  return `cap_${randomId(8)}`;
}

export const SCHEMA_VERSION = '2.0.0';
export const EXTRACTOR_VERSION = 'extension-v2.0.0';

/**
 * Build signal flags DERIVED from actual collected payload.
 * @param {object} signals
 * @param {object} [redaction] - Optional redaction info to derive redaction flag
 * @returns {SignalFlags}
 */
export function deriveSignalFlags(signals, redaction) {
  return {
    dom: Array.isArray(signals.domNodes) && signals.domNodes.length > 0,
    computedCss: Array.isArray(signals.computedStyles) && signals.computedStyles.length > 0,
    rects: Array.isArray(signals.rects) && signals.rects.length > 0,
    accessibility: Array.isArray(signals.accessibility) && signals.accessibility.length > 0,
    antdClasses: Array.isArray(signals.antdComponents) && signals.antdComponents.length > 0,
    fiber: signals.fiber?.available ? 'best-effort' : 'unavailable',
    antdTokens: signals.tokens?.available ? 'runtime' : 'unavailable',
    redaction: !!(redaction?.applied),
  };
}

// ─── Canonical Mapper ────────────────────────────────────────
// Maps extension raw signals into backend-validatable Evidence Package.

/**
 * Generate a nodeId from selector and index.
 * @param {string} selector
 * @param {number} index
 * @returns {string}
 */
export function makeNodeId(selector, index) {
  // Hash selector into short stable id
  let h = 0;
  for (let i = 0; i < selector.length; i++) {
    h = ((h << 5) - h + selector.charCodeAt(i)) | 0;
  }
  return `nd-${Math.abs(h).toString(16).padStart(4, '0')}-${index.toString(16).padStart(4, '0')}`;
}

/**
 * Convert raw extension signals into canonical Evidence Package.
 * This is the ONE mapper — backend validator, worker, and tests all consume the same shape.
 *
 * @param {{
 *   signals: {
 *     domNodes: Array,
 *     computedStyles: Array,
 *     rects: Array,
 *     accessibility: Array,
 *     antdComponents: Array,
 *     fiber: any,
 *     tokens: any
 *   },
 *   redaction: { applied: boolean, textNodes: number, images: number, bgImages: number, piiAttrs: number } | null,
 *   manifest: import('./schema.js').ScenarioManifest | null,
 *   captureSessionId: string,
 *   runId: string,
 *   routeKey: string,
 *   url: string,
 *   title: string,
 *   viewport: { width: number, height: number, deviceScaleFactor: number }
 * }} params
 * @returns {object} Canonical Evidence Package (backend-validatable)
 */
export function mapToCanonicalPackage(params) {
  const { signals, redaction, manifest, captureSessionId, runId, routeKey, url, title, viewport } = params;

  const packageId = `ev-${randomId(12)}`;
  const capturedAt = new Date().toISOString();
  const pkgHashPlaceholder = `sha256-${randomId(64)}`; // real hash computed post-serialization

  // ── Scenario (backend expects "scenario", not "manifest") ──
  const scenario = manifest ? {
    id: manifest.id,
    name: manifest.name,
    route: manifest.route,
    role: manifest.role,
    viewport: manifest.viewport,
    theme: manifest.theme,
    locale: manifest.locale,
    actions: manifest.actions,
    states: manifest.states,
    state: manifest.state || null,
    action: manifest.action || null,
    tags: manifest.tags,
    manifestId: manifest.id,
  } : {
    route: routeKey,
    role: 'public',
    viewport,
    theme: 'light',
    locale: 'en-US',
    actions: [],
    states: [],
  };

  // ── DOM: array → { nodes: [...], captureEvidence, extractorVersion } ──
  const domNodes = (signals.domNodes || []).map((n, i) => {
    const nodeId = makeNodeId(n.selector, i);
    return {
      nodeId,
      tag: n.tagName,
      classList: n.className ? n.className.split(/\s+/).filter(Boolean) : [],
      attributes: {
        ...(n.id ? { id: n.id } : {}),
        ...(n.antdClass ? { 'data-antd-component': n.antdClass } : {}),
      },
      rect: {
        x: n.boundingRect.left,
        y: n.boundingRect.top,
        w: n.boundingRect.width,
        h: n.boundingRect.height,
      },
      textContent: n.textContent || null,
      childCount: n.childCount,
      selector: n.selector,
      parentId: null, // flat list, parent resolution deferred to backend
    };
  });

  // ── CSS: array → { computed: { nodeId: styles }, captureEvidence, extractorVersion } ──
  const cssComputed = {};
  for (let i = 0; i < domNodes.length; i++) {
    const nodeId = domNodes[i].nodeId;
    const styleEntry = (signals.computedStyles || []).find(s => s.selector === domNodes[i].selector);
    cssComputed[nodeId] = styleEntry ? { ...styleEntry.styles } : {};
  }

  // ── AntD: array → { classMatches: { nodeId: {...} }, tokens: { tokenName: {...} }, captureEvidence, extractorVersion } ──
  const classMatches = {};
  const antdComps = signals.antdComponents || [];
  for (const comp of antdComps) {
    // Match to a DOM node by tag
    for (const dn of domNodes) {
      if (dn.tag === comp.selector.split('.')[0]?.replace(/^[a-z]+\./, '') && !classMatches[dn.nodeId]) {
        classMatches[dn.nodeId] = {
          componentName: comp.component,
          matchType: 'class',
          confidence: 0.85,
          variants: [`ant-${comp.component.toLowerCase()}`],
        };
        break;
      }
    }
  }

  // Build antd.tokens for backend
  const antdTokens = {};
  if (signals.tokens?.available && signals.tokens?.tokens) {
    for (const [tokenName, tokenValue] of Object.entries(signals.tokens.tokens)) {
      antdTokens[tokenName] = {
        value: tokenValue,
        source: signals.tokens.source || 'runtime',
        confidence: signals.tokens.source === 'runtime' ? 0.95 : 0.5,
        type: typeof tokenValue === 'string' ? 'string' : 'unknown',
      };
    }
  }

  // ── Fiber: component list → { nodes: { nodeId: {...} }, captureEvidence, extractorVersion } ──
  const fiberNodes = {};
  if (signals.fiber?.available && signals.fiber?.components) {
    for (let i = 0; i < signals.fiber.components.length; i++) {
      const comp = signals.fiber.components[i];
      const fiberId = `fb-${i.toString(16).padStart(4, '0')}`;
      fiberNodes[fiberId] = {
        componentName: comp.name,
        instanceCount: comp.instanceCount,
        props: comp.props || [],
        fiberType: 'function',
        depth: 0,
        confidence: 0.7,
      };
    }
  }

  // ── A11y: array → { nodes: { nodeId: {...} }, captureEvidence, extractorVersion } ──
  const a11yNodes = {};
  const a11yArr = signals.accessibility || [];
  for (let i = 0; i < a11yArr.length; i++) {
    const a = a11yArr[i];
    const a11yId = `a11-${i.toString(16).padStart(4, '0')}`;
    a11yNodes[a11yId] = {
      role: a.role,
      label: a.label || null,
      selector: a.selector,
      focused: a.focused,
    };
  }

  // ── Redaction ──────────────────────────────────────────────
  const redactionBlock = redaction?.applied ? {
    applied: true,
    textNodes: redaction.textNodes || 0,
    images: redaction.images || 0,
    bgImages: redaction.bgImages || 0,
    piiAttrs: redaction.piiAttrs || 0,
  } : null;

  // ── Provenance ─────────────────────────────────────────────
  const provenance = {
    packageHash: pkgHashPlaceholder,
    extensionVersion: '2.0.0',
    browser: 'chromium',
    os: 'unknown',
    capturedVia: 'popup',
    captureSessionId,
    runId,
    extractorVersion: EXTRACTOR_VERSION,
  };

  // ── Build canonical package ────────────────────────────────
  const canonical = {
    packageId,
    schemaVersion: SCHEMA_VERSION,
    capturedAt,
    url,
    title,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
    },
    scenario,
    screenshot: 'full.webp',
    dom: {
      nodes: domNodes,
      captureEvidence: `/evidence/${packageId}/dom`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    css: {
      computed: cssComputed,
      captureEvidence: `/evidence/${packageId}/css`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    antd: {
      classMatches,
      tokens: antdTokens,
      version: '5',
      captureEvidence: `/evidence/${packageId}/antd`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    fiber: {
      nodes: fiberNodes,
      captureEvidence: `/evidence/${packageId}/fiber`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    a11y: {
      nodes: a11yNodes,
      captureEvidence: `/evidence/${packageId}/a11y`,
      extractorVersion: EXTRACTOR_VERSION,
    },
    redaction: redactionBlock,
    provenance,
  };

  return canonical;
}

/**
 * Compute SHA-256 hash of a serialized canonical package.
 * In the extension, we use Web Crypto API; in Node, use crypto.
 * @param {object} canonicalPkg
 * @returns {Promise<string>}
 */
export async function hashCanonicalPackage(canonicalPkg) {
  const serialized = JSON.stringify(canonicalPkg);
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256-${hashHex}`;
}
