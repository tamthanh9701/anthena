/**
 * Local Figma Engine — Simulates Figma's plugin API for testing.
 *
 * Provides a deterministic document model with:
 * - Source AntD kit with token nodes
 * - Clone document
 * - PluginData for version/structure tracking
 * - Paint properties (fills, strokes)
 *
 * All operations are synchronous and deterministic within the same process.
 * No network calls, no real Figma API.
 *
 * @typedef {object} FigmaNode
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {FigmaNode[]} [children]
 * @property {object} [pluginData]
 * @property {Array<{type: string, color?: {r:number,g:number,b:number}, opacity?: number}>} [fills]
 * @property {Array<{type: string, color?: {r:number,g:number,b:number}}>} [strokes]
 * @property {Array<{type: string, radius?: number}>} [effects]
 * @property {number} [cornerRadius]
 * @property {string} [tokenValue]
 */

'use strict';

// ─── Token Path Builder ──────────────────────────────────────────────────────

/**
 * Build a deterministic source kit with token nodes matching AntD 5 theme tokens.
 * @param {object} [opts]
 * @param {string} [opts.kitVersion='1.0.0']
 * @param {string} [opts.fileKey='antd-kit-source']
 * @returns {FigmaNode} - Source kit document root
 */
function buildSourceKit(opts = {}) {
  const kitVersion = opts.kitVersion || '1.0.0';
  const fileKey = opts.fileKey || 'antd-kit-source';

  return {
    id: fileKey,
    name: 'Ant Design 5 Kit',
    type: 'DOCUMENT',
    pluginData: { anthenaKitVersion: kitVersion, anthenaFileKey: fileKey },
    children: [
      buildTokenGroup('colors', [
        buildTokenNode('colorPrimary', '#1677ff', 'color', ['color', 'primary']),
        buildTokenNode('colorSuccess', '#52c41a', 'color', ['color', 'success']),
        buildTokenNode('colorWarning', '#faad14', 'color', ['color', 'warning']),
        buildTokenNode('colorError', '#ff4d4f', 'color', ['color', 'error']),
        buildTokenNode('colorInfo', '#1677ff', 'color', ['color', 'info']),
        buildTokenNode('colorBgBase', '#ffffff', 'color', ['color', 'bg-base']),
        buildTokenNode('colorTextBase', '#000000', 'color', ['color', 'text-base']),
        buildTokenNode('colorBorder', '#d9d9d9', 'color', ['color', 'border']),
        buildTokenNode('colorBgContainer', '#ffffff', 'color', ['color', 'bg-container']),
        buildTokenNode('colorBgElevated', '#ffffff', 'color', ['color', 'bg-elevated']),
        buildTokenNode('colorBgLayout', '#f5f5f5', 'color', ['color', 'bg-layout']),
        buildTokenNode('colorBgSpotlight', '#000000', 'color', ['color', 'bg-spotlight']),
        buildTokenNode('colorBgMask', 'rgba(0,0,0,0.45)', 'color', ['color', 'bg-mask']),
        buildTokenNode('colorText', '#000000e0', 'color', ['color', 'text']),
        buildTokenNode('colorTextSecondary', '#00000073', 'color', ['color', 'text-secondary']),
        buildTokenNode('colorTextTertiary', '#00000040', 'color', ['color', 'text-tertiary']),
        buildTokenNode('colorTextQuaternary', '#0000001a', 'color', ['color', 'text-quaternary']),
      ]),
      buildTokenGroup('border-radius', [
        buildTokenNode('borderRadius', '6px', 'dimension', ['border-radius', 'base']),
        buildTokenNode('borderRadiusLG', '8px', 'dimension', ['border-radius', 'lg']),
        buildTokenNode('borderRadiusSM', '4px', 'dimension', ['border-radius', 'sm']),
        buildTokenNode('borderRadiusXS', '2px', 'dimension', ['border-radius', 'xs']),
        buildTokenNode('borderRadiusOuter', '0px', 'dimension', ['border-radius', 'outer']),
      ]),
      buildTokenGroup('spacing', [
        buildTokenNode('marginXXS', '2px', 'dimension', ['spacing', 'xxs']),
        buildTokenNode('marginXS', '4px', 'dimension', ['spacing', 'xs']),
        buildTokenNode('marginSM', '8px', 'dimension', ['spacing', 'sm']),
        buildTokenNode('marginMD', '16px', 'dimension', ['spacing', 'md']),
        buildTokenNode('marginLG', '24px', 'dimension', ['spacing', 'lg']),
        buildTokenNode('marginXL', '32px', 'dimension', ['spacing', 'xl']),
        buildTokenNode('paddingXXS', '2px', 'dimension', ['spacing', 'padding-xxs']),
        buildTokenNode('paddingXS', '4px', 'dimension', ['spacing', 'padding-xs']),
        buildTokenNode('paddingSM', '8px', 'dimension', ['spacing', 'padding-sm']),
        buildTokenNode('paddingMD', '16px', 'dimension', ['spacing', 'padding-md']),
        buildTokenNode('paddingLG', '24px', 'dimension', ['spacing', 'padding-lg']),
        buildTokenNode('paddingXL', '32px', 'dimension', ['spacing', 'padding-xl']),
      ]),
      buildTokenGroup('font', [
        buildTokenNode('fontSizeSM', '12px', 'dimension', ['font', 'size-sm']),
        buildTokenNode('fontSizeMD', '14px', 'dimension', ['font', 'size-md']),
        buildTokenNode('fontSizeLG', '16px', 'dimension', ['font', 'size-lg']),
        buildTokenNode('fontSizeXL', '20px', 'dimension', ['font', 'size-xl']),
        buildTokenNode('fontFamily', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'string', ['font', 'family']),
        buildTokenNode('lineHeight', '1.5715', 'number', ['font', 'line-height']),
      ]),
      buildTokenGroup('shadow', [
        buildTokenNode('boxShadow', '0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)', 'string', ['shadow', 'sm']),
        buildTokenNode('boxShadowSecondary', '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)', 'string', ['shadow', 'md']),
        buildTokenNode('boxShadowTertiary', '0 9px 28px 8px rgba(0,0,0,0.05), 0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12)', 'string', ['shadow', 'lg']),
      ]),
    ],
  };
}

/**
 * Build a token group node.
 * @param {string} name
 * @param {FigmaNode[]} children
 * @returns {FigmaNode}
 */
function buildTokenGroup(name, children) {
  return {
    id: `group-${name}`,
    name,
    type: 'GROUP',
    children,
    pluginData: { groupType: 'token-category' },
  };
}

/**
 * Build a leaf token node with paint properties.
 * @param {string} tokenName
 * @param {string} value
 * @param {string} dataType
 * @param {string[]} pathParts
 * @returns {FigmaNode}
 */
function buildTokenNode(tokenName, value, dataType, pathParts) {
  const node = {
    id: `token-${tokenName}`,
    name: tokenName,
    type: 'TOKEN',
    children: [],
    tokenValue: value,
    pluginData: {
      tokenPath: tokenName,
      tokenType: dataType,
      tokenCategory: pathParts[0] || 'unknown',
      anthenaKitVersion: null,
      anthenaLastAppliedAt: null,
      anthenaAppliedValue: null,
      anthenaSource: 'antd-kit',
    },
  };

  // Add fill for color tokens
  if (dataType === 'color' && value.startsWith('#')) {
    const rgb = hexToRgb(value);
    node.fills = [{ type: 'SOLID', color: rgb, opacity: 1 }];
  }

  // Add cornerRadius for border-radius tokens
  if (dataType === 'dimension' && tokenName.toLowerCase().includes('radius')) {
    node.cornerRadius = parseFloat(value) || 0;
  }

  return node;
}

// ─── RGB Conversion ──────────────────────────────────────────────────────────

/**
 * @param {string} hex
 * @returns {{r:number, g:number, b:number}}
 */
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r, g, b };
}

// ─── Clone Document Operations ───────────────────────────────────────────────

/**
 * Simulate Figma API: find a node by ID.
 * @param {FigmaNode} root
 * @param {string} id
 * @returns {FigmaNode|null}
 */
function findNodeById(root, id) {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Walk all nodes and call a callback.
 * @param {FigmaNode} root
 * @param {(node: FigmaNode) => void} callback
 */
function walkAllNodes(root, callback) {
  callback(root);
  if (root.children) {
    for (const child of root.children) {
      walkAllNodes(child, callback);
    }
  }
}

// ─── Figma Simulator (for code.js to use outside Figma sandbox) ────────────

/**
 * Simulates the Figma API for local testing.
 * Provides root, sourceKitRoot, currentPage, and closePlugin().
 */
class FigmaSimulator {
  /** @param {{ sourceKit: FigmaNode }} [opts] */
  constructor(opts = {}) {
    this._root = opts.sourceKit || buildSourceKit();
    this._sourceKitRoot = opts.sourceKit || buildSourceKit();
    this._closed = false;
  }

  get root() { return this._root; }
  get sourceKitRoot() { return this._sourceKitRoot; }

  get currentPage() {
    return { parent: this._root };
  }

  /** Replace the document root (e.g., after clone creation). */
  setRoot(node) { this._root = node; }

  closePlugin() { this._closed = true; }
  get isClosed() { return this._closed; }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  buildSourceKit,
  buildTokenGroup,
  buildTokenNode,
  findNodeById,
  walkAllNodes,
  hexToRgb,
  FigmaSimulator,
};