const assert = require('node:assert/strict');
const path = require('path');
const { beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  resetStore,
  store,
  createProcessingState,
} = require('./helpers/backendTestHarness');
const {
  buildBatchResumeArgs,
  buildBatchRequest,
  isSameOrDescendant,
  markUnexpectedBatchExitFailed,
} = require('../src/services/videoBatchProcessing.service');
const {
  reconcileVideoBatchFromManifest,
  resolveBatchManifestPath,
} = require('../src/services/videoBatchReconciliation.service');

describe('video batch processing adapter', () => {
  beforeEach(() => resetStore());

  it('builds the versioned Python request only from files under UPLOAD_DIR', () => {
    const videoPath = path.join(env.uploadDir, 'test-upload-batch-request.mp4');
    const request = buildBatchRequest('batch_20260812010101_abcdef12', [{
      itemId: 'item_0001',
      videoId: ids.teacherVideo,
      videoPath,
    }]);

    assert.equal(request.version, 1);
    assert.equal(request.batchId, 'batch_20260812010101_abcdef12');
    assert.equal(request.items[0].videoPath, path.resolve(videoPath));
    assert.equal(isSameOrDescendant(env.uploadDir, request.items[0].videoPath), true);
    assert.throws(
      () => buildBatchRequest('batch_20260812010101_abcdef12', [{
        itemId: 'item_0001',
        videoId: ids.teacherVideo,
        videoPath: path.resolve(env.uploadDir, '..', 'outside.mp4'),
      }]),
      (error) => error.code === 'VIDEO_BATCH_SCHEDULE_FAILED',
    );
  });

  it('manual retry 只在既有 batch resume 命令加入指定 videoId', () => {
    assert.deepEqual(
      buildBatchResumeArgs('batch_20260812010101_abcdef12', [ids.teacherVideo]),
      [
        '--batch-resume',
        'batch_20260812010101_abcdef12',
        '--batch-retry-video-id',
        ids.teacherVideo,
      ],
    );
  });

  it('marks only queued or processing videos failed after an unexpected batch exit', async () => {
    const queued = store.videos.find((video) => video._id === ids.teacherVideo);
    const completed = store.videos.find((video) => video._id === ids.publishedVideo);
    queued.processing = createProcessingState({ status: 'queued' });
    completed.processing = createProcessingState({ status: 'completed' });

    await markUnexpectedBatchExitFailed([ids.teacherVideo, ids.publishedVideo], {
      errorCode: 'PIPELINE_PROCESS_EXITED',
      errorMessage: 'batch exited',
    });

    assert.equal(queued.processing.status, 'failed');
    assert.equal(queued.processing.errorCode, 'PIPELINE_PROCESS_EXITED');
    assert.equal(completed.processing.status, 'completed');
  });

  it('reconciles completed and failed manifest items without duplicate transitions', async () => {
    const completedVideo = store.videos.find((video) => video._id === ids.teacherVideo);
    const failedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    completedVideo.processing = createProcessingState({ status: 'queued', attemptCount: 0 });
    failedVideo.processing = createProcessingState({ status: 'processing', attemptCount: 1 });
    const batch = {
      batchId: 'batch_20260812010101_abcdef12',
      courseId: ids.teacherCourse,
      createdBy: ids.teacher,
      status: 'processing',
      processingMode: 'pipeline_batch',
      items: [
        { itemId: 'item_0001', videoId: ids.teacherVideo, uploadStatus: 'uploaded' },
        { itemId: 'item_0002', videoId: ids.publishedVideo, uploadStatus: 'uploaded' },
      ],
    };
    store.videoBatches.push(batch);
    const manifest = {
      batch_id: batch.batchId,
      status: 'partial',
      items: [
        { item_id: 'item_0001', requested_video_id: ids.teacherVideo, status: 'completed' },
        {
          item_id: 'item_0002',
          requested_video_id: ids.publishedVideo,
          status: 'failed',
          last_error_code: 'STT_FAILED',
          last_error_message: 'Speech recognition failed.',
        },
      ],
    };

    const result = await reconcileVideoBatchFromManifest(batch, manifest);
    const replay = await reconcileVideoBatchFromManifest(batch, manifest);

    assert.equal(completedVideo.processing.status, 'completed');
    assert.equal(completedVideo.processing.attemptCount, 1);
    assert.equal(failedVideo.processing.status, 'failed');
    assert.equal(failedVideo.processing.errorCode, 'STT_FAILED');
    assert.equal(result.status, 'partial');
    assert.equal(replay.status, 'partial');
  });

  it('rejects a mismatched manifest before changing any video status', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.processing = createProcessingState({ status: 'queued', attemptCount: 0 });
    const batch = {
      batchId: 'batch_20260812010101_abcdef12',
      items: [{ itemId: 'item_0001', videoId: ids.teacherVideo, uploadStatus: 'uploaded' }],
    };

    await assert.rejects(
      reconcileVideoBatchFromManifest(batch, {
        batch_id: batch.batchId,
        status: 'running',
        items: [{ item_id: 'item_0001', requested_video_id: ids.publishedVideo, status: 'running' }],
      }),
      /does not match/,
    );
    assert.equal(video.processing.status, 'queued');
    assert.equal(resolveBatchManifestPath(batch.batchId).endsWith('batch_manifest.json'), true);
  });
});
