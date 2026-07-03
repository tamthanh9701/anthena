'use strict';

/**
 * Collector module — Playwright browser lifecycle.
 * Handles browser launch, context creation, and teardown.
 */

const { chromium } = require('playwright');
const { logger } = require('../utils/logger');
const config = require('../config');

let browser = null;
let browserLaunching = false;
let launchPromise = null;

/**
 * Get or create the Playwright browser instance.
 */
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  
  if (browserLaunching) {
    return launchPromise;
  }
  
  browserLaunching = true;
  launchPromise = (async () => {
    try {
      logger.info({ headless: config.playwrightHeadless }, 'Launching Playwright browser');
      browser = await chromium.launch({
        headless: config.playwrightHeadless,
        args: [
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
        ],
      });
      
      browser.on('disconnected', () => {
        logger.warn('Playwright browser disconnected');
        browser = null;
      });
      
      logger.info('Playwright browser launched');
      return browser;
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to launch Playwright browser');
      browser = null;
      throw err;
    } finally {
      browserLaunching = false;
    }
  })();
  
  return launchPromise;
}

/**
 * Create a new browser context (isolated session per role).
 */
async function createContext(role) {
  const br = await getBrowser();
  const context = await br.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: null, // Don't record video
  });
  return context;
}

/**
 * Close the browser.
 */
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (_) {}
    browser = null;
  }
}

/**
 * Check if browser is ready.
 */
function isBrowserReady() {
  return !!(browser && browser.isConnected());
}

module.exports = { getBrowser, createContext, closeBrowser, isBrowserReady };