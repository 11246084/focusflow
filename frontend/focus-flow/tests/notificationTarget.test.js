import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  YOUTUBE_NEEDS_REVIEW_SOURCE,
  YOUTUBE_RESOLVED_SOURCE,
  notificationTargetLabel,
  resolveNotificationTarget,
} from '../src/utils/notificationTarget.js';
import { isValidSubPage } from '../src/components/navigationConfig.js';

describe('通知點擊導向', () => {
  it('管理員的 YouTube 待確認通知導到待處理清單', () => {
    const target = resolveNotificationTarget({ source: YOUTUBE_NEEDS_REVIEW_SOURCE, videoId: 'v1' }, 'admin');
    assert.deepEqual(target, { sub: 'youtubeLifecycle', section: 'quarantine' });
    assert.equal(isValidSubPage('admin', target.sub), true);
    assert.equal(notificationTargetLabel(target), '前往待處理 →');
  });

  it('非管理員收到待確認通知時不導向管理員頁', () => {
    assert.equal(resolveNotificationTarget({ source: YOUTUBE_NEEDS_REVIEW_SOURCE, videoId: 'v1' }, 'teacher'), null);
  });

  it('教師的處理完成通知導到課程頁；短片有腳本時導到腳本頁', () => {
    assert.deepEqual(resolveNotificationTarget({ source: YOUTUBE_RESOLVED_SOURCE, videoId: 'v1' }, 'teacher'), { sub: 'courses' });
    assert.deepEqual(resolveNotificationTarget({ source: YOUTUBE_RESOLVED_SOURCE }, 'teacher'), { sub: 'courses' });
    assert.deepEqual(
      resolveNotificationTarget({ source: YOUTUBE_RESOLVED_SOURCE, scriptId: 's1', courseIds: ['c1'] }, 'teacher'),
      { sub: 'shortScripts', scriptId: 's1', courseId: 'c1' },
    );
  });

  it('既有通知維持原本導向', () => {
    assert.deepEqual(resolveNotificationTarget({ source: 'video_completed', videoId: 'v1' }, 'student'), { sub: 'courses' });
    assert.equal(resolveNotificationTarget({ source: 'video_completed', videoId: 'v1', videoAvailable: false }, 'student'), null);
    assert.equal(resolveNotificationTarget({ source: 'system_maintenance' }, 'student'), null);
    assert.equal(
      notificationTargetLabel(resolveNotificationTarget({ source: 'short_asset_rejected', scriptId: 's1' }, 'teacher')),
      '前往腳本 →',
    );
  });
});
