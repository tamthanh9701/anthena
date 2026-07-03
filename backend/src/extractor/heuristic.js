'use strict';

/**
 * Heuristic fallback classification.
 * Used when DOM+CSS and AntD class signals are insufficient.
 */

function heuristicClassify(node) {
  const tag = (node.domTag || node.tag || '').toLowerCase();
  const styleStr = JSON.stringify(node.computedStyles || node.css || {});
  const text = (node.text || '').toLowerCase();
  const classList = node.classList || [];
  
  const evidence = [];
  let bestGuess = 'unknown';
  let confidence = 0.25;
  
  // Button-like heuristics
  if (tag === 'button' || tag === 'a' || (tag === 'div' && classList.some(c => c.includes('btn')))) {
    bestGuess = 'button';
    confidence = 0.45;
    evidence.push('dom-tag-button');
  }
  
  // Input-like heuristics
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    bestGuess = 'input';
    confidence = 0.40;
    evidence.push('dom-tag-form-control');
  }
  
  // Heading-like heuristics
  if (/h[1-6]/.test(tag)) {
    bestGuess = 'heading';
    confidence = 0.40;
    evidence.push('dom-tag-heading');
  }
  
  // Navigation-like heuristics
  if (tag === 'nav' || classList.some(c => c.includes('nav') || c.includes('menu'))) {
    bestGuess = 'navigation';
    confidence = 0.38;
    evidence.push('dom-tag-nav');
  }
  
  // Table-like heuristics
  if (tag === 'table' || tag === 'tr' || tag === 'td' || tag === 'th') {
    bestGuess = 'table-cell';
    confidence = 0.35;
    evidence.push('dom-tag-table');
  }
  
  // Image-like heuristics
  if (tag === 'img' || tag === 'svg') {
    bestGuess = 'image';
    confidence = 0.40;
    evidence.push('dom-tag-img');
  }
  
  // Text-like heuristics
  if ((tag === 'span' || tag === 'p' || tag === 'div') && text.length > 20 && !bestGuess || bestGuess === 'unknown') {
    bestGuess = 'text-block';
    confidence = 0.30;
    evidence.push('text-content-length');
  }
  
  // Size-based proximity
  // (Simplified — in production more spatial analysis would be needed)
  
  // Apply the heuristic classification
  const classification = {
    type: 'unknown',
    source: 'heuristic',
    confidence,
    evidence,
  };
  
  // Map heuristic guess to classification type
  if (['button', 'input', 'navigation'].includes(bestGuess)) {
    classification.type = 'custom';
  }
  
  const identity = {
    name: bestGuess,
    source: 'heuristic',
    confidence: confidence * 0.8,
    evidence: evidence.map(e => `heuristic-${e}`),
  };
  
  return {
    identity,
    classification,
    confidence,
    source: 'heuristic',
  };
}

module.exports = { heuristicClassify };