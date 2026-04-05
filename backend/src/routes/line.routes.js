const express = require('express');
const router = express.Router();
const lineSignature = require('../middleware/lineSignature.middleware');
const lineController = require('../controllers/line.controller');

// 接收 LINE 事件（需要驗證簽章）
router.post('/webhook', lineSignature, lineController.handleWebhook);

// 產生綁定 QR Code 用的 token（需要登入，由網頁端呼叫）
router.post('/bind/token', lineController.generateBindToken);

module.exports = router;
