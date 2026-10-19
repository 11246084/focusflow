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
const { buildYouTubeLifecycleSnapshot } = require('../services/youtubeLifecycle.service');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  // 兩層開關要讀資料庫、可用空間要查磁碟；兩者失敗都只標在欄位內，不讓 /health 失敗。
  const youtubeLifecycle = await buildYouTubeLifecycleSnapshot();
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
        youtubeUpload: {
          ...buildYouTubeUploadSnapshot(),
          ...youtubeLifecycle,
        },
      },
    },
  });
}));

module.exports = router;
