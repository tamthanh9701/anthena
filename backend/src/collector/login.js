'use strict';

/**
 * Login flow: navigate to target app login page, fill credentials, wait for auth.
 */

const { logger } = require('../utils/logger');
const config = require('../config');

/**
 * Log in to the target application for a given role.
 * @param {import('playwright').Page} page
 * @param {string} role
 */
async function login(page, role) {
  const creds = config.credentials[role];
  if (!creds) {
    throw Object.assign(new Error(`Missing credentials for role '${role}'`), {
      statusCode: 400,
      code: 'CREDENTIAL_MISSING',
    });
  }
  
  const targetUrl = config.targetUrl;
  const log = logger.child({ module: 'collector', role });
  
  log.info({ targetUrl }, 'Navigating to login page');
  
  // Navigate to the target URL (which typically shows login page)
  await page.goto(targetUrl, {
    waitUntil: 'networkidle',
    timeout: config.routeTimeoutMs,
  });
  
  // Try common login selectors — these are configurable via env but we use heuristics
  const usernameSelectors = [
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[id*="user"]',
    'input[id*="email"]',
    'input[placeholder*="user"i]',
    'input[placeholder*="email"i]',
  ];
  
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password"]',
    'input[placeholder*="password"i]',
  ];
  
  let usernameField = null;
  for (const sel of usernameSelectors) {
    usernameField = await page.$(sel);
    if (usernameField) break;
  }
  
  let passwordField = null;
  for (const sel of passwordSelectors) {
    passwordField = await page.$(sel);
    if (passwordField) break;
  }
  
  if (!usernameField || !passwordField) {
    // Try heuristics: look for any visible text/email + password inputs
    const allInputs = await page.$$('input:visible');
    for (const input of allInputs) {
      const type = await input.getAttribute('type');
      if (type === 'password' && !passwordField) {
        passwordField = input;
      } else if (!passwordField && (type === 'text' || type === 'email' || !type)) {
        usernameField = input;
      }
    }
  }
  
  if (!usernameField || !passwordField) {
    throw Object.assign(new Error('Login failed: could not find username/password fields'), {
      statusCode: 400,
      code: 'LOGIN_FIELDS_NOT_FOUND',
    });
  }
  
  await usernameField.fill(creds.username);
  await passwordField.fill(creds.password);
  
  // Try to submit
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
  ];
  
  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      submitted = true;
      break;
    }
  }
  
  if (!submitted) {
    // Press Enter on password field
    await passwordField.press('Enter');
  }
  
  // Wait for navigation after login
  try {
    await page.waitForURL(url => !url.href.includes('login') && !url.href.includes('signin'), {
      timeout: 15000,
    });
  } catch {
    log.warn('Login navigation timeout — may already be logged in');
  }
  
  // Wait for network idle
  await page.waitForLoadState('networkidle').catch(() => {});
  
  log.info('Login completed');
  
  // Clear any credential values from the page (security)
  if (usernameField) await usernameField.fill('');
  if (passwordField) await passwordField.fill('');
}

module.exports = { login };