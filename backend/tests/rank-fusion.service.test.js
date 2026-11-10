const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reciprocalRankFusion, normalizeCandidate } = require('../src/services/rankFusion.service');

const chunk = (id, extra = {}) => ({ courseId: 'course', videoId: 'video', chunkId: id, startSec: 10, endSec: 12, text: id, ...extra });

test('RRF sums ranks across channels, deduplicates within each channel and preserves time', () => {
  const result = reciprocalRankFusion({ text: [chunk('a'), chunk('a')], audio: [chunk('b'), chunk('a')] });
  assert.equal(result.length, 2);
  assert.equal(result[0].chunkId, 'a');
  assert.equal(result[0].fusionScore, 1 / 61 + 1 / 62);
  assert.deepEqual(result[0].channelRanks, { text: 1, audio: 2 });
  assert.deepEqual(result[0].retrievedBy, ['text', 'audio']);
  assert.equal(result[0].startSec, 10);
  assert.equal(result[0].endSec, 12);
});

test('text weighting defaults to equal and supports the locked 2:1:1 configuration', () => {
  const lists = { text: [chunk('a')], audio: [chunk('b')], visual: [chunk('b')] };
  assert.equal(reciprocalRankFusion(lists)[0].chunkId, 'b');
  assert.equal(reciprocalRankFusion(lists, { weights: { text: 2 } })[0].fusionScore, 2 / 61);
  assert.throws(() => reciprocalRankFusion(lists, { k: 10 }), /60/);
  assert.throws(() => reciprocalRankFusion(lists, { weights: { audio: NaN } }), /Weights/);
});

test('empty/missing channels, stable ties and video identity are supported', () => {
  assert.deepEqual(reciprocalRankFusion({}), []);
  const lists = { text: [chunk('same', { videoId: 'b' })], visual: [chunk('same', { videoId: 'a' })] };
  assert.deepEqual(reciprocalRankFusion(lists).map((item) => item.videoId), ['a', 'b']);
  assert.deepEqual(reciprocalRankFusion(lists), reciprocalRankFusion(lists));
});

test('rejects invalid identity, time and conflicting evidence', () => {
  assert.throws(() => normalizeCandidate(chunk('a', { startSec: -1 })), /valid/);
  assert.throws(() => normalizeCandidate(chunk('a', { courseId: '' })), /requires/);
  assert.throws(() => reciprocalRankFusion({ text: [chunk('a')], audio: [chunk('a', { endSec: 99 })] }), /Conflicting/);
});
