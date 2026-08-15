// Optional chaining keeps the API client usable in Node-based unit tests where
// Vite environment injection is intentionally absent.
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
    const err = new Error(data.message || 'Request failed');
    err.code = data.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}
