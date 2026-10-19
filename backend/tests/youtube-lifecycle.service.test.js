const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const settingsService = require('../src/services/youtubeLifecycleSettings.service');

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

function setRuntimeSwitch(key, value) {
  const settingKey = `youtubeLifecycle.${key}`;
  const existing = store.runtimeSettings.find((item) => item.key === settingKey);
  if (existing) {
    existing.value = value;
    return;
  }
  store.runtimeSettings.push({ key: settingKey, value, history: [] });
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
