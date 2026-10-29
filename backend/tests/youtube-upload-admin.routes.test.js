const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ids, store, resetStore, startServer, stopServer, loginAs, jsonRequest } = require('./helpers/backendTestHarness');
const gate = require('../src/services/youtubeUploadGate.service');
const AppError = require('../src/utils/appError');
const admin = require('../src/services/youtubeUploadAdmin.service');
const { buildVideoBridgePresentation } = require('../src/services/bridgeScope.service');

describe('Q-D 上傳管理 API', () => {
  let context; let token; let originals;
  before(async () => { context = await startServer(); });
  after(async () => stopServer(context.server));
  beforeEach(async () => {
    resetStore();
    originals = { pause: gate.getUploadPauseSnapshot, gate: gate.getUploadGateSnapshot, probe: gate.runUploadProbe };
    gate.getUploadPauseSnapshot = async () => ({ paused: true, earliestRetryAt: '2026-10-29T07:10:00Z', lastPauseSuccessCount: 4 });
    gate.getUploadGateSnapshot = async () => ({ held: false, leaseUntil: null });
    token = await loginAs(context.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
  });
  afterEach(() => { gate.getUploadPauseSnapshot = originals.pause; gate.getUploadGateSnapshot = originals.gate; gate.runUploadProbe = originals.probe; });
  it('每個新管理端點都拒絕非管理員', async () => {
    const teacher = await loginAs(context.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const routes = [['GET', '/uploads'], ['POST', '/uploads/probe'], ['GET', '/privacy-incidents'], ['POST', `/privacy/video/${ids.teacherVideo}/unlisted`], ['GET', '/storage']];
    for (const [method, path] of routes) {
      const result = await jsonRequest(context.baseUrl, `/api/v1/admin/youtube-lifecycle${path}`, { token: teacher, method });
      assert.equal(result.status, 403, path);
    }
  });
  it('管理員可讀等待與成功統計，工作階段網址不進回應', async () => {
    const video = store.videos.find((row) => String(row._id) === ids.teacherVideo);
    video.youtubeUpload = { status: 'waiting', waitReason: 'api_quota', session: { url: 'https://secret.invalid/session-token' }, orphanUploads: [{ youtubeVideoId: 'orphan00001', attemptId: 'old', detectedAt: new Date() }] };
    const other = store.videos.find((row) => String(row._id) !== ids.teacherVideo);
    other.youtubeUpload = { status: 'uploaded', uploadedAt: new Date() };
    const result = await jsonRequest(context.baseUrl, '/api/v1/admin/youtube-lifecycle/uploads', { token });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.waitingCount, 1);
    assert.equal(result.body.data.successLast24Hours, 1);
    assert.equal(result.body.data.lastPauseSuccessCount, 4);
    assert.equal(JSON.stringify(result.body).includes('session-token'), false);
    assert.equal(result.body.data.items.find((row) => row.id === ids.teacherVideo).orphanUploads[0].youtubeVideoId, 'orphan00001');
    assert.equal(JSON.stringify(buildVideoBridgePresentation(video)).includes('session-token'), false);
  });
  it('試傳 API 轉交操作者，重複操作回 409', async () => {
    let actor;
    gate.runUploadProbe = async (options) => { actor = options.actor; return { attempted: true, succeeded: false }; };
    const result = await jsonRequest(context.baseUrl, '/api/v1/admin/youtube-lifecycle/uploads/probe', { token, method: 'POST' });
    assert.equal(result.status, 200); assert.equal(result.body.data.attempted, true); assert.equal(String(actor), ids.admin);
    gate.runUploadProbe = async () => { throw new AppError('A probe is running.', 409, 'YOUTUBE_UPLOAD_PROBE_RUNNING'); };
    const conflict = await jsonRequest(context.baseUrl, '/api/v1/admin/youtube-lifecycle/uploads/probe', { token, method: 'POST' });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'YOUTUBE_UPLOAD_PROBE_RUNNING');
  });
  it('隱私清單保留操作者與讀回值，沒有工作階段資訊', async () => {
    const video = store.videos.find((row) => String(row._id) === ids.teacherVideo);
    video.youtubeUpload = { status: 'uploaded', privacyStatus: 'public', session: { url: 'https://secret.invalid/token' }, privacyIncidents: [{ detectedAt: new Date(), observed: 'public', action: 'private', result: 'private', actor: 'system' }] };
    const result = await jsonRequest(context.baseUrl, '/api/v1/admin/youtube-lifecycle/privacy-incidents', { token });
    assert.equal(result.status, 200); assert.equal(result.body.data.items[0].actor, 'system');
    assert.equal(result.body.data.items[0].privacyStatus, 'public'); assert.equal(JSON.stringify(result.body).includes('secret.invalid'), false);
  });
  it('改回不公開傳遞管理員身分並回傳讀回結果', async () => {
    const remote = require('../src/services/youtubeRemoteState.service'); const original = remote.restoreUnlisted;
    let actor;
    remote.restoreUnlisted = async (options) => { actor = options.actor; return { kind: options.kind, id: options.id, privacyStatus: 'unlisted', remoteState: 'ready' }; };
    try {
      const result = await jsonRequest(context.baseUrl, `/api/v1/admin/youtube-lifecycle/privacy/video/${ids.teacherVideo}/unlisted`, { token, method: 'POST' });
      assert.equal(result.status, 200); assert.equal(result.body.data.remoteState, 'ready'); assert.equal(actor, ids.admin);
    } finally { remote.restoreUnlisted = original; }
  });
  it('容量端點回傳預約與原片統計，教師僅能讀安全的上傳提示', async () => {
    const storage = require('../src/services/uploadStorage.service'); const original = storage.status;
    storage.status = async () => ({ freeBytes: 10000, reservedBytes: 100, minimumFreeBytes: 500, availableBytes: 9400 });
    try {
      const result = await jsonRequest(context.baseUrl, '/api/v1/admin/youtube-lifecycle/storage', { token });
      assert.equal(result.status, 200); assert.equal(result.body.data.reservedBytes, 100); assert.ok(Array.isArray(result.body.data.blocked));
      const teacher = await loginAs(context.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
      const hint = await jsonRequest(context.baseUrl, '/api/v1/videos/upload-status', { token: teacher });
      assert.equal(hint.status, 200); assert.equal(hint.body.data.pause.paused, true); assert.equal(hint.body.data.pause.log, undefined);
      const capacity = await jsonRequest(context.baseUrl, '/api/v1/videos/upload-storage', { token: teacher }); assert.equal(capacity.status, 200);
      const student = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!', 'student');
      const denied = await jsonRequest(context.baseUrl, '/api/v1/videos/upload-status', { token: student }); assert.equal(denied.status, 403);
    } finally { storage.status = original; }
  });
  it('隱私修復拒絕無效種類與識別碼', async () => {
    await assert.rejects(admin.restorePrivacy({ kind: 'unknown', id: ids.teacherVideo }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(admin.restorePrivacy({ kind: 'video', id: 'invalid' }), { code: 'INVALID_ID' });
  });
});
