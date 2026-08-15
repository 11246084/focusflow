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

async function waitFor(predicate, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for asynchronous upload state.');
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

function buildPrivacyFetchMock(calls, currentStatus = { privacyStatus: 'unlisted' }, {
  scope = 'https://www.googleapis.com/auth/youtube.force-ssl',
} = {}) {
  return async (url, options = {}) => {
    calls.push({ url, options });

    if (String(url).includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'access-token-for-tests', scope });
    }
    if (options.method === 'PUT') {
      return jsonResponse({ id: 'ytVideo123', status: JSON.parse(options.body).status });
    }
    return jsonResponse({ items: [{ id: 'ytVideo123', status: currentStatus }] });
  };
}

describe('youtubeUpload.service', () => {
  let originalEnv;
  let tempFilePath;

  beforeEach(() => {
    resetStore();
    youtubeUploadService.resetYouTubeUploadState();
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
      youtubePrivatizeOnDelete: env.youtubePrivatizeOnDelete,
      youtubeUploadMaxAttempts: env.youtubeUploadMaxAttempts,
      youtubeUploadRetryBaseMs: env.youtubeUploadRetryBaseMs,
      youtubeUploadRecoveryEnabled: env.youtubeUploadRecoveryEnabled,
      youtubeUploadRecoveryBatchSize: env.youtubeUploadRecoveryBatchSize,
      youtubeUploadStuckAfterMs: env.youtubeUploadStuckAfterMs,
      youtubeUploadCleanupEnabled: env.youtubeUploadCleanupEnabled,
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
    env.youtubePrivatizeOnDelete = true;
    env.youtubeUploadMaxAttempts = 3;
    env.youtubeUploadRetryBaseMs = 0;
    env.youtubeUploadRecoveryEnabled = false;
    env.youtubeUploadRecoveryBatchSize = 5;
    env.youtubeUploadStuckAfterMs = 900000;
    env.youtubeUploadCleanupEnabled = false;

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
    assert.equal(video.youtubeUpload.attemptCount, 1);
    assert.equal(video.sourceUrl, 'https://www.youtube.com/watch?v=ytVideo123');
    assert.equal(video.videoSource, 'youtube');
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
    assert.equal(video.youtubeUpload.retrySafe, true);
    assert.ok(video.youtubeUpload.nextRetryAt);
  });

  it('上傳串流階段發生不確定錯誤時禁止自動重試以避免重複影片', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;

    await youtubeUploadService.autoUploadVideoToYouTube(ids.teacherVideo, {
      fetchImpl: async (url) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'token' });
        }
        if (String(url).includes('uploadType=resumable')) {
          return jsonResponse({}, { headers: { location: 'https://upload.youtube.test/ambiguous' } });
        }
        throw new Error('socket closed after upload bytes were sent');
      },
    });

    assert.equal(video.youtubeUpload.status, 'failed');
    assert.equal(video.youtubeUpload.retrySafe, false);
    assert.equal(video.youtubeUpload.nextRetryAt, null);
  });

  it('啟動 recovery 只重試安全失敗，並隔離逾時 uploading 紀錄', async () => {
    env.youtubeUploadRecoveryEnabled = true;
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;
    video.youtubeUpload = {
      status: 'failed',
      attemptCount: 1,
      retrySafe: true,
      nextRetryAt: new Date(0),
    };

    const recovered = await youtubeUploadService.recoverPendingYouTubeUploads({
      fetchImpl: buildSuccessfulFetchMock([]),
      now: new Date('2026-08-12T00:00:00.000Z'),
    });
    assert.deepEqual(recovered, { recovered: 1, quarantined: 0, skipped: false });
    assert.equal(video.youtubeUpload.status, 'uploaded');

    resetStore();
    const stale = store.videos.find((item) => item._id === ids.teacherVideo);
    stale.youtubeVideoId = null;
    stale.youtubeUpload = {
      status: 'uploading',
      attemptCount: 1,
      lastAttemptAt: '2026-08-11T00:00:00.000Z',
    };
    const quarantined = await youtubeUploadService.recoverPendingYouTubeUploads({
      fetchImpl: async () => { throw new Error('must not call YouTube'); },
      now: new Date('2026-08-12T00:00:00.000Z'),
    });
    assert.deepEqual(quarantined, { recovered: 0, quarantined: 1, skipped: false });
    assert.equal(stale.youtubeUpload.status, 'failed');
    assert.equal(stale.youtubeUpload.retrySafe, false);
    assert.match(stale.youtubeUpload.error, /review YouTube Studio/i);
  });

  it('課程 owner 可排程安全失敗的重試，完成後受 bounded attempt 保護', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;
    video.youtubeUpload = { status: 'failed', attemptCount: 1, retrySafe: true };

    const result = await youtubeUploadService.scheduleYouTubeUploadRetry(
      ids.teacherVideo,
      { id: ids.teacher, role: 'teacher' },
      { fetchImpl: buildSuccessfulFetchMock([]) },
    );
    await waitFor(() => video.youtubeUpload?.status === 'uploaded');

    assert.deepEqual(result, { videoId: ids.teacherVideo, status: 'retry_scheduled' });
    assert.equal(video.youtubeUpload.attemptCount, 2);
    assert.equal(video.youtubeVideoId, 'ytVideo123');
  });

  it('不確定是否已完成的 upload 禁止由 retry API 重傳', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = null;
    video.youtubeUpload = { status: 'failed', attemptCount: 1, retrySafe: false };

    await assert.rejects(
      () => youtubeUploadService.scheduleYouTubeUploadRetry(
        ids.teacherVideo,
        { id: ids.teacher, role: 'teacher' },
        { fetchImpl: async () => { throw new Error('must not upload'); } },
      ),
      (error) => error.code === 'YOUTUBE_UPLOAD_RETRY_UNSAFE' && error.statusCode === 409,
    );
  });

  it('安全清理只在 YouTube 與 processing 都完成且路徑位於 UPLOAD_DIR 時刪除', async () => {
    env.youtubeUploadCleanupEnabled = true;
    const cleanupPath = path.join(env.uploadDir, `test-upload-youtube-cleanup-${Date.now()}.mp4`);
    fs.mkdirSync(env.uploadDir, { recursive: true });
    fs.writeFileSync(cleanupPath, 'cleanup fixture');
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = cleanupPath;
    video.youtubeVideoId = 'ytCleanup123';
    video.youtubeUpload = { status: 'uploaded', uploadedAt: new Date() };
    video.processing = { status: 'completed' };

    const result = await youtubeUploadService.cleanupUploadedLocalVideo(ids.teacherVideo);

    assert.deepEqual(result, { cleaned: true, reason: null });
    assert.equal(fs.existsSync(cleanupPath), false);
    assert.equal(video.filePath, null);
    assert.equal(video.sourceUrl, 'https://www.youtube.com/watch?v=ytCleanup123');
    assert.equal(video.videoSource, 'youtube');
    assert.ok(video.youtubeUpload.localCleanupAt);
  });

  it('安全清理拒絕 UPLOAD_DIR 外的檔案', async () => {
    env.youtubeUploadCleanupEnabled = true;
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = tempFilePath;
    video.youtubeVideoId = 'ytOutside123';
    video.youtubeUpload = { status: 'uploaded', uploadedAt: new Date() };
    video.processing = { status: 'completed' };

    const result = await youtubeUploadService.cleanupUploadedLocalVideo(ids.teacherVideo);

    assert.deepEqual(result, { cleaned: false, reason: 'unsafe_path' });
    assert.equal(fs.existsSync(tempFilePath), true);
    assert.match(video.youtubeUpload.localCleanupError, /outside UPLOAD_DIR/i);
  });

  it('安全清理拒絕仍被其他 Video 共用的本地檔案', async () => {
    env.youtubeUploadCleanupEnabled = true;
    const cleanupPath = path.join(env.uploadDir, `test-upload-youtube-shared-${Date.now()}.mp4`);
    fs.mkdirSync(env.uploadDir, { recursive: true });
    fs.writeFileSync(cleanupPath, 'shared cleanup fixture');
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.filePath = cleanupPath;
    video.youtubeVideoId = 'ytShared123';
    video.youtubeUpload = { status: 'uploaded', uploadedAt: new Date() };
    video.processing = { status: 'completed' };
    store.videos.push({
      _id: '507f191e810c19729de86fff',
      courseId: ids.teacherCourse,
      filePath: cleanupPath,
    });

    try {
      const result = await youtubeUploadService.cleanupUploadedLocalVideo(ids.teacherVideo);

      assert.deepEqual(result, { cleaned: false, reason: 'shared_reference' });
      assert.equal(fs.existsSync(cleanupPath), true);
      assert.match(video.youtubeUpload.localCleanupError, /another Video/i);
    } finally {
      const sharedIndex = store.videos.findIndex((item) => item._id === '507f191e810c19729de86fff');
      if (sharedIndex >= 0) store.videos.splice(sharedIndex, 1);
      if (fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
    }
  });

  it('setVideoPrivacy 讀回現有 status 後只覆寫 privacyStatus', async () => {
    const calls = [];
    const result = await youtubeUploadService.setVideoPrivacy({
      youtubeVideoId: 'ytVideo123',
      fetchImpl: buildPrivacyFetchMock(calls, {
        privacyStatus: 'unlisted',
        license: 'creativeCommon',
        embeddable: false,
        uploadStatus: 'processed',
      }),
    });

    assert.deepEqual(result, { youtubeVideoId: 'ytVideo123', privacyStatus: 'private' });

    const updateCall = calls.find((call) => call.options.method === 'PUT');
    const body = JSON.parse(updateCall.options.body);
    assert.equal(body.id, 'ytVideo123');
    assert.equal(body.status.privacyStatus, 'private');
    assert.equal(body.status.license, 'creativeCommon');
    assert.equal(body.status.embeddable, false);
    // uploadStatus 是唯讀欄位，不應該被帶回 update request
    assert.equal(body.status.uploadStatus, undefined);
  });

  it('setVideoPrivacy 不接受未支援的隱私狀態', async () => {
    await assert.rejects(
      () => youtubeUploadService.setVideoPrivacy({
        youtubeVideoId: 'ytVideo123',
        privacyStatus: 'secret',
        fetchImpl: buildPrivacyFetchMock([]),
      }),
      (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
    );
  });

  it('privatizeVideoOnDelete 只處理 FocusFlow 自己上傳的影片', async () => {
    const calls = [];
    // 教師貼 YouTube URL 建立的影片：有 youtubeVideoId 但沒有 youtubeUpload 紀錄
    const pastedVideo = { youtubeVideoId: 'someoneElseVideo', youtubeUpload: null };

    assert.equal(youtubeUploadService.isFocusFlowUploadedVideo(pastedVideo), false);
    const result = await youtubeUploadService.privatizeVideoOnDelete(pastedVideo, {
      fetchImpl: buildPrivacyFetchMock(calls),
    });

    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  it('privatizeVideoOnDelete 在 YouTube 失敗時不拋出，讓刪除流程繼續', async () => {
    const video = {
      youtubeVideoId: 'ytVideo123',
      youtubeUpload: { status: 'uploaded' },
    };

    const result = await youtubeUploadService.privatizeVideoOnDelete(video, {
      fetchImpl: async (url) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'access-token-for-tests' });
        }
        return jsonResponse({ error: { message: 'insufficient scope' } }, { status: 403 });
      },
    });

    assert.equal(result, null);
  });

  it('未設定憑證時 privatizeVideoOnDelete 靜默略過', async () => {
    env.youtubeClientId = '';
    env.youtubeClientSecret = '';
    env.youtubeRefreshToken = '';
    env.youtubeUploadAccessToken = '';
    const calls = [];

    assert.equal(youtubeUploadService.isPrivatizeOnDeleteConfigured(), false);
    const result = await youtubeUploadService.privatizeVideoOnDelete(
      { youtubeVideoId: 'ytVideo123', youtubeUpload: { status: 'uploaded' } },
      { fetchImpl: buildPrivacyFetchMock(calls) },
    );

    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  it('privatizeVideosOnDelete 逐支處理課程底下的影片', async () => {
    const calls = [];
    const results = await youtubeUploadService.privatizeVideosOnDelete(
      [
        { youtubeVideoId: 'ytA', youtubeUpload: { status: 'uploaded' } },
        { youtubeVideoId: 'ytB', youtubeUpload: { status: 'failed' } },
        { youtubeVideoId: 'ytC', youtubeUpload: { status: 'uploaded' } },
      ],
      { fetchImpl: buildPrivacyFetchMock(calls) },
    );

    assert.deepEqual(results.map((item) => item.youtubeVideoId), ['ytA', 'ytC']);
    assert.equal(calls.filter((call) => call.options.method === 'PUT').length, 2);
  });

  it('health snapshot 在尚未做過 token 交換時標記 unverified', () => {
    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(snapshot.readiness, 'ready');
    assert.equal(snapshot.credentialsConfigured, true);
    assert.equal(snapshot.credentialCheck.status, 'unknown');
    assert.equal(snapshot.privatizeScopeSatisfied, null);
    assert.ok(snapshot.warnings.some((item) => item.code === 'YOUTUBE_CREDENTIALS_UNVERIFIED'));
  });

  it('health snapshot 在憑證缺漏時回 hard_fail 並列出缺少的設定', () => {
    env.youtubeClientId = '';
    env.youtubeClientSecret = '';
    env.youtubeRefreshToken = '';

    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(snapshot.readiness, 'hard_fail');
    assert.equal(snapshot.credentialsConfigured, false);
    assert.deepEqual(snapshot.missingConfig, [
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET',
      'YOUTUBE_REFRESH_TOKEN',
    ]);
    assert.ok(snapshot.hardFailures.some((item) => item.code === 'YOUTUBE_CREDENTIALS_MISSING'));
  });

  it('health snapshot 在兩個 feature 都關閉時回 not_enabled', () => {
    env.youtubeUploadEnabled = false;
    env.youtubePrivatizeOnDelete = false;

    assert.equal(youtubeUploadService.buildYouTubeUploadSnapshot().readiness, 'not_enabled');
  });

  it('verifyYouTubeCredentials 成功後 health snapshot 記錄 scope 與成功時間', async () => {
    const verified = await youtubeUploadService.verifyYouTubeCredentials({
      fetchImpl: buildPrivacyFetchMock([]),
    });
    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(verified, true);
    assert.equal(snapshot.readiness, 'ready');
    assert.equal(snapshot.credentialCheck.status, 'ok');
    assert.ok(snapshot.credentialCheck.lastSuccessAt);
    assert.equal(snapshot.privatizeScopeSatisfied, true);
    assert.deepEqual(snapshot.credentialCheck.grantedScopes, [
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ]);
  });

  it('只有 upload scope 時 health snapshot 示警轉 private 不會生效', async () => {
    await youtubeUploadService.verifyYouTubeCredentials({
      fetchImpl: buildPrivacyFetchMock([], undefined, {
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      }),
    });
    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(snapshot.privatizeScopeSatisfied, false);
    assert.equal(snapshot.readiness, 'degraded');
    assert.ok(snapshot.warnings.some((item) => item.code === 'YOUTUBE_PRIVACY_SCOPE_MISSING'));
  });

  it('token 交換失敗後 health snapshot 轉為 degraded 並保留錯誤', async () => {
    await youtubeUploadService.verifyYouTubeCredentials({
      fetchImpl: async () => jsonResponse({ error: 'invalid_grant' }, { status: 400 }),
    });
    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(snapshot.credentialCheck.status, 'failed');
    assert.equal(snapshot.readiness, 'degraded');
    assert.match(snapshot.credentialCheck.lastError, /token refresh failed/i);
  });

  it('轉 private 失敗會留在 health snapshot 的 lastPrivatize', async () => {
    await youtubeUploadService.privatizeVideoOnDelete(
      { youtubeVideoId: 'ytVideo123', youtubeUpload: { status: 'uploaded' } },
      {
        fetchImpl: async (url) => {
          if (String(url).includes('oauth2.googleapis.com/token')) {
            return jsonResponse({ access_token: 'token', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
          }
          return jsonResponse({ error: { message: 'insufficient scope' } }, { status: 403 });
        },
      },
    );
    const snapshot = youtubeUploadService.buildYouTubeUploadSnapshot();

    assert.equal(snapshot.lastPrivatize.youtubeVideoId, 'ytVideo123');
    assert.ok(snapshot.lastPrivatize.lastAttemptAt);
    assert.equal(snapshot.lastPrivatize.lastSuccessAt, null);
    assert.ok(snapshot.warnings.some((item) => item.code === 'YOUTUBE_PRIVATIZE_FAILED'));
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
