const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const publishService = require('../src/services/shortAssetPublish.service');
const lifecycleService = require('../src/services/youtubeLifecycle.service');

// 短片成品的 YouTube 生命週期（decisions.md #28～#32）。
// YouTube 一律用假的 fetchImpl；檔案只在每個測試自己建立的暫存目錄。

const ENV_KEYS = [
  'uploadDir',
  'youtubeUploadEnabled',
  'youtubeUploadAccessToken',
  'youtubeUploadMaxAttempts',
  'shortScriptAutomationEnabled',
  'youtubeUploadCleanupEnabled',
  'youtubeUploadCleanupMaxAgeDays',
  'youtubeUploadCleanupMinAgeDays',
  'youtubeUploadCleanupMinFreeGb',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
const NOW = new Date('2026-10-20T00:00:00.000Z');

let tempRoot;
let originalEnv;
let savedFetch;

function addAsset(overrides = {}) {
  const id = newObjectId();
  const filePath = path.join(tempRoot, `${id}.mp4`);
  fs.writeFileSync(filePath, 'short video');
  const asset = {
    _id: id,
    courseId: ids.teacherCourse,
    title: '短片成品',
    description: '',
    filePath,
    status: 'draft',
    reviewStatus: 'pending',
    generationVersion: 1,
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true },
    youtubeUpload: { status: null, attemptCount: 0 },
    ...overrides,
  };
  store.shortAssets.push(asset);
  return asset;
}

function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY_MS);
}

// YouTube 上傳完成的成品；status 決定能不能清理（#30）。
function addUploadedAsset({ status = 'published', uploadedDaysAgo = 200, sizeBytes = 1024, ...overrides } = {}) {
  const asset = addAsset({
    status,
    reviewStatus: status === 'draft' ? 'pending' : 'approved',
    youtubeVideoId: `yt-short-${newObjectId()}`,
    youtubeUpload: { status: 'uploaded', remoteState: 'ready', readyAt: daysAgo(uploadedDaysAgo), attemptCount: 1, uploadedAt: daysAgo(uploadedDaysAgo) },
    ...overrides,
  });
  fs.writeFileSync(asset.filePath, Buffer.alloc(sizeBytes));
  return asset;
}

function setCleanupSwitch(value) {
  const existing = store.runtimeSettings.find((item) => item.key === 'youtubeLifecycle.cleanup');
  if (existing) existing.value = value;
  else store.runtimeSettings.push({ key: 'youtubeLifecycle.cleanup', value, history: [] });
}

const plentyOfSpace = async () => 100 * GB;

function response(payload, headers = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: { get: (key) => headers[String(key).toLowerCase()] || null },
  };
}

// 記下每次上傳送出的 metadata（標題、描述）與改隱私的請求。
function fakeYouTube({ youtubeId = 'short-youtube-id' } = {}) {
  const metadata = [];
  const privacyUpdates = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('uploadType=resumable')) {
      metadata.push(JSON.parse(options.body));
      return response({}, { location: 'https://upload.test/short' });
    }
    if (String(url) === 'https://upload.test/short') {
      for await (const chunk of options.body) assert.ok(chunk.length);
      return response({ id: new URL(url).searchParams.get('id') || youtubeId, status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } });
    }
    if (String(url).includes('/youtube/v3/videos')) {
      if (options.method === 'PUT') {
        const payload = JSON.parse(options.body);
        privacyUpdates.push(payload);
        return response(payload);
      }
      return response({ items: [{ id: new URL(url).searchParams.get('id') || youtubeId, status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } }] });
    }
    throw new Error(`Unexpected fake fetch: ${url}`);
  };
  return { fetchImpl, metadata, privacyUpdates };
}

function useTempUploadDir() {
  beforeEach(() => {
    resetStore();
    savedFetch = global.fetch; global.fetch = fakeYouTube().fetchImpl;
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-short-lifecycle-'));
    env.uploadDir = tempRoot;
    env.youtubeUploadEnabled = true;
    env.youtubeUploadAccessToken = 'test-token';
    env.youtubeUploadMaxAttempts = 3;
    env.shortScriptAutomationEnabled = false;
    env.youtubeUploadCleanupEnabled = true;
    env.youtubeUploadCleanupMaxAgeDays = 180;
    env.youtubeUploadCleanupMinAgeDays = 14;
    env.youtubeUploadCleanupMinFreeGb = 10;
    lifecycleService.resetYouTubeLifecycleStateForTests();
  });

  afterEach(() => {
    lifecycleService.resetYouTubeLifecycleStateForTests();
    Object.assign(env, originalEnv); global.fetch = savedFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
}

describe('短片上傳描述標記（#29）', () => {
  useTempUploadDir();

  it('有描述時末尾加一行標記，資料庫描述保持原文', async () => {
    const asset = addAsset({ description: '教師的說明' });
    const fake = fakeYouTube();

    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl });

    assert.equal(fake.metadata[0].snippet.description, `教師的說明\n(FocusFlow short ${asset._id})`);
    assert.equal(asset.description, '教師的說明');
  });

  it('描述是空的時候只放標記', async () => {
    const asset = addAsset({ description: '  ' });
    const fake = fakeYouTube();

    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl });

    assert.equal(fake.metadata[0].snippet.description, `(FocusFlow short ${asset._id})`);
  });

  it('教師手動重試仍附上同一成品標記', async () => {
    const asset = addAsset({
      description: '重試的說明',
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1 },
    });
    const fake = fakeYouTube();

    await publishService.retryShortAssetUpload({
      assetId: asset._id,
      user: { id: ids.teacher, role: 'teacher' },
      fetchImpl: fake.fetchImpl,
    });

    assert.equal(fake.metadata[0].snippet.description, `重試的說明\n(FocusFlow short ${asset._id})`);
    assert.equal(asset.youtubeUpload.attemptCount, 2);
  });

  it('換代重拍後重新上傳，標記用同一個成品 ID 與新描述', async () => {
    const scriptId = newObjectId();
    store.shortScripts.push({
      _id: scriptId,
      courseId: ids.teacherCourse,
      topic: '重拍主題',
      versions: [{ versionNo: 1 }],
    });
    const asset = addAsset({ sourceScriptId: scriptId, reviewStatus: 'rejected', description: '舊版說明' });
    const replacement = path.join(tempRoot, 'replacement.mp4');
    fs.writeFileSync(replacement, 'replacement');

    await publishService.createAssetFromScript({
      user: { id: ids.teacher, role: 'teacher' },
      scriptId,
      file: { path: replacement },
      description: '新版說明',
      aiDisclosureConfirmed: true,
      consentConfirmed: true,
    });
    const fake = fakeYouTube();
    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl, now: new Date(Date.now() + env.youtubeUploadRetryBaseMs + 1000) });

    assert.equal(asset.generationVersion, 2);
    assert.equal(fake.metadata[0].snippet.description, `新版說明\n(FocusFlow short ${asset._id})`);
  });
});

describe('短片成品的清理候選（#28、#30）', () => {
  useTempUploadDir();

  it('四種狀態中只有已上架與已封存列入，草稿與被退回的不清理', async () => {
    addUploadedAsset({ status: 'draft' });
    addUploadedAsset({ status: 'draft', reviewStatus: 'rejected' });
    const published = addUploadedAsset({ status: 'published' });
    const archived = addUploadedAsset({ status: 'archived', uploadedDaysAgo: 300 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual(
      candidates.map((item) => [item.kind, item.id, item.reason]),
      [['short_asset', String(archived._id), 'max_age'], ['short_asset', String(published._id), 'max_age']],
    );
  });

  it('YouTube 上傳未完成或已清理過的成品不列入', async () => {
    addUploadedAsset({ youtubeUpload: { status: 'failed', attemptCount: 1, uploadedAt: null } });
    addUploadedAsset({ youtubeVideoId: undefined });
    addUploadedAsset({
      youtubeUpload: { status: 'uploaded', uploadedAt: daysAgo(300), localCleanupAt: daysAgo(10) },
    });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual(candidates, []);
  });

  it('保留期從 YouTube 上傳完成起算，不看成品建立時間', async () => {
    const asset = addUploadedAsset({ uploadedDaysAgo: 177, createdAt: daysAgo(400), sizeBytes: 2048 });

    const enable = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });
    const upcoming = await lifecycleService.buildYouTubeCleanupPreview({
      scope: 'upcoming',
      now: NOW,
      getFreeBytes: plentyOfSpace,
    });

    assert.deepEqual(enable, []);
    assert.deepEqual(upcoming.items.map((item) => [item.id, item.sizeBytes]), [[String(asset._id), 2048]]);
    assert.deepEqual(upcoming.items[0].retentionStartAt, daysAgo(177));
    assert.deepEqual(upcoming.items[0].eligibleAt, new Date(NOW.getTime() + 3 * DAY_MS));
  });

  it('空間不足時與一般影片一起從最早上傳完成的開始刪，未滿最短保留期的不刪', async () => {
    const oldest = addUploadedAsset({ uploadedDaysAgo: 60, sizeBytes: 2048 });
    const videoPath = path.join(tempRoot, 'video.mp4');
    fs.writeFileSync(videoPath, Buffer.alloc(2048));
    store.videos.push({
      _id: newObjectId(),
      courseId: ids.teacherCourse,
      title: '一般影片',
      filePath: videoPath,
      youtubeVideoId: 'yt-video',
      processing: { status: 'completed' },
      videoSource: 'youtube', youtubeUpload: { status: 'uploaded', remoteState: 'ready', readyAt: daysAgo(40), uploadedAt: daysAgo(40) },
    });
    addUploadedAsset({ uploadedDaysAgo: 5, sizeBytes: 2048 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({
      now: NOW,
      getFreeBytes: async () => 10 * GB - 3000,
    });

    assert.deepEqual(
      candidates.map((item) => [item.kind, item.reason]),
      [['short_asset', 'low_space'], ['video', 'low_space']],
    );
    assert.equal(candidates[0].id, String(oldest._id));
  });

  it('最長保留期設為 0 時只依空間清理', async () => {
    env.youtubeUploadCleanupMaxAgeDays = 0;
    addUploadedAsset({ uploadedDaysAgo: 999 });

    const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.deepEqual(candidates, []);
  });

  it('UPLOAD_DIR 外，或與其他成品、影片共用同一檔案的不列入', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-short-outside-'));
    try {
      const outsidePath = path.join(outsideDir, 'outside.mp4');
      fs.writeFileSync(outsidePath, 'outside');
      addUploadedAsset({ filePath: outsidePath });
      const sharedWithAsset = addUploadedAsset();
      addAsset({ filePath: sharedWithAsset.filePath });
      const sharedWithVideo = addUploadedAsset();
      store.videos.push({ _id: newObjectId(), courseId: ids.teacherCourse, filePath: sharedWithVideo.filePath });

      const candidates = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

      assert.deepEqual(candidates, []);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('啟用預告與排程實際刪除的清單一致', async () => {
    const expired = addUploadedAsset({ status: 'archived', uploadedDaysAgo: 365, sizeBytes: 3000 });
    const lowSpace = addUploadedAsset({ uploadedDaysAgo: 90, sizeBytes: 3000 });
    addUploadedAsset({ uploadedDaysAgo: 60, sizeBytes: 3000 });
    addUploadedAsset({ status: 'draft', uploadedDaysAgo: 365, sizeBytes: 3000 });
    const diskFiles = store.shortAssets.filter((item) => item.filePath && fs.existsSync(item.filePath))
      .map((item) => ({ path: item.filePath, size: fs.statSync(item.filePath).size }));
    const getFreeBytes = async () => 10 * GB - 5000
      + diskFiles.filter((file) => !fs.existsSync(file.path)).reduce((sum, file) => sum + file.size, 0);

    const preview = await lifecycleService.buildYouTubeCleanupPreview({ scope: 'enable', now: NOW, getFreeBytes });
    setCleanupSwitch(true);
    const run = await lifecycleService.runYouTubeCleanup({ now: NOW, getFreeBytes });

    assert.deepEqual(preview.items.map((item) => item.id), [String(expired._id), String(lowSpace._id)]);
    assert.deepEqual(
      run.results.filter((item) => item.cleaned).map((item) => [item.kind, item.id]),
      preview.items.map((item) => [item.kind, item.id]),
    );
  });
});

describe('短片成品清理後的狀態與行為（#31）', () => {
  useTempUploadDir();

  // 走排程把一支成品清掉，回傳清理前的本機路徑。
  async function cleanAsset(asset) {
    const localPath = asset.filePath;
    setCleanupSwitch(true);
    const run = await lifecycleService.runYouTubeCleanup({ now: NOW, getFreeBytes: plentyOfSpace });
    assert.deepEqual(run.results.map((item) => [item.id, item.cleaned]), [[String(asset._id), true]]);
    return localPath;
  }

  it('清理刪除檔案但保留 filePath，記錄 localCleanupAt，下一輪不再列入', async () => {
    const asset = addUploadedAsset();

    const localPath = await cleanAsset(asset);
    const next = await lifecycleService.listYouTubeCleanupCandidates({ now: NOW, getFreeBytes: plentyOfSpace });

    assert.equal(fs.existsSync(localPath), false);
    assert.equal(asset.filePath, localPath);
    assert.ok(asset.youtubeUpload.localCleanupAt instanceof Date);
    assert.equal(asset.youtubeUpload.localCleanupError, null);
    assert.deepEqual(next, []);
  });

  it('清理開關沒有啟用時不刪檔，回傳 disabled', async () => {
    const asset = addUploadedAsset();
    const source = lifecycleService.CLEANUP_SOURCES.short_asset;

    const result = await source.cleanup(String(asset._id));

    assert.deepEqual(result, { cleaned: false, reason: 'disabled' });
    assert.equal(fs.existsSync(asset.filePath), true);
  });

  it('刪檔前重新確認：已變回草稿的成品不刪', async () => {
    const asset = addUploadedAsset();
    setCleanupSwitch(true);
    asset.status = 'draft';

    const result = await lifecycleService.CLEANUP_SOURCES.short_asset.cleanup(String(asset._id));

    assert.deepEqual(result, { cleaned: false, reason: 'lifecycle_not_complete' });
    assert.equal(fs.existsSync(asset.filePath), true);
  });

  it('刪檔前重新確認：與影片共用同一檔案時不刪並記錄原因', async () => {
    const asset = addUploadedAsset();
    setCleanupSwitch(true);
    store.videos.push({ _id: newObjectId(), courseId: ids.teacherCourse, filePath: asset.filePath });

    const result = await lifecycleService.CLEANUP_SOURCES.short_asset.cleanup(String(asset._id));

    assert.deepEqual(result, { cleaned: false, reason: 'shared_reference' });
    assert.equal(fs.existsSync(asset.filePath), true);
    assert.match(asset.youtubeUpload.localCleanupError, /referenced by another/);
  });

  it('清理後的成品被退回時仍會把 YouTube 影片轉私人', async () => {
    const asset = addUploadedAsset();
    await cleanAsset(asset);
    const fake = fakeYouTube({ youtubeId: asset.youtubeVideoId });

    const updated = await publishService.privatizeRejectedShortAsset(asset, { fetchImpl: fake.fetchImpl });

    assert.notEqual(updated, null);
    assert.equal(fake.privacyUpdates[0].status.privacyStatus, 'private');
    assert.equal(asset.youtubePrivacyStatus, 'private');
  });

  it('清理後的成品核准時仍會上架進學生牆', async () => {
    const asset = addUploadedAsset({ status: 'archived', reviewedGenerationVersion: 1 });
    await cleanAsset(asset);
    asset.status = 'draft';

    const published = await publishService.publishApprovedShortAsset(asset);

    assert.notEqual(published, null);
    assert.equal(asset.status, 'published');
    assert.ok(asset.publishedAt instanceof Date);
  });

  it('清理後重新上傳 YouTube 回傳 SHORT_ASSET_SOURCE_FILE_MISSING 且標為不可重試', async () => {
    const asset = addUploadedAsset();
    await cleanAsset(asset);
    // 例如管理員確認 YouTube 上沒有這支、清掉影片 ID 後重新上傳。
    delete asset.youtubeVideoId;
    Object.assign(asset.youtubeUpload, { status: 'failed', retrySafe: true, attemptCount: 0, nextRetryAt: null });
    const fake = fakeYouTube();

    await assert.rejects(
      () => publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl }),
      (error) => error.code === 'SHORT_ASSET_SOURCE_FILE_MISSING',
    );
    assert.equal(fake.metadata.length, 0);
    assert.deepEqual([asset.youtubeUpload.status, asset.youtubeUpload.retrySafe], ['failed', false]);
  });
});
