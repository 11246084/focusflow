const assert = require('node:assert/strict');
const {
  after,
  before,
  beforeEach,
  describe,
  it,
} = require('node:test');
const {
  jsonRequest,
  loginAs,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

describe('GET /api/v1/stats/student', () => {
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

  it('新註冊且尚無學習活動的學生會收到穩定的 zero-state', async () => {
    const registration = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Zero State Student',
        email: 'zero-state@example.com',
        password: 'Student123!',
        role: 'student',
      },
    });
    assert.equal(registration.status, 201);

    const studentId = registration.body.data.user.id;
    store.usageLogs.length = 0;
    assert.equal(store.enrollments.some((item) => String(item.studentId) === studentId), false);
    assert.equal(store.questions.some((item) => String(item.userId) === studentId), false);
    assert.equal(store.usageLogs.length, 0);

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/stats/student', {
      token: registration.body.data.token,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(result.body.data, {
      coursesCount: 0,
      videosCount: 0,
      totalQueries: 0,
      weeklyQueries: 0,
      avgProgress: 0,
      answerRate: 0,
      courseList: [],
      recentQueries: [],
    });
  });

  it('未登入時拒絕讀取學生 dashboard 統計', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/stats/student');

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('教師角色不能讀取學生 dashboard 統計', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
      'teacher',
    );
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/stats/student', { token });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });
});
