import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickInitialTab } from '../src/utils/shortScriptTabs.js';

const KEYS = ['action', 'waiting', 'published', 'dismissed'];

describe('狀態分頁的預設選擇', () => {
  it('需要你處理有資料時選它', () => {
    assert.equal(pickInitialTab(KEYS, { action: 2, waiting: 3, published: 1, dismissed: 0 }), 'action');
  });

  it('需要你處理是 0 時選等待中，也是 0 時選第一個有資料的分頁', () => {
    assert.equal(pickInitialTab(KEYS, { action: 0, waiting: 3, published: 1, dismissed: 0 }), 'waiting');
    assert.equal(pickInitialTab(KEYS, { action: 0, waiting: 0, published: 0, dismissed: 2 }), 'dismissed');
  });

  it('全部是 0 時選第一個分頁', () => {
    assert.equal(pickInitialTab(KEYS, { action: 0, waiting: 0, published: 0, dismissed: 0 }), 'action');
  });

  it('記住的分頁優先，即使是 0；不認得的鍵不採用', () => {
    assert.equal(pickInitialTab(KEYS, { action: 2, waiting: 0, published: 0, dismissed: 0 }, 'waiting'), 'waiting');
    assert.equal(pickInitialTab(KEYS, { action: 2 }, 'others'), 'action');
  });
});
