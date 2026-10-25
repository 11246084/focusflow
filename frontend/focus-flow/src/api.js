import { toChineseErrorMessage } from './utils/errorMessages.js';

export const API_BASE = '/api/v1';
export const BACKEND_ORIGIN = '';
let authEpoch = 0;
let authenticated = false;
let pendingFlowActive = false;
let authChannel = null;
const listeners = new Set();
const storage = () => globalThis.localStorage;
export const getAuthEpoch = () => authEpoch;
export const isAuthenticated = () => authenticated;
export const isPendingFlowActive = () => pendingFlowActive;
export function setPendingFlowActive(value) { pendingFlowActive = Boolean(value); }
export function getUser() {
  try { return JSON.parse(storage()?.getItem('ff_user') || 'null'); } catch { return null; }
}
export function setUser(user) { storage()?.setItem('ff_user', JSON.stringify(user)); }
export function clearUser() { storage()?.removeItem('ff_user'); }
export function removeLegacyToken() { storage()?.removeItem('ff_token'); }
export function staleAuthError() {
  return Object.assign(new Error('此請求屬於先前的登入，已忽略回應。'), { name: 'AbortError', code: 'STALE_AUTH_RESPONSE' });
}
export function assertAuthEpoch(epoch) { if (epoch !== authEpoch) throw staleAuthError(); }
export function advanceAuthEpoch() { authEpoch += 1; return authEpoch; }
function notify(event) { listeners.forEach((listener) => listener(event)); }
function broadcast(type) { authChannel?.postMessage({ type }); }
export function acceptAuthUser(user, { announce = false } = {}) {
  if (!user?.id || !['student', 'teacher', 'admin'].includes(user.role)) throw new Error('登入資料不完整，請重新登入。');
  if (announce) advanceAuthEpoch();
  authenticated = true; setUser(user); removeLegacyToken();
  if (announce) broadcast('login');
}
export function invalidateAuthSession(type = 'revalidate', { announce = false } = {}) {
  advanceAuthEpoch(); authenticated = false; clearUser(); removeLegacyToken();
  notify({ type, epoch: authEpoch });
  if (announce) broadcast('logout');
}
export function subscribeAuthEvents(listener) {
  listeners.add(listener);
  if (!authChannel && typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
    try {
      authChannel = new BroadcastChannel('focusflow-auth');
      authChannel.onmessage = ({ data }) => {
        if (data?.type === 'login' || data?.type === 'logout') invalidateAuthSession('external-change');
      };
    } catch {
      // Privacy settings may block the channel even when the API exists.
      // Keep local listeners active; visibility revalidation is the fallback.
      authChannel = null;
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { authChannel?.close(); authChannel = null; }
  };
}
function isCredentialPath(path) {
  return /^\/auth\/(?:session|register|pending(?:\/|$)|password-reset(?:\/|$)|step-up)/.test(path);
}
function handleFailure(path, options, status, data, epoch) {
  assertAuthEpoch(epoch);
  if (authenticated && options.sessionFailure !== false && !isCredentialPath(path)
    && status === 401 && ['UNAUTHORIZED', 'INVALID_TOKEN'].includes(data.error?.code)) {
    invalidateAuthSession('expired', { announce: true });
  }
  throw buildApiError({ status, data, fallbackMessage: status === 413 ? '影片檔案超過伺服器允許的上傳大小。' : options.fallbackMessage });
}
async function send(path, options, epoch) {
  const { fetchImpl = globalThis.fetch, sessionFailure: _sessionFailure, fallbackMessage: _fallbackMessage, ...requestOptions } = options;
  const headers = options.headers instanceof Headers ? Object.fromEntries(options.headers) : { ...options.headers };
  for (const key of Object.keys(headers)) {
    if (['authorization', 'x-requested-with'].includes(key.toLowerCase())) delete headers[key];
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers['X-Requested-With'] = 'FocusFlow';
  let response;
  try { response = await fetchImpl(`${API_BASE}${path}`, { ...requestOptions, headers, credentials: 'same-origin' }); }
  catch (error) { assertAuthEpoch(epoch); throw error; }
  assertAuthEpoch(epoch);
  return response;
}
export async function apiFetch(path, options = {}) {
  const epoch = getAuthEpoch();
  const response = await send(path, options, epoch);
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  assertAuthEpoch(epoch);
  if (!response.ok) handleFailure(path, options, response.status, data, epoch);
  return data;
}
export async function apiBlob(path, options = {}) {
  const epoch = getAuthEpoch();
  const response = await send(path, options, epoch);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    handleFailure(path, options, response.status, data, epoch);
  }
  let blob;
  try { blob = await response.blob(); }
  catch (error) { assertAuthEpoch(epoch); throw error; }
  assertAuthEpoch(epoch);
  return blob;
}
export async function logoutSession({ all = false } = {}) {
  await apiFetch(all ? '/auth/logout-all' : '/auth/session', { method: all ? 'POST' : 'DELETE', sessionFailure: all });
  invalidateAuthSession('signed-out', { announce: true });
}
export function buildApiError({ status, data = {}, fallbackMessage } = {}) {
  const code = data.error?.code;
  const details = data.error?.details;
  const originalMessage = data.message || fallbackMessage || '';
  const err = new Error(fallbackMessage && !data.message
    ? fallbackMessage
    : toChineseErrorMessage({ code, status, message: originalMessage, details }));
  err.code = code; err.status = status; err.details = details; err.originalMessage = originalMessage;
  return err;
}
