const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/appError');

// LINE 官方規定：每次送來的 Webhook 請求都要帶 x-line-signature header
// 這個 middleware 負責在進入 controller 前先驗證這個簽章
// 目的：確保請求真的來自 LINE 伺服器，而不是任何人偽造的
function lineSignature(req, res, next) {
  // 從 request header 取出 LINE 送來的簽章值
  const signature = req.headers['x-line-signature'];

  // 沒有簽章 → 直接拒絕，不往下執行
  if (!signature) {
    return next(new AppError('Missing LINE signature.', 401, 'LINE_SIGNATURE_MISSING'));
  }

  // 沒有設定 LINE Channel Secret → 伺服器設定錯誤
  if (!env.lineChannelSecret) {
    return next(new AppError('LINE_CHANNEL_SECRET is not configured.', 500, 'LINE_NOT_CONFIGURED'));
  }

  // 簽章計算需要原始的 request body（未被 JSON.parse 的原始 Buffer）
  // app.js 在 express.json() 的 verify 選項中會把原始 body 存到 req.rawBody
  const rawBody = req.rawBody ?? req.body;
  if (!rawBody) {
    return next(new AppError('LINE raw request body is not available.', 400, 'LINE_RAW_BODY_MISSING'));
  }

  // 用 LINE Channel Secret 對原始 body 做 HMAC-SHA256 雜湊，再轉成 base64
  // 這是 LINE 官方的簽章計算方式
  const expectedSignature = crypto
    .createHmac('sha256', env.lineChannelSecret)
    .update(rawBody)
    .digest('base64');

  // 比對計算出的簽章和 LINE 送來的簽章是否一致
  // 不一致代表請求被篡改或來源不明，拒絕
  if (expectedSignature !== signature) {
    return next(new AppError('Invalid LINE signature.', 401, 'LINE_SIGNATURE_INVALID'));
  }

  // 驗證通過，繼續執行下一個 middleware 或 controller
  return next();
}

module.exports = lineSignature;
