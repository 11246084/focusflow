const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { createRecutConsentController } = require('../controllers/recutConsent.controller');

// No automation feature flag: content consent is a prerequisite of video upload.
function createRecutConsentRouter({ service, authentication = authenticate } = {}) {
  const router = express.Router();
  const controller = createRecutConsentController(service);
  const guard = [authentication, authorizeRoles('teacher', 'admin')];
  router.get('/recut-consent/terms', guard, controller.getTerms);
  router.get('/courses/:courseId/recut-consent', guard, controller.getConsent);
  router.post('/courses/:courseId/recut-consent', guard, controller.recordConsent);
  router.get('/courses/:courseId/recut-consent/withdrawal-assets', guard, controller.listWithdrawalAssets);
  router.post('/courses/:courseId/recut-consent/withdrawals', guard, controller.withdraw);
  router.post('/courses/:courseId/recut-consent/withdrawals/:withdrawalId/retry', guard, controller.retryWithdrawal);
  router.get('/admin/recut-consent/manual-actions', authentication, authorizeRoles('admin'), controller.listManualActions);
  return router;
}
module.exports = createRecutConsentRouter();
module.exports.createRecutConsentRouter = createRecutConsentRouter;
