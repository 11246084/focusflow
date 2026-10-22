const express = require('express');
const env = require('../config/env');
const AppError = require('../utils/appError');
const qaController = require('../controllers/qa.controller');
const openDataExtensionController = require('../controllers/openDataExtension.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// Feature flag：預設關閉。關閉時這條路由回 404，未啟用的功能不讓外部得知它存在。
// 只掛在單一路由上，不影響 /ask。
function requireOpenDataExtensionEnabled(req, res, next) {
  if (!env.openDataExtensionEnabled) {
    return next(new AppError('Not found.', 404, 'NOT_FOUND'));
  }
  return next();
}

router.use(authenticate);
router.post('/ask', qaController.askQuestion);
router.post(
  '/extended-resources',
  requireOpenDataExtensionEnabled,
  openDataExtensionController.getExtendedResources,
);

module.exports = router;
