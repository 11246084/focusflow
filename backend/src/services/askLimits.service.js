const env = require('../config/env');
const Question = require('../models/question.model');
const AppError = require('../utils/appError');
const { QUESTION_STATUSES, USER_ROLES } = require('../constants/enums');

// 提問前的共用限制，網頁 QA、多輪對話與 LINE 三個入口都要呼叫：
// 1. 字數上限：擋掉超長貼文，避免浪費 AI 費用。
// 2. 每位學生每天的提問次數（台灣時間 00:00 重置，網頁與 LINE 合併計算）。
//    只計算成功產生回應的提問（answered / no_match）；系統故障造成的 failed
//    不扣次數，學生不必為系統問題買單。教師與管理員不受每日次數限制。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTED_STATUSES = [QUESTION_STATUSES.ANSWERED, QUESTION_STATUSES.NO_MATCH];

function getQuestionLength(question) {
  // 以字元（code point）計算，中文、emoji 都算一個字。
  return [...String(question || '').trim()].length;
}

function assertQuestionLength(question) {
  const limit = env.qaMaxQuestionLength;
  const length = getQuestionLength(question);
  if (limit > 0 && length > limit) {
    throw new AppError(
      `Question must be at most ${limit} characters.`,
      400,
      'QUESTION_TOO_LONG',
      { limit, length },
    );
  }
}

function getTaipeiDayWindow(now = new Date()) {
  const start = new Date(Math.floor((now.getTime() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function isDailyLimitedUser(user) {
  return user?.role === USER_ROLES.STUDENT && env.qaDailyAskLimitPerStudent > 0;
}

async function countTodayAsks(userId, now = new Date()) {
  const { start, end } = getTaipeiDayWindow(now);
  return Question.countDocuments({
    userId,
    status: { $in: COUNTED_STATUSES },
    askedAt: { $gte: start, $lt: end },
  });
}

async function getDailyAskUsage(user, now = new Date()) {
  if (!isDailyLimitedUser(user)) return null;
  const limit = env.qaDailyAskLimitPerStudent;
  const used = await countTodayAsks(user.id || user._id, now);
  const { end } = getTaipeiDayWindow(now);
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: end };
}

async function assertDailyAskAvailable(user, now = new Date()) {
  const usage = await getDailyAskUsage(user, now);
  if (usage && usage.remaining <= 0) {
    throw new AppError(
      `Daily question limit reached (${usage.limit} per day).`,
      429,
      'QA_DAILY_LIMIT_EXCEEDED',
      usage,
    );
  }
  return usage;
}

// 入口共用：先檢查字數（不需查 DB），再檢查每日次數。
async function assertCanAsk({ user, question, now = new Date() }) {
  assertQuestionLength(question);
  return assertDailyAskAvailable(user, now);
}

module.exports = {
  assertCanAsk,
  assertDailyAskAvailable,
  assertQuestionLength,
  getDailyAskUsage,
  getQuestionLength,
  getTaipeiDayWindow,
};
