'use strict';

const AppError = require('../utils/appError');
const fail = (message, code = 'RECUT_VALIDATION_FAILED') => new AppError(message, 422, code);

// Every model invocation goes through the queue's durable attempt recorder. No SDK,
// environment loader or network client is created by this module.
async function runDecision(context, { decide, instructions, input, responseSchema, validate, consumesCall = true }) {
  const model = context.task.settingsSnapshot?.model;
  if (typeof decide !== 'function' || !model?.model) throw fail('Recut 判斷點尚未設定。', 'RECUT_STEPS_NOT_CONFIGURED');
  await context.checkCancelled();
  let result;
  await context.runAttempt({ input: { instructions, ...input, responseSchema }, modelId: model.model, consumesCall,
    execute: async () => {
      const response = await decide({ model, instructions, input, responseSchema });
      let output;
      try { output = typeof response.output === 'string' ? JSON.parse(response.output) : response.output; }
      catch { output = undefined; }
      result = output === undefined ? { valid: false, errors: ['模型輸出不是有效 JSON'] } : await validate(output);
      return { ...response, validation: result };
    } });
  await context.checkCancelled();
  return result;
}
async function retryDecision(context, options) {
  let errors = options.input.errors || [], previousOutput = options.input.previousOutput || null;
  while (context.task.callsUsed < context.task.callLimit) {
    try {
      return await runDecision(context, { ...options, input: { ...options.input, errors, previousOutput },
        validate: async (output) => { previousOutput = output; const result = await options.validate(output); errors = result.errors || []; return result; } });
    } catch (error) { if (error.code !== 'RECUT_VALIDATION_FAILED') throw error; }
  }
  throw fail('Recut 共用呼叫額度已用完，可信度檢查仍未通過。', 'RECUT_CALL_LIMIT_EXCEEDED');
}
function assertLoopbackMongoTarget(uri) {
  // No DNS aliases, SRV, credentials, multiple hosts or implicit default port.
  const match = typeof uri === 'string' && /^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})\/([a-zA-Z0-9_-]+)$/.exec(uri);
  if (!match) {
    throw fail('寫入目標必須是明確指定埠與資料庫名稱的本機 MongoDB。', 'RECUT_LOCAL_DB_REQUIRED');
  }
  if (+match[2] > 65535) throw fail('本機資料庫埠無效。', 'RECUT_LOCAL_DB_REQUIRED');
  return { host: match[1], port: +match[2], database: match[3] };
}
module.exports = { runDecision, retryDecision, fail, assertLoopbackMongoTarget };
