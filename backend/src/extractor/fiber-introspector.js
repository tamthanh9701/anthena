'use strict';

/**
 * React Fiber introspection script (best-effort).
 * Attempts to read React component names from the Fiber tree.
 */

function getFiberIntrospectionScript() {
  return `
    (() => {
      const results = [];
      
      // Find the root fiber by looking for the React internal property
      const rootEl = document.getElementById('root') || document.querySelector('#__next') || document.querySelector('#app') || document.body;
      
      const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      
      if (!fiberKey) {
        return { available: false, nodes: [], disclaimer: 'React Fiber not detected or not accessible' };
      }
      
      let fiber = rootEl[fiberKey];
      
      function walkFiber(node, depth, maxDepth) {
        if (!node || depth > maxDepth) return null;
        
        const result = { displayName: null, ownerPath: [], memoizedProps: null, tag: null };
        
        // Get display name
        if (node.type) {
          result.displayName = node.type.displayName || node.type.name || null;
        } else if (node.elementType && typeof node.elementType === 'function') {
          result.displayName = node.elementType.displayName || node.elementType.name || null;
        }
        
        // Get tag
        result.tag = node.tag;
        
        // Get memoizedProps key names (not values)
        if (node.memoizedProps) {
          result.memoizedProps = Object.keys(node.memoizedProps).slice(0, 10);
        }
        
        // Walk owner chain
        if (node._debugOwner) {
          let owner = node._debugOwner;
          const path = [];
          while (owner && path.length < 10) {
            const name = (owner.type && (owner.type.displayName || owner.type.name)) || null;
            if (name) path.push(name);
            owner = owner._debugOwner;
          }
          result.ownerPath = path.reverse();
        }
        
        results.push(result);
        
        // Walk children
        let child = node.child;
        while (child) {
          walkFiber(child, depth + 1, maxDepth);
          child = child.sibling;
        }
        
        return result;
      }
      
      walkFiber(fiber, 0, 15);
      
      return {
        available: true,
        nodes: results.filter(n => n.displayName || n.ownerPath.length > 0),
        disclaimer: 'React Fiber (__reactFiber$) is a private API and may break across React versions',
      };
    })();
  `;
}

module.exports = { getFiberIntrospectionScript };