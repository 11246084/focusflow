const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const {
  createProcessingState,
  env,
  ids,
  jsonRequest,
  loginAs,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');
const videoService = require('../src/services/video.service');
const videoProcessingService = require('../src/services/videoProcessing.service');
const youtubeUploadService = require('../src/services/youtubeUpload.service');

const YOUTUBE_ID = 'ytCleaned001';
const YOUTUBE_URL = `https://www.youtube.com/watch?v=${YOUTUBE_ID}`;
// 最小但結構完整的 MP4：ftyp、mdat、moov 三個 8 bytes 的 box，可通過容器完整性檢查。
const VALID_MP4 = Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => {
  const box = Buffer.alloc(8);
  box.writeUInt32BE(8, 0);
  box.write(type, 4, 'ascii');
  return box;
}));

function teacherVideo() {
  return store.videos.find((video) => video._id === ids.teacherVideo);
}

function markCleaned(video, { processingStatus = 'completed' } = {}) {
  Object.assign(video, {
    filePath: null,
    fileName: 'draft.mp4',
    fileHash: 'original-file-hash',
    youtubeVideoId: YOUTUBE_ID,
    videoSource: 'youtube',
    videoUrl: YOUTUBE_URL,
    sourceUrl: YOUTUBE_URL,
    processing: createProcessingState({
      status: processingStatus,
      queuedAt: '2026-09-01T00:00:00.000Z',
      startedAt: '2026-09-01T00:01:00.000Z',
      completedAt: processingStatus === 'completed' ? '2026-09-01T00:05:00.000Z' : null,
      failedAt: processingStatus === 'failed' ? '2026-09-01T00:05:00.000Z' : null,
      attemptCount: 1,
    }),
    youtubeUpload: {
      status: 'uploaded',
      error: null,
      uploadedAt: '2026-09-01T00:10:00.000Z',
      attemptCount: 1,
      retrySafe: false,
      localCleanupAt: '2026-10-01T00:00:00.000Z',
      localCleanupError: 'previous cleanup warning',
      localSourceRestoredAt: null,
    },
  });
  return video;
}

function createRestoreForm({
  contents = VALID_MP4,
  type = 'video/mp4',
  filename = 'restored-lecture.mp4',
} = {}) {
  const formData = new FormData();
  formData.append('video', new Blob([contents], { type }), filename);
  return formData;
}

describe('POST /videos/:videoId/source/restore', () => {
  let serverContext;
  let originalUploadDir;
  let tempUploadDir;

  before(async () => { serverContext = await startServer(); });
  after(async () => { await stopServer(serverContext.server); });

  beforeEach(() => {
    resetStore();
    // multer 與來源檢查都在呼叫時讀 env.uploadDir，測試檔案只寫進暫存目錄。
    originalUploadDir = env.uploadDir;
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-restore-tests-'));
    env.uploadDir = tempUploadDir;
  });

  afterEach(() => {
    env.uploadDir = originalUploadDir;
    fs.rmSync(tempUploadDir, { recursive: true, force: true });
  });

  async function restore(token, { videoId = ids.teacherVideo, form = createRestoreForm() } = {}) {
    return jsonRequest(serverContext.baseUrl, `/api/v1/videos/${videoId}/source/restore`, {
      method: 'POST',
      token,
      body: form,
    });
  }

  function uploadedFiles() {
    return fs.readdirSync(tempUploadDir);
  }

  it('學生被角色層擋下，不會寫入檔案', async () => {
    markCleaned(teacherVideo());
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await restore(token);

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
    assert.deepEqual(uploadedFiles(), []);
    assert.equal(teacherVideo().filePath, null);
  });

  it('其他課程的教師回 403，並刪除剛上傳的檔案', async () => {
    markCleaned(teacherVideo());
    const token = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const result = await restore(token);

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'COURSE_MANAGE_DENIED');
    assert.deepEqual(uploadedFiles(), []);
    assert.equal(teacherVideo().filePath, null);
  });

  it('尚未清理的影片回 409，並刪除剛上傳的檔案', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const video = markCleaned(teacherVideo());
    const notCleanedStates = [
      { filePath: path.join(tempUploadDir, 'still-here.mp4') },
      { youtubeUpload: { ...video.youtubeUpload, localCleanupAt: null } },
      { youtubeVideoId: null },
      { youtubeUpload: { ...video.youtubeUpload, status: 'failed' } },
    ];

    for (const state of notCleanedStates) {
      resetStore();
      Object.assign(markCleaned(teacherVideo()), state);

      const result = await restore(token);

      assert.equal(result.status, 409, JSON.stringify(state));
      assert.equal(result.body.error.code, 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED');
      assert.deepEqual(uploadedFiles(), []);
    }
  });

  it('檔案型別、容器結構或缺檔不合格回 400，影片維持已清理', async () => {
    markCleaned(teacherVideo());
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const wrongType = await restore(token, {
      form: createRestoreForm({ type: 'text/plain', filename: 'notes.txt', contents: 'hello' }),
    });
    const truncated = await restore(token, {
      form: createRestoreForm({ contents: VALID_MP4.subarray(0, 16) }),
    });
    const missingFile = await restore(token, { form: new FormData() });
    const invalidId = await restore(token, { videoId: 'not-an-object-id' });

    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.error.code, 'INVALID_FILE_TYPE');
    assert.equal(truncated.status, 400);
    assert.equal(truncated.body.error.code, 'INVALID_MEDIA_CONTAINER');
    assert.equal(missingFile.status, 400);
    assert.equal(missingFile.body.error.code, 'VIDEO_FILE_REQUIRED');
    assert.equal(invalidId.status, 400);
    assert.equal(invalidId.body.error.code, 'INVALID_ID');
    assert.deepEqual(uploadedFiles(), []);
    assert.equal(teacherVideo().filePath, null);
    assert.ok(teacherVideo().youtubeUpload.localCleanupAt);
  });

  it('同課程另一支影片已使用相同檔案時回 409 DUPLICATE_VIDEO', async () => {
    markCleaned(teacherVideo());
    store.videos.push({
      _id: newObjectId(),
      courseId: ids.teacherCourse,
      title: 'Another lecture',
      sourceType: 'upload',
      fileHash: crypto.createHash('sha256').update(VALID_MP4).digest('hex'),
      uploadedBy: ids.teacher,
      processing: createProcessingState({ status: 'completed' }),
    });
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await restore(token);

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'DUPLICATE_VIDEO');
    assert.deepEqual(uploadedFiles(), []);
    assert.equal(teacherVideo().filePath, null);
  });

  it('課程教師補回成功：寫回 filePath 與補回時間，播放欄位與 YouTube ID 不變', async () => {
    markCleaned(teacherVideo());
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const before = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.teacherVideo}`, { token });
    const startedAt = Date.now();

    const result = await restore(token);

    assert.equal(before.body.data.video.sourceAvailable, false);
    assert.equal(result.status, 200);
    const files = uploadedFiles();
    assert.equal(files.length, 1);
    const video = teacherVideo();
    assert.equal(path.resolve(video.filePath), path.join(tempUploadDir, files[0]));
    assert.equal(video.fileName, 'restored-lecture.mp4');
    assert.equal(video.fileHash, 'original-file-hash');
    assert.equal(video.youtubeUpload.localCleanupAt, null);
    assert.equal(video.youtubeUpload.localCleanupError, null);
    assert.ok(new Date(video.youtubeUpload.localSourceRestoredAt).getTime() >= startedAt);
    assert.equal(video.youtubeUpload.status, 'uploaded');
    assert.equal(video.youtubeVideoId, YOUTUBE_ID);
    assert.equal(video.videoUrl, YOUTUBE_URL);
    assert.equal(video.sourceUrl, YOUTUBE_URL);
    assert.equal(video.videoSource, 'youtube');
    assert.equal(video.processing.status, 'completed');

    // 回傳格式比照影片詳情。
    const detail = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.teacherVideo}`, { token });
    assert.equal(result.body.data.video._id, detail.body.data.video._id);
    assert.deepEqual(Object.keys(result.body.data.video).sort(), Object.keys(detail.body.data.video).sort());
    assert.equal(result.body.data.video.sourceAvailable, true);
    assert.equal(result.body.data.video.video_url, YOUTUBE_URL);
    assert.equal(result.body.data.video.youtubeUpload.localCleanupAt, null);
    assert.ok(result.body.data.video.youtubeUpload.localSourceRestoredAt);

    // 補回後已不是清理狀態，再送一次回 409。
    const again = await restore(token);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED');
    assert.equal(uploadedFiles().length, 1);
  });

  it('admin 可補回任何課程的影片', async () => {
    markCleaned(teacherVideo());
    const token = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');

    const result = await restore(token);

    assert.equal(result.status, 200);
    assert.ok(teacherVideo().filePath);
    assert.ok(teacherVideo().youtubeUpload.localSourceRestoredAt);
  });

  it('原片已清理時重新處理回 SOURCE_UNAVAILABLE，影片不會被排入佇列', async () => {
    markCleaned(teacherVideo(), { processingStatus: 'failed' });
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const before = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.teacherVideo}`, { token });

    const blocked = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      { method: 'POST', token },
    );

    assert.equal(before.body.data.video.sourceAvailable, false);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE');
    assert.equal(teacherVideo().processing.status, 'failed');
  });

  it('補回後可重新處理，完成時不重新上傳 YouTube', async () => {
    markCleaned(teacherVideo(), { processingStatus: 'failed' });
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const retryPath = `/api/v1/videos/${ids.teacherVideo}/processing/retry`;

    const restored = await restore(token);
    assert.equal(restored.status, 200);

    const retried = await jsonRequest(serverContext.baseUrl, retryPath, { method: 'POST', token });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.data.processing.status, 'queued');

    const originalEnv = {
      youtubeUploadEnabled: env.youtubeUploadEnabled,
      youtubeUploadAccessToken: env.youtubeUploadAccessToken,
      youtubeUploadCleanupEnabled: env.youtubeUploadCleanupEnabled,
    };
    const originalFetch = global.fetch;
    const youtubeCalls = [];
    env.youtubeUploadEnabled = true;
    env.youtubeUploadAccessToken = 'access-token-for-tests';
    env.youtubeUploadCleanupEnabled = false;
    global.fetch = async (url, options) => {
      if (/googleapis|youtube/i.test(String(url))) {
        youtubeCalls.push(String(url));
        throw new Error('YouTube must not be called for a restored video.');
      }
      return originalFetch(url, options);
    };

    try {
      await videoProcessingService.startVideoProcessing(ids.teacherVideo);
      await videoProcessingService.completeVideoProcessing(ids.teacherVideo, { durationSec: 60 });
      const directAttempt = await youtubeUploadService.autoUploadVideoToYouTube(ids.teacherVideo);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(directAttempt, null);
      assert.deepEqual(youtubeCalls, []);
      const video = teacherVideo();
      assert.equal(video.processing.status, 'completed');
      assert.equal(video.youtubeVideoId, YOUTUBE_ID);
      assert.equal(video.youtubeUpload.status, 'uploaded');
      assert.equal(video.youtubeUpload.attemptCount, 1);
      assert.equal(video.videoUrl, YOUTUBE_URL);
    } finally {
      global.fetch = originalFetch;
      Object.assign(env, originalEnv);
    }
  });
});

describe('videoService.restoreVideoSource', () => {
  let originalUploadDir;
  let tempUploadDir;
  const teacher = { id: ids.teacher, role: 'teacher' };

  beforeEach(() => {
    resetStore();
    originalUploadDir = env.uploadDir;
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-restore-service-'));
    env.uploadDir = tempUploadDir;
  });

  afterEach(() => {
    env.uploadDir = originalUploadDir;
    fs.rmSync(tempUploadDir, { recursive: true, force: true });
  });

  function writeUpload(name) {
    const filePath = path.join(tempUploadDir, name);
    fs.writeFileSync(filePath, VALID_MP4);
    return { path: filePath, originalname: name, filename: name };
  }

  it('同時送出兩次補回時，只有一次成功，另一個檔案被刪除', async () => {
    markCleaned(teacherVideo());
    const first = writeUpload('first.mp4');
    const second = writeUpload('second.mp4');
    let raced = false;
    // 模擬第二個請求在條件更新前，第一個請求已完成補回。
    store.beforeVideoCompareAndSwap = async () => {
      if (raced) return;
      raced = true;
      await videoService.restoreVideoSource({ videoId: ids.teacherVideo, file: first, user: teacher });
    };

    await assert.rejects(
      videoService.restoreVideoSource({ videoId: ids.teacherVideo, file: second, user: teacher }),
      (error) => error.code === 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED',
    );
    store.beforeVideoCompareAndSwap = null;

    assert.equal(teacherVideo().filePath, first.path);
    assert.equal(fs.existsSync(first.path), true);
    assert.equal(fs.existsSync(second.path), false);
  });

  it('找不到影片時回 404 並刪除檔案', async () => {
    const file = writeUpload('orphan.mp4');

    await assert.rejects(
      videoService.restoreVideoSource({ videoId: newObjectId(), file, user: teacher }),
      (error) => error.code === 'VIDEO_NOT_FOUND',
    );
    assert.equal(fs.existsSync(file.path), false);
  });

  it('影片回傳的 sourceAvailable 只在 UPLOAD_DIR 內有原片時為 true', async () => {
    const video = teacherVideo();
    const inside = writeUpload('inside.mp4');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-restore-outside-'));
    const outside = path.join(outsideDir, 'outside.mp4');
    fs.writeFileSync(outside, VALID_MP4);

    try {
      const cases = [
        [inside.path, true],
        [path.join(tempUploadDir, 'missing.mp4'), false],
        [outside, false],
        [tempUploadDir, false],
        [null, false],
      ];
      for (const [filePath, expected] of cases) {
        video.filePath = filePath;
        const presentation = await videoService.getVideoById(ids.teacherVideo, teacher);
        assert.equal(presentation.sourceAvailable, expected, String(filePath));
      }
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
