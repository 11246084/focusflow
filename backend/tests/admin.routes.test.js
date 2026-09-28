const assert = require('node:assert/strict');
const {
  after,
  before,
  beforeEach,
  describe,
  it,
} = require('node:test');
const {
  ids,
  jsonRequest,
  loginAs,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

describe('admin routes', () => {
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

  it('依 Enrollment.studentId 回傳每位學生的修課數', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'admin@focusflow.local',
      'Admin123!',
      'admin',
    );
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/users', { token });

    assert.equal(result.status, 200);
    const student = result.body.data.users.find((user) => user.id === ids.student);
    const teacher = result.body.data.users.find((user) => user.id === ids.teacher);
    assert.equal(student.courses, 2);
    assert.equal(teacher.courses, 0);
  });

  it('使用者列表只回傳是否綁定 LINE，不回傳原始 lineUserId', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'admin@focusflow.local',
      'Admin123!',
      'admin',
    );
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/users', { token });

    assert.equal(result.status, 200);
    const student = result.body.data.users.find((user) => user.id === ids.student);
    const teacher = result.body.data.users.find((user) => user.id === ids.teacher);
    assert.equal(student.isLineBound, true);
    assert.equal(teacher.isLineBound, false);
    for (const user of result.body.data.users) {
      assert.equal(Object.hasOwn(user, 'lineUserId'), false);
    }
    assert.equal(JSON.stringify(result.body).includes('line-student-001'), false);
  });

  it('更新使用者後的回應只回傳是否綁定 LINE，不回傳原始 lineUserId', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'admin@focusflow.local',
      'Admin123!',
      'admin',
    );
    const result = await jsonRequest(serverContext.baseUrl, `/api/v1/admin/users/${ids.student}`, {
      method: 'PATCH',
      token,
      body: { name: 'Renamed Student' },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.name, 'Renamed Student');
    assert.equal(result.body.data.isLineBound, true);
    assert.equal(Object.hasOwn(result.body.data, 'lineUserId'), false);
    assert.equal(JSON.stringify(result.body).includes('line-student-001'), false);
  });

  it('管理員可設定與清除學生的每日提問上限', async () => {
    const token = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
    const url = `/api/v1/admin/users/${ids.student}`;

    const set = await jsonRequest(serverContext.baseUrl, url, {
      method: 'PATCH', token, body: { dailyAskLimitOverride: 0 },
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.data.dailyAskLimitOverride, 0);

    const cleared = await jsonRequest(serverContext.baseUrl, url, {
      method: 'PATCH', token, body: { dailyAskLimitOverride: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.dailyAskLimitOverride, null);
  });

  it('每日提問上限不是 0 到 1000 的整數時回 400', async () => {
    const token = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');

    for (const value of [-1, 1.5, '10', 1001]) {
      const result = await jsonRequest(serverContext.baseUrl, `/api/v1/admin/users/${ids.student}`, {
        method: 'PATCH', token, body: { dailyAskLimitOverride: value },
      });
      assert.equal(result.status, 400, `value=${JSON.stringify(value)}`);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('使用者列表附上全站預設每日提問上限', async () => {
    const token = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/users', { token });

    assert.equal(result.status, 200);
    assert.equal(Number.isInteger(result.body.data.dailyAskLimitDefault), true);
    const student = result.body.data.users.find((user) => user.id === ids.student);
    assert.equal(student.dailyAskLimitOverride, null);
  });

  it('學生角色不能讀取管理員使用者統計', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
      'student',
    );
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/users', { token });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('管理員刪除影片也受 FAQ strict gate 保護並可安全重試', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'admin@focusflow.local',
      'Admin123!',
      'admin',
    );
    store.faqs.push({
      _id: '507f191e810c19729de86999',
      courseId: ids.publishedCourse,
      question: 'Admin delete FAQ',
    });
    store.nextFaqDeleteManyError = new Error('simulated FAQ delete failure');

    const failed = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/videos/${ids.publishedVideo}`,
      { method: 'DELETE', token },
    );

    assert.equal(failed.status, 503);
    assert.equal(failed.body.error.code, 'FAQ_INVALIDATION_FAILED');
    assert.ok(store.videos.some((video) => video._id === ids.publishedVideo));
    assert.equal(store.faqs.length, 1);

    const retried = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/admin/videos/${ids.publishedVideo}`,
      { method: 'DELETE', token },
    );

    assert.equal(retried.status, 200);
    assert.equal(store.videos.some((video) => video._id === ids.publishedVideo), false);
    assert.equal(store.faqs.length, 0);
  });
});
