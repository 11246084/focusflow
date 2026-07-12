const express = require('express');
const videoController = require('../controllers/video.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');
const { uploadSingleVideo } = require('../middleware/upload.middleware');
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
router.delete('/videos/:videoId', authorizeRoles(USER_ROLES.TEACHER, USER_ROLES.ADMIN), videoController.deleteVideo);

module.exports = router;
