const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { assertObjectId } = require('../utils/objectId');
const AppError = require('../utils/appError');
const lineService = require('../services/line.service');
const lineLoginService = require('../services/lineLogin.service');
const { buildLineRuntimeSnapshot } = require('../services/runtimeDiagnostics.service');

// POST /api/v1/line/webhook
// 接收 LINE 平台傳來的事件陣列，交給 service 逐一處理後回傳結果
// LINE 要求 Webhook 端點必須在 1 秒內回應，實際處理可以非同步進行
const handleWebhook = asyncHandler(async (req, res) => {
  // LINE 送來的事件包在 req.body.events 陣列裡；若格式不符合預期則視為空陣列
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const result = await lineService.processWebhookEvents(events);

  return sendSuccess(res, {
    message: 'LINE webhook processed.',
    data: result,
  });
});

// POST /api/v1/line/bind-token（需要 JWT 登入）
// 幫目前登入的使用者產生一個 10 分鐘效期的綁定碼
// 使用者把這個碼傳到 LINE Bot 後，Bot 就能把 LINE 帳號對應到系統帳號
const issueBindToken = asyncHandler(async (req, res) => {
  // req.user 由 authenticate middleware 注入，id 是 MongoDB 的 userId
  const token = await lineService.generateBindToken(req.user.id);
  // 計算過期時間（現在 + 10 分鐘），方便前端顯示倒數
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Bind token issued.',
    data: { token, expiresAt },
    meta: {
      // 附上 LINE 環境設定快照，方便前端或開發者診斷目前 LINE Bot 是否已正確設定
      lineRuntime: buildLineRuntimeSnapshot(),
    },
  });
});

// POST /api/v1/line/login/start（需要登入）
// 只接受 courseId 與 replaceExisting：沒有任何欄位能指定 LINE 身分或導回網址
const startLineLogin = asyncHandler(async (req, res) => {
  const courseId = req.body?.courseId || null;
  if (courseId) assertObjectId(courseId, 'course');

  const result = await lineLoginService.startLineLogin({
    userId: req.user.id,
    sid: req.auth.payload.sid,
    courseId,
    replaceExisting: req.body?.replaceExisting === true,
  });

  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, {
    statusCode: 201,
    message: 'LINE login started.',
    data: result,
  });
});

// POST /api/v1/line/login/complete（需要登入）
const completeLineLogin = asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const state = String(req.body?.state || '').trim();
  if (!code || !state) {
    throw new AppError('code and state are required.', 400, 'VALIDATION_ERROR');
  }

  const result = await lineLoginService.completeLineLogin({
    userId: req.user.id,
    sid: req.auth.payload.sid,
    code,
    state,
  });

  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, {
    message: 'LINE account linked.',
    data: result,
  });
});

// DELETE /api/v1/line/binding（需要 JWT 登入）
// 解除目前使用者的 LINE 綁定，讓學生可以改綁另一個 LINE 帳號
const unbindLine = asyncHandler(async (req, res) => {
  const result = await lineService.unbindLineUser(req.user.id);

  return sendSuccess(res, {
    message: 'LINE account unbound.',
    data: result,
  });
});

module.exports = {
  handleWebhook,
  issueBindToken,
  startLineLogin,
  completeLineLogin,
  unbindLine,
};
