const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const topicService = require('../src/services/shortScriptTopic.service');
const { ids, store, newObjectId, resetStore } = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };
const OTHER_TEACHER = { id: ids.otherTeacher, role: 'teacher' };

// 用固定的低維向量模擬 questionEmbedding。同一 base 代表語意相同，
// 不需要真的呼叫 embedding provider。
const VECTORS = {
  yolo: [1, 0, 0],
  yoloNear: [0.99, 0.14, 0],
  llm: [0, 1, 0],
};

function addFaq({
  courseId = ids.teacherCourse,
  question,
  normalizedQuestion,
  hitCount = 0,
  questionEmbedding = [],
  lastHitAt = null,
} = {}) {
  const faq = {
    _id: newObjectId(),
    courseId,
    question,
    normalizedQuestion: normalizedQuestion || question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''),
    answer: 'answer',
    matches: [],
    clip: null,
    questionEmbedding,
    hitCount,
    lastHitAt,
    lastAnsweredAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  store.faqs.push(faq);
  return faq;
}

describe('shortScriptTopic.service 自動選題', () => {
  beforeEach(() => resetStore());

  it('同義題合併成單一候選，熱度加總且保留原始問句', async () => {
    addFaq({ question: 'open cv 跟 yolo 的關係是甚麼?', hitCount: 8, questionEmbedding: VECTORS.yolo });
    addFaq({ question: 'YOLO跟opencv的具體差異是什麼？', hitCount: 4, questionEmbedding: VECTORS.yoloNear });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].totalHitCount, 12);
    assert.deepEqual(
      candidates[0].variants.map((variant) => variant.question).sort(),
      ['YOLO跟opencv的具體差異是什麼？', 'open cv 跟 yolo 的關係是甚麼?'],
    );
  });

  it('語意不同的題目不會被合併', async () => {
    addFaq({ question: 'opencv 跟 yolo 差在哪?', hitCount: 8, questionEmbedding: VECTORS.yolo });
    addFaq({ question: '什麼是大語言模型?', hitCount: 3, questionEmbedding: VECTORS.llm });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].totalHitCount, 8);
    assert.equal(candidates[1].totalHitCount, 3);
  });

  it('熱度低於門檻的題目不列入候選', async () => {
    addFaq({ question: '只被問過一次的題目', hitCount: 1, questionEmbedding: VECTORS.llm });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(candidates, []);
  });

  it('excludedTopicKeys 內的主題會被排除', async () => {
    addFaq({ question: 'opencv 跟 yolo 差在哪?', hitCount: 8, questionEmbedding: VECTORS.yolo });
    addFaq({ question: '什麼是大語言模型?', hitCount: 3, questionEmbedding: VECTORS.llm });

    const before = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });
    const excludedKey = before.candidates[0].topicKey;

    const after = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
      excludedTopicKeys: [excludedKey],
    });

    assert.equal(after.candidates.length, 1);
    assert.notEqual(after.candidates[0].topicKey, excludedKey);
  });

  it('不會撈到其他課程的 FAQ', async () => {
    addFaq({
      courseId: ids.publishedCourse,
      question: '別的課程的熱門題',
      hitCount: 99,
      questionEmbedding: VECTORS.llm,
    });
    addFaq({ question: 'opencv 跟 yolo 差在哪?', hitCount: 3, questionEmbedding: VECTORS.yolo });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].question, 'opencv 跟 yolo 差在哪?');
  });

  it('非課程 owner 的教師不得取得候選', async () => {
    addFaq({ question: 'opencv 跟 yolo 差在哪?', hitCount: 8, questionEmbedding: VECTORS.yolo });

    await assert.rejects(
      () => topicService.listTopicCandidates({ user: OTHER_TEACHER, courseId: ids.teacherCourse }),
      (error) => error.code === 'COURSE_MANAGE_DENIED',
    );
  });

  it('課程沒有 FAQ 時回傳空候選，不丟錯', async () => {
    const result = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(result.candidates, []);
    assert.equal(result.totalClusters, 0);
  });

  it('同樣資料重跑兩次結果完全相同（規格書 R-04 確定性要求）', async () => {
    addFaq({ question: 'A 題', hitCount: 5, questionEmbedding: VECTORS.yolo });
    addFaq({ question: 'B 題', hitCount: 5, questionEmbedding: VECTORS.llm });
    addFaq({ question: 'C 題', hitCount: 5, questionEmbedding: [0, 0, 1] });

    const first = await topicService.listTopicCandidates({ user: TEACHER, courseId: ids.teacherCourse });
    const second = await topicService.listTopicCandidates({ user: TEACHER, courseId: ids.teacherCourse });

    assert.deepEqual(
      first.candidates.map((item) => item.topicKey),
      second.candidates.map((item) => item.topicKey),
    );
  });

  it('沒有 embedding 的 FAQ 自成一群，不與其他題合併', async () => {
    addFaq({ question: 'opencv 跟 yolo 差在哪?', hitCount: 8, questionEmbedding: VECTORS.yolo });
    addFaq({ question: '沒有向量的題目', hitCount: 3, questionEmbedding: [] });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 2);
  });

  it('limit 限制回傳筆數', async () => {
    addFaq({ question: 'A 題', hitCount: 9, questionEmbedding: VECTORS.yolo });
    addFaq({ question: 'B 題', hitCount: 8, questionEmbedding: VECTORS.llm });
    addFaq({ question: 'C 題', hitCount: 7, questionEmbedding: [0, 0, 1] });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
      limit: 2,
    });

    assert.equal(candidates.length, 2);
  });
});
