'use strict';
const AppError = require('../utils/appError');

// Detects repair loops that keep failing the same way. One error signature is the
// sorted, de-duplicated set of normalized validation errors from one attempt:
// structured errors keep code, path and message; only decimal values (durations
// such as "12.58s" vs "12.46s") are masked, so ids like s18 / scene-5 / item2 stay
// distinct and different SENTENCE_TIMING errors on the generic path "$" differ.
// 2026-11-05 OpenCV trial run-6: cards failed 11 times with the same
// FIELD_UNKNOWN scenes[1].params.words and spent the shared repair budget.
const TARGETED_AFTER = 2; // a signature seen twice: next request uses the targeted strategy
const STOP_AFTER = 3; // seen three times: stop instead of spending more calls

// Masks decimals and second values ("12.58s", "13s"); integers in ids such as
// s18, scene-5 or item2 are kept.
const maskDecimals = (text) => String(text).replace(/-?\d+(?:\.\d+)?s\b/g, '#s').replace(/-?\d+\.\d+/g, '#').replace(/\s+/g, ' ').trim();
function normalizeError(error) {
  if (error && typeof error === 'object') return `${error.code || 'ERROR'}|${error.path || ''}|${maskDecimals(error.message || '')}`;
  return maskDecimals(error);
}
function errorSignature(errors = []) {
  return [...new Set((Array.isArray(errors) ? errors : [errors]).map(normalizeError))].sort().join('\n');
}
const describeError = (error) => (error && typeof error === 'object'
  ? [error.code, error.path, error.message].filter(Boolean).join(' ') : String(error));

function createRepairStallTracker({ stage = 'unknown' } = {}) {
  const seen = new Map();
  let attempts = 0;
  return {
    // Call after each failed validation. Returns the strategy for the next request.
    // With no budget left the caller reports normal exhaustion instead of a stall.
    record(errors, { budgetLeft = true } = {}) {
      attempts += 1;
      const signature = errorSignature(errors);
      if (!signature) return { strategy: 'repair', signature, occurrences: 0 };
      const occurrences = (seen.get(signature) || 0) + 1;
      seen.set(signature, occurrences);
      if (occurrences >= STOP_AFTER && budgetLeft) {
        const sample = (Array.isArray(errors) ? errors : [errors]).slice(0, 5).map(describeError);
        const error = new AppError(`Recut 修正停滯：${stage} 修正過程中同一組錯誤已第 ${occurrences} 次出現（共 ${attempts} 次失敗），已停止以免耗盡額度。請依下列錯誤調整指示、元件契約或改由教師處理：${sample.join('；')}`,
          422, 'RECUT_REPAIR_STALLED');
        error.diagnostics = { stage, signature: signature.split('\n'), occurrences, failedAttempts: attempts, sampleErrors: sample };
        throw error;
      }
      return { strategy: occurrences >= TARGETED_AFTER ? 'targeted' : 'repair', signature, occurrences };
    },
  };
}
// The targeted request differs from a plain repair: it names each offending
// location once, tells the model the previous fix repeated them, and asks for a
// minimal change. It is still validated by the same strict rules.
function targetedRepairFields(errors = []) {
  const fixes = [...new Map((Array.isArray(errors) ? errors : [errors]).map((error) => [normalizeError(error), describeError(error)])).values()];
  return { repairStrategy: 'targeted',
    repairNotice: '先前的修正已再次出現同一組錯誤。這次只修改 mustFix 列出的位置，其他內容保持不變；未知欄位要刪除，或改用擁有該欄位的元件；不要再輸出 mustFix 中的錯誤。',
    mustFix: fixes };
}
module.exports = { createRepairStallTracker, errorSignature, normalizeError, targetedRepairFields, TARGETED_AFTER, STOP_AFTER };
