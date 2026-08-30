const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startServer,
  stopServer,
  loginAs,
  jsonRequest,
  resetStore,
  store,
  ids,
  newObjectId,
} = require('./helpers/backendTestHarness');
const { buildMockEmbedding } = require('../src/services/queryEmbedding.service');
const logger = require('../src/utils/logger');

const QUESTION_TEXT = 'What does the course say about JWT authentication?';

// 讓 fixture segments 具備與 mock query embedding 同維度的向量，
// QA 走純 vector scoring → runtime ready → 回答才會寫入 FAQ 快取。
function makeSegmentsVectorReady() {
  for (const segment of store.videoSegments) {
    segment.embedding = buildMockEmbedding(segment.text);
  }
}

async function askQuestionAs(baseUrl, token, question) {
  return jsonRequest(baseUrl, '/api/v1/qa/ask', {
    method: 'POST',
    token,
    body: { courseId: ids.publishedCourse, question },
  });
}

function seedFaq({
  courseId = ids.publishedCourse,
  question,
  answer,
  hitCount = 0,
  matches = null,
  questionEmbedding = [],
} = {}) {
  const faq = {
    _id: newObjectId(),
    courseId,
    question,
    normalizedQuestion: question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''),
    answer,
    matches: matches || [
      {
        segmentId: ids.segmentOne,
        videoId: ids.publishedVideo,
        videoTitle: 'Published Video',
        startSec: 12,
        endSec: 32,
        jumpUrl: null,
      },
    ],
    clip: null,
    questionEmbedding,
    hitCount,
    lastHitAt: null,
    updatedAt: new Date().toISOString(),
  };
  store.faqs.push(faq);
  return faq;
}

describe('FAQ 快取與常見問題路由', () => {
  let server;
  let baseUrl;

  before(async () => { ({ server, baseUrl } = await startServer()); });
  after(async () => stopServer(server));
  beforeEach(() => resetStore());

  it('第一次提問建立 FAQ，重複提問直接命中快取', async () => {
    makeSegmentsVectorReady();
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');

    const first = await askQuestionAs(baseUrl, token, QUESTION_TEXT);

    assert.equal(first.status, 200);
    assert.equal(first.body.data.runtime.status, 'ready');
    assert.equal(first.body.data.runtime.faqCache.hit, false);
    assert.equal(store.faqs.length, 1);

    const second = await askQuestionAs(baseUrl, token, QUESTION_TEXT);

    assert.equal(second.status, 200);
    assert.equal(second.body.data.runtime.faqCache.hit, true);
    assert.equal(second.body.data.runtime.faqCache.matchType, 'exact');
    assert.equal(second.body.data.runtime.answerProviderUsed, 'faq_cache');
    assert.equal(second.body.data.answer, first.body.data.answer);
    assert.ok(second.body.data.matches.length > 0);
    assert.equal(store.faqs[0].hitCount, 1);
    // 命中快取仍要寫入 questions 歷史，統計行為不變
    assert.equal(store.questions.length, 2);
  });

  it('標點與空白不同的同一問題仍命中快取', async () => {
    makeSegmentsVectorReady();
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');

    await askQuestionAs(baseUrl, token, QUESTION_TEXT);
    const variant = await askQuestionAs(
      baseUrl,
      token,
      '  what   does the course say about JWT authentication ',
    );

    assert.equal(variant.status, 200);
    assert.equal(variant.body.data.runtime.faqCache.hit, true);
    assert.equal(variant.body.data.runtime.faqCache.matchType, 'exact');
    assert.equal(store.faqs.length, 1);
  });

  it('FAQ 任一引用超出課程範圍時整筆作廢並繼續正式檢索', async () => {
    makeSegmentsVectorReady();
    const staleAnswer = '這是不得回傳的舊快取答案。';
    const faq = seedFaq({
      question: QUESTION_TEXT,
      answer: staleAnswer,
      matches: [
        { segmentId: ids.segmentOne, videoId: ids.publishedVideo },
        { segmentId: 'foreign-segment', videoId: ids.teacherVideo },
      ],
    });
    const events = [];
    const originalWarn = logger.warn;
    logger.warn = (event, metadata) => events.push({ event, metadata });

    try {
      const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
      const result = await askQuestionAs(baseUrl, token, QUESTION_TEXT);

      assert.equal(result.status, 200);
      assert.notEqual(result.body.data.answer, staleAnswer);
      assert.equal(result.body.data.runtime.faqCache.hit, false);
      assert.equal(
        result.body.data.runtime.faqCache.revalidationFailure.errorCode,
        'QA_FAQ_SCOPE_REVALIDATION_FAILED',
      );
      assert.equal(faq.hitCount, 0);
      assert.deepEqual(events, [{
        event: 'qa.faq_scope_revalidation_failed',
        metadata: {
          courseId: ids.publishedCourse,
          faqId: faq._id,
          droppedVideoIds: [ids.teacherVideo],
          droppedCount: 1,
        },
      }]);
    } finally {
      logger.warn = originalWarn;
    }
  });

  it('語意 FAQ 引用失效時也整筆作廢', async () => {
    makeSegmentsVectorReady();
    const staleAnswer = '這是不得回傳的語意快取答案。';
    seedFaq({
      question: '另一個不會 exact 命中的問題',
      answer: staleAnswer,
      matches: [{ segmentId: 'missing-segment', videoId: ids.publishedVideo }],
      questionEmbedding: buildMockEmbedding(QUESTION_TEXT),
    });
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await askQuestionAs(baseUrl, token, QUESTION_TEXT);

    assert.equal(result.status, 200);
    assert.notEqual(result.body.data.answer, staleAnswer);
    assert.equal(result.body.data.runtime.faqCache.hit, false);
    assert.equal(
      result.body.data.runtime.faqCache.revalidationFailure.errorCode,
      'QA_FAQ_SCOPE_REVALIDATION_FAILED',
    );
  });

  it('degraded 回答不寫入 FAQ 快取', async () => {
    // fixtures 預設 embedding: [] → SEGMENT_EMBEDDING_MISSING → degraded
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await askQuestionAs(baseUrl, token, QUESTION_TEXT);

    assert.equal(result.status, 200);
    assert.equal(result.body.data.runtime.degraded, true);
    assert.equal(store.faqs.length, 0);
  });

  it('GET /courses/:courseId/faqs 依命中次數排序回傳，且不洩漏 embedding', async () => {
    seedFaq({ question: '冷門問題', answer: '冷門答案', hitCount: 1 });
    seedFaq({ question: '熱門問題', answer: '熱門答案', hitCount: 8 });
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(baseUrl, `/api/v1/courses/${ids.publishedCourse}/faqs`, { token });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.length, 2);
    assert.equal(result.body.data[0].question, '熱門問題');
    assert.equal(result.body.data[0].hitCount, 8);
    assert.equal(result.body.data[0].questionEmbedding, undefined);
    assert.ok(Array.isArray(result.body.data[0].matches));
  });

  it('未登入時無法取得常見問題清單', async () => {
    const result = await jsonRequest(baseUrl, `/api/v1/courses/${ids.publishedCourse}/faqs`);

    assert.equal(result.status, 401);
    assert.equal(result.body.success, false);
  });

  it('教師可清空課程 FAQ 快取，學生沒有權限', async () => {
    seedFaq({ question: '問題', answer: '答案' });

    const studentToken = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
    const denied = await jsonRequest(baseUrl, `/api/v1/courses/${ids.publishedCourse}/faqs`, {
      method: 'DELETE',
      token: studentToken,
    });

    assert.equal(denied.status, 403);
    assert.equal(store.faqs.length, 1);

    const teacherToken = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const cleared = await jsonRequest(baseUrl, `/api/v1/courses/${ids.publishedCourse}/faqs`, {
      method: 'DELETE',
      token: teacherToken,
    });

    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.deletedCount, 1);
    assert.equal(store.faqs.length, 0);
  });

  it('刪除課程影片後，該課程 FAQ 快取被清除', async () => {
    seedFaq({ question: '問題', answer: '答案' });
    const teacherToken = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(baseUrl, `/api/v1/videos/${ids.publishedVideo}`, {
      method: 'DELETE',
      token: teacherToken,
    });

    assert.equal(result.status, 200);
    assert.equal(store.faqs.length, 0);
  });
});
