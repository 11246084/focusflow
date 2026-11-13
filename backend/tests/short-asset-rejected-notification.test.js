const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const { notifyShortAssetRejected } = require('../src/services/notification.service');

function asset(overrides = {}) {
  return { _id: newObjectId(), courseId: ids.teacherCourse, title: 'mAP 是什麼意思？', generationVersion: 1, ...overrides };
}

describe('成品退回通知', () => {
  beforeEach(() => resetStore());

  it('原片剪輯的退回通知說明修改講稿或重新製作', async () => {
    await notifyShortAssetRejected({ asset: asset({ recutVersionId: newObjectId() }), script: { _id: newObjectId(), createdBy: ids.teacher }, reasons: [{ code: 'subtitleIssue' }] });
    const [notification] = store.notifications;
    assert.match(notification.content, /字幕問題/);
    assert.match(notification.content, /修改講稿或重新製作/);
    assert.doesNotMatch(notification.content, /重新生成/);
  });

  it('數位分身的退回通知說明改好影片後重新傳回', async () => {
    await notifyShortAssetRejected({ asset: asset(), script: { _id: newObjectId(), createdBy: ids.teacher }, reasons: [{ code: 'audioIssue' }] });
    const [notification] = store.notifications;
    assert.match(notification.content, /重新傳回/);
  });
});
