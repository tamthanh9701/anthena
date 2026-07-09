/**
 * AntD v4 Adapter — Less Variable → v5 Token Model Mapping
 *
 * AntD v4 uses Less variables compiled at build time.
 * This adapter bridges v4 Less variable names to the canonical
 * v5 token hierarchy (seed → map → alias → component).
 *
 * Strategy:
 *  1. Map v4 Less variable names to canonical v5 token names via V4_LESS_TO_V5
 *  2. Categorize into seed/map/alias/component buckets
 *  3. Resolve component tokens from mapped values
 *  4. Fall back to v5 defaults for unmapped tokens
 */

'use strict';

const {
  V4_LESS_TO_V5,
  SEED_TOKENS,
  MAP_TOKENS,
  ALIAS_TOKENS,
  COMPONENT_TOKENS,
  SUPPORTED_COMPONENTS,
  CLASS_TO_COMPONENT,
  SEED_TO_COMPONENT_DERIVATION,
} = require('./mapping-data');

const VERSION = '4';
const ADAPTER_NAME = 'Ant Design v4 (Less Variable Model)';

/**
 * Map raw v4 tokens (less variable names or flat tokens) into
 * canonical seed / map / alias / component model.
 *
 * @param {Record<string,string>} rawTokens - flat tokens, may use @variable names
 * @returns {{ seed: object, map: object, alias: object, components: object }}
 */
function mapTokens(rawTokens) {
  if (!rawTokens || typeof rawTokens !== 'object') {
    return { seed: {}, map: {}, alias: {}, components: {} };
  }

  const seed = {};
  const map = {};
  const alias = {};
  const components = {};

  for (const [rawName, rawValue] of Object.entries(rawTokens)) {
    const value = typeof rawValue === 'object' && rawValue !== null
      ? (rawValue.value || rawValue.tokenValue || rawValue.computed || String(rawValue))
      : String(rawValue);

    // Step 1: Translate v4 Less variable name to v5 canonical name
    const canonicalName = translateV4ToV5(rawName);

    // Step 2: Classify into buckets
    const classified = classifyToken(canonicalName);
    if (!classified) {
      // Unknown token — put it in alias as-is
      alias[canonicalName] = value;
      continue;
    }

    // Step 3: If it's a component token, route to component bucket
    if (classified.bucket === 'component') {
      if (!components[classified.componentName]) {
        components[classified.componentName] = {};
      }
      components[classified.componentName][classified.tokenKey] = value;
      continue;
    }

    // Step 4: Route to seed/map/alias
    classified.bucket === 'seed' ? (seed[canonicalName] = value)
      : classified.bucket === 'map' ? (map[canonicalName] = value)
      : (alias[canonicalName] = value);
  }

  return { seed, map, alias, components };
}

/**
 * Translate a v4 Less variable name (or already-canonical name) to v5 token name.
 * Handles: @variable → variable, camelCase normalization.
 *
 * @param {string} name - raw token name (may be @variable or canonical)
 * @returns {string} - canonical v5 token name
 */
function translateV4ToV5(name) {
  // Strip @ prefix if present
  const stripped = name.startsWith('@') ? name.slice(1) : name;

  // Direct mapping in V4_LESS_TO_V5
  if (V4_LESS_TO_V5[name]) {
    const mapped = V4_LESS_TO_V5[name];
    // If mapped value is a token name reference (not a CSS value), return it
    if (!mapped.includes('#') && !mapped.includes('px') && !mapped.includes('rgba')
        && !mapped.includes('(') && !mapped.includes('solid')) {
      return mapped;
    }
    // Otherwise the mapped value IS the default value, return the extracted token name
    // e.g., '@table-header-bg': '#fafafa' → just return the raw name
    return stripped;
  }

  // Try mapping without @ (some users provide names without @)
  const withAt = `@${stripped}`;
  if (V4_LESS_TO_V5[withAt]) {
    const mapped = V4_LESS_TO_V5[withAt];
    if (!mapped.includes('#') && !mapped.includes('px') && !mapped.includes('rgba')
        && !mapped.includes('(') && !mapped.includes('solid')) {
      return mapped;
    }
    return stripped;
  }

  // Check if the name is already a valid v5 token name
  if (stripped in SEED_TOKENS || stripped in MAP_TOKENS || stripped in ALIAS_TOKENS) {
    return stripped;
  }

  // Fallback: use as-is
  return stripped;
}

/**
 * Classify a canonical token name into bucket + optional component info.
 *
 * @param {string} tokenName
 * @returns {{ bucket: 'seed'|'map'|'alias'|'component', componentName?: string, tokenKey?: string }|null}
 */
function classifyToken(tokenName) {
  // Component token: "Component.tokenName"
  const dotIdx = tokenName.indexOf('.');
  if (dotIdx > 0) {
    const comp = tokenName.slice(0, dotIdx);
    const tok = tokenName.slice(dotIdx + 1);
    if (SUPPORTED_COMPONENTS.includes(comp)) {
      return { bucket: 'component', componentName: comp, tokenKey: tok };
    }
  }

  // Seed token
  if (tokenName in SEED_TOKENS) {
    return { bucket: 'seed' };
  }

  // Map token
  if (tokenName in MAP_TOKENS) {
    return { bucket: 'map' };
  }

  // Alias token
  if (tokenName in ALIAS_TOKENS) {
    return { bucket: 'alias' };
  }

  // Try fuzzy matching for alternate names
  const fuzzy = fuzzyMatchV4Name(tokenName);
  if (fuzzy in SEED_TOKENS) return { bucket: 'seed' };
  if (fuzzy in MAP_TOKENS) return { bucket: 'map' };
  if (fuzzy in ALIAS_TOKENS) return { bucket: 'alias' };

  return null;
}

/**
 * Fuzzy match a v4-styled name to canonical.
 */
function fuzzyMatchV4Name(name) {
  const normalized = name
    .replace(/[-_]/g, '')
    .replace(/^@/, '')
    .toLowerCase();

  const allKnown = { ...SEED_TOKENS, ...MAP_TOKENS, ...ALIAS_TOKENS };
  for (const known of Object.keys(allKnown)) {
    if (known.replace(/[-_]/g, '').toLowerCase() === normalized) {
      return known;
    }
  }

  // Common Less variable patterns
  const v4Patterns = {
    'primarycolor':          'colorPrimary',
    'primary-color':         'colorPrimary',
    'successcolor':          'colorSuccess',
    'success-color':         'colorSuccess',
    'warningcolor':          'colorWarning',
    'warning-color':         'colorWarning',
    'errorcolor':            'colorError',
    'error-color':           'colorError',
    'infocolor':             'colorInfo',
    'info-color':            'colorInfo',
    'borderradiusbase':      'borderRadius',
    'border-radius-base':    'borderRadius',
    'fontsizebase':          'fontSize',
    'font-size-base':        'fontSize',
    'fontsize':              'fontSize',
    'fontfamily':            'fontFamily',
    'font-family':           'fontFamily',
    'lineheightbase':        'lineHeight',
    'line-height-base':      'lineHeight',
    'textcolor':             'colorText',
    'text-color':            'colorText',
    'bordercolor':           'colorBorder',
    'border-color-base':     'colorBorder',
    'bgcolor':               'colorBgContainer',
    'backgroundcolor':       'colorBgContainer',
    'background-color-base': 'colorBgLayout',
  };

  if (v4Patterns[normalized]) return v4Patterns[normalized];

  return null;
}

/**
 * Resolve component-level tokens from seed and map values.
 * For v4, also checks against V4_LESS_TO_V5 defaults for fallbacks.
 *
 * @param {string} componentName
 * @param {object} seedTokens
 * @param {object} mapTokens
 * @returns {object}
 */
function resolveComponentTokens(componentName, seedTokens, mapTokens) {
  const defaults = COMPONENT_TOKENS[componentName];
  if (!defaults) return {};

  const merged = { ...seedTokens, ...mapTokens };

  const componentTokens = {};

  for (const [key, defaultValue] of Object.entries(defaults)) {
    // Check merged token set
    if (key in merged) {
      componentTokens[key] = merged[key];
      continue;
    }

    // Check scoped variant
    const scopedKey = `${componentName}.${key}`;
    if (scopedKey in merged) {
      componentTokens[key] = merged[scopedKey];
      continue;
    }

    // v4 specific: check Less variable name format
    const lessKey = `@${key.replace(/[A-Z]/g, '-$&').toLowerCase()}`;
    if (lessKey in merged) {
      componentTokens[key] = merged[lessKey];
      continue;
    }

    if (V4_LESS_TO_V5[lessKey]) {
      const lessVal = V4_LESS_TO_V5[lessKey];
      if (!lessVal.includes('#') && !lessVal.includes('px') && lessVal in merged) {
        componentTokens[key] = merged[lessVal];
        continue;
      }
    }

    // Derivation from seed
    if (SEED_TO_COMPONENT_DERIVATION) {
      const derivation = findDerivationForKey(componentName, key);
      if (derivation && derivation.seed && derivation.seed in seedTokens) {
        componentTokens[key] = seedTokens[derivation.seed];
        continue;
      }
    }

    // Fallback to default
    componentTokens[key] = defaultValue;
  }

  return componentTokens;
}

function findDerivationForKey(componentName, tokenKey) {
  for (const [seedName, info] of Object.entries(SEED_TO_COMPONENT_DERIVATION)) {
    if (info.componentUses && info.componentUses[componentName]) {
      if (info.componentUses[componentName].includes(tokenKey)) {
        return { seed: seedName };
      }
    }
  }
  return null;
}

/**
 * Get default fallback tokens for a component.
 * For v4, converts v5 token names to v4 Less variable names as default values.
 *
 * @param {string} componentName
 * @returns {object}
 */
function getDefaultTokens(componentName) {
  const defaults = COMPONENT_TOKENS[componentName];
  if (!defaults) return {};

  const result = { ...defaults };

  // Inject v4 Less variable names as fallback values where applicable
  for (const [key, value] of Object.entries(result)) {
    const lessKey = `@${key.replace(/[A-Z]/g, '-$&').toLowerCase()}`;
    if (V4_LESS_TO_V5[lessKey] && typeof V4_LESS_TO_V5[lessKey] === 'string'
        && (V4_LESS_TO_V5[lessKey].includes('#') || V4_LESS_TO_V5[lessKey].includes('px'))) {
      // Use v4 Less default value
      result[key] = V4_LESS_TO_V5[lessKey];
    }
  }

  return result;
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