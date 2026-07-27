const Faq = require('../models/faq.model');
const Course = require('../models/course.model');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const {
  getCourseByIdOrThrow,
  assertCanAccessCourse,
  assertCanManageCourse,
} = require('./courseAccess.service');

// FAQ 快取是效能最佳化，不是正確性依賴：任何讀寫失敗都不能中斷 QA 主流程，
// 所以本檔案的 cache 讀寫一律吞錯（測試環境除外不印 log）。

function logCacheError(message, error) {
  if (process.env.NODE_ENV !== 'test') {
    console.error(message, error);
  }
}

function isFaqCacheEnabled() {
  return env.faqCacheEnabled;
}

// 移除所有非文字/數字字元後轉小寫，讓「什麼是 JWT？」與「什麼是JWT」視為同一題
function normalizeFaqQuestion(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function computeCosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return null;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) {
    return null;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function isSemanticMatchEnabled() {
  const threshold = env.faqCacheSimilarityThreshold;
  return Number.isFinite(threshold) && threshold > 0 && threshold <= 1;
}

// 第一層快取：正規化文字完全相同 → 連 query embedding 都不用算
async function findFaqByExactQuestion({ courseId, question }) {
  try {
    const normalizedQuestion = normalizeFaqQuestion(question);

    if (!normalizedQuestion) {
      return null;
    }

    return await Faq.findOne({ courseId, normalizedQuestion });
  } catch (error) {
    logCacheError('FAQ cache exact lookup failed.', error);
    return null;
  }
}

// 第二層快取：query embedding 與課程 FAQ embedding 的 cosine 相似度超過門檻
// → 跳過向量搜尋與 LLM 生成（embedding 已經算了，會在 miss 時直接沿用）
async function findFaqBySimilarEmbedding({ courseId, queryVector }) {
  if (!isSemanticMatchEnabled() || !Array.isArray(queryVector) || !queryVector.length) {
    return null;
  }

  try {
    const candidates = await Faq.find({ courseId })
      .sort({ hitCount: -1 })
      .limit(env.faqCacheMaxEntriesPerCourse)
      .lean();

    let best = null;
    let bestSimilarity = 0;

    for (const candidate of candidates) {
      const similarity = computeCosineSimilarity(queryVector, candidate.questionEmbedding);

      if (similarity !== null && similarity >= env.faqCacheSimilarityThreshold && similarity > bestSimilarity) {
        best = candidate;
        bestSimilarity = similarity;
      }
    }

    return best ? { faq: best, similarity: Number(bestSimilarity.toFixed(4)) } : null;
  } catch (error) {
    logCacheError('FAQ cache semantic lookup failed.', error);
    return null;
  }
}

async function recordFaqHit(faqId) {
  try {
    return await Faq.findOneAndUpdate(
      { _id: faqId },
      { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
      { new: true },
    );
  } catch (error) {
    logCacheError('FAQ cache hit recording failed.', error);
    return null;
  }
}

async function pruneCourseFaqs(courseId) {
  const total = await Faq.countDocuments({ courseId });
  const overflow = total - env.faqCacheMaxEntriesPerCourse;

  if (overflow <= 0) {
    return;
  }

  // 超量時淘汰最少被命中的舊條目，保住高頻常見問題
  const removable = await Faq.find({ courseId })
    .sort({ hitCount: 1 })
    .limit(overflow)
    .lean();

  if (removable.length) {
    await Faq.deleteMany({ _id: { $in: removable.map((item) => item._id) } });
  }
}

async function saveFaqEntry({ courseId, question, answer, matches, clip, questionEmbedding }) {
  try {
    const normalizedQuestion = normalizeFaqQuestion(question);
    const trimmedAnswer = String(answer || '').trim();

    if (!normalizedQuestion || !trimmedAnswer) {
      return null;
    }

    // One normalized question owns one entry, so regenerated answers refresh rather than duplicate the cache.
    const faq = await Faq.findOneAndUpdate(
      { courseId, normalizedQuestion },
      {
        $set: {
          question: String(question || '').trim(),
          answer: trimmedAnswer,
          matches: Array.isArray(matches) ? matches : [],
          clip: clip || null,
          questionEmbedding: Array.isArray(questionEmbedding) ? questionEmbedding : [],
          lastAnsweredAt: new Date(),
        },
        $setOnInsert: { hitCount: 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await pruneCourseFaqs(courseId);
    return faq;
  } catch (error) {
    logCacheError('FAQ cache save failed.', error);
    return null;
  }
}

// 影片內容變動（刪除 / 重新處理完成）時，主課程與所有掛載該影片的課程
// 快取答案都可能過期，一律清除讓下一次提問重建。
async function clearFaqsForVideoCourses(video, { throwOnError = false } = {}) {
  try {
    const courseIds = new Set();
    const primaryCourseId = video?.courseId?._id || video?.courseId;

    if (primaryCourseId) {
      courseIds.add(String(primaryCourseId));
    }

    const attachedCourses = await Course.find({ videoIds: video._id });
    for (const course of attachedCourses) {
      courseIds.add(String(course._id));
    }

    if (!courseIds.size) {
      return;
    }

    await Faq.deleteMany({ courseId: { $in: [...courseIds] } });
  } catch (error) {
    logCacheError('FAQ cache invalidation failed.', error);
    if (throwOnError) {
      throw error;
    }
  }
}

function toPublicFaq(faq) {
  return {
    id: String(faq._id),
    question: faq.question,
    answer: faq.answer,
    matches: (faq.matches || []).map((match) => ({
      segmentId: match.segmentId ?? null,
      videoId: match.videoId ?? null,
      videoTitle: match.videoTitle ?? null,
      startSec: match.startSec ?? null,
      endSec: match.endSec ?? null,
      jumpUrl: match.jumpUrl ?? null,
    })),
    hitCount: faq.hitCount || 0,
    lastHitAt: faq.lastHitAt || null,
    updatedAt: faq.updatedAt || null,
  };
}

async function listCourseFaqs({ user, courseId, limit = 20 }) {
  // Resolve authorization before reading cached course content.
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanAccessCourse(user, course);

  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const faqs = await Faq.find({ courseId: course._id })
    .sort({ hitCount: -1 })
    .limit(normalizedLimit)
    .lean();

  return faqs.map((faq) => toPublicFaq(faq));
}

async function clearCourseFaqs({ user, courseId }) {
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  const result = await Faq.deleteMany({ courseId: course._id });
  return { deletedCount: result?.deletedCount || 0 };
}

async function deleteFaqsByCourseId(courseId) {
  assertObjectId(courseId, 'course');
  return Faq.deleteMany({ courseId });
}

module.exports = {
  isFaqCacheEnabled,
  normalizeFaqQuestion,
  findFaqByExactQuestion,
  findFaqBySimilarEmbedding,
  recordFaqHit,
  saveFaqEntry,
  clearFaqsForVideoCourses,
  listCourseFaqs,
  clearCourseFaqs,
  deleteFaqsByCourseId,
};
