const mongoose = require('mongoose');
const Course = require('../models/course.model');
const VideoSegment = require('../models/videoSegment.model');
const Clip = require('../models/clip.model');
const AppError = require('../utils/appError');
const env = require('../config/env');
const { assertObjectId } = require('../utils/objectId');
const { assertCanAccessCourse } = require('./courseAccess.service');
const { embedQuery } = require('./queryEmbedding.service');
const { generateAnswer } = require('./answerGeneration.service');
const { recordUsage } = require('./usageLog.service');
const { recordQuestion } = require('./questionRecording.service');
const {
  isFaqCacheEnabled,
  findFaqByExactQuestion,
  findFaqBySimilarEmbedding,
  recordFaqHit,
  saveFaqEntry,
} = require('./faqCache.service');
const { QUESTION_STATUSES, USAGE_LOG_EVENTS } = require('../constants/enums');
const {
  normalizeSegment,
  collectScopedVideos,
  buildCourseBridgeSummary,
  buildCourseSegmentScope,
  buildSegmentLookupQuery,
  segmentMatchesScope,
} = require('./bridgeScope.service');
const {
  buildQaRuntimeSnapshot,
  assertQaRuntimeConfiguration,
} = require('./runtimeDiagnostics.service');

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeCompactText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildCharacterNgrams(text, size = 2) {
  const normalizedText = normalizeCompactText(text);

  if (!normalizedText) {
    return [];
  }

  if (normalizedText.length <= size) {
    return [normalizedText];
  }

  const ngrams = [];

  for (let index = 0; index <= normalizedText.length - size; index += 1) {
    ngrams.push(normalizedText.slice(index, index + size));
  }

  return ngrams;
}

function computeCharacterNgramScore(question, transcript) {
  const questionNgrams = new Set(buildCharacterNgrams(question));
  const transcriptNgrams = buildCharacterNgrams(transcript);

  if (!questionNgrams.size || !transcriptNgrams.length) {
    return 0;
  }

  let matches = 0;

  for (const ngram of transcriptNgrams) {
    if (questionNgrams.has(ngram)) {
      matches += 1;
    }
  }

  return matches / Math.max(questionNgrams.size, transcriptNgrams.length);
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

function computeLexicalScore(question, transcript) {
  const questionWords = new Set(normalizeWords(question));
  const transcriptWords = normalizeWords(transcript);

  let wordScore = 0;

  if (questionWords.size && transcriptWords.length) {
    let matches = 0;

    for (const word of transcriptWords) {
      if (questionWords.has(word)) {
        matches += 1;
      }
    }

    wordScore = matches / Math.max(questionWords.size, transcriptWords.length);
  }

  return Math.max(wordScore, computeCharacterNgramScore(question, transcript));
}

function mapSegmentMatch(segment, score) {
  return {
    segmentId: segment.segmentId,
    videoId: segment.videoId,
    videoTitle: segment.videoTitle || null,
    startSec: segment.startSec,
    endSec: segment.endSec,
    transcript: segment.transcript,
    score: Number(score.toFixed(4)),
  };
}

function buildYouTubeWatchUrl(youtubeVideoId, startSec = 0) {
  if (!youtubeVideoId) {
    return null;
  }

  const seconds = Math.max(0, Math.floor(Number(startSec) || 0));
  return `https://youtu.be/${youtubeVideoId}${seconds ? `?t=${seconds}` : ''}`;
}

function looksLikeObjectId(value) {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

function getVideoPresentationTitle(video) {
  const title = video?.title;
  if (title && !looksLikeObjectId(title)) return title;
  if (video?.fileName) return video.fileName;
  if (video?.youtubeVideoId) return `YouTube: ${video.youtubeVideoId}`;
  if (video?.videoId && !looksLikeObjectId(video.videoId)) return video.videoId;
  return '未知影片';
}

function buildVideoMetadataByIdentifier(scopedVideos) {
  const lookup = new Map();

  for (const video of scopedVideos?.videos || []) {
    const id = String(video._id || video.id || '');
    const externalVideoId = video.videoId ? String(video.videoId) : null;
    const metadata = {
      id,
      videoId: externalVideoId,
      title: getVideoPresentationTitle(video),
      sourceUrl: video.sourceUrl || null,
      youtubeVideoId: video.youtubeVideoId || null,
      videoUrl: video.videoUrl || null,
    };

    for (const identifier of [id, externalVideoId]) {
      if (identifier) {
        lookup.set(identifier, metadata);
      }
    }

    // App-owned videos can store their Mongo _id in the pipeline-facing videoId
    // field. If both identifiers differ, keep the _id title as the display value.
    if (externalVideoId && externalVideoId !== id && lookup.has(externalVideoId)) {
      const existing = lookup.get(externalVideoId);
      if (existing?.id === externalVideoId) {
        lookup.set(externalVideoId, metadata);
      }
    }
  }

  return lookup;
}

function enrichMatchesWithVideoMetadata(matches, scopedVideos) {
  const videoLookup = buildVideoMetadataByIdentifier(scopedVideos);

  return matches.map((match) => {
    const video = videoLookup.get(String(match.videoId || ''));

    if (!video) {
      return match;
    }

    return {
      ...match,
      videoTitle: video.title,
      sourceUrl: video.sourceUrl,
      youtubeVideoId: video.youtubeVideoId,
      videoUrl: video.videoUrl,
      jumpUrl: buildYouTubeWatchUrl(video.youtubeVideoId, match.startSec),
    };
  });
}

function buildRuntimeFallback({ stage, code, message, from = null, to = null }) {
  return {
    stage,
    code,
    message,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function buildRetrievalFallbacks(reasons) {
  const fallbacks = [];

  if (reasons.has('EMBEDDING_DIMENSION_MISMATCH')) {
    fallbacks.push(buildRuntimeFallback({
      stage: 'retrieval',
      code: 'EMBEDDING_DIMENSION_MISMATCH',
      from: 'vector',
      to: 'lexical',
      message: 'Query embeddings do not match stored segment embedding dimensions, so the backend ranked matches lexically.',
    }));
  }

  if (reasons.has('SEGMENT_EMBEDDING_MISSING')) {
    fallbacks.push(buildRuntimeFallback({
      stage: 'retrieval',
      code: 'SEGMENT_EMBEDDING_MISSING',
      from: 'vector',
      to: 'lexical',
      message: 'Some scoped segments have no stored embedding, so the backend ranked matches lexically.',
    }));
  }

  if (reasons.has('QUERY_EMBEDDING_EMPTY')) {
    fallbacks.push(buildRuntimeFallback({
      stage: 'retrieval',
      code: 'QUERY_EMBEDDING_EMPTY',
      from: 'vector',
      to: 'lexical',
      message: 'The query embedding was empty, so the backend ranked matches lexically.',
    }));
  }

  if (!fallbacks.length && reasons.has('VECTOR_SCORING_UNAVAILABLE')) {
    fallbacks.push(buildRuntimeFallback({
      stage: 'retrieval',
      code: 'VECTOR_SCORING_UNAVAILABLE',
      from: 'vector',
      to: 'lexical',
      message: 'Vector scoring was unavailable, so the backend ranked matches lexically.',
    }));
  }

  return fallbacks;
}

function rankSegments(segments, question, queryVector, scope) {
  const queryVectorLength = Array.isArray(queryVector) ? queryVector.length : 0;
  const fallbackReasons = new Set();
  let vectorScoreCount = 0;
  let lexicalScoreCount = 0;

  const matches = segments
    .filter((segment) => segmentMatchesScope(segment, scope))
    .map((segment) => {
      const cosine = computeCosineSimilarity(queryVector, segment.embedding);
      let score = cosine;

      if (cosine !== null) {
        vectorScoreCount += 1;
      } else {
        lexicalScoreCount += 1;

        if (!queryVectorLength) {
          fallbackReasons.add('QUERY_EMBEDDING_EMPTY');
        } else if (!Array.isArray(segment.embedding) || !segment.embedding.length) {
          fallbackReasons.add('SEGMENT_EMBEDDING_MISSING');
        } else if (segment.embedding.length !== queryVectorLength) {
          fallbackReasons.add('EMBEDDING_DIMENSION_MISMATCH');
        } else {
          fallbackReasons.add('VECTOR_SCORING_UNAVAILABLE');
        }

        score = computeLexicalScore(question, segment.transcript);
      }

      return {
        segment,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, env.qaMatchLimit)
    .map((item) => mapSegmentMatch(item.segment, item.score));

  const scoringMode = vectorScoreCount && lexicalScoreCount
    ? 'mixed'
    : vectorScoreCount
      ? 'vector'
      : 'lexical';

  return {
    matches,
    diagnostics: {
      searchBackendUsed: 'memory',
      scoringMode,
      fallbacks: buildRetrievalFallbacks(fallbackReasons),
    },
  };
}

async function loadScopedSearchableSegments(scope) {
  // .lean() 跳過 Mongoose hydration — 對含 3072-float embedding 的 segments 極關鍵：
  // 實測 51 segments hydration 8.8s，lean 後降到 ~1s（省 80%+）
  const segments = await VideoSegment.find(buildSegmentLookupQuery(scope)).lean();

  return segments
    .map((segment) => normalizeSegment(segment))
    .filter((segment) => segmentMatchesScope(segment, scope))
    .filter((segment) => segment.transcript);
}

async function searchSegmentsInMemory(scope, question, queryVector, scopedSegments = null) {
  const segments = scopedSegments || await loadScopedSearchableSegments(scope);
  return rankSegments(segments, question, queryVector, scope);
}

function castCourseIdToObjectId(condition) {
  if (condition.courseId && typeof condition.courseId === 'string') {
    try {
      return { ...condition, courseId: new mongoose.Types.ObjectId(condition.courseId) };
    } catch {
      return condition;
    }
  }
  return condition;
}

function isAtlasFilterCompatible(condition) {
  // text_embedding_index filter fields: courseId (ObjectId), videoId (String)
  const allowedFilterFields = new Set(['courseId', 'videoId', '$or', '$and']);
  return Object.keys(condition).every((key) => allowedFilterFields.has(key));
}

function buildAtlasSegmentFilter(scope) {
  if (env.qaAtlasFilterMode !== 'bridge_course_or_video') {
    return null;
  }

  const raw = buildSegmentLookupQuery(scope);
  if (!raw || !Object.keys(raw).length) {
    return raw;
  }

  if (raw.$or) {
    const compatible = raw.$or
      .filter(isAtlasFilterCompatible)
      .map(castCourseIdToObjectId);
    if (!compatible.length) return null;
    if (compatible.length === 1) return compatible[0];
    return { $or: compatible };
  }

  if (!isAtlasFilterCompatible(raw)) return null;
  return castCourseIdToObjectId(raw);
}

async function searchSegmentsWithAtlas(scope, queryVector) {
  if (!Array.isArray(queryVector) || !queryVector.length) {
    throw new AppError(
      'Atlas vector search requires a non-empty query embedding.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      buildQaRuntimeSnapshot(),
    );
  }

  const atlasFilter = buildAtlasSegmentFilter(scope);

  if (!env.qaAtlasVectorIndexName || !atlasFilter) {
    throw new AppError(
      'Atlas vector search is configured without a ready index or filter contract.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      buildQaRuntimeSnapshot(),
    );
  }

  try {
    const results = await VideoSegment.aggregate([
      {
        $vectorSearch: {
          index: env.qaAtlasVectorIndexName,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(env.qaMatchLimit * 5, 10),
          limit: env.qaMatchLimit,
          filter: atlasFilter,
        },
      },
      {
        $project: {
          _id: 1,
          courseId: 1,
          segmentId: 1,
          chunkId: 1,
          videoId: 1,
          startSec: 1,
          endSec: 1,
          text: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]);

    return {
      matches: results
        .map((item) => ({
          score: item.score,
          segment: normalizeSegment(item),
        }))
        .filter((item) => item.score > 0)
        .filter((item) => segmentMatchesScope(item.segment, scope))
        .map((item) => mapSegmentMatch(item.segment, item.score)),
      diagnostics: {
        searchBackendUsed: 'atlas',
        scoringMode: 'vector',
        fallbacks: [],
      },
    };
  } catch (error) {
    throw new AppError(
      'Atlas vector search is configured but not ready. Check the Atlas index, query embedding provider, and /health before retrying.',
      503,
      'QA_ATLAS_NOT_READY',
      {
        ...buildQaRuntimeSnapshot(),
        atlasVectorIndexName: env.qaAtlasVectorIndexName,
        cause: error.message,
      },
    );
  }
}

function buildCourseRuntimeSummary(summary) {
  return {
    isBridgeCourse: summary.isBridgeCourse,
    qaScopeOnly: summary.qaScopeOnly,
    bridgeMode: summary.bridgeMode,
    videoCount: summary.videoCount,
    appVideoCount: summary.appVideoCount,
    bridgeVideoCount: summary.bridgeVideoCount,
    appOwnedVideoCount: summary.appOwnedVideoCount,
    metadataOnlyVideoCount: summary.metadataOnlyVideoCount,
    bridgeContract: summary.bridgeContract,
    bridgeContractPath: summary.bridgeContractPath,
  };
}

function buildQaResultCategory({ status, matchStatus }) {
  if (matchStatus === 'matched') {
    return status === 'degraded' ? 'matched_degraded' : 'matched';
  }

  return matchStatus;
}

async function findCachedClip(segmentId) {
  const clip = await Clip.findOneAndUpdate(
    { segmentId },
    { $inc: { hitCount: 1 } },
    { new: true },
  );

  if (!clip) {
    return null;
  }

  return {
    segmentId: clip.segmentId,
    clipUrl: clip.clipUrl,
    jumpUrl: clip.jumpUrl,
    keyPoints: clip.keyPoints,
    hitCount: clip.hitCount,
  };
}

function buildQaRuntime({
  runtimeSnapshot,
  courseSummary,
  searchableSegmentCount,
  matchStatus,
  searchDiagnostics,
  answerResult,
}) {
  const answerFallbacks = answerResult?.fallback ? [answerResult.fallback] : [];
  const fallbacks = [...(searchDiagnostics?.fallbacks || []), ...answerFallbacks];
  const degradedReasons = [];

  if (matchStatus === 'no_searchable_segments') {
    degradedReasons.push('NO_SEARCHABLE_SEGMENTS');
  }

  for (const fallback of fallbacks) {
    degradedReasons.push(fallback.code);
  }

  const status = degradedReasons.length ? 'degraded' : 'ready';
  const resultCategory = buildQaResultCategory({ status, matchStatus });

  return {
    ...runtimeSnapshot,
    status,
    degraded: status === 'degraded',
    degradedReasons,
    searchBackendUsed: searchDiagnostics?.searchBackendUsed || env.qaVectorSearchMode,
    scoringMode: searchDiagnostics?.scoringMode || 'lexical',
    searchableSegmentCount,
    matchStatus,
    resultCategory,
    course: buildCourseRuntimeSummary(courseSummary),
    answerProviderUsed: answerResult?.provider || null,
    fallbacks,
  };
}

// FAQ 快取命中：直接以快取的答案/matches/clip 回應，
// 只補記 usage log 與 question 紀錄，維持統計與歷史行為一致。
async function respondFromFaqCache({
  user,
  course,
  courseSummary,
  runtimeSnapshot,
  faq,
  matchType,
  similarity = null,
  source,
  trimmedQuestion,
}) {
  const hitFaq = await recordFaqHit(faq._id) || faq;
  const matches = Array.isArray(faq.matches) ? faq.matches : [];

  const runtime = buildQaRuntime({
    runtimeSnapshot,
    courseSummary,
    // 命中時跳過 segment 載入，數量未知 → null（不是 0，避免誤判為無資料）
    searchableSegmentCount: null,
    matchStatus: 'matched',
    searchDiagnostics: {
      searchBackendUsed: 'faq_cache',
      scoringMode: 'faq_cache',
      fallbacks: [],
    },
    answerResult: { provider: 'faq_cache' },
  });
  runtime.faqCache = {
    hit: true,
    matchType,
    similarity,
    faqId: String(faq._id),
    hitCount: hitFaq?.hitCount ?? faq.hitCount ?? 0,
  };

  const usageLog = await recordUsage({
    userId: user.id,
    courseId: course._id,
    event: USAGE_LOG_EVENTS.ASK,
    metadata: {
      source,
      question: trimmedQuestion,
      matchCount: matches.length,
      topSegmentId: matches[0]?.segmentId || null,
      runtime,
    },
  });

  await recordQuestion({
    userId: user.id,
    courseId: course._id,
    question: trimmedQuestion,
    answer: faq.answer,
    status: QUESTION_STATUSES.ANSWERED,
    source,
    matches,
    runtime,
    sourceUsageLogId: usageLog?._id,
  });

  return {
    answer: faq.answer,
    matches,
    clip: faq.clip || null,
    runtime,
  };
}

// Lightweight timing helper — 只在非測試環境吐出 log，方便診斷各階段瓶頸
const QA_TIMING_ENABLED = process.env.NODE_ENV !== 'test' && process.env.QA_TIMING !== 'off';
function qaTimingMark(label, startNs) {
  if (!QA_TIMING_ENABLED) return process.hrtime.bigint();
  const now = process.hrtime.bigint();
  const ms = Number(now - startNs) / 1e6;
  console.log(`[qa-timing] ${label}: ${ms.toFixed(0)}ms`);
  return now;
}

async function askQuestion({ user, courseId, question, source = 'api', conversationHistory = null }) {
  const t0 = process.hrtime.bigint();
  let tMark = t0;

  const runtimeSnapshot = assertQaRuntimeConfiguration();
  assertObjectId(courseId, 'course');

  const trimmedQuestion = String(question || '').trim();
  if (!trimmedQuestion) {
    throw new AppError('Question is required.', 400, 'VALIDATION_ERROR');
  }

  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }
  tMark = qaTimingMark('course-lookup', tMark);

  const faqCacheEnabled = isFaqCacheEnabled();

  // 平行：權限檢查、scoped videos、FAQ exact 查詢三者互不依賴；
  // access 失敗會 reject 並中斷後續（FAQ 命中結果也不會外洩）
  const [, scopedVideos, exactFaq] = await Promise.all([
    assertCanAccessCourse(user, course),
    collectScopedVideos(course),
    faqCacheEnabled
      ? findFaqByExactQuestion({ courseId: course._id, question: trimmedQuestion })
      : Promise.resolve(null),
  ]);
  tMark = qaTimingMark(`access+videos (${scopedVideos.videos?.length || 0} videos)`, tMark);

  const courseSummary = buildCourseBridgeSummary(course, scopedVideos);

  // FAQ 快取第一層：正規化文字完全相同 → 零 token，直接回快取答案
  if (exactFaq) {
    const cachedResult = await respondFromFaqCache({
      user,
      course,
      courseSummary,
      runtimeSnapshot,
      faq: exactFaq,
      matchType: 'exact',
      source,
      trimmedQuestion,
    });
    qaTimingMark('faq-cache-exact-hit TOTAL', t0);
    return cachedResult;
  }
  const segmentScope = await buildCourseSegmentScope(course, scopedVideos);
  tMark = qaTimingMark('build-segment-scope', tMark);

  const scopedSegments = await loadScopedSearchableSegments(segmentScope);
  tMark = qaTimingMark(`load-segments (${scopedSegments.length} segments)`, tMark);

  // 即使 segments 還在（孤兒片段），若 course 沒有任何 Video record 對應，
  // 視為「資料不一致 / 沒有可回答的影片」，避免 prompt 出現「未知影片」。
  if (!scopedVideos.videos.length) {
    const runtime = buildQaRuntime({
      runtimeSnapshot,
      courseSummary,
      searchableSegmentCount: scopedSegments.length,
      matchStatus: 'no_searchable_segments',
      searchDiagnostics: {
        searchBackendUsed: env.qaVectorSearchMode,
        scoringMode: 'unavailable',
        fallbacks: [],
      },
      answerResult: null,
    });

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: { source, question: trimmedQuestion, matchCount: 0, runtime },
    });

    const answer = '這門課目前沒有可回答的影片資料（影片可能已被刪除）。請聯絡老師或管理員確認課程內容。';

    await recordQuestion({
      userId: user.id,
      courseId: course._id,
      question: trimmedQuestion,
      answer,
      status: QUESTION_STATUSES.NO_MATCH,
      source,
      matches: [],
      runtime,
      sourceUsageLogId: usageLog?._id,
    });

    return { answer, matches: [], clip: null, runtime };
  }

  if (!scopedSegments.length) {
    const runtime = buildQaRuntime({
      runtimeSnapshot,
      courseSummary,
      searchableSegmentCount: 0,
      matchStatus: 'no_searchable_segments',
      searchDiagnostics: {
        searchBackendUsed: env.qaVectorSearchMode,
        scoringMode: 'unavailable',
        fallbacks: [],
      },
      answerResult: null,
    });

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source,
        question: trimmedQuestion,
        matchCount: 0,
        runtime,
      },
    });

    const answer = courseSummary.qaScopeOnly
      ? '這門課目前只有 bridge metadata，尚未有可搜尋的影片片段。請先補 searchable segments，再進行 QA 展示。'
      : '這門課目前還沒有可搜尋的影片片段，請先確認影片索引是否已完成。';

    await recordQuestion({
      userId: user.id,
      courseId: course._id,
      question: trimmedQuestion,
      answer,
      status: QUESTION_STATUSES.NO_MATCH,
      source,
      matches: [],
      runtime,
      sourceUsageLogId: usageLog?._id,
    });

    return {
      answer,
      matches: [],
      clip: null,
      runtime,
    };
  }

  const queryVector = await embedQuery(trimmedQuestion);
  tMark = qaTimingMark('embed', tMark);

  // FAQ 快取第二層：embedding 已算好，先跟課程 FAQ 比 cosine 相似度，
  // 命中即跳過向量搜尋與 LLM 生成（miss 時 embedding 直接沿用，無額外成本）
  if (faqCacheEnabled) {
    const semanticHit = await findFaqBySimilarEmbedding({ courseId: course._id, queryVector });
    tMark = qaTimingMark('faq-semantic-lookup', tMark);

    if (semanticHit) {
      const cachedResult = await respondFromFaqCache({
        user,
        course,
        courseSummary,
        runtimeSnapshot,
        faq: semanticHit.faq,
        matchType: 'semantic',
        similarity: semanticHit.similarity,
        source,
        trimmedQuestion,
      });
      qaTimingMark('faq-cache-semantic-hit TOTAL', t0);
      return cachedResult;
    }
  }

  const searchResult = env.qaVectorSearchMode === 'atlas'
    ? await searchSegmentsWithAtlas(segmentScope, queryVector)
    : await searchSegmentsInMemory(segmentScope, trimmedQuestion, queryVector, scopedSegments);
  tMark = qaTimingMark(`search (${env.qaVectorSearchMode})`, tMark);

  const matches = enrichMatchesWithVideoMetadata(searchResult.matches, scopedVideos);

  if (!matches.length) {
    const runtime = buildQaRuntime({
      runtimeSnapshot,
      courseSummary,
      searchableSegmentCount: scopedSegments.length,
      matchStatus: 'no_relevant_match',
      searchDiagnostics: searchResult.diagnostics,
      answerResult: null,
    });

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source,
        question: trimmedQuestion,
        matchCount: 0,
        runtime,
      },
    });

    await recordQuestion({
      userId: user.id,
      courseId: course._id,
      question: trimmedQuestion,
      answer: '',
      status: QUESTION_STATUSES.NO_MATCH,
      source,
      matches: [],
      runtime,
      sourceUsageLogId: usageLog?._id,
    });

    return {
      answer: '目前找不到足夠相關的影片片段，請換個問法或確認課程是否已完成索引。',
      matches: [],
      clip: null,
      runtime,
    };
  }

  // 平行：LLM 生成答案與快取 clip 查詢完全獨立
  const [answerResult, clip] = await Promise.all([
    generateAnswer(trimmedQuestion, matches, conversationHistory),
    findCachedClip(matches[0].segmentId),
  ]);
  tMark = qaTimingMark(`llm+clip (matches=${matches.length}, transcript chars≈${matches.reduce((s, m) => s + (m.transcript?.length || 0), 0)})`, tMark);
  const resultClip = clip || (matches[0]?.jumpUrl ? {
    segmentId: matches[0].segmentId,
    clipUrl: matches[0].jumpUrl,
    jumpUrl: matches[0].jumpUrl,
    keyPoints: [],
    hitCount: 0,
  } : null);
  const runtime = buildQaRuntime({
    runtimeSnapshot,
    courseSummary,
    searchableSegmentCount: scopedSegments.length,
    matchStatus: 'matched',
    searchDiagnostics: searchResult.diagnostics,
    answerResult,
  });
  runtime.faqCache = { hit: false, enabled: faqCacheEnabled };

  // CLIP_VIEW log 不依賴 ASK 的 _id，立刻 kick off 與 ASK 平行
  const clipLogPromise = resultClip
    ? recordUsage({
        userId: user.id,
        courseId: course._id,
        event: USAGE_LOG_EVENTS.CLIP_VIEW,
        metadata: { source, segmentId: resultClip.segmentId },
      })
    : Promise.resolve();

  // ASK log 必須先寫完，Question 需要它的 _id 作為 sourceUsageLogId
  const usageLog = await recordUsage({
    userId: user.id,
    courseId: course._id,
    event: USAGE_LOG_EVENTS.ASK,
    metadata: {
      source,
      question: trimmedQuestion,
      matchCount: matches.length,
      topSegmentId: matches[0].segmentId,
      runtime,
    },
  });

  // 只快取「乾淨」的回答：runtime 完全 ready（無任何 retrieval / answer fallback），
  // 且不帶對話歷史（帶歷史的回答可能依賴上下文，快取後對其他人不成立）
  const shouldSaveFaq = faqCacheEnabled
    && !runtime.degraded
    && !(Array.isArray(conversationHistory) && conversationHistory.length);

  // recordQuestion、clipLogPromise 與 FAQ 快取寫入平行收尾
  await Promise.all([
    recordQuestion({
      userId: user.id,
      courseId: course._id,
      question: trimmedQuestion,
      answer: answerResult.text,
      status: QUESTION_STATUSES.ANSWERED,
      source,
      matches,
      runtime,
      sourceUsageLogId: usageLog?._id,
    }),
    clipLogPromise,
    shouldSaveFaq
      ? saveFaqEntry({
          courseId: course._id,
          question: trimmedQuestion,
          answer: answerResult.text,
          matches,
          clip: resultClip,
          questionEmbedding: queryVector,
        })
      : Promise.resolve(),
  ]);
  tMark = qaTimingMark('writes (ASK + Question + CLIP_VIEW)', tMark);

  if (QA_TIMING_ENABLED) {
    const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`[qa-timing] TOTAL: ${totalMs.toFixed(0)}ms (source=${source})`);
  }

  return {
    answer: answerResult.text,
    matches,
    clip: resultClip,
    runtime,
  };
}

module.exports = {
  askQuestion,
};
