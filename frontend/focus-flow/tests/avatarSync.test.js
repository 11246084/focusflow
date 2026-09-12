import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  fetchCurrentUserAvatarObjectUrl,
  createAvatarUrlController,
  getAvatarVersion,
  revokeAvatarObjectUrl,
} from '../src/utils/avatarImage.js';
import { applyProfileUserUpdate } from '../src/utils/profileUser.js';

const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

describe('Topbar 頭貼同步工具', () => {
  it('沒有頭貼時維持 fallback，且不產生 avatar version', () => {
    assert.equal(getAvatarVersion({ id: 'user-1', hasAvatar: false }), null);
  });

  it('有頭貼時以 Bearer token、no-store 取得並建立 Blob URL', async () => {
    const calls = [];
    const url = await fetchCurrentUserAvatarObjectUrl({
      token: 'student-token',
      fetchImpl: async (...args) => {
        calls.push(args);
        return {
          ok: true,
          headers: { get: () => 'image/png' },
          blob: async () => new Blob(['avatar']),
        };
      },
      createObjectUrl: (blob) => {
        assert.equal(blob instanceof Blob, true);
        return 'blob:avatar-1';
      },
    });

    assert.equal(url, 'blob:avatar-1');
    const [requestUrl, options] = calls[0];
    assert.equal(requestUrl, 'http://localhost:4000/api/v1/auth/me/avatar');
    assert.equal(options.headers.Authorization, 'Bearer student-token');
    assert.equal(options.cache, 'no-store');
  });

  it('avatarUpdatedAt 改變時產生新版本鍵，供 Topbar 重新取得頭貼', () => {
    const before = getAvatarVersion({ id: 'user-1', hasAvatar: true, avatarUpdatedAt: '2026-09-13T00:00:00.000Z' });
    const after = getAvatarVersion({ id: 'user-1', hasAvatar: true, avatarUpdatedAt: '2026-09-13T00:01:00.000Z' });

    assert.notEqual(before, after);
  });

  it('頭貼讀取失敗時回傳 null，讓 Topbar 維持 fallback 且不觸碰 session', async () => {
    const url = await fetchCurrentUserAvatarObjectUrl({
      token: 'still-valid-token',
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
      createObjectUrl: () => { throw new Error('should not create URL'); },
    });

    assert.equal(url, null);
  });

  it('200 但非圖片回應時不建立 Blob URL，維持 fallback', async () => {
    let created = false;
    const url = await fetchCurrentUserAvatarObjectUrl({
      token: 'still-valid-token',
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        blob: async () => new Blob(['proxy error']),
      }),
      createObjectUrl: () => { created = true; return 'blob:unexpected'; },
    });

    assert.equal(url, null);
    assert.equal(created, false);
  });

  it('替換或卸載時可釋放既有 Blob URL', () => {
    const revoked = [];
    revokeAvatarObjectUrl('blob:old-avatar', (url) => revoked.push(url));
    revokeAvatarObjectUrl(null, (url) => revoked.push(url));

    assert.deepEqual(revoked, ['blob:old-avatar']);
  });

  it('舊帳號的延遲 request 不可覆蓋新帳號頭貼，且舊 URL 必須釋放', async () => {
    const resolvers = [];
    const revoked = [];
    const controller = createAvatarUrlController({
      fetchAvatar: () => new Promise((resolve) => resolvers.push(resolve)),
      revokeAvatar: (url) => revoked.push(url),
    });

    const userA = controller.load({ hasAvatar: true });
    const userB = controller.load({ hasAvatar: true });
    resolvers[1]('blob:user-b');
    assert.equal(await userB, 'blob:user-b');
    resolvers[0]('blob:user-a');
    assert.equal(await userA, null);

    assert.deepEqual(revoked, ['blob:user-a']);
  });

  it('logout 或下一位無頭貼使用者會釋放舊 URL，且不再發新 request', async () => {
    let requestCount = 0;
    const revoked = [];
    const controller = createAvatarUrlController({
      fetchAvatar: async () => {
        requestCount += 1;
        return 'blob:user-a';
      },
      revokeAvatar: (url) => revoked.push(url),
    });

    assert.equal(await controller.load({ hasAvatar: true }), 'blob:user-a');
    controller.cancel();
    assert.equal(await controller.load({ hasAvatar: false }), null);

    assert.equal(requestCount, 1);
    assert.deepEqual(revoked, ['blob:user-a']);
  });

  it('圖片 decode 失敗時可只釋放目前 URL 並回到 fallback', async () => {
    const revoked = [];
    const controller = createAvatarUrlController({
      fetchAvatar: async () => 'blob:broken-avatar',
      revokeAvatar: (url) => revoked.push(url),
    });

    const url = await controller.load({ hasAvatar: true });
    assert.equal(controller.release(url), true);
    assert.equal(controller.release(url), false);
    assert.deepEqual(revoked, ['blob:broken-avatar']);
  });
});

describe('Profile 使用者同步', () => {
  it('頭貼更新後同步 Profile local state、Dashboard callback 與 ff_user', () => {
    const updatedUser = {
      id: 'student-1',
      name: '學生',
      hasAvatar: true,
      avatarUpdatedAt: '2026-09-13T00:01:00.000Z',
    };
    const profileUsers = [];
    const dashboardStateUsers = [];
    const dashboardUsers = [];
    globalThis.localStorage = {
      setItem(key, value) {
        if (key === 'ff_user') dashboardUsers.push(JSON.parse(value));
      },
    };

    const onProfileUpdated = (user) => {
      dashboardStateUsers.push(user);
      localStorage.setItem('ff_user', JSON.stringify(user));
    };
    const applied = applyProfileUserUpdate({
      user: updatedUser,
      setCurrentUser: (user) => profileUsers.push(user),
      onProfileUpdated,
    });

    assert.equal(applied, true);
    assert.deepEqual(profileUsers, [updatedUser]);
    assert.deepEqual(dashboardStateUsers, [updatedUser]);
    assert.deepEqual(dashboardUsers, [updatedUser]);
  });
});
