/**
 * Evidence Package Assembler V2
 * Builds canonical Evidence Package from collected signals.
 * All signals mapped into backend-validatable format via shared canonical mapper.
 *
 * Protocol: POST pure JSON (Content-Type: application/json) with canonical package.
 * Screenshot is referenced by filename "full.webp" in the package; the blob is
 * uploaded separately or not at all for test — backend stores it independently.
 *
 * The canonical output of buildEvidencePackage() passes backend's
 * validateEvidencePackage() directly.
 */

import {
  SCHEMA_VERSION,
  EXTRACTOR_VERSION,
  deriveSignalFlags,
  mapToCanonicalPackage,
  hashCanonicalPackage,
  randomId,
} from '../shared/schema.js';
import { compressGzip } from '../shared/compression.js';
import { fetchWithTimeout, AuthError } from '../shared/errors.js';

/**
 * Build a canonical Evidence Package from collected signals.
 * @param {{
 *   signals: { domNodes: any[], computedStyles: any[], rects: any[], accessibility: any[], antdComponents: any[], fiber: any, tokens: any },
 *   metadata: object,
 *   redaction: object|null,
 *   manifest: object|null,
 *   captureSessionId: string,
 *   runId: string,
 *   routeKey: string,
 *   url: string,
 *   title: string,
 *   viewport: { width: number, height: number, deviceScaleFactor: number },
 *   screenshot: { mode: string, format: string, width: number, height: number }
 * }} params
 * @returns {Promise<{ canonical: object, snapshotGzip: Blob }>}
 */
export async function buildEvidencePackage(params) {
  const {
    signals, redaction, manifest,
    captureSessionId, runId, routeKey,
    url, title, viewport,
  } = params;

  // 1. Map to canonical shape
  const canonical = mapToCanonicalPackage({
    signals, redaction, manifest,
    captureSessionId, runId, routeKey,
    url, title, viewport,
  });

  // 2. Compute real hash and replace placeholder
  const realHash = await hashCanonicalPackage(canonical);
  canonical.provenance.packageHash = realHash;

  // 3. Gzip snapshot for archive
  const snapshotJson = JSON.stringify(canonical);
  const snapshotGzip = await compressGzip(snapshotJson);

  return { canonical, snapshotGzip };
}

/**
 * Upload the canonical Evidence Package as pure JSON.
 * Protocol: POST /api/v2/evidence with Content-Type: application/json.
 * The backend reads the canonical JSON from req.body (or req.body.package).
 *
 * @param {{
 *   uploadUrl: string,
 *   uploadToken: string,
 *   runId: string,
 *   canonical: object
 * }} params
 * @returns {Promise<{captureId: string, status: string, existed?: boolean}>}
 */
export async function uploadEvidencePackage(params) {
  const { uploadUrl, uploadToken, runId, canonical, screenshotBlob } = params;

  if (!uploadUrl || !uploadToken) {
    throw new AuthError('No upload token configured');
  }

  let payload = canonical;
  if (screenshotBlob) {
    const bytes = new Uint8Array(await screenshotBlob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    payload = {
      ...canonical,
      screenshot: `data:${screenshotBlob.type || 'image/webp'};base64,${btoa(binary)}`,
    };
  }

  const response = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${uploadToken}`,
      'Content-Type': 'application/json',
      'X-Anthena-Version': '2.0.0',
      'X-Anthena-Run-Id': runId,
      'X-Anthena-Capture-Id': canonical.packageId,
    },
    body: JSON.stringify(payload),
  }, 60000);

  return await response.json();
}
