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
