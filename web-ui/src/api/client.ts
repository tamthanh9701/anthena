import axios, { AxiosError } from 'axios';
import type { ErrorResponse } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// In-memory token store (not localStorage) to avoid XSS-based token exfiltration.
// Session-only: the token is lost on page refresh — the user must re-authenticate.
// This is a deliberate security trade-off: no persistent storage for auth tokens.
let sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

// Auth interceptor
apiClient.interceptors.request.use((config) => {
  const token = sessionToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Error response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ErrorResponse>) => {
    const errResponse: ErrorResponse = error.response?.data || {
      error: error.message || 'Network error',
      code: 'NETWORK_ERROR',
      requestId: 'unknown',
    };
    return Promise.reject(errResponse);
  }
);

export default apiClient;
