const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const UsageLog = require('../models/usageLog.model');
const Question = require('../models/question.model');
const {
  QUESTION_SOURCES,
  QUESTION_SOURCE_VALUES,
  QUESTION_STATUSES,
  USAGE_LOG_EVENTS,
} = require('../constants/enums');

function normalizeSource(source) {
  return QUESTION_SOURCE_VALUES.includes(source) ? source : QUESTION_SOURCES.API;
}

function inferQuestionStatus(runtime) {
  return runtime?.matchStatus === 'matched'
    ? QUESTION_STATUSES.ANSWERED
    : QUESTION_STATUSES.NO_MATCH;
}

function buildQuestionFromAskLog(log) {
  const metadata = log.metadata || {};
  const question = String(metadata.question || '').trim();

  if (!question || !log.courseId) {
    return null;
  }

  return {
    userId: log.userId,
    courseId: log.courseId,
    question,
    answer: String(metadata.answer || ''),
    status: inferQuestionStatus(metadata.runtime),
    source: normalizeSource(metadata.source),
    matchCount: Number(metadata.matchCount || 0),
    topSegmentId: metadata.topSegmentId || null,
    matches: [],
    runtime: metadata.runtime || {},
    sourceUsageLogId: log._id,
    askedAt: log.timestamp || log.createdAt || new Date(),
  };
}

async function main() {
  const write = process.argv.includes('--write');

  await connectDatabase();

  const askLogs = await UsageLog.find({
    event: USAGE_LOG_EVENTS.ASK,
    'metadata.question': { $exists: true, $ne: '' },
  }).lean();
  const existing = await Question.find({
    sourceUsageLogId: { $in: askLogs.map((log) => log._id) },
  }).select('sourceUsageLogId').lean();
  const existingIds = new Set(existing.map((item) => String(item.sourceUsageLogId)));
  const candidates = askLogs
    .filter((log) => !existingIds.has(String(log._id)))
    .map(buildQuestionFromAskLog)
    .filter(Boolean);

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    askLogs: askLogs.length,
    existingQuestions: existing.length,
    candidates: candidates.length,
  }, null, 2));

  if (!write || !candidates.length) {
    if (!write) {
      console.log('No writes performed. Re-run with --write to insert missing question records.');
    }
    return;
  }

  const result = await Question.insertMany(candidates, { ordered: false });
  console.log(JSON.stringify({ inserted: result.length }, null, 2));
}

main()
  .catch((error) => {
    console.error('backfillQuestionsFromUsageLogs failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
