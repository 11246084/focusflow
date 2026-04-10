const express = require('express');
const videoController = require('../controllers/video.controller');
const { authenticateProcessingWebhook } = require('../middleware/internalProcessingAuth.middleware');

const router = express.Router();

router.use(authenticateProcessingWebhook);

router.post('/videos/:videoId/processing/start', videoController.startInternalVideoProcessing);
router.post('/videos/:videoId/processing/complete', videoController.completeInternalVideoProcessing);
router.post('/videos/:videoId/processing/fail', videoController.failInternalVideoProcessing);

module.exports = router;
