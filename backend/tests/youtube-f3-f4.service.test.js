const { it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, store, resetStore, newObjectId } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const { retryExistingVideoProcessing } = require('../src/services/video.service');
const settings = require('../src/services/youtubeLifecycleSettings.service');
const { buildSystemStatus, getSystemStatus } = require('../src/services/systemStatus.service');
const { buildYouTubeLifecycleSnapshot } = require('../src/services/youtubeLifecycle.service');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const { getCleanupPreview } = require('../src/services/youtubeAdmin.service');
let root; let original;
beforeEach(() => {
  resetStore(); original = { uploadDir: env.uploadDir, youtubeUploadEnabled: env.youtubeUploadEnabled,
    youtubeUploadRecoveryEnabled: env.youtubeUploadRecoveryEnabled, youtubeUploadCleanupEnabled: env.youtubeUploadCleanupEnabled,
    youtubeUploadCleanupMaxAgeDays: env.youtubeUploadCleanupMaxAgeDays };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-f3-f4-')); env.uploadDir = root; env.youtubeUploadEnabled = true;
});
afterEach(() => { Object.assign(env, original); fs.rmSync(root, { recursive: true, force: true }); });

function completedVideo() {
  const video = store.videos.find((row) => String(row._id) === ids.teacherVideo);
  const filePath = path.join(root, 'restored.mp4');
  fs.writeFileSync(filePath, Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(type, 4); return b; })));
  Object.assign(video, { filePath, fileName: 'restored.mp4', sourceType: 'upload', youtubeVideoId: 'f3Backup001',
    videoSource: 'youtube', videoUrl: 'https://www.youtube.com/watch?v=f3Backup001',
    processing: { status: 'completed', attemptCount: 1 },
    youtubeUpload: { status: 'uploaded', localSourceRestoredAt: new Date(), localSourceVersion: 'restored-v1' } });
  return video;
}
it('F3 completed 的可用來源可明確重新處理，保留影片與備份且只排入一次', async () => {
  const video = completedVideo();
  const queued = await retryExistingVideoProcessing(ids.teacherVideo, { id: ids.teacher, role: 'teacher' });
  assert.equal(queued.processing.status, 'queued'); assert.equal(queued.youtubeVideoId, video.youtubeVideoId);
  assert.equal(String(queued._id), ids.teacherVideo); assert.equal(queued.videoSource, 'youtube');
  await assert.rejects(retryExistingVideoProcessing(ids.teacherVideo, { id: ids.teacher, role: 'teacher' }), { code: 'VIDEO_PROCESSING_TRANSITION_INVALID' });
});
it('F3 completed 原片不存在時不得排程或改走 YouTube 下載', async () => {
  const video = completedVideo(); fs.unlinkSync(video.filePath);
  await assert.rejects(retryExistingVideoProcessing(ids.teacherVideo, { id: ids.teacher, role: 'teacher' }), { code: 'VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE' });
  assert.equal(video.processing.status, 'completed');
});
it('F3 完成影片先檢查權限，學生與其他課程教師不得重新處理', async () => {
  const video = completedVideo();
  for (const user of [{ id: ids.student, role: 'student' }, { id: ids.otherTeacher, role: 'teacher' }]) {
    await assert.rejects(retryExistingVideoProcessing(ids.teacherVideo, user), (error) => error.statusCode === 403);
    assert.equal(video.processing.status, 'completed');
  }
});
it('F4 首次並行切換的成功 history from/to 必須連續，同值操作仍可稽核', async () => {
  await Promise.all([true, false].map((enabled) => settings.setYouTubeLifecycleSwitch({ key: 'upload', enabled, user: { id: ids.admin, email: 'fixture@example.test' } })));
  const doc = store.runtimeSettings.find((row) => row.key === 'youtubeLifecycle.upload');
  assert.equal(doc.history.length, 2); assert.equal(doc.history[0].from, null);
  assert.equal(doc.history[1].from, doc.history[0].to); assert.equal(doc.value, doc.history[1].to);
  await settings.setYouTubeLifecycleSwitch({ key: 'upload', enabled: doc.value, user: { id: ids.admin } });
  assert.equal(doc.history.length, 3); assert.equal(doc.history[2].from, doc.history[2].to);
});
it('F4 憑證可用但 runtime 關閉時總覽不能顯示自動上傳啟用', () => {
  const switches = ['upload','recovery','cleanup'].map((key) => ({ key, envAllowed: true, runtimeEnabled: false, effective: false, reason: 'runtime_disabled' }));
  const result = buildSystemStatus({ dbReadyState: 1, qa: { readiness: 'ready' }, line: { readiness: 'ready' },
    youtube: { readiness: 'ready', hardFailures: [], warnings: [] }, venvPythonExists: true, queue: { active: 0, queued: 0 },
    youtubeLifecycle: { switches, quarantineCount: 0, upcomingCleanupCount: 0, upcomingCleanupBytes: 0, upcomingCleanupItems: [], error: null } });
  assert.equal(result.services.find((row) => row.key === 'youtube').status, 'not_enabled');
  assert.deepEqual(result.youtubeLifecycle.switches, switches);
  assert.deepEqual(result.youtubeLifecycle.upcomingCleanupItems, []);
});
it('F4 三種開關的環境、runtime 與預設值在設定、health、總覽一致', async () => {
  for (const [allowed, runtime] of [[true, false], [false, true], [true, undefined]]) {
    env.youtubeUploadEnabled = allowed; env.youtubeUploadRecoveryEnabled = allowed; env.youtubeUploadCleanupEnabled = allowed;
    store.runtimeSettings.length = 0;
    if (runtime !== undefined) for (const key of ['upload', 'recovery', 'cleanup']) {
      store.runtimeSettings.push({ key: `youtubeLifecycle.${key}`, value: runtime, history: [] });
    }
    const state = await settings.getYouTubeLifecycleSettings();
    const health = await buildYouTubeLifecycleSnapshot({ getFreeBytes: async () => 100 * 1024 ** 3 });
    const overview = await getSystemStatus();
    assert.deepEqual(overview.youtubeLifecycle.switches, state.switches);
    for (const item of state.switches) {
      const { envAllowed, runtimeEnabled, effective, reason } = item;
      assert.deepEqual(health.switches[item.key], { envAllowed, runtimeEnabled, effective, reason });
      assert.equal(effective, allowed && runtime !== false && (runtime !== undefined || item.key !== 'cleanup'));
      assert.equal(reason, !allowed ? 'env_disabled' : runtime === false ? 'runtime_disabled' : item.key === 'cleanup' && runtime === undefined ? 'default_off' : null);
    }
  }
});
it('F4 設定讀取失敗時總覽為 unknown，不能沿用啟用值或洩漏 DB 錯誤', async () => {
  const find = RuntimeSetting.find;
  RuntimeSetting.find = () => { throw new Error('mongodb://secret:password@private-host'); };
  try {
    const result = await getSystemStatus();
    assert.equal(result.services.find(row => row.key === 'youtube').status, 'unknown');
    assert.equal(result.youtubeLifecycle.switches, null);
    assert.equal(result.youtubeLifecycle.upcomingCleanupItems, null);
    assert.ok(result.youtubeLifecycle.error);
    assert.doesNotMatch(JSON.stringify(result), /password|private-host/);
  } finally { RuntimeSetting.find = find; }
});
it('F4 總覽影片與短片清單、容量、時間、原因與 upcoming preview 共用結果', async () => {
  env.youtubeUploadCleanupMaxAgeDays = 180;
  const video = completedVideo(); video.youtubeUpload.uploadedAt = new Date('2025-01-01');
  video.youtubeUpload.localSourceRestoredAt = null;
  const shortPath = path.join(root, 'published.mp4'); fs.writeFileSync(shortPath, Buffer.alloc(512));
  store.shortAssets.push({ _id: newObjectId(), title: 'F4 已上架短片', courseId: ids.teacherCourse,
    status: 'published', filePath: shortPath, youtubeVideoId: 'f4Short0001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const preview = await getCleanupPreview({ scope: 'upcoming' });
  const overview = (await getSystemStatus()).youtubeLifecycle;
  assert.equal(preview.count, 2); assert.deepEqual(new Set(preview.items.map(row => row.kind)), new Set(['video', 'short_asset']));
  assert.equal(overview.upcomingCleanupCount, preview.count); assert.equal(overview.upcomingCleanupBytes, preview.totalBytes);
  assert.deepEqual(overview.upcomingCleanupItems, preview.items);
  assert.ok(preview.items.every(row => row.courseTitle && row.eligibleAt && row.reason === 'max_age'));
});
