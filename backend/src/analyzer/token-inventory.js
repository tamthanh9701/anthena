'use strict';

const { getDb } = require('../db');
const { logger } = require('../utils/logger');

/**
 * Token inventory: aggregates all detected design token values across a run.
 */
function buildTokenInventory(runId) {
  const db = getDb();
  const log = logger.child({ module: 'analyzer', runId });
  
  // Get all nodes from this run
  const nodes = db.prepare(`
    SELECT n.* FROM nodes n
    JOIN snapshots s ON n.snapshotId = s.id
    WHERE s.runId = ?
  `).all(runId);
  
  // Aggregate tokens by CSS property value
  const tokens = {};
  const antdDefaultTokens = getAntdDefaultTokens();
  
  for (const node of nodes) {
    const styles = safeParse(node.computedStyles || '{}');
    const classList = safeParse(node.classList || '[]');
    const classification = safeParse(node.classification || '{}');
    
    // Extract token-like patterns from computed styles
    const tokenCandidates = [
      { key: styles.backgroundColor, type: 'color', name: 'backgroundColor' },
      { key: styles.color, type: 'color', name: 'color' },
      { key: styles.fontSize, type: 'typography', name: 'fontSize' },
      { key: styles.fontFamily, type: 'typography', name: 'fontFamily' },
      { key: styles.lineHeight, type: 'typography', name: 'lineHeight' },
      { key: styles.borderRadius, type: 'border', name: 'borderRadius' },
      { key: styles.padding, type: 'spacing', name: 'padding' },
      { key: styles.margin, type: 'spacing', name: 'margin' },
    ];
    
    for (const candidate of tokenCandidates) {
      if (!candidate.key || candidate.key === 'none' || candidate.key === '0px') continue;
      
      const tokenName = `${candidate.type}-${candidate.name}`;
      if (!tokens[tokenName]) {
        tokens[tokenName] = {
          value: candidate.key,
          type: candidate.type,
          source: isAntdTokenMatch(candidate.key, antdDefaultTokens, candidate.name) ? 'antd-default' : 'computed',
          usageCount: 0,
          screens: [],
          confidence: 1,
        };
      }
      
      tokens[tokenName].usageCount++;
      
      // Track screen
      const snap = db.prepare("SELECT url, role FROM snapshots WHERE id = ?").get(node.snapshotId);
      if (snap && !tokens[tokenName].screens.some(s => s === snap.url)) {
        tokens[tokenName].screens.push(snap.url);
      }
    }
  }
  
  // Count AntD coverage
  let detectedTokens = Object.keys(tokens).length;
  const antdCoverage = {
    totalAntdTokens: Object.keys(antdDefaultTokens).length,
    detectedTokens,
    coveragePercent: Object.keys(antdDefaultTokens).length > 0 
      ? Math.round((detectedTokens / Object.keys(antdDefaultTokens).length) * 1000) / 10 
      : 0,
  };
  
  log.info({ totalTokens: detectedTokens }, 'Token inventory built');
  
  return {
    runId,
    generatedAt: new Date().toISOString(),
    totalTokens: detectedTokens,
    tokens,
    antdCoverage,
  };
}

function getAntdDefaultTokens() {
  // Common Ant Design v5 default token values
  return {
    'colorPrimary': '#1677ff',
    'colorSuccess': '#52c41a',
    'colorWarning': '#faad14',
    'colorError': '#ff4d4f',
    'colorInfo': '#1677ff',
    'colorText': '#000000d9',
    'colorTextSecondary': '#00000073',
    'colorBgContainer': '#ffffff',
    'colorBgLayout': '#f5f5f5',
    'colorBorder': '#d9d9d9',
    'borderRadius': '6px',
    'borderRadiusLG': '8px',
    'fontSize': '14px',
    'fontSizeHeading1': '38px',
    'fontSizeHeading2': '30px',
    'fontSizeHeading3': '24px',
    'fontSizeHeading4': '20px',
    'fontSizeHeading5': '16px',
    'fontFamily': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'lineHeight': '1.5715',
    'padding': '12px',
    'paddingLG': '16px',
    'paddingSM': '8px',
    'margin': '16px',
    'marginLG': '24px',
    'marginSM': '8px',
    'controlHeight': '32px',
    'controlHeightLG': '40px',
    'controlHeightSM': '24px',
  };
}

function isAntdTokenMatch(value, antdDefaults, propName) {
  // Simple heuristic: if the value is a color/pixel value that matches common patterns
  if (!value) return false;
  const normalized = value.toString().toLowerCase();
  
  for (const [name, def] of Object.entries(antdDefaults)) {
    if (normalized === def.toLowerCase()) return true;
  }
  
  return false;
}

function safeParse(str) {
  if (!str || str === 'null' || str === 'undefined') return {};
  try { return JSON.parse(str); } catch { return {}; }
}

module.exports = { buildTokenInventory };