// ─── Crop Planner ────────────────────────────────────────────────────
// Plans crop regions from node bounding rects for individual node evidence.
// Runs in content script or background context.

/**
 * @typedef {import('../shared/schema.js').NodeEvidence} NodeEvidence
 */

/**
 * @typedef {Object} CropRegion
 * @property {string} nodeSelector - CSS selector of the node
 * @property {number} x - Crop start X (px from left edge of full-page image)
 * @property {number} y - Crop start Y (px from top edge of full-page image)
 * @property {number} width - Crop width in px
 * @property {number} height - Crop height in px
 */

// ─── Defaults ────────────────────────────────────────────────────────

/** Padding around cropped elements (px) */
const DEFAULT_PADDING = 4;

/** Minimum crop dimension (px) — prevents zero-size crops */
const MIN_CROP_DIMENSION = 8;

/** Maximum crop dimension (px) — prevents absurdly large crops */
const MAX_CROP_DIMENSION = 4096;

// ─── Plan Crops ──────────────────────────────────────────────────────

/**
 * Plan crop regions from node bounding rects.
 * Maps absolute node coordinates to crop rectangles on the full-page image.
 * Handles edge cases: zero-size rects, out-of-bounds, overlapping nodes.
 *
 * @param {Array<{selector: string, boundingRect: {top: number, left: number, width: number, height: number}}>} nodes
 * @returns {CropRegion[]}
 */
export function planCrops(nodes) {
  if (!nodes || nodes.length === 0) return [];

  const crops = [];
  const seenSelectors = new Set();

  for (const node of nodes) {
    try {
      // Skip duplicate selectors (same node extracted twice)
      if (seenSelectors.has(node.selector)) continue;
      seenSelectors.add(node.selector);

      const { top, left, width, height } = node.boundingRect;

      // Skip invalid / zero-size rects
      if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
        continue;
      }

      // Clamp padding — don't exceed max
      const padding = Math.min(DEFAULT_PADDING, width * 0.5, height * 0.5);

      let x = Math.max(0, Math.round(left - padding));
      let y = Math.max(0, Math.round(top - padding));
      let w = Math.round(width + padding * 2);
      let h = Math.round(height + padding * 2);

      // Enforce minimum
      w = Math.max(MIN_CROP_DIMENSION, w);
      h = Math.max(MIN_CROP_DIMENSION, h);

      // Enforce maximum
      w = Math.min(MAX_CROP_DIMENSION, w);
      h = Math.min(MAX_CROP_DIMENSION, h);

      crops.push({
        nodeSelector: node.selector,
        x,
        y,
        width: w,
        height: h,
      });
    } catch {
      // Skip nodes that cause errors during planning
      continue;
    }
  }

  return crops;
}

// ─── Batch Crops ─────────────────────────────────────────────────────

/**
 * Plan crops and deduplicate overlapping regions.
 * If two crop regions overlap by >50%, keep the larger one.
 *
 * @param {Array<{selector: string, boundingRect: {top: number, left: number, width: number, height: number}}>} nodes
 * @returns {CropRegion[]}
 */
export function planCropsDeduplicated(nodes) {
  const crops = planCrops(nodes);

  // Sort by area descending — keep larger crops
  const sorted = [...crops].sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const result = [];
  for (const crop of sorted) {
    let isDuplicate = false;

    for (const kept of result) {
      const overlap = computeOverlap(crop, kept);
      const overlapRatio = overlap / Math.min(crop.width * crop.height, kept.width * kept.height);

      if (overlapRatio > 0.5) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(crop);
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute overlap area between two rectangles
 * @param {{x: number, y: number, width: number, height: number}} a
 * @param {{x: number, y: number, width: number, height: number}} b
 * @returns {number}
 */
function computeOverlap(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

/**
 * Filter crops to only those within a given viewport region.
 * Useful when you only need crops for visible content.
 *
 * @param {CropRegion[]} crops
 * @param {{x: number, y: number, width: number, height: number}} viewport
 * @returns {CropRegion[]}
 */
export function filterCropsInViewport(crops, viewport) {
  return crops.filter(crop => {
    const cx = crop.x + crop.width / 2;
    const cy = crop.y + crop.height / 2;
    return (
      cx >= viewport.x &&
      cx <= viewport.x + viewport.width &&
      cy >= viewport.y &&
      cy <= viewport.y + viewport.height
    );
  });
}

// ─── Exports ─────────────────────────────────────────────────────────

export default { planCrops, planCropsDeduplicated, filterCropsInViewport };
