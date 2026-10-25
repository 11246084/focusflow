import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_SESSION_STATUS, requireAdminSession, restoreAuthSession, observeAuthSession } from '../src/authSession.js';
const user = { id: 'student-1', role: 'student', name: '學生' };
const options = { setUserImpl: () => {}, clearUserImpl: () => {}, acceptUserImpl: () => {} };
test('啟動沒有 JS token 也一律呼叫 auth/me', async () => {
  let count = 0;
  const result = await restoreAuthSession({ ...options, apiFetchImpl: async (path) => { count += 1; assert.equal(path, '/auth/me'); return { data: { user } }; } });
  assert.equal(count, 1); assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
});
for (const role of ['student', 'teacher', 'admin']) {
  test(`以後端驗證的 ${role} 恢復登入，不採用顯示快取角色`, async () => {
    const stored = [];
    const result = await restoreAuthSession({ ...options, apiFetchImpl: async () => ({ data: { user: { ...user, role } } }), setUserImpl: (value) => stored.push(value) });
    assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED); assert.equal(stored[0].role, role);
    assert.equal(requireAdminSession(result).status, role === 'admin' ? AUTH_SESSION_STATUS.AUTHENTICATED : AUTH_SESSION_STATUS.FORBIDDEN);
  });
}
test('auth/me 的 401 是未登入，會清除畫面快取', async () => {
  let cleared = 0;
  const result = await restoreAuthSession({ ...options, clearUserImpl: () => { cleared += 1; }, apiFetchImpl: async () => { throw Object.assign(new Error(), { status: 401 }); } });
  assert.equal(result.status, AUTH_SESSION_STATUS.ANONYMOUS); assert.equal(cleared, 1);
});
test('網路、5xx、403 與不完整成功回應維持 UNAVAILABLE，不清除身分', async () => {
  let cleared = 0;
  for (const value of [new TypeError('offline'), Object.assign(new Error(), { status: 503 }), Object.assign(new Error(), { status: 403 }), { data: {} }]) {
    const result = await restoreAuthSession({ ...options, clearUserImpl: () => { cleared += 1; }, apiFetchImpl: async () => { if (value instanceof Error) throw value; return value; } });
    assert.equal(result.status, AUTH_SESSION_STATUS.UNAVAILABLE);
  }
  assert.equal(cleared, 0);
});
test('restore 在登入世代改變後丟棄舊回應，不寫舊身分', async () => {
  let stored = false;
  const result = await restoreAuthSession({ ...options, setUserImpl: () => { stored = true; }, apiFetchImpl: async () => ({ data: { user } }), assertEpochImpl: () => { throw Object.assign(new Error(), { code: 'STALE_AUTH_RESPONSE' }); } });
  assert.equal(result.status, AUTH_SESSION_STATUS.STALE); assert.equal(stored, false);
});
test('重新取得可見焦點至少間隔三十秒才驗證', () => {
  let now = 0; let handler; let count = 0;
  const documentImpl = { visibilityState: 'visible', addEventListener: (_, fn) => { handler = fn; }, removeEventListener: () => {} };
  const stop = observeAuthSession(() => { count += 1; }, { documentImpl, now: () => now });
  now = 29999; handler(); assert.equal(count, 0);
  now = 30000; handler(); assert.equal(count, 1);
  now = 45000; handler(); assert.equal(count, 1);
  now = 60000; handler(); assert.equal(count, 2); stop();
});
