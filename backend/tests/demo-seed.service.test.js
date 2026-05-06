const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const {
  DEMO_VIDEOS,
  seedDemoData,
} = require('../src/services/demoSeed.service');
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

  it('creates repeatable demo data for auth, course, video, qa, and pipeline-style bridge demo flows', async () => {
    const firstRun = await seedDemoData({ silent: true, reset: true });
    const secondRun = await seedDemoData({ silent: true });

    assert.equal(firstRun.users.length, 3);
    assert.equal(firstRun.courses.length, 3);
    assert.equal(firstRun.videos.length, 3);
    assert.equal(firstRun.segments.length, 3);
    assert.equal(firstRun.pipelineBridge?.baseline, 'pipeline_style_demo_baseline');
    assert.equal(firstRun.pipelineBridge?.fullySynchronizedWithLivePipeline, false);

    assert.equal(store.users.length, 3);
    assert.equal(store.courses.length, 3);
    assert.equal(store.videos.length, 3);
    assert.equal(store.enrollments.length, 2);
    assert.equal(store.videoSegments.length, 3);
    assert.equal(store.clips.length, 1);

    const student = store.users.find((user) => user.email === 'student@focusflow.local');
    const publishedCourse = store.courses.find((course) => course.title === 'FocusFlow Demo QA Course');
    const bridgeCourse = store.courses.find((course) => course.title === 'FocusFlow Pipeline Bridge Course');
    const draftVideo = store.videos.find((video) => video.videoId === 'focusflow-demo-video-processing');
    const bridgeVideo = store.videos.find((video) => video.videoId === DEMO_VIDEOS.pipelineBridge.videoId);

    assert.ok(student);
    assert.ok(publishedCourse);
    assert.ok(bridgeCourse);
    assert.ok(bridgeVideo);
    assert.equal(String(student.activeCourseId), String(publishedCourse._id));
    assert.equal(student.lineUserId, 'demo-line-student-001');
    assert.equal(student.lineConversationState, 'idle');
    assert.equal(draftVideo.processing.status, 'failed');
    assert.equal(bridgeCourse.videoIds.length, 1);
    assert.equal(String(bridgeCourse.videoIds[0]), String(bridgeVideo._id));
    assert.equal(store.videoSegments.some((segment) => segment.videoId === DEMO_VIDEOS.pipelineBridge.videoId), false);

    assert.deepEqual(firstRun.courses, secondRun.courses);
    assert.deepEqual(firstRun.videos, secondRun.videos);
  });

  it('keeps non-demo pipeline data untouched while rebuilding the pipeline-style demo bridge baseline', async () => {
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

    const result = await seedDemoData({ silent: true, reset: true });

    const bridgeCourse = store.courses.find((course) => course.title === 'FocusFlow Pipeline Bridge Course');
    const nonDemoPipelineVideo = store.videos.find((video) => video._id === 'pipeline-video-001');

    assert.ok(bridgeCourse);
    assert.ok(nonDemoPipelineVideo);
    assert.equal(bridgeCourse.videoIds.length, 1);
    assert.notDeepEqual(bridgeCourse.videoIds, ['pipeline-video-001']);
    assert.equal(store.videos.filter((video) => video.video_id === 'video_001').length, 1);
    assert.deepEqual(result.pipelineBridge?.externalVideoIds, [DEMO_VIDEOS.pipelineBridge.videoId]);
  });

  it('reset clears demo-derived mutable state before rebuilding the baseline', async () => {
    await seedDemoData({ silent: true });

    const student = store.users.find((user) => user.email === 'student@focusflow.local');
    const publishedCourse = store.courses.find((course) => course.title === 'FocusFlow Demo QA Course');

    store.lineBindTokens.push({
      _id: 'bind-token-demo-reset',
      token: 'bind-token-demo-reset',
      userId: student._id,
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    store.usageLogs.push({
      _id: 'usage-log-demo-reset',
      userId: student._id,
      courseId: publishedCourse._id,
      event: 'ask',
      metadata: { source: 'demo-reset-test' },
    });
    student.activeCourseId = 'foreign-course-id';
    student.lineUserId = 'line-user-mutated';
    student.lineConversationState = 'selecting_course';

    const result = await seedDemoData({ silent: true, reset: true });
    const resetStudent = store.users.find((user) => user.email === 'student@focusflow.local');

    assert.equal(result.resetApplied, true);
    assert.equal(store.lineBindTokens.length, 0);
    assert.equal(store.usageLogs.length, 0);
    assert.equal(String(resetStudent.activeCourseId), String(publishedCourse._id));
    assert.equal(resetStudent.lineUserId, 'demo-line-student-001');
    assert.equal(resetStudent.lineConversationState, 'idle');
  });
});
