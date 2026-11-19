'use strict';
const crypto = require('node:crypto');
const { fail } = require('./recutRuntime.service');
const { toTraditional } = require('../utils/simplifiedToTraditional');
// Only an explicitly cut window supplies boundary evidence. The original
// response hash and exact excluded token survive JSON/database serialization.
function normalizeRecutAsrResult(result, window, { boundaryCut = false } = {}) {
  const raw = Array.isArray(result) ? result : result?.words;
  const duration = window?.endSec - window?.startSec;
  if (!Array.isArray(raw) || !raw.length || !Number.isFinite(duration) || duration <= 0) throw fail('辨識輸出無效。', 'RECUT_ASR_INVALID');
  // 辨識常混出簡體字，切句前轉成繁體；只換字不動時間。原始輸出的雜湊仍以轉換前計算。
  const words = raw.map((w) => (typeof w?.w === 'string' ? { ...w, w: toTraditional(w.w) } : { ...w })), excludedWords = [];
  const last = words.at(-1);
  if (boundaryCut && Number.isFinite(last.s) && last.s === last.e && last.s <= duration && duration - last.s <= 0.05 + 1e-9) {
    excludedWords.push({ ...words.pop(), reason: 'zero-duration-final-token-at-explicit-cut-boundary', windowEndSec: window.endSec, toleranceSec: 0.05 });
  }
  let previousEnd = 0;
  for (const [index, word] of words.entries()) {
    const reason = typeof word.w !== 'string' || !word.w.trim() ? '空白字詞'
      : !Number.isFinite(word.s) || !Number.isFinite(word.e) ? '時間不是數字'
        : word.s < 0 ? '開始時間小於 0'
          : word.s < previousEnd - 0.001 ? `和前一個字重疊 ${(previousEnd - word.s).toFixed(3)} 秒`
            : word.e <= word.s ? '長度為 0 或倒序'
              : word.e > duration + 0.001 ? `超出視窗 ${(word.e - duration).toFixed(3)} 秒` : null;
    // 訊息附上第一個出錯的字與原因，方便判斷要不要調整規則；仍然不自動修補。
    if (reason) throw fail(`辨識逐字時間無效，不可自動修補。第 ${index + 1}/${words.length} 個字「${String(word.w ?? '').slice(0, 20)}」`
      + ` ${word.s}～${word.e} 秒：${reason}（前一字結束 ${previousEnd}，視窗 ${duration.toFixed(3)} 秒）。`, 'RECUT_ASR_INVALID');
    previousEnd = word.e;
  }
  if (!words.length) throw fail('辨識沒有有效逐字。', 'RECUT_ASR_INVALID');
  const previous = Array.isArray(result) ? {} : result.asrProvenance || {};
  return { words, asrProvenance: { ...previous, kind: previous.kind || 'fresh-local-asr',
    rawWordCount: previous.rawWordCount ?? raw.length, rawWordsSha256: previous.rawWordsSha256 || crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    excludedWords: [...(previous.excludedWords || []), ...excludedWords], excludedWordCount: (previous.excludedWords || []).length + excludedWords.length,
    boundaryEndTruncated: previous.boundaryEndTruncated === true || excludedWords.length > 0,
    boundaryStartTruncated: previous.boundaryStartTruncated === true,
    normalization: 'explicit-cut-final-zero-token-v1', textConversion: 'simplified-to-traditional-v1' },
    excludeLastSentence: previous.boundaryEndTruncated === true || excludedWords.length > 0,
    excludeFirstSentence: previous.boundaryStartTruncated === true };
}
module.exports = { normalizeRecutAsrResult };
