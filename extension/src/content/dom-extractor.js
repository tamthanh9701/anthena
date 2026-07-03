// ─── DOM Extractor ──────────────────────────────────────────────────────
// Extracts structural DOM evidence from the current page.
// Runs in content script context (isolated world).

/**
 * Extract DOM nodes with bounding rects from the current page
 * @param {number} [maxNodes=200] - Limit number of nodes to avoid oversized payload
 * @returns {Array<{tagName: string, id?: string, className?: string, antdClass?: string, boundingRect: {top: number, left: number, width: number, height: number}, computedStyles: Record<string, string>, textContent?: string, childCount: number, selector: string}>}
 */
export function extractDomNodes(maxNodes = 200) {
  const nodes = [];
  const candidates = document.querySelectorAll(
    'div, section, button, input, select, a, span, img, ul, li, table, tr, td, th, form, label, header, footer, nav, aside, main, article'
  );

  for (let i = 0; i < Math.min(candidates.length, maxNodes); i++) {
    const el = candidates[i];
    const rect = el.getBoundingClientRect();

    // Skip invisible/zero-size elements
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.top > window.innerHeight || rect.bottom < 0) continue; // visible viewport only for P0-B

    const node = {
      tagName: el.tagName.toLowerCase(),
      boundingRect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      childCount: el.children.length,
      selector: getMinimalSelector(el),
    };

    if (el.id) node.id = el.id;
    if (el.className && typeof el.className === 'string') {
      node.className = el.className.trim().substring(0, 200);
    }

    // Detect Ant Design class signatures
    const antdClass = detectAntdClass(el);
    if (antdClass) node.antdClass = antdClass;

    // Sample text content (truncated)
    const text = el.textContent?.trim();
    if (text && text.length > 0 && text.length < 100) {
      node.textContent = text.substring(0, 80);
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * Get a minimal but unique CSS selector for an element
 * @param {Element} el
 * @returns {string}
 */
function getMinimalSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  let path = [];
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => !c.startsWith('ant-')).slice(0, 2);
      if (classes.length) selector += '.' + classes.map(c => CSS.escape(c)).join('.');
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ').substring(0, 200);
}

/**
 * Detect Ant Design class patterns on an element
 * @param {Element} el
 * @returns {string|null}
 */
function detectAntdClass(el) {
  const className = el.className;
  if (typeof className !== 'string') return null;

  // Ant Design classes follow pattern: ant-{component}-{variant}
  const antdMatch = className.match(/\bant-([a-z]+(?:-[a-z]+)*)\b/);
  if (!antdMatch) return null;

  // Map to standard Ant Design component names
  const antdMap = {
    'btn': 'Button',
    'input': 'Input',
    'select': 'Select',
    'table': 'Table',
    'form': 'Form',
    'modal': 'Modal',
    'dropdown': 'Dropdown',
    'menu': 'Menu',
    'card': 'Card',
    'tabs': 'Tabs',
    'tag': 'Tag',
    'badge': 'Badge',
    'alert': 'Alert',
    'spin': 'Spin',
    'pagination': 'Pagination',
    'breadcrumb': 'Breadcrumb',
    'checkbox': 'Checkbox',
    'radio': 'Radio',
    'switch': 'Switch',
    'slider': 'Slider',
    'upload': 'Upload',
    'progress': 'Progress',
    'tooltip': 'Tooltip',
    'popover': 'Popover',
    'drawer': 'Drawer',
    'message': 'Message',
    'notification': 'Notification',
    'avatar': 'Avatar',
    'space': 'Space',
    'layout': 'Layout',
    'header': 'Layout.Header',
    'footer': 'Layout.Footer',
    'sider': 'Layout.Sider',
    'content': 'Layout.Content',
    'row': 'Row',
    'col': 'Col',
    'divider': 'Divider',
    'empty': 'Empty',
    'result': 'Result',
    'descriptions': 'Descriptions',
    'list': 'List',
    'timeline': 'Timeline',
    'collapse': 'Collapse',
    'carousel': 'Carousel',
    'rate': 'Rate',
    'steps': 'Steps',
    'anchor': 'Anchor',
    'affix': 'Affix',
    'back-top': 'BackTop',
    'config-provider': 'ConfigProvider',
    'datepicker': 'DatePicker',
    'timepicker': 'TimePicker',
    'cascader': 'Cascader',
    'tree': 'Tree',
    'tree-select': 'TreeSelect',
    'transfer': 'Transfer',
    'auto-complete': 'AutoComplete',
    'mentions': 'Mentions',
  };

  const antPrefix = antdMatch[1];
  const baseName = antPrefix.split('-')[0];

  if (antdMap[baseName]) return antdMap[baseName];
  if (antdMap[antPrefix]) return antdMap[antPrefix];

  return `ant-${antPrefix}`;
}
