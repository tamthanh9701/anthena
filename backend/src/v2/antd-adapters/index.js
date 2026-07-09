/**
 * Ant Design Token Mapping Adapters — Index
 *
 * Auto-selects the correct adapter by AntD version string.
 * Versions:
 *   '4'  — Less variable model (legacy)
 *   '5'  — CSS-in-JS token model (seed → map → alias → component)
 *   '6'  — Extended token model (v6 alpha changes)
 *
 * Each adapter exposes:
 *   version, name, supportedComponents,
 *   mapTokens(rawTokens), resolveComponentTokens(comp, seed, map),
 *   getDefaultTokens(comp), classToComponent
 */

'use strict';

const v4Adapter = require('./v4-adapter');
const v5Adapter = require('./v5-adapter');
const v6Adapter = require('./v6-adapter');

const ADAPTERS = {
  '4': v4Adapter,
  '5': v5Adapter,
  '6': v6Adapter,
};

const DEFAULT_VERSION = '5';

/**
 * Select the correct adapter for a given AntD version.
 *
 * Version matching:
 *   - Exact: '4', '5', '6'
 *   - Semver: '5.27.4' → '5', '4.21.0' → '4'
 *   - Pre-release: '6.0.0-alpha.1' → '6'
 *
 * @param {string} version - AntD version string
 * @returns {object} adapter
 * @throws {Error} if version is unsupported
 */
function getAdapter(version) {
  if (!version) return getAdapter(DEFAULT_VERSION);

  // Extract major version from semver string
  const major = String(version).match(/^(\d+)/);
  const majorVersion = major ? major[1] : version;

  if (ADAPTERS[majorVersion]) {
    return ADAPTERS[majorVersion];
  }

  throw new Error(`Unsupported AntD version: ${version}. Supported major versions: 4, 5, 6`);
}

/**
 * List all available adapter versions.
 * @returns {string[]}
 */
function listAdapters() {
  return Object.keys(ADAPTERS);
}

/**
 * List all supported component names across all adapters.
 * @returns {string[]}
 */
function listSupportedComponents() {
  return v5Adapter.supportedComponents;
}

/**
 * Classify an AntD CSS class using the selected adapter's mapping.
 * Uses the longest known prefix so modifier classes stay attached to
 * their owning component (for example ant-btn-dangerous -> Button).
 */
function classifyClass(version, className) {
  if (typeof className !== 'string' || !className.trim()) return null;
  const mapping = getAdapter(version).classToComponent;
  const value = className.trim();
  if (mapping[value]) return mapping[value];

  const candidates = Object.keys(mapping)
    .filter(prefix => value.startsWith(`${prefix}-`))
    .sort((a, b) => b.length - a.length);
  return candidates.length ? mapping[candidates[0]] : null;
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  getAdapter,
  listAdapters,
  listSupportedComponents,
  classifyClass,
  adapters: ADAPTERS,
  v4: v4Adapter,
  v5: v5Adapter,
  v6: v6Adapter,
};
