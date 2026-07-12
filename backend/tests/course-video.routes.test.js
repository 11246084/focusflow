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
  env,
  createProcessingState,
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
    // Teachers see every published course (including admin-created ones) in addition to courses they own,
    // so the upload/select-course UI can target courses created by admin.
    assert.deepEqual(
      new Set(teacherResult.body.data.courses.map((course) => course._id)),
      new Set([ids.publishedCourse, ids.teacherCourse]),
    );

    assert.equal(studentResult.status, 200);
    // Demo permission model: students see every published course regardless of enrollment.
    assert.deepEqual(
      studentResult.body.data.courses.map((course) => course._id),
      [ids.publishedCourse],
    );

    const foreignPublishedCourseId = newObjectId();
    store.courses.push({
      _id: foreignPublishedCourseId,
      title: 'Foreign Published Course',
      description: 'Published but not assigned or enrolled',
      teacherId: ids.otherTeacher,
      videoIds: [],
      status: 'published',
      createdAt: '2026-04-07T10:00:00.000Z',
    });

    const teacherScopedResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: teacherToken });
    const studentScopedResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: studentToken });

    // Teachers also see every published course so admin-created courses are visible
    // in the teacher's course-selection UI.
    assert.equal(
      teacherScopedResult.body.data.courses.some((course) => course._id === foreignPublishedCourseId),
      true,
    );
    // Students see every published course in the demo permission model.
    assert.equal(
      studentScopedResult.body.data.courses.some((course) => course._id === foreignPublishedCourseId),
      true,
    );
  });

  it('requires admins to assign courses to a teacher and allows reassignment', async () => {
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const missingTeacherResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Admin Course Without Teacher',
        status: 'published',
      },
    });
    // Use a draft course so the assertion specifically validates owner-based visibility.
    // Published courses are visible to every teacher (covered by the previous test).
    const createResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Admin Assigned Course',
        status: 'draft',
        teacherId: ids.otherTeacher,
      },
    });

    const courseId = createResult.body.data.course._id;
    const teacherBeforeResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: teacherToken });
    const otherTeacherBeforeResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: otherTeacherToken });

    const reassignResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${courseId}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        teacherId: ids.teacher,
      },
    });
    const teacherAfterResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: teacherToken });
    const otherTeacherAfterResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: otherTeacherToken });

    assert.equal(missingTeacherResult.status, 400);
    assert.equal(missingTeacherResult.body.error.code, 'VALIDATION_ERROR');
    assert.equal(createResult.status, 201);
    assert.equal(String(createResult.body.data.course.teacherId._id), ids.otherTeacher);
    assert.equal(teacherBeforeResult.body.data.courses.some((course) => course._id === courseId), false);
    assert.equal(otherTeacherBeforeResult.body.data.courses.some((course) => course._id === courseId), true);
    assert.equal(reassignResult.status, 200);
    assert.equal(String(reassignResult.body.data.course.teacherId._id), ids.teacher);
    assert.equal(teacherAfterResult.body.data.courses.some((course) => course._id === courseId), true);
    assert.equal(otherTeacherAfterResult.body.data.courses.some((course) => course._id === courseId), false);
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
    // Demo permission model lets students reach every course, so the access
    // check now denies non-owner teachers instead of students.
    const deniedResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${ids.foreignDraftCourse}`, {
      token: teacherToken,
    });
    const studentRelaxedResult = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${ids.foreignDraftCourse}`, {
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
    assert.equal(studentRelaxedResult.status, 200);
    assert.equal(studentRelaxedResult.body.data.course._id, ids.foreignDraftCourse);
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
    assert.ok(uploadResult.body.data.video.processing.queuedAt);
    assert.equal(uploadResult.body.data.video.processing.attemptCount, 0);
    assert.equal(uploadResult.body.data.video.file_name, formData.get('video').name);
    assert.ok(uploadResult.body.data.video.file_path);
    assert.equal(uploadResult.body.data.video.video_source, 'upload');
    assert.equal(uploadResult.body.data.video.video_url, uploadResult.body.data.video.sourceUrl);
    assert.equal(uploadResult.body.data.video.duration_sec, null);
    assert.equal(processingResult.status, 200);
    assert.equal(processingResult.body.data.processing.status, 'queued');
    assert.ok(processingResult.body.data.processing.queuedAt);
    assert.equal(processingResult.body.data.processing.attemptCount, 0);
    assert.deepEqual(
      store.courses.find((course) => course._id === createCourseResult.body.data.course._id).videoIds,
      [uploadResult.body.data.video._id],
    );
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

  it('registers YouTube videos without exposing uploads playback URLs', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const youtubeUrl = 'https://youtu.be/525ItlVdo6E';

    const createResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/youtube`,
      {
        method: 'POST',
        token: teacherToken,
        body: {
          youtubeUrl,
          title: 'YouTube lecture',
        },
      },
    );

    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      { token: teacherToken },
    );

    assert.equal(createResult.status, 201);
    assert.equal(createResult.body.data.video.sourceType, 'youtube');
    assert.equal(createResult.body.data.video.sourceUrl, null);
    assert.equal(createResult.body.data.video.youtubeVideoId, '525ItlVdo6E');
    assert.equal(createResult.body.data.video.youtube_video_id, '525ItlVdo6E');
    assert.equal(createResult.body.data.video.video_source, 'youtube');
    assert.equal(createResult.body.data.video.video_url, youtubeUrl);

    const listedVideo = listResult.body.data.videos.find((video) => video._id === createResult.body.data.video._id);
    assert.ok(listedVideo);
    assert.equal(listedVideo.sourceType, 'youtube');
    assert.equal(listedVideo.sourceUrl, null);
    assert.equal(listedVideo.youtubeVideoId, '525ItlVdo6E');
    assert.equal(listedVideo.youtube_video_id, '525ItlVdo6E');
    assert.equal(listedVideo.video_url, youtubeUrl);
  });

  it('rejects duplicate mp4 uploads with identical content in the same course', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const sharedContents = `dup-content-${Date.now()}`;

    const firstForm = createVideoUploadForm({
      title: 'Original mp4',
      filename: `${Date.now()}-test-upload-dup-1.mp4`,
      contents: sharedContents,
    });
    const first = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      { method: 'POST', token: teacherToken, body: firstForm },
    );
    assert.equal(first.status, 201);

    const secondForm = createVideoUploadForm({
      title: 'Duplicate mp4',
      filename: `${Date.now()}-test-upload-dup-2.mp4`,
      contents: sharedContents,
    });
    const second = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      { method: 'POST', token: teacherToken, body: secondForm },
    );

    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'DUPLICATE_VIDEO');
  });

  it('rejects duplicate YouTube video uploads in the same course', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const youtubeUrl = 'https://youtu.be/dupVideo123';

    const first = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/youtube`,
      { method: 'POST', token: teacherToken, body: { youtubeUrl, title: 'First upload' } },
    );
    assert.equal(first.status, 201);

    const second = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/youtube`,
      { method: 'POST', token: teacherToken, body: { youtubeUrl, title: 'Duplicate upload' } },
    );

    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'DUPLICATE_VIDEO');
  });

  it('records watched videos and updates enrollment progress', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.publishedVideo}/watched`,
      { method: 'POST', token: studentToken },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.progress, 100);
    assert.equal(result.body.data.watchedCount, 1);
    assert.equal(result.body.data.totalVideos, 1);

    const watchLogs = store.usageLogs.filter((log) => log.event === 'watch' && String(log.userId) === String(ids.student));
    assert.equal(watchLogs.length, 1);
    assert.equal(String(watchLogs[0].courseId), ids.publishedCourse);
    assert.equal(watchLogs[0].metadata?.videoId, ids.publishedVideo);

    const secondCall = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.publishedVideo}/watched`,
      { method: 'POST', token: studentToken },
    );
    assert.equal(secondCall.status, 200);
    const watchLogsAfter = store.usageLogs.filter((log) => log.event === 'watch' && String(log.userId) === String(ids.student));
    assert.equal(watchLogsAfter.length, 1, 'second call should not duplicate watch log');

    const dashboard = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/stats/student',
      { token: studentToken },
    );
    const courseEntry = dashboard.body.data.courseList.find((c) => c.id === ids.publishedCourse);
    assert.ok(courseEntry);
    assert.equal(courseEntry.progress, 100);
  });

  it('rejects watched-mark on a video not belonging to the target course', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/watched`,
      { method: 'POST', token: studentToken },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'VIDEO_NOT_FOUND');
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
    assert.ok(teacherProcessingResult.body.data.processing.attemptCount >= 0);
    assert.ok('queuedAt' in teacherProcessingResult.body.data.processing);
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
      filePath: 'uploads/enrolled-draft.mp4',
      durationSec: null,
      uploadedBy: ids.otherTeacher,
      processing: createProcessingState({
        status: 'completed',
        queuedAt: '2026-04-06T13:00:00.000Z',
        startedAt: '2026-04-06T13:01:00.000Z',
        completedAt: '2026-04-06T13:03:00.000Z',
        attemptCount: 1,
      }),
      createdAt: '2026-04-06T13:00:00.000Z',
      updatedAt: '2026-04-06T13:00:00.000Z',
    });

    const result = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${enrolledVideoId}`, {
      token: studentToken,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.video._id, enrolledVideoId);
  });

  it('marks bridge courses and returns metadata-only bridge videos for QA-scope presentation', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    store.courses.push({
      _id: ids.pipelineBridgeCourse,
      title: 'FocusFlow Pipeline Bridge Course',
      description: 'Bridge course for QA-only scoping.',
      teacherId: ids.teacher,
      videoIds: [ids.pipelineBridgeVideo],
      status: 'published',
      createdAt: '2026-04-13T08:00:00.000Z',
    });

    store.videos.push({
      _id: ids.pipelineBridgeVideo,
      video_id: ids.pipelineBridgeVideoExternal,
      file_name: 'pipeline-bridge.mp4',
      duration_sec: 900,
      createdAt: '2026-04-13T08:00:00.000Z',
      updatedAt: '2026-04-13T08:00:00.000Z',
    });

    const courseListResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      token: teacherToken,
    });
    const courseDetailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.pipelineBridgeCourse}`,
      { token: teacherToken },
    );
    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.pipelineBridgeCourse}/videos`,
      { token: teacherToken },
    );
    const detailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.pipelineBridgeVideo}`,
      { token: teacherToken },
    );
    const processingResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.pipelineBridgeVideo}/processing`,
      { token: teacherToken },
    );

    const bridgeCourseInList = courseListResult.body.data.courses.find((course) => course._id === ids.pipelineBridgeCourse);

    assert.equal(courseListResult.status, 200);
    assert.ok(bridgeCourseInList);
    assert.equal(bridgeCourseInList.isBridgeCourse, true);
    assert.equal(bridgeCourseInList.qaScopeOnly, true);
    assert.equal(bridgeCourseInList.bridgeMode, 'qa_scope_only');
    assert.equal(bridgeCourseInList.bridgeContract, 'course_video_refs_v1');
    assert.match(bridgeCourseInList.bridgeContractPath, /course\.videoIds/);
    assert.equal(bridgeCourseInList.bridgeVideoCount, 1);
    assert.equal(bridgeCourseInList.metadataOnlyVideoCount, 1);
    assert.equal(bridgeCourseInList.videoCount, 1);
    assert.equal(bridgeCourseInList.appVideoCount, 0);
    assert.equal(bridgeCourseInList.appOwnedVideoCount, 0);
    assert.equal(courseDetailResult.status, 200);
    assert.equal(courseDetailResult.body.data.course.isBridgeCourse, true);
    assert.equal(courseDetailResult.body.data.course.qaScopeOnly, true);
    assert.equal(courseDetailResult.body.data.course.bridgeMode, 'qa_scope_only');
    assert.equal(courseDetailResult.body.data.course.bridgeContract, 'course_video_refs_v1');
    assert.equal(listResult.status, 200);
    assert.equal(listResult.body.meta.isBridgeCourse, true);
    assert.equal(listResult.body.meta.qaScopeOnly, true);
    assert.equal(listResult.body.meta.bridgeMode, 'qa_scope_only');
    assert.equal(listResult.body.meta.appVideoCount, 0);
    assert.equal(listResult.body.meta.appOwnedVideoCount, 0);
    assert.equal(listResult.body.meta.bridgeVideoCount, 1);
    assert.equal(listResult.body.meta.metadataOnlyVideoCount, 1);
    assert.match(listResult.body.meta.bridgeContractPath, /course\.videoIds/);
    assert.equal(listResult.body.data.videos.length, 1);
    assert.equal(listResult.body.data.videos[0]._id, ids.pipelineBridgeVideo);
    assert.equal(listResult.body.data.videos[0].metadataOnly, true);
    assert.equal(listResult.body.data.videos[0].qaScopeOnly, true);
    assert.equal(listResult.body.data.videos[0].isAppOwned, false);
    assert.equal(listResult.body.data.videos[0].externalVideoId, ids.pipelineBridgeVideoExternal);
    assert.equal(detailResult.status, 200);
    assert.equal(detailResult.body.data.video.metadataOnly, true);
    assert.equal(detailResult.body.data.video.courseId, ids.pipelineBridgeCourse);
    assert.equal(processingResult.status, 409);
    assert.equal(processingResult.body.error.code, 'VIDEO_METADATA_ONLY');
  });

  it('resolves bridge videos when course videoIds reference external pipeline ids', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const bridgeCourseId = newObjectId();
    const bridgeVideoId = newObjectId();
    const bridgeExternalVideoId = 'pipeline-video-external-001';

    store.courses.push({
      _id: bridgeCourseId,
      title: 'External Pipeline Bridge Course',
      description: 'Course references pipeline video ids instead of Mongo ids.',
      teacherId: ids.teacher,
      videoIds: [bridgeExternalVideoId],
      status: 'published',
      createdAt: '2026-04-15T08:00:00.000Z',
    });

    store.videos.push({
      _id: bridgeVideoId,
      video_id: bridgeExternalVideoId,
      file_name: 'external-pipeline.mp4',
      duration_sec: 480,
      createdAt: '2026-04-15T08:00:00.000Z',
      updatedAt: '2026-04-15T08:00:00.000Z',
    });

    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${bridgeCourseId}/videos`,
      { token: teacherToken },
    );
    const detailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${bridgeVideoId}`,
      { token: teacherToken },
    );

    assert.equal(listResult.status, 200);
    assert.equal(listResult.body.data.videos.length, 1);
    assert.equal(listResult.body.data.videos[0]._id, bridgeVideoId);
    assert.equal(listResult.body.data.videos[0].externalVideoId, bridgeExternalVideoId);
    assert.equal(listResult.body.data.videos[0].metadataOnly, true);
    assert.equal(detailResult.status, 200);
    assert.equal(detailResult.body.data.video.courseId, bridgeCourseId);
  });

  it('marks mixed bridge courses with both canonical counts and readability aliases', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const mixedCourseId = newObjectId();
    const mixedAppVideoId = newObjectId();
    const mixedBridgeVideoId = newObjectId();
    const mixedBridgeExternalVideoId = 'video-mixed-bridge-001';

    store.courses.push({
      _id: mixedCourseId,
      title: 'Mixed Bridge Course',
      description: 'Course with both app-owned and bridge metadata videos.',
      teacherId: ids.teacher,
      videoIds: [mixedAppVideoId, mixedBridgeVideoId],
      status: 'published',
      createdAt: '2026-04-14T08:00:00.000Z',
    });

    store.videos.push(
      {
        _id: mixedAppVideoId,
        courseId: mixedCourseId,
        title: 'Mixed App Video',
        sourceType: 'upload',
        sourceUrl: '/uploads/mixed-app.mp4',
        video_id: 'video-mixed-app-001',
        file_name: 'mixed-app.mp4',
        file_path: 'uploads/mixed-app.mp4',
        durationSec: 120,
        duration_sec: 120,
        video_source: 'upload',
        video_url: '/uploads/mixed-app.mp4',
        uploadedBy: ids.teacher,
        processing: createProcessingState({
          status: 'completed',
          queuedAt: '2026-04-14T08:00:00.000Z',
          startedAt: '2026-04-14T08:01:00.000Z',
          completedAt: '2026-04-14T08:03:00.000Z',
          attemptCount: 1,
        }),
        createdAt: '2026-04-14T08:00:00.000Z',
        updatedAt: '2026-04-14T08:03:00.000Z',
      },
      {
        _id: mixedBridgeVideoId,
        video_id: mixedBridgeExternalVideoId,
        file_name: 'mixed-bridge.mp4',
        duration_sec: 300,
        createdAt: '2026-04-14T08:05:00.000Z',
        updatedAt: '2026-04-14T08:05:00.000Z',
      },
    );

    const courseDetailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${mixedCourseId}`,
      { token: teacherToken },
    );
    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${mixedCourseId}/videos`,
      { token: teacherToken },
    );

    assert.equal(courseDetailResult.status, 200);
    assert.equal(courseDetailResult.body.data.course.isBridgeCourse, true);
    assert.equal(courseDetailResult.body.data.course.bridgeMode, 'mixed_scope');
    assert.equal(courseDetailResult.body.data.course.appVideoCount, 1);
    assert.equal(courseDetailResult.body.data.course.appOwnedVideoCount, 1);
    assert.equal(courseDetailResult.body.data.course.bridgeVideoCount, 1);
    assert.equal(courseDetailResult.body.data.course.metadataOnlyVideoCount, 1);

    assert.equal(listResult.status, 200);
    assert.equal(listResult.body.meta.isBridgeCourse, true);
    assert.equal(listResult.body.meta.bridgeMode, 'mixed_scope');
    assert.equal(listResult.body.meta.appVideoCount, 1);
    assert.equal(listResult.body.meta.appOwnedVideoCount, 1);
    assert.equal(listResult.body.meta.bridgeVideoCount, 1);
    assert.equal(listResult.body.meta.metadataOnlyVideoCount, 1);
    assert.equal(listResult.body.data.videos.length, 2);
    assert.equal(listResult.body.data.videos.some((video) => video.metadataOnly === true), true);
    assert.equal(listResult.body.data.videos.some((video) => video.isAppOwned === true), true);
  });

  it('allows owner teacher and admin to retry failed videos but rejects other roles', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    store.videos.find((video) => video._id === ids.teacherVideo).processing = createProcessingState({
      status: 'failed',
      errorMessage: 'whisper timeout',
      errorCode: 'WHISPER_TIMEOUT',
      queuedAt: '2026-04-06T11:00:00.000Z',
      startedAt: '2026-04-06T11:02:00.000Z',
      failedAt: '2026-04-06T11:05:00.000Z',
      attemptCount: 1,
    });

    const studentResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      {
        method: 'POST',
        token: studentToken,
      },
    );
    const otherTeacherResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      {
        method: 'POST',
        token: otherTeacherToken,
      },
    );
    const teacherResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      {
        method: 'POST',
        token: teacherToken,
      },
    );

    assert.equal(studentResult.status, 403);
    assert.equal(studentResult.body.error.code, 'COURSE_MANAGE_DENIED');
    assert.equal(otherTeacherResult.status, 403);
    assert.equal(otherTeacherResult.body.error.code, 'COURSE_MANAGE_DENIED');
    assert.equal(teacherResult.status, 200);
    assert.equal(teacherResult.body.data.processing.status, 'queued');
    assert.equal(teacherResult.body.data.processing.errorMessage, null);
    assert.equal(teacherResult.body.data.processing.errorCode, null);
    assert.equal(teacherResult.body.data.processing.startedAt, null);
    assert.equal(teacherResult.body.data.processing.completedAt, null);
    assert.equal(teacherResult.body.data.processing.failedAt, null);
    assert.equal(teacherResult.body.data.processing.attemptCount, 1);
    assert.ok(teacherResult.body.data.processing.queuedAt);

    store.videos.find((video) => video._id === ids.teacherVideo).processing = createProcessingState({
      status: 'failed',
      errorMessage: 'atlas timeout',
      queuedAt: '2026-04-06T11:00:00.000Z',
      failedAt: '2026-04-06T11:08:00.000Z',
      attemptCount: 2,
    });

    const adminResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      {
        method: 'POST',
        token: adminToken,
      },
    );

    assert.equal(adminResult.status, 200);
    assert.equal(adminResult.body.data.processing.status, 'queued');
    assert.equal(adminResult.body.data.processing.attemptCount, 2);
  });

  it('rejects retry when the current processing state is not failed', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/processing/retry`,
      {
        method: 'POST',
        token: teacherToken,
      },
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'VIDEO_PROCESSING_TRANSITION_INVALID');
  });

  it('requires the processing secret for internal start and enforces strict transitions', async () => {
    const missingSecretResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
      },
    );
    const invalidSecretResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': 'wrong-secret',
        },
      },
    );
    const successResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const invalidTransitionResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(missingSecretResult.status, 401);
    assert.equal(missingSecretResult.body.error.code, 'UNAUTHORIZED');
    assert.equal(invalidSecretResult.status, 401);
    assert.equal(successResult.status, 200);
    assert.equal(successResult.body.data.processing.status, 'processing');
    assert.ok(successResult.body.data.processing.startedAt);
    assert.equal(successResult.body.data.processing.attemptCount, 1);
    assert.equal(invalidTransitionResult.status, 409);
    assert.equal(invalidTransitionResult.body.error.code, 'VIDEO_PROCESSING_TRANSITION_INVALID');
  });

  it('completes processing only from processing state and updates durationSec', async () => {
    const startResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const completeResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          durationSec: 123,
          metadata: {
            ignored: true,
          },
        },
      },
    );
    const secondCompleteResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(startResult.status, 200);
    assert.equal(completeResult.status, 200);
    assert.equal(completeResult.body.data.processing.status, 'completed');
    assert.ok(completeResult.body.data.processing.completedAt);
    assert.equal(store.videos.find((video) => video._id === ids.teacherVideo).durationSec, 123);
    assert.equal(secondCompleteResult.status, 409);
    assert.equal(secondCompleteResult.body.error.code, 'VIDEO_PROCESSING_TRANSITION_INVALID');
  });

  it('fails processing from queued or processing states and requires errorMessage', async () => {
    const missingMessageResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          errorCode: 'WORKER_TIMEOUT',
        },
      },
    );
    const queuedFailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          errorMessage: 'worker timeout',
          errorCode: 'WORKER_TIMEOUT',
        },
      },
    );

    store.videos.find((video) => video._id === ids.teacherVideo).processing = createProcessingState({
      status: 'queued',
      queuedAt: '2026-04-06T11:00:00.000Z',
      attemptCount: 1,
    });

    const processingStartResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const processingFailResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          errorMessage: 'chunking failed',
        },
      },
    );
    const invalidTransitionResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.teacherVideo}/processing/fail`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          errorMessage: 'should not happen twice',
        },
      },
    );

    assert.equal(missingMessageResult.status, 400);
    assert.equal(missingMessageResult.body.error.code, 'VALIDATION_ERROR');
    assert.equal(queuedFailResult.status, 200);
    assert.equal(queuedFailResult.body.data.processing.status, 'failed');
    assert.equal(queuedFailResult.body.data.processing.errorMessage, 'worker timeout');
    assert.equal(queuedFailResult.body.data.processing.errorCode, 'WORKER_TIMEOUT');
    assert.ok(queuedFailResult.body.data.processing.failedAt);
    assert.equal(processingStartResult.status, 200);
    assert.equal(processingFailResult.status, 200);
    assert.equal(processingFailResult.body.data.processing.status, 'failed');
    assert.equal(processingFailResult.body.data.processing.errorMessage, 'chunking failed');
    assert.ok(processingFailResult.body.data.processing.failedAt);
    assert.equal(invalidTransitionResult.status, 409);
    assert.equal(invalidTransitionResult.body.error.code, 'VIDEO_PROCESSING_TRANSITION_INVALID');
  });

  it('教師可將自己的影片掛載到另一個自己的課程並出現在課程影片列表', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const attachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/attach`,
      { method: 'POST', token: teacherToken },
    );

    assert.equal(attachResult.status, 201);
    assert.equal(attachResult.body.success, true);

    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      { token: teacherToken },
    );

    assert.equal(listResult.status, 200);
    assert.equal(
      listResult.body.data.videos.some((video) => video._id === ids.publishedVideo),
      true,
      '掛載後課程影片列表應包含該影片',
    );
  });

  it('重複掛載同一支影片回傳 409 DUPLICATE_VIDEO', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const attachPath = `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/attach`;

    await jsonRequest(serverContext.baseUrl, attachPath, { method: 'POST', token: teacherToken });
    const duplicateResult = await jsonRequest(serverContext.baseUrl, attachPath, { method: 'POST', token: teacherToken });

    assert.equal(duplicateResult.status, 409);
    assert.equal(duplicateResult.body.error.code, 'DUPLICATE_VIDEO');
  });

  it('掛載影片到影片本身的主課程回傳 409 DUPLICATE_VIDEO', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const selfAttachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.publishedVideo}/attach`,
      { method: 'POST', token: teacherToken },
    );

    assert.equal(selfAttachResult.status, 409);
    assert.equal(selfAttachResult.body.error.code, 'DUPLICATE_VIDEO');
  });

  it('學生不可掛載影片', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const attachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/attach`,
      { method: 'POST', token: studentToken },
    );

    assert.equal(attachResult.status, 403);
  });

  it('教師不可掛載其他老師課程的影片', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const foreignVideoId = newObjectId();

    store.videos.push({
      _id: foreignVideoId,
      courseId: ids.enrolledDraftCourse,
      title: 'Foreign Teacher Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/foreign.mp4',
      uploadedBy: ids.otherTeacher,
      processing: createProcessingState({ status: 'completed' }),
      createdAt: '2026-04-07T09:00:00.000Z',
      updatedAt: '2026-04-07T09:00:00.000Z',
    });

    const attachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${foreignVideoId}/attach`,
      { method: 'POST', token: teacherToken },
    );

    assert.equal(attachResult.status, 403);
    assert.equal(attachResult.body.error.code, 'COURSE_MANAGE_DENIED');
  });

  it('可解除掛載影片，但不可從主課程解除', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/attach`,
      { method: 'POST', token: teacherToken },
    );

    const detachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/detach`,
      { method: 'POST', token: teacherToken },
    );
    assert.equal(detachResult.status, 200);

    const listResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos`,
      { token: teacherToken },
    );
    assert.equal(
      listResult.body.data.videos.some((video) => video._id === ids.publishedVideo),
      false,
      '解除掛載後列表不應再包含該影片',
    );

    const primaryDetachResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.publishedVideo}/detach`,
      { method: 'POST', token: teacherToken },
    );
    assert.equal(primaryDetachResult.status, 400);
    assert.equal(primaryDetachResult.body.error.code, 'VALIDATION_ERROR');
  });

  it('刪除影片會從所有掛載課程的 videoIds 移除引用', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/videos/${ids.publishedVideo}/attach`,
      { method: 'POST', token: teacherToken },
    );

    const deleteResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.publishedVideo}`,
      { method: 'DELETE', token: teacherToken },
    );
    assert.equal(deleteResult.status, 200);

    const teacherCourse = store.courses.find((course) => course._id === ids.teacherCourse);
    const publishedCourse = store.courses.find((course) => course._id === ids.publishedCourse);
    assert.equal(teacherCourse.videoIds.map(String).includes(ids.publishedVideo), false);
    assert.equal(publishedCourse.videoIds.map(String).includes(ids.publishedVideo), false);
  });

  it('學生可對掛載到已發布課程的影片記錄觀看進度', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.teacherVideo}/attach`,
      { method: 'POST', token: teacherToken },
    );

    const watchedResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos/${ids.teacherVideo}/watched`,
      { method: 'POST', token: studentToken },
    );

    assert.equal(watchedResult.status, 200);
    assert.equal(watchedResult.body.data.videoId, ids.teacherVideo);
  });
});
