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
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.teacherCourse,
        question: 'draft content',
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'COURSE_ACCESS_DENIED');
  });

  it('returns empty results when no segment matches', async () => {
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
    assert.equal(store.usageLogs.some((entry) => entry.event === 'ask'), true);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'clip_view'), false);
  });

  it('returns matches, cached clip data, and usage logs on success', async () => {
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
      ['endSec', 'score', 'segmentId', 'startSec', 'transcript', 'videoId'],
    );
    assert.equal(result.body.data.clip.segmentId, ids.segmentOne);
    assert.equal(store.clips[0].hitCount, 1);

    const askLog = store.usageLogs.find((entry) => entry.event === 'ask');
    const clipLog = store.usageLogs.find((entry) => entry.event === 'clip_view');

    assert.ok(askLog);
    assert.equal(askLog.metadata.source, 'api');
    assert.equal(askLog.metadata.topSegmentId, ids.segmentOne);
    assert.ok(clipLog);
    assert.equal(clipLog.metadata.segmentId, ids.segmentOne);
  });

  it('supports snake_case Atlas-style segments that rely on video_id fallback without changing response shape', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    store.videoSegments.push(
      {
        _id: newObjectId(),
        segment_id: ids.snakeCaseSegment,
        video_id: ids.publishedVideoExternal,
        start_sec: 90,
        end_sec: 126,
        text: 'Atlas compatibility fallbacktoken keeps memory mode working even when the segment only has video_id and text fields.',
        embedding: [],
      },
      {
        _id: newObjectId(),
        segment_id: 'segment-snake-foreign',
        video_id: 'video-foreign-999',
        start_sec: 90,
        end_sec: 126,
        text: 'Atlas compatibility fallbacktoken keeps memory mode working even when the segment only has video_id and text fields.',
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
    assert.match(result.body.data.matches[0].transcript, /video_id and text fields/i);
    assert.deepEqual(
      Object.keys(result.body.data.matches[0]).sort(),
      ['endSec', 'score', 'segmentId', 'startSec', 'transcript', 'videoId'],
    );
    assert.equal(result.body.data.matches.some((match) => match.segmentId === 'segment-snake-foreign'), false);
  });
});
