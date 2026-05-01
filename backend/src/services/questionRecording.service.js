const Question = require('../models/question.model');
const {
  QUESTION_SOURCES,
  QUESTION_SOURCE_VALUES,
  QUESTION_STATUSES,
  QUESTION_STATUS_VALUES,
} = require('../constants/enums');

function normalizeSource(source) {
  return QUESTION_SOURCE_VALUES.includes(source) ? source : QUESTION_SOURCES.API;
}

function normalizeStatus(status) {
  return QUESTION_STATUS_VALUES.includes(status) ? status : QUESTION_STATUSES.ANSWERED;
}

function toQuestionMatch(match) {
  return {
    segmentId: match.segmentId || null,
    videoId: match.videoId || null,
    videoTitle: match.videoTitle || null,
    startSec: match.startSec ?? null,
    endSec: match.endSec ?? null,
    score: typeof match.score === 'number' ? match.score : null,
  };
}

async function recordQuestion({
  studentId,
  courseId,
  question,
  answer = '',
  status = QUESTION_STATUSES.ANSWERED,
  source = QUESTION_SOURCES.API,
  matches = [],
  runtime = {},
}) {
  try {
    await Question.create({
      studentId,
      courseId,
      question,
      answer,
      status: normalizeStatus(status),
      source: normalizeSource(source),
      matchCount: matches.length,
      topSegmentId: matches[0]?.segmentId || null,
      matches: matches.map(toQuestionMatch),
      runtime,
      askedAt: new Date(),
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to record question.', error);
    }
  }
}

module.exports = {
  recordQuestion,
};
