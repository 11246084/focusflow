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
} = require('./helpers/backendTestHarness');

describe('GET /api/v1/admin/users', () => {
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
});
