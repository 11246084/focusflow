const { it } = require('node:test');
const assert = require('node:assert/strict');
const { validateSelection } = require('../src/services/recutSelectionValidation.service');

// 句間停頓 0.2 秒也算進總長。
function source(lengths, hits = []) {
  let t = 0;
  return { excludedSentenceIds: [], sentences: lengths.map((len, i) => {
    const id = `s${i + 1}`; const s = { id, text: `第${i + 1}句`, startSec: t, endSec: t + len, retrievalHit: hits.includes(id),
      words: [{ text: `第${i + 1}句`, startSec: t, endSec: t + len }] };
    t += len + 0.2; return s;
  }) };
}
const selection = (src, from, to) => {
  const ids = src.sentences.map((s) => s.id); const a = ids.indexOf(from), b = ids.indexOf(to);
  return { answerable: true, unanswerableReason: null, openingSentenceId: null, ranges: [{ from, to }],
    sentenceLabels: ids.map((id, i) => ({ sentenceId: id, label: i >= a && i <= b ? '理由' : '離題' })) };
};

it('總長超過 65 秒一點點時拿掉最後一句，不再花模型呼叫', () => {
  const src = source([8, 8, 8, 8, 8, 8, 8, 7.5, 5]); // s1～s8 = 64.9 秒、s1～s9 = 70.1 秒
  const result = validateSelection(src, selection(src, 's1', 's9'));
  assert.equal(result.valid, true); assert.equal(result.autoTrimmed, true);
  assert.deepEqual(result.selection.ranges, [{ from: 's1', to: 's8' }]);
  assert.equal(result.selection.sentenceLabels.find((l) => l.sentenceId === 's9').label, '重複');
  assert.ok(result.durationSec <= 65);
});
it('最後一句是 ★ 命中句時改拿第一句', () => {
  const src = source([5, 8, 8, 8, 8, 8, 8, 8, 7.5], ['s9']); // s2～s9 = 64.9 秒
  const result = validateSelection(src, selection(src, 's1', 's9'));
  assert.equal(result.valid, true); assert.deepEqual(result.selection.ranges, [{ from: 's2', to: 's9' }]);
});
it('超過太多（拿兩句還不夠）時照常回報錯誤，交給模型重選', () => {
  const src = source([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
  const result = validateSelection(src, selection(src, 's1', 's11'));
  assert.equal(result.valid, false); assert.match(result.errors[0], /不在 30～65 秒/);
});
it('總長合規時不改動', () => {
  const src = source([8, 8, 8, 8, 8]);
  const result = validateSelection(src, selection(src, 's1', 's5'));
  assert.equal(result.valid, true); assert.equal(result.autoTrimmed, undefined);
});
