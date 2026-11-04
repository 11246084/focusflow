const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const http = require('node:http');
const { once, getEventListeners } = require('node:events');
const { spawnSync } = require('node:child_process');
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
  // AbortSignal.timeout is unref'ed. Model a pending transport with a bounded
  // ref timer, without giving production or the whole test runner a keepalive.
  let watchdog, onAbort;
  return new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error('timeout signal did not fire')), 1500);
    onAbort = () => reject(options.signal.reason);
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) onAbort();
  }).finally(() => {
    clearTimeout(watchdog);
    options.signal.removeEventListener('abort', onAbort);
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

  for (const cancelMode of ['throws', 'never-settles']) it(`重試直接中止廢棄transport，不等待不可靠的body.cancel：${cancelMode}`, async () => {
    let cancelCalls = 0;
    const calls = scriptFetch([(options) => ({ status: 503, body: { cancel() {
      cancelCalls++;
      if (cancelMode === 'throws') throw new Error('synthetic cleanup failure');
      return new Promise(() => {});
    } } }), 200]);
    const response = await fetchWithRetry('https://api.example/x', {}, { timeoutMs: 1000, retries: 1 });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.signal.aborted, true);
    assert.equal(calls[1].options.signal.aborted, false);
    assert.equal(cancelCalls, 0);
  });

  it('外部signal在請求中取消時保留原原因且不重試', async () => {
    const controller = new AbortController(), reason = new Error('synthetic caller cancellation');
    const calls = scriptFetch([hang, 200]);
    const timer = setTimeout(() => controller.abort(reason), 20);
    try {
      await assert.rejects(fetchWithRetry('https://api.example/x', { signal: controller.signal }, { timeoutMs: 1000, retries: 2 }),
        (error) => error === reason);
      assert.equal(calls.length, 1);
    } finally { clearTimeout(timer); }
  });

  it('外部signal可取消backoff，清除listener且不送下一次請求', async () => {
    const controller = new AbortController(), reason = new Error('synthetic backoff cancellation');
    const calls = scriptFetch([503, 200]);
    const timer = setTimeout(() => controller.abort(reason), 20);
    try {
      await assert.rejects(fetchWithRetry('https://api.example/x', { signal: controller.signal }, { timeoutMs: 1000, retries: 2, retryDelayMs: 500 }),
        (error) => error === reason);
      assert.equal(calls.length, 1);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally { clearTimeout(timer); }
  });

  it('已取消的外部signal不建立請求', async () => {
    const controller = new AbortController(), reason = new Error('synthetic already cancelled');
    controller.abort(reason);
    const calls = scriptFetch([200]);
    await assert.rejects(fetchWithRetry('https://api.example/x', { signal: controller.signal }, { timeoutMs: 1000, retries: 2 }),
      (error) => error === reason);
    assert.equal(calls.length, 0);
  });

  it('失敗與重試結束後不遺留長效ref timer，成功body deadline也不強留process', () => {
    const helper = require.resolve('../src/utils/providerRequest');
    const script = `
      const { fetchWithRetry } = require(${JSON.stringify(helper)});
      let calls = 0;
      global.fetch = async () => {
        if (++calls === 1) return { status: 503 };
        throw new Error('synthetic final request failure');
      };
      (async () => {
        try { await fetchWithRetry('https://synthetic.invalid', {}, { timeoutMs: 60000, retries: 1 }); }
        catch (error) { if (error.message !== 'synthetic final request failure') throw error; }
        global.fetch = async () => ({ status: 200 });
        await fetchWithRetry('https://synthetic.invalid', {}, { timeoutMs: 60000 });
        process.stdout.write('completed');
      })().catch(() => { process.exitCode = 1; });
    `;
    const child = spawnSync(process.execPath, ['-e', script], { env: {}, encoding: 'utf8', timeout: 3000, windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, 'completed');
  });
});

async function loopback(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('synthetic local HTTP did not close in time')), ms);
  })]); } finally { clearTimeout(timer); }
}

describe('外部模型重試的原生loopback transport生命週期', () => {
  for (const status of [503, 429]) it(`${status} headers後body卡住，重試成功前後會關閉廢棄transport`, { timeout: 4000 }, async (t) => {
    let calls = 0, closed = false, resolveClosed;
    const firstClosed = new Promise((resolve) => { resolveClosed = resolve; });
    const url = await loopback(t, (_request, response) => {
      calls++;
      if (calls === 1) {
        response.once('close', () => { closed = true; resolveClosed(); });
        response.writeHead(status);
        response.write('synthetic unfinished response');
      } else { response.writeHead(200); response.end('synthetic success'); }
    });
    const response = await fetchWithRetry(url, {}, { timeoutMs: 300, retries: 1 });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'synthetic success');
    await within(firstClosed, 1000);
    assert.equal(closed, true);
    assert.equal(calls, 2);
  });

  it('成功headers之後body仍受同一次deadline限制', { timeout: 4000 }, async (t) => {
    let requestSignal;
    global.fetch = (url, options) => { requestSignal = options.signal; return originalFetch(url, options); };
    const url = await loopback(t, (_request, response) => {
      response.writeHead(200);
      response.write('synthetic stalled success');
    });
    const response = await fetchWithRetry(url, {}, { timeoutMs: 100 });
    assert.equal(requestSignal.aborted, false);
    await assert.rejects(response.text(), (error) => ['AbortError', 'TimeoutError'].includes(error.name));
    assert.equal(requestSignal.aborted, true);
    assert.equal(requestSignal.reason.name, 'TimeoutError');
  });

  it('成功headers返回後仍保留外部signal，body可由caller中止', { timeout: 4000 }, async (t) => {
    const controller = new AbortController();
    const url = await loopback(t, (_request, response) => {
      response.writeHead(200);
      response.write('synthetic stalled success');
    });
    const response = await fetchWithRetry(url, { signal: controller.signal }, { timeoutMs: 1000 });
    const body = response.text();
    controller.abort(new Error('synthetic caller stopped reading'));
    await assert.rejects(body);
  });
});
