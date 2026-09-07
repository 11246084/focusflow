const Question = require('../models/question.model');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const { computeCosineSimilarity } = require('../utils/vectorSimilarity');
const { getCourseByIdOrThrow, assertCanManageCourse } = require('./courseAccess.service');
const { isNoAnswerReply } = require('./answerGeneration.service');
const { QUESTION_STATUSES } = require('../constants/enums');

// 短影片腳本的自動選題（規格書 DR-02 / DR-12 / DR-14）。
//
// 本檔案只負責 DR-12 的第 1～2 層：零成本過濾與熱度排序。
// 第 3 層（證據涵蓋度）需要檢索、第 4 層（弧線適用性）需要 LLM，兩者都在後續工作項，
// 因此這裡不 require ShortScript model 也不呼叫檢索——已做過／已否決的主題
// 由呼叫端以 excludedTopicKeys 傳入，維持分層乾淨。
//
// 資料來源是 questions，不是 faqs（規格書 DR-14）。faqs 是快取：hitCount 的語意是
// 「快取命中次數」而非提問次數、累計會因影片異動整批失效並歸零、且不涵蓋
// LINE 多輪對話的提問。questions 是逐筆追加、不隨影片異動刪除的紀錄。
//
// 代價是 faqs 原本幫忙擋掉的三類資料，這裡要自己擋（見 buildQuestionFilter 與
// isUsableQuestion）：拒答題、runtime 降級的回答、沒撈到片段的題。

// 門檻可由呼叫端覆寫，供 P-01 校準時一次比較多個值（見 scripts/verifyShortScriptSelection.js）。
// 正式流程不傳，一律用 env 設定值。
function resolveThreshold(override) {
  return Number.isFinite(override) ? override : env.shortScriptTopicSimilarityThreshold;
}

function isSemanticClusteringEnabled(override) {
  const threshold = resolveThreshold(override);
  return Number.isFinite(threshold) && threshold > 0 && threshold <= 1;
}

// 與 faqCache.normalizeFaqQuestion 相同的正規化方式，讓兩邊對「同一題」的認定一致。
function normalizeQuestionText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function toTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildQuestionFilter(courseId) {
  return {
    courseId,
    // 沒撈到片段的題不可能有足夠證據做影片。
    status: { $ne: QUESTION_STATUSES.NO_MATCH },
  };
}

function isUsableQuestion(question) {
  // runtime 降級時撈到的片段不可信，不能拿來當腳本依據。
  if (question?.runtime?.degraded === true) {
    return false;
  }

  // 「答不出來」的罐頭回覆：資料庫都答不了，更不可能做成影片。
  if (isNoAnswerReply(question?.answer)) {
    return false;
  }

  return Boolean(String(question?.question || '').trim());
}

// 排序必須是確定性的（規格書 R-04）：同樣的資料一定產生同樣的分群與排名，
// 否則「為什麼選這一題」無法對教師解釋。因此每一層 tie-break 都要有終局比較值。
function compareGroupsForClustering(left, right) {
  const countDiff = right.askCount - left.askCount;
  if (countDiff !== 0) {
    return countDiff;
  }

  return left.normalizedQuestion.localeCompare(right.normalizedQuestion);
}

function compareCandidates(left, right) {
  const countDiff = right.totalAskCount - left.totalAskCount;
  if (countDiff !== 0) {
    return countDiff;
  }

  // 第 3 層的涵蓋度尚未實作，DR-12 的第二順位暫時跳過，直接比最近提問時間。
  const timeDiff = toTimestamp(right.lastAskedAt) - toTimestamp(left.lastAskedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return left.topicKey.localeCompare(right.topicKey);
}

// 第 1 層：正規化文字精確合併並計數。零成本，不碰向量。
function groupByNormalizedQuestion(questions) {
  const groups = new Map();

  for (const question of questions) {
    if (!isUsableQuestion(question)) {
      continue;
    }

    const normalizedQuestion = normalizeQuestionText(question.question);
    if (!normalizedQuestion) {
      continue;
    }

    const existing = groups.get(normalizedQuestion);
    const askedAt = question.askedAt || question.createdAt || null;

    if (existing) {
      existing.askCount += 1;
      existing.rawQuestions.add(String(question.question).trim());
      if (toTimestamp(askedAt) > toTimestamp(existing.lastAskedAt)) {
        existing.lastAskedAt = askedAt;
      }
      continue;
    }

    groups.set(normalizedQuestion, {
      normalizedQuestion,
      question: String(question.question).trim(),
      // 同一個正規化 key 底下可能有多種原始寫法（差空格、大小寫、標點）。
      // 查向量時必須用全部寫法比對，只用代表字串會漏掉其他寫法的紀錄，
      // 導致該群被當成「沒有向量」而無法語意合併。
      rawQuestions: new Set([String(question.question).trim()]),
      askCount: 1,
      lastAskedAt: askedAt,
    });
  }

  return [...groups.values()];
}

// 第 2 層：只對前 M 名讀向量。舊資料沒有 questionEmbedding（DR-14 之前寫入的），
// 補齊前這些群不做語意合併，只保留第 1 層的精確合併結果。
async function loadEmbeddingsForGroups(courseId, groups, thresholdOverride) {
  if (!isSemanticClusteringEnabled(thresholdOverride) || !groups.length) {
    return new Map();
  }

  const rawQuestions = groups.flatMap((group) => [...(group.rawQuestions || [group.question])]);

  const docs = await Question.find({
    courseId,
    question: { $in: rawQuestions },
    questionEmbedding: { $exists: true },
  })
    .select('question questionEmbedding')
    .lean();

  const byNormalized = new Map();
  for (const doc of docs) {
    const embedding = Array.isArray(doc.questionEmbedding) ? doc.questionEmbedding : [];
    if (!embedding.length) {
      continue;
    }
    const key = normalizeQuestionText(doc.question);
    if (!byNormalized.has(key)) {
      byNormalized.set(key, embedding);
    }
  }

  return byNormalized;
}

// 貪婪分群：依 compareGroupsForClustering 的順序逐筆處理，能併進既有群就併，
// 否則自成一群。代表題固定是該群第一筆（提問次數最多者），所以 topicKey 穩定。
// 沒有向量的群無法做語意比對，一律自成一群。
function clusterGroups(groups, embeddingByNormalized, thresholdOverride) {
  const semanticEnabled = isSemanticClusteringEnabled(thresholdOverride);
  const threshold = resolveThreshold(thresholdOverride);
  const clusters = [];

  for (const group of groups) {
    const embedding = embeddingByNormalized.get(group.normalizedQuestion) || [];
    let target = null;

    if (semanticEnabled && embedding.length) {
      for (const cluster of clusters) {
        const similarity = computeCosineSimilarity(embedding, cluster.representativeEmbedding);
        if (similarity !== null && similarity >= threshold) {
          target = cluster;
          break;
        }
      }
    }

    if (target) {
      target.members.push(group);
      continue;
    }

    clusters.push({
      representative: group,
      representativeEmbedding: embedding,
      members: [group],
    });
  }

  return clusters;
}

function buildCandidate(cluster) {
  const { representative, members } = cluster;
  const variants = members.map((group) => ({
    question: group.question,
    normalizedQuestion: group.normalizedQuestion,
    askCount: group.askCount,
    lastAskedAt: group.lastAskedAt,
  }));

  const lastAskedAt = variants.reduce((latest, variant) => (
    toTimestamp(variant.lastAskedAt) > toTimestamp(latest) ? variant.lastAskedAt : latest
  ), null);

  return {
    topicKey: representative.normalizedQuestion,
    question: representative.question,
    normalizedQuestion: representative.normalizedQuestion,
    totalAskCount: variants.reduce((sum, variant) => sum + variant.askCount, 0),
    variants,
    lastAskedAt,
  };
}

/**
 * 列出某課程的自動選題候選，已完成同義題合併與熱度排序。
 *
 * @param {object} params
 * @param {object} params.user            呼叫者，須為課程 owner teacher 或 admin
 * @param {string} params.courseId
 * @param {string[]} params.excludedTopicKeys  已 approved／dismissed 的 topicKey，由呼叫端傳入
 * @param {number} params.limit           取前 M 名，預設 env.shortScriptTopicCandidateLimit
 * @returns {Promise<{candidates: object[], totalClusters: number, similarityThreshold: number|null, usableQuestionCount: number}>}
 */
async function listTopicCandidates({
  user,
  courseId,
  excludedTopicKeys = [],
  limit,
  similarityThreshold: thresholdOverride,
} = {}) {
  assertObjectId(courseId, 'course');

  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  // 不載入向量：一筆 3072 維向量約 24KB，整門課全載會很重。
  // 向量只在第 2 層對前 M 名另外讀。
  const questions = await Question.find(buildQuestionFilter(course._id))
    .select('question answer status runtime askedAt createdAt')
    .lean();

  const groups = groupByNormalizedQuestion(questions);
  const minAskCount = env.shortScriptTopicMinHitCount;
  const pageSize = Number(limit) > 0 ? Number(limit) : env.shortScriptTopicCandidateLimit;

  // 先用免費的精確合併結果過濾與排序，只把前 M 名送進需要向量的第 2 層。
  const shortlist = groups
    .filter((group) => group.askCount >= 1)
    .sort(compareGroupsForClustering)
    .slice(0, Math.max(pageSize * 3, pageSize));

  const embeddingByNormalized = await loadEmbeddingsForGroups(course._id, shortlist, thresholdOverride);
  const clusters = clusterGroups(shortlist, embeddingByNormalized, thresholdOverride);

  const excluded = new Set(excludedTopicKeys.map((key) => String(key)));

  const candidates = clusters
    .map(buildCandidate)
    .filter((candidate) => candidate.totalAskCount >= minAskCount)
    .filter((candidate) => !excluded.has(candidate.topicKey))
    .sort(compareCandidates)
    .slice(0, pageSize);

  return {
    candidates,
    totalClusters: clusters.length,
    usableQuestionCount: groups.reduce((sum, group) => sum + group.askCount, 0),
    similarityThreshold: isSemanticClusteringEnabled(thresholdOverride) ? resolveThreshold(thresholdOverride) : null,
  };
}

module.exports = {
  listTopicCandidates,
  normalizeQuestionText,
};
