const { ids } = require('./backendTestHarness');
function sourceData() {
  return { videoId: ids.teacherVideo, startSec: 100, endSec: 250, frozenAt: new Date(), hitChunkIds: ['chunk1'],
    sentences: Array.from({ length: 16 }, (_, i) => {
      const startSec = 100 + i * 8; const duration = i === 0 ? 2 : 5;
      const text = i === 0 ? '工具不同。' : `句${i + 1}的定義。`;
      return { id: `s${i + 1}`, startSec, endSec: startSec + duration, text,
        words: [{ text: text.slice(0, 2), startSec, endSec: startSec + 1 }, { text: text.slice(2), startSec: startSec + 1, endSec: startSec + duration }],
        retrievalHit: i === 2, chunkIds: ['chunk1'] };
    }), sourceCheck: { passed: true }, audio: { fixedGainDb: 0 } };
}
function selection(from = 2, to = 6, extras = {}) {
  return { answerable: true, unanswerableReason: null, ranges: [{ from: `s${from}`, to: `s${to}` }],
    sentenceLabels: sourceData().sentences.map((s, i) => ({ sentenceId: s.id, label: i + 1 >= from && i + 1 <= to ? '結論或定義' : '離題' })),
    openingSentenceId: null, ...extras };
}
module.exports = { sourceData, selection };
