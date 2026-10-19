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
