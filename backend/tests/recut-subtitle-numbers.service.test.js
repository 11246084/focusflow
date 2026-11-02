'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { numericTokens, validateSubtitleSources } = require('../src/services/recutCardsValidation.service');
const validate = (original, text) => validateSubtitleSources({ subtitles: [{ from: { sentenceId: 's1' }, runs: [{ t: text }] }] }, { sentences: [{ id: 's1', text: original }] });
it('Chinese, Arabic and full-width equivalent quantities share a canonical numeric token', () => {
  for (const [original, text] of [['工具1', '一個工具'], ['999個', '九百九十九個'], ['2萬', '兩萬'], ['負1.5秒', '-一點五秒'], ['50%', '百分之五十'], ['1/3', '三分之一'], ['2026年', '二〇二六年'], ['１２３４個', '一千二百三十四個']]) assert.equal(validate(original, text).valid, true, `${original} -> ${text}`);
  assert.deepEqual(numericTokens('三個、五次、兩層、第十步、三維'), ['3', '5', '2', '10', '3']);
});
it('Chinese new quantities, changed signs/decimals/percentages and unsupported units fail closed', () => {
  for (const [original, text] of [['OpenCV 是工具1。', '共有九百九十九個工具'], ['1個', '兩個'], ['1.5秒', '十五秒'], ['-1', '一'], ['50%', '百分之五十一'], ['1/3', '三分之二']]) assert.equal(validate(original, text).valid, false, `${original} -> ${text}`);
});
it('ordinary lexical uses do not invent quantity one or ten million', () => {
  for (const text of ['一起看工具', '一般工具也一樣', '一定要統一', '一些工具一致', '千萬不要混用，萬一失敗']) assert.deepEqual(numericTokens(text), []);
  assert.equal(validate('工具', '一起看工具').valid, true);
  assert.deepEqual(numericTokens('參考參數及陸地'), []); assert.equal(validate('看這個工具', '參考這個工具').valid, true);
  assert.deepEqual(numericTokens('參佰個工具、陸個範例、第參章'), ['300', '6', '3']);
});
