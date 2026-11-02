'use strict';
const crypto = require('node:crypto');
const { fail } = require('./recutRuntime.service');
// Only an explicitly cut window supplies boundary evidence. The original
// response hash and exact excluded token survive JSON/database serialization.
function normalizeRecutAsrResult(result, window, { boundaryCut = false } = {}) {
  const raw = Array.isArray(result) ? result : result?.words;
  const duration = window?.endSec - window?.startSec;
  if (!Array.isArray(raw) || !raw.length || !Number.isFinite(duration) || duration <= 0) throw fail('辨識輸出無效。', 'RECUT_ASR_INVALID');
  const words = raw.map((w) => ({ ...w })), excludedWords = [];
  const last = words.at(-1);
  if (boundaryCut && Number.isFinite(last.s) && last.s === last.e && last.s <= duration && duration - last.s <= 0.05 + 1e-9) {
    excludedWords.push({ ...words.pop(), reason: 'zero-duration-final-token-at-explicit-cut-boundary', windowEndSec: window.endSec, toleranceSec: 0.05 });
  }
  let previousEnd = 0;
  for (const word of words) {
    if (typeof word.w !== 'string' || !word.w.trim() || !Number.isFinite(word.s) || !Number.isFinite(word.e) || word.s < previousEnd - 0.001
      || word.s < 0 || word.e <= word.s || word.e > duration + 0.001) throw fail('辨識逐字時間無效，不可自動修補。', 'RECUT_ASR_INVALID');
    previousEnd = word.e;
  }
  if (!words.length) throw fail('辨識沒有有效逐字。', 'RECUT_ASR_INVALID');
  const previous = Array.isArray(result) ? {} : result.asrProvenance || {};
  return { words, asrProvenance: { ...previous, kind: previous.kind || 'fresh-local-asr',
    rawWordCount: previous.rawWordCount ?? raw.length, rawWordsSha256: previous.rawWordsSha256 || crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    excludedWords: [...(previous.excludedWords || []), ...excludedWords], excludedWordCount: (previous.excludedWords || []).length + excludedWords.length,
    boundaryEndTruncated: previous.boundaryEndTruncated === true || excludedWords.length > 0,
    boundaryStartTruncated: previous.boundaryStartTruncated === true,
    normalization: 'explicit-cut-final-zero-token-v1' },
    excludeLastSentence: previous.boundaryEndTruncated === true || excludedWords.length > 0,
    excludeFirstSentence: previous.boundaryStartTruncated === true };
}
module.exports = { normalizeRecutAsrResult };
