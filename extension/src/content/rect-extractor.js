// ─── Rect Extractor ────────────────────────────────────────────────────
// Extracts bounding rects for visual layout analysis.

/**
 * Extract positional rect data for all candidate elements
 * @param {number} [maxNodes=200]
 * @returns {Array<{tagName: string, rect: {top: number, left: number, width: number, height: number}, selector: string}>}
 */
export function extractRects(maxNodes = 200) {
  const results = [];
  const elements = document.querySelectorAll(
    'div, section, button, input, select, a, span, img, ul, li, table, tr, td, th'
  );

  for (let i = 0; i < Math.min(elements.length, maxNodes); i++) {
    const el = elements[i];
    const rect = el.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.top > window.innerHeight || rect.bottom < 0) continue;

    results.push({
      tagName: el.tagName.toLowerCase(),
      rect: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selector: getShortSelector(el),
    });
  }

  return results;
}

/**
 * @param {Element} el
 * @returns {string}
 */
function getShortSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  let tag = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    const cls = el.className.trim().split(/\s+/)[0];
    if (cls) tag += `.${CSS.escape(cls)}`;
  }
  return tag;
}