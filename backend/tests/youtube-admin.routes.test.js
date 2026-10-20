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

describe('管理員隔離清單與查詢 API', () => {
  const VIDEO_ID = '6d0000000000000000000001';
  const ASSET_ID = '6d0000000000000000000002';
  const QUARANTINE_ENV_KEYS = [
    'youtubeUploadEnabled',
    'youtubeClientId',
    'youtubeClientSecret',
    'youtubeRefreshToken',
    'youtubeUploadAccessToken',
  ];
  let serverContext;
  let originalEnv;
  let originalFetch;
  let adminToken;
  let youtubeCalls;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(async () => {
    resetStore();
    require('../src/services/youtubeUpload.service').resetYouTubeUploadState();
    originalEnv = Object.fromEntries(QUARANTINE_ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeClientId = 'client-id';
    env.youtubeClientSecret = 'client-secret';
    env.youtubeRefreshToken = 'refresh-token';
    env.youtubeUploadAccessToken = '';
    adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');

    // 只攔截 Google API；打本機測試伺服器的請求照常送出。
    youtubeCalls = [];
    originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const text = String(url);
      if (!/googleapis\.com/.test(text)) return originalFetch(url, options);
      youtubeCalls.push(text);
      const reply = (payload) => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      if (text.includes('oauth2.googleapis.com/token')) {
        return reply({ access_token: 'route-token', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
      }
      if (text.includes('/youtube/v3/channels')) {
        return reply({ items: [{ id: 'UCown', contentDetails: { relatedPlaylists: { uploads: 'UUown' } } }] });
      }
      if (text.includes('/youtube/v3/playlistItems')) {
        return reply({
          items: [{
            snippet: { title: 'Found', description: `Uploaded by FocusFlow (video ${VIDEO_ID}).`, publishedAt: '2026-10-01T00:00:00Z' },
            contentDetails: { videoId: 'foundVideo1', videoPublishedAt: '2026-10-01T00:00:00Z' },
            status: { privacyStatus: 'unlisted' },
          }],
        });
      }
      if (text.includes('/youtube/v3/videos')) {
        return reply({ items: [{ snippet: { channelId: 'UCown' }, status: { privacyStatus: 'unlisted' } }] });
      }
      throw new Error(`Unexpected Google API call: ${text}`);
    };

    store.videos.push({
      _id: VIDEO_ID,
      courseId: ids.teacherCourse,
      title: 'Quarantined lecture',
      uploadedBy: ids.teacher,
      processing: { status: 'completed' },
      youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1, failedAt: new Date() },
    });
    store.shortAssets.push({
      _id: ASSET_ID,
      courseId: ids.teacherCourse,
      title: 'Quarantined short',
      filePath: 'uploads/test-upload-short.mp4',
      status: 'draft',
      disclosure: { confirmedBy: ids.teacher },
      youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1, failedAt: new Date() },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.assign(env, originalEnv);
  });

  it('非 admin 不能讀取待處理清單', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-quarantine', { token });

    assert.equal(result.status, 403);
  });

  it('待處理清單同時列出影片與短片', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-quarantine', { token: adminToken });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.items.map((item) => item.kind).sort(), ['short_asset', 'video']);
    assert.equal(result.body.data.searchable, null);
  });

  it('待處理清單附原因：已達重試上限的項目標 retry_limit，可重設不可套用', async () => {
    const video = store.videos.find((item) => item._id === VIDEO_ID);
    video.youtubeUpload = {
      status: 'failed', retrySafe: true, attemptCount: env.youtubeUploadMaxAttempts, failedAt: new Date(),
    };

    const list = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-quarantine', { token: adminToken });
    const apply = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/apply`,
      { method: 'POST', token: adminToken, body: { youtubeVideoId: 'foundVideo1' } },
    );
    const reset = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/reset`,
      { method: 'POST', token: adminToken },
    );

    assert.equal(list.status, 200);
    assert.deepEqual(
      Object.fromEntries(list.body.data.items.map((item) => [item.kind, item.reason])),
      { video: 'retry_limit', short_asset: 'quarantined' },
    );
    assert.equal(apply.status, 409);
    assert.equal(apply.body.error.code, 'YOUTUBE_QUARANTINE_NOT_ALLOWED');
    assert.deepEqual(youtubeCalls, []);
    assert.equal(reset.status, 200);
    assert.equal(video.youtubeUpload.attemptCount, 0);
  });

  it('查詢影片回傳描述相符的 YouTube 影片', async () => {
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/lookup`,
      { method: 'POST', token: adminToken },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.searchable, true);
    assert.deepEqual(result.body.data.matches.map((match) => match.youtubeVideoId), ['foundVideo1']);
  });

  it('查詢短片時走短片標記，影片標記不會配到', async () => {
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/short-assets/${ASSET_ID}/lookup`,
      { method: 'POST', token: adminToken },
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.matches, []);
  });

  it('查詢不存在的影片回 404，ID 格式錯誤回 400', async () => {
    const missing = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/youtube-quarantine/videos/6d00000000000000000000ff/lookup',
      { method: 'POST', token: adminToken },
    );
    const invalid = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/youtube-quarantine/videos/not-an-id/lookup',
      { method: 'POST', token: adminToken },
    );

    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'VIDEO_NOT_FOUND');
    assert.equal(invalid.status, 400);
    assert.equal(youtubeCalls.length, 0);
  });

  it('套用影片回傳 uploaded 並改走 YouTube 播放', async () => {
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/apply`,
      { method: 'POST', token: adminToken, body: { youtubeVideoId: 'foundVideo1' } },
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { kind: 'video', id: VIDEO_ID, status: 'uploaded' });
    const video = store.videos.find((item) => item._id === VIDEO_ID);
    assert.equal(video.youtubeVideoId, 'foundVideo1');
  });

  it('重設短片回傳可重試狀態', async () => {
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/short-assets/${ASSET_ID}/reset`,
      { method: 'POST', token: adminToken },
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, {
      kind: 'short_asset', id: ASSET_ID, status: 'failed', retrySafe: true, attemptCount: 0,
    });
  });

  it('非隔離項目套用回 409', async () => {
    const video = store.videos.find((item) => item._id === VIDEO_ID);
    video.youtubeUpload.retrySafe = true;

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/apply`,
      { method: 'POST', token: adminToken, body: { youtubeVideoId: 'foundVideo1' } },
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'YOUTUBE_QUARANTINE_NOT_ALLOWED');
  });

  it('非 admin 不能套用或重設', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const apply = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/apply`,
      { method: 'POST', token, body: { youtubeVideoId: 'foundVideo1' } },
    );
    const reset = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/youtube-quarantine/videos/${VIDEO_ID}/reset`,
      { method: 'POST', token },
    );

    assert.equal(apply.status, 403);
    assert.equal(reset.status, 403);
    assert.equal(store.videos.find((item) => item._id === VIDEO_ID).youtubeUpload.status, 'failed');
  });
});
