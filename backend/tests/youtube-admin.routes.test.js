const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
} = require('node:test');
const {
  ids,
  jsonRequest,
  loginAs,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');
const env = require('../src/config/env');

const DAY_MS = 24 * 60 * 60 * 1000;
const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeUploadRecoveryEnabled',
  'youtubeUploadCleanupEnabled',
  'youtubeUploadRecoveryIntervalMs',
  'youtubeUploadAccessToken',
  'youtubeUploadStuckAfterMs',
  'youtubeUploadCleanupMaxAgeDays',
  'youtubeUploadCleanupMinAgeDays',
  'youtubeUploadCleanupMinFreeGb',
  'uploadDir',
];

describe('管理員 YouTube 生命週期設定 API', () => {
  let serverContext;
  let originalEnv;
  let adminToken;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(async () => {
    resetStore();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadCleanupEnabled = false;
    env.youtubeUploadRecoveryIntervalMs = 300000;
    adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('非 admin 呼叫回 403', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', { token });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('GET 回傳三個開關、修改紀錄與執行期參數', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      token: adminToken,
    });

    assert.equal(result.status, 200);
    const { switches, history, runtime } = result.body.data;
    assert.deepEqual(switches.map((item) => item.key), ['upload', 'recovery', 'cleanup']);
    assert.deepEqual(switches[2], {
      key: 'cleanup',
      envAllowed: false,
      runtimeEnabled: null,
      effective: false,
      reason: 'env_disabled',
    });
    assert.deepEqual(history, []);
    assert.equal(runtime.recoveryIntervalMs, 300000);
    assert.ok('freeSpaceGb' in runtime);
    assert.ok('lastRecoveryAt' in runtime);
    assert.equal(typeof runtime.cleanupMaxAgeDays, 'number');
  });

  it('PATCH 切換開關後回傳最新設定，紀錄帶修改者姓名與 email', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'recovery', enabled: false },
    });

    assert.equal(result.status, 200);
    const recovery = result.body.data.switches.find((item) => item.key === 'recovery');
    assert.equal(recovery.runtimeEnabled, false);
    assert.equal(recovery.effective, false);
    assert.equal(recovery.reason, 'runtime_disabled');
    assert.equal(result.body.data.history.length, 1);
    const [entry] = result.body.data.history;
    assert.equal(entry.key, 'recovery');
    assert.equal(entry.from, null);
    assert.equal(entry.to, false);
    assert.equal(entry.changedBy.id, ids.admin);
    assert.equal(entry.changedBy.email, 'admin@focusflow.local');
    assert.equal(entry.changedBy.name, store.users.find((user) => user._id === ids.admin).name);
  });

  it('環境變數不允許時 PATCH 回 409 且不寫入設定', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'cleanup', enabled: true },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'YOUTUBE_LIFECYCLE_SWITCH_ENV_DISABLED');
    assert.equal(store.runtimeSettings.length, 0);
  });

  it('PATCH 的 enabled 不是布林值時回 400', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'upload', enabled: 'false' },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('管理員清理預告與立即恢復 API', () => {
  let serverContext;
  let originalEnv;
  let adminToken;
  let tempDir;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(async () => {
    resetStore();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-youtube-admin-'));
    env.uploadDir = tempDir;
    env.youtubeUploadEnabled = true;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadCleanupEnabled = true;
    env.youtubeUploadAccessToken = 'admin-test-access-token';
    env.youtubeUploadStuckAfterMs = 15 * 60 * 1000;
    env.youtubeUploadCleanupMaxAgeDays = 180;
    env.youtubeUploadCleanupMinAgeDays = 14;
    // 不依賴測試機的實際可用空間：只驗證最長保留期規則。
    env.youtubeUploadCleanupMinFreeGb = 0;
    adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function addUploadedVideo({ uploadedDaysAgo, bytes = 2048 }) {
    const filePath = path.join(tempDir, `source-${uploadedDaysAgo}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(bytes));
    const video = {
      _id: `6b00000000000000000000${String(uploadedDaysAgo).padStart(2, '0')}`,
      courseId: ids.teacherCourse,
      title: `Uploaded ${uploadedDaysAgo} days ago`,
      filePath,
      youtubeVideoId: `yt${String(uploadedDaysAgo).padStart(9, '0')}`,
      processing: { status: 'completed' },
      youtubeUpload: {
        status: 'uploaded',
        uploadedAt: new Date(Date.now() - uploadedDaysAgo * DAY_MS),
      },
    };
    store.videos.push(video);
    return video;
  }

  it('enable 預告列出超過最長保留期的原片並附課程名稱', async () => {
    const expired = addUploadedVideo({ uploadedDaysAgo: 200, bytes: 4096 });
    addUploadedVideo({ uploadedDaysAgo: 10 });

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/youtube-lifecycle/cleanup-preview?scope=enable',
      { token: adminToken },
    );

    assert.equal(result.status, 200);
    const course = store.courses.find((item) => item._id === ids.teacherCourse);
    assert.equal(result.body.data.scope, 'enable');
    assert.equal(result.body.data.count, 1);
    assert.equal(result.body.data.totalBytes, 4096);
    assert.deepEqual(Object.keys(result.body.data.items[0]).sort(), [
      'courseTitle', 'eligibleAt', 'id', 'kind', 'reason', 'sizeBytes', 'title',
    ]);
    assert.equal(result.body.data.items[0].id, expired._id);
    assert.equal(result.body.data.items[0].kind, 'video');
    assert.equal(result.body.data.items[0].reason, 'max_age');
    assert.equal(result.body.data.items[0].courseTitle, course.title);
  });

  it('upcoming 預告包含 7 天內到期的原片', async () => {
    const soon = addUploadedVideo({ uploadedDaysAgo: 176 });
    addUploadedVideo({ uploadedDaysAgo: 100 });

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/youtube-lifecycle/cleanup-preview?scope=upcoming',
      { token: adminToken },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.scope, 'upcoming');
    assert.deepEqual(result.body.data.items.map((item) => item.id), [soon._id]);
  });

  it('未知的 scope 回 400', async () => {
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/youtube-lifecycle/cleanup-preview?scope=all',
      { token: adminToken },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('立即執行恢復會隔離卡住的上傳並回傳筆數', async () => {
    const stale = {
      _id: '6b0000000000000000000101',
      courseId: ids.teacherCourse,
      title: 'Stale upload',
      uploadedBy: ids.teacher,
      processing: { status: 'completed' },
      youtubeUpload: {
        status: 'uploading',
        attemptCount: 1,
        lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    };
    store.videos.push(stale);

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/recovery/run', {
      method: 'POST',
      token: adminToken,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { recovered: 0, quarantined: 1, skipped: 0 });
    assert.equal(stale.youtubeUpload.status, 'failed');
    assert.equal(stale.youtubeUpload.retrySafe, false);
  });

  it('恢復開關關閉時立即執行回 409 並說明原因', async () => {
    store.runtimeSettings.push({ key: 'youtubeLifecycle.recovery', value: false, history: [] });

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/recovery/run', {
      method: 'POST',
      token: adminToken,
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'YOUTUBE_RECOVERY_NOT_RUN');
    assert.deepEqual(result.body.error.details, { reason: 'recovery_disabled' });
  });

  it('非 admin 不能立即執行恢復', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/recovery/run', {
      method: 'POST',
      token,
    });

    assert.equal(result.status, 403);
  });
});
