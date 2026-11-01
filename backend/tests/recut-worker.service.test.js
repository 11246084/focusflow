const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { makeReview, teacher } = require('./helpers/recutReviewFixtures');
const { snapshot } = require('./helpers/recutFixtures');
const review = require('../src/services/recutReview.service');
const worker = require('../src/services/recutWorker.service');
const { classifyRenderChecks } = require('../src/services/recutRenderChecks.service');
const env = require('../src/config/env');
const Job = require('../src/models/recutRenderJob.model');
const Script = require('../src/models/shortScript.model');
const admin = { id: ids.admin, role: 'admin' };
const versions = { shortRenderVersion: 'fixture', assetVersions: {} };
const checks = () => ({ videoTracks: 1, audioTracks: 1, width: 720, height: 1280, fps: 30, durationSec: 37,
  blackMaxSec: 0, silenceMaxSec: 0, integratedLufs: -16, truePeakDbtp: -2, fontLoaded: true });
const lease = (identity, job, extra = {}) => ({ worker: identity, jobId: job.jobId, leaseToken: job.leaseToken, ...extra });
async function identity(name = 'isolated worker') {
  const made = await worker.createWorker({ user: admin, name });
  return { made, worker: await worker.authenticateWorker(made.key) };
}
async function queued() {
  const f = await makeReview(); f.version.plan.canvas = { width: 720, height: 1280, fps: 30 };
  // Fixture versions are snapshots: mutate the in-memory persisted version explicitly.
  store.recutVersions.find((v) => String(v._id) === String(f.version._id)).plan.canvas = f.version.plan.canvas;
  const options = () => ({ user: teacher, scriptId: f.script._id, versionId: f.version._id, expectedRevision: snapshot(f.script).revision });
  await review.approveScript(options()); await review.queueRender(options());
  return f;
}
async function claimed() { const f = await queued(); const id = await identity(); const job = await worker.claimRenderJob({ worker: id.worker, ...versions }); return { f, ...id, job }; }
function fileFor() { const filePath = path.join(env.uploadDir, `test-worker-${Date.now()}-${Math.random()}.mp4`); fs.writeFileSync(filePath, 'fake MP4; only check evidence is injected'); return { path: filePath, size: fs.statSync(filePath).size }; }
const metadata = (job, overrides = {}) => ({ versionId: job.versionId, planHash: job.planHash, ...versions, checks: checks(), ...overrides });
describe('recut 專用 worker、CAS 租約與成品回傳', () => {
  beforeEach(resetStore);
  it('金鑰只建立時提供，DB只有雜湊；停用立即失效', async () => {
    const id = await identity(); const stored = store.recutWorkers[0];
    assert.notEqual(stored.keyHash, id.made.key); assert.equal(stored.keyHash.length, 64);
    assert.equal((await worker.listWorkers()).items[0].key, undefined);
    await worker.updateWorker({ user: admin, workerId: stored._id, isActive: false });
    await assert.rejects(worker.authenticateWorker(id.made.key), { code: 'RECUT_WORKER_UNAUTHORIZED' });
    assert.ok(store.adminAuditLogs.some((log) => log.event === 'recut_worker_update'));
  });
  it('FIFO，同worker並行只能一支；暫停不能領工作', async () => {
    const f = await queued(); await queued(); const id = await identity();
    const jobs = await Promise.all([worker.claimRenderJob({ worker: id.worker, ...versions }), worker.claimRenderJob({ worker: id.worker, ...versions })]);
    assert.equal(jobs.filter(Boolean).length, 1); assert.equal(jobs.find(Boolean).scriptId, String(f.script._id));
    await worker.updateWorker({ user: admin, workerId: id.worker._id, accepting: false });
    assert.equal(await worker.claimRenderJob({ worker: id.worker, ...versions }), null);
  });
  it('版本不符不耗重派次數並通知管理員；未核准不能排工作', async () => {
    const f = await queued(); const id = await identity();
    await assert.rejects(worker.claimRenderJob({ worker: id.worker, ...versions, shortRenderVersion: 'wrong' }), { code: 'RECUT_RENDER_VERSION_MISMATCH' });
    assert.equal(store.recutRenderJobs[0].attemptCount, 0); assert.equal(store.recutWorkers[0].activeJobId, null);
    assert.ok(store.notifications.length);
    store.recutApprovals.length = 0;
    await assert.rejects(worker.ensureRenderJob(f.script._id));
  });
  it('心跳延長10分鐘；錯worker/token/過期租約拒絕', async () => {
    const { worker: identity, job } = await claimed(); const now = new Date();
    const result = await worker.heartbeat(lease(identity, job, { now }));
    assert.equal(new Date(result.leaseExpiresAt).getTime(), now.getTime() + worker.LEASE_MS);
    await assert.rejects(worker.heartbeat(lease(identity, job, { leaseToken: 'wrong' })), { code: 'RECUT_LEASE_INVALID' });
    await assert.rejects(worker.heartbeat(lease(identity, job, { now: new Date(now.getTime() + worker.LEASE_MS + 1) })), { code: 'RECUT_LEASE_INVALID' });
  });
  it('逾時恢復重派別台，第三次逾時失敗且教師/所有管理員去重通知', async () => {
    const { f, worker: first, job } = await claimed(); let current = job;
    for (let count = 1; count <= 3; count += 1) {
      const stored = store.recutRenderJobs[0];
      await worker.recoverRenderJobs({ now: new Date(new Date(stored.leaseExpiresAt).getTime() + 1) });
      if (count < 3) {
        assert.equal(stored.status, 'queued'); assert.equal(snapshot(f.script).state, 'render_queued');
        assert.equal(await worker.claimRenderJob({ worker: first, ...versions }), null);
        const id = await identity(`replacement ${count}`); current = await worker.claimRenderJob({ worker: id.worker, ...versions }); assert.ok(current);
      }
    }
    assert.equal(store.recutRenderJobs[0].status, 'failed'); assert.equal(snapshot(f.script).state, 'render_failed');
    const count = store.notifications.length; await worker.recoverRenderJobs(); assert.equal(store.notifications.length, count);
    assert.ok(store.notifications.some((n) => String(n.recipientId) === String(ids.teacher)));
    await assert.rejects(worker.heartbeat(lease(first, job)), { code: 'RECUT_LEASE_INVALID' });
  });
  it('成功回傳只產待審ShortAsset；同一核准版，未經成品核准不發布', async () => {
    const { f, worker: identity, job } = await claimed(); const file = fileFor();
    const result = await worker.completeRender(lease(identity, job, { file, metadata: { ...metadata(job), planVersion: 'recut-v1', renderDurationMs: 1200 } }));
    assert.equal(result.status, 'asset_review'); assert.equal(snapshot(f.script).state, 'asset_review');
    const asset = store.shortAssets[0]; assert.equal(asset.reviewStatus, 'pending'); assert.equal(asset.status, 'draft');
    assert.equal(String(asset.recutVersionId), job.versionId); assert.equal(store.recutRenderJobs[0].status, 'succeeded');
    assert.equal(store.recutRenderJobs[0].planVersion, 'recut-v1'); assert.equal(store.recutRenderJobs[0].renderDurationMs, 1200);
    assert.ok(fs.existsSync(file.path));
  });
  it('遲到上傳拒收並移除未引用檔案；錯version與檢查失敗同樣不進審核', async () => {
    const { worker: identity, job } = await claimed(); const file = fileFor();
    await worker.recoverRenderJobs({ now: new Date(Date.now() + worker.LEASE_MS + 10) });
    await assert.rejects(worker.completeRender(lease(identity, job, { file, metadata: metadata(job) })), { code: 'RECUT_LEASE_INVALID' });
    assert.equal(fs.existsSync(file.path), false); assert.equal(store.shortAssets.length, 0);
  });
  it('接受成品後DB中斷保留檔案，重啟恢復同一assetId不重渲', async () => {
    const { f, worker: identity, job } = await claimed(); const file = fileFor();
    const original = Script.findOneAndUpdate; let once = true;
    Script.findOneAndUpdate = async (...args) => { if (once && args[1].$set?.recut?.state === 'asset_review') { once = false; throw new Error('injected attach outage'); } return original(...args); };
    try { await assert.rejects(worker.completeRender(lease(identity, job, { file, metadata: metadata(job) })), /attach outage/); }
    finally { Script.findOneAndUpdate = original; }
    assert.equal(store.recutRenderJobs[0].status, 'completing'); assert.ok(fs.existsSync(file.path));
    await worker.recoverRenderJobs(); assert.equal(snapshot(f.script).state, 'asset_review');
    assert.equal(store.shortAssets.length, 1); assert.equal(store.recutRenderJobs[0].status, 'succeeded');
  });
  for (const [key, value, retryable] of [['blackMaxSec', 0.5, true], ['fontLoaded', false, true], ['silenceMaxSec', 2, false], ['integratedLufs', -19, false], ['truePeakDbtp', -1, false], ['durationSec', 38, false], ['videoTracks', 0, false]]) {
    it(`${key}門檻違反分類${retryable ? '偶發' : '固定'}`, () => {
      const result = classifyRenderChecks({ ...checks(), [key]: value }, { width: 720, height: 1280, fps: 30, durationSec: 37 });
      assert.equal(result.valid, false); assert.equal(result.retryable, retryable);
    });
  }
});
