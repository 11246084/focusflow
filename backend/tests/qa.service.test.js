const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { askQuestion } = require('../src/services/qa.service');
const {
  ids,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

describe('qa service', () => {
  beforeEach(() => {
    resetStore();
  });

  it('uses in-memory ranking to return the best segment first', async () => {
    store.videoSegments.push({
      _id: 'segment-three-id',
      segmentId: 'segment-three',
      courseId: ids.publishedCourse,
      videoId: 'video-published-001',
      startSec: 60,
      endSec: 85,
      transcript: 'This segment mentions JWT once.',
      embedding: [],
    });

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'Tell me about JWT authentication and role based access control.',
      source: 'service-test',
    });

    assert.equal(result.matches[0].segmentId, ids.segmentOne);
    assert.equal(result.matches.length, 3);
  });

  it('returns null clip data when no cached clip exists and skips clip_view logging', async () => {
    store.clips.length = 0;

    const result = await askQuestion({
      user: {
        id: ids.student,
        role: 'student',
      },
      courseId: ids.publishedCourse,
      question: 'What does the course say about JWT authentication?',
      source: 'service-test',
    });

    assert.equal(result.clip, null);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'ask'), true);
    assert.equal(store.usageLogs.some((entry) => entry.event === 'clip_view'), false);
  });
});
