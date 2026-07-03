// ─── Computed CSS Extractor ─────────────────────────────────────────────
// Extracts computed styles for visible DOM nodes.
// Focus on design-system-relevant properties: colors, fonts, spacing, borders.

const STYLE_PROPERTIES = [
  'color',
  'background-color',
  'background',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'border-color',
  'border-width',
  'border-radius',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'box-shadow',
  'opacity',
  'display',
  'width',
  'height',
  'min-height',
  'min-width',
];

/**
 * Extract computed CSS for a list of node selectors
 * @param {Array<{selector: string}>} nodes
 * @returns {Array<{selector: string, styles: Record<string, string>}>}
 */
export function extractComputedStyles(nodes) {
  const results = [];

  for (const node of nodes) {
    try {
      const el = findElementBySelector(node.selector);
      if (!el) continue;

      const computed = window.getComputedStyle(el);
      const styles = {};

      for (const prop of STYLE_PROPERTIES) {
        const value = computed.getPropertyValue(prop);
        if (value && value !== 'none' && value !== 'normal') {
          styles[prop] = value;
        }
      }

      results.push({ selector: node.selector, styles });
    } catch {
      // Skip if selector fails
    }
  }

  return results;
}

/**
 * Find an element by a minimal CSS selector
 * @param {string} selector
 * @returns {Element|null}
 */
function findElementBySelector(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}