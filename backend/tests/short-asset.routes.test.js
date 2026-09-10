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
    // 退回時轉 private 會先讀 status 再 PUT 回去。
    if (target.includes('/youtube/v3/videos')) {
      if (failAt === 'privatize') return jsonResponse({ error: 'boom' }, { status: 403 });
      if (String(options.method || 'GET').toUpperCase() === 'PUT') {
        return jsonResponse({ id: 'yt-short-1', status: { privacyStatus: 'private' } });
      }
      return jsonResponse({ items: [{ id: 'yt-short-1', status: { privacyStatus: 'unlisted' } }] });
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
    // DR-21 之後每次上傳都會排程 YouTube 上傳，預設攔住，需要特定失敗的測試再自行覆蓋。
    stubYouTubeUpload();
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

    it('同一份腳本尚未上架的資產再上傳時換代，不另建新資產', async () => {
      const script = addScript();
      const previous = addAsset({
        sourceScriptId: script._id,
        sourceVersionNo: 1,
        filePath: writeTempVideo(),
        reviewStatus: 'rejected',
        reviewedGenerationVersion: 1,
        reviewHistory: [{ generationVersion: 1, status: 'rejected', reviewedBy: ids.teacher, reviewedAt: '2026-09-09T00:00:00.000Z', reasons: [] }],
        youtubeUpload: { status: 'failed', error: 'old', attemptCount: 2, retrySafe: false },
      });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm({ versionNo: 2 }),
      });

      assert.equal(response.status, 201);
      assert.equal(store.shortAssets.length, 1);
      assert.equal(response.body.data.id, String(previous._id));
      assert.equal(previous.generationVersion, 2);
      assert.equal(previous.reviewStatus, 'pending');
      assert.equal(previous.sourceVersionNo, 2);
      assert.equal(previous.reviewHistory.length, 1);
      // 上一代的失敗紀錄不能留到新的一代，否則重試判斷會看到舊的失敗。
      await waitFor(() => previous.youtubeUpload.status === 'uploaded');
      assert.equal(previous.youtubeUpload.attemptCount, 1);
      assert.equal(previous.youtubeUpload.error, null);
    });

    it('同一份腳本已進學生牆的資產不換代，另建新資產', async () => {
      const script = addScript();
      addAsset({
        sourceScriptId: script._id,
        sourceVersionNo: 1,
        status: 'published',
        youtubeVideoId: 'yt-existing',
      });
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 201);
      assert.equal(store.shortAssets.length, 2);
    });

    it('上傳當下就把影片以 unlisted 傳上 YouTube 供教師預覽（DR-21）', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });

      assert.equal(response.status, 201);
      // 上傳是背景進行的，回應當下還沒有 youtubeVideoId。
      await waitFor(() => store.shortAssets[0].youtubeVideoId === 'yt-short-1');
      assert.equal(store.shortAssets[0].youtubePrivacyStatus, 'unlisted');
    });

    it('上傳完成也不進學生牆，要等審核通過（DR-21）', async () => {
      const script = addScript();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      await jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/asset`, {
        method: 'POST',
        token,
        body: buildAssetForm(),
      });
      await waitFor(() => store.shortAssets[0].youtubeVideoId === 'yt-short-1');

      // 學生牆撈的是 status=published + publishedAt，兩者都必須維持空的。
      assert.equal(store.shortAssets[0].status, 'draft');
      assert.ok(!store.shortAssets[0].publishedAt);
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

  describe('上架閘門（規格書 R-08 / DR-21）', () => {
    it('未通過成品審核時影片可以上傳，但不得進學生牆', async () => {
      const asset = addAsset({ filePath: writeTempVideo() });

      const uploaded = await publishService.uploadShortAssetToYouTube({ assetId: asset._id });

      assert.equal(uploaded.youtubeVideoId, 'yt-short-1');
      assert.equal(uploaded.status, 'draft');
      assert.ok(!uploaded.publishedAt);
      await assert.rejects(
        () => publishService.publishApprovedShortAsset(asset),
        (error) => error.statusCode === 409 && error.code === 'SHORT_ASSET_NOT_APPROVED',
      );
    });

    it('審核的不是當前 generationVersion 時不得進學生牆', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        youtubeVideoId: 'yt-short-1',
        reviewStatus: 'approved',
        generationVersion: 2,
        reviewedGenerationVersion: 1,
      });

      await assert.rejects(
        () => publishService.publishApprovedShortAsset(asset),
        (error) => error.code === 'SHORT_ASSET_NOT_APPROVED',
      );
    });

    it('影片還沒傳完時審核通過不進學生牆，等上傳成功再補上', async () => {
      const script = addScript();
      const asset = addAsset({
        filePath: writeTempVideo(),
        sourceScriptId: script._id,
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });

      // 上傳還沒完成（沒有 youtubeVideoId）→ 這一步什麼都不做，資產維持 draft。
      assert.equal(await publishService.publishApprovedShortAsset(asset), null);
      assert.equal(asset.status, 'draft');

      const uploaded = await publishService.uploadShortAssetToYouTube({ assetId: asset._id });

      assert.equal(uploaded.status, 'published');
      assert.ok(uploaded.publishedAt);
    });

    it('未確認 AI 揭露與同意時不得上傳', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
        disclosure: { aiDisclosureConfirmed: false, consentConfirmed: false },
      });

      await assert.rejects(
        () => publishService.uploadShortAssetToYouTube({ assetId: asset._id }),
        (error) => error.statusCode === 400 && error.code === 'SHORT_ASSET_DISCLOSURE_REQUIRED',
      );
    });

    it('YOUTUBE_UPLOAD_ENABLED=false 時上傳 fail-fast，不得靜默略過', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      disableYouTube();

      await assert.rejects(
        () => publishService.uploadShortAssetToYouTube({ assetId: asset._id }),
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
        () => publishService.uploadShortAssetToYouTube({ assetId: asset._id }),
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

      await assert.rejects(() => publishService.uploadShortAssetToYouTube({ assetId: asset._id }));

      assert.equal(asset.status, 'draft');
      assert.equal(asset.youtubeVideoId, undefined);
      assert.equal(asset.publishedAt, undefined);
      assert.equal(asset.youtubeUpload.status, 'failed');
      assert.ok(asset.youtubeUpload.error);
    });

    it('上傳成功會寫回 YouTube 資訊，審核已通過時一併進學生牆', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      stubYouTubeUpload();

      const published = await publishService.uploadShortAssetToYouTube({ assetId: asset._id });

      assert.equal(published.status, 'published');
      assert.equal(published.youtubeVideoId, 'yt-short-1');
      assert.equal(published.youtubeAvailability, 'playable');
      assert.equal(published.youtubeUpload.status, 'uploaded');
    });

    it('一律以 unlisted 上傳，不吃 YOUTUBE_UPLOAD_PRIVACY 的設定', async () => {
      // public 會讓非修課者搜尋得到，private 又無法 iframe 嵌入。這個值不是部署可調的設定，
      // 所以就算某台機器的 .env 設成 public，短影片仍必須是 unlisted。
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      const originalPrivacy = env.youtubeUploadPrivacy;
      env.youtubeUploadPrivacy = 'public';
      let sentMetadata = null;
      stubYouTubeUpload();
      const stubbedFetch = global.fetch;
      global.fetch = async (url, options = {}) => {
        if (String(url).includes('uploadType=resumable')) {
          sentMetadata = JSON.parse(options.body);
        }
        return stubbedFetch(url, options);
      };

      try {
        const published = await publishService.uploadShortAssetToYouTube({ assetId: asset._id });
        assert.equal(sentMetadata.status.privacyStatus, 'unlisted');
        assert.equal(published.youtubePrivacyStatus, 'unlisted');
      } finally {
        env.youtubeUploadPrivacy = originalPrivacy;
      }
    });

    it('進學生牆後來源腳本標成 approved（已上架）', async () => {
      const script = addScript();
      script.status = 'generated';
      const asset = addAsset({
        filePath: writeTempVideo(),
        sourceScriptId: script._id,
        sourceVersionNo: 2,
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      stubYouTubeUpload();

      await publishService.uploadShortAssetToYouTube({ assetId: asset._id });

      assert.equal(script.status, 'approved');
    });
  });

  describe('上傳後排程 YouTube 上傳（DR-21）', () => {
    it('feature flag 關閉時不上傳，但要留下可重試的失敗紀錄', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
      });
      env.shortScriptAutomationEnabled = false;

      await publishService.scheduleUploadOnCreate(asset);

      // 沒有這筆紀錄，資產會停在「已上傳、YouTube 狀態空白」，重試路徑找不到失敗紀錄而拒絕。
      assert.equal(asset.status, 'draft');
      assert.equal(asset.youtubeUpload.status, 'failed');
      assert.equal(asset.youtubeUpload.retrySafe, true);
      assert.match(asset.youtubeUpload.error, /SHORT_SCRIPT_AUTOMATION_ENABLED/);
    });

    it('YouTube 未設定時不上傳，但要留下可重試的失敗紀錄', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
      });
      disableYouTube();

      await publishService.scheduleUploadOnCreate(asset);

      assert.equal(asset.youtubeUpload.status, 'failed');
      assert.equal(asset.youtubeUpload.retrySafe, true);
    });

    it('設定好 YouTube 之後，被略過的資產可以重試上傳', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        reviewStatus: 'approved',
        reviewedGenerationVersion: 1,
      });
      disableYouTube();
      await publishService.scheduleUploadOnCreate(asset);
      enableYouTube();
      stubYouTubeUpload();

      const published = await publishService.retryShortAssetUpload({ user: TEACHER, assetId: asset._id });

      assert.equal(published.status, 'published');
    });

    it('不是本功能上傳的資產（沒有 filePath）不寫任何上傳紀錄', async () => {
      const asset = addAsset({ filePath: null });

      assert.equal(publishService.scheduleUploadOnCreate(asset), null);
      assert.equal(asset.youtubeUpload.status, null);
    });
  });

  describe('成品審核決定學生看不看得到（DR-21）', () => {
    it('審核通過後成品進學生牆', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        youtubeVideoId: 'yt-short-1',
        youtubeUpload: {
          status: 'uploaded', error: null, attemptCount: 1, retrySafe: false,
        },
      });

      await shortAssetService.reviewShortAsset({
        assetId: asset._id,
        user: TEACHER,
        status: 'approved',
        expectedGenerationVersion: 1,
      });
      await waitFor(() => asset.status === 'published');

      assert.equal(asset.status, 'published');
      assert.ok(asset.publishedAt);
    });

    it('審核退回時不進學生牆，並把 YouTube 上那支轉 private', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        youtubeVideoId: 'yt-short-1',
        youtubePrivacyStatus: 'unlisted',
        youtubeUpload: {
          status: 'uploaded', error: null, attemptCount: 1, retrySafe: false,
        },
      });

      await shortAssetService.reviewShortAsset({
        assetId: asset._id,
        user: TEACHER,
        status: 'rejected',
        expectedGenerationVersion: 1,
        reasons: [{ code: 'contentIncorrect', note: '講錯了' }],
      });

      assert.equal(asset.status, 'draft');
      assert.ok(!asset.publishedAt);
      assert.equal(asset.youtubePrivacyStatus, 'private');
    });

    it('轉 private 失敗不影響審核結果（fail soft）', async () => {
      const asset = addAsset({
        filePath: writeTempVideo(),
        youtubeVideoId: 'yt-short-1',
        youtubePrivacyStatus: 'unlisted',
        youtubeUpload: {
          status: 'uploaded', error: null, attemptCount: 1, retrySafe: false,
        },
      });
      stubYouTubeUpload({ failAt: 'privatize' });

      const reviewed = await shortAssetService.reviewShortAsset({
        assetId: asset._id,
        user: TEACHER,
        status: 'rejected',
        expectedGenerationVersion: 1,
        reasons: [{ code: 'audioIssue', note: '聲音破音' }],
      });

      assert.equal(reviewed.reviewStatus, 'rejected');
      // 影片仍留在 unlisted，需要人工到 Studio 收尾，但審核本身成立。
      assert.equal(asset.youtubePrivacyStatus, 'unlisted');
    });
  });
});
