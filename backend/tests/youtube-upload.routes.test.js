const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  jsonRequest,
  loginAs,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

describe('YouTube upload recovery route', () => {
  let serverContext;

  before(async () => { serverContext = await startServer(); });
  after(async () => { await stopServer(serverContext.server); });
  beforeEach(() => resetStore());

  it('學生不能排程 YouTube upload retry', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/youtube-upload/retry`,
      { method: 'POST', token: studentToken },
    );

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('owner teacher 對不確定是否已完成的 upload 會收到明確 409 而非重傳', async () => {
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.youtubeVideoId = null;
    video.youtubeUpload = { status: 'failed', attemptCount: 1, retrySafe: false };
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/videos/${ids.teacherVideo}/youtube-upload/retry`,
      { method: 'POST', token: teacherToken },
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'YOUTUBE_UPLOAD_RETRY_UNSAFE');
  });
});
