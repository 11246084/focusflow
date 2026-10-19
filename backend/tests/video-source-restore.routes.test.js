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
