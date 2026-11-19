const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toTraditional, SIMPLIFIED_TO_TRADITIONAL } = require('../src/utils/simplifiedToTraditional');

it('涵蓋 short_render 簡體偵測清單的每一個字，字幕不會因簡體字被擋', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../short_render/src/plan/text.js'), 'utf8');
  const list = text.match(/SIMPLIFIED_ONLY = new Set\(\[([\s\S]*?)\]\)/)[1].match(/'(.)'/g).map((v) => v[1]);
  assert.ok(list.length > 50);
  assert.deepEqual(list.filter((ch) => !SIMPLIFIED_TO_TRADITIONAL.has(ch)), []);
});
it('一對多的字不轉，繁體字與英數維持原樣', () => {
  for (const ch of '后里干只着面范钟冲汇脏舍谷余斗台伙') assert.equal(SIMPLIFIED_TO_TRADITIONAL.has(ch), false, ch);
  assert.equal(toTraditional('默爾定律 iPhone 16 Pro'), '默爾定律 iPhone 16 Pro');
  assert.equal(toTraditional('美国阿波罗登月'), '美國阿波羅登月');
});
