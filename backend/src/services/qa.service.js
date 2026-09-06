const fs = require('node:fs');
const mongoose = require('mongoose');
const Course = require('../models/course.model');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentVideo = require('../models/videoSegmentVideo.model');
const Clip = require('../models/clip.model');
const AppError = require('../utils/appError');
const env = require('../config/env');
const logger = require('../utils/logger');
const { assertObjectId } = require('../utils/objectId');
const { assertCanAccessCourse } = require('./courseAccess.service');
const { embedQuery } = require('./queryEmbedding.service');
const { generateAnswer, isNoAnswerReply } = require('./answerGeneration.service');
const { recordUsage } = require('./usageLog.service');
const { assertQaQuotaAvailable } = require('./costControl.service');
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
  buildCourseVisualSegmentScope,
  buildSegmentLookupQuery,
  normalizeIdentifier,
  segmentMatchesScope,
  extractPipelineVisualVideoId,
} = require('./bridgeScope.service');
const {
  filterCandidatesByScope,
  logScopeEmpty,
} = require('./qaScopeMonitoring.service');
const {
  buildQaRuntimeSnapshot,
  assertQaRuntimeConfiguration,
} = require('./runtimeDiagnostics.service');
const { createParentSearchRepository } = require('./parentSearchAdapter.service');
const { createLeafRepository } = require('./childExpansion.service');
const { retrieveWithHierarchy } = require('./hierarchicalRetrieval.service');
const {
  evaluateHierarchicalRollout,
  executeHierarchicalRollout,
} = require('./hierarchicalRollout.service');
const {
  LEAF_CONTEXT_CANDIDATE_LIMIT,
  LEAF_CONTEXT_REQUIRED_LIMIT,
  LEAF_CONTEXT_REASONS,
  buildPlayableVideoIds,
  buildSkippedLeafContextDiagnostics,
  evaluateLeafContextEligibility,
  selectProductionLeafContext,
} = require('./leafContextSelection.service');

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
    chunkId: segment.chunkId,
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

function mapVisualSegmentMatch(segment, score) {
  return {
    modality: 'video',
    segmentId: segment.clip_id || String(segment._id || ''),
    videoId: segment.video_id || null,
    videoTitle: null,
    startSec: Number(segment.start_sec ?? 0),
    endSec: Number(segment.end_sec ?? segment.start_sec ?? 0),
    transcript: '',
    clipPath: segment.clip_path || null,
    score: Number(score.toFixed(4)),
  };
}

function formatTimestampLabel(seconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function buildTranscriptSnippet(text, limit = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1).trim()}…`;
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
    const externalVideoId = video.videoId || video.video_id ? String(video.videoId || video.video_id) : null;
    const metadata = {
      id,
      videoId: externalVideoId,
      title: getVideoPresentationTitle(video),
      sourceUrl: video.sourceUrl || null,
      youtubeVideoId: video.youtubeVideoId || null,
      videoUrl: video.videoUrl || video.sourceUrl || null,
      filePath: video.filePath || video.file_path || null,
    };

    for (const identifier of [id, externalVideoId]) {
      if (identifier) {
        lookup.set(identifier, metadata);
      }
    }

    for (const candidate of [
      video.fileName,
      video.file_name,
      video.filePath,
      video.file_path,
      video.sourceUrl,
      video.videoUrl,
      video.video_url,
      externalVideoId,
    ]) {
      const visualVideoId = extractPipelineVisualVideoId(candidate);
      if (visualVideoId) {
        lookup.set(visualVideoId, metadata);
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

function faqMatchKey(segmentId, videoId) {
  return `${String(segmentId)}\u0000${String(videoId)}`;
}

async function revalidateFaqMatches(faq, scope) {
  const matches = Array.isArray(faq?.matches) ? faq.matches : [];
  const normalizedMatches = matches.map((match) => ({
    segmentId: normalizeIdentifier(match?.segmentId),
    videoId: normalizeIdentifier(match?.videoId),
  }));
  const segmentIds = [...new Set(normalizedMatches.map((match) => match.segmentId).filter(Boolean))];
  let scopedSegments = [];

  if (segmentIds.length) {
    scopedSegments = await VideoSegment.find({
      $and: [
        buildSegmentLookupQuery(scope),
        {
          $or: [
            { segmentId: { $in: segmentIds } },
            { chunkId: { $in: segmentIds } },
          ],
        },
      ],
    }).lean();
  }

  const validPairs = new Set(
    scopedSegments
      .map((segment) => normalizeSegment(segment))
      .filter((segment) => segmentMatchesScope(segment, scope))
      .flatMap((segment) => {
        const ids = [segment.segmentId, segment.chunkId].filter(Boolean);
        return ids.map((segmentId) => faqMatchKey(segmentId, segment.videoId));
      }),
  );
  const droppedMatches = normalizedMatches.filter((match) => (
    !match.segmentId
    || !match.videoId
    || !scope.allowedVideoIds.has(match.videoId)
    || !validPairs.has(faqMatchKey(match.segmentId, match.videoId))
  ));

  return {
    valid: matches.length > 0 && droppedMatches.length === 0,
    droppedCount: droppedMatches.length,
    droppedVideoIds: [...new Set(droppedMatches.map((match) => match.videoId).filter(Boolean))],
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
  // .lean() 跳過 Mongoose hydration — 對含 3072-float embedding 的 segments 極關鍵：
  // 實測 51 segments hydration 8.8s，lean 後降到 ~1s（省 80%+）
  const segments = await VideoSegment.find(buildSegmentLookupQuery(scope)).lean();

  const normalizedSegments = segments.map((segment) => normalizeSegment(segment));
  const scopedSegments = filterCandidatesByScope(normalizedSegments, {
    scope,
    courseId: [...(scope.allowedCourseIds || [])][0] || null,
  });

  return scopedSegments
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

async function searchSegmentsWithAtlas(scope, queryVector, { limit = env.qaMatchLimit } = {}) {
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
          numCandidates: Math.max(limit * 5, 10),
          limit,
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

    const scoredResults = results
      .map((item) => ({
          score: item.score,
          segment: normalizeSegment(item),
        }))
      .filter((item) => item.score > 0);
    const scopedResults = filterCandidatesByScope(scoredResults, {
      scope,
      courseId: [...(scope.allowedCourseIds || [])][0] || null,
      getSegment: (item) => item.segment,
    });

    return {
      matches: scopedResults.map((item) => mapSegmentMatch(item.segment, item.score)),
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

async function searchVisualSegmentsWithAtlas(scope, queryVector) {
  if (!scope.allowedVideoIds?.size) {
    return {
      matches: [],
      diagnostics: {
        searchBackendUsed: 'atlas_video',
        scoringMode: 'unavailable',
        fallbacks: [buildRuntimeFallback({
          stage: 'retrieval',
          code: 'VIDEO_SEGMENTS_VIDEO_SCOPE_EMPTY',
          message: 'No course-scoped video_segments_video identifiers were available.',
        })],
      },
    };
  }

  if (!Array.isArray(queryVector) || !queryVector.length || !env.videoSegmentVideoVectorIndexName) {
    return {
      matches: [],
      diagnostics: {
        searchBackendUsed: 'atlas_video',
        scoringMode: 'unavailable',
        fallbacks: [buildRuntimeFallback({
          stage: 'retrieval',
          code: 'VIDEO_SEGMENTS_VIDEO_SEARCH_NOT_CONFIGURED',
          message: 'Multimodal video retrieval needs a query embedding and VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME.',
        })],
      },
    };
  }

  try {
    const results = await VideoSegmentVideo.aggregate([
      {
        $vectorSearch: {
          index: env.videoSegmentVideoVectorIndexName,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(env.qaMatchLimit * 5, 10),
          limit: env.qaMatchLimit,
          filter: { video_id: { $in: [...scope.allowedVideoIds] } },
        },
      },
      {
        $project: {
          _id: 1,
          video_id: 1,
          clip_id: 1,
          clip_path: 1,
          start_sec: 1,
          end_sec: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]);

    return {
      matches: results
        .map((item) => mapVisualSegmentMatch(item, item.score || 0))
        .filter((item) => item.score > 0),
      diagnostics: {
        searchBackendUsed: 'atlas_video',
        scoringMode: 'visual_vector',
        fallbacks: [],
      },
    };
  } catch (error) {
    return {
      matches: [],
      diagnostics: {
        searchBackendUsed: 'atlas_video',
        scoringMode: 'unavailable',
        fallbacks: [buildRuntimeFallback({
          stage: 'retrieval',
          code: 'VIDEO_SEGMENTS_VIDEO_ATLAS_NOT_READY',
          message: `video_segments_video Atlas vector search failed: ${error.message}`,
        })],
      },
    };
  }
}

function buildCitation(match, index) {
  return {
    citationId: `C${index + 1}`,
    modality: match.modality || 'text',
    // Keep the canonical Leaf identity explicit. Legacy matches that only have
    // segmentId remain supported, but segmentId must not be presented as a
    // canonical chunkId.
    chunkId: match.chunkId == null || String(match.chunkId).trim() === ''
      ? null
      : String(match.chunkId),
    segmentId: match.segmentId,
    videoId: match.videoId,
    videoTitle: match.videoTitle || null,
    sourceVideo: {
      videoId: match.videoId,
      title: match.videoTitle || null,
      sourceUrl: match.sourceUrl || null,
      videoUrl: match.videoUrl || match.sourceUrl || null,
      youtubeVideoId: match.youtubeVideoId || null,
    },
    timestamp: {
      startSec: match.startSec,
      endSec: match.endSec,
      label: formatTimestampLabel(match.startSec),
      jumpUrl: match.jumpUrl || null,
    },
    match: {
      status: 'matched',
      score: match.score,
      confidence: match.score >= 0.5 ? 'high' : match.score >= 0.2 ? 'medium' : 'low',
    },
    clipPath: match.clipPath || null,
    transcriptSnippet: buildTranscriptSnippet(match.transcript),
  };
}

function buildCitations(matches, {
  scopedVideos = null,
  requirePlayableSource = false,
  courseId = null,
  onDrop = null,
} = {}) {
  if (!requirePlayableSource) {
    return matches.map(buildCitation);
  }

  const videoLookup = buildVideoMetadataByIdentifier(scopedVideos);
  const playableMatches = [];

  for (const match of matches) {
    const video = videoLookup.get(String(match.videoId || ''));
    const hasYoutubeSource = Boolean(String(video?.youtubeVideoId || '').trim());
    const filePath = String(video?.filePath || '').trim();
    const hasLocalSource = Boolean(filePath && fs.existsSync(filePath));

    if (hasYoutubeSource || hasLocalSource) {
      playableMatches.push(match);
      continue;
    }

    logger.warn('qa.citation_dropped_no_playable_source', {
      courseId: courseId == null ? null : String(courseId),
      videoId: match.videoId == null ? null : String(match.videoId),
      chunkId: match.chunkId == null ? null : String(match.chunkId),
    });
    if (typeof onDrop === 'function') onDrop(match);
  }

  return playableMatches.map(buildCitation);
}

function buildLeafContextFallback(reason) {
  return buildRuntimeFallback({
    stage: 'retrieval',
    code: 'QA_LEAF_CONTEXT_SELECTION_FALLBACK',
    from: 'candidate30_same_video_adjacent_one_hop',
    to: 'baseline_top15',
    message: `Leaf context selection failed closed to the existing Top15 retrieval (${reason}).`,
  });
}

async function applyProductionLeafContextSelection({
  baselineResult,
  scope,
  queryVector,
  scopedVideos,
}) {
  // 先取得並保留既有 Top15，再以 default-off gate 嘗試新 selector。
  // 任何新查詢、direct read 或輸出 invariant 失敗，都只能回傳原 Top15。
  const baseline = baselineResult || { matches: [], diagnostics: {} };
  const eligibility = evaluateLeafContextEligibility({
    enabled: env.qaLeafAdjacentContextEnabled,
    vectorSearchMode: env.qaVectorSearchMode,
    contextLimit: env.qaMatchLimit,
    hierarchicalRetrievalEnabled: env.hierarchicalRetrievalEnabled,
  });
  const baselineDiagnostics = baseline.diagnostics || {};

  if (!eligibility.eligible) {
    const diagnostics = buildSkippedLeafContextDiagnostics(eligibility);
    return {
      ...baseline,
      diagnostics: {
        ...baselineDiagnostics,
        leafContextSelection: diagnostics,
        fallbacks: [
          ...(baselineDiagnostics.fallbacks || []),
          ...(eligibility.requested ? [buildLeafContextFallback(eligibility.reason)] : []),
        ],
      },
    };
  }

  if (!Array.isArray(baseline.matches)
      || baseline.matches.length !== LEAF_CONTEXT_REQUIRED_LIMIT) {
    return {
      ...baseline,
      diagnostics: {
        ...baselineDiagnostics,
        leafContextSelection: buildSkippedLeafContextDiagnostics({
          requested: true,
          eligible: true,
          reason: LEAF_CONTEXT_REASONS.INSUFFICIENT_CANDIDATE_POOL,
        }),
      },
    };
  }

  let candidateResult;
  try {
    candidateResult = await searchSegmentsWithAtlas(scope, queryVector, {
      limit: LEAF_CONTEXT_CANDIDATE_LIMIT,
    });
  } catch (error) {
    const diagnostics = buildSkippedLeafContextDiagnostics({
      requested: true,
      eligible: true,
      reason: LEAF_CONTEXT_REASONS.CANDIDATE_SEARCH_FAILED,
    });
    diagnostics.errorCode = String(error?.code || 'CANDIDATE_SEARCH_FAILED');
    return {
      ...baseline,
      diagnostics: {
        ...baselineDiagnostics,
        leafContextSelection: diagnostics,
        fallbacks: [
          ...(baselineDiagnostics.fallbacks || []),
          buildLeafContextFallback(diagnostics.reason),
        ],
      },
    };
  }

  let selection;
  try {
    selection = await selectProductionLeafContext({
      baselineMatches: baseline.matches,
      candidateMatches: candidateResult.matches,
      leafRepository: createLeafRepository(),
      scope,
      playableVideoIds: buildPlayableVideoIds(scopedVideos),
    });
  } catch (error) {
    const diagnostics = buildSkippedLeafContextDiagnostics({
      requested: true,
      eligible: true,
      reason: LEAF_CONTEXT_REASONS.SELECTOR_FAILED,
    });
    diagnostics.errorCode = String(error?.code || 'SELECTOR_FAILED');
    return {
      ...baseline,
      diagnostics: {
        ...baselineDiagnostics,
        leafContextSelection: diagnostics,
        fallbacks: [
          ...(baselineDiagnostics.fallbacks || []),
          buildLeafContextFallback(diagnostics.reason),
        ],
      },
    };
  }
  const failedClosed = selection.failedClosed === true;

  return {
    ...baseline,
    matches: failedClosed ? baseline.matches : selection.matches,
    diagnostics: {
      ...baselineDiagnostics,
      leafContextSelection: selection.diagnostics,
      fallbacks: [
        ...(baselineDiagnostics.fallbacks || []),
        ...(failedClosed ? [buildLeafContextFallback(selection.diagnostics.reason)] : []),
      ],
    },
  };
}

const FAQ_ANSWER_EVIDENCE_VERSION = 'supporting-evidence-v1';

function resolveSupportingMatches(matches, supportingEvidenceIds) {
  const sourceMatches = Array.isArray(matches) ? matches : [];
  if (!Array.isArray(supportingEvidenceIds)) return sourceMatches;

  const selectedIndexes = new Set();
  for (const evidenceId of supportingEvidenceIds) {
    const matched = /^S([1-9]\d*)$/.exec(String(evidenceId || ''));
    if (!matched) continue;
    const index = Number(matched[1]) - 1;
    if (index >= 0 && index < sourceMatches.length) selectedIndexes.add(index);
  }

  // 模型只負責指出使用哪些 opaque evidence ID；實際引用順序仍以後端
  // retrieval context 為準，避免模型任意重排或注入不存在的內部 ID。
  return sourceMatches.filter((_, index) => selectedIndexes.has(index));
}

function markFaqAnswerEvidence(matches) {
  return (Array.isArray(matches) ? matches : []).map((match) => ({
    ...match,
    _answerEvidenceVersion: FAQ_ANSWER_EVIDENCE_VERSION,
  }));
}

function hasCurrentFaqAnswerEvidence(faq) {
  const matches = Array.isArray(faq?.matches) ? faq.matches : [];
  return matches.length > 0
    && matches.every((match) => match?._answerEvidenceVersion === FAQ_ANSWER_EVIDENCE_VERSION);
}

function stripFaqAnswerEvidenceMarker(match) {
  if (!match || typeof match !== 'object') return match;
  const { _answerEvidenceVersion, ...publicMatch } = match;
  return publicMatch;
}

// Retrieval matches 只是候選與除錯資料。只有答案明確選用、且通過可播放
// 檢查的 evidence，才能在這個最終邊界升格為使用者可見 citation。
function buildUserFacingCitations({
  answer,
  matches,
  supportingEvidenceIds,
  scopedVideos = null,
  requirePlayableSource = false,
  courseId = null,
  onDrop = null,
}) {
  if (isNoAnswerReply(answer)) {
    return [];
  }

  return buildCitations(resolveSupportingMatches(matches, supportingEvidenceIds), {
    scopedVideos,
    requirePlayableSource,
    courseId,
    onDrop,
  });
}

function buildAnswerStatus(runtime, citations, { noAnswerReply = false } = {}) {
  if (noAnswerReply) {
    return {
      status: 'no_answer',
      isAnswerable: false,
      matchStatus: 'no_relevant_match',
      confidence: 'none',
      noAnswerReason: 'NO_RELEVANT_MATCH',
    };
  }

  if (runtime.matchStatus === 'matched') {
    return {
      status: 'answered',
      isAnswerable: true,
      matchStatus: runtime.matchStatus,
      confidence: citations[0]?.match?.confidence || 'low',
      noAnswerReason: null,
    };
  }

  const noAnswerReason = runtime.matchStatus === 'no_searchable_segments'
    ? 'NO_SEARCHABLE_SEGMENTS'
    : 'NO_RELEVANT_MATCH';

  return {
    status: 'no_answer',
    isAnswerable: false,
    matchStatus: runtime.matchStatus,
    confidence: 'none',
    noAnswerReason,
  };
}

function buildQaResponse({
  answer,
  matches,
  supportingEvidenceIds,
  clip,
  runtime,
  scopedVideos,
  courseId,
}) {
  const noAnswerReply = isNoAnswerReply(answer);
  const droppedCitations = [];
  const citations = buildUserFacingCitations({
    answer,
    matches,
    supportingEvidenceIds,
    scopedVideos,
    requirePlayableSource: true,
    courseId,
    onDrop: (match) => droppedCitations.push(match),
  });

  if (droppedCitations.length) {
    runtime.citationFilter = {
      errorCode: 'QA_CITATION_DROPPED',
      droppedCount: droppedCitations.length,
    };
  }

  return {
    answer,
    matches,
    citations,
    answerStatus: buildAnswerStatus(runtime, citations, { noAnswerReply }),
    clip: noAnswerReply ? null : clip,
    runtime,
  };
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
  matchModality = 'text',
  visualSearchDiagnostics = null,
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
    matchModality,
    resultCategory,
    course: buildCourseRuntimeSummary(courseSummary),
    answerProviderUsed: answerResult?.provider || null,
    visualSearch: visualSearchDiagnostics,
    fallbacks,
    ...(searchDiagnostics?.hierarchical
      ? { hierarchicalRetrieval: searchDiagnostics.hierarchical }
      : {}),
    ...(searchDiagnostics?.rollout
      ? { hierarchicalRollout: searchDiagnostics.rollout }
      : {}),
    ...(searchDiagnostics?.leafContextSelection
      ? { leafContextSelection: searchDiagnostics.leafContextSelection }
      : {}),
  };
}

function buildVisualOnlyAnswer(matches) {
  const [topMatch] = matches;

  if (!topMatch) {
    return '目前找不到可對應的影像片段。';
  }

  const title = topMatch.videoTitle || topMatch.videoId || '目標影片';
  const timeLabel = `${formatTimestampLabel(topMatch.startSec)}-${formatTimestampLabel(topMatch.endSec)}`;
  return `我找到可能相關的影像片段：${title} ${timeLabel}。這些片段目前只有影像 embedding，沒有可引用的 transcript，因此請以 citation 位置檢視畫面，不應把它當成完整文字答案。`;
}

// FAQ 快取命中：直接以快取的答案/matches/clip 回應，
// 只補記 usage log 與 question 紀錄，維持統計與歷史行為一致。
async function respondFromFaqCache({
  user,
  course,
  courseSummary,
  scopedVideos,
  runtimeSnapshot,
  faq,
  matchType,
  similarity = null,
  source,
  trimmedQuestion,
}) {
  const hitFaq = await recordFaqHit(faq._id) || faq;
  const noAnswerReply = isNoAnswerReply(faq.answer);
  const matches = enrichMatchesWithVideoMetadata(
    (Array.isArray(faq.matches) ? faq.matches : []).map(stripFaqAnswerEvidenceMarker),
    scopedVideos,
  );
  const supportingEvidenceIds = matches.map((_, index) => `S${index + 1}`);

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
    status: noAnswerReply ? QUESTION_STATUSES.NO_MATCH : QUESTION_STATUSES.ANSWERED,
    source,
    matches,
    runtime,
    sourceUsageLogId: usageLog?._id,
  });

  return buildQaResponse({
    answer: faq.answer,
    matches,
    supportingEvidenceIds,
    clip: faq.clip || null,
    runtime,
    scopedVideos,
    courseId: course._id,
  });
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

async function askQuestion({
  user, courseId, question, retrievalQuestion = null, source = 'api',
  conversationHistory = null, conversationId = null, contextualization = null,
}) {
  const t0 = process.hrtime.bigint();
  const totalStartedAt = Date.now();
  const stageLatency = {};
  let tMark = t0;

  const runtimeSnapshot = assertQaRuntimeConfiguration();
  assertObjectId(courseId, 'course');

  const trimmedQuestion = String(question || '').trim();
  if (!trimmedQuestion) {
    throw new AppError('Question is required.', 400, 'VALIDATION_ERROR');
  }
  const standaloneQuestion = String(retrievalQuestion || trimmedQuestion).trim();

  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }
  tMark = qaTimingMark('course-lookup', tMark);

  const faqCacheEnabled = isFaqCacheEnabled()
    && !(Array.isArray(conversationHistory) && conversationHistory.length);

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
  const segmentScope = await buildCourseSegmentScope(course, scopedVideos);
  if (!segmentScope.allowedVideoIds.size) {
    logScopeEmpty({
      courseId: course._id,
      userId: user?.id || user?._id || null,
      searchMode: runtimeSnapshot.vectorSearchMode,
      reason: 'canonical_video_scope_empty',
    });
  }
  const visualSegmentScope = buildCourseVisualSegmentScope(scopedVideos);
  const invalidFaqIds = new Set();
  let faqRevalidationFailure = null;
  let faqEvidenceBypass = null;

  async function faqMatchesCurrentScope(faq) {
    const faqId = String(faq?._id || '');
    if (invalidFaqIds.has(faqId)) return false;

    const validation = await revalidateFaqMatches(faq, segmentScope);
    if (validation.valid) return true;

    invalidFaqIds.add(faqId);
    faqRevalidationFailure = {
      errorCode: 'QA_FAQ_SCOPE_REVALIDATION_FAILED',
      faqId,
      droppedCount: validation.droppedCount,
      droppedVideoIds: validation.droppedVideoIds,
    };
    logger.warn('qa.faq_scope_revalidation_failed', {
      courseId: String(course._id),
      faqId,
      droppedVideoIds: validation.droppedVideoIds,
      droppedCount: validation.droppedCount,
    });
    return false;
  }

  function applyFaqCacheMissRuntime(runtime) {
    runtime.faqCache = {
      hit: false,
      enabled: faqCacheEnabled,
      ...(faqRevalidationFailure ? { revalidationFailure: faqRevalidationFailure } : {}),
      ...(faqEvidenceBypass ? { evidenceBypass: faqEvidenceBypass } : {}),
    };
    return runtime;
  }

  function faqHasCurrentAnswerEvidence(faq) {
    if (hasCurrentFaqAnswerEvidence(faq)) return true;

    // 舊 FAQ 沒有「答案實際使用哪些 evidence」的 provenance，不能把歷史
    // retrieval matches 全部當成 citation；略過一次並由新版流程重新產生。
    faqEvidenceBypass = {
      errorCode: 'QA_FAQ_ANSWER_EVIDENCE_UNAVAILABLE',
      faqId: String(faq?._id || ''),
    };
    return false;
  }

  // FAQ 快取第一層：正規化文字完全相同 → 零 token，直接回快取答案
  if (exactFaq
      && await faqMatchesCurrentScope(exactFaq)
      && faqHasCurrentAnswerEvidence(exactFaq)) {
    const cachedResult = await respondFromFaqCache({
      user,
      course,
      courseSummary,
      scopedVideos,
      runtimeSnapshot,
      faq: exactFaq,
      matchType: 'exact',
      source,
      trimmedQuestion,
    });
    qaTimingMark('faq-cache-exact-hit TOTAL', t0);
    return cachedResult;
  }

  const costControl = await assertQaQuotaAvailable({ userId: user.id });
  tMark = qaTimingMark('build-segment-scope', tMark);

  // 投機性啟動：片段載入與 query embedding 互不依賴，先讓 DB 查詢跑起來，
  // 之後第二層 FAQ 快取命中時直接 return，不 await 這個 promise，
  // 讓載入耗時不計入回應延遲（原本順序會白等一次完整載入）。
  const scopedSegmentsPromise = loadScopedSearchableSegments(segmentScope);
  // 命中提早 return 時沒人 await 這個 promise，補 no-op catch 避免 unhandled rejection；
  // miss 路徑仍 await 原 promise，載入失敗照樣往外拋。
  scopedSegmentsPromise.catch(() => {});

  const embeddingStartedAt = Date.now();
  const queryVector = await embedQuery(standaloneQuestion);
  stageLatency.embeddingLatencyMs = Date.now() - embeddingStartedAt;
  tMark = qaTimingMark('embed', tMark);

  // FAQ 快取第二層：embedding 已算好，先跟課程 FAQ 比 cosine 相似度，
  // 命中即跳過向量搜尋與 LLM 生成（miss 時 embedding 直接沿用，無額外成本）
  if (faqCacheEnabled) {
    const semanticHit = await findFaqBySimilarEmbedding({ courseId: course._id, queryVector });
    tMark = qaTimingMark('faq-semantic-lookup', tMark);

    if (semanticHit
        && await faqMatchesCurrentScope(semanticHit.faq)
        && faqHasCurrentAnswerEvidence(semanticHit.faq)) {
      const cachedResult = await respondFromFaqCache({
        user,
        course,
        courseSummary,
        scopedVideos,
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

  const scopedSegments = await scopedSegmentsPromise;
  tMark = qaTimingMark(`load-segments (${scopedSegments.length} segments)`, tMark);

  // 即使 segments 還在（孤兒片段），若 course 沒有任何 Video record 對應，
  // 視為「資料不一致 / 沒有可回答的影片」，避免 prompt 出現「未知影片」。
  if (!scopedVideos.videos.length) {
    const runtime = applyFaqCacheMissRuntime(buildQaRuntime({
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
    }));

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: { source, question: trimmedQuestion, matchCount: 0, runtime, costControl },
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

    return buildQaResponse({
      answer,
      matches: [],
      clip: null,
      runtime,
      scopedVideos,
      courseId: course._id,
    });
  }

  if (!scopedSegments.length && !visualSegmentScope.allowedVideoIds.size) {
    const runtime = applyFaqCacheMissRuntime(buildQaRuntime({
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
    }));

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source,
        question: trimmedQuestion,
        matchCount: 0,
        runtime,
        costControl,
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

    return buildQaResponse({
      answer,
      matches: [],
      clip: null,
      runtime,
      scopedVideos,
      courseId: course._id,
    });
  }

  const baselineLeafSearch = async () => (scopedSegments.length
    ? env.qaVectorSearchMode === 'atlas'
      ? searchSegmentsWithAtlas(segmentScope, queryVector)
      : searchSegmentsInMemory(segmentScope, standaloneQuestion, queryVector, scopedSegments)
    : {
        matches: [],
        diagnostics: {
          searchBackendUsed: env.qaVectorSearchMode,
          scoringMode: 'unavailable',
          fallbacks: [],
        },
      });
  const leafSearch = async () => {
    const baselineResult = await baselineLeafSearch();
    return applyProductionLeafContextSelection({
      baselineResult,
      scope: segmentScope,
      queryVector,
      scopedVideos,
    });
  };
  const rolloutDecision = evaluateHierarchicalRollout({
    globalEnabled: env.hierarchicalRetrievalEnabled,
    rolloutMode: env.hierarchicalRetrievalRolloutMode,
    rolloutModeValid: env.hierarchicalRetrievalRolloutModeValid,
    userId: user.id,
    courseId: String(course._id),
    allowedVideoIds: segmentScope.allowedVideoIds,
    allowedCourseIds: env.hierarchicalRetrievalAllowedCourseIds,
    rolloutVideoIds: env.hierarchicalRetrievalAllowedVideoIds,
    rolloutUserIds: env.hierarchicalRetrievalAllowedUserIds,
    allowlistsValid: env.hierarchicalRetrievalAllowlistsValid,
    embeddingContractStatus: runtimeSnapshot.hierarchicalRolloutContractStatus,
    activeDataStatus: runtimeSnapshot.hierarchicalActiveDataCompatible
      ? 'verified'
      : 'not_verified',
  });
  const hierarchicalSearch = ({ shadow = false } = {}) => retrieveWithHierarchy({
    enabled: true,
    // Shadow must never invoke a second Leaf search or affect the foreground response.
    fallbackToLeaf: shadow ? false : env.hierarchicalRetrievalFallbackToLeaf,
    parentRepositoryFactory: createParentSearchRepository,
    leafRepositoryFactory: createLeafRepository,
    leafSearch,
    queryEmbedding: queryVector,
    courseId: String(course._id),
    allowedVideoIds: segmentScope.allowedVideoIds,
    restrictedVideoIds: rolloutDecision.authorizedSupportedVideoIds,
    scope: segmentScope,
    parentLimit: env.hierarchicalParentLimit,
    childExpansionLimit: env.hierarchicalChildExpansionLimit,
    contextMaxLeaves: env.hierarchicalContextMaxLeaves,
    contextMaxCharacters: env.hierarchicalContextMaxCharacters,
    parentTimeoutMs: env.hierarchicalParentTimeoutMs,
    expectedContract: runtimeSnapshot.queryEmbeddingContract,
  });
  const retrievalStartedAt = Date.now();
  const searchResult = await executeHierarchicalRollout({
    decision: rolloutDecision,
    leafSearch,
    hierarchicalSearch,
  });
  tMark = qaTimingMark(`search (${env.qaVectorSearchMode})`, tMark);

  const matches = enrichMatchesWithVideoMetadata(searchResult.matches, scopedVideos);

  if (!matches.length) {
    const visualSearchResult = await searchVisualSegmentsWithAtlas(visualSegmentScope, queryVector);
    const visualMatches = enrichMatchesWithVideoMetadata(visualSearchResult.matches, scopedVideos);

    if (visualMatches.length) {
      const runtime = applyFaqCacheMissRuntime(buildQaRuntime({
        runtimeSnapshot,
        courseSummary,
        searchableSegmentCount: scopedSegments.length,
        matchStatus: 'matched',
        matchModality: 'video',
        searchDiagnostics: visualSearchResult.diagnostics,
        visualSearchDiagnostics: visualSearchResult.diagnostics,
        answerResult: { provider: 'template' },
      }));

      const answer = buildVisualOnlyAnswer(visualMatches);
      const usageLog = await recordUsage({
        userId: user.id,
        courseId: course._id,
        event: USAGE_LOG_EVENTS.ASK,
        metadata: {
          source,
          question: trimmedQuestion,
          matchCount: visualMatches.length,
          topSegmentId: visualMatches[0].segmentId,
          runtime,
          costControl,
        },
      });

      await recordQuestion({
        userId: user.id,
        courseId: course._id,
        question: trimmedQuestion,
        answer,
        status: QUESTION_STATUSES.ANSWERED,
        source,
        matches: visualMatches,
        runtime,
        sourceUsageLogId: usageLog?._id,
      });

      return buildQaResponse({
        answer,
        matches: visualMatches,
        // visual-only 回答只描述第一筆影像片段，因此只讓 S1 升格為 citation。
        supportingEvidenceIds: ['S1'],
        clip: null,
        runtime,
        scopedVideos,
        courseId: course._id,
      });
    }

    const runtime = applyFaqCacheMissRuntime(buildQaRuntime({
      runtimeSnapshot,
      courseSummary,
      searchableSegmentCount: scopedSegments.length,
      matchStatus: 'no_relevant_match',
      searchDiagnostics: searchResult.diagnostics,
      visualSearchDiagnostics: visualSearchResult.diagnostics,
      answerResult: null,
    }));

    const usageLog = await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source,
        question: trimmedQuestion,
        matchCount: 0,
        runtime,
        costControl,
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

    return buildQaResponse({
      answer: '目前找不到足夠相關的影片片段，請換個問法或確認課程是否已完成索引。',
      matches: [],
      clip: null,
      runtime,
      scopedVideos,
      courseId: course._id,
    });
  }

  // Citation/clip 必須以答案實際採用的 evidence 為準，不能再固定取 retrieval Top1。
  const generationStartedAt = Date.now();
  const answerResult = await generateAnswer(trimmedQuestion, matches, conversationHistory);
  stageLatency.generationLatencyMs = Date.now() - generationStartedAt;
  const noAnswerReply = isNoAnswerReply(answerResult.text);
  const supportingMatches = noAnswerReply
    ? []
    : resolveSupportingMatches(matches, answerResult.supportingEvidenceIds);
  const primaryEvidenceMatch = supportingMatches[0] || null;
  const clip = primaryEvidenceMatch
    ? await findCachedClip(primaryEvidenceMatch.segmentId)
    : null;
  tMark = qaTimingMark(`llm+clip (matches=${matches.length}, transcript chars≈${matches.reduce((s, m) => s + (m.transcript?.length || 0), 0)})`, tMark);
  const resultClip = clip || (primaryEvidenceMatch?.jumpUrl ? {
    segmentId: primaryEvidenceMatch.segmentId,
    clipUrl: primaryEvidenceMatch.jumpUrl,
    jumpUrl: primaryEvidenceMatch.jumpUrl,
    keyPoints: [],
    hitCount: 0,
  } : null);
  const runtime = applyFaqCacheMissRuntime(buildQaRuntime({
    runtimeSnapshot,
    courseSummary,
    searchableSegmentCount: scopedSegments.length,
    matchStatus: 'matched',
    searchDiagnostics: searchResult.diagnostics,
    answerResult,
  }));
  stageLatency.retrievalLatencyMs = Date.now() - retrievalStartedAt;
  if (conversationId) {
    runtime.conversation = {
      conversationId: String(conversationId),
      originalQuestion: trimmedQuestion,
      standaloneQuestion,
      requiresContext: Boolean(contextualization?.requiresContext),
    };
  }
  runtime.latency = { ...stageLatency, totalLatencyMs: Date.now() - totalStartedAt };
  // CLIP_VIEW log 不依賴 ASK 的 _id，立刻 kick off 與 ASK 平行
  const clipLogPromise = resultClip && !noAnswerReply
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
      costControl,
    },
  });

  // 只快取「乾淨」的回答：runtime 完全 ready（無任何 retrieval / answer fallback）、
  // 不帶對話歷史（帶歷史的回答可能依賴上下文，快取後對其他人不成立），
  // 且不是「答不出來」的罐頭回覆 —— 那種回答不算 fallback（degraded=false），
  // 但快取它只會讓「資料補齊 / 設定調好」之後仍永久回舊答案。
  const shouldSaveFaq = faqCacheEnabled
    && !runtime.degraded
    && !isNoAnswerReply(answerResult.text)
    && !(Array.isArray(conversationHistory) && conversationHistory.length);

  // recordQuestion、clipLogPromise 與 FAQ 快取寫入平行收尾
  await Promise.all([
    recordQuestion({
      userId: user.id,
      courseId: course._id,
      question: trimmedQuestion,
      answer: answerResult.text,
      status: noAnswerReply ? QUESTION_STATUSES.NO_MATCH : QUESTION_STATUSES.ANSWERED,
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
          matches: markFaqAnswerEvidence(supportingMatches),
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

  return buildQaResponse({
    answer: answerResult.text,
    matches,
    supportingEvidenceIds: answerResult.supportingEvidenceIds,
    clip: resultClip,
    runtime,
    scopedVideos,
    courseId: course._id,
  });
}

module.exports = {
  askQuestion,
  buildAnswerStatus,
  buildCitations,
  buildUserFacingCitations,
  resolveSupportingMatches,
};
