const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const { recutTaskFailureText, recutRenderFailureText, TASK_FAILURE_GENERIC, RENDER_FAILURE_GENERIC } = require('../src/utils/recutFailureText');
const { notifyRecutTaskFinished } = require('../src/services/notification.service');

const TECHNICAL = /cards|cue|mustFix|schema|RECUT_|第 \d+\/\d+ 個字|出處|\d+\.\d+～/;

describe('recut 失敗通知給教師的說法', () => {
  const cases = [
    ['RECUT_CALL_LIMIT_EXCEEDED', /AI 使用次數已用完/],
    ['RECUT_SOURCE_UNAVAILABLE', /找不到這門課的原片/],
    ['RECUT_SOURCE_UNDECODABLE', /原片檔案無法讀取/],
    ['RECUT_WINDOW_NOT_FOUND', /內容/],
    ['RECUT_SOURCE_TOO_SHORT', /內容不足/],
    ['SHORT_SCRIPT_EVIDENCE_EMPTY', /找不到能回答/],
    ['RECUT_REPAIR_STALLED', /一直沒有達到標準/],
    ['RECUT_VALIDATION_FAILED', /一直沒有達到標準/],
    ['RECUT_MODEL_FAILED', /AI 暫時無法完成/],
  ];
  for (const [code, pattern] of cases) {
    it(`${code} 轉成白話`, () => {
      const text = recutTaskFailureText({ code, message: 'cards 修正過程中同一組錯誤已第 3 次出現' });
      assert.match(text, pattern);
      assert.doesNotMatch(text, TECHNICAL);
    });
  }

  it('未知或缺少原因用通用說法，不帶原始訊息', () => {
    for (const error of [{ code: 'RECUT_ASR_INVALID', message: '第 68/408 個字「就是」28.4～28.4 秒' }, { code: 'WHATEVER', message: '字幕4數字沒有對應原句出處：5090' }, null, undefined]) {
      assert.equal(recutTaskFailureText(error), TASK_FAILURE_GENERIC);
    }
    assert.match(TASK_FAILURE_GENERIC, /短影片製作頁重新產生/);
  });

  it('渲染失敗只回固定說法或對應說法', () => {
    assert.match(recutRenderFailureText({ code: 'RECUT_TEXT_OVERFLOW' }), /圖卡文字太長/);
    assert.equal(recutRenderFailureText({ code: 'X', message: 'ffmpeg exited 1' }), RENDER_FAILURE_GENERIC);
  });

  describe('通知內容', () => {
    beforeEach(() => resetStore());
    it('失敗通知不露出內部訊息，原始錯誤仍留在工單上', async () => {
      const task = { _id: newObjectId(), status: 'failed', courseId: ids.teacherCourse, scriptId: newObjectId(), requestedBy: ids.teacher,
        error: { code: 'RECUT_REPAIR_STALLED', message: 'cards 修正過程中同一組錯誤已第 3 次出現' } };
      await notifyRecutTaskFinished(task);
      const [notification] = store.notifications;
      assert.equal(notification.title, '短片這次沒有做成，已保留原版');
      assert.match(notification.content, /一直沒有達到標準/);
      assert.doesNotMatch(notification.content, /cards|第 3 次/);
      assert.equal(task.error.message, 'cards 修正過程中同一組錯誤已第 3 次出現');
    });
  });
});
