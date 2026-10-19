const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const settingsService = require('../src/services/youtubeLifecycleSettings.service');
const youtubeUploadService = require('../src/services/youtubeUpload.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T00:00:00.000Z');
const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeClientId',
  'youtubeClientSecret',
  'youtubeRefreshToken',
  'youtubeOAuthClientId',
  'youtubeOAuthClientSecret',
  'youtubeOAuthRefreshToken',
  'youtubeUploadAccessToken',
  'youtubeUploadMaxAttempts',
  'youtubeUploadRetryBaseMs',
  'youtubeUploadRecoveryEnabled',
  'youtubeUploadRecoveryBatchSize',
  'youtubeUploadRecoveryIntervalMs',
  'youtubeUploadStuckAfterMs',
  'youtubeUploadCleanupEnabled',
  'youtubeUploadCleanupIntervalMs',
  'youtubeUploadCleanupMaxAgeDays',
  'youtubeUploadCleanupMinFreeGb',
  'youtubeUploadCleanupMinAgeDays',
  'uploadDir',
];

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

async function drainStream(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.resume();
  });
}

async function waitFor(predicate, attempts = 200) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for asynchronous state.');
}

// 上傳 bytes 那一步可以被卡住，用來模擬「進行中的上傳」。
function buildFetchMock({ gate = null, youtubeId = 'ytLifecycle123' } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'access-token-for-tests' });
    }
    if (String(url).includes('uploadType=resumable')) {
      return jsonResponse({}, { headers: { location: 'https://upload.youtube.test/session' } });
    }
    if (gate) await gate;
    await drainStream(options.body);
    return jsonResponse({ id: youtubeId });
  };
  return { fetchImpl, calls };
}

function setRuntimeSwitch(key, value) {
  const settingKey = `youtubeLifecycle.${key}`;
  const existing = store.runtimeSettings.find((item) => item.key === settingKey);
  if (existing) {
    existing.value = value;
    return;
  }
  store.runtimeSettings.push({ key: settingKey, value, history: [] });
}

let videoCounter = 0;
function addVideo(overrides = {}) {
  videoCounter += 1;
  const video = {
    _id: `6a0000000000000000${String(videoCounter).padStart(6, '0')}`,
    courseId: ids.teacherCourse,
    title: `Lifecycle video ${videoCounter}`,
    uploadedBy: ids.teacher,
    processing: { status: 'completed' },
    ...overrides,
  };
  store.videos.push(video);
  return video;
}

describe('youtubeLifecycleSettings.service 兩層開關', () => {
  let originalEnv;

  beforeEach(() => {
    resetStore();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadCleanupEnabled = true;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('資料庫沒有設定時上傳與恢復跟隨環境變數、清理視為關閉', async () => {
    const { switches } = await settingsService.getYouTubeLifecycleSettings();
    const byKey = Object.fromEntries(switches.map((item) => [item.key, item]));

    assert.deepEqual(
      ['upload', 'recovery', 'cleanup'].map((key) => [key, byKey[key].effective, byKey[key].reason]),
      [['upload', true, null], ['recovery', true, null], ['cleanup', false, 'default_off']],
    );
    assert.equal(byKey.cleanup.runtimeEnabled, null);
    assert.equal(byKey.cleanup.envAllowed, true);
  });

  it('環境變數不允許時一律關閉，即使執行期設定為開啟', async () => {
    env.youtubeUploadCleanupEnabled = false;
    setRuntimeSwitch('cleanup', true);

    const state = await settingsService.getYouTubeLifecycleSwitch('cleanup');

    assert.deepEqual(
      { envAllowed: state.envAllowed, runtimeEnabled: state.runtimeEnabled, effective: state.effective, reason: state.reason },
      { envAllowed: false, runtimeEnabled: true, effective: false, reason: 'env_disabled' },
    );
  });

  it('執行期關閉時回報 runtime_disabled，明確啟用清理後才生效', async () => {
    setRuntimeSwitch('upload', false);
    setRuntimeSwitch('cleanup', true);

    const upload = await settingsService.getYouTubeLifecycleSwitch('upload');
    const cleanup = await settingsService.getYouTubeLifecycleSwitch('cleanup');

    assert.deepEqual([upload.effective, upload.reason], [false, 'runtime_disabled']);
    assert.deepEqual([cleanup.effective, cleanup.reason], [true, null]);
  });

  it('每次讀資料庫不快取，修改後下一次檢查即生效', async () => {
    assert.equal(await settingsService.isYouTubeLifecycleSwitchEnabled('recovery'), true);
    await settingsService.setYouTubeLifecycleSwitch({ key: 'recovery', enabled: false, user: { id: ids.admin } });
    assert.equal(await settingsService.isYouTubeLifecycleSwitchEnabled('recovery'), false);
  });

  it('讀不到資料庫時開關視為關閉', async () => {
    const originalFindOne = RuntimeSetting.findOne;
    RuntimeSetting.findOne = () => ({ lean: () => Promise.reject(new Error('db down')) });
    try {
      assert.equal(await settingsService.isYouTubeLifecycleSwitchEnabled('upload'), false);
    } finally {
      RuntimeSetting.findOne = originalFindOne;
    }
  });

  it('修改紀錄記下誰、何時、從什麼改成什麼', async () => {
    const result = await settingsService.setYouTubeLifecycleSwitch({
      key: 'cleanup',
      enabled: true,
      user: { id: ids.admin, email: 'admin@focusflow.local' },
      now: NOW,
    });

    assert.deepEqual(result.change, {
      key: 'cleanup',
      from: null,
      to: true,
      changedBy: ids.admin,
      changedByEmail: 'admin@focusflow.local',
      changedAt: NOW,
    });
    assert.equal(result.switch.effective, true);
  });

  it('修改紀錄只保留最近 50 筆', async () => {
    for (let index = 0; index < 55; index += 1) {
      await settingsService.setYouTubeLifecycleSwitch({
        key: 'upload',
        enabled: index % 2 === 0,
        user: { id: ids.admin },
        now: new Date(NOW.getTime() + index * 1000),
      });
    }

    const document = store.runtimeSettings.find((item) => item.key === 'youtubeLifecycle.upload');
    assert.equal(document.history.length, 50);
    assert.equal(new Date(document.history.at(-1).changedAt).getTime(), NOW.getTime() + 54 * 1000);
  });

  it('設定總覽的修改紀錄合併三個開關並由新到舊排序', async () => {
    await settingsService.setYouTubeLifecycleSwitch({ key: 'upload', enabled: false, user: { id: ids.admin }, now: NOW });
    await settingsService.setYouTubeLifecycleSwitch({
      key: 'cleanup', enabled: true, user: { id: ids.admin }, now: new Date(NOW.getTime() + 1000),
    });

    const { history } = await settingsService.getYouTubeLifecycleSettings();

    assert.deepEqual(history.map((entry) => [entry.key, entry.from, entry.to]), [
      ['cleanup', null, true],
      ['upload', null, false],
    ]);
  });

  it('環境變數不允許時拒絕修改', async () => {
    env.youtubeUploadCleanupEnabled = false;
    await assert.rejects(
      () => settingsService.setYouTubeLifecycleSwitch({ key: 'cleanup', enabled: true, user: { id: ids.admin } }),
      (error) => error.code === 'YOUTUBE_LIFECYCLE_SWITCH_ENV_DISABLED' && error.statusCode === 409,
    );
    assert.equal(store.runtimeSettings.length, 0);
  });

  it('未知的 key 或非布林值回傳 VALIDATION_ERROR', async () => {
    await assert.rejects(
      () => settingsService.setYouTubeLifecycleSwitch({ key: 'privatize', enabled: true }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
    await assert.rejects(
      () => settingsService.setYouTubeLifecycleSwitch({ key: 'upload', enabled: 'true' }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });
});

describe('YouTube 上傳恢復排程', () => {
  let originalEnv;
  let tempDir;

  function makeSourceFile(name) {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, 'fake video bytes');
    return filePath;
  }

  beforeEach(() => {
    resetStore();
    youtubeUploadService.resetYouTubeUploadState();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeClientId = 'client-id-for-tests';
    env.youtubeClientSecret = 'client-secret-for-tests';
    env.youtubeRefreshToken = 'refresh-token-for-tests';
    env.youtubeUploadAccessToken = '';
    env.youtubeUploadMaxAttempts = 3;
    env.youtubeUploadRetryBaseMs = 60000;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadRecoveryBatchSize = 5;
    env.youtubeUploadStuckAfterMs = 900000;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-yt-recovery-'));
  });

  afterEach(() => {
    youtubeUploadService.resetYouTubeUploadState();
    Object.assign(env, originalEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('5 筆永不重試的失敗不會擋住可重試的影片', async () => {
    for (let index = 0; index < 5; index += 1) {
      addVideo({
        filePath: makeSourceFile(`unsafe-${index}.mp4`),
        youtubeVideoId: null,
        youtubeUpload: {
          status: 'failed',
          attemptCount: 1,
          retrySafe: false,
          nextRetryAt: null,
          lastAttemptAt: new Date(NOW.getTime() - (10 - index) * DAY_MS),
        },
      });
    }
    const retryable = addVideo({
      filePath: makeSourceFile('retryable.mp4'),
      youtubeVideoId: null,
      youtubeUpload: {
        status: 'failed',
        attemptCount: 1,
        retrySafe: true,
        nextRetryAt: new Date(NOW.getTime() - 1000),
        lastAttemptAt: new Date(NOW.getTime() - DAY_MS),
      },
    });

    const result = await youtubeUploadService.recoverPendingYouTubeUploads({
      fetchImpl: buildFetchMock().fetchImpl,
      now: NOW,
    });

    assert.deepEqual(result, { recovered: 1, quarantined: 0, skipped: false });
    assert.equal(retryable.youtubeUpload.status, 'uploaded');
  });

  it('未到重試時間的失敗不重試，到期後由下一輪重試', async () => {
    const video = addVideo({
      filePath: makeSourceFile('backoff.mp4'),
      youtubeVideoId: null,
      youtubeUpload: {
        status: 'failed',
        attemptCount: 1,
        retrySafe: true,
        nextRetryAt: new Date(NOW.getTime() + 60000),
        lastAttemptAt: NOW,
      },
    });
    const { fetchImpl, calls } = buildFetchMock();

    const early = await youtubeUploadService.recoverPendingYouTubeUploads({ fetchImpl, now: NOW });
    assert.deepEqual([early.recovered, calls.length, video.youtubeUpload.status], [0, 0, 'failed']);

    const due = await youtubeUploadService.recoverPendingYouTubeUploads({
      fetchImpl,
      now: new Date(NOW.getTime() + 60000),
    });
    assert.deepEqual([due.recovered, video.youtubeUpload.status, video.youtubeUpload.attemptCount], [1, 'uploaded', 2]);
  });

  it('已達重試上限的失敗不再撈出', async () => {
    const video = addVideo({
      filePath: makeSourceFile('exhausted.mp4'),
      youtubeVideoId: null,
      youtubeUpload: { status: 'failed', attemptCount: 3, retrySafe: true, nextRetryAt: new Date(0) },
    });
    const { fetchImpl, calls } = buildFetchMock();

    const result = await youtubeUploadService.recoverPendingYouTubeUploads({ fetchImpl, now: NOW });

    assert.deepEqual([result.recovered, calls.length, video.youtubeUpload.status], [0, 0, 'failed']);
  });

  it('執行期關閉恢復時整輪略過並回報原因', async () => {
    setRuntimeSwitch('recovery', false);
    const result = await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });
    assert.deepEqual(result, { recovered: 0, quarantined: 0, skipped: true, reason: 'recovery_disabled' });
  });

  it('執行期關閉上傳時恢復也略過', async () => {
    setRuntimeSwitch('upload', false);
    const result = await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });
    assert.deepEqual(result, { recovered: 0, quarantined: 0, skipped: true, reason: 'upload_disabled' });
  });

  it('上傳中途關閉上傳開關不會中斷，已開始的上傳照常完成', async () => {
    const video = addVideo({ filePath: makeSourceFile('in-flight.mp4'), youtubeVideoId: null });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { fetchImpl } = buildFetchMock({ gate });

    const upload = youtubeUploadService.autoUploadVideoToYouTube(String(video._id), { fetchImpl });
    await waitFor(() => video.youtubeUpload?.status === 'uploading');
    await settingsService.setYouTubeLifecycleSwitch({ key: 'upload', enabled: false, user: { id: ids.admin } });
    release();

    assert.equal(await upload, 'ytLifecycle123');
    assert.equal(video.youtubeUpload.status, 'uploaded');
  });

  it('上傳開關關閉後不開始新的上傳', async () => {
    setRuntimeSwitch('upload', false);
    const video = addVideo({ filePath: makeSourceFile('blocked.mp4'), youtubeVideoId: null });
    const { fetchImpl, calls } = buildFetchMock();

    const result = await youtubeUploadService.autoUploadVideoToYouTube(String(video._id), { fetchImpl });

    assert.deepEqual([result, calls.length, video.youtubeUpload], [null, 0, undefined]);
  });

});
