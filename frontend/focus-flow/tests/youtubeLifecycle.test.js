import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  applyQuarantineItem,
  getCleanupPreview,
  getLifecycleSettings,
  listQuarantine,
  lookupQuarantineItem,
  resetQuarantineItem,
  runRecoveryNow,
  updateLifecycleSwitch,
} from '../src/services/youtubeLifecycle.js';

const BASE = 'http://localhost:4000/api/v1';
const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return calls;
}

beforeEach(() => {
  globalThis.localStorage = { getItem: (key) => (key === 'ff_token' ? 'admin-token' : null) };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

describe('YouTube 生命週期 API 呼叫', () => {
  it('讀取與切換開關、預告與立即恢復都打到約定路徑', async () => {
    const calls = mockFetch(async () => response({ success: true, data: { switches: [], history: [], runtime: {} } }));
    await getLifecycleSettings();
    await updateLifecycleSwitch('cleanup', true);
    await getCleanupPreview('upcoming');
    await runRecoveryNow();

    assert.equal(calls[0].url, `${BASE}/admin/youtube-lifecycle/settings`);
    assert.equal(calls[1].url, `${BASE}/admin/youtube-lifecycle/settings`);
    assert.equal(calls[1].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[1].options.body), { key: 'cleanup', enabled: true });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer admin-token');
    assert.equal(calls[2].url, `${BASE}/admin/youtube-lifecycle/cleanup-preview?scope=upcoming`);
    assert.equal(calls[3].url, `${BASE}/admin/youtube-lifecycle/recovery/run`);
    assert.equal(calls[3].options.method, 'POST');
  });

  it('待處理三動作依類型使用 videos 或 short-assets 路徑', async () => {
    const calls = mockFetch(async () => response({ success: true, data: { searchable: true, matches: [] } }));
    await lookupQuarantineItem('video', 'v1');
    await applyQuarantineItem('short_asset', 's1', 'dQw4w9WgXcQ');
    await resetQuarantineItem('video', 'v1');

    assert.equal(calls[0].url, `${BASE}/admin/youtube-quarantine/videos/v1/lookup`);
    assert.equal(calls[1].url, `${BASE}/admin/youtube-quarantine/short-assets/s1/apply`);
    assert.deepEqual(JSON.parse(calls[1].options.body), { youtubeVideoId: 'dQw4w9WgXcQ' });
    assert.equal(calls[2].url, `${BASE}/admin/youtube-quarantine/videos/v1/reset`);
    assert.ok(calls.every((call) => call.options.method === 'POST'));
    await assert.rejects(lookupQuarantineItem('unknown', 'x'), /未知的項目類型/);
  });

  it('待處理清單沒有附 searchable 時視為未知', async () => {
    mockFetch(async (url, options, n) => response({
      success: true,
      data: n === 1 ? { items: [{ kind: 'video', id: 'v1' }] } : { items: [], searchable: false },
    }));
    assert.deepEqual(await listQuarantine(), { items: [{ kind: 'video', id: 'v1' }], searchable: null });
    assert.deepEqual(await listQuarantine(), { items: [], searchable: false });
  });

  it('後端錯誤轉成帶錯誤碼的例外', async () => {
    mockFetch(async () => response(
      { success: false, message: 'Not allowed.', error: { code: 'YOUTUBE_UPLOAD_RETRY_UNSAFE' } },
      { ok: false, status: 409 },
    ));
    await assert.rejects(resetQuarantineItem('video', 'v1'), (error) => error.code === 'YOUTUBE_UPLOAD_RETRY_UNSAFE' && error.status === 409);
  });
});
