const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  store,
} = require('./helpers/backendTestHarness');
const env = require('../src/config/env');

function resetQaEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.geminiApiKey = '';
  env.openaiApiKey = '';
}

describe('qa routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
    resetQaEnv();
  });

  it('requires authentication', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      body: {
        courseId: ids.publishedCourse,
        question: 'What does the course say about JWT authentication?',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('validates required qa request fields', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const missingCourseResult = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        question: 'JWT auth',
      },
    });
    const blankQuestionResult = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.publishedCourse,
        question: '   ',
      },
    });

    assert.equal(missingCourseResult.status, 400);
    assert.equal(missingCourseResult.body.error.code, 'VALIDATION_ERROR');
    assert.equal(blankQuestionResult.status, 400);
    assert.equal(blankQuestionResult.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns invalid-id and not-found errors for qa requests', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const invalidIdResult = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: 'not-an-id',
        question: 'JWT auth',
      },
    });
    const notFoundResult = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: newObjectId(),
        question: 'JWT auth',
      },
    });

    assert.equal(invalidIdResult.status, 400);
    assert.equal(invalidIdResult.body.error.code, 'INVALID_ID');
    assert.equal(notFoundResult.status, 404);
    assert.equal(notFoundResult.body.error.code, 'COURSE_NOT_FOUND');
  });

  it('enforces course access rules', async () => {
    // Demo permission model lets students reach every course, so the access
    // check now denies non-owner teachers instead of students.
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: otherTeacherToken,
      body: {
        courseId: ids.teacherCourse,
        question: 'draft content',
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'COURSE_ACCESS_DENIED');
  });

  it('returns empty results with runtime diagnostics when no segment matches', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.publishedCourse,
        question: '9876543210 9876543210',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.matches.length, 0);
    assert.equal(result.body.data.clip, null);
    assert.equal(result.body.data.runtime.status, 'degraded');
    assert.equal(result.body.data.runtime.degraded, true);
    assert.equal(result.body.data.runtime.matchStatus, 'no_relevant_match');
    assert.equal(result.body.data.runtime.resultCategory, 'no_relevant_match');
    assert.equal(result.body.data.runtime.searchableSegmentCount, 2);
    assert.equal(result.body.data.runtime.degradedReasons.includes('SEGMENT_EMBEDDING_MISSING'), true);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'ask'), true);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'clip_view'), false);
  });

  it('returns matches, cached clip data, and runtime diagnostics on success', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.publishedCourse,
        question: 'What does the course say about JWT authentication?',
      },
    });

    assert.equal(result.status, 200);
    assert.match(result.body.data.answer, /JWT authentication/i);
    assert.equal(result.body.data.matches.length > 0, true);
    assert.equal(result.body.data.matches[0].segmentId, ids.segmentOne);
    assert.deepEqual(
      Object.keys(result.body.data.matches[0]).sort(),
      ['endSec', 'score', 'segmentId', 'startSec', 'transcript', 'videoId', 'videoTitle'],
    );
    assert.equal(result.body.data.clip.segmentId, ids.segmentOne);
    assert.equal(result.body.data.runtime.status, 'degraded');
    assert.equal(result.body.data.runtime.degraded, true);
    assert.equal(result.body.data.runtime.queryEmbeddingProvider, 'mock');
    assert.equal(result.body.data.runtime.searchBackendUsed, 'memory');
    assert.equal(result.body.data.runtime.answerProviderUsed, 'template');
    assert.equal(result.body.data.runtime.resultCategory, 'matched_degraded');
    assert.equal(result.body.data.runtime.course.isBridgeCourse, false);
    assert.equal(result.body.data.runtime.course.bridgeMode, 'standard');
    assert.equal(result.body.data.runtime.course.appVideoCount, 1);
    assert.equal(result.body.data.runtime.course.appOwnedVideoCount, 1);
    assert.equal(result.body.data.runtime.course.bridgeVideoCount, 0);
    assert.equal(result.body.data.runtime.course.metadataOnlyVideoCount, 0);
    assert.equal(result.body.data.runtime.fallbacks.some((item) => item.code === 'SEGMENT_EMBEDDING_MISSING'), true);
    assert.equal(store.clips[0].hitCount, 1);

    const askLog = store.usageLogs.find((entry) => entry.event === 'ask');
    const clipLog = store.usageLogs.find((entry) => entry.event === 'clip_view');
    const questionRecord = store.questions.find((entry) => entry.question === 'What does the course say about JWT authentication?');

    assert.ok(askLog);
    assert.equal(askLog.metadata.source, 'api');
    assert.equal(askLog.metadata.topSegmentId, ids.segmentOne);
    assert.equal(askLog.metadata.runtime.matchStatus, 'matched');
    assert.ok(questionRecord);
    assert.equal(String(questionRecord.userId), ids.student);
    assert.equal(questionRecord.studentId, undefined);
    assert.equal(String(questionRecord.sourceUsageLogId), String(askLog._id));
    assert.ok(clipLog);
    assert.equal(clipLog.metadata.segmentId, ids.segmentOne);
  });

  it('supports camelCase segments with videoId and text fields without changing response shape', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    store.videoSegments.push(
      {
        _id: newObjectId(),
        segmentId: ids.snakeCaseSegment,
        videoId: ids.publishedVideoExternal,
        startSec: 90,
        endSec: 126,
        text: 'Atlas compatibility fallbacktoken keeps memory mode working even when the segment only has videoId and text fields.',
        embedding: [],
      },
      {
        _id: newObjectId(),
        segmentId: 'segment-snake-foreign',
        videoId: 'video-foreign-999',
        startSec: 90,
        endSec: 126,
        text: 'Atlas compatibility fallbacktoken keeps memory mode working even when the segment only has videoId and text fields.',
        embedding: [],
      },
    );

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.publishedCourse,
        question: 'How does fallbacktoken keep Atlas compatibility working?',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.matches[0].segmentId, ids.snakeCaseSegment);
    assert.equal(result.body.data.matches[0].videoId, ids.publishedVideoExternal);
    assert.equal(result.body.data.matches[0].startSec, 90);
    assert.equal(result.body.data.matches[0].endSec, 126);
    assert.match(result.body.data.matches[0].transcript, /videoId and text fields/i);
    assert.deepEqual(
      Object.keys(result.body.data.matches[0]).sort(),
      ['endSec', 'score', 'segmentId', 'startSec', 'transcript', 'videoId', 'videoTitle'],
    );
    assert.equal(result.body.data.matches.some((match) => match.segmentId === 'segment-snake-foreign'), false);
  });

  it('returns explicit no-searchable-data contract for metadata-only bridge courses', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    store.courses.push({
      _id: ids.pipelineBridgeCourse,
      title: 'Pipeline Bridge Course',
      description: 'QA bridge course',
      teacherId: ids.teacher,
      videoIds: [ids.pipelineBridgeVideo],
      status: 'published',
      createdAt: '2026-04-13T08:00:00.000Z',
    });

    store.videos.push({
      _id: ids.pipelineBridgeVideo,
      video_id: ids.pipelineBridgeVideoExternal,
      file_name: 'pipeline-bridge.mp4',
      duration_sec: 420,
      createdAt: '2026-04-13T08:01:00.000Z',
      updatedAt: '2026-04-13T08:01:00.000Z',
    });

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.pipelineBridgeCourse,
        question: '這門課可以問什麼？',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.matches.length, 0);
    assert.equal(result.body.data.runtime.status, 'degraded');
    assert.equal(result.body.data.runtime.degraded, true);
    assert.equal(result.body.data.runtime.matchStatus, 'no_searchable_segments');
    assert.equal(result.body.data.runtime.resultCategory, 'no_searchable_segments');
    assert.equal(result.body.data.runtime.searchableSegmentCount, 0);
    assert.equal(result.body.data.runtime.degradedReasons.includes('NO_SEARCHABLE_SEGMENTS'), true);
    assert.equal(result.body.data.runtime.course.isBridgeCourse, true);
    assert.equal(result.body.data.runtime.course.qaScopeOnly, true);
    assert.equal(result.body.data.runtime.course.bridgeMode, 'qa_scope_only');
    assert.equal(result.body.data.runtime.course.appVideoCount, 0);
    assert.equal(result.body.data.runtime.course.appOwnedVideoCount, 0);
    assert.equal(result.body.data.runtime.course.bridgeVideoCount, 1);
    assert.equal(result.body.data.runtime.course.metadataOnlyVideoCount, 1);
    assert.match(result.body.data.answer, /bridge metadata/);
  });
});
