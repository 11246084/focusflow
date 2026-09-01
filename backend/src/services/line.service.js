const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/user.model');
const Enrollment = require('../models/enrollment.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const LineBindToken = require('../models/lineBindToken.model');
const { askQuestion } = require('./qa.service');
const { recordUsage } = require('./usageLog.service');
const { recordQuestion } = require('./questionRecording.service');
const {
  QUESTION_STATUSES,
  QUESTION_SOURCES,
  USAGE_LOG_EVENTS,
  COURSE_STATUSES,
} = require('../constants/enums');
const {
  buildActiveEnrollmentFilter,
  findActiveEnrollment,
} = require('./courseAccess.service');
const {
  buildLineRuntimeSnapshot,
  buildQaRuntimeSnapshot,
} = require('./runtimeDiagnostics.service');

// LINE Bot API 的基底 URL，所有發送訊息的請求都打這裡
const LINE_API_BASE = 'https://api.line.me/v2/bot';

// 對話狀態機：記錄使用者目前在 LINE 對話流程中的哪個步驟
// IDLE：正常狀態，可以直接提問
// AWAITING_COURSE_SELECTION：Bot 剛顯示課程選單，等待使用者點選
const LINE_CONVERSATION_STATES = {
  IDLE: 'idle',
  AWAITING_COURSE_SELECTION: 'awaiting_course_selection',
};

// 回覆被跳過的原因代碼，方便 debug log 追蹤
const LINE_REPLY_REASONS = {
  REPLY_TOKEN_MISSING: 'reply_token_missing',
  ACCESS_TOKEN_MISSING: 'line_channel_access_token_missing',
};

// 從 User 文件讀取對話狀態，若欄位不存在則預設為 IDLE
function getLineConversationState(user) {
  return user?.lineConversationState || LINE_CONVERSATION_STATES.IDLE;
}

// 組裝 LINE 文字訊息物件（LINE API 要求特定格式）
function buildTextMessage(text) {
  return {
    type: 'text',
    text,
  };
}

function normalizeIncomingTextMessage(text) {
  const trimmedText = String(text || '').trim();
  const legacyTextParamMatch = trimmedText.match(/^text=(.+)$/i);

  if (!legacyTextParamMatch) {
    return trimmedText;
  }

  try {
    return decodeURIComponent(legacyTextParamMatch[1]).trim();
  } catch {
    return legacyTextParamMatch[1].trim();
  }
}

// 把回覆結果（是否成功送出、跳過原因）合併進事件處理結果物件
// 這樣每個 handler 回傳的物件格式都一致，方便 controller 層整理
function attachReplyMetadata(result, replyResult) {
  return {
    ...result,
    replySent: !replyResult.skipped,
    replySkipped: Boolean(replyResult.skipped),
    replyReason: replyResult.reason || null,
  };
}

// 實際透過 LINE Reply API 把訊息送給使用者
// replyToken：LINE 每個事件都附帶，用來對應這次回覆的目標，且只能用一次
// messages：要送出的訊息陣列（LINE 一次最多送 5 則）
async function replyMessage(replyToken, messages) {
  // 沒有 replyToken（例如某些系統事件不附帶），就跳過回覆
  if (!replyToken) {
    return {
      skipped: true,
      reason: LINE_REPLY_REASONS.REPLY_TOKEN_MISSING,
    };
  }

  // 沒有設定 LINE Channel Access Token，無法呼叫 LINE API
  if (!env.lineChannelAccessToken) {
    return {
      skipped: true,
      reason: LINE_REPLY_REASONS.ACCESS_TOKEN_MISSING,
    };
  }

  // 呼叫 LINE Reply API，Authorization header 帶 Channel Access Token
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

// 產生綁定 Token 並存入資料庫
// 使用 crypto.randomBytes 產生 32 bytes（= 64 字元十六進位）的安全隨機字串
async function generateBindToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期

  await LineBindToken.create({ token, userId, expiresAt });
  return token;
}

async function bindLineUserWithToken(lineUserId, token) {
  const record = await LineBindToken.findOne({ token });

  if (!record) {
    return {
      ok: false,
      reason: 'token_not_found',
    };
  }

  if (record.expiresAt < new Date()) {
    await LineBindToken.deleteOne({ token });
    return {
      ok: false,
      reason: 'token_expired',
    };
  }

  await User.updateMany(
    { lineUserId, _id: { $ne: record.userId } },
    {
      $unset: { lineUserId: '' },
      $set: {
        lineBindAt: null,
        lineConversationState: LINE_CONVERSATION_STATES.IDLE,
      },
    },
  );

  await User.findByIdAndUpdate(record.userId, {
    lineUserId,
    lineBindAt: new Date(),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  await LineBindToken.deleteOne({ token });

  return {
    ok: true,
    userId: record.userId,
  };
}

// 處理「加好友」事件：使用者第一次把 Bot 加為好友時觸發
// 送出歡迎訊息，引導使用者完成帳號綁定
async function handleFollow(event) {
  const replyResult = await replyMessage(event.replyToken, [
    buildTextMessage('歡迎使用 FocusFlow。請先完成帳號綁定，綁定後就能在 LINE 直接提問課程內容。'),
  ]);

  return attachReplyMetadata({
    type: 'follow',
    handled: true,
  }, replyResult);
}

// 處理帳號綁定：使用者把 64 字元的 token 傳到 LINE Bot 時觸發
// 驗證 token 有效後，把 lineUserId 寫入 User 文件，完成 LINE ↔ 系統帳號的對應
async function handleBind(lineUserId, token, replyToken) {
  // 在資料庫裡找這個 token
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

  // TTL index 只會定期清理，手動再判斷一次確保即時性
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

  // 把 LINE userId 寫入系統使用者文件，並重設對話狀態
  await User.findByIdAndUpdate(record.userId, {
    lineUserId,
    lineBindAt: new Date(),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  // Token 一次性使用，綁定成功後立即刪除
  await LineBindToken.deleteOne({ token });
  const replyResult = await replyMessage(replyToken, [
    buildTextMessage('帳號綁定成功。接下來請先選擇課程，之後就可以直接提問。'),
  ]);

  return attachReplyMetadata({
    type: 'bind',
    handled: true,
  }, replyResult);
}

// 給定一組課程，回傳「至少有一個現存 Video record 對應」的子集合。
// 用於 LINE 課程選單，避免使用者選了空課程或孤兒課程後得到「未知影片」答案。
async function filterCoursesWithLiveVideos(courses) {
  if (!courses.length) return [];

  const courseIds = courses.map((course) => course._id);
  const allVideoRefs = courses.flatMap((course) => course.videoIds || []);

  const matchedVideos = await Video.find({
    $or: [
      { courseId: { $in: courseIds } },
      ...(allVideoRefs.length ? [{ _id: { $in: allVideoRefs } }] : []),
    ],
  });

  const coursesWithVideos = new Set();
  for (const video of matchedVideos) {
    if (video.courseId) {
      coursesWithVideos.add(String(video.courseId));
    }
    for (const course of courses) {
      if ((course.videoIds || []).some((id) => String(id) === String(video._id))) {
        coursesWithVideos.add(String(course._id));
      }
    }
  }

  return courses.filter((course) => coursesWithVideos.has(String(course._id)));
}

// 處理「切換課程」指令：使用者傳送文字「切換課程」時觸發
// 查詢使用者有權存取的課程，用 LINE Buttons Template 顯示最多 4 個課程按鈕
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

  const enrollments = await Enrollment.find(buildActiveEnrollmentFilter({ studentId: user._id }))
    .populate('courseId');
  // Published is discoverability metadata, not authorization. LINE only lists
  // active enrollments whose course is currently published.
  const selectableCourses = enrollments
    .map((enrollment) => enrollment.courseId)
    .filter((course) => course && course.status === COURSE_STATUSES.PUBLISHED);

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

  // LINE Buttons Template 最多只能有 4 個按鈕，所以只取前 4 筆
  // 每個按鈕用 postback 事件，data 帶 action 和 courseId，方便後續 handleSelectCourse 解析
  const actions = selectableCourses
    .slice(0, 4)
    .map((course) => ({
      type: 'postback',
      label: course.title.slice(0, 20), // LINE 按鈕文字上限 20 字元
      data: `action=select_course&courseId=${course._id}`,
    }));

  const replyResult = await replyMessage(replyToken, [
    {
      type: 'template',
      altText: '請選擇課程',   // 不支援 template 的環境（如電腦版）顯示的替代文字
      template: {
        type: 'buttons',
        text: '請選擇你要提問的課程。',
        actions,
      },
    },
  ]);

  // 送出課程選單後，把狀態改為「等待課程選擇」，避免使用者直接提問
  await User.findByIdAndUpdate(user._id, {
    lineConversationState: LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION,
  });

  return attachReplyMetadata({
    type: 'switch_course',
    handled: true,
  }, replyResult);
}

// 處理從網頁「詢問助教」連結直接帶入課程 ID 的情境（COURSE:{courseId}）
// 不需要經過 awaiting_course_selection 狀態，直接設定 activeCourseId
async function handleDirectCourseSelect(lineUserId, courseId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('請先完成帳號綁定後，再從系統進入課程。'),
    ]);
    return attachReplyMetadata({ type: 'direct_course_select', handled: false, reason: 'user_not_bound' }, replyResult);
  }

  const course = await Course.findById(courseId);
  const enrollment = await findActiveEnrollment(user._id, courseId);

  if (!course || course.status !== COURSE_STATUSES.PUBLISHED || !enrollment) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('你沒有這門課程的存取權限。'),
    ]);
    return attachReplyMetadata({ type: 'direct_course_select', handled: false, reason: 'course_access_denied' }, replyResult);
  }

  const liveCourses = await filterCoursesWithLiveVideos([course]);
  if (!liveCourses.length) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage(`「${course.title}」目前沒有影片，暫時無法提問。`),
    ]);
    return attachReplyMetadata({ type: 'direct_course_select', handled: false, reason: 'course_has_no_videos' }, replyResult);
  }

  await User.findByIdAndUpdate(user._id, {
    activeCourseId: new mongoose.Types.ObjectId(courseId),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  const replyResult = await replyMessage(replyToken, [
    buildTextMessage(`已進入「${course.title}」，現在可以直接提問課程內容。`),
  ]);

  return attachReplyMetadata({ type: 'direct_course_select', handled: true }, replyResult);
}

// 處理使用者點選課程按鈕後的 postback 事件
// 驗證使用者有該課程的存取權，確認後把 activeCourseId 寫入 User 文件
async function handleBindAndSelectCourse(lineUserId, token, courseId, replyToken) {
  const bindResult = await bindLineUserWithToken(lineUserId, token);

  if (bindResult.reason === 'token_not_found') {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('綁定連結已失效，請回到 FocusFlow 重新開啟 QR code。'),
    ]);
    return attachReplyMetadata({ type: 'bind_course', handled: false, reason: 'token_not_found' }, replyResult);
  }

  if (bindResult.reason === 'token_expired') {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('綁定連結已過期，請回到 FocusFlow 重新開啟 QR code。'),
    ]);
    return attachReplyMetadata({ type: 'bind_course', handled: false, reason: 'token_expired' }, replyResult);
  }

  const user = await User.findById(bindResult.userId);
  const course = await Course.findById(courseId);
  const enrollment = await findActiveEnrollment(user._id, courseId);

  if (!course || course.status !== COURSE_STATUSES.PUBLISHED || !enrollment) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('LINE 帳號已綁定，但你目前無法存取這門課程。'),
    ]);
    return attachReplyMetadata({ type: 'bind_course', handled: false, reason: 'course_access_denied' }, replyResult);
  }

  const liveCourses = await filterCoursesWithLiveVideos([course]);
  if (!liveCourses.length) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage(`LINE 帳號已綁定，但「${course.title}」目前沒有影片，暫時無法提問。`),
    ]);
    return attachReplyMetadata({ type: 'bind_course', handled: false, reason: 'course_has_no_videos' }, replyResult);
  }

  await User.findByIdAndUpdate(user._id, {
    activeCourseId: new mongoose.Types.ObjectId(courseId),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
  });

  const replyResult = await replyMessage(replyToken, [
    buildTextMessage(`LINE 帳號已綁定，並已切換到「${course.title}」。現在可以直接提問。`),
  ]);

  return attachReplyMetadata({ type: 'bind_course', handled: true }, replyResult);
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

  // 防止使用者直接偽造 postback 跳過「切換課程」步驟
  if (getLineConversationState(user) !== LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先輸入「切換課程」，再選擇課程。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'conversation_state_invalid',
    }, replyResult);
  }

  const course = await Course.findById(courseId);
  const enrollment = await findActiveEnrollment(user._id, courseId);

  if (!course || course.status !== COURSE_STATUSES.PUBLISHED || !enrollment) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('你沒有這門課程的存取權限。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'course_access_denied',
    }, replyResult);
  }

  // 課程沒有可回答的影片時，不寫入 activeCourseId，避免使用者後續提問拿到空答案
  const liveCourses = await filterCoursesWithLiveVideos([course]);
  if (!liveCourses.length) {
    await User.findByIdAndUpdate(user._id, {
      lineConversationState: LINE_CONVERSATION_STATES.IDLE,
    });
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage(`「${course.title}」目前沒有影片，暫時無法提問。`),
    ]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'course_has_no_videos',
    }, replyResult);
  }

  // 寫入選定的課程 ID，並把狀態恢復為 IDLE，開放提問
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

// 把 QA 結果組裝成使用者看到的訊息文字行
// 包含：fallback 提示（開發用）、AI 答案、片段時間戳、影片跳轉連結
function buildQuestionSummaryLines(qaResult) {
  const [topCitation] = qaResult.citations || [];
  const summaryLines = [];
  const answerFallback = qaResult.runtime?.fallbacks?.find((item) => item.stage === 'answer');
  const retrievalFallback = qaResult.runtime?.fallbacks?.find((item) => item.stage === 'retrieval');

  // 以下 [MVP提示] / [MVP fallback] 訊息是開發階段的診斷資訊，正式上線前可以移除
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

  // 附上最相關片段的時間區間，讓使用者知道答案來自影片哪個位置
  if (topCitation) {
    summaryLines.push(`片段：${topCitation.timestamp.startSec}s - ${topCitation.timestamp.endSec}s`);
  }

  const jumpUrl = topCitation
    ? qaResult.clip?.jumpUrl || topCitation.timestamp?.jumpUrl
    : null;

  // 若有產生跳轉連結（對應影片片段的直接連結），一併附上
  if (jumpUrl) {
    summaryLines.push(`跳轉：${jumpUrl}`);
  } else if (topCitation) {
    // 命中影片沒有 YouTube 連結（例如本地上傳尚未同步 YouTube）時，
    // 不能讓跳轉資訊整行消失，改提示改用網站觀看。
    const videoTitle = topCitation.videoTitle || topCitation.sourceVideo?.title;
    const videoLabel = videoTitle ? `「${videoTitle}」` : '';
    summaryLines.push(`此片段${videoLabel}尚未提供跳轉連結，請到 FocusFlow 網站的課程頁播放對應時間點。`);
  }

  return summaryLines;
}

// 把 QA service 拋出的錯誤碼轉成內部追蹤用的字串代碼
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

// 把 QA 錯誤轉成使用者看得懂的中文提示訊息
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

// 從 QA 錯誤物件中提取診斷快照，方便 API 回應中帶回給開發者查看
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

// 處理使用者的一般文字提問
// 流程：確認綁定 → 確認對話狀態 → 確認已選課程 → 呼叫 QA service → 更新對話歷史 → 回覆答案
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

  // 如果使用者正在選課程流程中，不允許插入提問
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

  const [activeCourse, activeEnrollment] = await Promise.all([
    Course.findById(user.activeCourseId),
    findActiveEnrollment(user._id, user.activeCourseId),
  ]);
  if (!activeCourse
      || activeCourse.status !== COURSE_STATUSES.PUBLISHED
      || !activeEnrollment) {
    await User.findByIdAndUpdate(user._id, {
      $unset: { activeCourseId: 1 },
      $set: { lineConversationState: LINE_CONVERSATION_STATES.IDLE, lineConversationHistory: [] },
    });
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('你目前沒有可使用的課程，請聯絡老師或管理員確認修課資格。'),
    ]);
    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: 'course_access_denied',
    }, replyResult);
  }

  // 讀取之前的對話歷史，傳給 QA service 讓 AI 有上下文可以理解追問
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
      source: 'line',   // 標記來源，QA service 可用來區分前端和 LINE Bot 的請求
      conversationHistory: conversationHistory.length ? conversationHistory : null,
    });
  } catch (error) {
    const failureMessage = buildQaFailureMessage(error);
    const failureRuntime = buildQaFailureRuntime(error);
    const usageLog = await recordUsage({
      userId: user._id,
      courseId: user.activeCourseId,
      event: USAGE_LOG_EVENTS.ASK,
      metadata: {
        source: QUESTION_SOURCES.LINE,
        question: text,
        matchCount: 0,
        runtime: failureRuntime,
        errorCode: error?.code || 'INTERNAL_SERVER_ERROR',
      },
    });

    await recordQuestion({
      userId: user._id,
      courseId: user.activeCourseId,
      question: text,
      answer: failureMessage,
      status: QUESTION_STATUSES.FAILED,
      source: QUESTION_SOURCES.LINE,
      matches: [],
      runtime: failureRuntime,
      sourceUsageLogId: usageLog?._id,
    });

    const replyResult = await replyMessage(replyToken, [buildTextMessage(failureMessage)]);

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: mapQaFailureReason(error),
      errorCode: error?.code || 'INTERNAL_SERVER_ERROR',
      qaRuntime: failureRuntime,
    }, replyResult);
  }

  // 把這次對話追加進歷史，並只保留最近 6 則（3 輪問答）
  // 限制 6 則是為了避免對話歷史過長，增加 AI token 消耗
  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: text },
    { role: 'model', content: qaResult.answer },
  ].slice(-6);

  await User.findByIdAndUpdate(user._id, { lineConversationHistory: updatedHistory });

  // 把所有回答行用換行合併成一則訊息傳給使用者
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

// 處理單一 LINE 事件，根據 event.type 分派給對應的 handler
// LINE 事件類型：follow（加好友）、message（收到訊息）、postback（按下按鈕）
async function processWebhookEvent(event) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;

  // 使用者加好友
  if (event.type === 'follow') {
    return handleFollow(event);
  }

  // 使用者傳送文字訊息
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = normalizeIncomingTextMessage(event.message.text);
    const bindCourseMatch = text.match(/^BIND:([a-f0-9]{64}):COURSE:([a-f0-9]{24})$/i);

    if (bindCourseMatch) {
      return handleBindAndSelectCourse(
        lineUserId,
        bindCourseMatch[1].toLowerCase(),
        bindCourseMatch[2],
        replyToken,
      );
    }

    // 64 字元十六進位字串 → 視為綁定碼，觸發帳號綁定流程
    if (/^[a-f0-9]{64}$/i.test(text)) {
      return handleBind(lineUserId, text.toLowerCase(), replyToken);
    }

    // 關鍵字「切換課程」→ 顯示課程選單
    if (text === '切換課程') {
      return handleSwitchCourse(lineUserId, replyToken);
    }

    // COURSE:{24位 ObjectId} → 從網頁「詢問助教」按鈕直接帶入課程，自動切換不需選單
    if (/^COURSE:[a-f0-9]{24}$/i.test(text)) {
      return handleDirectCourseSelect(lineUserId, text.slice(7), replyToken);
    }

    // 其他文字 → 視為對課程內容的提問
    return handleQuestion(lineUserId, text, replyToken);
  }

  // 使用者點選 Buttons Template 的按鈕 → 解析 postback data 取得 action 和 courseId
  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback?.data || '');
    const action = params.get('action');

    if (action === 'select_course') {
      return handleSelectCourse(lineUserId, params.get('courseId'), replyToken);
    }
  }

  // 其他不支援的事件類型（如貼圖、圖片等）一律忽略
  return {
    type: event.type,
    handled: false,
    reason: 'unsupported_event',
    replySent: false,
    replySkipped: true,
    replyReason: 'not_applicable',
  };
}

// 批次處理 Webhook 送來的所有事件（LINE 可能一次批次送多個事件）
// 逐一處理，任一事件失敗不影響其他事件的處理
async function processWebhookEvents(events) {
  const results = [];

  for (const event of events) {
    try {
      results.push(await processWebhookEvent(event));
    } catch (error) {
      // 單一事件處理失敗時記錄錯誤，但繼續處理下一個事件
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

module.exports = {
  generateBindToken,
  processWebhookEvents,
  buildQuestionSummaryLines,
};
