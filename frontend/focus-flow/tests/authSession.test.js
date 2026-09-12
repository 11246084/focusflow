import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_SESSION_STATUS,
  requireAdminSession,
  restoreAuthSession,
} from '../src/authSession.js';

function validResponse(user) {
  return { data: { user } };
}

function expiredTokenError(status = 401) {
  const error = new Error('Authentication failed');
  error.status = status;
  return error;
}

test('沒有 token 時維持未登入，且不呼叫 /auth/me', async () => {
  let requestCount = 0;
  const result = await restoreAuthSession({
    getTokenImpl: () => null,
    apiFetchImpl: async () => { requestCount += 1; },
  });

  assert.equal(result.status, AUTH_SESSION_STATUS.ANONYMOUS);
  assert.equal(requestCount, 0);
});

test('合法 student token 會以後端使用者恢復 student session', async () => {
  const storedUsers = [];
  const result = await restoreAuthSession({
    getTokenImpl: () => 'student-token',
    apiFetchImpl: async (path) => {
      assert.equal(path, '/auth/me');
      return validResponse({ id: 'student-1', role: 'student', name: '學生' });
    },
    setUserImpl: (user) => storedUsers.push(user),
  });

  assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
  assert.equal(result.user.role, 'student');
  assert.deepEqual(storedUsers, [result.user]);
});

test('合法 teacher token 會以後端使用者恢復 teacher session', async () => {
  const result = await restoreAuthSession({
    getTokenImpl: () => 'teacher-token',
    apiFetchImpl: async () => validResponse({ id: 'teacher-1', role: 'teacher', name: '教師' }),
    setUserImpl: () => {},
  });

  assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
  assert.equal(result.user.role, 'teacher');
});

test('合法 admin token 通過 admin session 檢查並可進入 admin dashboard', async () => {
  const session = await restoreAuthSession({
    getTokenImpl: () => 'admin-token',
    apiFetchImpl: async () => validResponse({ id: 'admin-1', role: 'admin', name: '管理員' }),
    setUserImpl: () => {},
  });
  const result = requireAdminSession(session);

  assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
  assert.equal(result.user.role, 'admin');
});

test('合法 student session 進入 admin 時回 FORBIDDEN 並保留登入資料', async () => {
  const persisted = {
    token: 'student-token',
    user: { id: 'student-1', role: 'student', name: '學生' },
  };
  const session = await restoreAuthSession({
    getTokenImpl: () => persisted.token,
    apiFetchImpl: async () => validResponse({ id: 'student-1', role: 'student', name: '學生' }),
    setUserImpl: (user) => { persisted.user = user; },
    clearTokenImpl: () => { persisted.token = null; },
    clearUserImpl: () => { persisted.user = null; },
  });
  const result = requireAdminSession(session);

  assert.equal(result.status, AUTH_SESSION_STATUS.FORBIDDEN);
  assert.equal(persisted.token, 'student-token');
  assert.equal(persisted.user.role, 'student');
});

test('合法 teacher session 進入 admin 時回 FORBIDDEN 並保留登入資料', async () => {
  const persisted = {
    token: 'teacher-token',
    user: { id: 'teacher-1', role: 'teacher', name: '教師' },
  };
  const session = await restoreAuthSession({
    getTokenImpl: () => persisted.token,
    apiFetchImpl: async () => validResponse({ id: 'teacher-1', role: 'teacher', name: '教師' }),
    setUserImpl: (user) => { persisted.user = user; },
    clearTokenImpl: () => { persisted.token = null; },
    clearUserImpl: () => { persisted.user = null; },
  });
  const result = requireAdminSession(session);

  assert.equal(result.status, AUTH_SESSION_STATUS.FORBIDDEN);
  assert.equal(persisted.token, 'teacher-token');
  assert.equal(persisted.user.role, 'teacher');
});

test('偽造 localStorage admin role 不可通過，且以後端 student session 覆寫並保留資料', async () => {
  const persisted = {
    token: 'student-token',
    user: { id: 'student-1', role: 'admin', name: '偽造管理員' },
  };
  const session = await restoreAuthSession({
    getTokenImpl: () => persisted.token,
    apiFetchImpl: async () => validResponse({ id: 'student-1', role: 'student', name: '學生' }),
    setUserImpl: (user) => { persisted.user = user; },
    clearTokenImpl: () => { persisted.token = null; },
    clearUserImpl: () => { persisted.user = null; },
  });
  const result = requireAdminSession(session);

  assert.equal(result.status, AUTH_SESSION_STATUS.FORBIDDEN);
  assert.equal(persisted.token, 'student-token');
  assert.deepEqual(persisted.user, { id: 'student-1', role: 'student', name: '學生' });
});

test('過期或無效 token 僅在 /auth/me 回 401/403 時清除登入資料', async () => {
  for (const status of [401, 403]) {
    const persisted = { token: 'invalid-token', user: { id: 'old-user' } };
    const result = await restoreAuthSession({
      getTokenImpl: () => persisted.token,
      apiFetchImpl: async () => { throw expiredTokenError(status); },
      clearTokenImpl: () => { persisted.token = null; },
      clearUserImpl: () => { persisted.user = null; },
    });

    assert.equal(result.status, AUTH_SESSION_STATUS.INVALID);
    assert.equal(persisted.token, null);
    assert.equal(persisted.user, null);
  }
});

test('5xx 或 network failure 保留登入資料，讓使用者可重試驗證', async () => {
  for (const error of [expiredTokenError(500), new TypeError('Failed to fetch')]) {
    const persisted = { token: 'still-valid-token', user: { id: 'current-user' } };
    const result = await restoreAuthSession({
      getTokenImpl: () => persisted.token,
      apiFetchImpl: async () => { throw error; },
      clearTokenImpl: () => { persisted.token = null; },
      clearUserImpl: () => { persisted.user = null; },
    });

    assert.equal(result.status, AUTH_SESSION_STATUS.UNAVAILABLE);
    assert.equal(persisted.token, 'still-valid-token');
    assert.deepEqual(persisted.user, { id: 'current-user' });
  }
});
