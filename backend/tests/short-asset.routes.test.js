const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const shortAssetService = require('../src/services/shortAsset.service');
const publishService = require('../src/services/shortAssetPublish.service');
const env = require('../src/config/env');
const {
  cleanupTestUploads,
  ids,
  jsonRequest,
  loginAs,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };
const originalFetch = global.fetch;

function enableFeature() {
  env.shortScriptAutomationEnabled = true;
}

function enableYouTube() {
  env.youtubeUploadEnabled = true;
  env.youtubeUploadAccessToken = 'test-access-token';
  env.youtubeUploadMaxAttempts = 3;
}

function disableYouTube() {
  env.youtubeUploadEnabled = false;
  env.youtubeUploadAccessToken = '';
}

// 只攔 YouTube 相關請求，其餘（登入等）照原樣送出——整組換掉會把登入也攔下來。
function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

async function waitFor(predicate, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  throw new Error('Timed out waiting for the short asset to publish.');
}

async function drainStream(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.resume();
  });
}

function stubYouTubeUpload({ failAt = null } = {}) {
  global.fetch = async (url, options = {}) => {
    const target = String(url);

    if (target.includes('oauth2.googleapis.com/token')) {
      if (failAt === 'token') return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
      return jsonResponse({ access_token: 'access-token-for-tests' });
    }
    if (target.includes('uploadType=resumable')) {
      if (failAt === 'session') return jsonResponse({ error: 'boom' }, { status: 500 });
      return jsonResponse({}, { headers: { location: 'https://upload.youtube.test/session-1' } });
    }
    if (target.includes('upload.youtube.test')) {
      await drainStream(options.body);
      if (failAt === 'bytes') return jsonResponse({ error: 'boom' }, { status: 500 });
      return jsonResponse({ id: 'yt-short-1' });
    }

    return originalFetch(url, options);
  };
}

function addScript({ versionCount = 2 } = {}) {
  const versions = [];
  for (let index = 1; index <= versionCount; index += 1) {
    versions.push({ versionNo: index, payload: { shots: [] }, generatedAt: '2026-09-01T00:00:00.000Z' });
  }
  const script = {
    _id: newObjectId(),
    courseId: ids.teacherCourse,
    topic: '什麼是過擬合',
    topicKey: '什麼是過擬合',
    evidence: [],
    versions,
    status: 'approved',
    createdBy: ids.teacher,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  store.shortScripts.push(script);
  return script;
}

function addAsset(patch = {}) {
  const asset = {
    _id: newObjectId(),
    courseId: ids.teacherCourse,
    sourceScriptId: null,
    sourceVersionNo: null,
    title: '過擬合短影片',
    description: '',
    status: 'draft',
    reviewStatus: 'pending',
    reviewedGenerationVersion: null,
    reviewHistory: [],
    generationVersion: 1,
    filePath: null,
    disclosure: {
      aiDisclosureConfirmed: true,
      consentConfirmed: true,
      confirmedBy: ids.teacher,
      confirmedAt: '2026-09-09T00:00:00.000Z',
    },
    youtubeUpload: {
      status: null, error: null, attemptCount: 0, lastAttemptAt: null, uploadedAt: null, failedAt: null, retrySafe: false,
    },
    createdAt: '2026-09-09T00:00:00.000Z',
    ...patch,
  };
  store.shortAssets.push(asset);
  return asset;
}

// 寫一個真的存在的檔案，讓上架流程走到 uploadLocalVideo 而不是「檔案不見」分支。
function writeTempVideo() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const filePath = `${env.uploadDir}/test-upload-short-asset.mp4`;
  fs.writeFileSync(filePath, 'test short video binary');
  return filePath;
}

function buildAssetForm({ file = true, disclosure = true, versionNo } = {}) {
  const form = new FormData();
  form.append('title', '過擬合短影片');
  if (disclosure) {
    form.append('aiDisclosureConfirmed', 'true');
    form.append('consentConfirmed', 'true');
  }
  if (versionNo) form.append('versionNo', String(versionNo));
  if (file) {
    form.append('video', new Blob(['short video binary'], { type: 'video/mp4' }), 'test-upload-short.mp4');
  }
  return form;
}

describe('短影片上架（WO-08）', () => {
  let server;
  let baseUrl;

  before(async () => { ({ server, baseUrl } = await startServer()); });
  after(async () => {
    await stopServer(server);
    cleanupTestUploads();
  });

  beforeEach(() => {
    resetStore();
    enableFeature();
    enableYouTube();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    disableYouTube();
    env.shortScriptAutomationEnabled = false;
    cleanupTestUploads();
  });

  describe('POST /short-scripts/:scriptId/asset', () => {
    it('教師上傳影片檔後建立 draft，並記錄腳本與版本', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm({ versionNo: 1 }),
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.data.status, 'draft');
      assert.equal(response.body.data.reviewStatus, 'pending');
      assert.equal(response.body.data.sourceScriptId, String(script._id));
      assert.equal(response.body.data.sourceVersionNo, 1);
    });

    it('上傳本身不觸發上架，也不產生 youtubeVideoId', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      stubYouTubeUpload();

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.body.data.youtubeVideoId, null);
      assert.equal(store.shortAssets[0].status, 'draft');
    });

    it('未確認 AI 揭露與書面同意時回 SHORT_ASSET_DISCLOSURE_REQUIRED', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm({ disclosure: false }),
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'SHORT_ASSET_DISCLOSURE_REQUIRED');
      assert.equal(store.shortAssets.length, 0);
    });

    it('沒有帶影片檔時回 VALIDATION_ERROR', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm({ file: false }),
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    });

    it('腳本還沒有任何版本時不得上傳', async () => {
      const script = addScript({ versionCount: 0 });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'SHORT_SCRIPT_STATE_INVALID');
    });

    it('未登入回 401', async () => {
      const script = addScript();
      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        body: buildAssetForm(),
      });

      assert.equal(response.status, 401);
    });

    it('非課程擁有者回 403', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'COURSE_MANAGE_DENIED');
    });

    it('腳本不存在回 SHORT_SCRIPT_NOT_FOUND', async () => {
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${newObjectId()}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'SHORT_SCRIPT_NOT_FOUND');
    });

    it('feature flag 關閉時回 404', async () => {
      const script = addScript();
      env.shortScriptAutomationEnabled = false;
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    });
  });

  describe('GET /courses/:courseId/short-assets', () => {
    it('列出該課程的短影片資產', async () => {
      addAsset();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-assets`, { token });

      assert.equal(response.status, 200);
      assert.equal(response.body.data.length, 1);
      assert.equal(response.body.meta.total, 1);
    });

    it('未登入回 401', async () => {
      const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-assets`);
      assert.equal(response.status, 401);
    });

    it('非課程擁有者回 403', async () => {
      const token = await loginAs(baseUrl, 'teacher2@focusflow.local', 'Teacher123!');
      const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-assets`, { token });

      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'COURSE_MANAGE_DENIED');
    });

    it('feature flag 關閉時回 404', async () => {
      env.shortScriptAutomationEnabled = false;
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-assets`, { token });

      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    });
  });

  describe('POST /short-assets/:assetId/upload/retry', () => {
    it('上一次失敗且確定沒送出 bytes 時可重試並上架', async () => {
      const filePath = writeTempVideo();
      addAsset({
        filePath,
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
        youtubeUpload: {
          status: 'failed', error: 'token exchange failed', attemptCount: 1, retrySafe: true,
        },
      });
      stubYouTubeUpload();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, 'published');
      assert.equal(response.body.data.youtubeVideoId, 'yt-short-1');
    });

    it('可能已送出 bytes 時拒絕重試，避免 YouTube 出現重複影片', async () => {
      addAsset({
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
        youtubeUpload: { status: 'failed', attemptCount: 1, retrySafe: false },
      });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'YOUTUBE_UPLOAD_RETRY_UNSAFE');
    });

    it('沒有失敗紀錄時不得重試', async () => {
      addAsset({ reviewStatus: 'approved', reviewedGenerationVersion: 1 });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'YOUTUBE_UPLOAD_RETRY_NOT_ALLOWED');
    });

    it('已上架的資產不得再重試', async () => {
      addAsset({ youtubeVideoId: 'yt-existing', status: 'published' });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'YOUTUBE_UPLOAD_ALREADY_COMPLETED');
    });

    it('未登入回 401', async () => {
      addAsset();
      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST' },
      );

      assert.equal(response.status, 401);
    });

    it('非課程擁有者回 403', async () => {
      addAsset();
      const token = await loginAs(baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'COURSE_MANAGE_DENIED');
    });

    it('資產不存在回 SHORT_ASSET_NOT_FOUND', async () => {
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${newObjectId()}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'SHORT_ASSET_NOT_FOUND');
    });

    it('feature flag 關閉時回 404', async () => {
      addAsset();
      env.shortScriptAutomationEnabled = false;
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(
        baseUrl,
        `/api/v1/short-assets/${store.shortAssets[0]._id}/upload/retry`,
        { method: 'POST', token },
      );

      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    });
  });

  describe('上架閘門（規格書 R-08）', () => {
    it('未通過成品審核不得上架', async () => {
      const asset = addAsset({ filePath: writeTempVideo() });

      await assert.rejects(
        () => publishService.publishShortAsset({ assetId: asset._id }),
        (error) => error.statusCode === 409 && error.code === 'SHORT_ASSET_NOT_APPROVED',
      );
    });

    it('審核的不是當前 generationVersion 時不得上架', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        generationVersion: 2,
        reviewedGenerationVersion: 1,
      });

      await assert.rejects(
        () => publishService.publishShortAsset({ assetId: asset._id }),
        (error) => error.code === 'SHORT_ASSET_NOT_APPROVED',
      );
    });

    it('未確認 AI 揭露與同意時不得上架', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
        disclosure: { aiDisclosureConfirmed: false, consentConfirmed: false },
      });

      await assert.rejects(
        () => publishService.publishShortAsset({ assetId: asset._id }),
        (error) => error.statusCode === 400 && error.code === 'SHORT_ASSET_DISCLOSURE_REQUIRED',
      );
    });

    it('YOUTUBE_UPLOAD_ENABLED=false 時 fail-fast，不得靜默略過', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      disableYouTube();

      await assert.rejects(
        () => publishService.publishShortAsset({ assetId: asset._id }),
        (error) => error.statusCode === 503 && error.code === 'YOUTUBE_UPLOAD_NOT_CONFIGURED',
      );
      assert.equal(asset.status, 'draft');
    });

    it('影片檔不見時維持 draft 並記錄不可重試', async () => {
      const asset = addAsset({
        filePath: `${env.uploadDir}/test-upload-does-not-exist.mp4`,
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });

      await assert.rejects(
        () => publishService.publishShortAsset({ assetId: asset._id }),
        (error) => error.code === 'SHORT_ASSET_SOURCE_FILE_MISSING',
      );
      assert.equal(asset.status, 'draft');
      assert.equal(asset.youtubeUpload.status, 'failed');
      assert.equal(asset.youtubeUpload.retrySafe, false);
    });

    it('上架失敗時維持 draft、記錄原因，不留半完成狀態', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      stubYouTubeUpload({ failAt: 'bytes' });

      await assert.rejects(() => publishService.publishShortAsset({ assetId: asset._id }));

      assert.equal(asset.status, 'draft');
      assert.equal(asset.youtubeVideoId, undefined);
      assert.equal(asset.publishedAt, undefined);
      assert.equal(asset.youtubeUpload.status, 'failed');
      assert.ok(asset.youtubeUpload.error);
    });

    it('通過審核後上架成功會寫回 YouTube 資訊', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      stubYouTubeUpload();

      const published = await publishService.publishShortAsset({ assetId: asset._id });

      assert.equal(published.status, 'published');
      assert.equal(published.youtubeVideoId, 'yt-short-1');
      assert.equal(published.youtubeAvailability, 'playable');
      assert.equal(published.youtubeUpload.status, 'uploaded');
    });
  });

  describe('成品審核通過會觸發上架', () => {
    it('feature flag 關閉時不排程上架', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      env.shortScriptAutomationEnabled = false;

      assert.equal(publishService.schedulePublishOnApproval(asset), null);
    });

    it('YouTube 未設定時不排程上架', async () => {
      const asset = addAsset({ reviewStatus: 'approved', reviewedGenerationVersion: 1 });
      disableYouTube();

      assert.equal(publishService.schedulePublishOnApproval(asset), null);
    });

    it('審核通過後排程上架，成品變成 published', async () => {
      const asset = addAsset({ filePath: writeTempVideo() });
      stubYouTubeUpload();

      await shortAssetService.reviewShortAsset({
        assetId: asset._id,
        user: TEACHER,
        status: 'approved',
        expectedGenerationVersion: 1,
      });
      // 上架刻意不擋審核回應（同步做會讓審核請求逾時），所以這裡輪詢等它跑完。
      await waitFor(() => asset.status === 'published');

      assert.equal(asset.status, 'published');
      assert.equal(asset.youtubeVideoId, 'yt-short-1');
    });

    it('審核退回時不上架', async () => {
      const asset = addAsset({ filePath: writeTempVideo() });
      stubYouTubeUpload();

      await shortAssetService.reviewShortAsset({
        assetId: asset._id,
        user: TEACHER,
        status: 'rejected',
        expectedGenerationVersion: 1,
        reasons: [{ code: 'contentIncorrect', note: '講錯了' }],
      });

      assert.equal(asset.status, 'draft');
      assert.equal(asset.youtubeVideoId, undefined);
    });
  });
});
