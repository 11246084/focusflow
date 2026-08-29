const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  store,
  createVideoBatchUploadForm,
  cleanupTestUploads,
  createProcessingState,
  env,
} = require('./helpers/backendTestHarness');
const videoBatchProcessingService = require('../src/services/videoBatchProcessing.service');
const videoService = require('../src/services/video.service');

describe('video batch routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
    cleanupTestUploads();
  });

  beforeEach(() => {
    resetStore();
    cleanupTestUploads();
  });

  it('creates a trackable batch while preserving the existing single-video processing adapter', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const initialVideoCount = store.videos.length;
    const formData = createVideoBatchUploadForm({
      files: [
        { filename: `test-upload-${Date.now()}-batch-a.mp4`, contents: 'batch-a' },
        { filename: `test-upload-${Date.now()}-batch-b.mp4`, contents: 'batch-b' },
      ],
      titles: ['Lecture A', 'Lecture B'],
    });

    const created = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: teacherToken, body: formData },
    );

    assert.equal(created.status, 201);
    assert.match(created.body.data.batch.batchId, /^batch_[0-9]{14}_[a-f0-9]{8}$/);
    assert.equal(created.body.data.batch.processingMode, 'single_adapter');
    assert.equal(created.body.data.batch.status, 'processing');
    assert.deepEqual(created.body.data.batch.counts, {
      total: 2,
      completed: 0,
      failed: 0,
      processing: 2,
    });
    assert.deepEqual(created.body.data.batch.items.map((item) => item.title), ['Lecture A', 'Lecture B']);
    assert.equal(store.videos.length, initialVideoCount + 2);
    assert.equal(store.videoBatches.length, 1);

    const fetched = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/video-batches/${created.body.data.batch.batchId}`,
      { token: teacherToken },
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.batch.items.length, 2);
  });

  it('keeps successful files when another item is rejected as a duplicate', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const formData = createVideoBatchUploadForm({
      files: [
        { filename: `test-upload-${Date.now()}-unique.mp4`, contents: 'unique-content' },
        { filename: `test-upload-${Date.now()}-duplicate.mp4`, contents: 'unique-content' },
      ],
      titles: ['Unique', 'Duplicate'],
    });

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: teacherToken, body: formData },
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.data.batch.counts.processing, 2);
    assert.equal(result.body.data.batch.counts.failed, 0);
    assert.equal(result.body.data.batch.items[1].errorCode, 'DUPLICATE_VIDEO');
    assert.ok(result.body.data.batch.items[1].videoId);
    assert.equal(store.videoBatches[0].items[0].uploadStatus, 'uploaded');
    assert.equal(store.videoBatches[0].items[1].uploadStatus, 'duplicate');
  });

  it('blocks students and non-owner teachers from batch management', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const studentResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: studentToken, body: createVideoBatchUploadForm() },
    );
    const otherTeacherResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: otherTeacherToken, body: createVideoBatchUploadForm() },
    );

    assert.equal(studentResult.status, 403);
    assert.equal(otherTeacherResult.status, 403);
    assert.equal(otherTeacherResult.body.error.code, 'COURSE_MANAGE_DENIED');
  });

  it('validates batch ids and title cardinality', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const badTitles = createVideoBatchUploadForm({ titles: ['Only one title'] });

    const invalidTitlesResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: teacherToken, body: badTitles },
    );
    const invalidIdResult = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/video-batches/not-a-batch',
      { token: teacherToken },
    );

    assert.equal(invalidTitlesResult.status, 400);
    assert.equal(invalidTitlesResult.body.error.code, 'VALIDATION_ERROR');
    assert.equal(invalidIdResult.status, 400);
    assert.equal(invalidIdResult.body.error.code, 'INVALID_VIDEO_BATCH_ID');
  });

  it('lists batches and retries only a failed item that belongs to the batch', async () => {
    const originalScheduleExisting = videoService.scheduleExistingVideoProcessing;
    let scheduledVideoId;
    videoService.scheduleExistingVideoProcessing = async (videoId) => {
      scheduledVideoId = String(videoId);
      return { pid: 123 };
    };
    try {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const created = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { method: 'POST', token: teacherToken, body: createVideoBatchUploadForm() },
    );
    const { batchId, items } = created.body.data.batch;
    const failedVideo = store.videos.find((video) => String(video._id) === items[0].videoId);
    failedVideo.processing = createProcessingState({
      status: 'failed',
      errorMessage: 'worker failed',
      errorCode: 'WORKER_FAILED',
      failedAt: new Date().toISOString(),
      attemptCount: 1,
    });

    const listed = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/video-batches`,
      { token: teacherToken },
    );
    const retried = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/video-batches/${batchId}/retry`,
      { method: 'POST', token: teacherToken, body: { videoId: items[0].videoId } },
    );

    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.batches.length, 1);
    assert.equal(listed.body.data.batches[0].counts.failed, 1);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.data.batch.items[0].processingStatus, 'queued');
    assert.equal(retried.body.data.batch.items[0].errorMessage, null);
    assert.equal(scheduledVideoId, items[0].videoId);
    } finally {
      videoService.scheduleExistingVideoProcessing = originalScheduleExisting;
    }
  });

  it('pipeline batch 手動重試會要求既有 manifest 對指定 videoId 多執行一次', async () => {
    const originalEnabled = env.videoBatchPipelineEnabled;
    const originalInitialSchedule = videoBatchProcessingService.scheduleVideoBatchProcessing;
    const originalResume = videoBatchProcessingService.scheduleVideoBatchResume;
    const originalRunning = videoBatchProcessingService.isVideoBatchProcessRunning;
    let resumed;
    env.videoBatchPipelineEnabled = true;
    videoBatchProcessingService.scheduleVideoBatchProcessing = () => ({ requestPath: 'test.json', pid: 123 });
    videoBatchProcessingService.scheduleVideoBatchResume = (request) => {
      resumed = request;
      return { pid: 456, alreadyRunning: false };
    };
    videoBatchProcessingService.isVideoBatchProcessRunning = () => false;
    try {
      const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const created = await jsonRequest(
        serverContext.baseUrl,
        `/api/v1/courses/${ids.teacherCourse}/video-batches`,
        { method: 'POST', token: teacherToken, body: createVideoBatchUploadForm() },
      );
      const { batchId, items } = created.body.data.batch;
      const failedVideo = store.videos.find((video) => String(video._id) === items[0].videoId);
      failedVideo.processing = createProcessingState({
        status: 'failed',
        errorMessage: 'worker failed',
        errorCode: 'WORKER_FAILED',
        failedAt: new Date().toISOString(),
        attemptCount: 1,
      });

      const retried = await jsonRequest(
        serverContext.baseUrl,
        `/api/v1/video-batches/${batchId}/retry`,
        { method: 'POST', token: teacherToken, body: { videoId: items[0].videoId } },
      );

      assert.equal(retried.status, 200);
      assert.deepEqual(resumed, {
        batchId,
        videoIds: [items[0].videoId],
        retryVideoIds: [items[0].videoId],
      });
    } finally {
      env.videoBatchPipelineEnabled = originalEnabled;
      videoBatchProcessingService.scheduleVideoBatchProcessing = originalInitialSchedule;
      videoBatchProcessingService.scheduleVideoBatchResume = originalResume;
      videoBatchProcessingService.isVideoBatchProcessRunning = originalRunning;
    }
  });

  it('uses one versioned Python batch request when the guarded adapter is enabled', async () => {
    const originalEnabled = env.videoBatchPipelineEnabled;
    const originalSchedule = videoBatchProcessingService.scheduleVideoBatchProcessing;
    let scheduled;
    env.videoBatchPipelineEnabled = true;
    videoBatchProcessingService.scheduleVideoBatchProcessing = (request) => {
      scheduled = request;
      return { requestPath: 'test-request.json', pid: 123 };
    };
    try {
      const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const created = await jsonRequest(
        serverContext.baseUrl,
        `/api/v1/courses/${ids.teacherCourse}/video-batches`,
        { method: 'POST', token: teacherToken, body: createVideoBatchUploadForm() },
      );

      assert.equal(created.status, 201);
      assert.equal(created.body.data.batch.processingMode, 'pipeline_batch');
      assert.equal(scheduled.batchId, created.body.data.batch.batchId);
      assert.equal(scheduled.items.length, 2);
      assert.deepEqual(
        scheduled.items.map((item) => item.videoId),
        created.body.data.batch.items.map((item) => item.videoId),
      );
    } finally {
      env.videoBatchPipelineEnabled = originalEnabled;
      videoBatchProcessingService.scheduleVideoBatchProcessing = originalSchedule;
    }
  });

  it('accepts duplicate start and fail callbacks without inflating attempts or rewriting failure', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.processing = createProcessingState({ status: 'queued', attemptCount: 0 });
    const headers = { 'x-processing-secret': env.processingWebhookSecret };

    const firstStart = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      { method: 'POST', headers },
    );
    const replayStart = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      { method: 'POST', headers },
    );
    const firstFail = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      { method: 'POST', headers, body: { errorCode: 'FIRST', errorMessage: 'first failure' } },
    );
    const replayFail = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      { method: 'POST', headers, body: { errorCode: 'SECOND', errorMessage: 'second failure' } },
    );

    assert.equal(firstStart.status, 200);
    assert.equal(replayStart.status, 200);
    assert.equal(firstFail.status, 200);
    assert.equal(replayFail.status, 200);
    assert.equal(video.processing.attemptCount, 1);
    assert.equal(video.processing.errorCode, 'FIRST');
    assert.equal(video.processing.errorMessage, 'first failure');
  });
});
