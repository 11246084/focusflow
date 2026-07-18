const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  store,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
} = require('./helpers/backendTestHarness');

function addShort({
  _id = newObjectId(),
  courseId = ids.publishedCourse,
  title = 'Course Short',
  status = 'published',
  youtubeAvailability = 'playable',
  youtubeVideoId = `yt-${_id}`,
  publishedAt = '2026-07-18T08:00:00.000Z',
} = {}) {
  store.shortAssets.push({
    _id,
    courseId,
    sourceVideoId: ids.publishedVideo,
    jobId: null,
    title,
    description: '',
    status,
    youtubeVideoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
    thumbnail: `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`,
    publishedAt,
    youtubeAvailability,
    youtubePrivacyStatus: 'public',
    lastCheckedAt: publishedAt,
  });
  return _id;
}

describe('GET /api/v1/youtube/shorts', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => resetStore());

  it('未登入回傳 401，非學生回傳 403', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const anonymous = await jsonRequest(serverContext.baseUrl, '/api/v1/youtube/shorts');
    const teacher = await jsonRequest(serverContext.baseUrl, '/api/v1/youtube/shorts', { token: teacherToken });

    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, 'UNAUTHORIZED');
    assert.equal(teacher.status, 403);
    assert.equal(teacher.body.error.code, 'FORBIDDEN');
  });

  it('只回傳修課、已發布課程、已發布且 playable 的 Short', async () => {
    const foreignPublishedCourseId = newObjectId();
    store.courses.push({
      _id: foreignPublishedCourseId,
      title: 'Not Enrolled Course',
      teacherId: ids.otherTeacher,
      status: 'published',
    });
    const visibleAssetId = addShort({ title: 'Visible Short', youtubeVideoId: 'visible-short' });
    addShort({ title: 'Pending Short', youtubeAvailability: 'pending' });
    addShort({ title: 'Draft Short', status: 'draft' });
    addShort({ title: 'Archived Short', status: 'archived' });
    addShort({ title: 'Legacy Empty YouTube ID', youtubeVideoId: '' });
    addShort({ title: 'Legacy Null YouTube ID', youtubeVideoId: null });
    addShort({ title: 'Draft Course Short', courseId: ids.enrolledDraftCourse });
    addShort({ title: 'Foreign Short', courseId: foreignPublishedCourseId });

    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/youtube/shorts', { token: studentToken });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.items.length, 1);
    assert.deepEqual(result.body.data.items[0], {
      videoId: 'visible-short',
      title: 'Visible Short',
      thumbnail: 'https://img.youtube.com/vi/visible-short/hqdefault.jpg',
      publishedAt: '2026-07-18T08:00:00.000Z',
      assetId: visibleAssetId,
      course: {
        courseId: ids.publishedCourse,
        title: 'Published AI Course',
      },
      youtubeUrl: 'https://www.youtube.com/watch?v=visible-short',
    });
    assert.equal(result.body.data.nextPageToken, null);
  });

  it('無修課時回傳 200 空陣列', async () => {
    store.enrollments.length = 0;
    addShort();
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/youtube/shorts', { token: studentToken });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { items: [], nextPageToken: null });
  });

  it('以 publishedAt 與 _id opaque cursor 穩定分頁且不重複', async () => {
    const assetIds = [
      '507f191e810c19729de86101',
      '507f191e810c19729de86102',
      '507f191e810c19729de86103',
    ];
    assetIds.forEach((_id, index) => addShort({
      _id,
      title: `Short ${index + 1}`,
      youtubeVideoId: `cursor-${index + 1}`,
      publishedAt: '2026-07-18T09:00:00.000Z',
    }));
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

    const first = await jsonRequest(serverContext.baseUrl, '/api/v1/youtube/shorts?limit=2', { token: studentToken });
    const second = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/youtube/shorts?limit=2&pageToken=${encodeURIComponent(first.body.data.nextPageToken)}`,
      { token: studentToken },
    );

    assert.equal(first.status, 200);
    assert.deepEqual(first.body.data.items.map((item) => item.assetId), [assetIds[2], assetIds[1]]);
    assert.ok(first.body.data.nextPageToken);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.data.items.map((item) => item.assetId), [assetIds[0]]);
    assert.equal(second.body.data.nextPageToken, null);
  });

  it('非法 cursor 或 limit 回傳 400', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const invalidCursor = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/youtube/shorts?pageToken=not-a-cursor',
      { token: studentToken },
    );
    const invalidLimit = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/youtube/shorts?limit=51',
      { token: studentToken },
    );

    assert.equal(invalidCursor.status, 400);
    assert.equal(invalidCursor.body.error.code, 'INVALID_PAGE_TOKEN');
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimit.body.error.code, 'VALIDATION_ERROR');
  });

  it('重複 pageToken query 回傳 400 而非被當成首頁', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/youtube/shorts?pageToken=cursor-one&pageToken=cursor-two',
      { token: studentToken },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_PAGE_TOKEN');
  });
});
