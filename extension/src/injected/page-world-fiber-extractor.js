// ─── Page-world Fiber Extractor (injected script) ───────────────────────
// This script runs in the page's JavaScript context (not isolated world)
// so it can access React Fiber internals.

/** @returns {{fiberAvailable: boolean, ownerName?: string, ownerPath?: string, hooks?: number}|null} */
function extractFiber() {
  try {
    // Find the root fiber
    const rootEl = document.getElementById('root') || document.querySelector('[data-reactroot]');
    if (!rootEl) return null;

    const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;

    let fiber = rootEl[fiberKey];
    if (!fiber) return null;

    // Walk up to find the topmost host component
    let depth = 0;
    while (fiber.return && depth < 50) {
      fiber = fiber.return;
      depth++;
    }

    const ownerName = fiber.elementType?.displayName || fiber.elementType?.name || fiber.tag?.toString() || 'unknown';

    return {
      fiberAvailable: true,
      ownerName,
      ownerPath: fiber._debugOwner?.elementType?.displayName || ownerName,
      hooks: fiber.memoizedState?.queue?.lastRenderedState?.length || 0,
    };
  } catch {
    return { fiberAvailable: false };
  }
}

// Execute and send result back to content script via window event
const result = extractFiber();
window.dispatchEvent(new CustomEvent('__ANTHEMA_FIBER', { detail: result }));