// ─── Page-world Token Probe (injected script) ────────────────────────────
// Probes runtime Ant Design tokens from the theme provider.
// Runs in page context to access React theme context.

/** @returns {{tokensAvailable: boolean, tokens?: Record<string, string>, tokenSource?: string}|null} */
function probeAntdTokens() {
  try {
    // Try to find ConfigProvider via React fiber
    const rootEl = document.getElementById('root');
    if (!rootEl) return { tokensAvailable: false };

    const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) return { tokensAvailable: false };

    let fiber = rootEl[fiberKey];
    let depth = 0;
    while (fiber && depth < 100) {
      const memoizedProps = fiber.memoizedProps;
      if (memoizedProps?.theme?.token) {
        const theme = memoizedProps.theme;
        return {
          tokensAvailable: true,
          tokenSource: 'runtime',
          tokens: {
            colorPrimary: theme.token?.colorPrimary || theme.primaryColor,
            colorLink: theme.token?.colorLink,
            colorSuccess: theme.token?.colorSuccess,
            colorWarning: theme.token?.colorWarning,
            colorError: theme.token?.colorError,
            fontFamily: theme.token?.fontFamily,
            fontSize: theme.token?.fontSize?.toString(),
            borderRadius: theme.token?.borderRadius?.toString(),
            wireframe: theme.token?.wireframe?.toString(),
          },
        };
      }
      fiber = fiber.return || fiber.child;
      depth++;
    }

    return { tokensAvailable: false };
  } catch {
    return { tokensAvailable: false };
  }
}

// Execute and send result
const result = probeAntdTokens();
window.dispatchEvent(new CustomEvent('__ANTHEMA_TOKENS', { detail: result }));