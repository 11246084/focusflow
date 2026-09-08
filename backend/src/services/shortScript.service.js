const ShortScript = require('../models/shortScript.model');
const VideoSegment = require('../models/videoSegment.model');
const AppError = require('../utils/appError');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const { getCourseByIdOrThrow, assertCanManageCourse } = require('./courseAccess.service');
const { listTopicCandidates } = require('./shortScriptTopic.service');
const { retrieveSegmentsOnly } = require('./qa.service');
const { generateScript } = require('./shortScriptGeneration.service');
const { recordUsage } = require('./usageLog.service');
const {
  SHORT_SCRIPT_STATUSES,
  SHORT_SCRIPT_FEEDBACK_TYPES,
  USAGE_LOG_EVENTS,
} = require('../constants/enums');

// 證據代號 A、B、C…，對應腳本模板 §2 的對照表。
const EVIDENCE_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 已 approved / dismissed 的主題不再被自動選中（規格書附錄 F.1）。
// 其餘狀態（evidence_ready、generated、changes_requested）代表還在進行中，
// 同樣不該重複選題，因此一律排除——實際上 courseId + topicKey 有 unique 索引，
// 這裡先排除是為了讓選題階段就跳過，而不是等寫入才撞索引。
async function loadExcludedTopicKeys(courseId) {
  const existing = await ShortScript.find({ courseId }).lean();
  return existing.map((script) => script.topicKey).filter(Boolean);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 鄰接擴展（規格書 DR-11 / 附錄 C.1）。
 *
 * STT 是按時間切 chunk，不是按語意切的，一句完整的話常常斷在兩格之間。
 * 兩份手寫腳本的證據表可以直接佐證：V4 的 A~D 是 chunk_0038~0041 連續四格，
 * V5 的 C、D 各自是兩格合併。只取 TopK 原樣會讓反轉句被切斷。
 *
 * 四條規則：
 *   1. 只在同一 videoId 內擴展（跨影片的 chunk 沒有連續關係）
 *   2. 鄰接判定用同一 videoId 內的 startSec 排序，不解析 chunkId 的數字後綴
 *      （videoSegment 沒有 chunkIndex 欄位，chunkId 只是字串，依賴其命名格式不穩）
 *   3. 窗口可配置，不寫死 N+1
 *   4. 擴展後去重
 */
async function expandMatchesWithNeighbours(matches, { window } = {}) {
  const expandWindow = Number.isFinite(window) ? window : env.shortScriptEvidenceExpandWindow;

  if (!matches.length || expandWindow <= 0) {
    return matches.map((match) => ({ ...match, expandedFrom: null }));
  }

  const videoIds = [...new Set(matches.map((match) => match.videoId).filter(Boolean))];
  if (!videoIds.length) {
    return matches.map((match) => ({ ...match, expandedFrom: null }));
  }

  const siblings = await VideoSegment.find({ videoId: { $in: videoIds } }).lean();

  // 依 videoId 分組後以 startSec 排序，建立「第幾格」的位置索引。
  const orderedByVideo = new Map();
  for (const videoId of videoIds) {
    const ordered = siblings
      .filter((segment) => String(segment.videoId) === String(videoId))
      .sort((left, right) => (toNumber(left.startSec) ?? 0) - (toNumber(right.startSec) ?? 0));
    orderedByVideo.set(String(videoId), ordered);
  }

  const identityOf = (segment) => String(segment.chunkId || segment.segmentId || segment._id || '');
  const collected = new Map();

  function collect(segment, expandedFrom) {
    const key = identityOf(segment);
    if (!key || collected.has(key)) {
      return;
    }
    collected.set(key, {
      chunkId: key,
      segmentId: String(segment.segmentId || segment.chunkId || ''),
      videoId: segment.videoId ? String(segment.videoId) : null,
      videoTitle: segment.videoTitle || null,
      startSec: toNumber(segment.startSec),
      endSec: toNumber(segment.endSec),
      transcript: segment.transcript ?? segment.text ?? '',
      expandedFrom,
      // 收集順序＝檢索分數由高到低（命中片段先，其鄰接片段緊接其後）。
      // buildEvidence 依此截斷，確保上限砍掉的是最不相關的，而不是最晚出現的。
      priority: collected.size,
    });
  }

  // 兩階段收集：先收全部命中片段，再收擴展片段。
  // 若混在一起收（一個命中接著它的鄰居），第二個命中會排在第一個命中的鄰居後面，
  // 證據上限緊的時候會丟掉真正命中的片段——鄰居只是補上下文，不該擠掉命中。
  for (const match of matches) {
    collect(match, null);
  }

  for (const match of matches) {
    const ordered = orderedByVideo.get(String(match.videoId)) || [];
    const position = ordered.findIndex((segment) => identityOf(segment) === identityOf(match));
    if (position === -1) {
      continue;
    }

    for (let offset = 1; offset <= expandWindow; offset += 1) {
      const before = ordered[position - offset];
      const after = ordered[position + offset];
      if (before) collect(before, identityOf(match));
      if (after) collect(after, identityOf(match));
    }
  }

  // 依影片、時間排序，讓證據表的順序符合原片播放順序（手寫腳本也是這樣排的）。
  return [...collected.values()].sort((left, right) => {
    const videoDiff = String(left.videoId || '').localeCompare(String(right.videoId || ''));
    if (videoDiff !== 0) {
      return videoDiff;
    }
    return (left.startSec ?? 0) - (right.startSec ?? 0);
  });
}

// 截斷順序很重要：expandedMatches 進來時是「依原片時間排序」（給人看的順序），
// 但直接切前 N 筆等於只留最早的片段，會把後段的高分命中整批丟掉。
// 因此先依 priority（檢索分數順序）取前 N 筆，再排回時間順序顯示。
function buildEvidence(expandedMatches, { limit } = {}) {
  const maxEvidence = Number.isFinite(limit) ? limit : env.shortScriptEvidenceMaxItems;

  const kept = [...expandedMatches]
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))
    .slice(0, maxEvidence)
    .sort((left, right) => {
      const videoDiff = String(left.videoId || '').localeCompare(String(right.videoId || ''));
      if (videoDiff !== 0) {
        return videoDiff;
      }
      return (left.startSec ?? 0) - (right.startSec ?? 0);
    });

  return kept.map((match, index) => ({
    code: EVIDENCE_CODES[index] || `X${index}`,
    chunkId: match.chunkId,
    videoId: match.videoId,
    videoTitle: match.videoTitle,
    startSec: match.startSec,
    endSec: match.endSec,
    rawText: match.transcript || '',
    expandedFrom: match.expandedFrom,
  }));
}

/**
 * 自動選題並凍結證據（規格書 DR-02 / DR-08 / DR-11）。
 *
 * 本輪只實作 DR-12 的第 1～2 層（零成本過濾 + 熱度排序）與證據凍結。
 * 第 3 層（涵蓋度過濾）在此以 minEvidenceItems 落地；
 * 第 4 層（弧線適用性判定）需要 LLM，留到腳本生成的工作項。
 */
async function createScriptWithFrozenEvidence({ user, courseId } = {}) {
  assertObjectId(courseId, 'course');

  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  const excludedTopicKeys = await loadExcludedTopicKeys(course._id);
  const { candidates } = await listTopicCandidates({ user, courseId, excludedTopicKeys });

  if (!candidates.length) {
    throw new AppError(
      'No topic candidate passed the automatic selection filters.',
      422,
      'SHORT_SCRIPT_NO_CANDIDATE',
    );
  }

  // DR-12 第 3 層：依序評估候選，證據不足者淘汰後換下一名，不是撞到第一名就失敗。
  // 分層淘汰的用意是避免對全部候選跑檢索——只評估到第一個通過的為止。
  // 第 4 層（弧線適用性）需要 LLM，留到腳本生成的工作項。
  let selected = null;
  let retrieval = null;
  let evidence = [];
  const rejected = [];

  for (const [index, candidate] of candidates.entries()) {
    const candidateRetrieval = await retrieveSegmentsOnly({
      user,
      courseId,
      question: candidate.question,
      // 低於 QA 的命中上限，讓證據名額留得下鄰接擴展（規格書 DR-16）。
      limit: env.shortScriptMatchLimit,
    });

    const candidateEvidence = buildEvidence(
      await expandMatchesWithNeighbours(candidateRetrieval.matches),
    );

    if (candidateEvidence.length >= env.shortScriptEvidenceMinItems) {
      selected = candidate;
      retrieval = candidateRetrieval;
      evidence = candidateEvidence;
      selected.rank = index + 1;
      break;
    }

    // 被淘汰的候選要留痕，否則教師看到的是第 N 名卻不知道前面幾名為何出局。
    rejected.push({
      rank: index + 1,
      topicKey: candidate.topicKey,
      question: candidate.question,
      evidenceCount: candidateEvidence.length,
      reason: 'insufficient_evidence',
    });
  }

  if (!selected) {
    throw new AppError(
      'Not enough transcript evidence to build a script.',
      422,
      'SHORT_SCRIPT_EVIDENCE_EMPTY',
    );
  }

  const frozenAt = new Date();

  return ShortScript.create({
    courseId: course._id,
    topic: selected.question,
    topicKey: selected.topicKey,
    sourceQuestions: selected.variants.map((variant) => ({
      question: variant.question,
      askCount: variant.askCount,
      uniqueAskerCount: variant.uniqueAskerCount,
    })),
    // 教師必須能回答「為什麼系統選了這一題」（規格書 R-04）。
    selectionReason: {
      selectedTopicKey: selected.topicKey,
      totalAskCount: selected.totalAskCount,
      uniqueAskerCount: selected.uniqueAskerCount,
      variantCount: selected.variants.length,
      lastAskedAt: selected.lastAskedAt,
      evidenceCount: evidence.length,
      directMatchCount: retrieval.matches.length,
      rank: selected.rank,
      // 因證據不足而在第 3 層被淘汰的候選（DR-12）。
      rejectedForEvidence: rejected,
      runnersUp: candidates
        .filter((candidate) => candidate.topicKey !== selected.topicKey)
        .slice(0, 3)
        .map((candidate, index) => ({
          rank: index + 1,
          topicKey: candidate.topicKey,
          question: candidate.question,
          totalAskCount: candidate.totalAskCount,
          uniqueAskerCount: candidate.uniqueAskerCount,
        })),
      excludedTopicKeyCount: excludedTopicKeys.length,
      selectedAt: frozenAt,
    },
    evidence,
    evidenceFrozenAt: frozenAt,
    versions: [],
    status: SHORT_SCRIPT_STATUSES.EVIDENCE_READY,
    createdBy: user?.id || null,
  });
}

// 狀態機（規格書附錄 F）。非法轉換一律回 SHORT_SCRIPT_STATE_INVALID，
// 不靜默忽略——狀態跳掉會讓「哪些腳本等著審核」這件事失去意義。
//
// dismissed 的來源比附錄 F 的表格多一個：第 2 章的流程圖顯示教師在審核 generated
// 腳本時也可以直接否決整個主題。三個進行中的狀態都允許轉 dismissed。
const ALLOWED_TRANSITIONS = {
  [SHORT_SCRIPT_STATUSES.EVIDENCE_READY]: [
    SHORT_SCRIPT_STATUSES.GENERATED,
    SHORT_SCRIPT_STATUSES.DISMISSED,
  ],
  [SHORT_SCRIPT_STATUSES.GENERATED]: [
    SHORT_SCRIPT_STATUSES.APPROVED,
    SHORT_SCRIPT_STATUSES.CHANGES_REQUESTED,
    SHORT_SCRIPT_STATUSES.DISMISSED,
  ],
  [SHORT_SCRIPT_STATUSES.CHANGES_REQUESTED]: [
    SHORT_SCRIPT_STATUSES.GENERATED,
    SHORT_SCRIPT_STATUSES.DISMISSED,
  ],
  [SHORT_SCRIPT_STATUSES.APPROVED]: [],
  [SHORT_SCRIPT_STATUSES.DISMISSED]: [],
};

function assertTransition(from, to) {
  if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
    throw new AppError(
      `Cannot move a short script from ${from} to ${to}.`,
      409,
      'SHORT_SCRIPT_STATE_INVALID',
    );
  }
}

async function loadScriptForManage({ user, scriptId }) {
  assertObjectId(scriptId, 'short script');

  const script = await ShortScript.findById(scriptId).lean();
  if (!script) {
    throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');
  }

  const course = await getCourseByIdOrThrow(script.courseId);
  await assertCanManageCourse(user, course);

  return { script, course };
}

// 同課程其他腳本用過的視覺隱喻。模板明訂「新主題要換新隱喻，不要重複用過的」，
// 否則不同影片看起來像換皮。
async function collectUsedMetaphors(courseId, excludeScriptId) {
  const others = await ShortScript.find({ courseId }).lean();

  return others
    .filter((item) => String(item._id) !== String(excludeScriptId))
    .flatMap((item) => {
      const latest = (item.versions || [])[(item.versions || []).length - 1];
      return (latest?.payload?.visualMetaphorOptions || []).map((option) => option.label);
    })
    .filter(Boolean);
}

function latestVersion(script) {
  const versions = script.versions || [];
  return versions[versions.length - 1] || null;
}

/**
 * 生成腳本並附加為新版本（規格書 WO-05 / WO-06）。
 *
 * 回饋分流（DR-09）在呼叫端之前就決定好了：
 *   - retrieval 類回饋 → 先重新凍結證據，再生成（證據換了，敘事才有意義）
 *   - narrative 類回饋 → 沿用同一份證據，只重寫敘事
 * 若不分流、一律重生敘事，模型會在錯誤的證據上反覆重寫，越改越像編的。
 */
async function generateScriptVersion({ user, scriptId } = {}) {
  const { script, course } = await loadScriptForManage({ user, scriptId });
  assertTransition(script.status, SHORT_SCRIPT_STATUSES.GENERATED);

  const previous = latestVersion(script);
  const feedbackType = previous?.feedbackType || null;
  const feedback = previous?.feedback || null;

  let evidence = script.evidence;
  let evidenceFrozenAt = script.evidenceFrozenAt;
  let evidenceRefreshed = false;

  if (feedbackType === SHORT_SCRIPT_FEEDBACK_TYPES.RETRIEVAL) {
    const retrieval = await retrieveSegmentsOnly({
      user,
      courseId: course._id,
      question: script.topic,
      limit: env.shortScriptMatchLimit,
    });
    const refreshed = buildEvidence(await expandMatchesWithNeighbours(retrieval.matches));

    if (refreshed.length < env.shortScriptEvidenceMinItems) {
      throw new AppError(
        'Not enough transcript evidence to rebuild the script.',
        422,
        'SHORT_SCRIPT_EVIDENCE_EMPTY',
      );
    }

    evidence = refreshed;
    evidenceFrozenAt = new Date();
    evidenceRefreshed = true;
  }

  const usedMetaphors = await collectUsedMetaphors(course._id, script._id);
  const generated = await generateScript({
    topic: script.topic,
    evidence,
    usedMetaphors,
    // narrative 類回饋要帶進 prompt；retrieval 類已經換過證據，不重複施加敘事指示。
    feedback: feedbackType === SHORT_SCRIPT_FEEDBACK_TYPES.NARRATIVE ? feedback : null,
  });

  const version = {
    versionNo: (script.versions || []).length + 1,
    payload: generated.payload,
    generatedAt: new Date(),
    feedback: null,
    feedbackType: null,
    reviewedBy: null,
    reviewedAt: null,
    evidenceFrozenAt,
    // retrieval 類回饋會換掉證據，這裡標記讓教師知道這一版依據的是新證據。
    evidenceRefreshed,
    generationAttempts: generated.attempts,
  };

  // 成本紀錄（規格書 DR-06）。用獨立的 event 型別，不得計入 teacherStats 的 queriesCount。
  // recordUsage 內部吞錯，寫入失敗不會中斷生成——成本紀錄是觀測用途，不是正確性依賴。
  await recordUsage({
    userId: user?.id || null,
    courseId: course._id,
    event: USAGE_LOG_EVENTS.SHORT_SCRIPT_GENERATE,
    metadata: {
      scriptId: String(script._id),
      versionNo: version.versionNo,
      generationAttempts: generated.attempts,
      evidenceCount: evidence.length,
      evidenceRefreshed,
      feedbackType,
    },
  });

  return ShortScript.findByIdAndUpdate(
    script._id,
    {
      $set: {
        status: SHORT_SCRIPT_STATUSES.GENERATED,
        evidence,
        evidenceFrozenAt,
      },
      $push: { versions: version },
    },
    { new: true },
  );
}

/**
 * 教師審核（規格書 WO-06 / DR-09）。
 *
 * @param {'approve'|'request_changes'|'dismiss'} decision
 * @param {'retrieval'|'narrative'} feedbackType  request_changes 時必填，系統不猜
 */
async function submitReview({
  user, scriptId, decision, feedback = null, feedbackType = null,
} = {}) {
  const { script } = await loadScriptForManage({ user, scriptId });

  const targetStatus = {
    approve: SHORT_SCRIPT_STATUSES.APPROVED,
    request_changes: SHORT_SCRIPT_STATUSES.CHANGES_REQUESTED,
    dismiss: SHORT_SCRIPT_STATUSES.DISMISSED,
  }[decision];

  if (!targetStatus) {
    throw new AppError('Unknown review decision.', 400, 'VALIDATION_ERROR');
  }

  assertTransition(script.status, targetStatus);

  if (targetStatus === SHORT_SCRIPT_STATUSES.CHANGES_REQUESTED) {
    // 回饋類型由教師指定，系統不猜（DR-09）。猜錯會讓模型在錯證據上反覆重寫。
    if (!Object.values(SHORT_SCRIPT_FEEDBACK_TYPES).includes(feedbackType)) {
      throw new AppError(
        'feedbackType must be retrieval or narrative when requesting changes.',
        400,
        'VALIDATION_ERROR',
      );
    }
    if (!String(feedback || '').trim()) {
      throw new AppError('Feedback is required when requesting changes.', 400, 'VALIDATION_ERROR');
    }
  }

  const versions = script.versions || [];
  const update = {
    $set: {
      status: targetStatus,
      ...(targetStatus === SHORT_SCRIPT_STATUSES.DISMISSED
        ? { dismissReason: String(feedback || '').trim() || null }
        : {}),
    },
  };

  // 把回饋記在「被審的那一版」上，而不是腳本層級——教師需要看得出
  // 哪一版被退回、退回的理由是什麼，才能確認下一版有沒有吃掉意見。
  if (versions.length) {
    update.$set[`versions.${versions.length - 1}.feedback`] = String(feedback || '').trim() || null;
    update.$set[`versions.${versions.length - 1}.feedbackType`] = feedbackType;
    update.$set[`versions.${versions.length - 1}.reviewedBy`] = user?.id || null;
    update.$set[`versions.${versions.length - 1}.reviewedAt`] = new Date();
  }

  return ShortScript.findByIdAndUpdate(script._id, update, { new: true });
}

async function getScriptById({ user, scriptId } = {}) {
  assertObjectId(scriptId, 'short script');

  const script = await ShortScript.findById(scriptId).lean();
  if (!script) {
    throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');
  }

  const course = await getCourseByIdOrThrow(script.courseId);
  await assertCanManageCourse(user, course);

  return script;
}

async function listCourseScripts({ user, courseId } = {}) {
  assertObjectId(courseId, 'course');

  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);

  return ShortScript.find({ courseId: course._id }).lean();
}

module.exports = {
  createScriptWithFrozenEvidence,
  generateScriptVersion,
  submitReview,
  getScriptById,
  listCourseScripts,
  expandMatchesWithNeighbours,
  buildEvidence,
  ALLOWED_TRANSITIONS,
};
