const express = require('express');
const env = require('../config/env');
const { sendSuccess } = require('../utils/apiResponse');

const router = express.Router();

router.get('/', (req, res) => {
  return sendSuccess(res, {
    message: 'Service is healthy.',
    data: {
      service: 'focusflow-backend',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
