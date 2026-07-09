/**
 * Text Redactor — Injected Page-World Script (V2.1)
 * Runs in page JS context. Redacts PII, text content, input values, and image URLs.
 * Preserves structure (tag names, classes, IDs, ARIA attrs, data-testid, data-cy, data-test, data-component, data-qa).
 * Fires CustomEvent __ANTHENA_REDACTION with detailed counts.
 */
(function () {
  'use strict';

  // ── Redactor configuration (can be overridden via text-redactor-config.js) ──
  const config = window.__ANTHENA_REDACTOR_CONFIG__ || {
    redactText: true,
    redactImages: true,
    redactInputValues: true,
    redactBgImages: true,
    redactPiiAttrs: true,
    piiRegexEnabled: true,
    blurImages: false,         // Set true to inject blur(10px) CSS overlay on images
    allowlistedSelectors: [],  // e.g. ['.debug-panel', '#metrics-output']
    preserveAttrs: ['data-testid', 'data-cy', 'data-test', 'data-component', 'data-qa'],
  };

  /** @type {{ textNodes: number, images: number, bgImages: number, piiAttrs: number, inputsRedacted: number, piiPatternsRedacted: number }} */
  const counts = {
    textNodes: 0,
    images: 0,
    bgImages: 0,
    piiAttrs: 0,
    inputsRedacted: 0,
    piiPatternsRedacted: 0,
  };

  // ── PII Regex Patterns ────────────────────────────────────
  const PII_PATTERNS = [
    // Email
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'email' },
    // SSN (XXX-XX-XXXX)
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'ssn' },
    // Credit card (XXXX-XXXX-XXXX-XXXX or XXXX XXXX XXXX XXXX)
    { regex: /\b(?:\d{4}[-\s]){3}\d{4}\b/g, label: 'credit-card' },
    // US Phone: (XXX) XXX-XXXX or XXX-XXX-XXXX
    { regex: /(?:\(\d{3}\)\s?|\b\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, label: 'phone' },
  ];

  // ── PII data-* attribute prefixes ─────────────────────────
  const PII_DATA_PREFIXES = [
    'data-user-', 'data-email-', 'data-phone-', 'data-ssn-', 'data-personal-',
    'data-account', 'data-billing', 'data-address', 'data-payment', 'data-card',
    'data-credit', 'data-cvv',
  ];

  // ── ARIA attributes that may contain PII ──────────────────
  const PII_ARIA_ATTRS = ['aria-label', 'aria-describedby'];

  // ── Helper: check if element is in an allowlisted subtree ─
  function isAllowlisted(el) {
    if (!el || !config.allowlistedSelectors.length) return false;
    for (const sel of config.allowlistedSelectors) {
      try {
        if (el.matches?.(sel) || el.closest?.(sel)) return true;
      } catch (_) { /* invalid selector */ }
    }
    return false;
  }

  // ── Helper: replace PII matches in text with [REDACTED_<type>] ─
  function redactPiiText(text) {
    let changed = false;
    let result = text;
    for (const { regex, label } of PII_PATTERNS) {
      const before = result;
      result = result.replace(regex, () => {
        changed = true;
        return '[REDACTED_' + label.toUpperCase() + ']';
      });
    }
    return { text: result, changed };
  }

  // ═══════════════════════════════════════════════════════════
  // 1. Strip textContent from all text nodes
  // ═══════════════════════════════════════════════════════════
  if (config.redactText) {
    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        if (text.trim().length === 0) continue;
        const parent = node.parentElement;
        if (!parent) continue;

        // Skip script, style, noscript content
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;

        // Skip allowlisted selectors
        if (isAllowlisted(parent)) continue;

        // Skip elements with preserved data-* attrs (test hooks)
        if (config.preserveAttrs.some((a) => parent.hasAttribute(a))) continue;

        // PII regex detection (optional)
        if (config.piiRegexEnabled) {
          const { text: redactedText, changed } = redactPiiText(text);
          if (changed) {
            node.textContent = redactedText;
            counts.piiPatternsRedacted++;
            counts.textNodes++;
            continue;
          }
        }

        // Default: replace all text with "[REDACTED]"
        if (text.trim() !== '[REDACTED]') {
          node.textContent = '[REDACTED]';
          counts.textNodes++;
        }
      }
    } catch (_) { /* treewalker may fail on detached subtrees */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 2. Strip input/textarea/select values
  // ═══════════════════════════════════════════════════════════
  if (config.redactInputValues) {
    try {
      // input fields
      const inputs = document.querySelectorAll('input, textarea, select');
      for (const el of inputs) {
        if (isAllowlisted(el)) continue;

        // Detect password fields explicitly
        const isPassword = el.type === 'password';

        if (el.tagName === 'SELECT') {
          if (el.value && el.value !== '[REDACTED]') {
            el.value = '[REDACTED]';
            counts.inputsRedacted++;
          }
        } else {
          // input / textarea
          if (el.value && el.value !== '[REDACTED]') {
            el.value = '[REDACTED]';
            counts.inputsRedacted++;
          }
          // Also strip placeholder — may contain PII hints
          if (el.placeholder) {
            el.placeholder = isPassword ? '••••••••' : '[REDACTED]';
          }
          // Strip value attribute from DOM
          if (el.hasAttribute('value')) {
            el.setAttribute('value', isPassword ? '••••••••' : '[REDACTED]');
          }
        }

        // Set autocomplete="off" to prevent browser from filling back
        el.setAttribute('autocomplete', 'off');
      }
    } catch (_) { /* */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. Strip img src attributes
  // ═══════════════════════════════════════════════════════════
  if (config.redactImages) {
    try {
      const images = document.querySelectorAll('img');
      for (const img of images) {
        if (isAllowlisted(img)) continue;
        if (img.src && img.src !== '[REDACTED_IMG]') {
          img.setAttribute('data-original-src-redacted', 'true');
          img.removeAttribute('src');
          img.src = '[REDACTED_IMG]';
          counts.images++;

          // Optional blur overlay via CSS class
          if (config.blurImages) {
            img.classList.add('__anthena_redacted_img');
          }
        }
      }
    } catch (_) { /* */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. Strip background-image URLs
  // ═══════════════════════════════════════════════════════════
  if (config.redactBgImages) {
    try {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        if (isAllowlisted(el)) continue;
        const style = el.getAttribute('style');
        if (style && /background-image\s*:/i.test(style)) {
          const newStyle = style.replace(
            /background-image\s*:\s*url\([^)]+\)\s*;?/gi,
            'background-image: none; /* [REDACTED] */'
          );
          if (newStyle !== style) {
            el.setAttribute('style', newStyle);
            counts.bgImages++;
          }
        }
      }
    } catch (_) { /* */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 5. Strip PII data-* attributes
  // ═══════════════════════════════════════════════════════════
  if (config.redactPiiAttrs) {
    try {
      const allWithAttrs = document.querySelectorAll('*');
      for (const el of allWithAttrs) {
        if (!el.attributes || isAllowlisted(el)) continue;
        for (let i = el.attributes.length - 1; i >= 0; i--) {
          const attr = el.attributes[i];
          const name = attr.name;
          if (PII_DATA_PREFIXES.some((p) => name.startsWith(p))) {
            el.removeAttributeNode(el.attributes[i]);
            counts.piiAttrs++;
          }
        }
      }
    } catch (_) { /* */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. Asterisk ARIA labels that contain PII
  // ═══════════════════════════════════════════════════════════
  try {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (!el.attributes || isAllowlisted(el)) continue;
      for (const attrName of PII_ARIA_ATTRS) {
        const val = el.getAttribute(attrName);
        if (!val) continue;
        const { text: redacted, changed } = redactPiiText(val);
        if (changed) {
          el.setAttribute(attrName, redacted);
          counts.piiPatternsRedacted++;
        }
      }
    }
  } catch (_) { /* */ }

  // ═══════════════════════════════════════════════════════════
  // 7. Optional: inject blur overlay CSS for redacted images
  // ═══════════════════════════════════════════════════════════
  if (config.blurImages) {
    try {
      const styleEl = document.createElement('style');
      styleEl.id = '__anthena_redaction_style';
      styleEl.textContent = `
        .__anthena_redacted_img {
          filter: blur(10px) !important;
          transition: filter 0.2s ease;
        }
      `;
      document.head.appendChild(styleEl);
    } catch (_) { /* */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 8. Dispatch result
  // ═══════════════════════════════════════════════════════════
  window.dispatchEvent(
    new CustomEvent('__ANTHENA_REDACTION', {
      detail: {
        applied: true,
        textNodes: counts.textNodes,
        images: counts.images,
        bgImages: counts.bgImages,
        piiAttrs: counts.piiAttrs,
        inputsRedacted: counts.inputsRedacted,
        piiPatternsRedacted: counts.piiPatternsRedacted,
      },
    })
  );
})();
