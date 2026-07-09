/**
 * Computed CSS Extractor V2
 * Extracts 55+ computed style properties per node.
 * Expands signal coverage: colors, typography, spacing, borders, shadows,
 * sizing, layout, grid, effects, overflow, cursor.
 *
 * @typedef {import('../shared/schema.js').ComputedStyleEntry} ComputedStyleEntry
 * @typedef {import('../shared/schema.js').DomNode} DomNode
 */

/** 55+ design-relevant computed style properties */
export const STYLE_PROPS_V2 = [
  // Colors
  'color', 'background-color', 'background', 'border-color',
  // Typography
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
  'letter-spacing', 'text-transform', 'text-decoration',
  // Spacing
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'gap',
  // Borders & Radius
  'border-width', 'border-style', 'border-radius', 'outline-width', 'outline-style', 'outline-color',
  // Shadows
  'box-shadow',
  // Sizing
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // Layout
  'display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content',
  'position', 'top', 'left', 'right', 'bottom',
  // Effects
  'opacity', 'transform', 'transition', 'animation',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-gap',
  // Overflow
  'overflow', 'overflow-x', 'overflow-y',
  // Cursor
  'cursor', 'pointer-events',
];

/**
 * Extract computed CSS for a list of DOM nodes.
 * @param {DomNode[]} domNodes
 * @returns {ComputedStyleEntry[]}
 */
export function extractComputedStyles(domNodes) {
  const results = /** @type {ComputedStyleEntry[]} */ ([]);

  for (const node of domNodes) {
    try {
      const el = findElementBySelector(node.selector);
      if (!el) continue;

      const computed = window.getComputedStyle(el);
      const styles = /** @type {Record<string, string>} */ ({});

      for (const prop of STYLE_PROPS_V2) {
        const value = computed.getPropertyValue(prop);
        if (value && value !== 'none' && value !== 'normal' && value !== '' && value !== '0px') {
          styles[prop] = value;
        }
      }

      if (Object.keys(styles).length > 0) {
        results.push({ selector: node.selector, styles });
      }
    } catch (_) {
      // Skip if selector fails
    }
  }

  return results;
}

/**
 * Find an element by CSS selector.
 * @param {string} selector
 * @returns {Element|null}
 */
function findElementBySelector(selector) {
  try {
    return document.querySelector(selector);
  } catch (_) {
    return null;
  }
}