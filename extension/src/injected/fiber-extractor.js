/**
 * Fiber Extractor — Injected Page-World Script (upgraded V2)
 * Walks React fiber tree, collects component names, counts, props, and hook stats.
 * Fires CustomEvent __ANTHENA_FIBER with FiberInfo.
 */
(function () {
  'use strict';

  /**
   * Walk fiber tree and collect component stats.
   * @returns {{ available: boolean, rootName?: string, componentCount?: number, components?: { name: string, instanceCount: number, props?: string[] }[], hooks?: { total: number, byType: Record<string, number> } }}
   */
  function extractFiber() {
    try {
      const rootEl = document.getElementById('root') || document.querySelector('[data-reactroot]');
      if (!rootEl) return { available: false };

      const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { available: false };

      let fiber = rootEl[fiberKey];
      if (!fiber) return { available: false };

      // Walk up to topmost host component
      let depth = 0;
      while (fiber.return && depth < 50) {
        fiber = fiber.return;
        depth++;
      }

      const rootName = fiber.elementType?.displayName || fiber.elementType?.name || 'App';

      // Walk entire tree to collect component stats
      const componentMap = new Map();
      const hookMap = {};
      let totalHooks = 0;

      function walkFiber(f, d) {
        if (!f || d > 100) return;
        const name = f.elementType?.displayName || f.elementType?.name || f.tag?.toString();
        if (name && name !== 'undefined' && !name.startsWith('Symbol(')) {
          if (!componentMap.has(name)) {
            componentMap.set(name, { name, instanceCount: 0, props: new Set() });
          }
          const entry = componentMap.get(name);
          entry.instanceCount++;
          if (f.memoizedProps && typeof f.memoizedProps === 'object') {
            Object.keys(f.memoizedProps).slice(0, 10).forEach((p) => {
              if (!p.startsWith('__') && p !== 'children') entry.props.add(p);
            });
          }
        }

        // Hook tracking
        const hooks = f.memoizedState;
        if (hooks && hooks.queue?.lastRenderedState) {
          // Count hook types from fiber
        }

        // Walk children
        let child = f.child;
        while (child) {
          walkFiber(child, d + 1);
          child = child.sibling;
        }
      }

      walkFiber(fiber, 0);

      // Count hooks by walking hook queue
      function countHooks(f) {
        if (!f) return;
        let hookState = f.memoizedState;
        while (hookState) {
          totalHooks++;
          const tag = hookState.queue?.lastRenderedState?.tag;
          const hookName = tag === 0 ? 'useState' : tag === 1 ? 'useReducer' : tag === 2 ? 'useEffect' : tag === 3 ? 'useLayoutEffect' : tag === 4 ? 'useRef' : tag === 5 ? 'useImperativeHandle' : tag === 6 ? 'useMemo' : tag === 7 ? 'useCallback' : tag === 8 ? 'useContext' : tag === 9 ? 'useDebugValue' : 'useUnknown';
          hookMap[hookName] = (hookMap[hookName] || 0) + 1;
          hookState = hookState.next;
        }
        // Walk children
        let child = f.child;
        while (child) {
          countHooks(child);
          child = child.sibling;
        }
      }
      countHooks(fiber);

      const components = Array.from(componentMap.values())
        .map((c) => ({ name: c.name, instanceCount: c.instanceCount, props: Array.from(c.props).sort() }))
        .sort((a, b) => b.instanceCount - a.instanceCount);

      return {
        available: true,
        rootName,
        componentCount: components.length,
        components,
        hooks: { total: totalHooks, byType: hookMap },
      };
    } catch (_) {
      return { available: false };
    }
  }

  const result = extractFiber();
  window.dispatchEvent(new CustomEvent('__ANTHENA_FIBER', { detail: result }));
})();