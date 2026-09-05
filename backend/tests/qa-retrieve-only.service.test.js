const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { retrieveSegmentsOnly } = require('../src/services/qa.service');
const env = require('../src/config/env');
const {
  ids,
  newObjectId,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };

function resetQaEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.geminiApiKey = '';
  env.openaiApiKey = '';
  env.qaActiveLeafEmbeddingContractJson = '';
  env.qaActiveParentEmbeddingContractJson = '';
}

function addSegment({ courseId = ids.teacherCourse, videoId = ids.teacherVideo, segmentId, text, startSec = 0 }) {
  store.videoSegments.push({
    _id: newObjectId(),
    segmentId,
    chunkId: segmentId,
    courseId,
    videoId,
    startSec,
    endSec: startSec + 12,
    text,
    embedding: [],
  });
}

describe('qa.service retrieveSegmentsOnly', () => {
  beforeEach(() => {
    resetStore();
    resetQaEnv();
  });

  it('回傳片段但完全不寫入 faqs / questions / usagelogs', async () => {
    addSegment({ segmentId: 'seg-a', text: 'OpenCV 可以使用 CPU 來運算。', startSec: 12 });

    const faqsBefore = store.faqs.length;
    const questionsBefore = store.questions.length;
    const usageBefore = store.usageLogs.length;

    const result = await retrieveSegmentsOnly({
      user: TEACHER,
      courseId: ids.teacherCourse,
      question: 'OpenCV 跟 YOLO 的差異是什麼?',
    });

    assert.ok(result.matches.length > 0);
    assert.equal(store.faqs.length, faqsBefore);
    assert.equal(store.questions.length, questionsBefore);
    assert.equal(store.usageLogs.length, usageBefore);
  });

  it('不會回傳其他課程的片段（fail-closed 跨課程隔離）', async () => {
    addSegment({ segmentId: 'seg-mine', text: 'OpenCV 可以使用 CPU 來運算。' });
    addSegment({
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideo,
      segmentId: 'seg-other',
      text: 'OpenCV 可以使用 CPU 來運算。',
    });

    const result = await retrieveSegmentsOnly({
      user: TEACHER,
      courseId: ids.teacherCourse,
      question: 'OpenCV 運算',
    });

    assert.ok(result.matches.length > 0);
    assert.equal(result.matches.every((match) => match.segmentId !== 'seg-other'), true);
  });

  it('課程沒有可搜尋片段時回空陣列，不丟錯', async () => {
    const result = await retrieveSegmentsOnly({
      user: TEACHER,
      courseId: ids.teacherCourse,
      question: 'OpenCV 跟 YOLO 的差異是什麼?',
    });

    assert.deepEqual(result.matches, []);
  });

  it('問句為空時回 VALIDATION_ERROR', async () => {
    await assert.rejects(
      () => retrieveSegmentsOnly({ user: TEACHER, courseId: ids.teacherCourse, question: '   ' }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });

  it('courseId 格式錯誤時回 INVALID_ID', async () => {
    await assert.rejects(
      () => retrieveSegmentsOnly({ user: TEACHER, courseId: 'not-an-object-id', question: 'x' }),
      (error) => error.code === 'INVALID_ID',
    );
  });

  it('無課程存取權時被拒絕', async () => {
    addSegment({ segmentId: 'seg-a', text: 'OpenCV 可以使用 CPU 來運算。' });

    await assert.rejects(
      () => retrieveSegmentsOnly({
        user: { id: ids.otherTeacher, role: 'teacher' },
        courseId: ids.teacherCourse,
        question: 'OpenCV 運算',
      }),
      (error) => error.code === 'COURSE_ACCESS_DENIED',
    );
  });

  it('回傳的 match 帶有腳本證據需要的欄位', async () => {
    addSegment({ segmentId: 'seg-a', text: 'OpenCV 可以使用 CPU 來運算。', startSec: 12 });

    const { matches } = await retrieveSegmentsOnly({
      user: TEACHER,
      courseId: ids.teacherCourse,
      question: 'OpenCV 運算',
    });

    const match = matches[0];
    assert.equal(typeof match.segmentId, 'string');
    assert.equal(typeof match.startSec, 'number');
    assert.equal(typeof match.endSec, 'number');
    assert.equal(typeof match.transcript, 'string');
    assert.ok('videoId' in match);
  });
});
