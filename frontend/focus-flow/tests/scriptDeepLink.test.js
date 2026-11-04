import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  OPEN_SCRIPT_EVENT,
  SHORT_SCRIPT_PAGE,
  SHORT_UPLOAD_PAGE,
  consumePendingScriptOpen,
  isScriptTargetForPage,
  pickInitialCourseId,
  recallShortScriptCourse,
  rememberShortScriptCourse,
  requestOpenScript,
} from '../src/utils/scriptDeepLink.js';

function installBrowserStubs() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.window = new EventTarget();
}

describe('開啟指定腳本的深連結', () => {
  beforeEach(installBrowserStubs);

  it('沒指定目標頁時給腳本頁（退回通知維持原本行為）', () => {
    requestOpenScript({ scriptId: 's1', courseId: 'c1' });
    assert.equal(consumePendingScriptOpen(SHORT_UPLOAD_PAGE), null);
    assert.deepEqual(consumePendingScriptOpen(SHORT_SCRIPT_PAGE), { scriptId: 's1', courseId: 'c1', page: SHORT_SCRIPT_PAGE });
    assert.equal(consumePendingScriptOpen(SHORT_SCRIPT_PAGE), null);
  });

  it('指定上傳短片頁時，腳本頁不會取走這個請求', () => {
    requestOpenScript({ scriptId: 's2', courseId: 'c1', page: SHORT_UPLOAD_PAGE });
    assert.equal(consumePendingScriptOpen(SHORT_SCRIPT_PAGE), null);
    assert.equal(consumePendingScriptOpen(SHORT_UPLOAD_PAGE).scriptId, 's2');
  });

  it('舊格式（沒有 page 欄位）視為腳本頁', () => {
    sessionStorage.setItem('ff_open_script', JSON.stringify({ scriptId: 's3', courseId: '' }));
    assert.equal(consumePendingScriptOpen(SHORT_UPLOAD_PAGE), null);
    assert.equal(consumePendingScriptOpen().scriptId, 's3');
  });

  it('已掛載的頁面收到的事件帶有目標頁，可依頁面過濾', () => {
    const received = [];
    window.addEventListener(OPEN_SCRIPT_EVENT, (event) => received.push(event.detail));
    requestOpenScript({ scriptId: 's4', courseId: 'c2', page: SHORT_UPLOAD_PAGE });
    assert.equal(received.length, 1);
    assert.equal(isScriptTargetForPage(received[0], SHORT_UPLOAD_PAGE), true);
    assert.equal(isScriptTargetForPage(received[0], SHORT_SCRIPT_PAGE), false);
  });

  it('沒有 scriptId 時不送出請求', () => {
    requestOpenScript({ scriptId: '', courseId: 'c1' });
    assert.equal(consumePendingScriptOpen(), null);
  });
});

describe('兩頁共用的課程選擇', () => {
  beforeEach(installBrowserStubs);
  const courses = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];

  it('記住的課程在切換頁面後可以取回', () => {
    rememberShortScriptCourse('b');
    assert.equal(recallShortScriptCourse(), 'b');
  });

  it('深連結指定的課程優先，其次是記住的，最後是第一門', () => {
    assert.equal(pickInitialCourseId(courses, { requestedId: 'c', rememberedId: 'b' }), 'c');
    assert.equal(pickInitialCourseId(courses, { requestedId: 'zz', rememberedId: 'b' }), 'b');
    assert.equal(pickInitialCourseId(courses, { rememberedId: 'gone' }), 'a');
    assert.equal(pickInitialCourseId([], {}), '');
  });
});
