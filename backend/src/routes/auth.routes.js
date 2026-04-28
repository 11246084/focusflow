// 引入 Express 框架
const express = require('express');
// 引入自己寫的 auth controller 模組（相對路徑），負責處理 HTTP 請求
const authController = require('../controllers/auth.controller');
// 引入 auth middleware，負責驗證 JWT Token
const { authenticate } = require('../middleware/auth.middleware');

// 建立 Express Router 實例，用於定義路由
const router = express.Router();

// ========== 路由定義 ==========

// POST /api/v1/auth/login
// 功能：使用者登入
// middleware：無（登入前不需要驗證身份）
router.post('/login', authController.login);

// GET /api/v1/auth/me
// 功能：取得當前登入使用者的資訊
// middleware：authenticate - 驗證 JWT Token，確認用戶已登入
router.get('/me', authenticate, authController.me);

// 匯出 router，供 app.js 註冊路由使用
module.exports = router;
