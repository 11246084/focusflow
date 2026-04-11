const express = require('express');
const lineSignature = require('../middleware/lineSignature.middleware');
const lineController = require('../controllers/line.controller');
const { authenticate } = require('../middleware/auth.middleware');
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

router.get('/webhook', (req, res) => res.sendStatus(200));
router.post('/webhook', lineSignature, parseLineJsonBody, lineController.handleWebhook);
router.post('/bind-token', authenticate, lineController.issueBindToken);

module.exports = router;
