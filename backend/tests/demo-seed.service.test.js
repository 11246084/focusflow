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

  it('creates a QA bridge course that points to existing pipeline videos when matching segments already exist', async () => {
    store.videos.push({
      _id: 'pipeline-video-001',
      video_id: 'video_001',
      file_name: 'pipeline-video-001.mp4',
      duration_sec: 1800,
    });

    store.videoSegments.push({
      _id: 'pipeline-segment-001',
      video_id: 'video_001',
      start_sec: 10,
      end_sec: 25,
      text: 'Pipeline bridge seed test segment.',
      embedding: [],
    });

    const result = await seedDemoData({ silent: true });

    const bridgeCourse = store.courses.find((course) => course.title === 'FocusFlow Pipeline Bridge Course');

    assert.ok(bridgeCourse);
    assert.deepEqual(bridgeCourse.videoIds, ['pipeline-video-001']);
    assert.equal(store.videos.filter((video) => video.video_id === 'video_001').length, 1);
    assert.deepEqual(result.pipelineBridge?.externalVideoIds, ['video_001']);
  });
});
