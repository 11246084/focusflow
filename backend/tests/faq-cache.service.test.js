const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { store, resetStore, ids, newObjectId } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const {
  normalizeFaqQuestion,
  findFaqByExactQuestion,
  findFaqBySimilarEmbedding,
  saveFaqEntry,
  clearFaqsForVideoCourses,
} = require('../src/services/faqCache.service');

describe('faqCache service', () => {
  beforeEach(() => {
    resetStore();
  });

  it('正規化問題時忽略大小寫、空白與標點符號', () => {
    assert.equal(normalizeFaqQuestion('什麼是 JWT？'), '什麼是jwt');
    assert.equal(normalizeFaqQuestion('  What is  JWT?! '), 'whatisjwt');
    assert.equal(normalizeFaqQuestion('什麼是JWT'), '什麼是jwt');
    assert.equal(normalizeFaqQuestion('！？。，'), '');
    assert.equal(normalizeFaqQuestion(null), '');
  });

  it('儲存後可用不同標點與空白的同一問題精確命中', async () => {
    await saveFaqEntry({
      courseId: ids.publishedCourse,
      question: '什麼是 JWT？',
      answer: 'JWT 是一種 token 格式。',
      matches: [{ segmentId: ids.segmentOne, videoId: ids.publishedVideoExternal, startSec: 12, endSec: 32 }],
      clip: null,
      questionEmbedding: [1, 0, 0],
    });

    assert.equal(store.faqs.length, 1);

    const hit = await findFaqByExactQuestion({
      courseId: ids.publishedCourse,
      question: '  什麼是JWT ',
    });

    assert.ok(hit);
    assert.equal(hit.answer, 'JWT 是一種 token 格式。');

    const missOtherCourse = await findFaqByExactQuestion({
      courseId: ids.teacherCourse,
      question: '什麼是 JWT？',
    });

    assert.equal(missOtherCourse, null);
  });

  it('同一正規化問題重複儲存時更新既有條目而不是新增', async () => {
    await saveFaqEntry({
      courseId: ids.publishedCourse,
      question: '什麼是 JWT？',
      answer: '第一版答案',
      matches: [],
      clip: null,
      questionEmbedding: [],
    });
    await saveFaqEntry({
      courseId: ids.publishedCourse,
      question: '什麼是JWT',
      answer: '第二版答案',
      matches: [],
      clip: null,
      questionEmbedding: [],
    });

    assert.equal(store.faqs.length, 1);
    assert.equal(store.faqs[0].answer, '第二版答案');
  });

  it('語意相似度超過門檻才命中，並回傳最相似的條目', async () => {
    store.faqs.push(
      {
        _id: newObjectId(),
        courseId: ids.publishedCourse,
        question: 'JWT 是什麼？',
        normalizedQuestion: 'jwt是什麼',
        answer: 'JWT 答案',
        matches: [],
        questionEmbedding: [1, 0, 0],
        hitCount: 3,
      },
      {
        _id: newObjectId(),
        courseId: ids.publishedCourse,
        question: 'middleware 是什麼？',
        normalizedQuestion: 'middleware是什麼',
        answer: 'middleware 答案',
        matches: [],
        questionEmbedding: [0, 1, 0],
        hitCount: 1,
      },
    );

    const nearHit = await findFaqBySimilarEmbedding({
      courseId: ids.publishedCourse,
      queryVector: [0.998, 0.06, 0],
    });

    assert.ok(nearHit);
    assert.equal(nearHit.faq.answer, 'JWT 答案');
    assert.ok(nearHit.similarity >= env.faqCacheSimilarityThreshold);

    const miss = await findFaqBySimilarEmbedding({
      courseId: ids.publishedCourse,
      queryVector: [0.7, 0.7, 0.14],
    });

    assert.equal(miss, null);
  });

  it('超過課程上限時淘汰命中次數最低的條目', async () => {
    const originalLimit = env.faqCacheMaxEntriesPerCourse;
    env.faqCacheMaxEntriesPerCourse = 2;

    try {
      store.faqs.push(
        {
          _id: newObjectId(),
          courseId: ids.publishedCourse,
          question: '熱門問題',
          normalizedQuestion: '熱門問題',
          answer: '答案',
          questionEmbedding: [],
          hitCount: 9,
        },
        {
          _id: newObjectId(),
          courseId: ids.publishedCourse,
          question: '冷門問題',
          normalizedQuestion: '冷門問題',
          answer: '答案',
          questionEmbedding: [],
          hitCount: 0,
        },
      );

      await saveFaqEntry({
        courseId: ids.publishedCourse,
        question: '新問題',
        answer: '新答案',
        matches: [],
        clip: null,
        questionEmbedding: [],
      });

      assert.equal(store.faqs.length, 2);
      assert.ok(store.faqs.some((faq) => faq.normalizedQuestion === '熱門問題'));
      assert.equal(store.faqs.some((faq) => faq.normalizedQuestion === '冷門問題'), false);
    } finally {
      env.faqCacheMaxEntriesPerCourse = originalLimit;
    }
  });

  it('影片所屬課程的 FAQ 會在內容變動時被清除，其他課程不受影響', async () => {
    store.faqs.push(
      {
        _id: newObjectId(),
        courseId: ids.publishedCourse,
        question: 'Q1',
        normalizedQuestion: 'q1',
        answer: 'A1',
        questionEmbedding: [],
        hitCount: 0,
      },
      {
        _id: newObjectId(),
        courseId: ids.teacherCourse,
        question: 'Q2',
        normalizedQuestion: 'q2',
        answer: 'A2',
        questionEmbedding: [],
        hitCount: 0,
      },
    );

    const publishedVideo = store.videos.find((video) => video._id === ids.publishedVideo);
    await clearFaqsForVideoCourses(publishedVideo);

    assert.equal(store.faqs.length, 1);
    assert.equal(String(store.faqs[0].courseId), ids.teacherCourse);
  });
});
