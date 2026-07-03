'use strict';

/**
 * Screenshot capture: full-page WebP screenshot.
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

/**
 * Take a full-page screenshot, save as WebP.
 * @param {import('playwright').Page} page
 * @param {string} outputPath
 * @returns {Promise<{width: number, height: number, deviceScaleFactor: number}>}
 */
async function captureScreenshot(page, outputPath) {
  const log = logger.child({ module: 'collector' });
  
  // Get page metrics
  const metrics = await page.evaluate(() => {
    return {
      width: document.documentElement.scrollWidth || document.body.scrollWidth,
      height: document.documentElement.scrollHeight || document.body.scrollHeight,
      deviceScaleFactor: window.devicePixelRatio || 1,
    };
  });
  
  // Get viewport size
  const viewport = page.viewportSize();
  
  // Take screenshot (full page)
  const buffer = await page.screenshot({
    type: 'png',
    fullPage: true,
  });
  
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Convert to WebP using sharp
  const webpBuffer = await sharp(buffer)
    .webp({ quality: 85, effort: 4 })
    .toBuffer();
  
  fs.writeFileSync(outputPath, webpBuffer);
  
  log.info({ 
    width: viewport.width, 
    height: metrics.height, 
    webpSize: `${(webpBuffer.length / 1024).toFixed(1)} KB` 
  }, 'Screenshot captured');
  
  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: metrics.deviceScaleFactor,
  };
}

module.exports = { captureScreenshot };