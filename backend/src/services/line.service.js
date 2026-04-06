const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/user.model');
const Enrollment = require('../models/enrollment.model');
const Course = require('../models/course.model');
const LineBindToken = require('../models/lineBindToken.model');
const { askQuestion } = require('./qa.service');

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function buildTextMessage(text) {
  return {
    type: 'text',
    text,
  };
}

async function replyMessage(replyToken, messages) {
  if (!replyToken || !env.lineChannelAccessToken) {
    return {
      skipped: true,
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
  };
}

async function generateBindToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await LineBindToken.create({ token, userId, expiresAt });
  return token;
}

async function handleFollow(event) {
  await replyMessage(event.replyToken, [
    buildTextMessage('歡迎使用 FocusFlow。請先完成帳號綁定，綁定後就能在 LINE 直接提問課程內容。'),
  ]);

  return {
    type: 'follow',
    handled: true,
  };
}

async function handleBind(lineUserId, token, replyToken) {
  const record = await LineBindToken.findOne({ token });

  if (!record) {
    await replyMessage(replyToken, [
      buildTextMessage('這個綁定碼無效或已失效，請重新從系統取得新的綁定碼。'),
    ]);
    return {
      type: 'bind',
      handled: false,
      reason: 'token_not_found',
    };
  }

  if (record.expiresAt < new Date()) {
    await LineBindToken.deleteOne({ token });
    await replyMessage(replyToken, [
      buildTextMessage('綁定碼已過期，請重新從系統取得新的綁定碼。'),
    ]);
    return {
      type: 'bind',
      handled: false,
      reason: 'token_expired',
    };
  }

  await User.findByIdAndUpdate(record.userId, {
    lineUserId,
    lineBindAt: new Date(),
  });

  await LineBindToken.deleteOne({ token });
  await replyMessage(replyToken, [
    buildTextMessage('帳號綁定成功。接下來請先選擇課程，之後就可以直接提問。'),
  ]);

  return {
    type: 'bind',
    handled: true,
  };
}

async function handleSwitchCourse(lineUserId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    await replyMessage(replyToken, [buildTextMessage('請先完成帳號綁定。')]);
    return {
      type: 'switch_course',
      handled: false,
      reason: 'user_not_bound',
    };
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
    await replyMessage(replyToken, [buildTextMessage('目前沒有可切換的課程。')]);
    return {
      type: 'switch_course',
      handled: false,
      reason: 'no_available_course',
    };
  }

  const actions = selectableCourses
    .slice(0, 4)
    .map((course) => ({
      type: 'postback',
      label: course.title.slice(0, 20),
      data: `action=select_course&courseId=${course._id}`,
    }));

  await replyMessage(replyToken, [
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

  return {
    type: 'switch_course',
    handled: true,
  };
}

async function handleSelectCourse(lineUserId, courseId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    await replyMessage(replyToken, [buildTextMessage('找不到綁定使用者，請重新綁定帳號。')]);
    return {
      type: 'select_course',
      handled: false,
      reason: 'user_not_bound',
    };
  }

  const course = await Course.findById(courseId);
  const enrollment = await Enrollment.findOne({
    studentId: user._id,
    courseId,
  });

  if (!course || (!enrollment && course.status !== 'published')) {
    await replyMessage(replyToken, [buildTextMessage('你沒有這門課程的存取權限。')]);
    return {
      type: 'select_course',
      handled: false,
      reason: 'course_access_denied',
    };
  }

  await User.findByIdAndUpdate(user._id, {
    activeCourseId: new mongoose.Types.ObjectId(courseId),
  });

  await replyMessage(replyToken, [buildTextMessage('課程切換成功，現在可以直接提問。')]);
  return {
    type: 'select_course',
    handled: true,
  };
}

async function handleQuestion(lineUserId, text, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    await replyMessage(replyToken, [buildTextMessage('請先完成帳號綁定。')]);
    return {
      type: 'question',
      handled: false,
      reason: 'user_not_bound',
    };
  }

  if (!user.activeCourseId) {
    await replyMessage(replyToken, [buildTextMessage('請先切換課程，再開始提問。')]);
    return {
      type: 'question',
      handled: false,
      reason: 'active_course_missing',
    };
  }

  const qaResult = await askQuestion({
    user: {
      id: String(user._id),
      role: user.role,
    },
    courseId: String(user.activeCourseId),
    question: text,
    source: 'line',
  });

  const [topMatch] = qaResult.matches;
  const summaryLines = [qaResult.answer];

  if (topMatch) {
    summaryLines.push(`片段：${topMatch.startSec}s - ${topMatch.endSec}s`);
  }

  if (qaResult.clip?.jumpUrl) {
    summaryLines.push(`跳轉：${qaResult.clip.jumpUrl}`);
  }

  await replyMessage(replyToken, [buildTextMessage(summaryLines.join('\n'))]);
  return {
    type: 'question',
    handled: true,
    matchCount: qaResult.matches.length,
  };
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
      });

      if (env.nodeEnv !== 'test') {
        console.error('[LINE] event processing failed.', error);
      }
    }
  }

  return {
    received: events.length,
    processed: results.filter((item) => item.handled).length,
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
