// Optional chaining keeps the API client usable in Node-based unit tests where
// Vite environment injection is intentionally absent.
import { toChineseErrorMessage } from './utils/errorMessages.js';

const BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
export const BACKEND_ORIGIN = BASE.replace(/\/api\/v1\/?$/, '');

export function getToken() { return localStorage.getItem('ff_token'); }
export function setToken(t) { localStorage.setItem('ff_token', t); }
export function clearToken() { localStorage.removeItem('ff_token'); }
export function getUser() {
  try { return JSON.parse(localStorage.getItem('ff_user') || 'null'); } catch { return null; }
}
export function setUser(u) { localStorage.setItem('ff_user', JSON.stringify(u)); }
export function clearUser() { localStorage.removeItem('ff_user'); }

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw buildApiError({ status: res.status, data });
  }
  return data;
}

// 後端訊息保留在 originalMessage 供除錯，畫面上顯示的 message 一律是中文。
export function buildApiError({ status, data = {}, fallbackMessage } = {}) {
  const code = data.error?.code;
  const originalMessage = data.message || fallbackMessage || '';
  const err = new Error(fallbackMessage && !data.message
    ? fallbackMessage
    : toChineseErrorMessage({ code, status, message: originalMessage }));
  err.code = code;
  err.status = status;
  err.originalMessage = originalMessage;
  return err;
}
