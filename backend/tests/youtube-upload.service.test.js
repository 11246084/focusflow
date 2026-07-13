const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const youtubeUploadService = require('../src/services/youtubeUpload.service');

function createResponse({ ok = true, json = {}, text = '', headers = {} } = {}) {
  return {
    ok,
    json: async () => json,
    text: async () => text,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || headers[name] || null;
      },
    },
  };
}

async function drainStream(stream) {
  if (!stream || typeof stream.on !== 'function') {
    return;
  }

  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.resume();
  });
}

describe('youtubeUpload.service', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      youtubeOAuthClientId: env.youtubeOAuthClientId,
      youtubeOAuthClientSecret: env.youtubeOAuthClientSecret,
      youtubeOAuthRefreshToken: env.youtubeOAuthRefreshToken,
      youtubeUploadAccessToken: env.youtubeUploadAccessToken,
      youtubeUploadPrivacyStatus: env.youtubeUploadPrivacyStatus,
      youtubeUploadCategoryId: env.youtubeUploadCategoryId,
    };
    env.youtubeOAuthClientId = '';
    env.youtubeOAuthClientSecret = '';
    env.youtubeOAuthRefreshToken = '';
    env.youtubeUploadAccessToken = '';
    env.youtubeUploadPrivacyStatus = 'unlisted';
    env.youtubeUploadCategoryId = '27';
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('normalizes privacy status and builds watch URLs', () => {
    assert.equal(youtubeUploadService.normalizePrivacyStatus('PUBLIC'), 'public');
    assert.equal(youtubeUploadService.normalizePrivacyStatus('not-valid'), 'unlisted');
    assert.equal(
      youtubeUploadService.buildYouTubeWatchUrl('abc 123'),
      'https://www.youtube.com/watch?v=abc%20123',
    );
  });

  it('refreshes an OAuth token when no access token override is configured', async () => {
    env.youtubeOAuthClientId = 'client-id';
    env.youtubeOAuthClientSecret = 'client-secret';
    env.youtubeOAuthRefreshToken = 'refresh-token';

    const calls = [];
    const token = await youtubeUploadService.fetchAccessToken({
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return createResponse({ json: { access_token: 'fresh-token' } });
      },
    });

    assert.equal(token, 'fresh-token');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, youtubeUploadService.YOUTUBE_TOKEN_URL);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body.get('grant_type'), 'refresh_token');
  });

  it('uploads a local video through the YouTube resumable upload flow', async () => {
    env.youtubeOAuthClientId = 'client-id';
    env.youtubeOAuthClientSecret = 'client-secret';
    env.youtubeOAuthRefreshToken = 'refresh-token';

    const tmpPath = path.join(os.tmpdir(), `focusflow-youtube-${Date.now()}.mp4`);
    fs.writeFileSync(tmpPath, 'fake video bytes');

    const calls = [];
    try {
      const result = await youtubeUploadService.uploadLocalVideo({
        filePath: tmpPath,
        title: 'Lecture upload',
        mimeType: 'video/mp4',
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          if (url === youtubeUploadService.YOUTUBE_TOKEN_URL) {
            return createResponse({ json: { access_token: 'fresh-token' } });
          }
          if (url === youtubeUploadService.YOUTUBE_UPLOAD_URL) {
            return createResponse({ headers: { location: 'https://upload.youtube.test/session' } });
          }
          if (url === 'https://upload.youtube.test/session') {
            await drainStream(options.body);
            return createResponse({ json: { id: 'yt-upload-123' } });
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
      });

      assert.deepEqual(result, {
        youtubeVideoId: 'yt-upload-123',
        videoUrl: 'https://www.youtube.com/watch?v=yt-upload-123',
        privacyStatus: 'unlisted',
      });
      assert.equal(calls.length, 3);
      assert.equal(calls[1].options.headers.Authorization, 'Bearer fresh-token');
      assert.equal(calls[1].options.headers['X-Upload-Content-Type'], 'video/mp4');
      assert.equal(calls[2].options.method, 'PUT');
      assert.equal(calls[2].options.duplex, 'half');
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  it('fails clearly when auto upload credentials are missing', async () => {
    await assert.rejects(
      () => youtubeUploadService.fetchAccessToken({ fetchImpl: async () => createResponse() }),
      (error) => error.statusCode === 503 && error.code === 'YOUTUBE_UPLOAD_NOT_CONFIGURED',
    );
  });
});
