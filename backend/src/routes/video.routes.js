const express = require('express');
const videoController = require('../controllers/video.controller');
const videoBatchController = require('../controllers/videoBatch.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const {
  uploadSingleVideo,
  uploadVideoBatch,
  validateVideoBatchMetadata,
} = require('../middleware/upload.middleware');
const { USER_ROLES } = require('../constants/enums');

const router = express.Router();

router.use(authenticate);

router.post(
  '/courses/:courseId/videos/youtube',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoController.createYouTubeVideo,
);
router.post(
  '/courses/:courseId/videos',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  uploadSingleVideo,
  videoController.createVideo,
);
router.get('/courses/:courseId/videos', videoController.listCourseVideos);
router.post(
  '/courses/:courseId/videos/:videoId/attach',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoController.attachVideo,
);
router.post(
  '/courses/:courseId/videos/:videoId/detach',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoController.detachVideo,
);
router.get('/videos/:videoId', videoController.getVideoById);
router.get('/videos/:videoId/processing', videoController.getVideoProcessing);
router.post('/videos/:videoId/processing/retry', videoController.retryVideoProcessing);
// A manual YouTube retry is allowed only after the service proves the previous
// failure is replay-safe; uncertain uploads remain quarantined.
router.post(
  '/videos/:videoId/youtube-upload/retry',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoController.retryYouTubeUpload,
);
// Multipart batch creation returns one durable aggregate while preserving an
// item-level result for partial upload failures.
router.post(
  '/courses/:courseId/video-batches',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  uploadVideoBatch,
  validateVideoBatchMetadata,
  videoBatchController.createVideoBatch,
);
router.get(
  '/courses/:courseId/video-batches',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoBatchController.listCourseVideoBatches,
);
router.get(
  '/video-batches/:batchId',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoBatchController.getVideoBatch,
);
router.post(
  '/video-batches/:batchId/retry',
  authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN),
  videoBatchController.retryVideoBatchItem,
);
router.delete('/videos/:videoId', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), videoController.deleteVideo);

module.exports = router;
