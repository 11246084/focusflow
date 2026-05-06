const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');
const { getTeacherDashboardStats, getStudentDashboardStats } = require('../src/services/teacherStats.service');
const {
  ids,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

describe('teacherStats.service - getStudentDashboardStats', () => {
  beforeEach(() => {
    resetStore();
  });

  it('counts the calling student\'s questions by userId across api and line sources', async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const studentObjectId = new mongoose.Types.ObjectId(ids.student);
    const otherUserObjectId = new mongoose.Types.ObjectId();

    store.questions.push(
      {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: studentObjectId,
        courseId: ids.publishedCourse,
        question: 'What is JWT?',
        answer: 'JWT is JSON Web Token.',
        status: 'answered',
        source: 'api',
        matchCount: 1,
        askedAt: dayAgo,
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: studentObjectId,
        courseId: ids.publishedCourse,
        question: 'How do I bind LINE?',
        answer: '',
        status: 'unanswered',
        source: 'line',
        matchCount: 0,
        askedAt: dayAgo,
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: studentObjectId,
        courseId: ids.publishedCourse,
        question: 'Older question outside the weekly window?',
        answer: 'Sure.',
        status: 'answered',
        source: 'api',
        matchCount: 1,
        askedAt: tenDaysAgo,
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: otherUserObjectId,
        courseId: ids.publishedCourse,
        question: 'Different student should not be counted.',
        answer: 'Hidden.',
        status: 'answered',
        source: 'api',
        matchCount: 1,
        askedAt: dayAgo,
      },
    );

    const stats = await getStudentDashboardStats({ id: ids.student });

    assert.equal(stats.totalQueries, 3);
    assert.equal(stats.weeklyQueries, 2);
    // 2 answered out of 3 total → 67%
    assert.equal(stats.answerRate, 67);
    assert.equal(stats.recentQueries.length, 3);
    assert.ok(
      stats.recentQueries.every((entry) => ['api', 'line'].includes(entry.source)),
      'recent queries should be filtered to api/line sources only',
    );
    assert.equal(
      stats.recentQueries.some((entry) => entry.question === 'Different student should not be counted.'),
      false,
    );
  });
});

describe('teacherStats.service - getTeacherDashboardStats', () => {
  beforeEach(() => {
    resetStore();
  });

  it('uses the current course video title when a top segment points to a deleted video', async () => {
    const deletedVideoId = new mongoose.Types.ObjectId().toString();
    const currentVideoId = new mongoose.Types.ObjectId().toString();
    const topSegmentId = `${deletedVideoId}_chunk_0005`;

    store.videos.push({
      _id: currentVideoId,
      courseId: ids.teacherCourse,
      title: 'video 001 part 0006',
      sourceType: 'youtube',
      sourceUrl: null,
      youtubeVideoId: '525ItlVdo6E',
      videoUrl: 'https://youtu.be/525ItlVdo6E',
      uploadedBy: ids.teacher,
      processing: {
        status: 'completed',
        queuedAt: '2026-05-05T13:25:05.000Z',
        startedAt: '2026-05-05T13:25:20.000Z',
        completedAt: '2026-05-05T13:27:00.000Z',
        attemptCount: 1,
      },
      createdAt: '2026-05-05T13:25:05.000Z',
      updatedAt: '2026-05-05T13:27:00.000Z',
    });

    store.videoSegments.push({
      _id: new mongoose.Types.ObjectId().toString(),
      segmentId: topSegmentId,
      chunkId: topSegmentId,
      courseId: ids.teacherCourse,
      videoId: deletedVideoId,
      startSec: 56.96,
      endSec: 73.18,
      text: 'Deleted video segment should not leak its object id in teacher stats.',
      embedding: [],
    });

    store.usageLogs.push(
      {
        _id: new mongoose.Types.ObjectId().toString(),
        event: 'ask',
        courseId: ids.teacherCourse,
        metadata: { topSegmentId },
        createdAt: '2026-05-06T10:00:00.000Z',
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        event: 'ask',
        courseId: ids.teacherCourse,
        metadata: { topSegmentId },
        createdAt: '2026-05-06T10:05:00.000Z',
      },
    );

    const stats = await getTeacherDashboardStats({ id: ids.teacher });
    const segment = stats.topSegments.find((item) => item.segmentId === topSegmentId);

    assert.ok(segment);
    assert.equal(segment.videoTitle, 'video 001 part 0006');
    assert.equal(segment.videoId, currentVideoId);
    assert.equal(segment.count, 2);
  });
});
