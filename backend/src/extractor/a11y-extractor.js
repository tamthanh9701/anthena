'use strict';

/**
 * Accessibility tree extractor.
 */

function getA11yExtractorScript() {
  return `
    (() => {
      const results = [];
      const allElements = document.querySelectorAll('body *:not(script):not(style):not(head):not(link):not(meta)');
      
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const role = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledby = el.getAttribute('aria-labelledby');
        const ariaDescribedby = el.getAttribute('aria-describedby');
        const ariaExpanded = el.getAttribute('aria-expanded');
        const ariaSelected = el.getAttribute('aria-selected');
        const ariaChecked = el.getAttribute('aria-checked');
        const ariaHidden = el.getAttribute('aria-hidden') === 'true';
        const tabIndex = el.getAttribute('tabindex');
        
        const hasAria = !!(role || ariaLabel || ariaLabelledby || ariaDescribedby || 
          ariaExpanded || ariaSelected || ariaChecked);
        
        results.push({
          index: results.length,
          tag: el.tagName.toLowerCase(),
          role: role || null,
          'aria-label': ariaLabel || null,
          'aria-labelledby': ariaLabelledby || null,
          'aria-describedby': ariaDescribedby || null,
          'aria-expanded': ariaExpanded || null,
          'aria-selected': ariaSelected || null,
          'aria-checked': ariaChecked || null,
          'aria-hidden': ariaHidden || null,
          tabIndex: tabIndex || null,
          hasAria,
          confidence: hasAria ? 0.6 : 0.3,
        });
      }
      
      return results;
    })();
  `;
}

module.exports = { getA11yExtractorScript };