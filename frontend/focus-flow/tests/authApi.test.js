import { beforeEach, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiBlob, acceptAuthUser, invalidateAuthSession, getAuthEpoch, getUser, isAuthenticated, subscribeAuthEvents, logoutSession } from '../src/api.js';
import { observeAuthSession } from '../src/authSession.js';
const originalStorage = globalThis.localStorage;
const originalWindow = globalThis.window;
const originalChannel = globalThis.BroadcastChannel;
let values;
beforeEach(() => {
  values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  invalidateAuthSession();
});
afterEach(() => { globalThis.localStorage = originalStorage; globalThis.window = originalWindow; globalThis.BroadcastChannel = originalChannel; });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
it('API 一律同來源 cookie，寫入加 CSRF header，移除 Authorization', async () => {
  let received;
  await apiFetch('/courses', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer obsolete', 'Content-Type': 'application/json' }, fetchImpl: async (...args) => { received = args; return response({}); } });
  assert.equal(received[0], '/api/v1/courses'); assert.equal(received[1].credentials, 'same-origin');
  assert.equal(received[1].headers['X-Requested-With'], 'FocusFlow'); assert.equal(received[1].headers.Authorization, undefined);
});
it('登入世代已變時丟棄舊成功與舊 401，不可清新登入', async () => {
  for (const status of [200, 401]) {
    let finish;
    const promise = apiFetch('/courses', { fetchImpl: () => new Promise((resolve) => { finish = resolve; }) });
    acceptAuthUser({ id: 'new-user', role: 'student' }, { announce: true });
    finish(response({ error: { code: 'UNAUTHORIZED' } }, status));
    await assert.rejects(promise, { code: 'STALE_AUTH_RESPONSE' });
    assert.equal(getUser().id, 'new-user'); assert.equal(isAuthenticated(), true);
  }
});
it('只有目前已登入受保護請求的 session 401 會使全域登出', async () => {
  for (const path of ['/auth/session', '/auth/pending/verify', '/auth/step-up']) {
    acceptAuthUser({ id: 'current', role: 'student' });
    await assert.rejects(apiFetch(path, { fetchImpl: async () => response({ error: { code: 'UNAUTHORIZED' } }, 401) }));
    assert.equal(isAuthenticated(), true);
  }
  let event; const stop = subscribeAuthEvents((value) => { event = value; });
  await assert.rejects(apiFetch('/courses', { fetchImpl: async () => response({ error: { code: 'INVALID_TOKEN' } }, 401) }));
  assert.equal(isAuthenticated(), false); assert.equal(getUser(), null); assert.equal(event.type, 'expired'); stop();
});
it('blob 讀取途中換登入世代，也不可回傳舊檔案', async () => {
  let finish;
  const promise = apiBlob('/auth/me/avatar', { fetchImpl: async () => ({ ok: true, blob: () => new Promise((resolve) => { finish = resolve; }) }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  acceptAuthUser({ id: 'new', role: 'student' }, { announce: true }); finish(new Blob(['old']));
  await assert.rejects(promise, { code: 'STALE_AUTH_RESPONSE' });
});
it('多分頁只傳事件類型，收到通知先遞增世代並清掉舊身分', () => {
  let channel; const sent = []; globalThis.window = {};
  globalThis.BroadcastChannel = class { constructor() { channel = this; } postMessage(value) { sent.push(value); } close() {} };
  const observed = []; const stop = subscribeAuthEvents((event) => observed.push({ event, user: getUser(), epoch: getAuthEpoch() }));
  acceptAuthUser({ id: 'old', role: 'teacher' }, { announce: true });
  assert.deepEqual(sent, [{ type: 'login' }]); const before = getAuthEpoch();
  channel.onmessage({ data: { type: 'login' } });
  assert.ok(getAuthEpoch() > before); assert.equal(observed[0].user, null); assert.equal(isAuthenticated(), false); stop();
});
it('隱私設定拒絕建立 BroadcastChannel 時，登入仍可用並保留可見焦點備援', (t) => {
  globalThis.window = {};
  globalThis.BroadcastChannel = class { constructor() { throw new DOMException('Blocked by privacy settings', 'SecurityError'); } };
  let now = 0; let onVisibility; let removed = false; let stop;
  const events = [];
  const documentImpl = {
    visibilityState: 'visible',
    addEventListener: (_, listener) => { onVisibility = listener; },
    removeEventListener: (_, listener) => { removed = listener === onVisibility; },
  };
  assert.doesNotThrow(() => { stop = observeAuthSession((event) => events.push(event), { documentImpl, now: () => now }); });
  t.after(() => stop());
  assert.doesNotThrow(() => acceptAuthUser({ id: 'current', role: 'student' }, { announce: true }));
  assert.equal(isAuthenticated(), true);
  now = 29999; onVisibility(); assert.equal(events.length, 0);
  const epoch = getAuthEpoch();
  now = 30000; onVisibility();
  assert.equal(events.length, 1); assert.equal(events[0].type, 'revalidate');
  assert.ok(getAuthEpoch() > epoch); assert.equal(getUser(), null);
  stop(); assert.equal(removed, true);
});
it('登出 API 失敗不假裝登出，204 成功才清除身分', async () => {
  const previousFetch = globalThis.fetch;
  acceptAuthUser({ id: 'current', role: 'student' });
  try {
    globalThis.fetch = async () => response({ error: { code: 'AUTH_UNAVAILABLE' } }, 503);
    await assert.rejects(logoutSession()); assert.equal(isAuthenticated(), true);
    globalThis.fetch = async () => ({ ok: true, status: 204 });
    await logoutSession(); assert.equal(isAuthenticated(), false);
  } finally { globalThis.fetch = previousFetch; }
});
