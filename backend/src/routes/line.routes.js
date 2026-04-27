const express = require('express');
const lineSignature = require('../middleware/lineSignature.middleware');
const lineController = require('../controllers/line.controller');
const { authenticate } = require('../middleware/auth.middleware');
const AppError = require('../utils/appError');

const router = express.Router();

// LINE Webhook 的 body 在進到 Express 時是原始 Buffer（因為 app.js 保留了 rawBody 給簽章驗證用）
// 這個函式負責在簽章驗證通過後，把 Buffer 手動轉成 JSON 物件，讓後續程式碼能正常讀取
function parseLineJsonBody(req, res, next) {
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString('utf8'));
    } catch {
      return next(new AppError('Invalid JSON body.', 400, 'VALIDATION_ERROR'));
    }
  }
  return next();
}

// GET /api/v1/line/webhook
// LINE Developer Console 設定 Webhook URL 時會發送 GET 請求驗證端點是否存在
// 直接回傳 200 OK 即可
router.get('/webhook', (req, res) => res.sendStatus(200));

// POST /api/v1/line/webhook
// LINE 伺服器有事件發生時（用戶傳訊息、加好友等）會 POST 到這裡
// middleware 執行順序：① lineSignature（驗證請求確實來自 LINE）→ ② parseLineJsonBody（解析 body）→ ③ controller
router.post('/webhook', lineSignature, parseLineJsonBody, lineController.handleWebhook);

// POST /api/v1/line/bind-token
// 已登入的系統使用者呼叫此 API 取得一次性綁定碼
// authenticate 確保只有登入用戶才能拿到 token
router.post('/bind-token', authenticate, lineController.issueBindToken);

module.exports = router;
