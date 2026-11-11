'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./sentence.fixture');
const { createWorker, jobPlanHash } = require('../src/worker/client');
const { SHORT_RENDER_VERSION, ASSET_VERSIONS } = require('../src/plan/runtime');
const { workerError } = require('../src/worker/http');
function claimed() {
  const { plan, source } = fixture();
  const job = { jobId: 'a'.repeat(24), scriptId: 'b'.repeat(24), versionId: 'c'.repeat(24), plan, source,
    shortRenderVersion: SHORT_RENDER_VERSION, assetVersions: { ...ASSET_VERSIONS }, leaseToken: 'x'.repeat(43),
    leaseExpiresAt: new Date(Date.now() + 600000).toISOString() };
  job.planHash = jobPlanHash(job); return job;
}
const passing = () => ({ videoTracks: 1, audioTracks: 1, width: 720, height: 1280, fps: 30,
  durationSec: 30, blackMaxSec: 0, silenceMaxSec: 0, integratedLufs: -16, truePeakDbtp: -2, fontLoaded: true });
async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-worker-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const job = claimed(), calls = [], failure = [], uploads = [];
  let tick, loads = 0;
  const api = {
    claim: async () => { calls.push('claim'); return job; },
    heartbeat: async () => { calls.push('heartbeat'); return { leaseExpiresAt: new Date(Date.now() + 600000).toISOString() }; },
    download: async (_job, destination) => { calls.push('download'); await fs.writeFile(destination, 'synthetic-source'); },
    fail: async (_job, data) => { calls.push('failure'); failure.push(data); },
    upload: async (_job, file, metadata) => { calls.push('upload'); uploads.push(metadata); assert.equal(await fs.readFile(file, 'utf8'), 'synthetic-output'); return { assetId: 'd'.repeat(24) }; },
    ...overrides.api,
  };
  const renderer = overrides.renderer || (async ({ job: frozen, outDir }) => {
    calls.push('render'); assert(Object.isFrozen(frozen.plan.audio));
    const filePath = path.join(outDir, 'final.mp4'); await fs.writeFile(filePath, 'synthetic-output');
    return { filePath, checks: passing() };
  });
  const worker = createWorker({ workRoot: root, jobTimeoutMs: 10000, ...overrides.config }, {
    api, loadRenderer: async () => { loads++; return renderer; },
    setIntervalImpl: (callback) => { tick = callback; return 1; }, clearIntervalImpl: () => {}, ...overrides.dependencies,
  });
  return { worker, job, root, calls, failure, uploads, get loads() { return loads; }, heartbeat: () => tick() };
}
test('單工完成：核對凍結版本、下載、惰性渲染、最後心跳、上傳並清暫存', async (t) => {
  const s = await setup(t);
  assert.equal((await s.worker.runOnce()).status, 'succeeded');
  assert.deepEqual(s.calls, ['claim', 'download', 'render', 'heartbeat', 'upload']);
  assert.equal(s.loads, 1); assert.equal(s.uploads[0].planVersion, 'recut-v1');
  assert.equal(s.uploads[0].planHash, s.job.planHash); assert(s.uploads[0].renderDurationMs >= 0);
  assert.deepEqual(await fs.readdir(s.root), []);
});
test('暫停或空佇列不載入renderer', async (t) => {
  const s = await setup(t, { api: { claim: async () => null } });
  assert.deepEqual(await s.worker.runOnce(), { status: 'idle' }); assert.equal(s.loads, 0);
});
test('VM渲染預設關閉，沒有主動claim', async (t) => {
  const s = await setup(t, { config: { hostKind: 'vm' } });
  assert.deepEqual(await s.worker.runOnce(), { status: 'disabled' }); assert.deepEqual(s.calls, []);
});
for (const [name, mutate, code] of [
  ['renderer版本不符顯示需升級', (j) => { j.shortRenderVersion = 'newer'; }, 'RECUT_RENDER_VERSION_MISMATCH'],
  ['素材版本不符', (j) => { j.assetVersions['@phosphor-icons/core'] = 'newer'; }, 'RECUT_RENDER_VERSION_MISMATCH'],
  ['施工單hash不符', (j) => { j.planHash = '0'.repeat(64); }, 'RECUT_PLAN_HASH_MISMATCH'],
  ['凍結gain遭修改', (j) => { j.plan.audio.gainDb += 1; j.planHash = jobPlanHash(j); }, 'RECUT_PLAN_INVALID'],
  ['凍結來源與plan不同', (j) => { j.source.videoId = 'another'; }, 'RECUT_SOURCE_MISMATCH'],
  ['jobId路徑穿越', (j) => { j.jobId = '../outside'; }, 'RECUT_JOB_INVALID'],
]) test(`${name}：未下載或渲染`, async (t) => {
  const s = await setup(t); mutate(s.job);
  assert.equal((await s.worker.runOnce()).code, code); assert.equal(s.loads, 0); assert(!s.calls.includes('download'));
});
test('已過期租約不渲染、不交成品、不以failure覆寫新owner', async (t) => {
  const s = await setup(t); s.job.leaseExpiresAt = new Date(Date.now() - 1).toISOString();
  assert.equal((await s.worker.runOnce()).code, 'RECUT_LEASE_INVALID'); assert.equal(s.loads, 0); assert.equal(s.failure.length, 0);
});
test('每60秒心跳持續延長租約', async (t) => {
  let s;
  s = await setup(t, { renderer: async ({ outDir }) => {
    s.heartbeat(); await new Promise((resolve) => setImmediate(resolve));
    const filePath = path.join(outDir, 'final.mp4'); await fs.writeFile(filePath, 'synthetic-output');
    return { filePath, checks: passing() };
  } });
  assert.equal((await s.worker.runOnce()).status, 'succeeded');
  assert.equal(s.calls.filter((c) => c === 'heartbeat').length, 2);
});
test('心跳遭拒中止renderer，不上傳、不回報舊failure，清除暫存', async (t) => {
  let s;
  s = await setup(t, { api: { heartbeat: async () => { throw workerError('RECUT_LEASE_INVALID', 409); } },
    renderer: async ({ signal }) => { s.heartbeat(); await new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  assert.equal((await s.worker.runOnce()).code, 'RECUT_LEASE_INVALID');
  assert.equal(s.uploads.length, 0); assert.equal(s.failure.length, 0); assert.deepEqual(await fs.readdir(s.root), []);
});
for (const mode of ['cancel', 'timeout']) test(`${mode}停止工作並把偶發失敗交後端重派`, async (t) => {
  const controller = new AbortController();
  const s = await setup(t, { config: { jobTimeoutMs: mode === 'timeout' ? 20 : 10000 },
    renderer: async ({ signal }) => {
      if (mode === 'cancel') setImmediate(() => controller.abort());
      await new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
  assert.equal((await s.worker.runOnce({ signal: controller.signal })).status, 'cancelled');
  assert.equal(s.failure[0].code, 'RECUT_RENDER_TRANSIENT'); assert.equal(s.uploads.length, 0);
  assert.deepEqual(await fs.readdir(s.root), []);
});
test('同一worker不能同時領第二個任務', async (t) => {
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const s = await setup(t, { renderer: async () => { entered(); await new Promise((resolve) => { release = resolve; }); throw workerError('RECUT_FONT_NOT_LOADED'); } });
  const running = s.worker.runOnce(); await ready;
  await assert.rejects(s.worker.runOnce(), { code: 'RECUT_WORKER_BUSY' }); release(); await running;
  assert.equal(s.calls.filter((c) => c === 'claim').length, 1);
});
for (const [name, code] of [['重複結果拒收', 'RECUT_LEASE_INVALID'], ['結果回應遺失', 'RECUT_NETWORK_ERROR']]) test(`${name}不重送result或failure`, async (t) => {
  let attempts = 0;
  const s = await setup(t, { api: { upload: async () => { attempts++; throw workerError(code, 409); } } });
  assert.equal((await s.worker.runOnce()).code, code); assert.equal(attempts, 1); assert.equal(s.failure.length, 0);
  assert.deepEqual(await fs.readdir(s.root), []);
});
test('不接受renderer指向工作目錄之外的成品', async (t) => {
  const s = await setup(t, { renderer: async ({ outDir }) => {
    const filePath = path.join(path.dirname(outDir), 'outside.mp4'); await fs.writeFile(filePath, 'outside');
    return { filePath, checks: passing() };
  } });
  assert.equal((await s.worker.runOnce()).code, 'RECUT_RESULT_PATH_INVALID'); assert.equal(s.uploads.length, 0);
  assert.equal(await fs.readFile(path.join(s.root, 'outside.mp4'), 'utf8'), 'outside');
});
test('檢查失敗不交成品，原始測值隨failure送回後端', async (t) => {
  const s = await setup(t, { renderer: async ({ outDir }) => {
    const filePath = path.join(outDir, 'final.mp4'); await fs.writeFile(filePath, 'synthetic-output');
    return { filePath, checks: { ...passing(), silenceMaxSec: 3 } };
  } });
  assert.equal((await s.worker.runOnce()).code, 'RECUT_RENDER_CHECK_FAILED');
  assert.equal(s.failure[0].checks.silenceMaxSec, 3); assert.equal(s.uploads.length, 0);
});
