'use strict';

/**
 * Computed CSS extraction script.
 * Extracts 12 required CSS properties from visible nodes.
 */

function getCssExtractorScript() {
  return `
    (() => {
      const REQUIRED_PROPS = [
        'backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight',
        'padding', 'margin', 'border', 'borderRadius', 'boxShadow',
        'width', 'height'
      ];
      
      const results = {};
      const allElements = document.querySelectorAll('body *:not(script):not(style):not(head):not(link):not(meta):not(noscript):not(template)');
      
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const css = {};
        let extractedCount = 0;
        
        for (const prop of REQUIRED_PROPS) {
          const value = style[prop];
          css[prop] = value || null;
          if (value) extractedCount++;
        }
        
        // Use a fingerprint: tag + class signature
        const tag = el.tagName.toLowerCase();
        const classes = Array.from(el.classList).sort().join('.');
        const key = tag + (classes ? '.' + classes : '');
        
        if (!results[key]) {
          results[key] = { css, extractedCount, totalProps: REQUIRED_PROPS.length, samples: 0 };
        }
        results[key].samples++;
      }
      
      return results;
    })();
  `;
}

function getComputedCssForElementsScript() {
  return `
    (() => {
      const REQUIRED_PROPS = [
        'backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight',
        'padding', 'margin', 'border', 'borderRadius', 'boxShadow',
        'width', 'height'
      ];
      
      const results = [];
      const allElements = document.querySelectorAll('body *:not(script):not(style):not(head):not(link):not(meta):not(noscript):not(template)');
      
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const css = {};
        let extractedCount = 0;
        
        for (const prop of REQUIRED_PROPS) {
          const value = style[prop];
          css[prop] = value || null;
          if (value) extractedCount++;
        }
        
        results.push({
          index: i,
          tag: el.tagName.toLowerCase(),
          classList: Array.from(el.classList),
          css,
          confidence: extractedCount / REQUIRED_PROPS.length,
        });
      }
      
      return results;
    })();
  `;
}

module.exports = { getCssExtractorScript, getComputedCssForElementsScript };