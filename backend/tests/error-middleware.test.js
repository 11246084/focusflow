const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const AppError = require('../src/utils/appError');
const { errorHandler } = require('../src/middleware/error.middleware');

function runHandler(error) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  errorHandler(error, {}, res, () => {});
  return res;
}

describe('error middleware details', () => {
  const originalNodeEnv = env.nodeEnv;
  const originalConsoleError = console.error;
  afterEach(() => {
    env.nodeEnv = originalNodeEnv;
    console.error = originalConsoleError;
  });

  it('production 隱藏內部 details，但保留刻意公開的 publicDetails', () => {
    env.nodeEnv = 'production';
    console.error = () => {};

    const internal = runHandler(new AppError('boom', 500, 'QA_RUNTIME_MISCONFIGURED', { secret: 'x' }));
    const publicError = new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    publicError.publicDetails = { remainingAttempts: 3 };
    const withPublic = runHandler(publicError);

    assert.equal(internal.body.error.details, undefined);
    assert.deepEqual(withPublic.body.error.details, { remainingAttempts: 3 });
  });
});

function buildUnexpectedError() {
  const error = new Error("ENOENT: no such file or directory, open '/opt/focusflow/backend/uploads/x.mp4'");
  error.code = 'ENOENT';
  error.details = { path: '/opt/focusflow/backend/uploads/x.mp4' };
  return error;
}

describe('error middleware 未預期錯誤遮蔽', () => {
  const originalNodeEnv = env.nodeEnv;
  const originalConsoleError = console.error;
  let logged;

  beforeEach(() => {
    logged = [];
    console.error = (...args) => { logged.push(args); };
  });

  afterEach(() => {
    env.nodeEnv = originalNodeEnv;
    console.error = originalConsoleError;
  });

  it('production 的非 AppError 只回通用訊息與 INTERNAL_SERVER_ERROR', () => {
    env.nodeEnv = 'production';
    const res = runHandler(buildUnexpectedError());

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
      success: false,
      message: 'Internal server error.',
      error: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });

  it('production 的非 AppError 原始錯誤仍寫入 server log', () => {
    env.nodeEnv = 'production';
    const error = buildUnexpectedError();
    runHandler(error);

    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], error);
  });

  it('production 的 AppError 維持原本的訊息與錯誤碼', () => {
    env.nodeEnv = 'production';
    const res = runHandler(new AppError('Answer provider is not configured.', 500, 'ANSWER_PROVIDER_NOT_CONFIGURED'));

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Answer provider is not configured.');
    assert.equal(res.body.error.code, 'ANSWER_PROVIDER_NOT_CONFIGURED');
  });

  it('production 的 MulterError 維持原本的訊息與 UPLOAD_ERROR', () => {
    env.nodeEnv = 'production';
    const error = new Error('File too large');
    error.name = 'MulterError';
    const res = runHandler(error);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'File too large');
    assert.equal(res.body.error.code, 'UPLOAD_ERROR');
  });

  it('production 的 Mongoose ValidationError 維持 VALIDATION_ERROR 與欄位訊息', () => {
    env.nodeEnv = 'production';
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    error.errors = { title: { message: 'Path `title` is required.' } };
    const res = runHandler(error);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(res.body.error.details, ['Path `title` is required.']);
  });

  it('production 的 CastError 與重複鍵錯誤維持 INVALID_ID 與 DUPLICATE_RESOURCE', () => {
    env.nodeEnv = 'production';
    const castError = new Error('Cast to ObjectId failed');
    castError.name = 'CastError';
    const duplicateError = new Error('E11000 duplicate key error');
    duplicateError.code = 11000;

    assert.equal(runHandler(castError).body.error.code, 'INVALID_ID');
    assert.equal(runHandler(duplicateError).body.error.code, 'DUPLICATE_RESOURCE');
  });

  it('production 帶 4xx 狀態的非 AppError（JSON 解析錯誤）維持原本的狀態碼與訊息', () => {
    env.nodeEnv = 'production';
    const error = new SyntaxError('Unexpected token } in JSON at position 10');
    error.status = 400;
    error.statusCode = 400;
    error.type = 'entity.parse.failed';
    const res = runHandler(error);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Unexpected token } in JSON at position 10');
  });

  it('非 production 的非 AppError 仍回原始訊息方便除錯', () => {
    env.nodeEnv = 'development';
    const res = runHandler(buildUnexpectedError());

    assert.equal(res.statusCode, 500);
    assert.match(res.body.message, /ENOENT/);
    assert.equal(res.body.error.code, 'ENOENT');
  });
});
