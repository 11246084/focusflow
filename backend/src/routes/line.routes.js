const express = require('express');
const lineSignature = require('../middleware/lineSignature.middleware');
const lineController = require('../controllers/line.controller');
const AppError = require('../utils/appError');

const router = express.Router();

function parseLineJsonBody(req, res, next) {
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString('utf8'));
    } catch {
      return next(new AppError('Invalid JSON body.', 400, 'VALIDATION_ERROR'));
    }
  }
  return next();
}

router.post('/webhook', lineSignature, parseLineJsonBody, lineController.handleWebhook);

module.exports = router;
