const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ids,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const {
  isYouTubeUploadConfigured,
  uploadVideoFileToYouTube,
  autoUploadVideoToYouTube,
  scheduleYouTubeAutoUpload,
} = require('../src/services/youtubeUpload.service');

const originalEnvValues = {
  youtubeUploadEnabled: env.youtubeUploadEnabled,
  youtubeClientId: env.youtubeClientId,
  youtubeClientSecret: env.youtubeClientSecret,
  youtubeRefreshToken: env.youtubeRefreshToken,
  youtubeUploadPrivacy: env.youtubeUploadPrivacy,
};

function enableYouTubeConfig() {
  env.youtubeUploadEnabled = true;
  env.youtubeClientId = 'client-id-for-tests';
  env.youtubeClientSecret = 'client-secret-for-tests';
  env.youtubeRefreshToken = 'refresh-token-for-tests';
  env.youtubeUploadPrivacy = 'unlisted';
}

function restoreEnvConfig() {
  Object.assign(env, originalEnvValues);
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
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

    return jsonResponse({ id: 'ytVideo123' });
  };
}

describe('youtubeUpload.service', () => {
  let tempFilePath;

  beforeEach(() => {
    resetStore();
    enableYouTubeConfig();
    tempFilePath = path.join(os.tmpdir(), `focusflow-yt-test-${Date.now()}.mp4`);
    fs.writeFileSync(tempFilePath, 'fake video bytes');
  });

  afterEach(() => {
    restoreEnvConfig();
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      /* already removed */
    }
  });

  it('未設定憑證時 scheduleYouTubeAutoUpload 直接略過', () => {
    restoreEnvConfig();
    env.youtubeUploadEnabled = false;

    assert.equal(isYouTubeUploadConfigured(), false);
    assert.equal(scheduleYouTubeAutoUpload({ _id: ids.teacherVideo }), null);
  });

  it('uploadVideoFileToYouTube 走完 token -> resumable session -> upload 並回傳影片 id', async () => {
    const calls = [];
    const youtubeVideoId = await uploadVideoFileToYouTube(
      { filePath: tempFilePath, title: '第一講' },
      buildSuccessfulFetchMock(calls),
    );

    assert.equal(youtubeVideoId, 'ytVideo123');
    assert.equal(calls.length, 3);
    assert.match(String(calls[0].url), /oauth2\.googleapis\.com\/token/);
    assert.match(String(calls[1].url), /uploadType=resumable/);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token-for-tests');
    assert.equal(calls[2].url, 'https://upload.youtube.test/session-1');
    assert.equal(calls[2].options.method, 'PUT');
  });

  it('autoUploadVideoToYouTube 成功後回寫 youtubeVideoId 與 youtubeUpload 狀態', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;

    const result = await autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: buildSuccessfulFetchMock([]),
    });

    assert.equal(result, 'ytVideo123');
    assert.equal(video.youtubeVideoId, 'ytVideo123');
    assert.equal(video.videoUrl, 'https://www.youtube.com/watch?v=ytVideo123');
    assert.equal(video.youtubeUpload.status, 'uploaded');
    assert.ok(video.youtubeUpload.uploadedAt);
  });

  it('上傳失敗時標記 failed 並保留錯誤訊息，不拋出例外', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;

    const failingFetch = async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
      }
      return jsonResponse({});
    };

    const result = await autoUploadVideoToYouTube(ids.teacherVideo, { fetchImpl: failingFetch });

    assert.equal(result, null);
    assert.equal(video.youtubeUpload.status, 'failed');
    assert.match(video.youtubeUpload.error, /token refresh failed/);
  });

  it('本地檔案不存在時標記 failed 且不呼叫 YouTube API', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = path.join(os.tmpdir(), 'focusflow-yt-missing-file.mp4');
    video.youtubeVideoId = null;

    const calls = [];
    const result = await autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: buildSuccessfulFetchMock(calls),
    });

    assert.equal(result, null);
    assert.equal(calls.length, 0);
    assert.equal(video.youtubeUpload.status, 'failed');
  });
});
