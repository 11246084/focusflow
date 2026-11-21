const env = require('../config/env');
const { buildErrorResponse } = require('../utils/apiResponse');
const AppError = require('../utils/appError');

// Request bodies on these paths carry secrets. body-parser errors keep the raw
// body on error.body and JSON.parse messages quote the input, so neither may
// reach the log or the response.
const SECRET_BODY_PATHS = [/^\/api\/v1\/admin\/gemini-key(?:[/?]|$)/i];

function errorHandler(err, req, res, next) {
  const error = err;
  const secretBody = SECRET_BODY_PATHS.some((pattern) => pattern.test(String(req?.originalUrl || '')));

  if (secretBody) {
    if (env.nodeEnv !== 'test') {
      console.error(`[request] Gemini key administration failed status=${error?.statusCode || error?.status || 500} code=${typeof error?.code === 'string' ? error.code : 'unknown'}`);
    }
    if (typeof error?.type === 'string' && error.type.startsWith('entity.')) {
      return res.status(400).json(buildErrorResponse({ message: 'Malformed request body.', code: 'INVALID_REQUEST_BODY' }));
    }
  } else if (env.nodeEnv !== 'test') {
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

  // 非 AppError 的 5xx 是未預期錯誤：message／code 可能含伺服器路徑、ENOENT 或 Mongo 內部訊息，
  // production 只回通用訊息，原始錯誤已在上方寫入 server log。
  // 帶 4xx 狀態的非 AppError（例如 express.json 的 JSON 解析錯誤）屬於用戶端錯誤，維持原樣。
  if (env.nodeEnv === 'production' && !(error instanceof AppError) && statusCode >= 500) {
    return res.status(500).json(
      buildErrorResponse({
        message: 'Internal server error.',
        code: 'INTERNAL_SERVER_ERROR',
      }),
    );
  }

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
