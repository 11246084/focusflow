const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { USER_ROLES } = require('../constants/enums');
const adminController = require('../controllers/admin.controller');
const notificationController = require('../controllers/notification.controller');
const youtubeAdminController = require('../controllers/youtubeAdmin.controller');

const router = express.Router();

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

router.get('/youtube-lifecycle/settings', youtubeAdminController.getLifecycleSettings);
router.patch('/youtube-lifecycle/settings', youtubeAdminController.updateLifecycleSwitch);
router.get('/youtube-lifecycle/cleanup-preview', youtubeAdminController.getCleanupPreview);
router.post('/youtube-lifecycle/recovery/run', youtubeAdminController.runRecoveryNow);
router.get('/youtube-quarantine', youtubeAdminController.listQuarantine);
router.post('/youtube-quarantine/videos/:videoId/lookup', youtubeAdminController.lookupQuarantinedVideo);
router.post('/youtube-quarantine/short-assets/:assetId/lookup', youtubeAdminController.lookupQuarantinedShortAsset);
router.post('/youtube-quarantine/videos/:videoId/apply', youtubeAdminController.applyQuarantinedVideo);
router.post('/youtube-quarantine/short-assets/:assetId/apply', youtubeAdminController.applyQuarantinedShortAsset);
router.post('/youtube-quarantine/videos/:videoId/reset', youtubeAdminController.resetQuarantinedVideo);
router.post('/youtube-quarantine/short-assets/:assetId/reset', youtubeAdminController.resetQuarantinedShortAsset);

router.get('/stats', adminController.getStats);
router.get('/users', adminController.listUsers);
router.patch('/users/:userId', adminController.updateUser);
router.get('/videos', adminController.listVideos);
router.delete('/videos/:videoId', adminController.deleteVideo);
router.get('/events', adminController.getRecentEvents);
router.get('/event-stats', adminController.getEventStats);
router.get('/system-status', adminController.getSystemStatus);
router.post('/notifications', notificationController.broadcastSystemNotification);
router.get('/feedback', adminController.listFeedback);
router.patch('/feedback/:feedbackId', adminController.updateFeedback);

module.exports = router;
