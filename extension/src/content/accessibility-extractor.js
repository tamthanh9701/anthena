// ─── Accessibility Extractor ────────────────────────────────────────────
// Extracts ARIA roles, labels, and accessibility tree info.

/**
 * Extract accessibility info from the page
 * @returns {Array<{role: string, label: string, selector: string, focused: boolean}>}
 */
export function extractAccessibility() {
  const results = [];
  const elements = document.querySelectorAll('[role], [aria-label], [aria-labelledby], [aria-describedby]');

  elements.forEach(el => {
    const role = el.getAttribute('role') || 'generic';
    const label = el.getAttribute('aria-label') || '';
    const labelledby = el.getAttribute('aria-labelledby');
    let labelText = label;

    if (!labelText && labelledby) {
      const labelEl = document.getElementById(labelledby);
      if (labelEl) labelText = labelEl.textContent?.trim() || '';
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    results.push({
      role,
      label: labelText.substring(0, 100),
      selector: getAccessibleSelector(el),
      focused: el === document.activeElement,
    });
  });

  return results;
}

/**
 * @param {Element} el
 * @returns {string}
 */
function getAccessibleSelector(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `#${CSS.escape(el.id)}`;
  const role = el.getAttribute('role');
  const label = el.getAttribute('aria-label');
  if (role && label) return `${tag}[role="${role}"][aria-label="${CSS.escape(label)}"]`;
  if (role) return `${tag}[role="${role}"]`;
  return tag;
}