const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  store,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
} = require('./helpers/backendTestHarness');

describe('strict Enrollment routes and access', () => {
  let serverContext;

  before(async () => { serverContext = await startServer(); });
  after(async () => { await stopServer(serverContext.server); });
  beforeEach(() => resetStore());

  async function registerStudent(email = 'strict.student@example.com') {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Strict Student',
        email,
        password: 'StrictPass123!',
        role: 'student',
      },
    });
    assert.equal(result.status, 201);
    return {
      token: result.body.data.token,
      user: store.users.find((item) => item.email === email),
    };
  }

  it('new students have an empty course list and cannot access a published course or QA', async () => {
    const { token } = await registerStudent();
    const list = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token });
    const course = await jsonRequest(serverContext.baseUrl, `/api/v1/courses/${ids.publishedCourse}`, { token });
    const qa = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token,
      body: { courseId: ids.publishedCourse, question: 'What is JWT?' },
    });

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.courses, []);
    assert.equal(course.status, 403);
    assert.equal(course.body.error.code, 'COURSE_ACCESS_DENIED');
    assert.equal(qa.status, 403);
    assert.equal(qa.body.error.code, 'COURSE_ACCESS_DENIED');
  });

  it('owner teacher assigns by exact email idempotently and the student gains course access', async () => {
    const { token: studentToken, user } = await registerStudent();
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const path = `/api/v1/courses/${ids.publishedCourse}/enrollments`;

    const first = await jsonRequest(serverContext.baseUrl, path, {
      method: 'POST', token: teacherToken, body: { studentEmail: user.email },
    });
    const second = await jsonRequest(serverContext.baseUrl, path, {
      method: 'POST', token: teacherToken, body: { studentEmail: user.email },
    });
    const enrollmentList = await jsonRequest(serverContext.baseUrl, path, { token: teacherToken });
    const courses = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: studentToken });
    const videos = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos`,
      { token: studentToken },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.data.enrollment.status, 'active');
    assert.equal(store.enrollments.filter((item) => (
      String(item.studentId) === String(user._id)
      && String(item.courseId) === ids.publishedCourse
    )).length, 1);
    assert.equal(enrollmentList.body.data.enrollments.some(
      (item) => item.student.id === String(user._id),
    ), true);
    assert.deepEqual(courses.body.data.courses.map((item) => item._id), [ids.publishedCourse]);
    assert.equal(videos.status, 200);
  });

  it('revocation clears LINE scope, denies access, preserves history, and permits reactivation', async () => {
    const { token: studentToken, user } = await registerStudent();
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const path = `/api/v1/courses/${ids.publishedCourse}/enrollments`;
    await jsonRequest(serverContext.baseUrl, path, {
      method: 'POST', token: teacherToken, body: { studentEmail: user.email },
    });
    user.activeCourseId = ids.publishedCourse;
    user.lineConversationHistory = [{ role: 'user', content: 'old context' }];
    store.questions.push({ _id: 'history-question', userId: user._id, courseId: ids.publishedCourse });
    store.usageLogs.push({ _id: 'history-usage', userId: user._id, courseId: ids.publishedCourse });

    const revoked = await jsonRequest(
      serverContext.baseUrl,
      `${path}/${user._id}`,
      { method: 'DELETE', token: teacherToken },
    );
    const coursesAfter = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: studentToken });
    const videosAfter = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/videos`,
      { token: studentToken },
    );

    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.enrollment.status, 'revoked');
    assert.equal(user.activeCourseId, undefined);
    assert.deepEqual(user.lineConversationHistory, []);
    assert.deepEqual(coursesAfter.body.data.courses, []);
    assert.equal(videosAfter.status, 403);
    assert.equal(store.questions.some((item) => item._id === 'history-question'), true);
    assert.equal(store.usageLogs.some((item) => item._id === 'history-usage'), true);

    const reactivated = await jsonRequest(serverContext.baseUrl, path, {
      method: 'POST', token: teacherToken, body: { studentEmail: user.email },
    });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.data.enrollment.status, 'active');
  });

  it('draft content stays denied and other teachers cannot manage enrollments', async () => {
    const { token: studentToken, user } = await registerStudent();
    const ownerToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const assigned = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}/enrollments`,
      { method: 'POST', token: ownerToken, body: { studentEmail: user.email } },
    );
    const deniedCourse = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.teacherCourse}`,
      { token: studentToken },
    );
    const forbiddenManage = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/enrollments`,
      { method: 'POST', token: otherTeacherToken, body: { studentEmail: user.email } },
    );

    assert.equal(assigned.status, 200);
    assert.equal(deniedCourse.status, 403);
    assert.equal(deniedCourse.body.error.code, 'COURSE_ACCESS_DENIED');
    assert.equal(forbiddenManage.status, 403);
    assert.equal(forbiddenManage.body.error.code, 'COURSE_MANAGE_DENIED');
  });

  it('教師匯入名單會建立新帳號、以學號登入並取得課程權限', async () => {
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const imported = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/enrollments/import`,
      {
        method: 'POST',
        token: teacherToken,
        body: { students: [{ name: '王小明', email: '11246001@ntub.edu.tw', studentId: '11246001' }] },
      },
    );
    const studentToken = await loginAs(serverContext.baseUrl, '11246001@ntub.edu.tw', '11246001', 'student');
    const courses = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', { token: studentToken });

    assert.equal(imported.status, 200);
    assert.deepEqual(imported.body.data, { created: 1, enrolled: 1, skipped: [] });
    assert.deepEqual(courses.body.data.courses.map((item) => item._id), [ids.publishedCourse]);
  });

  it('匯入時既有學生只加課不改密碼，非學生帳號與不合法資料列會被略過', async () => {
    const { user } = await registerStudent();
    const originalHash = user.passwordHash;
    const teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const imported = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/courses/${ids.publishedCourse}/enrollments/import`,
      {
        method: 'POST',
        token: teacherToken,
        body: {
          students: [
            { name: 'Strict Student', email: user.email, studentId: '11246002' },
            { name: 'Teacher', email: 'teacher2@focusflow.local', studentId: '11246003' },
            { name: 'Short', email: 'short@example.com', studentId: '123' },
          ],
        },
      },
    );

    assert.equal(imported.status, 200);
    assert.equal(imported.body.data.created, 0);
    assert.equal(imported.body.data.enrolled, 1);
    assert.deepEqual(imported.body.data.skipped.map((item) => item.reason), ['NOT_STUDENT', 'STUDENT_ID_TOO_SHORT']);
    assert.equal(user.passwordHash, originalHash);
  });

  it('非課程擁有者的教師與學生不能匯入名單', async () => {
    const { token: studentToken } = await registerStudent();
    const otherTeacherToken = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');
    const path = `/api/v1/courses/${ids.publishedCourse}/enrollments/import`;
    const body = { students: [{ name: 'X', email: 'x@example.com', studentId: '11246009' }] };

    const otherTeacher = await jsonRequest(serverContext.baseUrl, path, { method: 'POST', token: otherTeacherToken, body });
    const student = await jsonRequest(serverContext.baseUrl, path, { method: 'POST', token: studentToken, body });

    assert.equal(otherTeacher.status, 403);
    assert.equal(otherTeacher.body.error.code, 'COURSE_MANAGE_DENIED');
    assert.equal(student.status, 403);
    assert.equal(store.users.some((item) => item.email === 'x@example.com'), false);
  });

  it('admin may manage every course while students cannot call management APIs', async () => {
    const { token: studentToken, user } = await registerStudent();
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');
    const path = `/api/v1/courses/${ids.publishedCourse}/enrollments`;

    const adminAssign = await jsonRequest(serverContext.baseUrl, path, {
      method: 'POST', token: adminToken, body: { studentEmail: user.email },
    });
    const studentList = await jsonRequest(serverContext.baseUrl, path, { token: studentToken });

    assert.equal(adminAssign.status, 200);
    assert.equal(studentList.status, 403);
  });
});
