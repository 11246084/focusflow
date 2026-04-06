const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/appError');

function lineSignature(req, res, next) {
  const signature = req.headers['x-line-signature'];

  if (!signature) {
    return next(new AppError('Missing LINE signature.', 401, 'LINE_SIGNATURE_MISSING'));
  }

  if (!env.lineChannelSecret) {
    return next(new AppError('LINE_CHANNEL_SECRET is not configured.', 500, 'LINE_NOT_CONFIGURED'));
  }

  if (!req.rawBody) {
    return next(new AppError('LINE raw request body is not available.', 400, 'LINE_RAW_BODY_MISSING'));
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.lineChannelSecret)
    .update(req.rawBody)
    .digest('base64');

  if (expectedSignature !== signature) {
    return next(new AppError('Invalid LINE signature.', 401, 'LINE_SIGNATURE_INVALID'));
  }

  return next();
}

module.exports = lineSignature;
