const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const youtubeUploadService = require('../src/services/youtubeUpload.service');
const shortAssetPublishService = require('../src/services/shortAssetPublish.service');
const { recoverShortAssetUploads } = require('../src/services/shortAssetRecovery.service');

const NOW = new Date('2026-10-20T00:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeUploadAccessToken',
  'youtubeUploadMaxAttempts',
  'youtubeUploadRetryBaseMs',
  'youtubeUploadRecoveryEnabled',
  'youtubeUploadRecoveryBatchSize',
  'youtubeUploadStuckAfterMs',
  'shortScriptAutomationEnabled',
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

// 假的 YouTube 上傳：session → PUT bytes；gate 可卡住 PUT 來模擬進行中的上傳。
function buildUploadFetch({ youtubeId = 'shortRecov01', gate = null, failSession = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('uploadType=resumable')) {
      if (failSession) return jsonResponse({ error: 'quota' }, { status: 403 });
      return jsonResponse({}, { headers: { location: 'https://upload.youtube.test/short-session' } });
    }
    if (gate) await gate;
    await drainStream(options.body);
    return jsonResponse({ id: youtubeId });
  };
  return { fetchImpl, calls };
}

let assetCounter = 0;
function addAsset(tempDir, overrides = {}) {
  assetCounter += 1;
  const filePath = path.join(tempDir, `short-${assetCounter}.mp4`);
  fs.writeFileSync(filePath, Buffer.from('short video bytes'));
  const asset = {
    _id: `6e00000000000000000${String(assetCounter).padStart(5, '0')}`,
    courseId: ids.teacherCourse,
    title: `Short ${assetCounter}`,
    description: '',
    filePath,
    status: 'draft',
    reviewStatus: 'pending',
    generationVersion: 1,
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
    ...overrides,
  };
  store.shortAssets.push(asset);
  return asset;
}

describe('短片成品的上傳恢復與隔離', () => {
  let originalEnv;
  let tempDir;

  beforeEach(() => {
    resetStore();
    youtubeUploadService.resetYouTubeUploadState();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-short-recovery-'));
    env.youtubeUploadEnabled = true;
    env.youtubeUploadAccessToken = 'short-recovery-token';
    env.youtubeUploadMaxAttempts = 3;
    env.youtubeUploadRetryBaseMs = 60000;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadRecoveryBatchSize = 10;
    env.youtubeUploadStuckAfterMs = 15 * MINUTE_MS;
    env.shortScriptAutomationEnabled = true;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    youtubeUploadService.resetYouTubeUploadState();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('可安全重試且已到時間的失敗會重新上傳', async () => {
    const asset = addAsset(tempDir, {
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: new Date(NOW.getTime() - MINUTE_MS) },
    });
    const { fetchImpl } = buildUploadFetch();

    const result = await recoverShortAssetUploads({ fetchImpl, now: NOW });

    assert.deepEqual(result, { recovered: 1, quarantined: 0, skippedItems: 0 });
    assert.equal(asset.youtubeVideoId, 'shortRecov01');
    assert.equal(asset.youtubeUpload.status, 'uploaded');
    assert.equal(asset.youtubeUpload.attemptCount, 2);
  });

  it('還沒到退避時間、不可重試或已達上限的失敗不會撈到', async () => {
    addAsset(tempDir, {
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: new Date(NOW.getTime() + MINUTE_MS) },
    });
    addAsset(tempDir, { youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1 } });
    addAsset(tempDir, { youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 3 } });
    addAsset(tempDir, { status: 'archived', youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1 } });
    const { fetchImpl, calls } = buildUploadFetch();

    const result = await recoverShortAssetUploads({ fetchImpl, now: NOW });

    assert.deepEqual(result, { recovered: 0, quarantined: 0, skippedItems: 0 });
    assert.equal(calls.length, 0);
  });

  it('卡在上傳中超過時限的成品被隔離，不再自動重試', async () => {
    const asset = addAsset(tempDir, {
      youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    });
    const { fetchImpl, calls } = buildUploadFetch();

    const result = await recoverShortAssetUploads({ fetchImpl, now: NOW });

    assert.deepEqual(result, { recovered: 0, quarantined: 1, skippedItems: 0 });
    assert.equal(asset.youtubeUpload.status, 'failed');
    assert.equal(asset.youtubeUpload.retrySafe, false);
    assert.equal(asset.youtubeUpload.nextRetryAt, null);
    assert.equal(asset.youtubeUpload.failedAt, NOW);
    assert.equal(calls.length, 0);
  });

  it('本行程還在上傳的成品不會被誤判為卡住', async () => {
    const asset = addAsset(tempDir);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { fetchImpl } = buildUploadFetch({ gate });

    const upload = shortAssetPublishService.runTrackedShortAssetUpload({ assetId: asset._id, fetchImpl });
    // 等上傳寫入 uploading 後，把最後嘗試時間調到很久以前，模擬傳很久的大檔。
    for (let index = 0; index < 100 && asset.youtubeUpload?.status !== 'uploading'; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    asset.youtubeUpload.lastAttemptAt = new Date(NOW.getTime() - 60 * MINUTE_MS);

    const result = await recoverShortAssetUploads({ fetchImpl, now: NOW });
    release();
    await upload;

    assert.deepEqual(result, { recovered: 0, quarantined: 0, skippedItems: 1 });
    assert.equal(asset.youtubeUpload.status, 'uploaded');
  });

  it('短片自動化關閉時不處理任何成品', async () => {
    env.shortScriptAutomationEnabled = false;
    const asset = addAsset(tempDir, {
      youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    });

    const result = await recoverShortAssetUploads({ now: NOW });

    assert.deepEqual(result, { recovered: 0, quarantined: 0, skippedItems: 0 });
    assert.equal(asset.youtubeUpload.status, 'uploading');
  });

  it('可安全重試的失敗依退避寫入下一次重試時間', async () => {
    const asset = addAsset(tempDir);
    const { fetchImpl } = buildUploadFetch({ failSession: true });

    await assert.rejects(shortAssetPublishService.runTrackedShortAssetUpload({ assetId: asset._id, fetchImpl }));

    assert.equal(asset.youtubeUpload.status, 'failed');
    assert.equal(asset.youtubeUpload.retrySafe, true);
    const delayMs = new Date(asset.youtubeUpload.nextRetryAt).getTime() - new Date(asset.youtubeUpload.failedAt).getTime();
    assert.equal(delayMs, 60000);
  });

  it('退避時間依嘗試次數倍增，達上限或不可重試時為 null', () => {
    const failedAt = new Date('2026-10-20T00:00:00Z');
    const { computeNextRetryAt } = shortAssetPublishService;

    assert.equal(computeNextRetryAt({ retrySafe: true, attemptCount: 2, failedAt }).getTime(), failedAt.getTime() + 120000);
    assert.equal(computeNextRetryAt({ retrySafe: true, attemptCount: 3, failedAt }), null);
    assert.equal(computeNextRetryAt({ retrySafe: false, attemptCount: 1, failedAt }), null);
    // 略過上傳（未設定等）記成 0 次，仍從基本間隔起算。
    assert.equal(computeNextRetryAt({ retrySafe: true, attemptCount: 0, failedAt }).getTime(), failedAt.getTime() + 60000);
  });

  it('影片的恢復排程同一輪也處理短片，結果合併計算', async () => {
    addAsset(tempDir, {
      youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    });
    addAsset(tempDir, { youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: null } });
    const { fetchImpl } = buildUploadFetch();

    const result = await youtubeUploadService.recoverPendingYouTubeUploads({ fetchImpl, now: NOW });

    assert.deepEqual(result, { recovered: 1, quarantined: 1, skipped: false, skippedItems: 0 });
  });

  it('管理員停用上傳時，新成品不送出並記成可重試，留給恢復排程', async () => {
    store.runtimeSettings.push({ key: 'youtubeLifecycle.upload', value: false, history: [] });
    env.youtubeUploadEnabled = true;
    const asset = addAsset(tempDir, { youtubeUpload: { status: null, attemptCount: 0 } });

    await shortAssetPublishService.scheduleUploadOnCreate(asset);

    assert.equal(asset.youtubeVideoId, undefined);
    assert.equal(asset.youtubeUpload.status, 'failed');
    assert.equal(asset.youtubeUpload.retrySafe, true);
    assert.match(asset.youtubeUpload.error, /disabled by an administrator/);
  });

  it('管理員停用上傳時，教師重試短片回 503', async () => {
    store.runtimeSettings.push({ key: 'youtubeLifecycle.upload', value: false, history: [] });
    const asset = addAsset(tempDir, {
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1 },
    });
    const teacher = store.users.find((user) => user._id === ids.teacher);

    await assert.rejects(
      shortAssetPublishService.retryShortAssetUpload({
        user: { id: ids.teacher, role: teacher.role },
        assetId: asset._id,
      }),
      (error) => error.statusCode === 503 && error.code === 'YOUTUBE_UPLOAD_NOT_CONFIGURED',
    );
    assert.equal(asset.youtubeUpload.attemptCount, 1);
  });

  it('恢復開關關閉時短片也不處理', async () => {
    store.runtimeSettings.push({ key: 'youtubeLifecycle.recovery', value: false, history: [] });
    const asset = addAsset(tempDir, {
      youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    });

    const result = await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });

    assert.equal(result.reason, 'recovery_disabled');
    assert.equal(asset.youtubeUpload.status, 'uploading');
  });
});
