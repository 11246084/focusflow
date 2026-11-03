const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const { fetchWithRetry } = require('../src/utils/providerRequest');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

// 依序回傳每次呼叫的結果；函式代表丟出錯誤或延遲回應。
function scriptFetch(steps) {
  const calls = [];
  global.fetch = async (url, options) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ url, options });
    return typeof step === 'function' ? step(options) : { ok: step < 400, status: step };
  };
  return calls;
}

// 不回應直到被 signal 中止，用來模擬卡住的 API。
function hang(options) {
  return new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason));
  });
}

describe('外部模型 API 的逾時與重試', () => {
  it('暫時性錯誤後重試，成功就回傳成功的回應', async () => {
    const calls = scriptFetch([503, 429, 200]);

    const response = await fetchWithRetry('https://api.example/x', { method: 'POST', body: '{}' }, { timeoutMs: 1000, retries: 2 });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].options.body, '{}');
  });

  it('請求本身有問題（400、401、403）不重試', async () => {
    for (const status of [400, 401, 403]) {
      const calls = scriptFetch([status, 200]);

      const response = await fetchWithRetry('https://api.example/x', {}, { timeoutMs: 1000, retries: 2 });

      assert.equal(response.status, status);
      assert.equal(calls.length, 1);
    }
  });

  it('重試次數用完時回傳最後一次的錯誤回應，交給呼叫端處理', async () => {
    const calls = scriptFetch([503, 503, 503, 200]);

    const response = await fetchWithRetry('https://api.example/x', {}, { timeoutMs: 1000, retries: 2 });

    assert.equal(response.status, 503);
    assert.equal(calls.length, 3);
  });

  it('連線失敗也重試；用完次數才丟出錯誤', async () => {
    const recovered = scriptFetch([() => { throw new TypeError('fetch failed'); }, 200]);
    const response = await fetchWithRetry('https://api.example/x', {}, { timeoutMs: 1000, retries: 1 });
    assert.equal(response.status, 200);
    assert.equal(recovered.length, 2);

    scriptFetch([() => { throw new TypeError('fetch failed'); }]);
    await assert.rejects(fetchWithRetry('https://api.example/x', {}, { timeoutMs: 1000, retries: 1 }), /fetch failed/);
  });

  it('卡住的請求在逾時後中止並重試，不會一直等下去', async () => {
    const calls = scriptFetch([hang, 200]);
    const startedAt = Date.now();

    const response = await fetchWithRetry('https://api.example/x', {}, { timeoutMs: 50, retries: 1 });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - startedAt < 1000);
  });

  it('每次都逾時時丟出 TimeoutError', async () => {
    scriptFetch([hang]);

    await assert.rejects(
      fetchWithRetry('https://api.example/x', {}, { timeoutMs: 30, retries: 1 }),
      { name: 'TimeoutError' },
    );
  });
});
