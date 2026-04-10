const env = require('../config/env');
const AppError = require('../utils/appError');

function authenticateProcessingWebhook(req, res, next) {
  const secret = req.headers['x-processing-secret'];

  // Internal worker callbacks use a shared secret instead of JWT to keep the contract simple.
  if (!env.processingWebhookSecret || !secret || secret !== env.processingWebhookSecret) {
    return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
  }

  return next();
}

module.exports = {
  authenticateProcessingWebhook,
};
