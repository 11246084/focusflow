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
const lifecycleService = require('../src/services/youtubeLifecycle.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
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
    const result = await youtubeUploadService.runYouTubeUploadRecoveryNow({ now: NOW });
    assert.deepEqual(result, { recovered: 0, quarantined: 0, skipped: true, reason: 'upload_disabled' });
  });

  it('排程開機先跑一次，之後定期執行，停止後清除計時器', async () => {
    const first = addVideo({
      filePath: makeSourceFile('first.mp4'),
      youtubeVideoId: null,
      youtubeUpload: { status: 'failed', attemptCount: 1, retrySafe: true, nextRetryAt: new Date(0) },
    });
    const { fetchImpl } = buildFetchMock();

    await youtubeUploadService.startYouTubeUploadRecoveryScheduler({ intervalMs: 20, fetchImpl });
    assert.equal(first.youtubeUpload.status, 'uploaded');
    assert.equal(youtubeUploadService.getYouTubeUploadRecoverySchedulerState().timerActive, true);

    const second = addVideo({
      filePath: makeSourceFile('second.mp4'),
      youtubeVideoId: null,
      youtubeUpload: { status: 'failed', attemptCount: 1, retrySafe: true, nextRetryAt: new Date(0) },
    });
    await waitFor(() => second.youtubeUpload.status === 'uploaded');

    youtubeUploadService.stopYouTubeUploadRecoveryScheduler();
    assert.equal(youtubeUploadService.getYouTubeUploadRecoverySchedulerState().timerActive, false);
  });

  it('環境變數不允許恢復時不啟動排程', () => {
    env.youtubeUploadRecoveryEnabled = false;
    assert.equal(youtubeUploadService.startYouTubeUploadRecoveryScheduler({ intervalMs: 20 }), null);
    assert.equal(youtubeUploadService.getYouTubeUploadRecoverySchedulerState().timerActive, false);
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

  it('同一行程進行中的長上傳不會被恢復誤判為卡住而隔離', async () => {
    const video = addVideo({ filePath: makeSourceFile('long-upload.mp4'), youtubeVideoId: null });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const upload = youtubeUploadService.autoUploadVideoToYouTube(String(video._id), {
      fetchImpl: buildFetchMock({ gate }).fetchImpl,
    });
    await waitFor(() => video.youtubeUpload?.status === 'uploading');

    const result = await youtubeUploadService.recoverPendingYouTubeUploads({
      fetchImpl: buildFetchMock().fetchImpl,
      now: new Date(Date.now() + DAY_MS),
    });
    release();
    await upload;

    assert.equal(result.quarantined, 0);
    assert.equal(video.youtubeUpload.status, 'uploaded');
  });
});

describe('youtubeLifecycle.service 原片清理', () => {
  let originalEnv;
  let uploadDir;

  function makeUploadedVideo({ name, uploadedDaysAgo, restoredDaysAgo = null, sizeBytes = 1024, ...overrides }) {
    const filePath = path.join(uploadDir, name);
    fs.writeFileSync(filePath, Buffer.alloc(sizeBytes));
    return addVideo({
      filePath,
      youtubeVideoId: `yt-${name}`,
      videoSource: 'upload',
      youtubeUpload: {
        status: 'uploaded',
        uploadedAt: new Date(NOW.getTime() - uploadedDaysAgo * DAY_MS),
        localSourceRestoredAt: restoredDaysAgo === null ? null : new Date(NOW.getTime() - restoredDaysAgo * DAY_MS),
      },
      ...overrides,
    });
  }

  const plentyOfSpace = async () => 100 * GB;

  beforeEach(() => {
    resetStore();
    lifecycleService.resetYouTubeLifecycleStateForTests();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    // 所有刪檔只發生在這個暫存目錄。
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-yt-cleanup-'));
    env.uploadDir = uploadDir;
    env.youtubeUploadCleanupEnabled = true;
    env.youtubeUploadCleanupMaxAgeDays = 180;
    env.youtubeUploadCleanupMinFreeGb = 10;
    env.youtubeUploadCleanupMinAgeDays = 14;
  });

  afterEach(() => {
    lifecycleService.resetYouTubeLifecycleStateForTests();
    Object.assign(env, originalEnv);
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('空間充足時只有超過最長保留期的影片列入，原因為 max_age', async () => {
    const old = makeUploadedVideo({ name: 'old.mp4', uploadedDaysAgo: 181 });
    makeUploadedVideo({ name: 'recent.mp4', uploadedDaysAgo: 100 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual(candidates.map((item) => [item.id, item.reason]), [[String(old._id), 'max_age']]);
    assert.deepEqual(candidates[0].eligibleAt, new Date(NOW.getTime() - DAY_MS));
    assert.equal(candidates[0].kind, 'video');
    assert.equal(candidates[0].sizeBytes, 1024);
  });

  it('空間不足時從最早上傳完成的開始刪，回到門檻以上即停', async () => {
    const oldest = makeUploadedVideo({ name: 'a.mp4', uploadedDaysAgo: 60, sizeBytes: 2048 });
    makeUploadedVideo({ name: 'b.mp4', uploadedDaysAgo: 40, sizeBytes: 2048 });
    makeUploadedVideo({ name: 'c.mp4', uploadedDaysAgo: 20, sizeBytes: 2048 });
    const minFreeBytes = 10 * GB;

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({
      now: NOW,
      getFreeBytes: async () => minFreeBytes - 1000,
    });

    assert.deepEqual(candidates.map((item) => [item.id, item.reason]), [[String(oldest._id), 'low_space']]);
  });

  it('空間不足但未滿最短保留期的影片不刪', async () => {
    makeUploadedVideo({ name: 'fresh-a.mp4', uploadedDaysAgo: 13 });
    makeUploadedVideo({ name: 'fresh-b.mp4', uploadedDaysAgo: 1 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({
      now: NOW,
      getFreeBytes: async () => 0,
    });

    assert.deepEqual(candidates, []);
  });

  it('超過最長保留期不論空間一律刪，並計入空間釋放量', async () => {
    const expired = makeUploadedVideo({ name: 'expired.mp4', uploadedDaysAgo: 200, sizeBytes: 4096 });
    makeUploadedVideo({ name: 'mid.mp4', uploadedDaysAgo: 30, sizeBytes: 4096 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({
      now: NOW,
      getFreeBytes: async () => 10 * GB - 4000,
    });

    assert.deepEqual(candidates.map((item) => [item.id, item.reason]), [[String(expired._id), 'max_age']]);
  });

  it('最長保留期設為 0 時只依空間清理', async () => {
    env.youtubeUploadCleanupMaxAgeDays = 0;
    makeUploadedVideo({ name: 'ancient.mp4', uploadedDaysAgo: 999 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual(candidates, []);
  });

  it('補回的原片保留期從補回時間重新起算', async () => {
    makeUploadedVideo({ name: 'restored-max.mp4', uploadedDaysAgo: 400, restoredDaysAgo: 1 });
    makeUploadedVideo({ name: 'restored-space.mp4', uploadedDaysAgo: 100, restoredDaysAgo: 5 });

    const maxAge = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });
    const lowSpace = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: async () => 0 });

    assert.deepEqual([maxAge, lowSpace], [[], []]);
  });

  it('UPLOAD_DIR 外或被其他影片共用的檔案不列入候選', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-yt-outside-'));
    try {
      const outsidePath = path.join(outsideDir, 'outside.mp4');
      fs.writeFileSync(outsidePath, 'outside');
      addVideo({
        filePath: outsidePath,
        youtubeVideoId: 'yt-outside',
        youtubeUpload: { status: 'uploaded', uploadedAt: new Date(NOW.getTime() - 300 * DAY_MS) },
      });
      const shared = makeUploadedVideo({ name: 'shared.mp4', uploadedDaysAgo: 300 });
      addVideo({ filePath: shared.filePath, processing: { status: 'processing' } });

      const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

      assert.deepEqual(candidates, []);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('7 天預告列出 7 天內到期的影片與到期時間', async () => {
    const soon = makeUploadedVideo({ name: 'soon.mp4', uploadedDaysAgo: 177 });
    makeUploadedVideo({ name: 'later.mp4', uploadedDaysAgo: 170 });

    const preview = await lifecycleService.buildYouTubeCleanupPreview({
      scope: 'upcoming',
      now: NOW,
      getFreeBytes: plentyOfSpace,
    });

    assert.deepEqual(preview.items.map((item) => item.id), [String(soon._id)]);
    assert.deepEqual(preview.items[0].eligibleAt, new Date(NOW.getTime() + 3 * DAY_MS));
    assert.deepEqual([preview.count, preview.totalBytes, preview.windowDays], [1, 1024, 7]);
  });

  it('未知的預告範圍回傳 VALIDATION_ERROR', async () => {
    await assert.rejects(
      () => lifecycleService.listYouTubeCleanupCandidates({ scope: 'all' }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });

  it('啟用預告與排程實際刪除的清單一致', async () => {
    makeUploadedVideo({ name: 'p1.mp4', uploadedDaysAgo: 365, sizeBytes: 3000 });
    makeUploadedVideo({ name: 'p2.mp4', uploadedDaysAgo: 90, sizeBytes: 3000 });
    makeUploadedVideo({ name: 'p3.mp4', uploadedDaysAgo: 60, sizeBytes: 3000 });
    makeUploadedVideo({ name: 'p4.mp4', uploadedDaysAgo: 3, sizeBytes: 3000 });
    const getFreeBytes = async () => 10 * GB - 5000;
    const originalPaths = new Map(store.videos.map((video) => [String(video._id), video.filePath]));

    const preview = await lifecycleService.buildYouTubeCleanupPreview({ scope: 'enable', now: NOW, getFreeBytes });
    setRuntimeSwitch('cleanup', true);
    const run = await lifecycleService.runYouTubeCleanup({ now: NOW, getFreeBytes });

    const deletedIds = run.results.filter((item) => item.cleaned).map((item) => item.id);
    assert.deepEqual(deletedIds, preview.items.map((item) => item.id));
    assert.equal(preview.count, 2);
    assert.deepEqual(
      store.videos.filter((video) => deletedIds.includes(String(video._id))).map((video) => [
        video.filePath,
        video.videoSource,
        fs.existsSync(originalPaths.get(String(video._id))),
      ]),
      [[null, 'youtube', false], [null, 'youtube', false]],
    );
  });

  it('清理沒有明確啟用時排程不刪任何檔案', async () => {
    const video = makeUploadedVideo({ name: 'keep.mp4', uploadedDaysAgo: 365 });

    const run = await lifecycleService.runYouTubeCleanup({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual([run.skipped, run.reason], [true, 'cleanup_disabled']);
    assert.equal(fs.existsSync(video.filePath), true);
  });

  it('清理中途被關閉時剩下的影片不再刪除', async () => {
    const first = makeUploadedVideo({ name: 'stop-1.mp4', uploadedDaysAgo: 400 });
    const second = makeUploadedVideo({ name: 'stop-2.mp4', uploadedDaysAgo: 300 });
    const firstPath = first.filePath;
    const secondPath = second.filePath;
    setRuntimeSwitch('cleanup', true);
    const source = lifecycleService.CLEANUP_SOURCES.video;
    const originalCleanup = source.cleanup;
    source.cleanup = async (id) => {
      const result = await originalCleanup(id);
      setRuntimeSwitch('cleanup', false);
      return result;
    };

    try {
      const run = await lifecycleService.runYouTubeCleanup({ now: NOW, getFreeBytes: plentyOfSpace });
      assert.deepEqual(run.results.map((item) => [item.cleaned, item.skipReason]), [[true, null], [false, 'disabled']]);
      assert.deepEqual([fs.existsSync(firstPath), fs.existsSync(secondPath)], [false, true]);
    } finally {
      source.cleanup = originalCleanup;
    }
  });

  it('排程停止後清除計時器，環境變數不允許時不啟動', async () => {
    await lifecycleService.startYouTubeCleanupScheduler({ intervalMs: 50, getFreeBytes: plentyOfSpace });
    assert.equal(lifecycleService.getYouTubeCleanupSchedulerState().timerActive, true);
    lifecycleService.stopYouTubeCleanupScheduler();
    assert.equal(lifecycleService.getYouTubeCleanupSchedulerState().timerActive, false);

    env.youtubeUploadCleanupEnabled = false;
    assert.equal(lifecycleService.startYouTubeCleanupScheduler({ intervalMs: 50 }), null);
  });

  it('可用空間以 statfs 的 bavail 乘 bsize 計算，可注入假值', async () => {
    const freeBytes = await lifecycleService.getUploadDirFreeBytes({
      statfsImpl: async (target) => {
        assert.equal(target, uploadDir);
        return { bavail: 3, bsize: 4096 };
      },
    });
    assert.equal(freeBytes, 12288);
  });

  it('查不到可用空間時只依最長保留期判斷', async () => {
    const expired = makeUploadedVideo({ name: 'statfs-old.mp4', uploadedDaysAgo: 200 });
    makeUploadedVideo({ name: 'statfs-mid.mp4', uploadedDaysAgo: 30 });

    const preview = await lifecycleService.buildYouTubeCleanupPreview({
      now: NOW,
      getFreeBytes: async () => { throw new Error('statfs unavailable'); },
    });

    assert.deepEqual(preview.items.map((item) => item.id), [String(expired._id)]);
    assert.equal(preview.freeBytes, null);
    assert.match(preview.freeBytesError, /statfs unavailable/);
  });

});
