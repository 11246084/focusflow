const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const lineService = require('../services/line.service');
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

module.exports = {
  handleWebhook,
  issueBindToken,
};
