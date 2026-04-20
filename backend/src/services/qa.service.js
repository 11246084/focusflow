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
const { USAGE_LOG_EVENTS } = require('../constants/enums');
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
    startSec: segment.startSec,
    endSec: segment.endSec,
    transcript: segment.transcript,
    score: Number(score.toFixed(4)),
  };
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
  const segments = await VideoSegment.find(buildSegmentLookupQuery(scope));

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

async function askQuestion({ user, courseId, question, source = 'api', conversationHistory = null }) {
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

  await assertCanAccessCourse(user, course);
  const scopedVideos = await collectScopedVideos(course);
  const courseSummary = buildCourseBridgeSummary(course, scopedVideos);
  const segmentScope = await buildCourseSegmentScope(course, scopedVideos);
  const scopedSegments = await loadScopedSearchableSegments(segmentScope);

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

    await recordUsage({
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

    return {
      answer,
      matches: [],
      clip: null,
      runtime,
    };
  }

  const queryVector = await embedQuery(trimmedQuestion);
  const searchResult = env.qaVectorSearchMode === 'atlas'
    ? await searchSegmentsWithAtlas(segmentScope, queryVector)
    : await searchSegmentsInMemory(segmentScope, trimmedQuestion, queryVector, scopedSegments);
  const matches = searchResult.matches;

  if (!matches.length) {
    const runtime = buildQaRuntime({
      runtimeSnapshot,
      courseSummary,
      searchableSegmentCount: scopedSegments.length,
      matchStatus: 'no_relevant_match',
      searchDiagnostics: searchResult.diagnostics,
      answerResult: null,
    });

    await recordUsage({
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

    return {
      answer: '目前找不到足夠相關的影片片段，請換個問法或確認課程是否已完成索引。',
      matches: [],
      clip: null,
      runtime,
    };
  }

  const answerResult = await generateAnswer(trimmedQuestion, matches, conversationHistory);
  const clip = await findCachedClip(matches[0].segmentId);
  const runtime = buildQaRuntime({
    runtimeSnapshot,
    courseSummary,
    searchableSegmentCount: scopedSegments.length,
    matchStatus: 'matched',
    searchDiagnostics: searchResult.diagnostics,
    answerResult,
  });

  await recordUsage({
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

  if (clip) {
    await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.CLIP_VIEW,
      metadata: {
        source,
        segmentId: clip.segmentId,
      },
    });
  }

  return {
    answer: answerResult.text,
    matches,
    clip,
    runtime,
  };
}

module.exports = {
  askQuestion,
};
