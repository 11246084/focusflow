const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { autoFixCardsOutput, fixSceneTiming, fixEmptyCards, fixChipsParams, splitLongSubtitles, playbackTimeline } = require('../src/services/recutCardsAutoFix.service');

// 2026-11-19 正式站「摩爾定律」實際失敗的每句播放秒數。
const SPANS = [7.84, 1.74, 2.9, 8, 4.14, 7.8, 3.3, 7.86, 4.9, 7.28];
function fixture() {
  let t = 100;
  const sentences = SPANS.map((span, i) => {
    const s = { id: `s${i + 1}`, startSec: t, endSec: t + span - 0.2, text: `句子${i + 1}`,
      words: [{ text: `句子${i + 1}`, startSec: t, endSec: t + span - 0.2 }] };
    t += span; return s;
  });
  const words = sentences.flatMap((s) => s.words);
  const selectionResult = { clips: [{ sentenceIds: sentences.map((s) => s.id), startSec: words[0].startSec, endSec: words.at(-1).endSec, words }] };
  return { source: { sentences }, selectionResult };
}
const scene = (id, from, to, cues) => ({ id, from, to, component: 'statement', params: { text: id }, ...(cues ? { cues } : {}) });
const ranges = (output) => output.scenes.map((s) => `${s.from}-${s.to}`);

describe('recut 配圖卡程式修正', () => {
  it('依句子算出每句在成品裡的開始秒數', () => {
    const { source, selectionResult } = fixture();
    const timeline = playbackTimeline(source, selectionResult);
    assert.equal(timeline.order[1].t0.toFixed(2), '7.84');
    assert.equal(timeline.total.toFixed(2), (SPANS.reduce((a, b) => a + b) - 0.2).toFixed(2));
  });
  // 每句秒數：s1 7.84、s2 1.74、s3 2.9、s4 8、s5 4.14、s6 7.8、s7 3.3、s8 7.86、s9 4.9、s10 7.08；圖卡須 2～15 秒。
  const longFirst = () => [scene('a', 's1', 's4', { title: { sentenceId: 's1' }, detail: { sentenceId: 's4' } }), scene('b', 's5', 's5'),
    scene('c', 's6', 's7'), scene('d', 's8', 's8'), scene('e', 's9', 's10')];
  it('第一張 20.48 秒時把最後一句讓給下一張，兩張都回到 2～15 秒', () => {
    const { source, selectionResult } = fixture();
    const fixed = fixSceneTiming({ scenes: longFirst(), subtitles: [] }, playbackTimeline(source, selectionResult));
    assert.equal(fixed.changed, true);
    assert.deepEqual(ranges(fixed.output).slice(0, 2), ['s1-s3', 's4-s5']);
  });
  it('讓不出去時在句子邊界拆成兩張同樣的圖卡', () => {
    const { source, selectionResult } = fixture();
    const output = { scenes: [scene('a', 's1', 's4'), scene('b', 's5', 's6'), scene('c', 's7', 's8'), scene('d', 's9', 's10')], subtitles: [] };
    const fixed = fixSceneTiming(output, playbackTimeline(source, selectionResult));
    assert.deepEqual(ranges(fixed.output), ['s1-s1', 's2-s4', 's5-s6', 's7-s8', 's9-s10']);
    assert.equal(fixed.output.scenes[1].id, 'ab'); assert.equal(fixed.output.scenes[1].component, 'statement');
  });
  it('太短的圖卡向相鄰圖卡借一句', () => {
    const { source, selectionResult } = fixture();
    // s2 只有 1.74 秒，不到 2 秒。
    const output = { scenes: [scene('a', 's1', 's1'), scene('b', 's2', 's2'), scene('c', 's3', 's4'), scene('d', 's5', 's6'), scene('e', 's7', 's8'), scene('f', 's9', 's10')], subtitles: [] };
    const fixed = fixSceneTiming(output, playbackTimeline(source, selectionResult));
    assert.deepEqual(ranges(fixed.output).slice(0, 3), ['s1-s1', 's2-s3', 's4-s4']);
  });
  it('一張圖卡長到要拆成三張以上時逐步拆開', () => {
    const { source, selectionResult } = fixture();
    const output = { scenes: [scene('a', 's1', 's1'), scene('b', 's2', 's9'), scene('c', 's10', 's10')], subtitles: [] };
    const timeline = playbackTimeline(source, selectionResult);
    const fixed = fixSceneTiming(output, timeline);
    const at = (id) => timeline.order.findIndex((o) => o.id === id);
    assert.ok(fixed.output.scenes.length >= 5);
    for (const sc of fixed.output.scenes) {
      const a = at(sc.from), b = at(sc.to);
      const d = (b + 1 < timeline.order.length ? timeline.order[b + 1].t0 : timeline.total) - timeline.order[a].t0;
      assert.ok(d >= 2 && d <= 15, `${sc.id} ${sc.from}-${sc.to} ${d}`);
    }
  });
  it('圖卡第一個元素在開場 3 秒後才出現時，移除太晚的 cue', () => {
    const { source, selectionResult } = fixture();
    // s4 在 s2 開始後 4.64 秒。
    const output = { scenes: [scene('a', 's1', 's1'), scene('b', 's2', 's4', { title: { sentenceId: 's4' }, detail: { sentenceId: 's4' } })], subtitles: [] };
    const fixed = fixEmptyCards(output, playbackTimeline(source, selectionResult));
    assert.equal(fixed.changed, true); assert.deepEqual(Object.keys(fixed.output.scenes[1].cues), []);
    const good = { scenes: [scene('b', 's2', 's4', { title: { sentenceId: 's3' }, detail: { sentenceId: 's4' } })], subtitles: [] };
    assert.equal(fixEmptyCards(good, playbackTimeline(source, selectionResult)).changed, false);
  });
  it('搬走的句子上的 cue 一併移除', () => {
    const { source, selectionResult } = fixture();
    const fixed = fixSceneTiming({ scenes: longFirst(), subtitles: [] }, playbackTimeline(source, selectionResult));
    assert.deepEqual(Object.keys(fixed.output.scenes[0].cues), ['title']);
  });
  it('時間都合規時不改動', () => {
    const { source, selectionResult } = fixture();
    const output = { scenes: [scene('a', 's1', 's2'), scene('b', 's3', 's4'), scene('c', 's5', 's6'), scene('d', 's7', 's8'), scene('e', 's9', 's9'), scene('f', 's10', 's10')], subtitles: [] };
    assert.equal(fixSceneTiming(output, playbackTimeline(source, selectionResult)).changed, false);
  });

  const sentence = { id: 's1', text: '到2000年之後出現了一個東西叫默爾定律相信很多同學都聽過',
    words: ['到', '2000', '年', '之後', '出現', '了', '一個', '東西', '叫', '默爾', '定律', '相信', '很多', '同學', '都', '聽過'].map((text, i) => ({ text, startSec: i, endSec: i + 1 })) };
  it('超過 20 字的字幕在詞的邊界切成兩行，第二行錨點是原句中唯一的詞組', () => {
    const output = { scenes: [], subtitles: [{ from: { sentenceId: 's1' }, runs: [{ t: '到2000年之後出現了一個東西叫' }, { t: '默爾定律', hl: true }, { t: '相信很多同學都聽過' }] }] };
    const fixed = splitLongSubtitles(output, { sentences: [sentence] });
    assert.equal(fixed.changed, true); assert.equal(fixed.output.subtitles.length, 2);
    const texts = fixed.output.subtitles.map((s) => s.runs.map((r) => r.t).join(''));
    assert.equal(texts.join(''), '到2000年之後出現了一個東西叫默爾定律相信很多同學都聽過');
    assert.ok(texts.every((t) => [...t].length <= 20));
    assert.ok(sentence.text.includes(fixed.output.subtitles[1].from.text));
    assert.ok(fixed.output.subtitles.some((s) => s.runs.some((r) => r.hl && r.t.includes('定律'))));
  });
  it('精簡改寫過、對不回原句的字幕維持原樣', () => {
    const output = { scenes: [], subtitles: [{ from: { sentenceId: 's1' }, runs: [{ t: '兩千年後出現默爾定律大家都有聽過這個說法' }] }] };
    assert.equal(splitLongSubtitles(output, { sentences: [sentence] }).changed, false);
  });
  it('autoFixCardsOutput 同時處理字幕與圖卡秒數', () => {
    const { source, selectionResult } = fixture();
    const output = { scenes: longFirst(), subtitles: [] };
    assert.equal(autoFixCardsOutput(output, { source, selectionResult }).changed, true);
  });
  it('chips 超過 6 個保留前 6 個，超出範圍的強調一併移除', () => {
    const output = { scenes: [{ id: 'a', component: 'chips', params: { chips: ['一', '二', '三', '四', '五', '六', '七'], highlight: [1, 6] } }] };
    const fixed = fixChipsParams(output);
    assert.equal(fixed.output.scenes[0].params.chips.length, 6); assert.deepEqual(fixed.output.scenes[0].params.highlight, [1]);
  });
  it('chips 只有 1 個時能拆就拆，拆不開改成單句引言圖卡', () => {
    const split = fixChipsParams({ scenes: [{ id: 'a', component: 'chips', params: { chips: [{ text: 'CPU、GPU、記憶體' }] } }] });
    assert.deepEqual(split.output.scenes[0].params.chips, ['CPU', 'GPU', '記憶體']);
    const quote = fixChipsParams({ scenes: [{ id: 'a', component: 'chips', params: { chips: ['摩爾定律'] }, cues: { enter: { sentenceId: 's1' } } }] });
    assert.equal(quote.output.scenes[0].component, 'quote-reveal'); assert.deepEqual(quote.output.scenes[0].params, { text: '摩爾定律' });
    assert.equal(quote.output.scenes[0].cues, undefined);
  });
  it('chips 數量合規時不改動', () => {
    assert.equal(fixChipsParams({ scenes: [{ id: 'a', component: 'chips', params: { chips: ['甲', '乙'] } }] }).changed, false);
  });
});
