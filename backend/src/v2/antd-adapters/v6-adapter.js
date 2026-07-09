/**
 * AntD v6 Adapter — Extended Token Model with v6 Alpha Changes
 *
 * AntD v6 extends v5's CSS-in-JS token system with:
 *  - Renamed tokens: colorTextQuaternary → colorTextDisabled
 *  - New tokens: colorBgCell, colorBgInput, colorBgPopover
 *  - Adjusted defaults: borderRadius → 8px, controlHeight → 34px
 *  - New heading scale: fontSizeHeading1-6 (tighter)
 *  - New border radii: borderRadiusOuter, borderRadiusInner
 *  - New motion tokens: motionDurationExtraFast, motionDurationExtraSlow
 *
 * This adapter wraps the v5 adapter and applies v6 deltas on top.
 */

'use strict';

const v5Adapter = require('./v5-adapter');
const {
  SEED_TOKENS,
  MAP_TOKENS,
  ALIAS_TOKENS,
  COMPONENT_TOKENS,
  V6_TOKEN_DELTA,
  SUPPORTED_COMPONENTS,
  CLASS_TO_COMPONENT,
  SEED_TO_COMPONENT_DERIVATION,
} = require('./mapping-data');

const VERSION = '6';
const ADAPTER_NAME = 'Ant Design v6 (Extended CSS-in-JS Token Model)';

/**
 * Build a v6-adjusted default token set by overlaying V6_TOKEN_DELTA
 * over the v5 defaults.
 */
function buildV6Defaults(baseDefaults) {
  const merged = { ...baseDefaults };

  // Apply v6 renamed tokens
  if (V6_TOKEN_DELTA.renamed) {
    for (const [oldName, newName] of Object.entries(V6_TOKEN_DELTA.renamed)) {
      if (oldName in merged) {
        merged[newName] = merged[oldName];
        delete merged[oldName];
      }
    }
  }

  // Apply v6 added tokens
  if (V6_TOKEN_DELTA.added) {
    Object.assign(merged, V6_TOKEN_DELTA.added);
  }

  // Apply v6 changed default values
  if (V6_TOKEN_DELTA.changed) {
    Object.assign(merged, V6_TOKEN_DELTA.changed);
  }

  return merged;
}

// Pre-compute v6-adjusted defaults
const V6_SEED_TOKENS = buildV6Defaults(SEED_TOKENS);
const V6_MAP_TOKENS = buildV6Defaults(MAP_TOKENS);
const V6_ALIAS_TOKENS = buildV6Defaults(ALIAS_TOKENS);
const V6_COMPONENT_TOKENS = {};
for (const [compName, tokens] of Object.entries(COMPONENT_TOKENS)) {
  V6_COMPONENT_TOKENS[compName] = buildV6Defaults(tokens);
}

/**
 * Map raw tokens into seed/map/alias/component model with v6 adjustments.
 *
 * @param {Record<string,string>} rawTokens
 * @returns {{ seed: object, map: object, alias: object, components: object }}
 */
function mapTokens(rawTokens) {
  // Use v5 mapper first
  const result = v5Adapter.mapTokens(rawTokens);

  // Apply v6 renames to the mapped result
  if (V6_TOKEN_DELTA.renamed) {
    for (const [oldName, newName] of Object.entries(V6_TOKEN_DELTA.renamed)) {
      // Rename in seed
      if (oldName in result.seed) {
        result.seed[newName] = result.seed[oldName];
        delete result.seed[oldName];
      }
      // Rename in map
      if (oldName in result.map) {
        result.map[newName] = result.map[oldName];
        delete result.map[oldName];
      }
      // Rename in alias
      if (oldName in result.alias) {
        result.alias[newName] = result.alias[oldName];
        delete result.alias[oldName];
      }
    }
  }

  // Remove tokens that were removed in v6
  if (V6_TOKEN_DELTA.removed) {
    for (const removedName of V6_TOKEN_DELTA.removed) {
      delete result.seed[removedName];
      delete result.map[removedName];
      delete result.alias[removedName];
    }
  }

  // Apply v6 changed default values only where no runtime value was captured
  if (V6_TOKEN_DELTA.changed) {
    for (const [name, defaultValue] of Object.entries(V6_TOKEN_DELTA.changed)) {
      // Only set if not already captured from runtime
      if (name in V6_SEED_TOKENS && !(name in result.seed)) {
        result.seed[name] = defaultValue;
      }
      if (name in V6_MAP_TOKENS && !(name in result.map)) {
        result.map[name] = defaultValue;
      }
      if (name in V6_ALIAS_TOKENS && !(name in result.alias)) {
        result.alias[name] = defaultValue;
      }
    }
  }

  return result;
}

/**
 * Resolve component-level tokens with v6 defaults.
 *
 * @param {string} componentName
 * @param {object} seedTokens
 * @param {object} mapTokens
 * @returns {object}
 */
function resolveComponentTokens(componentName, seedTokens, mapTokens) {
  // Get v5 resolution
  const baseResult = v5Adapter.resolveComponentTokens(componentName, seedTokens, mapTokens);

  // Overlay v6 component-specific defaults
  const v6CompDefaults = V6_COMPONENT_TOKENS[componentName];
  if (!v6CompDefaults) return baseResult;

  const merged = { ...v6CompDefaults, ...baseResult };

  // Apply v6 renamed tokens in component scope
  if (V6_TOKEN_DELTA.renamed) {
    for (const [oldName, newName] of Object.entries(V6_TOKEN_DELTA.renamed)) {
      if (oldName in merged) {
        merged[newName] = merged[oldName];
        delete merged[oldName];
      }
    }
  }

  return merged;
}

/**
 * Get default fallback tokens for a component using v6 defaults.
 *
 * @param {string} componentName
 * @returns {object}
 */
function getDefaultTokens(componentName) {
  const defaults = V6_COMPONENT_TOKENS[componentName];
  if (!defaults) return {};
  return { ...defaults };
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  version: VERSION,
  name: ADAPTER_NAME,
  supportedComponents: SUPPORTED_COMPONENTS,
  mapTokens,
  resolveComponentTokens,
  getDefaultTokens,
  classToComponent: CLASS_TO_COMPONENT,
};