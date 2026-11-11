import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeQueriesSub } from '../src/pages/teacherDashboardUtils.js';

describe('學生提問卡片說明', () => {
  it('有網頁與 LINE 次數時分開顯示', () => {
    assert.equal(describeQueriesSub({ web: 12, line: 3 }), '網頁 12・LINE 3');
    assert.equal(describeQueriesSub({ web: 0, line: 0 }), '網頁 0・LINE 0');
  });

  it('舊版後端沒有欄位時維持原文字', () => {
    assert.equal(describeQueriesSub(undefined), '累計提問次數');
    assert.equal(describeQueriesSub(null), '累計提問次數');
    assert.equal(describeQueriesSub({}), '累計提問次數');
  });

  it('數值不是有限數字時維持原文字', () => {
    assert.equal(describeQueriesSub({ web: '12', line: 3 }), '累計提問次數');
    assert.equal(describeQueriesSub({ web: 12, line: NaN }), '累計提問次數');
    assert.equal(describeQueriesSub({ web: Infinity, line: 1 }), '累計提問次數');
  });
});
