const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const publishService = require('../src/services/shortAssetPublish.service');

// 短片成品的 YouTube 生命週期（decisions.md #28～#32）。
// YouTube 一律用假的 fetchImpl；檔案只在每個測試自己建立的暫存目錄。

const ENV_KEYS = [
  'uploadDir',
  'youtubeUploadEnabled',
  'youtubeUploadAccessToken',
  'youtubeUploadMaxAttempts',
  'shortScriptAutomationEnabled',
];

let tempRoot;
let originalEnv;

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
      return response({ id: youtubeId });
    }
    if (String(url).includes('/youtube/v3/videos')) {
      if (options.method === 'PUT') {
        const payload = JSON.parse(options.body);
        privacyUpdates.push(payload);
        return response(payload);
      }
      return response({ items: [{ id: youtubeId, status: { privacyStatus: 'unlisted' } }] });
    }
    throw new Error(`Unexpected fake fetch: ${url}`);
  };
  return { fetchImpl, metadata, privacyUpdates };
}

function useTempUploadDir() {
  beforeEach(() => {
    resetStore();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-short-lifecycle-'));
    env.uploadDir = tempRoot;
    env.youtubeUploadEnabled = true;
    env.youtubeUploadAccessToken = 'test-token';
    env.youtubeUploadMaxAttempts = 3;
    env.shortScriptAutomationEnabled = false;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
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
    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl });

    assert.equal(asset.generationVersion, 2);
    assert.equal(fake.metadata[0].snippet.description, `新版說明\n(FocusFlow short ${asset._id})`);
  });
});
