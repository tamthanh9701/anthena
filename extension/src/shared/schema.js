// ─── Schema types for extension snapshots ───────────────────────────────

/** @typedef {'pending'|'uploaded'|'normalized'|'analyzed'|'failed'} CaptureStatus */

/** @typedef {{ width: number, height: number, deviceScaleFactor: number }} Viewport */

/** @typedef {{
  mode: 'scroll-stitch'|'viewport',
  format: 'webp'|'png'|'jpeg',
  width: number,
  height: number,
  stitchConfidence?: number,
  issues?: string[]
}} Screenshot */

/** @typedef {{
  dom: boolean,
  computedCss: boolean,
  accessibility: boolean,
  fiber: 'best-effort'|'unavailable',
  antdTokens: 'runtime'|'inferred-only'|'unavailable'
}} Signals */

/** @typedef {{
  schemaVersion: string,
  extractorVersion: string,
  captureMode: 'chrome-extension',
  captureSessionId: string,
  captureId: string,
  runId: string,
  url: string,
  routeKey: string,
  title: string,
  capturedAt: string,
  viewport: Viewport,
  screenshot: Screenshot,
  signals: Signals,
  nodeCount: number,
  error?: string
}} SnapshotMetadata */

// ─── Capture Session Create Response ────────────────────────────────────

/** @typedef {{
  sessionId: string,
  runId: string,
  uploadToken: string,
  expiresAt: string,
  uploadUrl: string
}} CaptureSessionResponse */

// ─── Node Evidence ──────────────────────────────────────────────────────

/** @typedef {{
  tagName: string,
  id?: string,
  className?: string,
  antdClass?: string,
  boundingRect: { top: number, left: number, width: number, height: number },
  computedStyles: Record<string, string>,
  textContent?: string,
  childCount: number,
  selector: string
}} NodeEvidence */

// ─── Upload Package ─────────────────────────────────────────────────────

/** @typedef {{
  metadata: SnapshotMetadata,
  nodes: NodeEvidence[],
  screenshotBlob?: Blob
}} CapturePackage */

/**
 * Generate a short random ID
 * @param {number} len
 * @returns {string}
 */
export function randomId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) result += chars[arr[i] % chars.length];
  return result;
}

/**
 * Generate capture ID with prefix
 * @returns {string}
 */
export function captureId() {
  return `cap_${randomId(8)}`;
}

export const SCHEMA_VERSION = '1.1.0';
export const EXTRACTOR_VERSION = 'extension-0.1.0';
