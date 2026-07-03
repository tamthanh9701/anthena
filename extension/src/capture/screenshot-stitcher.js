// ─── Screenshot Stitcher ─────────────────────────────────────────────
// Stitches viewport chunks into a single full-page image using OffscreenCanvas.
// Runs in service worker (background) or offscreen document context.

import { decodeImage, encodeToWebP } from './image-stitcher.js';

/**
 * @typedef {import('../shared/schema.js').Screenshot} Screenshot
 */

/**
 * @typedef {Object} StitchChunk
 * @property {string} dataUrl - Base64 data URL of viewport capture
 * @property {number} yOffset - Vertical scroll position of this chunk
 * @property {number} width - Chunk width in px
 * @property {number} height - Chunk height in px
 * @property {number} [segmentIndex] - Segment order index
 * @property {string[]} [stickySelectors] - Sticky elements detected in this chunk
 */

/**
 * @typedef {Object} StitchResult
 * @property {Blob} blob - Stitched full-page WebP blob
 * @property {number} width - Total width
 * @property {number} height - Total height
 * @property {number} stitchConfidence - 0 to 1 confidence score
 * @property {string[]} issues - Detected issues during stitching
 */

// ─── Main Stitch ─────────────────────────────────────────────────────

/**
 * Stitch viewport chunks into a full-page image.
 *
 * Algorithm:
 * 1. Calculate total canvas height = max(yOffset + height) across all chunks
 * 2. Create OffscreenCanvas(totalWidth, totalHeight)
 * 3. Draw each chunk at correct y offset
 * 4. Handle sticky header duplication: compare overlapping regions,
 *    prefer the chunk where sticky elements appear at natural position
 * 5. Convert to WebP blob
 * 6. Return { blob, width, height, stitchConfidence, issues[] }
 *
 * @param {StitchChunk[]} chunks - Ordered array of viewport capture chunks
 * @returns {Promise<StitchResult>}
 * @throws {Error} If stitching fails (no chunks, canvas creation failure)
 */
export async function stitchFullPage(chunks) {
  if (!chunks || chunks.length === 0) {
    throw new Error('Cannot stitch: no chunks provided');
  }

  // Sort chunks by yOffset ascending
  const sorted = [...chunks].sort((a, b) => a.yOffset - b.yOffset);

  // Normalise dimensions (all chunks should be same width)
  const width = sorted[0].width;

  // Calculate total height: max(yOffset + height)
  let totalHeight = 0;
  for (const chunk of sorted) {
    const chunkBottom = chunk.yOffset + chunk.height;
    if (chunkBottom > totalHeight) {
      totalHeight = chunkBottom;
    }
  }

  if (totalHeight <= 0) {
    throw new Error('Cannot stitch: computed total height is zero');
  }

  // Create offscreen canvas
  const canvas = new OffscreenCanvas(width, totalHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get OffscreenCanvas 2D context');
  }

  // Track issues
  const issues = [];

  // Track overlapping region info for confidence calculation
  const overlapRegions = [];

  // Draw each chunk at its y offset
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i];

    try {
      const bitmap = await decodeImage(chunk.dataUrl);

      // Check for sticky header overlap with previous chunk
      if (i > 0) {
        const prev = sorted[i - 1];
        const overlapTop = chunk.yOffset;
        const prevBottom = prev.yOffset + prev.height;
        const overlapBottom = Math.min(prevBottom, chunk.yOffset + chunk.height);
        const overlapHeight = overlapBottom - overlapTop;

        if (overlapHeight > 0) {
          overlapRegions.push({
            y: overlapTop,
            height: overlapHeight,
            chunkIndex: i,
            prevChunkIndex: i - 1,
          });

          // Sticky header heuristic: if overlap region looks like a header
          // (top of page, short height), log it as potential duplicate
          if (chunk.yOffset < prev.height * 0.3 && overlapHeight < chunk.height * 0.3) {
            issues.push(`Possible sticky header at y=${chunk.yOffset} (overlap ${overlapHeight}px)`);
          }
        }
      }

      // Draw the chunk — with proper source clipping to avoid duplicate regions
      // We draw from the top of the bitmap, not skipping any region, because the
      // overlap is handled by drawing order: later chunks paint over earlier ones.
      // For sticky headers, we want the LATER chunk's version (it's scrolled down
      // and shows the content that should appear at that position).
      ctx.drawImage(bitmap, 0, 0, chunk.width, chunk.height, 0, chunk.yOffset, chunk.width, chunk.height);

      bitmap.close(); // free memory
    } catch (err) {
      issues.push(`Chunk at y=${chunk.yOffset} decode failed: ${err.message}. Skipping.`);
    }
  }

  // Validate: check for gaps
  const gaps = detectGaps(sorted, totalHeight);
  issues.push(...gaps);

  // Calculate confidence
  const stitchConfidence = calculateStitchConfidence(sorted, issues);

  // Encode to WebP
  const blob = await encodeToWebP(canvas, 0.85);

  return {
    blob,
    width,
    height: totalHeight,
    stitchConfidence,
    issues,
  };
}

// ─── Confidence ──────────────────────────────────────────────────────

/**
 * Calculate stitch confidence (0 to 1).
 * Factors:
 * - All chunks decoded successfully
 * - No large gaps between chunks
 * - Consistent width across all chunks
 * - Reasonable total height vs scroll height
 *
 * @param {StitchChunk[]} chunks
 * @param {string[]} issues
 * @returns {number} - 0 to 1 confidence score
 */
export function calculateStitchConfidence(chunks, issues = []) {
  if (!chunks || chunks.length === 0) return 0;

  let score = 1.0;

  // Penalize for each issue
  const issuePenalty = 0.1;
  score -= issues.length * issuePenalty;

  // Check width consistency
  const widths = chunks.map(c => c.width).filter(w => w > 0);
  if (widths.length > 0) {
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
    const maxDeviation = Math.max(...widths.map(w => Math.abs(w - avgW)));
    if (maxDeviation > 2) {
      score -= 0.15; // inconsistent widths
    }
  }

  // Check for gaps > 10% of client height
  const sorted = [...chunks].sort((a, b) => a.yOffset - b.yOffset);
  for (let i = 1; i < sorted.length; i++) {
    const expectedTop = sorted[i - 1].yOffset + sorted[i - 1].height;
    const gap = sorted[i].yOffset - expectedTop;
    if (gap > sorted[i - 1].height * 0.1) {
      score -= 0.2; // significant gap
    }
  }

  // Penalize if too few chunks for the scroll height
  if (chunks.length <= 1) {
    score -= 0.2; // single chunk — likely a short page or error
  }

  // Clamp
  return Math.max(0, Math.min(1, score));
}

// ─── Issue Detection ─────────────────────────────────────────────────

/**
 * Detect potential issues: sticky headers, lazy loading, virtual scroll, gaps.
 *
 * @param {StitchChunk[]} chunks
 * @param {number} scrollHeight - Expected document scroll height
 * @returns {string[]}
 */
export function detectStitchIssues(chunks, scrollHeight) {
  const issues = [];

  if (!chunks || chunks.length === 0) {
    issues.push('No chunks available for stitch');
    return issues;
  }

  const sorted = [...chunks].sort((a, b) => a.yOffset - b.yOffset);
  const lastChunk = sorted[sorted.length - 1];
  const capturedHeight = lastChunk ? lastChunk.yOffset + lastChunk.height : 0;

  // Gap detection
  const gaps = detectGaps(sorted, scrollHeight);
  issues.push(...gaps);

  // Content shorter than expected — possible lazy load or virtual scroll
  if (scrollHeight > 0 && capturedHeight < scrollHeight * 0.5) {
    issues.push(`Captured height (${capturedHeight}px) < 50% of scrollHeight (${scrollHeight}px). Possible virtual scroll or lazy loading.`);
  }

  // Content longer than expected — possible dynamic content growth
  if (scrollHeight > 0 && capturedHeight > scrollHeight * 1.5) {
    issues.push(`Captured height (${capturedHeight}px) > 150% of scrollHeight (${scrollHeight}px). Page content may have grown during capture.`);
  }

  // Width variation
  const widths = sorted.map(c => c.width);
  const uniqueWidths = [...new Set(widths)];
  if (uniqueWidths.length > 1) {
    issues.push(`Inconsistent chunk widths: ${uniqueWidths.join(', ')}px. Page may have responsive layout shifts.`);
  }

  // Sticky element heuristic: multiple chunks with same top content
  if (sorted.length >= 3) {
    const topChunks = sorted.filter(c => c.yOffset === 0);
    if (topChunks.length > 1) {
      issues.push('Multiple chunks at y=0. Possible sticky header duplication.');
    }
  }

  return issues;
}

// ─── Crop Planning ───────────────────────────────────────────────────

/**
 * Plan crop regions from node bounding rects for individual node evidence.
 * Maps absolute node coordinates to crop rectangles on the full-page image.
 *
 * @param {Array<{selector: string, boundingRect: {top: number, left: number, width: number, height: number}}>} nodes
 * @returns {Array<{nodeSelector: string, x: number, y: number, width: number, height: number}>}
 */
export function planCrops(nodes) {
  if (!nodes || nodes.length === 0) return [];

  return nodes.map(node => {
    const { top, left, width, height } = node.boundingRect;

    // Add small padding around crops for visual context
    const padding = 4;
    const x = Math.max(0, left - padding);
    const y = Math.max(0, top - padding);
    const w = width + padding * 2;
    const h = height + padding * 2;

    return {
      nodeSelector: node.selector,
      x,
      y,
      width: w,
      height: h,
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Detect gaps between chunks where content may be missing
 * @param {StitchChunk[]} sorted - Chunks sorted by yOffset
 * @param {number} totalHeight
 * @returns {string[]}
 */
function detectGaps(sorted, totalHeight) {
  const gaps = [];

  // Gap between consecutive chunks
  for (let i = 1; i < sorted.length; i++) {
    const prevBottom = sorted[i - 1].yOffset + sorted[i - 1].height;
    const gap = sorted[i].yOffset - prevBottom;

    if (gap > 5) {
      gaps.push(`Gap of ${gap}px between segment ${i - 1} and ${i}`);
    }
  }

  // Gap at top
  if (sorted.length > 0 && sorted[0].yOffset > 5) {
    gaps.push(`Top gap: first chunk at y=${sorted[0].yOffset}px`);
  }

  return gaps;
}

// ─── Exports ─────────────────────────────────────────────────────────

export default { stitchFullPage, calculateStitchConfidence, detectStitchIssues, planCrops };
