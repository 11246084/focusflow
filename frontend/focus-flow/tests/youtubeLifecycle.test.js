import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  applyQuarantineItem,
  buildCleanupEnableSummary,
  describeApplyConfirm,
  describeResetConfirm,
  describeSwitch,
  formatBytes,
  getCleanupPreview,
  getLifecycleSettings,
  getQuarantineControls,
  listQuarantine,
  lookupQuarantineItem,
  parseYouTubeVideoId,
  prepareSwitchChange,
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

describe('兩層開關的停用原因', () => {
  it('環境變數未允許時不可切換，並說明需改 VM 設定', () => {
    const view = describeSwitch({ key: 'cleanup', envAllowed: false, runtimeEnabled: true, effective: false, reason: 'env_disabled' });
    assert.equal(view.toggleable, false);
    assert.equal(view.effective, false);
    assert.match(view.note, /YOUTUBE_UPLOAD_CLEANUP_ENABLED/);
    assert.match(view.note, /環境未允許/);
  });

  it('未設定時依預設：上傳與恢復視為開啟，清理視為關閉', () => {
    const upload = describeSwitch({ key: 'upload', envAllowed: true, runtimeEnabled: null, effective: true, reason: null });
    const cleanup = describeSwitch({ key: 'cleanup', envAllowed: true, runtimeEnabled: null, effective: false, reason: 'default_off' });
    assert.equal(upload.unset, true);
    assert.match(upload.note, /預設為開啟/);
    assert.equal(upload.nextEnabled, false);
    assert.equal(cleanup.unset, true);
    assert.match(cleanup.note, /預設為關閉/);
    assert.equal(cleanup.nextEnabled, true);
  });

  it('管理員停用後顯示為未生效，按鈕改為啟用', () => {
    const view = describeSwitch({ key: 'recovery', envAllowed: true, runtimeEnabled: false, effective: false, reason: 'runtime_disabled' });
    assert.equal(view.toggleable, true);
    assert.equal(view.effective, false);
    assert.equal(view.nextEnabled, true);
    assert.match(view.note, /已由管理員停用/);
  });
});

describe('啟用清理的預告確認（#27①）', () => {
  it('啟用清理前先取 scope=enable 清單，摘要顯示支數與 GB', async () => {
    const scopes = [];
    const plan = await prepareSwitchChange(
      { key: 'cleanup', envAllowed: true, runtimeEnabled: null, effective: false },
      {
        fetchPreview: async (scope) => {
          scopes.push(scope);
          return {
            scope,
            count: 2,
            totalBytes: 3 * 1024 ** 3,
            items: [
              { kind: 'video', id: 'v1', title: 'week1', sizeBytes: 2 * 1024 ** 3, reason: 'max_age' },
              { kind: 'short_asset', id: 's1', title: 'short', sizeBytes: 1024 ** 3, reason: 'low_space' },
            ],
          };
        },
      },
    );
    assert.deepEqual(scopes, ['enable']);
    assert.equal(plan.enabled, true);
    assert.equal(plan.danger, true);
    assert.equal(plan.preview.items.length, 2);
    assert.equal(plan.summary, '啟用後會立即刪除 2 支（共 3.00 GB）原片，刪除後無法自動取回。');
  });

  it('預告取不到時不產生確認內容，避免在不知道影響範圍時啟用', async () => {
    await assert.rejects(
      prepareSwitchChange(
        { key: 'cleanup', envAllowed: true, runtimeEnabled: false, effective: false },
        { fetchPreview: async () => { throw new Error('preview failed'); } },
      ),
      /preview failed/,
    );
  });

  it('停用清理或切換其他開關不需要預告', async () => {
    let called = false;
    const fetchPreview = async () => { called = true; return {}; };
    const disableCleanup = await prepareSwitchChange({ key: 'cleanup', envAllowed: true, runtimeEnabled: true, effective: true }, { fetchPreview });
    const enableUpload = await prepareSwitchChange({ key: 'upload', envAllowed: true, runtimeEnabled: false, effective: false }, { fetchPreview });
    assert.equal(called, false);
    assert.equal(disableCleanup.enabled, false);
    assert.equal(disableCleanup.preview, null);
    assert.equal(enableUpload.enabled, true);
  });

  it('環境未允許的開關不能準備切換', async () => {
    await assert.rejects(
      prepareSwitchChange({ key: 'upload', envAllowed: false, runtimeEnabled: null, effective: false }),
      /環境未允許/,
    );
  });

  it('沒有符合條件的原片時說明不會立即刪除', () => {
    assert.match(buildCleanupEnableSummary({ count: 0, totalBytes: 0 }), /不會立即刪除/);
    assert.equal(formatBytes(1536 * 1024 ** 2), '1.50 GB');
    assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  });
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

describe('待處理清單的操作（#17）', () => {
  it('尚未查詢時顯示查詢按鈕，不顯示手動輸入', () => {
    const controls = getQuarantineControls({ searchable: null, lookup: null });
    assert.equal(controls.showLookup, true);
    assert.equal(controls.showManualInput, false);
  });

  it('憑證無法讀頻道時隱藏查詢、改為手動輸入', () => {
    assert.deepEqual(
      getQuarantineControls({ searchable: false, lookup: null }),
      { showLookup: false, showManualInput: true, matches: [] },
    );
    const afterLookup = getQuarantineControls({ searchable: null, lookup: { loading: false, searchable: false, matches: [] } });
    assert.equal(afterLookup.showLookup, false);
    assert.equal(afterLookup.showManualInput, true);
  });

  it('查到結果時列出供確認；查無結果時開放手動輸入', () => {
    const match = { youtubeVideoId: 'abcdefghijk', title: 'week3' };
    const found = getQuarantineControls({ lookup: { loading: false, searchable: true, matches: [match] } });
    assert.equal(found.showLookup, true);
    assert.equal(found.showManualInput, false);
    assert.deepEqual(found.matches, [match]);
    const none = getQuarantineControls({ lookup: { loading: false, searchable: true, matches: [] } });
    assert.equal(none.showManualInput, true);
  });

  it('確認文字說明系統會先驗證影片屬於自家頻道，重設文字警告重複上傳', () => {
    const item = { kind: 'video', id: 'v1', title: 'week3' };
    const apply = describeApplyConfirm(item, { youtubeVideoId: 'abcdefghijk', title: 'week3 lecture' });
    assert.match(apply.summary, /abcdefghijk/);
    assert.match(apply.summary, /屬於自家頻道/);
    assert.match(apply.detail, /week3 lecture/);
    assert.match(describeResetConfirm(item).summary, /兩支相同的影片/);
  });

  it('手動輸入接受影片 ID 與常見網址，其餘拒絕', () => {
    assert.equal(parseYouTubeVideoId(' dQw4w9WgXcQ '), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('https://studio.youtube.com/video/dQw4w9WgXcQ/edit'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeVideoId('short'), '');
    assert.equal(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
  });
});
