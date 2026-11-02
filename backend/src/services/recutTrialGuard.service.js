'use strict';
const { fail } = require('./recutRuntime.service');
const INPUT_KEYS = new Set(['question', 'variants', 'sentences', 'selection', 'clips', 'catalog', 'iconAllowlist', 'selectionLocked', 'adoptedSuggestions', 'presentationScope', 'previousOutput', 'errors', 'basePlan', 'codeAvailable', 'fullScript', 'plan']);
function createRecutTrialGuard(policy, { forbiddenValues = [], now = () => new Date() } = {}) {
  policy = structuredClone(policy);
  if (!policy || !policy.modelId || !Number.isInteger(policy.maxCalls) || policy.maxCalls < 1 || !Number.isInteger(policy.maxRequestBytes) || policy.maxRequestBytes < 1
    || !Number.isInteger(policy.maxOutputTokens) || policy.maxOutputTokens < 1
    || ![policy.budgetUsd, policy.inputPerMillion, policy.outputPerMillion].every((n) => Number.isFinite(n) && n > 0)) throw fail('試片預算設定不完整。', 'RECUT_TRIAL_POLICY_INVALID');
  let calls = 0, reservedUsd = 0;
  const inspect = (value, depth = 0) => {
    if (depth > 40 || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || Buffer.isBuffer(value)) throw fail('試片資料含非必要執行或媒體內容。', 'RECUT_TRIAL_INPUT_FORBIDDEN');
    if (value && typeof value === 'object') {
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail('試片資料物件無效。', 'RECUT_TRIAL_INPUT_FORBIDDEN');
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:api.?key|password(?:Hash)?|credentials?|runtime(?:Config)?|env|teacher(?:Account)?|filePath|sourcePath|videoPath|mediaPath|originalVideoBytes|inlineData|fileData|tools|toolConfig|grounding)$/i.test(key)) throw fail('試片資料含非必要設定。', 'RECUT_TRIAL_INPUT_FORBIDDEN');
        inspect(child, depth + 1);
      }
    }
  };
  return { reserve({ modelId, input, images, body, maxOutputTokens }) {
    if (modelId !== policy.modelId) throw fail('試片模型與核准設定不符。', 'RECUT_TRIAL_MODEL_MISMATCH');
    if (maxOutputTokens > policy.maxOutputTokens) throw fail('模型輸出上限超過本次核准值。', 'RECUT_TRIAL_POLICY_INVALID');
    if (policy.validUntil && now().toISOString().slice(0, 10) > policy.validUntil) throw fail('試片價目期限已過。', 'RECUT_TRIAL_POLICY_EXPIRED');
    if (images.length || input?.codeAvailable === true || Object.keys(input || {}).some((key) => !INPUT_KEYS.has(key))) throw fail('本次試片只允許必要文字。', 'RECUT_TRIAL_INPUT_FORBIDDEN');
    inspect(input);
    const bytes = Buffer.byteLength(body, 'utf8');
    if (forbiddenValues.some((value) => typeof value === 'string' && value.length > 3 && (body.includes(value) || body.includes(JSON.stringify(value).slice(1, -1))))) throw fail('試片內容包含私有設定值。', 'RECUT_TRIAL_INPUT_FORBIDDEN');
    if (bytes > policy.maxRequestBytes) throw fail('試片 request body 超過核准大小。', 'RECUT_TRIAL_REQUEST_TOO_LARGE');
    if (calls >= policy.maxCalls) throw fail('試片模型呼叫額度已用完。', 'RECUT_TRIAL_CALL_LIMIT');
    const reservationUsd = (bytes * policy.inputPerMillion + maxOutputTokens * policy.outputPerMillion) / 1e6;
    if (reservedUsd + reservationUsd > policy.budgetUsd + Number.EPSILON) throw fail('試片保守預算不足。', 'RECUT_TRIAL_BUDGET_EXCEEDED');
    calls++; reservedUsd += reservationUsd;
    return { requestedModelId: modelId, requestBodyBytes: bytes, trialModelCalls: calls, budgetReservationUsd: reservationUsd, cumulativeBudgetReservationUsd: reservedUsd, reservationOnly: true };
  } };
}
function safeTrialRequest(value) {
  if (!value || !/^[\w.-]+$/.test(value.requestedModelId || '')) return undefined;
  return { requestedModelId: value.requestedModelId, reservationOnly: true,
    ...Object.fromEntries(['requestBodyBytes', 'trialModelCalls', 'budgetReservationUsd', 'cumulativeBudgetReservationUsd']
      .filter((key) => Number.isFinite(value[key]) && value[key] >= 0).map((key) => [key, value[key]])) };
}
module.exports = { createRecutTrialGuard, safeTrialRequest };
