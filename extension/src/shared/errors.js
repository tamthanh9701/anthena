// ─── Error types ────────────────────────────────────────────────────────

export class CaptureError extends Error {
  /** @param {string} message @param {'config'|'extraction'|'network'|'auth'|'storage'} category */
  constructor(message, category = 'extraction') {
    super(message);
    this.name = 'CaptureError';
    this.category = category;
  }
}

export class NetworkError extends CaptureError {
  /** @param {string} message @param {number} [statusCode] */
  constructor(message, statusCode) {
    super(message, 'network');
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class AuthError extends CaptureError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'auth');
    this.name = 'AuthError';
  }
}

/**
 * Wrap a fetch call with timeout and error handling
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`, response.status);
    }
    return response;
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    if (err.name === 'AbortError') throw new NetworkError('Request timed out', 408);
    throw new NetworkError(err.message, 0);
  } finally {
    clearTimeout(timeout);
  }
}