'use strict';
const { buildRecutPlan, calculateFixedGain } = require('../src/plan');
function input() {
  const sentences = Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, startSec: 100 + i * 5, endSec: 105 + i * 5, text: `段落${i + 1}說明`, chunkIds: ['chunk'], words: [{ text: `段落${i + 1}`, startSec: 100 + i * 5, endSec: 102 + i * 5 }, { text: '說明', startSec: 102 + i * 5, endSec: 105 + i * 5 }] }));
  const source = { videoId: 'synthetic-video', sentences, audio: { integratedLufs: -20, truePeakDbtp: -8, fixedGainDb: 4 } };
  const selectionResult = { clips: [{ sentenceIds: sentences.map((s) => s.id), words: sentences.flatMap((s) => s.words), startSec: 100, endSec: 130, opening: false }] };
  return { source, selectionResult, scenes: sentences.map((s, i) => ({ id: `card${i + 1}`, from: s.id, to: s.id, component: 'quote-reveal', params: { text: s.text }, cues: { text: { sentenceId: s.id } } })), subtitles: sentences.map((s) => ({ from: { sentenceId: s.id }, runs: [{ t: s.text }] })), modelId: 'gemini-fixture-pinned', audio: calculateFixedGain({ integratedLufs: -20, truePeakDbtp: -8 }), title: { tag: '合成測試', text: '句子圖卡測試' }, endCard: { line1: 'FocusFlow', seconds: 0 } };
}
function fixture() {
  const args = input();
  const built = buildRecutPlan(args);
  if (built.errors.length) throw new Error(JSON.stringify(built.errors));
  return { ...built, sentences: args.source.sentences, source: args.source, args };
}
module.exports = { input, fixture };
