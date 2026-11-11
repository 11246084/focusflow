'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecutAsrResult } = require('../src/services/recutAsrNormalization.service');
const window = { startSec: 942, endSec: 1075 };
it('only explicit cut-boundary final zero-duration token is excluded, without inventing timestamps', () => {
  const raw = [{ w: '原話。', s: 0, e: 2 }, { w: '到', s: 132.98, e: 132.98 }];
  const result = normalizeRecutAsrResult(raw, window, { boundaryCut: true });
  assert.deepEqual(result.words, [raw[0]]); assert.equal(raw.length, 2); assert.equal(result.excludeLastSentence, true);
  assert.equal(result.asrProvenance.excludedWords[0].s, 132.98); assert.equal(result.asrProvenance.excludedWords[0].e, 132.98);
  assert.ok(result.asrProvenance.rawWordsSha256); assert.equal(JSON.parse(JSON.stringify(result)).asrProvenance.excludedWordCount, 1);
});
it('interior zero, reverse, overlap, out-of-window and unproven boundary tokens fail closed', () => {
  for (const [raw, options] of [
    [[{ w: '到', s: 132.98, e: 132.98 }], {}],
    [[{ w: '內部', s: 2, e: 2 }, { w: '後續', s: 3, e: 4 }], { boundaryCut: true }],
    [[{ w: '倒序', s: 2, e: 1 }], { boundaryCut: true }],
    [[{ w: '前', s: 0, e: 2 }, { w: '重疊', s: 1, e: 3 }], { boundaryCut: true }],
    [[{ w: '超窗', s: 133.01, e: 133.01 }], { boundaryCut: true }],
    [[{ w: '不是窗尾', s: 132, e: 132 }], { boundaryCut: true }],
  ]) assert.throws(() => normalizeRecutAsrResult(raw, window, options), { code: 'RECUT_ASR_INVALID' });
});
it('legacy arrays stay compatible and explicit object provenance can prohibit the first whole sentence', () => {
  const words = [{ w: '原話', s: 0.5, e: 1 }];
  assert.deepEqual(normalizeRecutAsrResult(words, window).words, words);
  const result = normalizeRecutAsrResult({ words, asrProvenance: { boundaryStartTruncated: true, kind: 'explicit-local-window' } }, window);
  assert.equal(result.excludeFirstSentence, true); assert.equal(result.asrProvenance.kind, 'explicit-local-window');
});
