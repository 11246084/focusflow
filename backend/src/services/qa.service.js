const Course = require('../models/course.model');
const Video = require('../models/video.model');
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

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function normalizeIdentifier(...values) {
  const normalizedValue = pickFirstDefined(...values);

  if (normalizedValue == null || normalizedValue === '') {
    return null;
  }

  return String(normalizedValue);
}

function normalizeNumber(...values) {
  const normalizedValue = pickFirstDefined(...values);

  if (normalizedValue == null || normalizedValue === '') {
    return null;
  }

  const nextValue = Number(normalizedValue);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function normalizeTranscript(...values) {
  const normalizedValue = pickFirstDefined(...values, '');
  return String(normalizedValue).trim();
}

function normalizeSegment(segment) {
  return {
    segmentId: normalizeIdentifier(
      segment.segmentId,
      segment.segment_id,
      segment.chunkId,
      segment.chunk_id,
      segment._id,
    ),
    videoId: normalizeIdentifier(segment.videoId, segment.video_id),
    courseId: normalizeIdentifier(segment.courseId),
    startSec: normalizeNumber(segment.startSec, segment.start_sec),
    endSec: normalizeNumber(segment.endSec, segment.end_sec),
    transcript: normalizeTranscript(segment.transcript, segment.text, segment.original_text),
    embedding: Array.isArray(segment.embedding) ? segment.embedding : [],
  };
}

function addIdentifier(targetSet, value) {
  const normalizedValue = normalizeIdentifier(value);

  if (normalizedValue) {
    targetSet.add(normalizedValue);
  }
}

function addVideoIdentifiers(targetSet, video) {
  if (!video) {
    return;
  }

  addIdentifier(targetSet, video._id);
  addIdentifier(targetSet, video.id);
  addIdentifier(targetSet, video.videoId);
  addIdentifier(targetSet, video.video_id);
}

async function collectScopedVideos(course) {
  const videosById = new Map();
  const courseVideoRefs = (course.videoIds || [])
    .map((videoId) => normalizeIdentifier(videoId))
    .filter(Boolean);

  const addVideo = (video) => {
    if (!video) {
      return;
    }

    const videoKey = normalizeIdentifier(video._id, video.id, video.videoId, video.video_id);

    if (!videoKey || videosById.has(videoKey)) {
      return;
    }

    videosById.set(videoKey, video);
  };

  const [courseVideos, referencedVideos] = await Promise.all([
    Video.find({ courseId: course._id }),
    courseVideoRefs.length ? Video.find({ _id: { $in: courseVideoRefs } }) : [],
  ]);

  for (const video of courseVideos) {
    addVideo(video);
  }

  for (const video of referencedVideos) {
    addVideo(video);
  }

  return {
    courseVideoRefs,
    videos: [...videosById.values()],
  };
}

async function buildCourseSegmentScope(course) {
  const allowedCourseIds = new Set([String(course._id)]);
  const allowedVideoIds = new Set();
  const { courseVideoRefs, videos } = await collectScopedVideos(course);

  for (const video of videos) {
    addVideoIdentifiers(allowedVideoIds, video);
  }

  for (const videoId of courseVideoRefs) {
    addIdentifier(allowedVideoIds, videoId);
  }

  return {
    allowedCourseIds,
    allowedVideoIds,
  };
}

function buildSegmentLookupQuery(scope) {
  const conditions = [];

  for (const courseId of scope.allowedCourseIds) {
    conditions.push({ courseId });
  }

  if (scope.allowedVideoIds.size) {
    const allowedVideoIds = [...scope.allowedVideoIds];
    conditions.push({ videoId: { $in: allowedVideoIds } });
    conditions.push({ video_id: { $in: allowedVideoIds } });
  }

  if (!conditions.length) {
    return {};
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return { $or: conditions };
}

function segmentMatchesScope(segment, scope) {
  if (segment.courseId) {
    return scope.allowedCourseIds.has(segment.courseId);
  }

  if (!segment.videoId) {
    return false;
  }

  return scope.allowedVideoIds.has(segment.videoId);
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

function rankSegments(segments, question, queryVector, scope) {
  return segments
    .map((segment) => normalizeSegment(segment))
    .filter((segment) => segmentMatchesScope(segment, scope))
    .map((segment) => {
      const cosine = computeCosineSimilarity(queryVector, segment.embedding);
      const score = cosine ?? computeLexicalScore(question, segment.transcript);

      return {
        segment,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, env.qaMatchLimit)
    .map((item) => mapSegmentMatch(item.segment, item.score));
}

async function searchSegmentsInMemory(scope, question, queryVector) {
  const segments = await VideoSegment.find(buildSegmentLookupQuery(scope));
  return rankSegments(segments, question, queryVector, scope);
}

function buildAtlasSegmentFilter(scope) {
  return buildSegmentLookupQuery(scope);
}

async function searchSegmentsWithAtlas(scope, question, queryVector) {
  if (!Array.isArray(queryVector) || !queryVector.length) {
    return searchSegmentsInMemory(scope, question, queryVector);
  }

  try {
    const results = await VideoSegment.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(env.qaMatchLimit * 5, 10),
          limit: env.qaMatchLimit,
          filter: buildAtlasSegmentFilter(scope),
        },
      },
      {
        $project: {
          _id: 1,
          courseId: 1,
          segmentId: 1,
          segment_id: 1,
          chunkId: 1,
          chunk_id: 1,
          videoId: 1,
          video_id: 1,
          startSec: 1,
          start_sec: 1,
          endSec: 1,
          end_sec: 1,
          transcript: 1,
          text: 1,
          original_text: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]);

    const matches = results
      .map((item) => ({
        score: item.score,
        segment: normalizeSegment(item),
      }))
      .filter((item) => item.score > 0)
      .filter((item) => segmentMatchesScope(item.segment, scope))
      .map((item) => mapSegmentMatch(item.segment, item.score));

    if (matches.length) {
      return matches;
    }
  } catch (error) {
    return searchSegmentsInMemory(scope, question, queryVector);
  }

  return searchSegmentsInMemory(scope, question, queryVector);
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

async function askQuestion({ user, courseId, question, source = 'api' }) {
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
  const segmentScope = await buildCourseSegmentScope(course);

  const queryVector = await embedQuery(trimmedQuestion);
  const matches = env.qaVectorSearchMode === 'atlas'
    ? await searchSegmentsWithAtlas(segmentScope, trimmedQuestion, queryVector)
    : await searchSegmentsInMemory(segmentScope, trimmedQuestion, queryVector);

  if (!matches.length) {
    await recordUsage({
      userId: user.id,
      courseId: course._id,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source,
        question: trimmedQuestion,
        matchCount: 0,
      },
    });

    return {
      answer: '目前找不到足夠相關的影片片段，請換個問法或確認課程是否已完成索引。',
      matches: [],
      clip: null,
    };
  }

  const answer = await generateAnswer(trimmedQuestion, matches);
  const clip = await findCachedClip(matches[0].segmentId);

  await recordUsage({
    userId: user.id,
    courseId: course._id,
    event: USAGE_LOG_EVENTS.ASK,
    metadata: {
      source,
      question: trimmedQuestion,
      matchCount: matches.length,
      topSegmentId: matches[0].segmentId,
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
    answer,
    matches,
    clip,
  };
}

module.exports = {
  askQuestion,
};
