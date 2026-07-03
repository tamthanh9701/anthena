'use strict';

/**
 * Node cropping from full screenshot using sharp.
 * Also computes a simple visualHash for deduplication.
 */

const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

/**
 * Crop a node from the full screenshot.
 * @param {string} screenshotPath - Path to full screenshot
 * @param {string} outputDir - Directory to save crop
 * @param {string} nodeId - Node ID for filename
 * @param {{x: number, y: number, w: number, h: number}} rect - Bounding rect
 * @param {number} scaleFactor - Device scale factor (for retina)
 * @returns {Promise<{cropPath: string, visualHash: string}>}
 */
async function cropNode(screenshotPath, outputDir, nodeId, rect, scaleFactor = 1) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Apply scale factor if needed
    const x = Math.round(rect.x * scaleFactor);
    const y = Math.round(rect.y * scaleFactor);
    const w = Math.max(1, Math.round(rect.w * scaleFactor));
    const h = Math.max(1, Math.round(rect.h * scaleFactor));
    
    const cropPath = path.join(outputDir, `${nodeId}.webp`);
    
    const buffer = await sharp(screenshotPath)
      .extract({ left: x, top: y, width: w, height: h })
      .webp({ quality: 80, effort: 2 })
      .toBuffer();
    
    fs.writeFileSync(cropPath, buffer);
    
    // Compute visualHash (perceptual hash using average color + dimensions)
    const visualHash = await computeVisualHash(buffer);
    
    return { cropPath: `${nodeId}.webp`, visualHash };
  } catch (err) {
    logger.error({ err: err.message, nodeId }, 'Crop failed');
    return { cropPath: null, visualHash: null };
  }
}

/**
 * Compute a thumbnail (120x120 WebP).
 */
async function createThumbnail(screenshotPath, outputDir, nodeId, rect, scaleFactor = 1) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const x = Math.round(rect.x * scaleFactor);
    const y = Math.round(rect.y * scaleFactor);
    const w = Math.max(1, Math.round(rect.w * scaleFactor));
    const h = Math.max(1, Math.round(rect.h * scaleFactor));
    
    const thumbPath = path.join(outputDir, `${nodeId}.webp`);
    
    const buffer = await sharp(screenshotPath)
      .extract({ left: x, top: y, width: w, height: h })
      .resize(120, 120, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 60, effort: 1 })
      .toBuffer();
    
    fs.writeFileSync(thumbPath, buffer);
    
    return `${nodeId}.webp`;
  } catch (err) {
    logger.error({ err: err.message, nodeId }, 'Thumbnail failed');
    return null;
  }
}

/**
 * Compute a simple visual hash for a crop buffer.
 * Uses SHA-256 of reduced-size image for deduplication.
 */
async function computeVisualHash(buffer) {
  try {
    // Resize to 16x16 and get raw pixels for a compact "perceptual" hash
    const small = await sharp(buffer)
      .resize(16, 16, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    
    // Use SHA-256 of the downsized grayscale buffer
    const hash = crypto.createHash('sha256').update(small).digest('hex').slice(0, 32);
    return `vh:${hash}`;
  } catch {
    // Fallback: hash the original buffer
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
    return `vh:${hash}`;
  }
}

module.exports = { cropNode, createThumbnail, computeVisualHash };