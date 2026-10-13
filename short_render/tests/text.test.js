'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText, normalizeWords, extractNumbers, numbersInEvidence, similarity, findSimplifiedCharacters,
} = require('../src/plan/text');
const { locateAnchor } = require('../src/plan');

describe('normalizeText：中文數字與阿拉伯數字視為相同', () => {
  it('兩百張 = 200張、六十萬 = 60萬、六開頭 = 6開頭', () => {
    assert.equal(normalizeText('兩百張'), normalizeText('200張'));
    assert.equal(normalizeText('六十萬'), normalizeText('60萬'));
    assert.equal(normalizeText('六開頭'), normalizeText('6開頭'));
    assert.equal(normalizeText('一百零五'), '105');
    assert.equal(normalizeText('十五'), '15');
    assert.equal(normalizeText('二十'), '20');
  });

  it('「個十百千萬」這種逐位報讀不會被誤當成數字', () => {
    assert.equal(normalizeText('個十百千萬'), '個十百千萬');
    assert.equal(normalizeText('個、十、百、千、萬'), '個十百千萬');
  });

  it('單獨的「十」「百」「萬」不轉換', () => {
    assert.equal(normalizeText('十'), '十');
    assert.equal(normalizeText('萬'), '萬');
  });

  it('忽略標點、空白、全形數字與大小寫', () => {
    assert.equal(normalizeText('Siri，說 ０５'), 'siri說05');
  });
});

describe('normalizeWords：ASR 把數字拆成多個字詞時仍能對回字詞索引', () => {
  it('「兩」「百」「張」三個字詞合成 200，起訖對到第 0～2 個字詞', () => {
    const words = [{ w: '兩' }, { w: '百' }, { w: '張' }, { w: '的' }];
    const result = normalizeWords(words);
    assert.equal(result.chars.join(''), '200張的');
    assert.equal(result.startWord[0], 0);
    assert.equal(result.endWord[2], 1);
    assert.equal(result.startWord[3], 2);
  });

  it('錨點 200張 能在「兩 百 張」的字詞序列裡命中', () => {
    const words = [
      { w: '入', s: 0, e: 0.1 }, { w: '門', s: 0.1, e: 0.2 }, { w: '兩', s: 0.2, e: 0.4 },
      { w: '百', s: 0.4, e: 0.6 }, { w: '張', s: 0.6, e: 0.8 }, { w: '的', s: 0.8, e: 1 },
    ];
    const found = locateAnchor(words, { text: '200張的' });
    assert.deepEqual([found.startWord, found.endWord, found.exact], [2, 5, true]);
  });

  it('相鄰的數字被標點隔開時不會接成一個數字（六十，六十萬 不是 66…）', () => {
    assert.equal(normalizeText('六十,六十萬'), '6060萬');
    const words = [{ w: '算', s: 0, e: 1 }, { w: '六十,', s: 1, e: 2 }, { w: '六十萬,', s: 2, e: 3 }, { w: '六十。', s: 3, e: 4 }];
    const found = locateAnchor(words, { text: '60萬' });
    assert.deepEqual([found.startWord, found.endWord, found.exact], [2, 2, true]);
  });

  it('60萬 能對上「六 十 萬」', () => {
    const words = [{ w: '假設', s: 0, e: 1 }, { w: '算', s: 1, e: 1.2 }, { w: '六', s: 1.2, e: 1.4 }, { w: '十', s: 1.4, e: 1.6 }, { w: '萬', s: 1.6, e: 1.8 }];
    const found = locateAnchor(words, { text: '假設算60萬' });
    assert.deepEqual([found.startWord, found.endWord], [0, 4]);
  });
});

describe('其他文字工具', () => {
  it('extractNumbers 去掉千分位逗號並支援小數', () => {
    assert.deepEqual(extractNumbers('12,000 萬 ≈ 1.2 億'), [12000, 1.2]);
  });

  it('numbersInEvidence 含單字中文數字（四張、六開頭）', () => {
    const numbers = numbersInEvidence('上面就差了四張A100，六開頭一張');
    assert.ok(numbers.has(4) && numbers.has(6) && numbers.has(100) && numbers.has(1));
  });

  it('similarity 範圍 0..1', () => {
    assert.equal(similarity('abc', 'abc'), 1);
    assert.ok(similarity('餐廳', '完全不同') < 0.5);
  });

  it('簡體偵測', () => {
    assert.deepEqual(findSimplifiedCharacters('这个数据'), ['这', '数', '据']);
    assert.deepEqual(findSimplifiedCharacters('這個資料'), []);
  });
});
