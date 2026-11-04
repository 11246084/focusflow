const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/user.model');
const Enrollment = require('../models/enrollment.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const LineBindToken = require('../models/lineBindToken.model');
const AppError = require('../utils/appError');
const { assertCanAsk, getDailyAskUsage } = require('./askLimits.service');
const { ensureBoundRichMenu, unlinkRichMenu } = require('./lineRichMenu.service');
const { askQuestion } = require('./qa.service');
const { contextualizeQuestion } = require('./contextualQuestion.service');
const { recordUsage } = require('./usageLog.service');
const { recordQuestion } = require('./questionRecording.service');
const {
  QUESTION_STATUSES,
  QUESTION_SOURCES,
  USAGE_LOG_EVENTS,
  COURSE_STATUSES,
  LINE_FRIEND_STATUSES,
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
  PUSH_FALLBACK: 'reply_failed_push_fallback',
};

// 從 User 文件讀取對話狀態，若欄位不存在則預設為 IDLE
function getLineConversationState(user) {
  return user?.lineConversationState || LINE_CONVERSATION_STATES.IDLE;
}

function getBoundedLineConversationHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-(env.maxConversationTurns * 2));
}

function mapLineHistoryForContextualizer(history) {
  return getBoundedLineConversationHistory(history).map((item) => ({
    role: item?.role === 'model' ? 'assistant' : item?.role,
    content: item?.content,
  }));
}

function courseSelectionUpdate(user, courseId) {
  const courseChanged = Boolean(
    user?.activeCourseId
    && String(user.activeCourseId) !== String(courseId),
  );

  return {
    activeCourseId: new mongoose.Types.ObjectId(courseId),
    lineConversationState: LINE_CONVERSATION_STATES.IDLE,
    ...(courseChanged ? { lineConversationHistory: [] } : {}),
  };
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

// 秒數轉成學生看得懂的時間，例：75 → 1:15；超過一小時加上時，例：3725 → 1:02:05
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function formatTimeRange(timestamp) {
  return `${formatClock(timestamp?.startSec)} - ${formatClock(timestamp?.endSec)}`;
}

// 網站網址取自 LINE Login 回呼網址（兩者是同一個網站）；沒有設定時回 null，訊息就不放連結。
function buildWebUrl(pathname) {
  try {
    return new URL(pathname, env.lineLoginCallbackUrl).toString();
  } catch {
    return null;
  }
}

// 未綁定的學生：附一顆「連結 LINE」按鈕，打開後會直接前往 LINE 授權。
function buildBindPromptMessage(text) {
  const linkUrl = buildWebUrl('/app/line');
  if (!linkUrl) return buildTextMessage(text);

  return {
    type: 'flex',
    altText: `${text} ${linkUrl}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text, wrap: true, size: 'sm', color: '#3D3D3A' },
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'uri', label: '連結 LINE', uri: linkUrl },
          },
        ],
      },
    },
  };
}

// 每筆引用的跳轉連結：第一筆沿用快取 clip 的連結。
function citationLink(qaResult, citation, index) {
  return (index === 0 ? qaResult.clip?.jumpUrl : null) || citation.timestamp?.jumpUrl || null;
}

// 回答卡：上方課程、中間回答、下方最多 3 筆引用。只改呈現方式，回答與引用沿用問答結果。
// 沒有 YouTube 版本的片段改開網站課程頁。
// 把回答切成段落：保留原本的換行，在「一、」「1.」「(1)」這類列點前換行，
// 段落太長時再依句號切開，避免 LINE 卡片裡一大塊文字難以閱讀。
const ANSWER_PARAGRAPH_MAX_LENGTH = 90;
const LIST_MARKER_BEFORE = /(?<=[。！？；：:])\s*(?=(?:[一二三四五六七八九十]{1,2}、|\d{1,2}[.、](?!\d)|[（(]\d{1,2}[）)]))/g;

function splitLongParagraph(paragraph, maxLength) {
  if (paragraph.length <= maxLength) return [paragraph];
  const sentences = paragraph.match(/[^。！？]+[。！？]+|[^。！？]+$/g) || [paragraph];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current);
      current = '';
    }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function splitAnswerParagraphs(text, maxLength = ANSWER_PARAGRAPH_MAX_LENGTH) {
  return String(text || '')
    .replace(LIST_MARKER_BEFORE, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxLength));
}

function buildAnswerTextComponents(answer) {
  // Flex 單則訊息有大小上限；總字數維持原本的 2000 字。
  let remaining = 2000;
  const components = [];
  for (const paragraph of splitAnswerParagraphs(answer)) {
    if (remaining <= 0) break;
    const text = paragraph.slice(0, remaining);
    remaining -= text.length;
    // 「一、惡用與犯罪問題：……」這類列點，冒號前的小標題用粗體（Flex span）。
    const heading = text.match(/^((?:[一二三四五六七八九十]{1,2}、|\d{1,2}[.、]|[（(]\d{1,2}[）)])[^。！？：:]{1,20}[：:])(.+)$/s);
    components.push(heading
      ? {
        type: 'text',
        text,
        wrap: true,
        size: 'sm',
        color: '#3D3D3A',
        contents: [
          { type: 'span', text: heading[1], weight: 'bold' },
          { type: 'span', text: heading[2] },
        ],
      }
      : { type: 'text', text, wrap: true, size: 'sm', color: '#3D3D3A' });
  }
  return components;
}

function buildAnswerFlexMessage({ qaResult, courseTitle }) {
  const title = courseTitle || 'FocusFlow 助教';
  const answer = String(qaResult.answer || '').trim() || '目前沒有可以回答的內容。';
  const coursePageUrl = buildWebUrl('/app/courses');
  const citationRows = (qaResult.citations || []).slice(0, 3).map((citation, index) => {
    const videoTitle = citation.videoTitle || citation.sourceVideo?.title || '課程影片';
    const jumpUrl = citationLink(qaResult, citation, index) || coursePageUrl;
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: `${videoTitle}・${formatTimeRange(citation.timestamp)}`,
          size: 'xs',
          color: '#555555',
          wrap: true,
          flex: 1,
        },
        ...(jumpUrl ? [{
          type: 'button',
          style: 'primary',
          color: '#2B4A9B',
          height: 'sm',
          flex: 0,
          action: { type: 'uri', label: '▶ 看這段', uri: jumpUrl },
        }] : []),
      ],
    };
  });

  return {
    type: 'flex',
    altText: `${title}：${answer}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2B4A9B',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', color: '#FFFFFF', wrap: true },
          { type: 'text', text: '根據課程影片回答', size: 'xs', color: '#DDE4F5' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          ...buildDegradationNotices(qaResult).map((notice) => (
            { type: 'text', text: notice, wrap: true, size: 'xxs', color: '#B04A3F' }
          )),
          ...buildAnswerTextComponents(answer),
          ...(citationRows.length ? [{ type: 'separator' }, ...citationRows] : []),
        ],
      },
    },
  };
}

// LINE 輪播最多 12 張卡片；超過時最後一張改成「其他課程」，引導到網站課程頁。
const COURSE_CAROUSEL_LIMIT = 12;

function buildCourseBubble(course, activeCourseId) {
  const title = String(course.title || '未命名課程');
  const isActive = Boolean(activeCourseId) && String(activeCourseId) === String(course._id);
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(isActive ? [{ type: 'text', text: '目前選擇', size: 'xxs', color: '#06C755', weight: 'bold' }] : []),
        { type: 'text', text: title, weight: 'bold', size: 'md', color: '#3D3D3A', wrap: true, maxLines: 3 },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#2B4A9B',
        height: 'sm',
        action: {
          type: 'postback',
          label: '選這門課',
          data: `action=select_course&courseId=${course._id}`,
          displayText: `切換到「${title}」`.slice(0, 300),
        },
      }],
    },
  };
}

function buildMoreCoursesBubble(hiddenCount) {
  const coursePageUrl = buildWebUrl('/app/courses');
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `還有 ${hiddenCount} 門課`, weight: 'bold', size: 'md', color: '#3D3D3A' },
        { type: 'text', text: '請到網站的課程頁，點課程的「詢問助教」。', size: 'xs', color: '#555555', wrap: true },
      ],
    },
    ...(coursePageUrl ? {
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: '開啟課程頁', uri: coursePageUrl },
        }],
      },
    } : {}),
  };
}

// 切換課程輪播：每門課一張卡，左右滑動，取代最多 4 顆按鈕、電腦版只顯示替代文字的 Buttons Template。
function buildCourseCarouselMessage(courses, activeCourseId) {
  const overflow = courses.length > COURSE_CAROUSEL_LIMIT;
  const shown = overflow ? courses.slice(0, COURSE_CAROUSEL_LIMIT - 1) : courses;
  const bubbles = shown.map((course) => buildCourseBubble(course, activeCourseId));
  if (overflow) bubbles.push(buildMoreCoursesBubble(courses.length - shown.length));

  return {
    type: 'flex',
    altText: '請選擇要提問的課程',
    contents: { type: 'carousel', contents: bubbles },
  };
}

// 輪播被 LINE 拒收時的退路：舊的 Buttons Template，最多 4 門課。
function buildCourseButtonsTemplate(courses) {
  return {
    type: 'template',
    altText: '請選擇課程',
    template: {
      type: 'buttons',
      text: '請選擇你要提問的課程。',
      actions: courses.slice(0, 4).map((course) => ({
        type: 'postback',
        label: course.title.slice(0, 20), // LINE 按鈕文字上限 20 字元
        data: `action=select_course&courseId=${course._id}`,
      })),
    },
  };
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

// 主動推播（Push API）。replyToken 只能用一次且有時效，AI 回答太慢時會過期，
// 這時改用 push 把訊息直接送到使用者，避免學生什麼都收不到。
// 注意：push 會計入 LINE 官方帳號的每月訊息則數。
async function pushMessage(lineUserId, messages) {
  const response = await fetch(`${LINE_API_BASE}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.lineChannelAccessToken}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`LINE push failed: ${payload}`);
  }
}

// 先用 reply 回覆；失敗（通常是 replyToken 過期）時改用 push 送給同一位使用者。
async function deliverMessage({ replyToken, lineUserId, messages }) {
  try {
    return await replyMessage(replyToken, messages);
  } catch (replyError) {
    if (!lineUserId || !env.lineChannelAccessToken) throw replyError;
    if (env.nodeEnv !== 'test') {
      console.warn('[LINE] reply failed, falling back to push.', replyError.message);
    }
    await pushMessage(lineUserId, messages);
    return {
      skipped: false,
      reason: LINE_REPLY_REASONS.PUSH_FALLBACK,
    };
  }
}

// 顯示「對方輸入中」的讀取動畫，讓學生知道 AI 正在處理（最長 60 秒）。
// 純體驗用途，失敗不影響提問流程。
async function startLoadingAnimation(lineUserId) {
  if (!lineUserId || !env.lineChannelAccessToken) return;
  try {
    await fetch(`${LINE_API_BASE}/chat/loading/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.lineChannelAccessToken}`,
      },
      body: JSON.stringify({ chatId: lineUserId, loadingSeconds: 60 }),
    });
  } catch {
    // ignore
  }
}

// 產生綁定 Token 並存入資料庫
// 使用 crypto.randomBytes 產生 32 bytes（= 64 字元十六進位）的安全隨機字串
async function generateBindToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期

  await LineBindToken.create({ token, userId, expiresAt });
  return token;
}

// 使用者從網站解除 LINE 綁定：清掉 lineUserId 與 LINE 專用的對話狀態，
// 之後可以重新取得綁定碼綁到另一個 LINE 帳號。
async function unbindLineUser(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const previousLineUserId = user.lineUserId;
  const wasBound = Boolean(previousLineUserId);
  await User.findByIdAndUpdate(userId, {
    $unset: { lineUserId: '', activeCourseId: '', lineFriendStatus: '' },
    $set: {
      lineBindAt: null,
      lineRichMenuId: null,
      lineConversationState: LINE_CONVERSATION_STATES.IDLE,
      lineConversationHistory: [],
    },
  });
  // 解除後回到預設的「連結帳號」選單；失敗不影響解除結果。
  if (wasBound) await unlinkRichMenu(previousLineUserId);

  return { unbound: wasBound };
}

// 所有綁定（LINE Login 與舊綁定碼）都走這裡，規則只有一套：
// 一個 LINE 只能綁一個帳號，已綁在別人帳號上就拒絕，別人的綁定不動；
// 自己的帳號要換 LINE，必須已在網頁確認過（replaceExisting）。
async function bindLineAccount({ userId, lineUserId, replaceExisting = false }) {
  const user = await User.findById(userId);

  if (!user) {
    return { ok: false, reason: 'user_not_found' };
  }

  if (user.lineUserId === lineUserId) {
    await ensureBoundRichMenu(user);
    return { ok: true, alreadyBound: true, replaced: false };
  }

  if (user.lineUserId && !replaceExisting) {
    return { ok: false, reason: 'replace_confirmation_required' };
  }

  if (await User.findOne({ lineUserId })) {
    return { ok: false, reason: 'line_bound_to_other_account' };
  }

  const previousLineUserId = user.lineUserId;
  const replaced = Boolean(previousLineUserId);
  const update = {
    $set: {
      lineUserId,
      lineBindAt: new Date(),
      lineRichMenuId: null,
      lineConversationState: LINE_CONVERSATION_STATES.IDLE,
      ...(replaced ? { lineConversationHistory: [] } : {}),
    },
    ...(replaced ? { $unset: { activeCourseId: '', lineFriendStatus: '' } } : {}),
  };

  // 以讀到的舊值當條件更新：同時有另一個請求改了這個帳號的綁定時不會蓋掉。
  // 上面的查詢擋不住同時送出的請求，最後由 lineUserId 的 unique index 保證唯一。
  try {
    const updated = await User.findOneAndUpdate(
      { _id: user._id, lineUserId: user.lineUserId ?? null },
      update,
    );
    if (!updated) {
      return { ok: false, reason: 'binding_changed' };
    }
  } catch (error) {
    if (error?.code === 11000) {
      return { ok: false, reason: 'line_bound_to_other_account' };
    }
    throw error;
  }

  // 綁定成功後換成「已綁定」選單；換 LINE 時，舊的 LINE 回到預設選單。
  await ensureBoundRichMenu({ _id: user._id, lineUserId, lineRichMenuId: null });
  if (replaced) await unlinkRichMenu(previousLineUserId);

  return { ok: true, alreadyBound: false, replaced };
}

// 綁定碼以單一操作取出並刪除，同一組碼同時送兩次也只有一個拿得到。
async function bindLineUserWithToken(lineUserId, token) {
  const record = await LineBindToken.findOneAndDelete({ token });

  if (!record) {
    return {
      ok: false,
      reason: 'token_not_found',
    };
  }

  if (record.expiresAt < new Date()) {
    return {
      ok: false,
      reason: 'token_expired',
    };
  }

  const binding = await bindLineAccount({ userId: record.userId, lineUserId });

  if (!binding.ok) {
    return binding;
  }

  // 能把綁定碼傳給 Bot，就代表已經是好友。
  await updateLineFriendStatus(lineUserId, LINE_FRIEND_STATUSES.FRIEND);

  return { ok: true, userId: record.userId };
}

// 記下綁定帳號的好友狀態；這個 LINE 沒有綁定任何帳號時不動作。
async function updateLineFriendStatus(lineUserId, status) {
  await User.findOneAndUpdate({ lineUserId }, { $set: { lineFriendStatus: status } });
}

// 綁定碼流程沒有網頁確認畫面，衝突時請學生回網頁處理。
function buildBindConflictText(reason) {
  if (reason === 'line_bound_to_other_account') {
    return '這個 LINE 帳號已綁定其他 FocusFlow 帳號，請先從那個帳號解除綁定。';
  }
  if (reason === 'replace_confirmation_required') {
    return '你的 FocusFlow 帳號已綁定其他 LINE，請先到 FocusFlow 網頁解除綁定後再試一次。';
  }
  return '綁定沒有完成，請回到 FocusFlow 重新操作。';
}

// LINE Login 完成後的歡迎訊息；只傳給已加好友的學生，每次綁定最多一則，失敗不影響綁定結果。
async function sendBindWelcomeMessage(lineUserId) {
  if (!env.lineChannelAccessToken) return false;

  try {
    await pushMessage(lineUserId, [
      buildTextMessage('帳號綁定成功！輸入「切換課程」選擇課程後就可以直接提問。想解除綁定時，請到 FocusFlow 網頁的 LINE 提問頁。'),
    ]);
    return true;
  } catch {
    if (env.nodeEnv !== 'test') {
      console.warn('[LINE Login] welcome message failed.');
    }
    return false;
  }
}

// 從「詢問助教」連結 LINE 時，綁定後切到該課程。課程來自開始時的紀錄，
// 這裡仍重新檢查修課權限；不符合時只是不切換，綁定已經成功。
async function selectCourseForBoundUser(userId, courseId) {
  const user = await User.findById(userId);
  const course = await Course.findById(courseId);
  const enrollment = await findActiveEnrollment(userId, courseId);

  if (!user || !course || course.status !== COURSE_STATUSES.PUBLISHED || !enrollment) {
    return null;
  }

  const liveCourses = await filterCoursesWithLiveVideos([course]);
  if (!liveCourses.length) {
    return null;
  }

  await User.findByIdAndUpdate(userId, courseSelectionUpdate(user, courseId));

  return { id: String(course._id), title: course.title };
}

// 處理「加好友」事件：第一次加好友、封鎖後解除封鎖、刪除好友後重加都會觸發。
// 已綁定的使用者不要再叫他綁定，改成歡迎回來；未綁定才引導完成帳號綁定。
function toPlain(doc) {
  return typeof doc?.toObject === 'function' ? doc.toObject() : { ...doc };
}

async function handleFollow(event) {
  const lineUserId = event.source?.userId;
  const boundUser = lineUserId ? await User.findOne({ lineUserId }) : null;

  if (boundUser) {
    await updateLineFriendStatus(lineUserId, LINE_FRIEND_STATUSES.FRIEND);
    // 綁定時還沒加好友，LINE 會拒絕指定選單；加好友時補做。封鎖後重加是否保留指定未查證，一律重新指定（可重複執行）。
    await ensureBoundRichMenu({ ...toPlain(boundUser), lineRichMenuId: null });
  }

  const text = boundUser
    ? '歡迎回來！你的 LINE 帳號已綁定 FocusFlow，可以直接提問；輸入「切換課程」可更換課程。'
    : '歡迎使用 FocusFlow！按下方按鈕連結帳號，就能直接在 LINE 提問課程內容。';
  const replyResult = await replyMessage(event.replyToken, [
    boundUser ? buildTextMessage(text) : buildBindPromptMessage(text),
  ]);

  return attachReplyMetadata({
    type: 'follow',
    handled: true,
    alreadyBound: Boolean(boundUser),
  }, replyResult);
}

// 學生封鎖官方帳號時不解除綁定（解除封鎖後沿用），只記下好友狀態讓網頁顯示。
// unfollow 事件沒有 replyToken，也不能回覆。
async function handleUnfollow(event) {
  const lineUserId = event.source?.userId;

  if (lineUserId) {
    await updateLineFriendStatus(lineUserId, LINE_FRIEND_STATUSES.NOT_FRIEND);
  }

  return {
    type: 'unfollow',
    handled: Boolean(lineUserId),
    replySent: false,
    replySkipped: true,
    replyReason: 'not_applicable',
  };
}

// 處理帳號綁定：使用者把 64 字元的 token 傳到 LINE Bot 時觸發
// 驗證 token 有效後，把 lineUserId 寫入 User 文件，完成 LINE ↔ 系統帳號的對應
async function handleBind(lineUserId, token, replyToken) {
  const bindResult = await bindLineUserWithToken(lineUserId, token);

  if (bindResult.reason === 'token_not_found') {
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
  if (bindResult.reason === 'token_expired') {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('綁定碼已過期，請重新從系統取得新的綁定碼。'),
    ]);

    return attachReplyMetadata({
      type: 'bind',
      handled: false,
      reason: 'token_expired',
    }, replyResult);
  }

  if (!bindResult.ok) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage(buildBindConflictText(bindResult.reason)),
    ]);

    return attachReplyMetadata({
      type: 'bind',
      handled: false,
      reason: bindResult.reason,
    }, replyResult);
  }

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
// 查詢使用者有權存取的課程，用 Flex 輪播顯示（每門課一張卡）
async function handleSwitchCourse(lineUserId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildBindPromptMessage('請先連結 FocusFlow 帳號，連結後就能直接在這裡提問。')]);

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

  // 每張卡的按鈕用 postback，data 帶 action 和 courseId，交給 handleSelectCourse 解析
  let replyFormat = 'flex';
  let replyResult;
  try {
    replyResult = await replyMessage(replyToken, [
      buildCourseCarouselMessage(selectableCourses, user.activeCourseId),
    ]);
  } catch {
    if (env.nodeEnv !== 'test') {
      console.warn('[LINE] course carousel rejected, falling back to buttons template.');
    }
    replyFormat = 'template';
    replyResult = await replyMessage(replyToken, [buildCourseButtonsTemplate(selectableCourses)]);
  }

  // 送出課程選單後，把狀態改為「等待課程選擇」，避免使用者直接提問
  await User.findByIdAndUpdate(user._id, {
    lineConversationState: LINE_CONVERSATION_STATES.AWAITING_COURSE_SELECTION,
  });

  return attachReplyMetadata({
    type: 'switch_course',
    handled: true,
    replyFormat,
  }, replyResult);
}

// 處理從網頁「詢問助教」連結直接帶入課程 ID 的情境（COURSE:{courseId}）
// 不需要經過 awaiting_course_selection 狀態，直接設定 activeCourseId
async function handleDirectCourseSelect(lineUserId, courseId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [
      buildBindPromptMessage('請先連結 FocusFlow 帳號，再從網站的課程頁進入。'),
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

  await User.findByIdAndUpdate(user._id, courseSelectionUpdate(user, courseId));

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

  if (!bindResult.ok) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage(buildBindConflictText(bindResult.reason)),
    ]);
    return attachReplyMetadata({ type: 'bind_course', handled: false, reason: bindResult.reason }, replyResult);
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

  await User.findByIdAndUpdate(user._id, courseSelectionUpdate(user, courseId));

  const replyResult = await replyMessage(replyToken, [
    buildTextMessage(`LINE 帳號已綁定，並已切換到「${course.title}」。現在可以直接提問。`),
  ]);

  return attachReplyMetadata({ type: 'bind_course', handled: true }, replyResult);
}

async function handleSelectCourse(lineUserId, courseId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildBindPromptMessage('這個 LINE 目前沒有連結 FocusFlow 帳號，請重新連結。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'user_not_bound',
    }, replyResult);
  }

  // 課程卡片上的「選這門課」隨時都能按（包含較早送出的卡片），不必先輸入「切換課程」。
  // postback 只能來自 Bot 自己送出的按鈕（webhook 已驗簽），而且下面每次都重新檢查修課權限。
  if (!/^[a-f0-9]{24}$/i.test(String(courseId || ''))) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('找不到這門課程，請輸入「切換課程」重新選擇。')]);

    return attachReplyMetadata({
      type: 'select_course',
      handled: false,
      reason: 'course_id_invalid',
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
  await User.findByIdAndUpdate(user._id, courseSelectionUpdate(user, courseId));

  const replyResult = await replyMessage(replyToken, [buildTextMessage('課程切換成功，現在可以直接提問。')]);

  return attachReplyMetadata({
    type: 'select_course',
    handled: true,
  }, replyResult);
}

// 降級警示：問答沒有走完整流程時，在回覆上標出來，方便發現並修好降級本身。
// 以下 [MVP提示] / [MVP fallback] 是刻意保留的診斷資訊，降級修好前不要拿掉。
function buildDegradationNotices(qaResult) {
  const notices = [];
  const fallbacks = qaResult.runtime?.fallbacks || [];

  if (qaResult.runtime?.matchStatus === 'no_searchable_segments') {
    notices.push('[MVP提示] 這門課目前沒有可搜尋片段。');
  }
  if (fallbacks.some((item) => item.stage === 'retrieval')) {
    notices.push('[MVP fallback] 檢索已改走 lexical ranking。');
  }
  if (fallbacks.some((item) => item.stage === 'answer')) {
    notices.push('[MVP fallback] Gemini 暫時不可用，已改用 template answer。');
  }
  return notices;
}

// 純文字版回答：回答卡被 LINE 拒收時的備援。包含降級警示、AI 答案、片段時間與影片跳轉連結。
function buildQuestionSummaryLines(qaResult) {
  const [topCitation] = qaResult.citations || [];
  const summaryLines = [...buildDegradationNotices(qaResult), qaResult.answer];

  // 附上最相關片段的時間區間，讓使用者知道答案來自影片哪個位置
  if (topCitation) {
    summaryLines.push(`片段：${formatTimeRange(topCitation.timestamp)}`);
  }

  const jumpUrl = topCitation ? citationLink(qaResult, topCitation, 0) : null;

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

// 字數或每日次數限制的回覆；其他錯誤回傳 null 讓呼叫端照原本流程處理。
function buildAskLimitMessage(error) {
  if (error?.code === 'QUESTION_TOO_LONG') {
    const limit = error.details?.limit;
    return {
      reason: 'question_too_long',
      text: `問題太長了，請精簡到 ${limit} 個字以內再問一次。`,
    };
  }
  if (error?.code === 'QA_DAILY_LIMIT_EXCEEDED') {
    const limit = error.details?.limit;
    return {
      reason: 'daily_limit_reached',
      text: `今天的提問次數已用完（每天 ${limit} 次，網頁與 LINE 合併計算），明天再來問吧！`,
    };
  }
  return null;
}

// 把 QA 錯誤轉成使用者看得懂的中文提示訊息
// 把 QA 錯誤轉成提示訊息；[MVP hard-fail] 是刻意保留的診斷資訊，降級修好前不要拿掉。
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
    const replyResult = await replyMessage(replyToken, [buildBindPromptMessage('請先連結 FocusFlow 帳號，連結後就能直接在這裡提問。')]);

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
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先輸入「切換課程」，再開始提問。')]);

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

  // 字數上限與每日提問次數（與網頁合併計算）；超過時回覆原因，不呼叫 AI、不記為失敗。
  const askingUser = {
    id: String(user._id),
    role: user.role,
    dailyAskLimitOverride: user.dailyAskLimitOverride,
  };
  try {
    await assertCanAsk({ user: askingUser, question: text });
  } catch (limitError) {
    const limitReply = buildAskLimitMessage(limitError);
    if (!limitReply) throw limitError;
    const replyResult = await replyMessage(replyToken, [buildTextMessage(limitReply.text)]);
    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: limitReply.reason,
      errorCode: limitError.code,
    }, replyResult);
  }

  // AI 回答通常要 10～20 秒，先顯示讀取動畫
  await startLoadingAnimation(lineUserId);

  // 讀取之前的對話歷史，傳給 QA service 讓 AI 有上下文可以理解追問
  const conversationHistory = getBoundedLineConversationHistory(user.lineConversationHistory);
  const contextualization = contextualizeQuestion({
    recentConversationHistory: mapLineHistoryForContextualizer(conversationHistory),
    currentQuestion: text,
  });

  let qaResult;

  try {
    qaResult = await askQuestion({
      user: askingUser,
      courseId: String(user.activeCourseId),
      question: text,
      retrievalQuestion: contextualization.standaloneQuestion,
      source: 'line',   // 標記來源，QA service 可用來區分前端和 LINE Bot 的請求
      conversationHistory: conversationHistory.length ? conversationHistory : null,
      contextualization,
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

    const replyResult = await deliverMessage({
      replyToken,
      lineUserId,
      messages: [buildTextMessage(failureMessage)],
    });

    return attachReplyMetadata({
      type: 'question',
      handled: false,
      reason: mapQaFailureReason(error),
      errorCode: error?.code || 'INTERNAL_SERVER_ERROR',
      qaRuntime: failureRuntime,
    }, replyResult);
  }

  // 把這次對話追加進歷史，並依設定保留最近的問答輪數
  const updatedHistory = getBoundedLineConversationHistory([
    ...conversationHistory,
    { role: 'user', content: text },
    { role: 'model', content: qaResult.answer },
  ]);

  await User.findByIdAndUpdate(user._id, { lineConversationHistory: updatedHistory });

  // 把所有回答行用換行合併成一則訊息傳給使用者
  // AI 回答可能花了十幾秒，replyToken 過期時 deliverMessage 會改用 push 送出。
  let replyFormat = 'flex';
  let replyResult;
  try {
    replyResult = await deliverMessage({
      replyToken,
      lineUserId,
      messages: [buildAnswerFlexMessage({ qaResult, courseTitle: activeCourse.title })],
    });
  } catch {
    // 卡片被 LINE 拒收（例如內容超出限制）時改送純文字，學生一定收得到答案。
    if (env.nodeEnv !== 'test') {
      console.warn('[LINE] flex answer rejected, falling back to text.');
    }
    replyFormat = 'text';
    replyResult = await deliverMessage({
      replyToken,
      lineUserId,
      messages: [buildTextMessage(buildQuestionSummaryLines(qaResult).join('\n'))],
    });
  }

  return attachReplyMetadata({
    type: 'question',
    handled: true,
    replyFormat,
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
// 使用說明用 Flex 輪播（手機與電腦版 LINE 都能顯示），每一步一張卡片；
// 不支援 Flex 的環境顯示 altText 的純文字版。顏色沿用圖文選單圖片。
const HELP_COLORS = { header: '#1F4E5F', accent: '#E8A93A', text: '#333333', muted: '#777777' };

const LINE_HELP_TEXT = [
  'FocusFlow 使用說明',
  '1. 先按「切換課程」選擇要提問的課程。',
  '2. 直接輸入問題，例如「這週講的遞迴是什麼？」，回答會附上影片片段與時間。',
  '3. 按「今日額度」看今天還能問幾次。',
  '4. 按「網頁版」開啟 FocusFlow 看完整影片與對話紀錄。',
  '電腦版 LINE 沒有下方選單，可以直接輸入「切換課程」「今日額度」「使用說明」。',
].join('\n');

function buildHelpBubble({ step, title, lines, button }) {
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: HELP_COLORS.header,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: step, size: 'xs', weight: 'bold', color: HELP_COLORS.accent },
        { type: 'text', text: title, size: 'lg', weight: 'bold', color: '#FFFFFF', margin: 'sm', wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: lines.map((line, index) => ({
        type: 'text',
        text: line,
        size: 'sm',
        wrap: true,
        color: index === 0 ? HELP_COLORS.text : HELP_COLORS.muted,
      })),
    },
    ...(button ? {
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: HELP_COLORS.header, height: 'sm', action: button }],
      },
    } : {}),
  };
}

function buildHelpMessage({ bound }) {
  // 網址沿用 buildWebUrl（以 LINE_LOGIN_CALLBACK_URL 的網站為準）；沒設定時卡片不放網址按鈕。
  const linkUrl = buildWebUrl('/app/line');
  const webUrl = buildWebUrl('/app');
  const steps = [];

  if (!bound) {
    steps.push({
      title: '先連結 FocusFlow 帳號',
      lines: ['連結後，LINE 才知道你是誰、修了哪些課。', '到 FocusFlow 網頁的「LINE 提問」頁完成連結，之後就能在 LINE 直接提問。'],
      button: linkUrl ? { type: 'uri', label: '前往連結', uri: linkUrl } : null,
    });
  }
  steps.push(
    {
      title: '選擇課程',
      lines: ['先選要提問的課程，回答只會引用這門課的影片。', '之後想換課，再按一次「切換課程」。'],
      button: bound ? { type: 'postback', label: '切換課程', data: 'action=switch_course', displayText: '切換課程' } : null,
    },
    {
      title: '直接輸入問題',
      lines: ['例如「這週講的遞迴是什麼？」', '回答會附上影片片段與時間，點連結就能跳到那一段。'],
      button: null,
    },
    {
      title: '查看今日額度',
      lines: ['每天可提問的次數有上限，網頁與 LINE 合併計算。', '每天 00:00（台灣時間）重置。'],
      button: bound ? { type: 'postback', label: '今日額度', data: 'action=today_quota', displayText: '今日額度' } : null,
    },
    {
      title: '在網頁看完整內容',
      lines: ['網頁版可以看完整影片、對話紀錄與教學短片。', '電腦版 LINE 沒有下方選單，可直接輸入「切換課程」「今日額度」「使用說明」。'],
      button: webUrl ? { type: 'uri', label: '開啟網頁版', uri: webUrl } : null,
    },
  );

  const altText = bound
    ? LINE_HELP_TEXT
    : `${LINE_HELP_TEXT}\n\n你還沒連結 FocusFlow 帳號，請先到 FocusFlow 網頁的「LINE 提問」頁連結。`;

  return {
    type: 'flex',
    // altText 上限 1500 字。
    altText: altText.slice(0, 1500),
    contents: {
      type: 'carousel',
      contents: steps.map((item, index) => buildHelpBubble({ ...item, step: `STEP ${index + 1}` })),
    },
  };
}

// 使用說明不需要綁定，未綁定時第一張卡片改成連結帳號。
async function handleHelp(lineUserId, replyToken) {
  const user = await User.findOne({ lineUserId });
  const replyResult = await replyMessage(replyToken, [buildHelpMessage({ bound: Boolean(user) })]);
  return attachReplyMetadata({ type: 'help', handled: true }, replyResult);
}

function formatAskLimitLine() {
  return env.qaMaxQuestionLength > 0 ? `每題最多 ${env.qaMaxQuestionLength} 字。` : '';
}

// 今日額度：與網頁合併計算（askLimits.service）；教師、管理員或上限為 0 時不限次數。
async function handleTodayQuota(lineUserId, replyToken) {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    const replyResult = await replyMessage(replyToken, [buildTextMessage('請先完成帳號綁定。')]);
    return attachReplyMetadata({ type: 'today_quota', handled: false, reason: 'user_not_bound' }, replyResult);
  }

  const usage = await getDailyAskUsage({
    id: String(user._id),
    role: user.role,
    dailyAskLimitOverride: user.dailyAskLimitOverride,
  });
  const lines = usage
    ? [
      `今天還能問 ${usage.remaining} 次（每天 ${usage.limit} 次，已用 ${usage.used} 次）。`,
      '每天 00:00（台灣時間）重置，網頁與 LINE 合併計算。',
    ]
    : ['今天的提問次數沒有限制。'];
  const lengthLine = formatAskLimitLine();
  if (lengthLine) lines.push(lengthLine);

  const replyResult = await replyMessage(replyToken, [buildTextMessage(lines.join('\n'))]);
  return attachReplyMetadata({ type: 'today_quota', handled: true }, replyResult);
}

// 圖文選單按鈕送 postback（不送文字），避免學生自己打的字被當成指令；
// 文字指令另外保留給電腦版 LINE（沒有圖文選單）與官方帳號後台的舊選單。
const LINE_MENU_TEXT_COMMANDS = new Map([
  ['切換課程', 'switch_course'],
  ['今日額度', 'today_quota'],
  ['使用說明', 'help'],
]);

function handleMenuAction(action, lineUserId, replyToken) {
  if (action === 'switch_course') return handleSwitchCourse(lineUserId, replyToken);
  if (action === 'today_quota') return handleTodayQuota(lineUserId, replyToken);
  if (action === 'help') return handleHelp(lineUserId, replyToken);
  return null;
}

async function processWebhookEvent(event) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;

  // 使用者加好友
  if (event.type === 'follow') {
    return handleFollow(event);
  }

  if (event.type === 'unfollow') {
    return handleUnfollow(event);
  }

  // 只處理一對一聊天且帶有 userId 的事件。
  // 缺 userId 時 User.findOne({ lineUserId: undefined }) 會被當成空條件，
  // 抓到資料庫第一個使用者，等於讓任何人冒用他的身分；群組或多人聊天室的
  // 回答也會被其他成員看到，所以一律拒絕並請使用者改用一對一聊天。
  const sourceType = event.source?.type;
  if ((event.type === 'message' || event.type === 'postback')
      && (!lineUserId || (sourceType && sourceType !== 'user'))) {
    const replyResult = await replyMessage(replyToken, [
      buildTextMessage('請在與 FocusFlow 的一對一聊天室中使用提問功能，群組或多人聊天室不支援。'),
    ]);
    return attachReplyMetadata({
      type: event.type,
      handled: false,
      reason: 'line_user_unidentified',
    }, replyResult);
  }

  // 已綁定但還沒拿到目前選單的人（上線前就綁定、綁定時還沒加好友）在這裡補指定；失敗不影響本次回覆。
  if (event.type === 'message' || event.type === 'postback') {
    const boundUser = await User.findOne({ lineUserId });
    if (boundUser) await ensureBoundRichMenu(boundUser);
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

    // 選單文字指令：「切換課程」「今日額度」「使用說明」
    if (LINE_MENU_TEXT_COMMANDS.has(text)) {
      return handleMenuAction(LINE_MENU_TEXT_COMMANDS.get(text), lineUserId, replyToken);
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

    // 圖文選單按鈕（action=switch_course／today_quota／help）
    const menuResult = handleMenuAction(action, lineUserId, replyToken);
    if (menuResult) return menuResult;
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
  bindLineAccount,
  updateLineFriendStatus,
  selectCourseForBoundUser,
  sendBindWelcomeMessage,
  unbindLineUser,
  processWebhookEvents,
  buildQuestionSummaryLines,
  buildAnswerFlexMessage,
  splitAnswerParagraphs,
  buildCourseCarouselMessage,
  buildHelpMessage,
  formatClock,
  mapLineHistoryForContextualizer,
};
