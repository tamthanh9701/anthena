'use strict';

/**
 * Route navigation: navigate to a specific route URL, wait for SPA transition + network idle.
 */

const { logger } = require('../utils/logger');
const config = require('../config');

/**
 * Navigate to a route URL and wait for SPA transition + network idle.
 * @param {import('playwright').Page} page
 * @param {string} url
 */
async function navigate(page, url) {
  const log = logger.child({ module: 'collector' });
  log.info({ url }, 'Navigating to route');
  
  // Navigate to the route
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: config.routeTimeoutMs,
  });
  
  // Wait for URL to settle (SPA route transition)
  try {
    await page.waitForURL(url, { timeout: config.routeTimeoutMs });
  } catch {
    log.warn({ url }, 'SPA route URL did not match exactly — content may have redirected');
  }
  
  // Wait for network idle
  try {
    await page.waitForLoadState('networkidle', { timeout: config.routeTimeoutMs });
  } catch {
    log.warn({ url }, 'Network idle timeout — proceeding with current page state');
  }
  
  // Handle lazy-loaded content: scroll to bottom
  try {
    await page.evaluate(async () => {
      const scrollHeight = document.body.scrollHeight;
      window.scrollTo(0, scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      // Wait for any lazy images to load
      const images = Array.from(document.querySelectorAll('img[loading="lazy"]'));
      await Promise.all(images.map(img => 
        img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
      ));
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } catch (err) {
    log.warn({ err: err.message }, 'Lazy-load scroll encountered issues');
  }
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 200));
  
  log.info({ url }, 'Navigation complete');
}

module.exports = { navigate };