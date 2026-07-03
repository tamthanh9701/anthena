// ─── Image Stitcher Utilities ────────────────────────────────────────
// Utility for image chunk manipulation: decode, encode, resize.
// Runs in service worker or offscreen document context (uses OffscreenCanvas).

/**
 * Decode a data URL to ImageBitmap.
 * Uses createImageBitmap for offscreen decoding (works in service workers).
 *
 * @param {string} dataUrl
 * @returns {Promise<ImageBitmap>}
 * @throws {Error} If decoding fails
 */
export async function decodeImage(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return bitmap;
  } catch (err) {
    throw new Error(`Image decode failed: ${err.message}`);
  }
}

/**
 * Encode canvas content to WebP blob.
 * Uses OffscreenCanvas.convertToBlob().
 *
 * @param {OffscreenCanvas} canvas
 * @param {number} [quality=0.85] - WebP quality 0-1
 * @returns {Promise<Blob>}
 * @throws {Error} If encoding fails
 */
export async function encodeToWebP(canvas, quality = 0.85) {
  if (!(canvas instanceof OffscreenCanvas)) {
    throw new Error('encodeToWebP requires OffscreenCanvas instance');
  }

  try {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    return blob;
  } catch (err) {
    // Fallback: try without quality param (some Chrome versions)
    try {
      const blob = await canvas.convertToBlob({ type: 'image/webp' });
      return blob;
    } catch (fallbackErr) {
      throw new Error(`WebP encoding failed: ${fallbackErr.message}`);
    }
  }
}

/**
 * Encode canvas content to PNG blob (fallback format)
 * @param {OffscreenCanvas} canvas
 * @returns {Promise<Blob>}
 */
export async function encodeToPNG(canvas) {
  if (!(canvas instanceof OffscreenCanvas)) {
    throw new Error('encodeToPNG requires OffscreenCanvas instance');
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Resize an ImageBitmap to target dimensions using OffscreenCanvas
 * @param {ImageBitmap} bitmap
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {Promise<ImageBitmap>}
 */
export async function resizeImage(bitmap, targetWidth, targetHeight) {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get OffscreenCanvas 2D context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  return createImageBitmap(canvas);
}

/**
 * Get image dimensions from a data URL without full decode
 * @param {string} dataUrl
 * @returns {Promise<{width: number, height: number}>}
 */
export async function getImageDimensions(dataUrl) {
  const bitmap = await decodeImage(dataUrl);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close(); // free memory
  return dims;
}

// ─── Exports ─────────────────────────────────────────────────────────

export default { decodeImage, encodeToWebP, encodeToPNG, resizeImage, getImageDimensions };
