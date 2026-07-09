/**
 * Token Probe — Injected Page-World Script (upgraded V2)
 * Probes runtime Ant Design tokens from ConfigProvider via React fiber.
 * Fires CustomEvent __ANTHENA_TOKENS with TokenInfo.
 */
(function () {
  'use strict';

  /**
   * Probe AntD ConfigProvider for runtime theme tokens.
   * @returns {{ available: boolean, source?: 'runtime'|'inferred', tokens?: Record<string, string> }}
   */
  function probeAntdTokens() {
    try {
      const rootEl = document.getElementById('root');
      if (!rootEl) return { available: false };

      const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { available: false };

      let fiber = rootEl[fiberKey];
      let depth = 0;

      while (fiber && depth < 200) {
        const memoizedProps = fiber.memoizedProps;

        // Check for ConfigProvider theme prop
        if (memoizedProps?.theme?.token) {
          const theme = memoizedProps.theme;
          const token = theme.token;

          const tokens = {};

          // Extract known token keys
          const tokenKeys = [
            'colorPrimary', 'colorLink', 'colorSuccess', 'colorWarning', 'colorError', 'colorInfo',
            'colorBgContainer', 'colorBgLayout', 'colorBgElevated', 'colorBgSpotlight',
            'colorText', 'colorTextSecondary', 'colorTextTertiary', 'colorTextQuaternary',
            'colorBorder', 'colorBorderSecondary',
            'fontFamily', 'fontSize', 'fontSizeSM', 'fontSizeLG', 'fontSizeXL',
            'fontWeightStrong',
            'lineHeight', 'lineHeightSM', 'lineHeightLG',
            'borderRadius', 'borderRadiusLG', 'borderRadiusSM', 'borderRadiusXS',
            'controlHeight', 'controlHeightSM', 'controlHeightLG',
            'paddingXXS', 'paddingXS', 'paddingSM', 'padding', 'paddingMD', 'paddingLG', 'paddingXL',
            'marginXXS', 'marginXS', 'marginSM', 'margin', 'marginMD', 'marginLG', 'marginXL',
            'boxShadow', 'boxShadowSecondary',
            'wireframe',
          ];

          for (const key of tokenKeys) {
            const val = token[key];
            if (val !== undefined && val !== null) {
              tokens[key] = String(val);
            }
          }

          // Also try to get from algorithm (dark/compact)
          const algorithm = theme.algorithm;
          if (algorithm && typeof algorithm === 'function') {
            tokens['_algorithm'] = algorithm.name || 'custom';
          }

          return {
            available: Object.keys(tokens).length > 0,
            source: 'runtime',
            tokens,
          };
        }

        // Walk: try return first (parent), then child
        fiber = fiber.return || fiber.child;
        depth++;
      }

      // Fallback: infer from computed CSS
      return { available: true, source: 'inferred', tokens: inferTokensFromCss() };
    } catch (_) {
      return { available: false };
    }
  }

  /**
   * Infer AntD tokens from computed CSS of known AntD elements.
   */
  function inferTokensFromCss() {
    const tokens = {};
    const btn = document.querySelector('.ant-btn');
    if (btn) {
      const cs = getComputedStyle(btn);
      tokens.colorPrimary = cs.getPropertyValue('background-color').trim() || '#1677ff';
      tokens.fontSize = cs.getPropertyValue('font-size');
      tokens.borderRadius = cs.getPropertyValue('border-radius');
      tokens.fontFamily = cs.getPropertyValue('font-family');
    }
    const input = document.querySelector('.ant-input');
    if (input) {
      const cs = getComputedStyle(input);
      if (!tokens.colorPrimary) tokens.colorPrimary = cs.getPropertyValue('border-color');
      tokens.controlHeight = cs.getPropertyValue('height');
    }
    return tokens;
  }

  const result = probeAntdTokens();
  window.dispatchEvent(new CustomEvent('__ANTHENA_TOKENS', { detail: result }));
})();