'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHttpClient } = require('../src/worker/http');
const { SHORT_RENDER_VERSION, ASSET_VERSIONS } = require('../src/plan/runtime');
const key = `rw_${'a'.repeat(24)}.${'b'.repeat(43)}`; // Synthetic test key only.
const job = { jobId: 'c'.repeat(24), leaseToken: 'd'.repeat(43), downloadUrl: 'https://untrusted.invalid/source' };
function client(fetchImpl, extra = {}) {
  return createHttpClient({ backendUrl: 'https://backend.invalid', getWorkerKey: async () => key, fetchImpl, ...extra });
}
test('claim只帶固定renderer與素材版本，worker身份由專用Bearer認證', async () => {
  const api = client(async (url, options) => {
    assert.equal(url, 'https://backend.invalid/api/v1/recut-worker/jobs/claim');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(JSON.parse(options.body), { shortRenderVersion: SHORT_RENDER_VERSION, assetVersions: ASSET_VERSIONS });
    return Response.json({ success: true, data: null });
  });
  assert.equal(await api.claim(), null);
});
test('原片下載只走受限同origin路由，忽略jobURL與回應檔名', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'source.mp4');
  const api = client(async (url, options) => {
    assert.equal(url, `https://backend.invalid/api/v1/recut-worker/jobs/${job.jobId}/source`);
    assert.equal(options.headers['X-Recut-Lease'], job.leaseToken);
    return new Response('synthetic', { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="../../unsafe.mp4"' } });
  });
  await api.download(job, destination); assert.equal(await fs.readFile(destination, 'utf8'), 'synthetic');
  assert.deepEqual(await fs.readdir(root), ['source.mp4']);
});
test('串流下載超過上限即停止，不能用缺少Content-Length繞過', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const api = client(async () => new Response('too-big', { headers: { 'Content-Type': 'video/mp4' } }), { maxDownloadBytes: 3 });
  await assert.rejects(api.download(job, path.join(root, 'source.mp4')), { code: 'RECUT_SOURCE_TOO_LARGE' });
});
for (const [name, response] of [
  ['HTML來源', () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })],
  ['來源宣告過大', () => new Response('x', { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '999' } })],
  ['空來源', () => new Response('', { headers: { 'Content-Type': 'video/mp4' } })],
]) test(`${name}不會作為渲染原片`, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(client(async () => response(), { maxDownloadBytes: 10 }).download(job, path.join(root, 'source.mp4')), { code: 'RECUT_SOURCE_INVALID' });
});
test('所有路徑拒絕jobId穿越與URL注入且尚未呼叫HTTP', async () => {
  let called = false; const api = client(async () => { called = true; });
  for (const jobId of ['../escape', 'https://evil.invalid', '%2f', 'a'.repeat(23)]) {
    assert.throws(() => api.heartbeat({ ...job, jobId }), { code: 'RECUT_JOB_INVALID' });
  }
  assert.equal(called, false);
});
test('backendURL必須是HTTPS origin或明確localhost，拒絕外站明文與URL憑證', () => {
  for (const backendUrl of ['http://backend.invalid', 'https://user:secret@backend.invalid', 'https://backend.invalid/path', 'https://backend.invalid?target=x']) {
    assert.throws(() => client(async () => {}, { backendUrl }), { code: 'RECUT_BACKEND_URL_INVALID' });
  }
  assert.doesNotThrow(() => client(async () => {}, { backendUrl: 'http://127.0.0.1:3000' }));
});
test('redirect設定error，不把Bearer交給不受信downloadtarget', async () => {
  const api = client(async (_url, options) => { assert.equal(options.redirect, 'error'); throw new TypeError('redirect to https://evil.invalid'); });
  await assert.rejects(api.download(job, 'never-written.mp4'), { code: 'RECUT_NETWORK_ERROR' });
});
test('multipart結果帶video與metadata，不改用教師asset API', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'result.mp4'); await fs.writeFile(file, 'synthetic');
  const metadata = { planVersion: 'recut-v1', renderDurationMs: 123, versionId: 'e'.repeat(24) };
  const api = client(async (url, options) => {
    assert(url.endsWith(`/${job.jobId}/result`)); assert.equal(options.headers['Content-Type'], undefined);
    assert.deepEqual(JSON.parse(options.body.get('metadata')), metadata);
    assert.equal(options.body.get('video').name, 'result.mp4'); assert.equal(await options.body.get('video').text(), 'synthetic');
    return Response.json({ success: true, data: { assetId: 'f'.repeat(24) } }, { status: 201 });
  });
  assert.equal((await api.upload(job, file, metadata)).assetId, 'f'.repeat(24));
});
test('錯誤只傳安全code，不轉印上游token/path/message', async () => {
  const api = client(async () => Response.json({ error: { code: 'RECUT_LEASE_INVALID', message: 'private-token-or-path' } }, { status: 409 }));
  await assert.rejects(api.heartbeat(job), (error) => error.code === 'RECUT_LEASE_INVALID' && !error.message.includes('private'));
});
test('request timeout取消fetch，不無限等待', async () => {
  // A timer keeps this fake transport alive just like a real pending socket.
  const api = client(async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake transport stalled')), 1000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }), { requestTimeoutMs: 15 });
  await assert.rejects(api.heartbeat(job), { code: 'RECUT_REQUEST_TIMEOUT_OR_CANCELLED' });
});
function slowStream(chunks, gapMs, { stallAfter = Infinity } = {}) {
  let sent = 0, timer;
  return new ReadableStream({
    pull(controller) {
      if (sent >= stallAfter) return new Promise(() => {});
      return new Promise((resolve) => { timer = setTimeout(() => {
        if (sent < chunks) { controller.enqueue(new TextEncoder().encode('x'.repeat(8))); sent++; }
        if (sent >= chunks) controller.close();
        resolve();
      }, gapMs); });
    },
    cancel() { clearTimeout(timer); },
  });
}
test('下載只要資料持續進來就不受總時限中斷：總時間超過request timeout仍完成', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'source.mp4');
  // 8 段、每段間隔 30ms，總長約 240ms；逾時設 100ms（舊的總時限做法一定中斷）。
  const api = client(async () => new Response(slowStream(8, 30), { headers: { 'Content-Type': 'video/mp4' } }), { requestTimeoutMs: 100 });
  await api.download(job, destination);
  assert.equal((await fs.stat(destination)).size, 64);
});
test('下載中途完全沒有資料超過request timeout即中止，回報逾時而不是渲染失敗', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const keeper = setTimeout(() => {}, 2000); t.after(() => clearTimeout(keeper));
  const api = client(async () => new Response(slowStream(8, 5, { stallAfter: 2 }), { headers: { 'Content-Type': 'video/mp4' } }), { requestTimeoutMs: 60 });
  const started = Date.now();
  await assert.rejects(api.download(job, path.join(root, 'source.mp4')), { code: 'RECUT_REQUEST_TIMEOUT_OR_CANCELLED' });
  assert.ok(Date.now() - started < 1500);
});
test('上傳時限依檔案大小放寬：超過request timeout才回應的上傳仍成功', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-http-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'final.mp4'); await fs.writeFile(file, 'synthetic-output');
  const api = client(async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ success: true, data: { assetId: 'd'.repeat(24) } })), 120);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }), { requestTimeoutMs: 30 });
  assert.deepEqual(await api.upload(job, file, {}), { assetId: 'd'.repeat(24) });
});
test('注入的金鑰provider卡住也受request timeout約束', async () => {
  const keeper = setTimeout(() => {}, 1000);
  try {
    const api = client(() => assert.fail('must not fetch'), { getWorkerKey: () => new Promise(() => {}), requestTimeoutMs: 15 });
    await assert.rejects(api.claim(), { code: 'RECUT_REQUEST_TIMEOUT_OR_CANCELLED' });
  } finally { clearTimeout(keeper); }
});
