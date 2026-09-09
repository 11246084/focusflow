const express = require('express');
const env = require('../config/env');
const AppError = require('../utils/appError');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');
const { uploadSingleVideo } = require('../middleware/upload.middleware');
const controller = require('../controllers/shortScript.controller');

const router = express.Router();

// Feature flag（規格書 G.1）：預設關閉。關閉時整組路由不存在，而不是回 403——
// 未啟用的功能不該讓外部得知它存在。
function requireFeatureEnabled(req, res, next) {
  if (!env.shortScriptAutomationEnabled) {
    return next(new AppError('Not found.', 404, 'NOT_FOUND'));
  }
  return next();
}

// guard 必須掛在每一條路由上，不能用 router.use()。這個 router 掛在 '/'，
// router 層級的 middleware 會攔截所有經過的請求——包含其他 router 的路徑，
// 導致 feature flag 關閉時整個 API 都變成 404。
const guard = [requireFeatureEnabled, authenticate, authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN)];

// 唯讀候選預覽：不建立腳本、不呼叫 LLM。
router.get('/courses/:courseId/short-scripts/candidates', guard, controller.listCandidates);
router.get('/courses/:courseId/short-scripts', guard, controller.listScripts);
router.post('/courses/:courseId/short-scripts/auto', guard, controller.createScript);

router.get('/short-scripts/:scriptId', guard, controller.getScript);
router.post('/short-scripts/:scriptId/generate', guard, controller.generateVersion);
router.post('/short-scripts/:scriptId/review', guard, controller.reviewScript);

// 上架（施工單 WO-08）。教師上傳只建立 draft；實際上架由成品審核通過觸發（規格書 R-08）。
// multer 必須排在 guard 之後，否則 feature flag 關閉或未授權時仍會先把檔案寫到磁碟。
router.post('/short-scripts/:scriptId/asset', guard, uploadSingleVideo, controller.uploadAsset);
router.post('/short-assets/:assetId/upload/retry', guard, controller.retryAssetUpload);
router.get('/courses/:courseId/short-assets', guard, controller.listAssets);

module.exports = router;
