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
  // publicDetails 是刻意給前端顯示的資訊（例如登入還剩幾次），production 也回傳；
  // 一般 details 可能含內部診斷，只在非 production 回傳。
  const details = error.publicDetails !== undefined
    ? error.publicDetails
    : (env.nodeEnv === 'production' ? undefined : error.details);

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
