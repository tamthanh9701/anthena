'use strict';

/**
 * Ant Design class matcher.
 * Matches detected nodes against known Ant Design v5 CSS class prefixes.
 */

// Known Ant Design v5 class prefixes
const ANT_PREFIXES = [
  'ant-btn', 'ant-input', 'ant-select', 'ant-table', 'ant-form',
  'ant-modal', 'ant-drawer', 'ant-menu', 'ant-tabs', 'ant-card',
  'ant-layout', 'ant-breadcrumb', 'ant-pagination', 'ant-steps',
  'ant-collapse', 'ant-timeline', 'ant-tree', 'ant-upload',
  'ant-progress', 'ant-tag', 'ant-badge', 'ant-alert', 'ant-spin',
  'ant-rate', 'ant-radio', 'ant-checkbox', 'ant-switch', 'ant-slider',
  'ant-input-number', 'ant-datepicker', 'ant-timepicker',
  'ant-dropdown', 'ant-popover', 'ant-tooltip', 'ant-message',
  'ant-notification', 'ant-result', 'ant-empty', 'ant-skeleton',
  'ant-descriptions', 'ant-list', 'ant-avatar', 'ant-space',
  'ant-divider', 'ant-typography', 'ant-affix', 'ant-anchor',
  'ant-cascader', 'ant-transfer', 'ant-mentions', 'ant-auto-complete',
  'ant-calendar', 'ant-carousel', 'ant-comment', 'ant-config-provider',
  'ant-back-top', 'ant-row', 'ant-col', 'ant-popconfirm',
  'ant-image', 'ant-page-header', 'ant-statistic',
];

/**
 * Get all AntD class matches from a classList.
 * Returns { matchedPrefixes, confidence, classificationType }
 */
function matchAntdClasses(classList = []) {
  const matched = [];
  
  for (const cls of classList) {
    for (const prefix of ANT_PREFIXES) {
      if (cls === prefix || cls.startsWith(prefix + '-') || cls.startsWith(prefix + '__')) {
        matched.push({ class: cls, prefix });
        break;
      }
    }
  }
  
  if (matched.length === 0) {
    return { matched: [], confidence: 0, classificationType: 'custom' };
  }
  
  // Confidence based on match specificity
  // More specific matches (ant-btn-primary > ant-btn) = higher confidence
  const confidence = Math.min(1.0, 0.5 + (matched.length * 0.15));
  
  return {
    matched,
    confidence,
    classificationType: 'antd',
  };
}

/**
 * Get all AntD prefixes for reference.
 */
function getAntdPrefixes() {
  return [...ANT_PREFIXES];
}

module.exports = { matchAntdClasses, getAntdPrefixes };