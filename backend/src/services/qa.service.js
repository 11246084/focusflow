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

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
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

  if (!questionWords.size || !transcriptWords.length) {
    return 0;
  }

  let matches = 0;
  for (const word of transcriptWords) {
    if (questionWords.has(word)) {
      matches += 1;
    }
  }

  return matches / Math.max(questionWords.size, transcriptWords.length);
}

function mapSegmentMatch(segment, score) {
  return {
    segmentId: segment.segmentId || segment.chunkId || segment.chunk_id || String(segment._id),
    videoId: segment.videoId || segment.video_id || null,
    startSec: segment.startSec,
    endSec: segment.endSec,
    transcript: segment.transcript,
    score: Number(score.toFixed(4)),
  };
}

async function searchSegmentsInMemory(courseId, question, queryVector) {
  const segments = await VideoSegment.find({
    $or: [{ courseId }, { courseId: String(courseId) }],
  });

  return segments
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

async function searchSegmentsWithAtlas(courseId, question, queryVector) {
  if (!Array.isArray(queryVector) || !queryVector.length) {
    return searchSegmentsInMemory(courseId, question, queryVector);
  }

  const results = await VideoSegment.aggregate([
    {
      $vectorSearch: {
        index: 'vector_index',
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(env.qaMatchLimit * 5, 10),
        limit: env.qaMatchLimit,
        filter: {
          $or: [{ courseId }, { courseId: String(courseId) }],
        },
      },
    },
    {
      $project: {
        _id: 1,
        segmentId: 1,
        chunkId: 1,
        chunk_id: 1,
        videoId: 1,
        video_id: 1,
        startSec: 1,
        endSec: 1,
        transcript: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);

  if (!results.length) {
    return searchSegmentsInMemory(courseId, question, queryVector);
  }

  return results.map((item) => mapSegmentMatch(item, item.score));
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

  const queryVector = await embedQuery(trimmedQuestion);
  const matches = env.qaVectorSearchMode === 'atlas'
    ? await searchSegmentsWithAtlas(course._id, trimmedQuestion, queryVector)
    : await searchSegmentsInMemory(course._id, trimmedQuestion, queryVector);

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
