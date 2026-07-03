'use strict';

/**
 * Extractor — DOM walking for visible nodes, bounding rects, and attributes.
 * Runs in-page via page.evaluate().
 */

function getDomWalkerScript() {
  return `
    (() => {
      const nodes = [];
      const allElements = document.querySelectorAll('body *:not(script):not(style):not(head):not(link):not(meta):not(noscript):not(template)');
      
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        
        // Skip invisible / zero-dimension elements
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const tag = el.tagName.toLowerCase();
        
        // Skip HTML, body
        if (tag === 'html' || tag === 'body') continue;
        
        const classList = Array.from(el.classList);
        const attributes = {};
        for (const attr of el.attributes) {
          attributes[attr.name] = attr.value;
        }
        
        nodes.push({
          tag,
          classList,
          attributes,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          text: (el.textContent || '').trim().slice(0, 100),
          childCount: el.children.length,
        });
      }
      
      return nodes;
    })();
  `;
}

module.exports = { getDomWalkerScript };