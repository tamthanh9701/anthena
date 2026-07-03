// ─── Scroll Controller ───────────────────────────────────────────────
// Controls scrolling behavior for full-page capture.
// Runs in content script context (access to DOM scroll properties).

/**
 * @typedef {{ y: number, index: number }} ScrollSegment
 */

// ─── Scroll Save / Restore ───────────────────────────────────────────

/**
 * Save current scroll position
 * @returns {{ x: number, y: number }}
 */
export function saveScrollPosition() {
  return {
    x: window.scrollX || window.pageXOffset,
    y: window.scrollY || window.pageYOffset,
  };
}

/**
 * Restore scroll position
 * @param {{ x: number, y: number }} pos
 */
export function restoreScrollPosition(pos) {
  if (!pos) return;
  try {
    window.scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' });
  } catch {
    // Fallback for older browsers
    window.scrollTo(pos.x, pos.y);
  }
}

// ─── Page Dimensions ─────────────────────────────────────────────────

/**
 * Read current page dimensions
 * @returns {{ scrollHeight: number, clientHeight: number, scrollWidth: number }}
 */
export function getPageDimensions() {
  const de = document.documentElement;
  return {
    scrollHeight: de.scrollHeight,
    clientHeight: de.clientHeight,
    scrollWidth: de.scrollWidth,
  };
}

// ─── Scroll Segments ─────────────────────────────────────────────────

/**
 * Calculate scroll segments for full-page capture.
 * Generates positions: 0, clientHeight, 2*clientHeight, ..., up to scrollHeight.
 * Each segment overlaps ~10% with previous for stitch alignment.
 *
 * @param {{ scrollHeight: number, clientHeight: number }} pageDimensions
 * @returns {Array<{y: number, index: number}>}
 */
export function calculateScrollSegments(pageDimensions) {
  const { scrollHeight, clientHeight } = pageDimensions;

  if (clientHeight <= 0 || scrollHeight <= 0) {
    return [{ y: 0, index: 0 }];
  }

  const segments = [];

  // Generate overlapping segments: step by clientHeight * 0.9 (10% overlap)
  // This helps stitch algorithm detect overlapping content
  const overlapRatio = 0.9;
  const step = Math.max(1, Math.floor(clientHeight * overlapRatio));

  let y = 0;
  let index = 0;

  while (y < scrollHeight) {
    segments.push({ y, index });
    index++;
    y += step;
  }

  // Ensure last segment reaches scrollHeight
  const last = segments[segments.length - 1];
  if (last && last.y + clientHeight < scrollHeight) {
    segments.push({ y: Math.max(0, scrollHeight - clientHeight), index });
  }

  return segments;
}

// ─── Scroll To Position ──────────────────────────────────────────────

/**
 * Scroll to a position and wait for layout / lazy load
 * @param {number} y
 * @param {number} [waitMs=300]
 * @returns {Promise<void>}
 */
export async function scrollToPosition(y, waitMs = 300) {
  return new Promise((resolve) => {
    try {
      window.scrollTo({
        top: y,
        left: 0,
        behavior: 'instant', // 'instant' to avoid smooth scroll delay
      });
    } catch {
      window.scrollTo(0, y);
    }

    // Wait for layout/paint + lazy-loaded images to trigger
    // Use requestAnimationFrame + timeout combo for reliability
    requestAnimationFrame(() => {
      // Dispatch scroll event so lazy loaders can react
      window.dispatchEvent(new Event('scroll'));

      setTimeout(() => {
        // Trigger a second scroll event after images may have loaded
        window.dispatchEvent(new Event('scroll'));
        resolve();
      }, waitMs);
    });
  });
}

// ─── Sticky / Fixed Element Detection ────────────────────────────────

/**
 * Detect sticky/fixed elements at current scroll position.
 * Computes position from getComputedStyle, not just position attribute,
 * to catch CSS-in-JS and dynamically applied styles.
 *
 * @returns {string[]} - CSS selectors of detected sticky/fixed elements
 */
export function detectStickyElements() {
  /** @type {string[]} */
  const selectors = [];

  try {
    const allElements = document.querySelectorAll('*');
    const body = document.body;

    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];

      // Skip if element is hidden or zero-size
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top > window.innerHeight || rect.bottom < 0) continue; // off-screen

      const style = window.getComputedStyle(el);
      const pos = style.position;

      if (pos === 'fixed' || pos === 'sticky') {
        // Build a reasonable unique selector for this element
        const selector = buildSelector(el, body);
        if (selector && !selectors.includes(selector)) {
          selectors.push(selector);
        }
      }
    }
  } catch {
    // Cross-origin iframe or shadow DOM access may throw
    // Silently skip — sticky detection is best-effort
  }

  return selectors;
}

/**
 * Track sticky/fixed elements across multiple scroll positions.
 * Returns union of all sticky elements found.
 *
 * @param {string[]} previousSelectors
 * @returns {{ union: string[], newElements: string[] }}
 */
export function trackStickyElements(previousSelectors = []) {
  const current = detectStickyElements();
  const newElements = current.filter(s => !previousSelectors.includes(s));
  return {
    union: [...new Set([...previousSelectors, ...current])],
    newElements,
  };
}

// ─── Full-Page Scroll Sequence ───────────────────────────────────────

/**
 * Execute full-page scroll sequence.
 * 1. Save scroll position
 * 2. Scroll to top
 * 3. Generate segments
 * 4. For each segment: scroll, wait, detect stickies
 * 5. Return segments + sticky info
 * 6. Restore original scroll position
 *
 * @returns {Promise<{segments: ScrollSegment[], stickyElements: string[], pageDimensions: { scrollHeight: number, clientHeight: number, scrollWidth: number }}>}
 */
export async function executeScrollSequence() {
  const savedPos = saveScrollPosition();
  const pageDimensions = getPageDimensions();
  const segments = calculateScrollSegments(pageDimensions);

  // Scroll to top first
  await scrollToPosition(0, 300);

  /** @type {string[]} */
  let allStickyElements = [];

  // Track stickies at each scroll position
  for (const seg of segments) {
    await scrollToPosition(seg.y, 300);
    const stickyResult = trackStickyElements(allStickyElements);
    allStickyElements = stickyResult.union;
  }

  // Restore original position
  restoreScrollPosition(savedPos);

  return {
    segments,
    stickyElements: allStickyElements,
    pageDimensions,
  };
}


// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a CSS selector path for an element (unique enough for logging)
 * @param {Element} el
 * @param {Element} root
 * @returns {string}
 */
function buildSelector(el, root) {
  try {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const tag = el.tagName.toLowerCase();
    let selector = tag;

    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 3); // limit to 3 classes
      if (classes.length > 0 && classes[0] !== '') {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    // Disambiguate with nth-child if needed
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }

    return selector;
  } catch {
    return tag;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────

export default {
  saveScrollPosition,
  restoreScrollPosition,
  getPageDimensions,
  calculateScrollSegments,
  scrollToPosition,
  detectStickyElements,
  trackStickyElements,
  executeScrollSequence,
};
