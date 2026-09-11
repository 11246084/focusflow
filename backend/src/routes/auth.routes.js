// 引入 Express 框架
const express = require('express');
// 引入自己寫的 auth controller 模組（相對路徑），負責處理 HTTP 請求
const authController = require('../controllers/auth.controller');
// 引入 auth middleware，負責驗證 JWT Token
const { authenticate } = require('../middleware/auth.middleware');
const { uploadSingleAvatar } = require('../middleware/avatarUpload.middleware');

// 建立 Express Router 實例，用於定義路由
const router = express.Router();

// ========== 路由定義 ==========

// POST /api/v1/auth/login
// 功能：使用者登入
// middleware：無（登入前不需要驗證身份）
router.post('/login', authController.login);

// POST /api/v1/auth/register
// 功能：使用者自助註冊（限 student / teacher）
// middleware：無
router.post('/register', authController.register);

// 忘記密碼：先寄 6 位數驗證碼到信箱，再用驗證碼設定新密碼（皆不需登入）
router.post('/password-reset/request', authController.requestPasswordReset);
router.post('/password-reset/confirm', authController.confirmPasswordReset);

// GET /api/v1/auth/me
// 功能：取得當前登入使用者的資訊
// middleware：authenticate - 驗證 JWT Token，確認用戶已登入
router.get('/me', authenticate, authController.me);
// PATCH /api/v1/auth/me — 修改自己的姓名／Email（改 Email 需目前密碼）
router.patch('/me', authenticate, authController.updateMe);
// PATCH /api/v1/auth/me/password — 使用者自行修改密碼（需提供目前密碼）
router.patch('/me/password', authenticate, authController.changePassword);
// Avatar files stay private: authentication gates both upload replacement and binary reads.
router.put('/me/avatar', authenticate, uploadSingleAvatar, authController.updateAvatar);
router.get('/me/avatar', authenticate, authController.getAvatar);

// 匯出 router，供 app.js 註冊路由使用
module.exports = router;
