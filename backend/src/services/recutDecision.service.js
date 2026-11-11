const env = require('../config/env');
const AppError = require('../utils/appError');
function createRecutDecisionPoint({ fetchImpl = global.fetch, apiKey = env.geminiApiKey, timeoutMs = 120000 } = {}) {
  return async function decide({ model, instructions, input, responseSchema }) {
    if (model?.provider !== 'gemini' || !/^[\w.-]+$/.test(model.model || '') || !apiKey) {
      throw new AppError('Recut 模型或金鑰尚未設定。', 503, 'RECUT_SETTING_INVALID');
    }
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema } }),
    });
    const body = await response.json();
    const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!response.ok) {
      const error = new AppError('Recut 模型呼叫失敗。', 502, 'RECUT_MODEL_FAILED');
      error.output = raw; error.usageMetadata = body.usageMetadata; throw error;
    }
    return { output: raw, modelId: body.modelVersion || model.model, usageMetadata: body.usageMetadata ?? null };
  };
}
// RC3、RC4 共用同一 runAttempt；重試不建立新任務或新額度。
async function runValidatedDecision({ task, runAttempt, checkCancelled, decide, model, instructions, input, responseSchema, validate }) {
  const { createRepairStallTracker, targetedRepairFields } = require('./recutRepairStall.service');
  const tracker = createRepairStallTracker({ stage: 'selection' });
  let previousOutput = null, errors = [], strategy = {};
  while (task.callsUsed < task.callLimit) {
    await checkCancelled();
    const request = { ...input, ...(errors.length ? { previousOutput, errors, ...strategy } : {}) };
    try {
      let result;
      await runAttempt({ input: { instructions, ...request, responseSchema }, modelId: model.model, consumesCall: true,
        execute: async () => {
          const response = await decide({ model, instructions, input: request, responseSchema });
          previousOutput = response.output;
          let parsed;
          try { parsed = typeof response.output === 'string' ? JSON.parse(response.output) : response.output; }
          catch { errors = ['模型輸出不是有效 JSON']; }
          result = parsed === undefined ? { valid: false, errors } : validate(parsed);
          errors = result.errors || [];
          return { ...response, validation: result };
        } });
      return result;
    } catch (error) {
      if (error.code !== 'RECUT_VALIDATION_FAILED') throw error;
      strategy = tracker.record(errors, { budgetLeft: task.callsUsed < task.callLimit }).strategy === 'targeted' ? targetedRepairFields(errors) : {};
    }
  }
  throw new AppError('Recut 共用呼叫額度已用完，選段仍未通過驗證。', 409, 'RECUT_CALL_LIMIT_EXCEEDED');
}
module.exports = { createRecutDecisionPoint, runValidatedDecision };
