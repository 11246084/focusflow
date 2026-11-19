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
it('孤立的零長度字、倒序、重疊、超窗與無法證明的邊界字仍然停止', () => {
  for (const [raw, options] of [
    [[{ w: '到', s: 132.98, e: 132.98 }], {}],
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
it('辨識混出的簡體字轉成繁體，時間與原始雜湊不變', () => {
  const raw = [{ w: '那个运算', s: 0, e: 1 }, { w: '能力', s: 1, e: 2 }, { w: '超级电脑', s: 2, e: 3 }];
  const result = normalizeRecutAsrResult(raw, window);
  assert.deepEqual(result.words.map((w) => w.w), ['那個運算', '能力', '超級電腦']);
  assert.deepEqual(result.words.map((w) => [w.s, w.e]), [[0, 1], [1, 2], [2, 3]]);
  assert.equal(raw[0].w, '那个运算'); assert.equal(result.asrProvenance.textConversion, 'simplified-to-traditional-v1');
  assert.equal(result.asrProvenance.rawWordsSha256, require('node:crypto').createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
});
it('中間的零長度字併進時間較近的前一個字，只用辨識給的時間（正式站「就是」28.4～28.4）', () => {
  const raw = [{ w: '也', s: 27.5, e: 27.98 }, { w: '就是', s: 28.4, e: 28.4 }, { w: '說', s: 29.2, e: 29.5 }];
  const result = normalizeRecutAsrResult(raw, window);
  assert.deepEqual(result.words.map((w) => [w.w, w.s, w.e]), [['也就是', 27.5, 28.4], ['說', 29.2, 29.5]]);
  assert.equal(result.asrProvenance.zeroDurationMerged, 1); assert.equal(raw[1].w, '就是');
});
it('零長度字比較靠近下一個字時併進下一個字；開頭的零長度字也併進下一個字', () => {
  const near = normalizeRecutAsrResult([{ w: '前', s: 1, e: 2 }, { w: '中', s: 2.9, e: 2.9 }, { w: '後', s: 3, e: 4 }], window);
  assert.deepEqual(near.words.map((w) => [w.w, w.s, w.e]), [['前', 1, 2], ['中後', 2.9, 4]]);
  const first = normalizeRecutAsrResult([{ w: '內部', s: 2, e: 2 }, { w: '後續', s: 3, e: 4 }], window, { boundaryCut: true });
  assert.deepEqual(first.words.map((w) => [w.w, w.s, w.e]), [['內部後續', 2, 4]]);
});
it('零長度字和前一個字重疊時不併、照舊停止', () => {
  assert.throws(() => normalizeRecutAsrResult([{ w: '前', s: 1, e: 3 }, { w: '中', s: 2, e: 2 }], window), { code: 'RECUT_ASR_INVALID' });
});
it('0.3 秒以內的小重疊對齊到前一字結尾、超出視窗 0.3 秒以內截在視窗結尾（決策第 96 項）', () => {
  const result = normalizeRecutAsrResult([{ w: '前', s: 1, e: 2 }, { w: '重疊', s: 1.8, e: 3 }, { w: '尾', s: 132.5, e: 133.2 }], window);
  assert.deepEqual(result.words.map((w) => [w.w, w.s, w.e]), [['前', 1, 2], ['重疊', 2, 3], ['尾', 132.5, 133]]);
  assert.equal(result.asrProvenance.timingClamped, 2);
});
