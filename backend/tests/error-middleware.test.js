const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
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
