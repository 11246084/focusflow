const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');
const { getStudentDashboardStats } = require('../src/services/teacherStats.service');
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
