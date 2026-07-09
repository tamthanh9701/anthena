/**
 * AntD v5 Adapter — Theme Token Model (seed → map → alias → component)
 *
 * AntD v5 uses CSS-in-JS token system via ConfigProvider theme.tokens.
 * This adapter maps raw captured tokens into the canonical seed→map→alias
 * hierarchy, resolves component-level tokens, and provides defaults.
 */

'use strict';

const {
  SEED_TOKENS,
  MAP_TOKENS,
  ALIAS_TOKENS,
  COMPONENT_TOKENS,
  SUPPORTED_COMPONENTS,
  CLASS_TO_COMPONENT,
  SEED_TO_COMPONENT_DERIVATION,
} = require('./mapping-data');

const VERSION = '5';
const ADAPTER_NAME = 'Ant Design v5 (CSS-in-JS Token Model)';

/**
 * Categorize a raw flat token set into seed / map / alias / component buckets.
 *
 * Seed: brand-defining inputs (colorPrimary, borderRadius, etc.)
 * Map:  palette derived from seed (colorPrimaryBg, colorPrimaryHover, etc.)
 * Alias: high-level semantic tokens (controlHeight, motionDuration, etc.)
 * Component: component-scoped tokens (Button.colorPrimary, Table.headerBg, etc.)
 *
 * @param {Record<string,string>} rawTokens  - flat { tokenName: value }
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

  const entries = Object.entries(rawTokens);

  // Classify each raw token
  for (const [name, value] of entries) {
    const resolvedValue = typeof value === 'object' && value !== null
      ? (value.value || value.tokenValue || value.computed || String(value))
      : String(value);

    // Component tokens: contains known component name as prefix
    const componentMatch = matchComponentToken(name);
    if (componentMatch) {
      if (!components[componentMatch.component]) {
        components[componentMatch.component] = {};
      }
      components[componentMatch.component][componentMatch.token] = resolvedValue;
      continue;
    }

    // Seed tokens: brand-defining
    if (name in SEED_TOKENS) {
      seed[name] = resolvedValue;
      continue;
    }

    // Map tokens: palette level
    if (name in MAP_TOKENS) {
      map[name] = resolvedValue;
      continue;
    }

    // Alias tokens: semantic level
    if (name in ALIAS_TOKENS) {
      alias[name] = resolvedValue;
      continue;
    }

    // Unknown — try fuzzy matching to see if it's a known token with non-canonical name
    const fuzzy = fuzzyMatchTokenName(name);
    if (fuzzy) {
      // Route to correct bucket
      if (fuzzy in SEED_TOKENS) seed[fuzzy] = resolvedValue;
      else if (fuzzy in MAP_TOKENS) map[fuzzy] = resolvedValue;
      else if (fuzzy in ALIAS_TOKENS) alias[fuzzy] = resolvedValue;
      else {
        // Put in alias as fallback
        alias[fuzzy] = resolvedValue;
      }
    } else {
      // Fallback to alias for unknown tokens
      alias[name] = resolvedValue;
    }
  }

  return { seed, map, alias, components };
}

/**
 * Parse a token name to see if it contains a known component prefix.
 * e.g. "Button.colorPrimary" → { component: "Button", token: "colorPrimary" }
 *      "InputActiveBorderColor"  → { component: "Input", token: "activeBorderColor" }
 *
 * @param {string} tokenName
 * @returns {{ component: string, token: string }|null}
 */
function matchComponentToken(tokenName) {
  // Pattern 1: "Component.tokenName" (canonical format)
  const dotIdx = tokenName.indexOf('.');
  if (dotIdx > 0) {
    const comp = tokenName.slice(0, dotIdx);
    const tok = tokenName.slice(dotIdx + 1);
    if (SUPPORTED_COMPONENTS.includes(comp)) {
      return { component: comp, token: tok };
    }
  }

  // Pattern 2: Some prefixed form like "Button[colorPrimary]" or "buttonColorPrimary"
  for (const comp of SUPPORTED_COMPONENTS) {
    const lowerName = tokenName.toLowerCase();
    const lowerComp = comp.toLowerCase();

    // "buttonColorPrimary" → colorPrimary
    if (lowerName.startsWith(lowerComp)) {
      const rest = tokenName.slice(comp.length);
      // Try to match known component token
      const knownTokens = COMPONENT_TOKENS[comp];
      if (knownTokens) {
        // Try exact rest match first
        if (rest in knownTokens) {
          return { component: comp, token: rest };
        }
        // Then lowercase comparison
        for (const knownKey of Object.keys(knownTokens)) {
          if (rest.toLowerCase() === knownKey.toLowerCase()) {
            return { component: comp, token: knownKey };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Fuzzy match a non-canonical token name to a known token name.
 * Handles: kebab-case, different camelCase styles.
 *
 * @param {string} name
 * @returns {string|null} - matched canonical name or null
 */
function fuzzyMatchTokenName(name) {
  const allKnown = { ...SEED_TOKENS, ...MAP_TOKENS, ...ALIAS_TOKENS };
  const normalized = name
    .replace(/[-_]/g, '')
    .toLowerCase();

  // Direct match (different case)
  for (const known of Object.keys(allKnown)) {
    if (known.toLowerCase() === normalized) {
      return known;
    }
  }

  // Handle common aliases
  const aliases = {
    'primaryColor':       'colorPrimary',
    'primarycolor':       'colorPrimary',
    'successColor':       'colorSuccess',
    'warningColor':       'colorWarning',
    'errorColor':         'colorError',
    'infoColor':          'colorInfo',
    'borderRadiusBase':   'borderRadius',
    'fontSizeBase':       'fontSize',
    'fontFamilyBase':     'fontFamily',
    'lineHeightBase':     'lineHeight',
    'controlHeightBase':  'controlHeight',
    'componentBackground': 'colorBgContainer',
    'mainBackground':     'colorBgContainer',
    'textColor':          'colorText',
    'borderColor':        'colorBorder',
  };

  if (aliases[normalized]) return aliases[normalized];
  if (aliases[name]) return aliases[name];

  return null;
}

/**
 * Resolve component-level tokens from seed and map token values.
 * Uses the SEED_TO_COMPONENT_DERIVATION mapping to trace which component
 * tokens derive from which seed tokens.
 *
 * @param {string} componentName - e.g. 'Button', 'Table'
 * @param {object} seedTokens - resolved seed tokens
 * @param {object} mapTokens - resolved map tokens
 * @returns {object} - resolved component token values
 */
function resolveComponentTokens(componentName, seedTokens, mapTokens) {
  const defaults = COMPONENT_TOKENS[componentName];
  if (!defaults) return {};

  const merged = { ...seedTokens, ...mapTokens };

  const componentTokens = {};

  for (const [key, defaultValue] of Object.entries(defaults)) {
    // Check if this exact key exists in the merged token set
    if (key in merged) {
      componentTokens[key] = merged[key];
      continue;
    }

    // Check if a component-scoped variant exists: "ComponentName.key" or "componentNameKey"
    const scopedKey = `${componentName}.${key}`;
    if (scopedKey in merged) {
      componentTokens[key] = merged[scopedKey];
      continue;
    }

    // Derive from seed→component mapping if we have it
    if (SEED_TO_COMPONENT_DERIVATION) {
      const derivation = findDerivationForKey(componentName, key);
      if (derivation && derivation.seed && derivation.seed in seedTokens) {
        componentTokens[key] = seedTokens[derivation.seed];
        continue;
      }
    }

    // Fall back to the default value
    componentTokens[key] = defaultValue;
  }

  return componentTokens;
}

/**
 * Look up which seed token derives a given component token.
 * Returns null if no derivation found.
 */
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
 *
 * @param {string} componentName
 * @returns {object}
 */
function getDefaultTokens(componentName) {
  const defaults = COMPONENT_TOKENS[componentName];
  if (!defaults) return {};

  // Return a shallow copy to avoid mutation
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