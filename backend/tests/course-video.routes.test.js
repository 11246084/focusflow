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
  createVideoUploadForm,
  cleanupTestUploads,
} = require('./helpers/backendTestHarness');

describe('course and video routes', () => {
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

  it('lists courses by role-specific access rules', async () => {
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const adminResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: adminToken });
    const teacherResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: teacherToken });
    const studentResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: studentToken });

    assert.equal(adminResult.status, 200);
    assert.equal(adminResult.body.data.courses.length, 4);

    assert.equal(teacherResult.status, 200);
    assert.deepEqual(
      teacherResult.body.data.courses.map((course) => course._id),
      [ids.publishedCourse, ids.teacherCourse],
    );

    assert.equal(studentResult.status, 200);
    assert.deepEqual(
      studentResult.body.data.courses.map((course) => course._id),
      [ids.enrolledDraftCourse, ids.publishedCourse],
    );
  });

  it('gets a course by id and enforces access rules', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const successResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${ids.teacherCourse}`, {
      token: teacherToken,
    });
    const invalidIdResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses/not-an-id', {
      token: teacherToken,
    });
    const notFoundResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${newObjectId()}`, {
      token: teacherToken,
    });
    const deniedResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${ids.foreignDraftCourse}`, {
      token: studentToken,
    });

    assert.equal(successResult.status, 200);
    assert.equal(successResult.body.data.course._id, ids.teacherCourse);
    assert.equal(invalidIdResult.status, 400);
    assert.equal(invalidIdResult.body.error.code, 'INVALID_ID');
    assert.equal(notFoundResult.status, 404);
    assert.equal(notFoundResult.body.error.code, 'COURSE_NOT_FOUND');
    assert.equal(deniedResult.status, 403);
    assert.equal(deniedResult.body.error.code, 'COURSE_ACCESS_DENIED');
  });

  it('rejects students from creating courses', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      method: 'POST',
      token: studentToken,
      body: { title: 'Blocked course' },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('creates a course and uploads a video for the owner teacher', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const createCourseResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      method: 'POST',
      token: teacherToken,
      body: {
        title: 'Integration Course',
        description: 'Created in test',
        status: 'published',
      },
    });

    const formData = createVideoUploadForm({
      title: 'Integration Test Video',
      filename: `${Date.now()}-test-upload-success.mp4`,
    });

    const uploadResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${createCourseResult.body.data.course._id}/videos`,
      {
        method: 'POST',
        token: teacherToken,
        body: formData,
      },
    );

    const processingResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${uploadResult.body.data.video._id}/processing`,
      {
        token: teacherToken,
      },
    );

    assert.equal(createCourseResult.status, 201);
    assert.equal(uploadResult.status, 201);
    assert.equal(uploadResult.body.data.video.processing.status, 'queued');
    assert.equal(processingResult.status, 200);
    assert.equal(processingResult.body.data.processing.status, 'queued');
  });

  it('rejects uploads without a file', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const formData = new FormData();
    formData.append('title', 'Missing file upload');

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      {
        method: 'POST',
        token: teacherToken,
        body: formData,
      },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VIDEO_FILE_REQUIRED');
  });

  it('rejects invalid upload file types', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const formData = createVideoUploadForm({
      title: 'Wrong file',
      filename: `${Date.now()}-test-upload-invalid.txt`,
      type: 'text/plain',
      contents: 'not a video',
    });

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      {
        method: 'POST',
        token: teacherToken,
        body: formData,
      },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_FILE_TYPE');
  });

  it('rejects uploads from non-owner teachers', async () => {
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');
    const formData = createVideoUploadForm({
      title: 'Unauthorized upload',
      filename: `${Date.now()}-test-upload-non-owner.mp4`,
    });

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      {
        method: 'POST',
        token: otherTeacherToken,
        body: formData,
      },
    );

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'COURSE_MANAGE_DENIED');
  });

  it('fetches videos by id and returns validation/not-found errors', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const successResult = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.teacherVideo}`, {
      token: teacherToken,
    });
    const invalidIdResult = await jsonRequest(serverContext.baseUrl, '/api/v1/videos/not-an-id', {
      token: teacherToken,
    });
    const notFoundResult = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${newObjectId()}`, {
      token: teacherToken,
    });

    assert.equal(successResult.status, 200);
    assert.equal(successResult.body.data.video._id, ids.teacherVideo);
    assert.equal(invalidIdResult.status, 400);
    assert.equal(invalidIdResult.body.error.code, 'INVALID_ID');
    assert.equal(notFoundResult.status, 404);
    assert.equal(notFoundResult.body.error.code, 'VIDEO_NOT_FOUND');
  });

  it('allows students to fetch accessible videos but not processing status', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');

    const studentVideoResult = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.publishedVideo}`, {
      token: studentToken,
    });
    const studentProcessingResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.publishedVideo}/processing`,
      {
        token: studentToken,
      },
    );
    const teacherProcessingResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.publishedVideo}/processing`,
      {
        token: teacherToken,
      },
    );
    const adminProcessingResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.publishedVideo}/processing`,
      {
        token: adminToken,
      },
    );

    assert.equal(studentVideoResult.status, 200);
    assert.equal(studentVideoResult.body.data.video._id, ids.publishedVideo);
    assert.equal(studentProcessingResult.status, 403);
    assert.equal(studentProcessingResult.body.error.code, 'COURSE_MANAGE_DENIED');
    assert.equal(teacherProcessingResult.status, 200);
    assert.equal(adminProcessingResult.status, 200);
  });

  it('rejects processing requests with invalid ids', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/videos/not-an-id/processing', {
      token: teacherToken,
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_ID');
  });

  it('allows students to read draft videos only when enrolled in the course', async () => {
    const enrolledVideoId = newObjectId();
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    store.videos.push({
      _id: enrolledVideoId,
      courseId: ids.enrolledDraftCourse,
      title: 'Enrolled Draft Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/enrolled-draft.mp4',
      storagePath: 'uploads/enrolled-draft.mp4',
      durationSec: null,
      uploadedBy: ids.otherTeacher,
      processing: {
        status: 'completed',
        errorMessage: null,
      },
      createdAt: '2026-04-06T13:00:00.000Z',
      updatedAt: '2026-04-06T13:00:00.000Z',
    });

    const result = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${enrolledVideoId}`, {
      token: studentToken,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.video._id, enrolledVideoId);
  });
});
