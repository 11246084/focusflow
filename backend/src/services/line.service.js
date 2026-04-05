const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user.model');

const LINE_API_BASE = 'https://api.line.me/v2/bot';

// ── 送訊息給使用者 ──────────────────────────────────────────
const replyMessage = async (replyToken, messages) => {
  const res = await fetch(`${LINE_API_BASE}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error('[LINE] replyMessage error:', err);
  }
};

// ── 產生綁定 token ──────────────────────────────────────────
const generateBindToken = async (userId) => {
  const LineBindToken = require('../models/lineBindToken.model');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期

  await LineBindToken.create({ token, userId, expiresAt });

  return token;
};

// ── 處理 follow 事件（掃 QR Code 加好友並帶 token）──────────
const handleFollow = async (event) => {
  const lineUserId = event.source.userId;
  const replyToken = event.replyToken;

  // 檢查是否帶有綁定 token（透過 liff 或 line://app 傳入）
  // 目前先回覆歡迎訊息，綁定由 handleMessage 處理
  await replyMessage(replyToken, [
    {
      type: 'text',
      text: '歡迎使用 FocusFlow！\n請輸入你的綁定驗證碼，或透過網頁掃描 QR Code 完成綁定。',
    },
  ]);
};

// ── 處理綁定（收到 token 字串）──────────────────────────────
const handleBind = async (lineUserId, token, replyToken) => {
  const LineBindToken = require('../models/lineBindToken.model');

  const record = await LineBindToken.findOne({ token });

  if (!record) {
    await replyMessage(replyToken, [
      { type: 'text', text: '驗證碼無效或已過期，請重新從網頁取得 QR Code。' },
    ]);
    return;
  }

  if (record.expiresAt < new Date()) {
    await LineBindToken.deleteOne({ token });
    await replyMessage(replyToken, [
      { type: 'text', text: '驗證碼已過期，請重新從網頁取得 QR Code。' },
    ]);
    return;
  }

  // 寫入 lineUserId
  await User.findByIdAndUpdate(record.userId, {
    lineUserId,
    lineBindAt: new Date(),
  });

  // 刪除用過的 token
  await LineBindToken.deleteOne({ token });

  await replyMessage(replyToken, [
    { type: 'text', text: '綁定成功！🎉 你現在可以直接輸入問題來查詢課程影片。' },
  ]);
};

// ── 處理切換課程 ────────────────────────────────────────────
const handleSwitchCourse = async (lineUserId, replyToken) => {
  const Enrollment = require('../models/enrollment.model');

  const user = await User.findOne({ lineUserId });
  if (!user) {
    await replyMessage(replyToken, [
      { type: 'text', text: '請先完成帳號綁定。' },
    ]);
    return;
  }

  const enrollments = await Enrollment.find({ userId: user._id }).populate('courseId');

  if (!enrollments.length) {
    await replyMessage(replyToken, [
      { type: 'text', text: '你目前沒有選修任何課程。' },
    ]);
    return;
  }

  // 用按鈕模板讓學生選課程
  const actions = enrollments.map((e) => ({
    type: 'postback',
    label: e.courseId.title.slice(0, 20), // LINE 限制 20 字
    data: `action=select_course&courseId=${e.courseId._id}`,
  }));

  await replyMessage(replyToken, [
    {
      type: 'template',
      altText: '請選擇課程',
      template: {
        type: 'buttons',
        text: '請選擇你要查詢的課程：',
        actions: actions.slice(0, 4), // LINE 按鈕模板最多 4 個
      },
    },
  ]);
};

// ── 處理選課 postback ───────────────────────────────────────
const handleSelectCourse = async (lineUserId, courseId, replyToken) => {
  const user = await User.findOneAndUpdate(
    { lineUserId },
    { activeCourseId: new mongoose.Types.ObjectId(courseId) },
    { new: true }
  );

  if (!user) {
    await replyMessage(replyToken, [{ type: 'text', text: '找不到使用者，請重新綁定。' }]);
    return;
  }

  await replyMessage(replyToken, [
    { type: 'text', text: '課程已切換！你現在可以輸入問題了。' },
  ]);
};

// ── 處理問答（預留，之後接 embedding 搜尋）─────────────────
const handleQuestion = async (lineUserId, text, replyToken) => {
  const user = await User.findOne({ lineUserId });

  if (!user) {
    await replyMessage(replyToken, [
      { type: 'text', text: '請先完成帳號綁定。' },
    ]);
    return;
  }

  if (!user.activeCourseId) {
    await replyMessage(replyToken, [
      { type: 'text', text: '請先選擇課程，輸入「切換課程」來選擇。' },
    ]);
    return;
  }

  // TODO: 接 embedding 搜尋 video_segments
  await replyMessage(replyToken, [
    { type: 'text', text: `收到你的問題：「${text}」\n正在搜尋相關影片片段...（功能開發中）` },
  ]);
};

module.exports = {
  handleFollow,
  handleBind,
  handleSwitchCourse,
  handleSelectCourse,
  handleQuestion,
  generateBindToken,
};
