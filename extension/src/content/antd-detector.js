// ─── Ant Design Detector ────────────────────────────────────────────────
// Detects Ant Design components by class signatures and DOM patterns.

/**
 * Detect Ant Design components on the page
 * @returns {Array<{component: string, selector: string, count: number, sampleRect: {top: number, left: number, width: number, height: number}}>}
 */
export function detectAntdComponents() {
  const componentMap = new Map();

  // Ant Design class pattern: ant-{component}
  const antdClassRegex = /\bant-([a-z]+(?:-[a-z]+)*)\b/;

  const allElements = document.querySelectorAll('[class*="ant-"]');
  allElements.forEach(el => {
    const className = el.className;
    if (typeof className !== 'string') return;

    const match = className.match(antdClassRegex);
    if (!match) return;

    const antPrefix = match[1];
    const baseComponent = antPrefix.split('-')[0];

    if (!componentMap.has(baseComponent)) {
      const rect = el.getBoundingClientRect();
      componentMap.set(baseComponent, {
        component: baseComponent,
        selector: getAntdSelector(el, baseComponent),
        count: 0,
        sampleRect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }

    componentMap.get(baseComponent).count++;
  });

  return Array.from(componentMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * @param {Element} el
 * @param {string} component
 * @returns {string}
 */
function getAntdSelector(el, component) {
  const tag = el.tagName.toLowerCase();
  const cls = `ant-${component}`;
  return `${tag}.${CSS.escape(cls)}`;
}