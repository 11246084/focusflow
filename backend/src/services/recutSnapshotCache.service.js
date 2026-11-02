'use strict';
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { fail } = require('./recutRuntime.service');
async function hashLocalFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex').toUpperCase();
}
function validateSnapshotCache(cache, { sourceSha256, startSec, endSec } = {}) {
  if (!cache || !/^[A-Fa-f0-9]{64}$/.test(cache.sourceSha256 || '') || cache.sourceSha256.toUpperCase() !== sourceSha256?.toUpperCase()
    || cache.window?.startSec !== startSec || cache.window?.endSec !== endSec || !Array.isArray(cache.sentences) || !cache.sentences.length
    || !cache.asrProvenance || typeof cache.transcriptVersion !== 'string' || !cache.transcriptVersion.trim()) throw fail('快取來源指紋或視窗不符。', 'RECUT_SOURCE_CACHE_INVALID');
  let previous = startSec;
  for (const [index, s] of cache.sentences.entries()) {
    if (s.id !== `s${index + 1}` || typeof s.text !== 'string' || !s.text.trim() || !Array.isArray(s.words) || !s.words.length
      || !Number.isFinite(s.startSec) || !Number.isFinite(s.endSec) || s.startSec < previous || s.endSec <= s.startSec || s.endSec > endSec
      || !Array.isArray(s.chunkIds) || s.chunkIds.some((id) => typeof id !== 'string')) throw fail('快取句子格式無效。', 'RECUT_SOURCE_CACHE_INVALID');
    let wordEnd = s.startSec;
    for (const w of s.words) {
      if (typeof w.text !== 'string' || !w.text.trim() || !Number.isFinite(w.startSec) || !Number.isFinite(w.endSec) || w.startSec < wordEnd || w.endSec <= w.startSec || w.endSec > s.endSec) throw fail('快取逐字時間格式無效。', 'RECUT_SOURCE_CACHE_INVALID');
      wordEnd = w.endSec;
    }
    previous = s.endSec;
  }
  const explicitExcluded = cache.excludedSentenceIds || cache.asrProvenance.excludedSentenceIds || [];
  const clippedBoundaries = cache.asrProvenance.boundarySentencesClipped === true || (cache.asrProvenance.limitations || []).some((s) => typeof s === 'string' && /First and last sentences clipped by window; do not select/i.test(s));
  const excluded = [...new Set([...explicitExcluded, ...(clippedBoundaries ? [cache.sentences[0].id, cache.sentences.at(-1).id] : [])])];
  if (!Array.isArray(excluded) || excluded.some((id) => !cache.sentences.some((s) => s.id === id))) throw fail('快取排除句子無效。', 'RECUT_SOURCE_CACHE_INVALID');
  return { ...cache, excludedSentenceIds: excluded };
}
module.exports = { hashLocalFile, validateSnapshotCache };
