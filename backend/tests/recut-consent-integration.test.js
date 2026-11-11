const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId, startServer, stopServer, loginAs, jsonRequest } = require('./helpers/backendTestHarness');
const { makeReview, assetFor, teacher } = require('./helpers/recutReviewFixtures');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const consent = require('../src/services/recutConsent.service');
const { TERMS_VERSION } = require('../src/constants/recutConsent');
const { configureRecutConsentLifecycle } = require('../src/services/recutConsentLifecycle.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const review = require('../src/services/recutReview.service');
const worker = require('../src/services/recutWorker.service');
const publish = require('../src/services/shortAssetPublish.service');
const video = require('../src/services/video.service');
const feed = require('../src/services/shortAsset.service');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../src/config/env');
const input = (extra = {}) => ({ user: teacher, courseId: ids.teacherCourse, termsVersion: TERMS_VERSION, ...extra });
const opts = (f, extra = {}) => ({ user: teacher, scriptId: f.script._id, versionId: f.version._id, expectedRevision: snapshot(f.script).revision, ...extra });
let privacyCalls, privacyFails, lifecycle;
const queues = [];
async function rendered({ ready = true, approved = false } = {}) {
  const f = await makeReview(); await review.approveScript(opts(f)); await review.queueRender(opts(f)); const asset = await assetFor(f);
  Object.assign(asset, { courseId: ids.teacherCourse, sourceVideoId: ids.teacherVideo, title: '同意整合', filePath: 'fake-owned.mp4',
    youtubeVideoId: `fake-${asset._id}`, youtubeAvailability: 'playable', disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true },
    youtubeUpload: { status: 'uploaded', remoteState: ready ? 'ready' : 'processing', readyAt: new Date() } });
  if (approved) await review.approveAsset(opts(f, { assetId: asset._id, generationVersion: 1 }));
  return { f, asset };
}
describe('RC10與實際排程、worker、發布及撤回整合', () => {
  beforeEach(() => {
    resetStore(); privacyCalls = []; privacyFails = false;
    lifecycle = configureRecutConsentLifecycle({ setVideoPrivacy: async (request) => { privacyCalls.push(request.youtubeVideoId); if (privacyFails) throw new Error('fake privacy failure'); } });
  });
  afterEach(async () => { store.beforeShortAssetCompareAndSwap = null; for (const q of queues) { q.stop(); await q.idle(); } queues.length = 0; });
  it('缺內容同意在原片寫入前拒絕，回公開條款；舊disclosure不會補出voice同意', async () => {
    store.recutConsents[0].records = [];
    await assert.rejects(video.createCourseVideo({ courseId: ids.teacherCourse, user: teacher, uploadedBy: ids.teacher,
      file: { path: 'never-read.mp4', originalname: 'sample.mp4' } }), (error) => {
      assert.equal(error.code, 'RECUT_CONTENT_CONSENT_REQUIRED'); assert.equal(error.publicDetails.consentTerms.version, TERMS_VERSION); return true;
    });
    await consent.recordConsent(input({ kind: 'content', choice: 'granted', requestId: 'content-new' }));
    const script = seedScript(); const q = createRecutQueue(); queues.push(q);
    q.registerSteps('generate', [{ id: 'never-run', stage: 'selection', run: async () => { throw new Error('must not run'); } }]);
    await assert.rejects(q.enqueue({ script, requestedBy: ids.teacher }), { code: 'RECUT_VOICE_CONSENT_REQUIRED' });
    assert.equal(store.recutTasks.length, 0);
    await consent.recordConsent(input({ kind: 'voice', choice: 'synthetic', requestId: 'voice-synthetic' }));
    await assert.rejects(q.enqueue({ script, requestedBy: ids.teacher }), { code: 'RECUT_SYNTHETIC_VOICE_NOT_READY' });
  });
  it('只封存選中成品，未選中published仍可見；失敗留manual待辦且重試不復活', async () => {
    const first = await rendered({ approved: true }), second = await rendered({ approved: true });
    store.courses.find((course) => course._id === ids.teacherCourse).status = 'published';
    store.enrollments.push({ courseId: ids.teacherCourse, studentId: ids.student, status: 'active' });
    privacyFails = true;
    const withdrawn = await consent.withdraw(input({ kind: 'voice', requestId: 'selected-withdraw', selectedAssetIds: [String(first.asset._id)] }));
    assert.equal(withdrawn.status, 'pending'); assert.equal(first.asset.status, 'archived'); assert.equal(second.asset.status, 'published');
    assert.ok(withdrawn.actions.some((action) => action.manualActionRequired));
    const visible = await feed.listStudentShorts({ studentId: ids.student });
    assert.ok(visible.items.some((item) => item.assetId === String(second.asset._id)));
    assert.ok(!visible.items.some((item) => item.assetId === String(first.asset._id)));
    const notificationCount = store.notifications.length;
    await consent.retryWithdrawal(input({ withdrawalId: withdrawn.id })); assert.equal(store.notifications.length, notificationCount);
    privacyFails = false; assert.equal((await consent.retryWithdrawal(input({ withdrawalId: withdrawn.id }))).status, 'completed');
    await publish.markShortAssetPublished(first.asset); assert.equal(first.asset.status, 'archived');
    assert.equal(first.asset.youtubePrivacyStatus, 'private'); assert.equal(first.asset.consentWithdrawal.privateRequired, false);
  });
  it('撤回停止已排渲染、失效worker租約，之後不能領取或回傳', async () => {
    const f = await makeReview(); await review.approveScript(opts(f)); await review.queueRender(opts(f));
    const credential = await worker.createWorker({ user: { id: ids.admin }, name: 'fake worker' });
    const identity = await worker.authenticateWorker(credential.key);
    const job = await worker.claimRenderJob({ worker: identity, shortRenderVersion: 'fixture', assetVersions: {} });
    const result = await consent.withdraw(input({ kind: 'voice', requestId: 'worker-stop', selectedAssetIds: [] }));
    assert.equal(result.status, 'completed'); assert.equal(store.recutRenderJobs[0].status, 'cancelled');
    assert.equal(snapshot(f.script).state, 'render_failed'); assert.equal(store.recutWorkers[0].activeJobId, null);
    await assert.rejects(worker.heartbeat({ worker: identity, jobId: job.jobId, leaseToken: job.leaseToken }), { code: 'RECUT_LEASE_INVALID' });
    assert.equal(await worker.claimRenderJob({ worker: identity, shortRenderVersion: 'fixture', assetVersions: {} }), null);
  });
  it('發布CAS等待時撤回，晚到發布會封存並留下轉私人補償；恢復不重新發布', async () => {
    const { f, asset } = await rendered({ ready: false, approved: true }); asset.youtubeUpload.remoteState = 'ready';
    let entered, release; const waiting = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    store.beforeShortAssetCompareAndSwap = async (_query, change) => { if (change.$set?.status === 'published') { entered(); await gate; } };
    const publishing = publish.markShortAssetPublished(asset); await waiting;
    const withdrawing = consent.withdraw(input({ kind: 'voice', requestId: 'race-publish', selectedAssetIds: [] }));
    while (!store.recutConsents[0].records.some((record) => record.requestId === 'race-publish')) await new Promise(setImmediate);
    privacyFails = true; release();
    await assert.rejects(publishing, { code: 'RECUT_VOICE_CONSENT_REQUIRED' });
    const withdrawal = await withdrawing;
    assert.equal(asset.status, 'archived'); assert.equal(asset.consentWithdrawal.privateRequired, true);
    assert.notEqual(snapshot(f.script).state, 'published');
    assert.ok(store.notifications.some((notification) => notification.title === '短片撤回需要手動下架'));
    privacyFails = false; await lifecycle.recoverAssetPrivacy();
    await consent.retryWithdrawal(input({ withdrawalId: withdrawal.id }));
    assert.equal(asset.consentWithdrawal.privateRequired, false); assert.equal(asset.youtubePrivacyStatus, 'private');
    assert.equal(await publish.markShortAssetPublished(asset), null);
  });
  it('YouTube bytes送出後撤回，晚到ID持久補償並留privacy待辦，不重複上傳', async () => {
    const { asset } = await rendered(); asset.youtubeVideoId = null; asset.youtubeUpload = { status: null, attemptCount: 0 };
    const filePath = path.join(env.uploadDir, `test-consent-upload-${asset._id}.mp4`); fs.writeFileSync(filePath, 'fake owned mp4'); asset.filePath = filePath;
    const priorEnabled = env.youtubeUploadEnabled, priorToken = env.youtubeUploadAccessToken;
    env.youtubeUploadEnabled = true; env.youtubeUploadAccessToken = 'fake-only';
    let entered, release; const waiting = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    let mediaCalls = 0;
    const response = (payload, location) => ({ ok: true, status: 200, json: async () => payload,
      headers: { get: (key) => key.toLowerCase() === 'location' ? location : null } });
    const fetchImpl = async (url, options = {}) => {
      if (String(url).includes('uploadType=resumable')) return response({}, 'https://upload.test/consent');
      if (String(url) === 'https://upload.test/consent') {
        mediaCalls++; for await (const chunk of options.body) assert.ok(chunk.length); entered(); await gate;
        return response({ id: 'fake-late-consent', status: { privacyStatus: 'unlisted' } });
      }
      throw new Error('Unexpected fake upload request');
    };
    try {
      const uploading = publish.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl }); await waiting;
      await consent.withdraw(input({ kind: 'voice', requestId: 'late-upload', selectedAssetIds: [] }));
      privacyFails = true; release();
      await assert.rejects(uploading, { code: 'RECUT_VOICE_CONSENT_REQUIRED' });
      assert.equal(asset.status, 'archived'); assert.equal(asset.youtubeVideoId, 'fake-late-consent');
      assert.equal(asset.consentWithdrawal.privateRequired, true); assert.ok(asset.youtubeUpload.orphanUploads.length);
      assert.ok((await lifecycle.listManualAssetActions()).some((action) => action.assetId === String(asset._id) && action.manualActionRequired));
      await assert.rejects(publish.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl }), { code: 'RECUT_VOICE_CONSENT_REQUIRED' });
      assert.equal(mediaCalls, 1); privacyFails = false; await lifecycle.recoverAssetPrivacy();
      assert.equal(asset.youtubePrivacyStatus, 'private');
    } finally { env.youtubeUploadEnabled = priorEnabled; env.youtubeUploadAccessToken = priorToken; if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  });
  it('render成品建立等待時撤回，晚到檔案不進審閱且取消恢復不建立第二份', async () => {
    const f = await makeReview(); store.recutVersions.find((version) => String(version._id) === String(f.version._id)).plan.canvas = { width: 720, height: 1280, fps: 30 };
    await review.approveScript(opts(f)); await review.queueRender(opts(f));
    const made = await worker.createWorker({ user: { id: ids.admin }, name: 'late render' }); const identity = await worker.authenticateWorker(made.key);
    const job = await worker.claimRenderJob({ worker: identity, shortRenderVersion: 'fixture', assetVersions: {} });
    const filePath = path.join(env.uploadDir, `test-consent-render-${job.jobId}.mp4`); fs.writeFileSync(filePath, 'fake output');
    let entered, release; const waiting = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    const Asset = require('../src/models/shortAsset.model'); const create = Asset.create;
    Asset.create = async (...args) => { entered(); await gate; return create(...args); };
    try {
      const completing = worker.completeRender({ worker: identity, jobId: job.jobId, leaseToken: job.leaseToken, file: { path: filePath }, metadata: {
        versionId: job.versionId, planHash: job.planHash, shortRenderVersion: 'fixture', assetVersions: {}, checks: {
          videoTracks: 1, audioTracks: 1, width: 720, height: 1280, fps: 30, durationSec: 37,
          blackMaxSec: 0, silenceMaxSec: 0, integratedLufs: -16, truePeakDbtp: -2, fontLoaded: true,
        } } }); await waiting;
      const withdrawing = consent.withdraw(input({ kind: 'voice', requestId: 'late-render', selectedAssetIds: [] }));
      while (!store.recutConsents[0].records.some((record) => record.requestId === 'late-render')) await new Promise(setImmediate);
      release(); await assert.rejects(completing, { code: 'RECUT_VOICE_CONSENT_REQUIRED' }); await withdrawing;
      assert.equal(store.recutRenderJobs[0].status, 'cancelled'); assert.equal(store.shortAssets.length, 1); assert.equal(store.shortAssets[0].status, 'archived');
      await worker.recoverRenderJobs(); assert.equal(store.shortAssets.length, 1); assert.equal(snapshot(f.script).state, 'render_failed');
    } finally { Asset.create = create; if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  });
  it('gate已過但upload CAS尚未提交時撤回，晚到遠端ID仍留privacy補償', async () => {
    const { asset } = await rendered(); asset.youtubeVideoId = null; asset.youtubeUpload = { status: null, attemptCount: 0 };
    const filePath = path.join(env.uploadDir, `test-late-commit-${asset._id}.mp4`); fs.writeFileSync(filePath, 'fake owned mp4'); asset.filePath = filePath;
    const priorEnabled = env.youtubeUploadEnabled, priorToken = env.youtubeUploadAccessToken;
    env.youtubeUploadEnabled = true; env.youtubeUploadAccessToken = 'fake-only';
    let entered, release; const waiting = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    let mediaCalls = 0;
    const response = (payload, location) => ({ ok: true, status: 200, json: async () => payload,
      headers: { get: (key) => key.toLowerCase() === 'location' ? location : null } });
    const fetchImpl = async (url, options = {}) => {
      if (String(url).includes('uploadType=resumable')) return response({}, 'https://upload.test/late-commit');
      if (String(url) === 'https://upload.test/late-commit') { mediaCalls++; for await (const chunk of options.body) assert.ok(chunk.length);
        return response({ id: 'fake-after-gate', status: { privacyStatus: 'unlisted' } }); }
      throw new Error('Unexpected fake upload request');
    };
    store.beforeShortAssetCompareAndSwap = async (_query, change) => { if (change.$set?.youtubeVideoId === 'fake-after-gate') { entered(); await gate; } };
    try {
      const uploading = publish.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl }); await waiting;
      await consent.withdraw(input({ kind: 'voice', requestId: 'late-commit', selectedAssetIds: [String(asset._id)] }));
      assert.equal(asset.status, 'archived'); assert.equal(asset.consentWithdrawal.privateRequired, false);
      privacyFails = true; release(); await assert.rejects(uploading, { code: 'RECUT_CONSENT_WITHDRAWN' });
      assert.equal(asset.youtubeVideoId, 'fake-after-gate'); assert.equal(asset.consentWithdrawal.privateRequired, true);
      assert.ok((await lifecycle.listManualAssetActions()).some((item) => item.assetId === String(asset._id)));
      const notices = store.notifications.length; await lifecycle.recoverAssetPrivacy(); assert.equal(store.notifications.length, notices);
      privacyFails = false; await lifecycle.recoverAssetPrivacy(); assert.equal(asset.youtubePrivacyStatus, 'private');
      assert.equal(asset.consentWithdrawal.privateRequired, false); assert.equal(mediaCalls, 1);
    } finally { store.beforeShortAssetCompareAndSwap = null; env.youtubeUploadEnabled = priorEnabled; env.youtubeUploadAccessToken = priorToken; if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  });
  it('真HTTP管理員待辦包含Asset晚到補償，非管理員拒絕', async () => {
    const asset = { _id: newObjectId(), courseId: ids.teacherCourse, generationVersion: 1, status: 'draft', youtubeVideoId: 'fake-manual-only' };
    store.shortAssets.push(asset); privacyFails = true; await lifecycle.quarantineAsset(asset);
    assert.deepEqual(await consent.listManualActions({ user: { id: ids.admin, role: 'admin' } }), []);
    const { server, baseUrl } = await startServer();
    try {
      const adminToken = await loginAs(baseUrl, 'admin@focusflow.local', 'Admin123!');
      const result = await jsonRequest(baseUrl, '/api/v1/admin/recut-consent/manual-actions', { token: adminToken });
      assert.equal(result.status, 200); assert.ok(result.body.data.some((item) => item.assetId === String(asset._id) && item.manualActionRequired));
      const teacherToken = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      assert.equal((await jsonRequest(baseUrl, '/api/v1/admin/recut-consent/manual-actions', { token: teacherToken })).status, 403);
    } finally { await stopServer(server); }
  });
});
