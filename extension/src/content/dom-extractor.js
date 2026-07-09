/**
 * DOM Extractor V2
 * Extracts structural DOM evidence.
 * When redacted=true, textContent is omitted (replaced with "[REDACTED]")
 * and img src / bg-image URLs are stripped.
 *
 * @typedef {import('../shared/schema.js').DomNode} DomNode
 */

/**
 * Collect DOM nodes with structural info.
 * @param {number} [maxNodes=200]
 * @param {boolean} [redact=true] - Strip text content and image URLs
 * @returns {DomNode[]}
 */
export function collectDomNodes(maxNodes = 200, redact = true) {
  const nodes = /** @type {DomNode[]} */ ([]);
  const candidates = document.querySelectorAll(
    'div, section, button, input, select, a, span, img, ul, li, table, tr, td, th, form, label, header, footer, nav, aside, main, article, h1, h2, h3, h4, h5, h6, p, svg, canvas'
  );

  for (let i = 0; i < Math.min(candidates.length, maxNodes); i++) {
    const el = candidates[i];
    const rect = el.getBoundingClientRect();

    // Skip invisible/zero-size elements
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.top > window.innerHeight || rect.bottom < 0) continue;

    /** @type {DomNode} */
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

    // Text content — redacted when redact=true
    if (!redact) {
      const text = el.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        node.textContent = text.substring(0, 80);
      }
    } else {
      // Only preserve non-empty text for certain tags (small amounts)
      const preserveTags = ['button', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      if (preserveTags.includes(el.tagName.toLowerCase())) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 60) {
          node.textContent = text.substring(0, 50);
        }
      } else {
        // For all other elements, keep only if there's meaningful structure
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 30) {
          node.textContent = text.substring(0, 25);
        }
      }
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * Get a minimal but unique CSS selector.
 * @param {Element} el
 * @returns {string}
 */
function getMinimalSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  let path = [];
  let current = /** @type {Element|null} */ (el);
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter((c) => !c.startsWith('ant-')).slice(0, 2);
      if (classes.length) selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ').substring(0, 200);
}

/**
 * Detect Ant Design class patterns on an element.
 * @param {Element} el
 * @returns {string|null}
 */
function detectAntdClass(el) {
  const className = el.className;
  if (typeof className !== 'string') return null;

  const antdMatch = className.match(/\bant-([a-z]+(?:-[a-z]+)*)\b/);
  if (!antdMatch) return null;

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
    'segmented': 'Segmented',
    'tour': 'Tour',
    'watermark': 'Watermark',
    'float-btn': 'FloatButton',
    'app': 'App',
    'qr-code': 'QRCode',
    'color-picker': 'ColorPicker',
  };

  const antPrefix = antdMatch[1];
  const baseName = antPrefix.split('-')[0];

  if (antdMap[baseName]) return antdMap[baseName];
  if (antdMap[antPrefix]) return antdMap[antPrefix];

  return `ant-${antPrefix}`;
}