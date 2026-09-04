const Faq = require('../models/faq.model');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const { computeCosineSimilarity } = require('../utils/vectorSimilarity');
const { getCourseByIdOrThrow, assertCanManageCourse } = require('./courseAccess.service');

// 短影片腳本的自動選題（規格書 DR-02 / DR-12）。
//
// 本檔案只負責 DR-12 的第 1～2 層：零成本過濾與熱度排序。
// 第 3 層（證據涵蓋度）需要檢索、第 4 層（弧線適用性）需要 LLM，兩者都在後續工作項，
// 因此這裡不 require ShortScript model 也不呼叫檢索——已做過／已否決的主題
// 由呼叫端以 excludedTopicKeys 傳入，維持分層乾淨。
//
// 資料來源固定為 faqs：被 isNoAnswerReply() 判定「答不出來」的回答不會寫進 faqs，
// runtime degraded 時的回答也不會，因此拒答題與不可信的檢索結果天然已被排除。
// 若日後改以 questions 為來源（規格書 P-05），必須自行套用同一組判定。

function isSemanticClusteringEnabled() {
  const threshold = env.shortScriptTopicSimilarityThreshold;
  return Number.isFinite(threshold) && threshold > 0 && threshold <= 1;
}

function toTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

// FAQ 最後一次被提問的時間。lastHitAt 只在快取命中時更新，首次建立的 FAQ 為 null，
// 因此退回 lastAnsweredAt，再退回 updatedAt。
function resolveLastAskedAt(faq) {
  return faq.lastHitAt || faq.lastAnsweredAt || faq.updatedAt || null;
}

// 排序必須是確定性的（規格書 R-04）：同樣的資料一定產生同樣的分群與排名，
// 否則「為什麼選這一題」無法對教師解釋。因此每一層 tie-break 都要有終局比較值。
function compareFaqForClustering(left, right) {
  const hitDiff = (right.hitCount || 0) - (left.hitCount || 0);
  if (hitDiff !== 0) {
    return hitDiff;
  }

  return String(left.normalizedQuestion || '').localeCompare(String(right.normalizedQuestion || ''));
}

function compareCandidates(left, right) {
  const hitDiff = right.totalHitCount - left.totalHitCount;
  if (hitDiff !== 0) {
    return hitDiff;
  }

  // 第 3 層的涵蓋度尚未實作，DR-12 的第二順位暫時跳過，直接比最近提問時間。
  const timeDiff = toTimestamp(right.lastAskedAt) - toTimestamp(left.lastAskedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return left.topicKey.localeCompare(right.topicKey);
}

// 貪婪分群：依 compareFaqForClustering 的順序逐筆處理，能併進既有群就併，
// 否則自成一群。代表題固定是該群第一筆（熱度最高者），所以 topicKey 穩定。
// 沒有 embedding 的 FAQ 無法做語意比對，一律自成一群，不與任何群合併。
function clusterFaqs(faqs) {
  const semanticEnabled = isSemanticClusteringEnabled();
  const threshold = env.shortScriptTopicSimilarityThreshold;
  const clusters = [];

  for (const faq of faqs) {
    const embedding = Array.isArray(faq.questionEmbedding) ? faq.questionEmbedding : [];
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
      target.members.push(faq);
      continue;
    }

    clusters.push({
      representative: faq,
      representativeEmbedding: embedding,
      members: [faq],
    });
  }

  return clusters;
}

function buildCandidate(cluster) {
  const { representative, members } = cluster;
  const variants = members.map((faq) => ({
    faqId: String(faq._id),
    question: faq.question,
    hitCount: faq.hitCount || 0,
    lastAskedAt: resolveLastAskedAt(faq),
  }));

  const lastAskedAt = variants.reduce((latest, variant) => (
    toTimestamp(variant.lastAskedAt) > toTimestamp(latest) ? variant.lastAskedAt : latest
  ), null);

  return {
    topicKey: String(representative.normalizedQuestion || ''),
    question: representative.question,
    normalizedQuestion: representative.normalizedQuestion,
    totalHitCount: variants.reduce((sum, variant) => sum + variant.hitCount, 0),
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
 * @returns {Promise<{candidates: object[], totalClusters: number, similarityThreshold: number|null}>}
 */
async function listTopicCandidates({
  user,
  courseId,
  excludedTopicKeys = [],
  limit,
} = {}) {
  assertObjectId(courseId, 'course');

  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  const faqs = await Faq.find({ courseId: course._id }).lean();
  const sorted = [...faqs].sort(compareFaqForClustering);
  const clusters = clusterFaqs(sorted);

  const excluded = new Set(excludedTopicKeys.map((key) => String(key)));
  const minHitCount = env.shortScriptTopicMinHitCount;
  const pageSize = Number(limit) > 0 ? Number(limit) : env.shortScriptTopicCandidateLimit;

  const candidates = clusters
    .map(buildCandidate)
    .filter((candidate) => candidate.totalHitCount >= minHitCount)
    .filter((candidate) => !excluded.has(candidate.topicKey))
    .sort(compareCandidates)
    .slice(0, pageSize);

  return {
    candidates,
    totalClusters: clusters.length,
    similarityThreshold: isSemanticClusteringEnabled() ? env.shortScriptTopicSimilarityThreshold : null,
  };
}

module.exports = {
  listTopicCandidates,
};
