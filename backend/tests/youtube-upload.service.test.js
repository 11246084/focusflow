const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const youtubeUploadService = require('../src/services/youtubeUpload.service');

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

function buildSuccessfulFetchMock(calls) {
  return async (url, options = {}) => {
    calls.push({ url, options });

    if (String(url).includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'access-token-for-tests' });
    }
    if (String(url).includes('uploadType=resumable')) {
      return jsonResponse({}, { headers: { location: 'https://upload.youtube.test/session-1' } });
    }

    await drainStream(options.body);
    return jsonResponse({ id: 'ytVideo123' });
  };
}

describe('youtubeUpload.service', () => {
  let originalEnv;
  let tempFilePath;

  beforeEach(() => {
    resetStore();
    originalEnv = {
      youtubeUploadEnabled: env.youtubeUploadEnabled,
      youtubeAutoUploadEnabled: env.youtubeAutoUploadEnabled,
      youtubeClientId: env.youtubeClientId,
      youtubeClientSecret: env.youtubeClientSecret,
      youtubeRefreshToken: env.youtubeRefreshToken,
      youtubeOAuthClientId: env.youtubeOAuthClientId,
      youtubeOAuthClientSecret: env.youtubeOAuthClientSecret,
      youtubeOAuthRefreshToken: env.youtubeOAuthRefreshToken,
      youtubeUploadAccessToken: env.youtubeUploadAccessToken,
      youtubeUploadPrivacy: env.youtubeUploadPrivacy,
      youtubeUploadPrivacyStatus: env.youtubeUploadPrivacyStatus,
      youtubeUploadCategoryId: env.youtubeUploadCategoryId,
    };

    env.youtubeUploadEnabled = true;
    env.youtubeAutoUploadEnabled = false;
    env.youtubeClientId = 'client-id-for-tests';
    env.youtubeClientSecret = 'client-secret-for-tests';
    env.youtubeRefreshToken = 'refresh-token-for-tests';
    env.youtubeOAuthClientId = '';
    env.youtubeOAuthClientSecret = '';
    env.youtubeOAuthRefreshToken = '';
    env.youtubeUploadAccessToken = '';
    env.youtubeUploadPrivacy = 'unlisted';
    env.youtubeUploadPrivacyStatus = 'unlisted';
    env.youtubeUploadCategoryId = '27';

    tempFilePath = path.join(os.tmpdir(), `focusflow-yt-test-${Date.now()}.mp4`);
    fs.writeFileSync(tempFilePath, 'fake video bytes');
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    fs.rmSync(tempFilePath, { force: true });
  });

  it('正規化隱私狀態並建立 watch URL', () => {
    assert.equal(youtubeUploadService.normalizePrivacyStatus('PUBLIC'), 'public');
    assert.equal(youtubeUploadService.normalizePrivacyStatus('not-valid'), 'unlisted');
    assert.equal(
      youtubeUploadService.buildYouTubeWatchUrl('abc 123'),
      'https://www.youtube.com/watch?v=abc%20123',
    );
  });

  it('沒有 access token override 時使用 refresh token 取得 OAuth token', async () => {
    const calls = [];
    const token = await youtubeUploadService.fetchAccessToken({
      fetchImpl: buildSuccessfulFetchMock(calls),
    });

    assert.equal(token, 'access-token-for-tests');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, youtubeUploadService.YOUTUBE_TOKEN_URL);
    assert.equal(calls[0].options.body.get('grant_type'), 'refresh_token');
  });

  it('uploadLocalVideo 走完 resumable upload 並回傳播放資訊', async () => {
    const calls = [];
    const result = await youtubeUploadService.uploadLocalVideo({
      filePath: tempFilePath,
      title: 'Lecture upload',
      mimeType: 'video/mp4',
      fetchImpl: buildSuccessfulFetchMock(calls),
    });

    assert.deepEqual(result, {
      youtubeVideoId: 'ytVideo123',
      videoUrl: 'https://www.youtube.com/watch?v=ytVideo123',
      privacyStatus: 'unlisted',
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token-for-tests');
    assert.equal(calls[1].options.headers['X-Upload-Content-Type'], 'video/mp4');
    assert.equal(calls[2].options.method, 'PUT');
  });

  it('缺少 OAuth 憑證時回傳明確的設定錯誤', async () => {
    env.youtubeClientId = '';
    env.youtubeClientSecret = '';
    env.youtubeRefreshToken = '';

    await assert.rejects(
      () => youtubeUploadService.fetchAccessToken({ fetchImpl: async () => jsonResponse({}) }),
      (error) => error.statusCode === 503 && error.code === 'YOUTUBE_UPLOAD_NOT_CONFIGURED',
    );
  });

  it('未啟用時 scheduleYouTubeAutoUpload 直接略過', () => {
    env.youtubeUploadEnabled = false;
    env.youtubeAutoUploadEnabled = false;

    assert.equal(youtubeUploadService.isYouTubeUploadConfigured(), false);
    assert.equal(youtubeUploadService.scheduleYouTubeAutoUpload({ _id: ids.teacherVideo }), null);
  });

  it('uploadVideoFileToYouTube 相容入口回傳影片 id', async () => {
    const calls = [];
    const youtubeVideoId = await youtubeUploadService.uploadVideoFileToYouTube(
      { filePath: tempFilePath, title: '第一講' },
      buildSuccessfulFetchMock(calls),
    );

    assert.equal(youtubeVideoId, 'ytVideo123');
    assert.equal(calls.length, 3);
  });

  it('autoUploadVideoToYouTube 成功後回寫影片與上傳狀態', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;

    const result = await youtubeUploadService.autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: buildSuccessfulFetchMock([]),
    });

    assert.equal(result, 'ytVideo123');
    assert.equal(video.youtubeVideoId, 'ytVideo123');
    assert.equal(video.videoUrl, 'https://www.youtube.com/watch?v=ytVideo123');
    assert.equal(video.youtubeUpload.status, 'uploaded');
    assert.ok(video.youtubeUpload.uploadedAt);
  });

  it('上傳失敗時標記 failed 並保留錯誤訊息', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;

    const result = await youtubeUploadService.autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: async (url) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
        }
        return jsonResponse({});
      },
    });

    assert.equal(result, null);
    assert.equal(video.youtubeUpload.status, 'failed');
    assert.match(video.youtubeUpload.error, /token refresh failed/i);
  });

  it('本地檔案不存在時標記 failed 且不呼叫 YouTube API', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = path.join(os.tmpdir(), 'focusflow-yt-missing-file.mp4');
    video.youtubeVideoId = null;
    const calls = [];

    const result = await youtubeUploadService.autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: buildSuccessfulFetchMock(calls),
    });

    assert.equal(result, null);
    assert.equal(calls.length, 0);
    assert.equal(video.youtubeUpload.status, 'failed');
  });
});
