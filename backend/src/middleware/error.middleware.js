const env = require('../config/env');
const { buildErrorResponse } = require('../utils/apiResponse');

function errorHandler(err, req, res, next) {
  const error = err;

  if (env.nodeEnv !== 'test') {
    console.error(error);
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json(
      buildErrorResponse({
        message: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        details: Object.values(error.errors).map((item) => item.message),
      }),
    );
  }

  if (error.name === 'CastError') {
    return res.status(400).json(
      buildErrorResponse({
        message: 'Invalid resource id.',
        code: 'INVALID_ID',
      }),
    );
  }

  if (error.code === 11000) {
    return res.status(409).json(
      buildErrorResponse({
        message: 'Resource already exists.',
        code: 'DUPLICATE_RESOURCE',
        details: error.keyValue,
      }),
    );
  }

  if (error.name === 'MulterError') {
    return res.status(400).json(
      buildErrorResponse({
        message: error.message,
        code: 'UPLOAD_ERROR',
      }),
    );
  }

  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';
  const details = env.nodeEnv === 'production' ? undefined : error.details;

  return res.status(statusCode).json(
    buildErrorResponse({
      message: error.message || 'Internal server error.',
      code,
      details,
    }),
  );
}

module.exports = {
  errorHandler,
};
