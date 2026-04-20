const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/user.model');
const Enrollment = require('../models/enrollment.model');
const Course = require('../models/course.model');
const LineBindToken = require('../models/lineBindToken.model');
const { askQuestion } = require('./qa.service');
const {
  buildLineRuntimeSnapshot,
  buildQaRuntimeSnapshot,
} = require('./runtimeDiagnostics.service');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_CONVERSATION_STATES = {
  IDLE: 'idle',
  AWAITING_COURSE_SELECTION: 'awaiting_course_selection',
};
const LINE_REPLY_REASONS = {
  REPLY_TOKEN_MISSING: 'reply_token_missing',
  ACCESS_TOKEN_MISSING: 'line_channel_access_token_missing',
};

function getLineConversationState(user) {
  return user?.lineConversationState || LINE_CONVERSATION_STATES.IDLE;
}

function buildTextMessage(text) {
  return {
    type: 'text',
    text,
  };
}

function attachReplyMetadata(result, replyResult) {
  return {
    ...result,
    replySent: !replyResult.skipped,
    replySkipped: Boolean(replyResult.skipped),
    replyReason: replyResult.reason || null,
  };
}

async function replyMessage(replyToken, messages) {
  if (!replyToken) {
    return {
      skipped: true,
      reason: LINE_REPLY_REASONS.REPLY_TOKEN_MISSING,
    };
  }

  if (!env.lineChannelAccessToken) {
    return {
      skipped: true,
      reason: LINE_REPLY_REASONS.ACCESS_TOKEN_MISSING,
    };
  }

  const response = await fetch(`${LINE_API_BASE}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.lineChannelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`LINE reply failed: ${payload}`);
  }

  return {
    skipped: false,
    reason: null,
  };
}

async function generateBindToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await LineBindToken.create({ token, userId, expiresAt });
  return token;
}

async function handleFollow(event) {
  const replyResult = await replyMessage(event.replyToken, [
    buildTextMessage('歡迎使用 FocusFlow。請先完成帳號綁定，綁定後就能在 LINE 直接提問課程內容。'),
  ]);

  return attachReplyMetadata({
    type: 'follow',
    handled: true,
  }, replyResult);
}

async function handleBind(lineUserId, token, replyToken) {
  const record = await LineBindToken.findOne({ token });

  if (!record) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('這個綁定碼無效或已失效，請重新從系統取得新的綁定碼。'),
    ]);

    return attachReplyMetadata({
      type: 'bind',
      handled: false,
      reason: 'token_not_found',
    }, replyResult);
  }

  if (record.expiresAt < new Date()) {
    await LineBindToken.deleteOne({ token });
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('綁定碼已過期，請重新從系統取得新的綁定碼。'),
    ]);

    return attachReplyMetadata({
      type: 'bind',
      handled: false,
      reason: 'token_expired',
    }, replyResult);
  }

  await User.findByIdAndUpdate(record.userId, {
    lineUserId,
    lineBindAt: new Date(),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  await LineBindToken.deleteOne({ token });
  const replyResult = await replyMessage(replyToken, [
    buildTextMessage('帳號綁定成功。接下來請先選擇課程，之後就可以直接提問。'),
  ]);

  return attachReplyMetadata({
    type: 'bind',
    handled: true,
  }, replyResult);
}

async function handleSwitchCourse(lineUserId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先完成帳號綁定。')]);

    return attachReplyMetadata({
      type: 'switch_course',
      handled: false,
      reason: 'user_not_bound',
    }, replyResult);
  }

  const enrollments = await Enrollment.find({ studentId: user._id }).populate('courseId');
  const publishedCourses = await Course.find({ status: 'published' });
  const courseMap = new Map();

  for (const enrollment of enrollments) {
    if (enrollment.courseId) {
      courseMap.set(String(enrollment.courseId._id), enrollment.courseId);
    }
  }

  for (const course of publishedCourses) {
    courseMap.set(String(course._id), course);
  }

  const selectableCourses = Array.from(courseMap.values());

  if (!selectableCourses.length) {
    await User.findByIdAndUpdate(user._id, {
      lineConversationState: LINE_CONVERSATION_STATES.IDLE,
    });
    const replyResult = await replyMessage(replyToken, [buildTextMessage('目前沒有可切換的課程。')]);

    return attachReplyMetadata({
      type: 'switch_course',
      handled: false,
      reason: 'no_available_course',
    }, replyResult);
  }

  const actions = selectableCourses
    .slice(0, 4)
    .map((course) => ({
      type: 'postback',
      label: course.title.slice(0, 20),
      data: `action=select_course&courseId=${course._id}`,
    }));

  const replyResult = await replyMessage(replyToken, [
    {
      type: 'template',
      altText: '請選擇課程',
      template: {
        type: 'buttons',
        text: '請選擇你要提問的課程。',
        actions,
      },
    },
  ]);

  await User.findByIdAndUpdate(user._id, {
    lineConversationState: LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION,
  });

  return attachReplyMetadata({
    type: 'switch_course',
    handled: true,
  }, replyResult);
}

async function handleSelectCourse(lineUserId, courseId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('找不到綁定使用者，請重新綁定帳號。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'user_not_bound',
    }, replyResult);
  }

  if (getLineConversationState(user) !== LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先輸入「切換課程」，再選擇課程。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'conversation_state_invalid',
    }, replyResult);
  }

  const course = await Course.findById(courseId);
  const enrollment = await Enrollment.findOne({
    studentId: user._id,
    courseId,
  });

  if (!course || (!enrollment && course.status !== 'published')) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('你沒有這門課程的存取權限。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'course_access_denied',
    }, replyResult);
  }

  await User.findByIdAndUpdate(user._id, {
    activeCourseId: new mongoose.Types.ObjectId(courseId),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  const replyResult = await replyMessage(replyToken, [buildTextMessage('課程切換成功，現在可以直接提問。')]);

  return attachReplyMetadata({
    type: 'select_course',
    handled: true,
  }, replyResult);
}

function buildQuestionSummaryLines(qaResult) {
  const [topMatch] = qaResult.matches;
  const summaryLines = [];
  const answerFallback = qaResult.runtime?.fallbacks?.find((item) => item.stage === 'answer');
  const retrievalFallback = qaResult.runtime?.fallbacks?.find((item) => item.stage === 'retrieval');

  if (qaResult.runtime?.matchStatus === 'no_searchable_segments') {
    summaryLines.push('[MVP提示] 這門課目前沒有可搜尋片段。');
  }

  if (retrievalFallback) {
    summaryLines.push('[MVP fallback] 檢索已改走 lexical ranking。');
  }

  if (answerFallback) {
    summaryLines.push('[MVP fallback] Gemini 暫時不可用，已改用 template answer。');
  }

  summaryLines.push(qaResult.answer);

  if (topMatch) {
    summaryLines.push(`片段：${topMatch.startSec}s - ${topMatch.endSec}s`);
  }

  if (qaResult.clip?.jumpUrl) {
    summaryLines.push(`跳轉：${qaResult.clip.jumpUrl}`);
  }

  return summaryLines;
}

function mapQaFailureReason(error) {
  switch (error?.code) {
    case 'QA_RUNTIME_MISCONFIGURED':
      return 'qa_runtime_misconfigured';
    case 'QA_ATLAS_NOT_READY':
      return 'qa_atlas_not_ready';
    case 'ANSWER_PROVIDER_NOT_CONFIGURED':
      return 'answer_provider_not_configured';
    default:
      return 'qa_internal_error';
  }
}

function buildQaFailureMessage(error) {
  switch (error?.code) {
    case 'QA_RUNTIME_MISCONFIGURED':
      return '[MVP hard-fail] QA runtime 設定錯誤，請先檢查 /health 與 .env。';
    case 'QA_ATLAS_NOT_READY':
      return '[MVP hard-fail] Atlas QA 尚未 ready，請先檢查 Atlas index、Gemini embedding 設定與 /health。';
    case 'ANSWER_PROVIDER_NOT_CONFIGURED':
      return '[MVP hard-fail] QA answer provider 缺少必要金鑰，請先檢查 .env。';
    default:
      return '[MVP hard-fail] QA 執行失敗，請先檢查 /health 與 backend logs。';
  }
}

function buildQaFailureRuntime(error) {
  const details = error?.details && typeof error.details === 'object'
    ? error.details
    : buildQaRuntimeSnapshot();
  const hardFailureCodes = Array.isArray(details.hardFailures) && details.hardFailures.length
    ? details.hardFailures.map((item) => item.code)
    : [error?.code || 'INTERNAL_SERVER_ERROR'];

  return {
    readiness: details.readiness || 'hard_fail',
    readyForAsk: details.readyForAsk === true,
    queryEmbeddingProvider: details.queryEmbeddingProvider || null,
    vectorSearchMode: details.vectorSearchMode || null,
    answerProvider: details.answerProvider || null,
    hardFailureCodes,
  };
}

async function handleQuestion(lineUserId, text, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先完成帳號綁定。')]);

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: 'user_not_bound',
    }, replyResult);
  }

  if (getLineConversationState(user) === LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先完成課程選擇，再開始提問。')]);

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: 'course_selection_pending',
    }, replyResult);
  }

  if (!user.activeCourseId) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先切換課程，再開始提問。')]);

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: 'active_course_missing',
    }, replyResult);
  }

  const conversationHistory = user.lineConversationHistory || [];

  let qaResult;

  try {
    qaResult = await askQuestion({
      user: {
        id: String(user._id),
        role: user.role,
      },
      courseId: String(user.activeCourseId),
      question: text,
      source: 'line',
      conversationHistory: conversationHistory.length ? conversationHistory : null,
    });
  } catch (error) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage(buildQaFailureMessage(error))]);

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: mapQaFailureReason(error),
      errorCode: error?.code || 'INTERNAL_SERVER_ERROR',
      qaRuntime: buildQaFailureRuntime(error),
    }, replyResult);
  }

  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: text },
    { role: 'model', content: qaResult.answer },
  ].slice(-6);

  await User.findByIdAndUpdate(user._id, { lineConversationHistory: updatedHistory });

  const replyResult = await replyMessage(replyToken, [buildTextMessage(buildQuestionSummaryLines(qaResult).join('\n'))]);

  return attachReplyMetadata({
    type: 'question',
    handled: true,
    matchCount: qaResult.matches.length,
    qaRuntime: {
      status: qaResult.runtime?.status,
      degraded: Boolean(qaResult.runtime?.degraded),
      matchStatus: qaResult.runtime?.matchStatus,
      answerProviderUsed: qaResult.runtime?.answerProviderUsed,
      searchableSegmentCount: qaResult.runtime?.searchableSegmentCount,
      fallbackCount: qaResult.runtime?.fallbacks?.length || 0,
      fallbackCodes: qaResult.runtime?.fallbacks?.map((item) => item.code) || [],
    },
  }, replyResult);
}

async function processWebhookEvent(event) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;

  if (event.type === 'follow') {
    return handleFollow(event);
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = String(event.message.text || '').trim();

    if (/^[a-f0-9]{64}$/i.test(text)) {
      return handleBind(lineUserId, text.toLowerCase(), replyToken);
    }

    if (text === '切換課程') {
      return handleSwitchCourse(lineUserId, replyToken);
    }

    return handleQuestion(lineUserId, text, replyToken);
  }

  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback?.data || '');
    const action = params.get('action');

    if (action === 'select_course') {
      return handleSelectCourse(lineUserId, params.get('courseId'), replyToken);
    }
  }

  return {
    type: event.type,
    handled: false,
    reason: 'unsupported_event',
    replySent: false,
    replySkipped: true,
    replyReason: 'not_applicable',
  };
}

async function processWebhookEvents(events) {
  const results = [];

  for (const event of events) {
    try {
      results.push(await processWebhookEvent(event));
    } catch (error) {
      results.push({
        type: event?.type || 'unknown',
        handled: false,
        reason: 'internal_error',
        replySent: false,
        replySkipped: true,
        replyReason: 'internal_error',
      });

      if (env.nodeEnv !== 'test') {
        console.error('[LINE] event processing failed.', error);
      }
    }
  }

  return {
    received: events.length,
    processed: results.filter((item) => item.handled).length,
    lineRuntime: buildLineRuntimeSnapshot(),
    results,
  };
}

async function ensureCourseForUser(userId, courseId) {
  const user = await User.findById(userId);
  const course = await Course.findById(courseId);

  if (!user || !course) {
    return null;
  }

  await Enrollment.findOneAndUpdate(
    { studentId: user._id, courseId: course._id },
    {
      $setOnInsert: {
        studentId: user._id,
        courseId: course._id,
        enrolledAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return course;
}

module.exports = {
  generateBindToken,
  processWebhookEvents,
  ensureCourseForUser,
};
