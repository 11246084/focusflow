const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  createFeedbackForm,
} = require('./helpers/backendTestHarness');

describe('feedback routes', () => {
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

  it('學生可建立回報問題，並記錄課程與影片名稱', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({
        category: 'course_video',
        severity: 'blocking',
        description: '影片播放到一半卡住。',
        courseVideoName: 'AI 入門基礎課 / 第三講 影片處理工具',
      }),
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.category, 'course_video');
    assert.equal(result.body.data.severity, 'blocking');
    assert.equal(result.body.data.courseVideoName, 'AI 入門基礎課 / 第三講 影片處理工具');
    assert.equal(result.body.data.status, 'open');
    assert.deepEqual(result.body.data.attachments, []);
  });

  it('教師也可建立回報問題', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({ category: 'ui_operation', severity: 'minor', description: '課程列表排序希望可以自訂。' }),
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.category, 'ui_operation');
    assert.equal(result.body.data.severity, 'minor');
    assert.equal(result.body.data.courseVideoName, null);
  });

  it('可帶附件建立回報問題', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({
        description: '上傳截圖示範問題。',
        attachments: [{ filename: 'bug.png' }],
      }),
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.attachments.length, 1);
    assert.equal(result.body.data.attachments[0].mimeType, 'image/png');
  });

  it('影響程度不合法回傳 400', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({ severity: 'not-a-real-severity' }),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('未登入建立回報問題回傳 401', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      body: createFeedbackForm(),
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('附件型別不合法回傳 400', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({
        attachments: [{ filename: 'note.pdf', type: 'application/pdf' }],
      }),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_FEEDBACK_ATTACHMENT_TYPE');
  });

  it('分類不合法回傳 400', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token,
      body: createFeedbackForm({ category: 'not-a-real-category' }),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('本人可下載自己回報的附件，非本人非 admin 會被拒絕', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const createResult = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token: studentToken,
      body: createFeedbackForm({ attachments: [{ filename: 'bug.png' }] }),
    });
    const { id: feedbackId, attachments } = createResult.body.data;
    const attachmentId = attachments[0].attachmentId;

    const ownerResponse = await fetch(
      `${serverContext.baseUrl}/api/v1/feedback/${feedbackId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${studentToken}` } },
    );
    assert.equal(ownerResponse.status, 200);
    assert.equal(ownerResponse.headers.get('content-type'), 'image/png');

    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const forbiddenResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/feedback/${feedbackId}/attachments/${attachmentId}`,
      { token: teacherToken },
    );
    assert.equal(forbiddenResult.status, 403);
    assert.equal(forbiddenResult.body.error.code, 'FORBIDDEN');

    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const adminResponse = await fetch(
      `${serverContext.baseUrl}/api/v1/feedback/${feedbackId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    assert.equal(adminResponse.status, 200);
  });

  it('admin 可列表並依狀態篩選、更新狀態與備註', async () => {
    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(serverContext.baseUrl, '/api/v1/feedback', {
      method: 'POST',
      token: studentToken,
      body: createFeedbackForm({ category: 'course_video', description: '待處理的問題。' }),
    });
    const feedbackId = created.body.data.id;

    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');

    const listResult = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/feedback', { token: adminToken });
    assert.equal(listResult.status, 200);
    assert.equal(listResult.body.data.feedback.length, 1);
    assert.equal(listResult.body.data.feedback[0].submitter.email, 'student@focusflow.local');

    const filteredResult = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/feedback?status=resolved',
      { token: adminToken },
    );
    assert.equal(filteredResult.body.data.feedback.length, 0);

    const updateResult = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/feedback/${feedbackId}`,
      { method: 'PATCH', token: adminToken, body: { status: 'resolved', adminNote: '已修復並部署。' } },
    );
    assert.equal(updateResult.status, 200);
    assert.equal(updateResult.body.data.status, 'resolved');
    assert.equal(updateResult.body.data.adminNote, '已修復並部署。');
  });

  it('非 admin 呼叫管理端列表回傳 403', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/feedback', { token: teacherToken });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('回報問題不存在時下載附件回傳 404', async () => {
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/feedback/${ids.publishedVideo}/attachments/${ids.publishedVideo}`,
      { token: adminToken },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'FEEDBACK_NOT_FOUND');
  });
});
