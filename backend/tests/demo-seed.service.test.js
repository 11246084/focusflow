const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { seedDemoData } = require('../src/services/demoSeed.service');
const { store, resetStore } = require('./helpers/backendTestHarness');

function clearDemoStore() {
  store.users.length = 0;
  store.courses.length = 0;
  store.videos.length = 0;
  store.enrollments.length = 0;
  store.videoSegments.length = 0;
  store.clips.length = 0;
  store.usageLogs.length = 0;
  store.lineBindTokens.length = 0;
}

describe('demo seed service', () => {
  beforeEach(() => {
    resetStore();
    clearDemoStore();
  });

  it('creates repeatable demo data for auth, course, video, and qa flows', async () => {
    const firstRun = await seedDemoData({ silent: true });
    const secondRun = await seedDemoData({ silent: true });

    assert.equal(firstRun.users.length, 3);
    assert.equal(firstRun.courses.length, 2);
    assert.equal(firstRun.videos.length, 2);
    assert.equal(firstRun.segments.length, 3);

    assert.equal(store.users.length, 3);
    assert.equal(store.courses.length, 2);
    assert.equal(store.videos.length, 2);
    assert.equal(store.enrollments.length, 1);
    assert.equal(store.videoSegments.length, 3);
    assert.equal(store.clips.length, 1);

    const student = store.users.find((user) => user.email === 'student@focusflow.local');
    const publishedCourse = store.courses.find((course) => course.status === 'published');
    const draftVideo = store.videos.find((video) => video.video_id === 'focusflow-demo-video-processing');

    assert.ok(student);
    assert.ok(publishedCourse);
    assert.equal(String(student.activeCourseId), String(publishedCourse._id));
    assert.equal(student.lineUserId, 'demo-line-student-001');
    assert.equal(draftVideo.processing.status, 'failed');

    assert.deepEqual(firstRun.courses, secondRun.courses);
    assert.deepEqual(firstRun.videos, secondRun.videos);
  });
});
