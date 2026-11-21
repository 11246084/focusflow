import test from 'node:test';
import assert from 'node:assert/strict';

import { toChineseErrorMessage } from '../src/utils/errorMessages.js';
import { navItems, topbarMap, isValidSubPage } from '../src/components/navigationConfig.js';
import { buildPath, readRoute, resolveSubForRole } from '../src/utils/pageRouting.js';
import {
  activateGeminiKey, canActivate, describeCheck, fetchGeminiKeyStatus, needsStepUp, stepUpAdmin, testGeminiKey,
} from '../src/services/geminiKey.js';

const KEY = 'AIzaFrontendCandidate_0123456789abcd';

test('Gemini 金鑰頁只給管理員，並有側欄、標題與 /admin/gemini-key 網址', () => {
  assert.ok(navItems.admin.some((item) => item.id === 'geminiKey'));
  assert.ok(topbarMap.admin.geminiKey);
  assert.equal(isValidSubPage('teacher', 'geminiKey'), false);
  assert.equal(resolveSubForRole('student', 'geminiKey'), 'home');
  assert.equal(buildPath('/admin', 'app', 'geminiKey'), '/admin/gemini-key');
  assert.deepEqual(readRoute('/admin', '/admin/gemini-key'), { page: 'app', sub: 'geminiKey' });
});

test('API 呼叫只把金鑰放在 POST body，且不寫入瀏覽器儲存', async () => {
  const writes = [];
  const storage = { setItem: (...args) => writes.push(args), getItem: () => null, removeItem: () => {} };
  globalThis.localStorage = storage; globalThis.sessionStorage = storage;
  const calls = [];
  const fetcher = async (path, options = {}) => { calls.push({ path, options }); return { data: { ok: true } }; };
  try {
    await fetchGeminiKeyStatus(fetcher);
    await stepUpAdmin('Admin123!', fetcher);
    await testGeminiKey(KEY, fetcher);
    await activateGeminiKey(KEY, 'test-id', fetcher);
  } finally { delete globalThis.localStorage; delete globalThis.sessionStorage; }
  assert.deepEqual(calls.map((call) => [call.path, call.options.method || 'GET']), [
    ['/admin/gemini-key', 'GET'], ['/auth/step-up', 'POST'], ['/admin/gemini-key/test', 'POST'], ['/admin/gemini-key/activate', 'POST']]);
  assert.equal(calls[1].options.sessionFailure, false);
  assert.deepEqual(JSON.parse(calls[2].options.body), { apiKey: KEY });
  assert.deepEqual(JSON.parse(calls[3].options.body), { apiKey: KEY, testId: 'test-id' });
  assert.ok(calls.every((call) => !call.path.includes(KEY)));
  assert.deepEqual(writes, []);
});

test('只有未過期的測試結果可以啟用；STEP_UP_REQUIRED 會要求輸入密碼', () => {
  const now = Date.parse('2026-11-21T00:00:00Z');
  assert.equal(canActivate(null, now), false);
  assert.equal(canActivate({ testId: 'a', expiresAt: '2026-11-21T00:05:00Z' }, now), true);
  assert.equal(canActivate({ testId: 'a', expiresAt: '2026-11-20T23:59:59Z' }, now), false);
  assert.equal(needsStepUp({ code: 'STEP_UP_REQUIRED' }), true);
  assert.equal(needsStepUp({ code: 'GEMINI_KEY_REJECTED' }), false);
  assert.equal(describeCheck({ check: 'embedding', model: 'gemini-embedding-2', dimensions: 3072 }), '向量 gemini-embedding-2：通過（3072 維）');
});

test('兩種 429 分別說明是 Google 配額還是本站次數限制，並顯示等待時間', () => {
  const provider = toChineseErrorMessage({ code: 'GEMINI_KEY_PROVIDER_RATE_LIMITED', status: 429,
    details: { check: 'generation', model: 'gemini-3.5-flash', reason: 'rate_limited', retryAfterSec: 30 } });
  assert.match(provider, /文字生成檢查（gemini-3\.5-flash）/);
  assert.match(provider, /限流或配額已用完/);
  assert.match(provider, /約 30 秒後再試/);
  assert.match(provider, /目前使用中的金鑰沒有變更/);
  const noDelay = toChineseErrorMessage({ code: 'GEMINI_KEY_PROVIDER_RATE_LIMITED', status: 429, details: { check: 'embedding', model: 'gemini-embedding-2', retryAfterSec: null } });
  assert.doesNotMatch(noDelay, /建議約/);
  assert.equal(toChineseErrorMessage({ code: 'GEMINI_KEY_ADMIN_RATE_LIMITED', status: 429, details: { retryAfterSec: 125, action: 'test' } }),
    '測試或啟用金鑰的次數太頻繁，請約 3 分鐘後再試。');
});

test('金鑰錯誤碼都有中文說明，未知 429 仍有通用訊息', () => {
  for (const code of ['GEMINI_KEY_REJECTED', 'GEMINI_KEY_PERMISSION_DENIED', 'GEMINI_KEY_MODEL_UNAVAILABLE', 'GEMINI_KEY_PROBE_INVALID_RESPONSE',
    'GEMINI_KEY_PROBE_UNAVAILABLE', 'GEMINI_KEY_OPERATION_IN_PROGRESS', 'GEMINI_KEY_TEST_REQUIRED', 'GEMINI_KEY_TEST_MISMATCH',
    'GEMINI_KEY_TEST_STALE', 'GEMINI_KEY_CHANGED_CONCURRENTLY', 'GEMINI_KEY_ROTATION_UNAVAILABLE', 'GEMINI_KEY_STORAGE_FAILED',
    'GEMINI_KEY_FORMAT_INVALID', 'GEMINI_MODEL_CONFIG_INVALID', 'INVALID_REQUEST_BODY']) {
    assert.match(toChineseErrorMessage({ code, status: 400, message: 'English' }), /[㐀-鿿]/, code);
  }
  assert.equal(toChineseErrorMessage({ status: 429 }), '操作太頻繁，請稍後再試。');
});
