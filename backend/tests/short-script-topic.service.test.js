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

// 熱度＝該問句在 questions 出現的筆數（規格書 DR-14），因此 askCount 筆就 push 幾筆。
function addQuestion({
  courseId = ids.teacherCourse,
  question,
  askCount = 1,
  questionEmbedding = [],
  answer = 'answer',
  status = 'answered',
  runtime = {},
  askedAt = '2026-08-01T00:00:00.000Z',
} = {}) {
  for (let index = 0; index < askCount; index += 1) {
    store.questions.push({
      _id: newObjectId(),
      userId: ids.student,
      courseId,
      question,
      answer,
      status,
      source: 'api',
      matchCount: 1,
      matches: [],
      runtime,
      questionEmbedding,
      askedAt,
      createdAt: askedAt,
    });
  }
}

describe('shortScriptTopic.service 自動選題', () => {
  beforeEach(() => resetStore());

  it('同義題合併成單一候選，熱度加總且保留原始問句', async () => {
    addQuestion({ question: 'open cv 跟 yolo 的關係是甚麼?', askCount: 8, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: 'YOLO跟opencv的具體差異是什麼？', askCount: 4, questionEmbedding: VECTORS.yoloNear });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].totalAskCount, 12);
    assert.deepEqual(
      candidates[0].variants.map((variant) => variant.question).sort(),
      ['YOLO跟opencv的具體差異是什麼？', 'open cv 跟 yolo 的關係是甚麼?'],
    );
  });

  it('語意不同的題目不會被合併', async () => {
    addQuestion({ question: 'opencv 跟 yolo 差在哪?', askCount: 8, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: '什麼是大語言模型?', askCount: 3, questionEmbedding: VECTORS.llm });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].totalAskCount, 8);
    assert.equal(candidates[1].totalAskCount, 3);
  });

  it('熱度低於門檻的題目不列入候選', async () => {
    addQuestion({ question: '只被問過一次的題目', askCount: 1, questionEmbedding: VECTORS.llm });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(candidates, []);
  });

  it('excludedTopicKeys 內的主題會被排除', async () => {
    addQuestion({ question: 'opencv 跟 yolo 差在哪?', askCount: 8, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: '什麼是大語言模型?', askCount: 3, questionEmbedding: VECTORS.llm });

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

  it('不會撈到其他課程的提問', async () => {
    addQuestion({
      courseId: ids.publishedCourse,
      question: '別的課程的熱門題',
      askCount: 99,
      questionEmbedding: VECTORS.llm,
    });
    addQuestion({ question: 'opencv 跟 yolo 差在哪?', askCount: 3, questionEmbedding: VECTORS.yolo });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].question, 'opencv 跟 yolo 差在哪?');
  });

  it('非課程 owner 的教師不得取得候選', async () => {
    addQuestion({ question: 'opencv 跟 yolo 差在哪?', askCount: 8, questionEmbedding: VECTORS.yolo });

    await assert.rejects(
      () => topicService.listTopicCandidates({ user: OTHER_TEACHER, courseId: ids.teacherCourse }),
      (error) => error.code === 'COURSE_MANAGE_DENIED',
    );
  });

  it('課程沒有提問時回傳空候選，不丟錯', async () => {
    const result = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(result.candidates, []);
    assert.equal(result.totalClusters, 0);
  });

  it('同樣資料重跑兩次結果完全相同（規格書 R-04 確定性要求）', async () => {
    addQuestion({ question: 'A 題', askCount: 5, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: 'B 題', askCount: 5, questionEmbedding: VECTORS.llm });
    addQuestion({ question: 'C 題', askCount: 5, questionEmbedding: [0, 0, 1] });

    const first = await topicService.listTopicCandidates({ user: TEACHER, courseId: ids.teacherCourse });
    const second = await topicService.listTopicCandidates({ user: TEACHER, courseId: ids.teacherCourse });

    assert.deepEqual(
      first.candidates.map((item) => item.topicKey),
      second.candidates.map((item) => item.topicKey),
    );
  });

  it('沒有 embedding 的提問自成一群，不與其他題合併', async () => {
    addQuestion({ question: 'opencv 跟 yolo 差在哪?', askCount: 8, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: '沒有向量的題目', askCount: 3, questionEmbedding: [] });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(candidates.length, 2);
  });

  it('「答不出來」的題不列入候選（改用 questions 後要自己擋）', async () => {
    addQuestion({
      question: '課程沒教的題目',
      askCount: 9,
      questionEmbedding: VECTORS.llm,
      answer: '目前資料庫片段不足以回答這個問題。',
    });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(candidates, []);
  });

  it('runtime 降級時的回答不列入候選', async () => {
    addQuestion({
      question: '降級時問的題目',
      askCount: 9,
      questionEmbedding: VECTORS.llm,
      runtime: { degraded: true },
    });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(candidates, []);
  });

  it('沒撈到片段（no_match）的題不列入候選', async () => {
    addQuestion({
      question: '沒有片段的題目',
      askCount: 9,
      questionEmbedding: VECTORS.llm,
      status: 'no_match',
    });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.deepEqual(candidates, []);
  });

  it('limit 限制回傳筆數', async () => {
    addQuestion({ question: 'A 題', askCount: 9, questionEmbedding: VECTORS.yolo });
    addQuestion({ question: 'B 題', askCount: 8, questionEmbedding: VECTORS.llm });
    addQuestion({ question: 'C 題', askCount: 7, questionEmbedding: [0, 0, 1] });

    const { candidates } = await topicService.listTopicCandidates({
      user: TEACHER,
      courseId: ids.teacherCourse,
      limit: 2,
    });

    assert.equal(candidates.length, 2);
  });
});
