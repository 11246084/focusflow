const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const originalDotenv = dotenv.config;
dotenv.config = () => ({ parsed: {} });
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
dotenv.config = originalDotenv;
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
  // Review m9: after the 0.3.0 bump, a queued job approved for another renderer
  // version must not block later jobs this worker can render.
  it('版本不符的工作被略過，後面版本相符的工作仍可領取', async () => {
    // The old job is queued with its version already set, like a job approved before the upgrade.
    const old = await makeReview(); old.version.plan.canvas = { width: 720, height: 1280, fps: 30 };
    Object.assign(store.recutVersions.find((v) => String(v._id) === String(old.version._id)), { plan: { ...old.version.plan }, shortRenderVersion: 'older-renderer' });
    const oldOptions = () => ({ user: teacher, scriptId: old.script._id, versionId: old.version._id, expectedRevision: snapshot(old.script).revision });
    await review.approveScript(oldOptions()); await review.queueRender(oldOptions());
    const current = await queued(); const id = await identity();
    const job = await worker.claimRenderJob({ worker: id.worker, ...versions });
    assert.equal(job.scriptId, String(current.script._id));
    assert.equal(store.recutRenderJobs.find((j) => String(j.scriptId) === String(old.script._id)).status, 'queued');
    assert.ok(store.notifications.length, 'mismatch still notifies admins');
  });
  it('版本不符不耗重派次數並通知管理員；未核准不能排工作', async () => {
    const f = await queued(); const id = await identity();
    // Final review B1: a claim that only skipped mismatched jobs is idle, so the worker
    // client (which stops on RECUT_RENDER_VERSION_MISMATCH) keeps polling.
    assert.equal(await worker.claimRenderJob({ worker: id.worker, ...versions, shortRenderVersion: 'wrong' }), null);
    assert.equal(store.recutRenderJobs[0].status, 'queued');
    assert.equal(store.recutRenderJobs[0].attemptCount, 0); assert.equal(store.recutWorkers[0].activeJobId, null);
    assert.ok(store.notifications.length);
    const notified = store.notifications.length;
    assert.equal(await worker.claimRenderJob({ worker: id.worker, ...versions, shortRenderVersion: 'wrong' }), null);
    assert.equal(store.notifications.length, notified, 'repeated idle polls do not add notifications');
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
  it('恢復讀到舊逾期快照後heartbeat延租成功，舊恢復不得重排有效租約', async () => {
    const { f, worker: identity, job } = await claimed(); const stored = store.recutRenderJobs[0];
    const observedExpiry = new Date(stored.leaseExpiresAt); const update = Job.findOneAndUpdate; let renewed = false;
    Job.findOneAndUpdate = async (query, change, options) => {
      if (!renewed && change.$set?.error?.code === 'RECUT_LEASE_EXPIRED') {
        renewed = true;
        await worker.heartbeat(lease(identity, job, { now: new Date(observedExpiry.getTime() - 1) }));
      }
      return update(query, change, options);
    };
    try { await worker.recoverRenderJobs({ now: new Date(observedExpiry.getTime() + 1) }); }
    finally { Job.findOneAndUpdate = update; }
    assert.equal(renewed, true); assert.equal(stored.status, 'leased'); assert.equal(stored.attempts.length, 0);
    assert.ok(new Date(stored.leaseExpiresAt) > observedExpiry);
    assert.equal(String(store.recutWorkers[0].activeJobId), String(stored._id)); assert.equal(snapshot(f.script).state, 'rendering');
  });
  it('成功回傳只產待審ShortAsset；同一核准版，未經成品核准不發布', async () => {
    const { f, worker: identity, job } = await claimed(); const file = fileFor();
    const result = await worker.completeRender(lease(identity, job, { file, metadata: { ...metadata(job), planVersion: 'recut-v1', renderDurationMs: 1200 } }));
    assert.equal(result.status, 'asset_review'); assert.equal(snapshot(f.script).state, 'asset_review');
    const asset = store.shortAssets[0]; assert.equal(asset.reviewStatus, 'pending'); assert.equal(asset.status, 'draft');
    assert.equal(String(asset.recutVersionId), job.versionId); assert.equal(store.recutRenderJobs[0].status, 'succeeded');
    assert.equal(store.recutRenderJobs[0].planVersion, 'recut-v1'); assert.equal(store.recutRenderJobs[0].renderDurationMs, 1200);
    const notices = store.notifications.filter((notice) => notice.dedupeKey?.startsWith('recut_render_ready:'));
    assert.equal(notices.length, 1); assert.equal(String(notices[0].recipientId), String(ids.teacher));
    assert.equal(String(notices[0].scriptId), String(f.script._id));
    assert.equal(store.recutRenderJobs[0].successNotificationPending, false); assert.ok(store.recutRenderJobs[0].successNotifiedAt);
    await worker.recoverRenderJobs();
    await assert.rejects(worker.completeRender(lease(identity, job, { file, metadata: metadata(job) })), { code: 'RECUT_LEASE_INVALID' });
    assert.equal(store.notifications.filter((notice) => notice.dedupeKey?.startsWith('recut_render_ready:')).length, 1);
    assert.ok(fs.existsSync(file.path));
  });
  it('通知寫入失敗保留成功成品與durable待送標記，恢復只重送通知', async () => {
    const { f, worker: identity, job } = await claimed(); const file = fileFor();
    const notifications = require('../src/services/notification.service'); const original = notifications.notifyRecutRenderReady;
    notifications.notifyRecutRenderReady = async () => { throw Error('injected notification outage'); };
    try {
      const result = await worker.completeRender(lease(identity, job, { file, metadata: metadata(job) }));
      assert.equal(result.status, 'asset_review');
    } finally { notifications.notifyRecutRenderReady = original; }
    const stored = store.recutRenderJobs[0];
    assert.equal(stored.status, 'succeeded'); assert.equal(stored.successNotificationPending, true);
    assert.equal(snapshot(f.script).state, 'asset_review'); assert.equal(store.shortAssets.length, 1);
    assert.equal(store.recutWorkers[0].activeJobId, null); assert.ok(fs.existsSync(file.path));
    const count = stored.attempts.length; await worker.recoverRenderJobs();
    assert.equal(stored.successNotificationPending, false); assert.equal(stored.attempts.length, count);
    assert.equal(store.shortAssets.length, 1); assert.equal(store.notifications.filter((notice) => notice.dedupeKey?.startsWith('recut_render_ready:')).length, 1);
  });
  it('通知已寫但ack中斷，重啟重送以同asset及generation去重', async () => {
    const { worker: identity, job } = await claimed(); const file = fileFor(); const original = Job.findOneAndUpdate; let once = true;
    Job.findOneAndUpdate = async (...args) => {
      if (once && args[1].$set?.successNotifiedAt) { once = false; throw Error('injected ack outage'); }
      return original(...args);
    };
    try { assert.equal((await worker.completeRender(lease(identity, job, { file, metadata: metadata(job) }))).status, 'asset_review'); }
    finally { Job.findOneAndUpdate = original; }
    assert.equal(store.recutRenderJobs[0].successNotificationPending, true);
    await Promise.all([worker.recoverRenderJobs(), worker.recoverRenderJobs()]);
    assert.equal(store.recutRenderJobs[0].successNotificationPending, false);
    assert.equal(store.notifications.filter((notice) => notice.dedupeKey?.startsWith('recut_render_ready:')).length, 1);
  });
  for (const stale of ['version', 'generation', 'archived', 'withdrawn']) {
    it(`恢復待送通知遇到${stale}不宣稱目前成品可審，歷史成功不補送`, async () => {
      const { f, worker: identity, job } = await claimed(); const file = fileFor();
      const notices = require('../src/services/notification.service'); const original = notices.notifyRecutRenderReady;
      notices.notifyRecutRenderReady = async () => { throw Error('hold notification'); };
      try { await worker.completeRender(lease(identity, job, { file, metadata: metadata(job) })); }
      finally { notices.notifyRecutRenderReady = original; }
      const script = store.shortScripts.find((entry) => String(entry._id) === String(f.script._id));
      if (stale === 'version') script.recut.currentVersionId = ids.student;
      if (stale === 'generation') store.shortAssets[0].generationVersion += 1;
      if (stale === 'archived') store.shortAssets[0].status = 'archived';
      if (stale === 'withdrawn') store.recutConsents.length = 0;
      // Legacy successes deliberately have no new durable intent.
      store.recutRenderJobs.push({ ...store.recutRenderJobs[0], _id: ids.student, successNotificationPending: undefined });
      await worker.recoverRenderJobs();
      assert.equal(store.recutRenderJobs[0].successNotificationPending, false);
      assert.equal(store.notifications.filter((notice) => notice.dedupeKey?.startsWith('recut_render_ready:')).length, 0);
    });
  }
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
  // 收尾永遠失敗的 completing 工作：已收下的 MP4 與資產都不見，finalizeCompletion 必拋錯。
  async function stuckCompleting() {
    const made = await claimed(); const file = fileFor(); const original = Script.findOneAndUpdate; let once = true;
    Script.findOneAndUpdate = async (...args) => { if (once && args[1].$set?.recut?.state === 'asset_review') { once = false; throw new Error('injected attach outage'); } return original(...args); };
    try { await assert.rejects(worker.completeRender(lease(made.worker, made.job, { file, metadata: metadata(made.job) })), /attach outage/); }
    finally { Script.findOneAndUpdate = original; }
    store.shortAssets.length = 0; fs.unlinkSync(file.path);
    assert.equal(store.recutRenderJobs[0].status, 'completing');
    return made;
  }
  async function quietly(task) {
    const original = console.error; console.error = () => {};
    try { return await task(); } finally { console.error = original; }
  }
  const failNotices = () => store.notifications.filter((n) => String(n.recipientId) === String(ids.teacher) && /fail/i.test(`${n.type || ''}${n.dedupeKey || ''}`));
  it('收尾失敗的completing工作（租約未過久）不讓recover拋錯，也不擋其他worker領取別支工作', async () => {
    const { f } = await stuckCompleting(); const next = await queued(); const other = await identity('other worker');
    const stored = store.recutRenderJobs[0];
    await quietly(async () => { await worker.recoverRenderJobs({ now: new Date(new Date(stored.leaseExpiresAt).getTime() + 60 * 1000) }); });
    assert.equal(stored.status, 'completing');
    const job = await quietly(() => worker.claimRenderJob({ worker: other.worker, ...versions }));
    assert.ok(job); assert.equal(job.scriptId, String(next.script._id));
    assert.equal(snapshot(f.script).state, 'rendering');
  });
  // 從 start 起每隔 stepMs 跑一次恢復，共 times 次；回傳最後一次的時間。
  async function recoverRepeatedly(start, times, stepMs) {
    let now = start;
    for (let index = 0; index < times; index += 1) {
      now = new Date(start.getTime() + index * stepMs);
      await quietly(() => worker.recoverRenderJobs({ now }));
    }
    return now;
  }
  it('停機很久後重啟只失敗一次不放棄已收下的成品：completing保留並記下第一次失敗', async () => {
    await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const afterDowntime = new Date(new Date(stored.leaseExpiresAt).getTime() + 6 * worker.LEASE_MS);
    await quietly(() => worker.recoverRenderJobs({ now: afterDowntime }));
    assert.equal(stored.status, 'completing'); assert.equal(stored.completionFailureCount, 1);
    assert.equal(new Date(stored.completionFailedAt).getTime(), afterDowntime.getTime());
    assert.ok(store.recutWorkers[0].activeJobId);
  });
  it('密集重試不重複計次：一分鐘內失敗很多次只算一次，不放棄', async () => {
    await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT + 5, 1000);
    assert.equal(stored.status, 'completing'); assert.equal(stored.completionFailureCount, 1);
  });
  it('很久以前失敗過一次，之後短時間密集失敗不放棄：中斷超過一個租約時間就重新起算', async () => {
    await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const first = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    await quietly(() => worker.recoverRenderJobs({ now: first }));
    assert.equal(stored.completionFailureCount, 1);
    const later = new Date(first.getTime() + 6 * worker.LEASE_MS);
    await recoverRepeatedly(later, 15, 10 * 1000);
    assert.equal(stored.status, 'completing');
    assert.equal(new Date(stored.completionFailedAt).getTime(), later.getTime());
    assert.ok(stored.completionFailureCount < worker.COMPLETION_FAILURE_LIMIT);
    assert.ok(store.recutWorkers[0].activeJobId);
  });
  it('拿不到腳本鎖的失敗不計入', async () => {
    const { f } = await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const script = store.shortScripts.find((entry) => String(entry._id) === String(f.script._id));
    script.recutMutationLock = { token: 'held-by-another-process', expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT + 2, worker.COMPLETION_FAILURE_INTERVAL_MS);
    assert.equal(stored.status, 'completing'); assert.equal(stored.completionFailureCount || 0, 0);
    script.recutMutationLock = { token: null, expiresAt: null };
  });
  it('收尾持續失敗達上限且超過一個租約時間，改記RECUT_COMPLETION_FAILED、釋放worker、腳本進渲染失敗並通知一次', async () => {
    const { f } = await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    const step = Math.ceil(worker.LEASE_MS / 4);
    const before = failNotices().length;
    // 前 9 次已經分散在超過一個租約時間內：時間夠了但次數不足，仍保留。
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT - 1, step);
    assert.equal(stored.status, 'completing'); assert.equal(failNotices().length, before);
    assert.equal(stored.completionFailureCount, worker.COMPLETION_FAILURE_LIMIT - 1);
    const now = new Date(start.getTime() + (worker.COMPLETION_FAILURE_LIMIT - 1) * step);
    await quietly(() => worker.recoverRenderJobs({ now }));
    assert.equal(stored.status, 'failed'); assert.equal(stored.error.code, 'RECUT_COMPLETION_FAILED');
    assert.equal(store.recutWorkers[0].activeJobId, null); assert.equal(snapshot(f.script).state, 'render_failed');
    assert.equal(failNotices().length, before + 1); assert.ok(stored.notifiedAt);
    const count = store.notifications.length; const attempts = stored.attempts.length; const finishedAt = stored.finishedAt;
    await quietly(() => worker.recoverRenderJobs({ now: new Date(now.getTime() + 1000) }));
    assert.equal(store.notifications.length, count); assert.equal(stored.attempts.length, attempts);
    assert.equal(stored.status, 'failed'); assert.equal(stored.finishedAt, finishedAt);
  });
  it('次數達上限但持續時間不足一個租約時間不放棄', async () => {
    await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    // 每 60 秒一次共 10 次，跨 9 分鐘，未滿 10 分鐘。
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT, worker.COMPLETION_FAILURE_INTERVAL_MS);
    assert.equal(stored.completionFailureCount, worker.COMPLETION_FAILURE_LIMIT); assert.equal(stored.status, 'completing');
  });
  it('放棄收尾時腳本已不在該版本渲染中，只結束工作並標記已通知，不發失敗通知', async () => {
    const { f } = await stuckCompleting(); const stored = store.recutRenderJobs[0];
    store.shortScripts.find((entry) => String(entry._id) === String(f.script._id)).recut.currentVersionId = ids.student;
    const count = store.notifications.length;
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT, Math.ceil(worker.LEASE_MS / 4));
    assert.equal(stored.status, 'failed'); assert.equal(stored.error.code, 'RECUT_COMPLETION_FAILED');
    assert.equal(store.recutWorkers[0].activeJobId, null); assert.ok(stored.notifiedAt);
    assert.equal(store.notifications.length, count);
  });
  it('教師重新排入失敗的工作時，收尾失敗的起點與次數歸零', async () => {
    const { f } = await stuckCompleting(); const stored = store.recutRenderJobs[0];
    const start = new Date(new Date(stored.leaseExpiresAt).getTime() + 1000);
    await recoverRepeatedly(start, worker.COMPLETION_FAILURE_LIMIT, Math.ceil(worker.LEASE_MS / 4));
    assert.equal(stored.status, 'failed'); assert.ok(stored.completionFailureCount >= worker.COMPLETION_FAILURE_LIMIT);
    store.shortScripts.find((entry) => String(entry._id) === String(f.script._id)).recut.state = 'render_queued';
    await worker.ensureRenderJob(f.script._id);
    assert.equal(stored.status, 'queued'); assert.equal(stored.completionFailureCount, 0);
    assert.equal(stored.completionFailedAt, null); assert.equal(stored.completionLastFailedAt, null);
  });
  it('前面一筆恢復失敗不阻擋後面步驟：同一次recover仍替render_queued腳本建立工作', async () => {
    await stuckCompleting(); const orphan = await queued();
    const kept = store.recutRenderJobs.filter((j) => String(j.scriptId) !== String(orphan.script._id));
    store.recutRenderJobs.splice(0, store.recutRenderJobs.length, ...kept);
    assert.equal(store.recutRenderJobs.some((j) => String(j.scriptId) === String(orphan.script._id)), false);
    await quietly(() => worker.recoverRenderJobs());
    const created = store.recutRenderJobs.find((j) => String(j.scriptId) === String(orphan.script._id));
    assert.ok(created); assert.equal(created.status, 'queued');
  });
  for (const [key, value, retryable] of [['blackMaxSec', 0.5, true], ['fontLoaded', false, true], ['silenceMaxSec', 2, false], ['integratedLufs', -19, false], ['truePeakDbtp', -1, false], ['durationSec', 38, false], ['videoTracks', 0, false]]) {
    it(`${key}門檻違反分類${retryable ? '偶發' : '固定'}`, () => {
      const result = classifyRenderChecks({ ...checks(), [key]: value }, { width: 720, height: 1280, fps: 30, durationSec: 37 });
      assert.equal(result.valid, false); assert.equal(result.retryable, retryable);
    });
  }
});
