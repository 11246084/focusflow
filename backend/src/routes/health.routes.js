const express = require('express');
const env = require('../config/env');
const { sendSuccess } = require('../utils/apiResponse');
const {
  buildQaRuntimeSnapshot,
  buildLineRuntimeSnapshot,
  buildMultimodalRuntimeSnapshot,
} = require('../services/runtimeDiagnostics.service');
const { buildShortsSyncSnapshot } = require('../services/shortsSync.service');
const { buildYouTubeUploadSnapshot } = require('../services/youtubeUpload.service');

const router = express.Router();

router.get('/', (req, res) => {
  return sendSuccess(res, {
    message: 'Service is healthy.',
    data: {
      service: 'focusflow-backend',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
      runtime: {
        qa: buildQaRuntimeSnapshot(),
        line: buildLineRuntimeSnapshot(),
        multimodal: buildMultimodalRuntimeSnapshot(),
        shortsSync: buildShortsSyncSnapshot(),
        youtubeUpload: buildYouTubeUploadSnapshot(),
      },
    },
  });
});

module.exports = router;
