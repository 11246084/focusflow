const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const youtubeUploadService = require('../src/services/youtubeUpload.service');
const shortAssetPublishService = require('../src/services/shortAssetPublish.service');
const quarantineService = require('../src/services/youtubeQuarantine.service');
const { recoverShortAssetUploads } = require('../src/services/shortAssetRecovery.service');

const NOW = new Date('2026-10-20T00:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeUploadAccessToken',
  'youtubeUploadMaxAttempts',
  'youtubeUploadRecoveryEnabled',
  'youtubeUploadRecoveryBatchSize',
  'youtubeUploadStuckAfterMs',
  'shortScriptAutomationEnabled',
];

function needsReview() {
  return store.notifications.filter((item) => item.source === 'youtube_upload_needs_review');
}

function resolved() {
  return store.notifications.filter((item) => item.source === 'youtube_upload_resolved');
}

function activeAdminIds() {
  return store.users
    .filter((user) => user.role === 'admin' && user.isActive !== false)
    .map((user) => String(user._id))
    .sort();
}

function addStaleVideo(overrides = {}) {
  const video = {
    _id: '6f0000000000000000000001',
    courseId: ids.teacherCourse,
    title: 'Stale lecture',
    uploadedBy: ids.teacher,
    processing: { status: 'completed' },
    youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    ...overrides,
  };
  store.videos.push(video);
  return video;
}

describe('YouTube 上傳隔離與收尾通知', () => {
  let originalEnv;
  let tempDir;

  beforeEach(() => {
    resetStore();
    youtubeUploadService.resetYouTubeUploadState();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-youtube-notify-'));
    env.youtubeUploadEnabled = true;
    env.youtubeUploadAccessToken = 'notify-token';
    env.youtubeUploadMaxAttempts = 3;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadRecoveryBatchSize = 10;
    env.youtubeUploadStuckAfterMs = 15 * MINUTE_MS;
    env.shortScriptAutomationEnabled = true;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    youtubeUploadService.resetYouTubeUploadState();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('影片被恢復排程隔離時通知所有啟用中的管理員', async () => {
    store.users.push({ _id: '6f00000000000000000000a1', role: 'admin', isActive: false, name: 'Inactive', email: 'x@y.z' });
    addStaleVideo();

    await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });

    const notifications = needsReview();
    assert.deepEqual(notifications.map((item) => String(item.recipientId)).sort(), activeAdminIds());
    assert.equal(notifications[0].videoId, '6f0000000000000000000001');
    assert.deepEqual(notifications[0].courseIds, [ids.teacherCourse]);
    assert.match(notifications[0].title, /Stale lecture/);
  });

  it('同一次失敗重複觸發只通知一次', async () => {
    const video = addStaleVideo();
    await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });
    const { notifyYouTubeUploadNeedsReview } = require('../src/services/notification.service');

    await notifyYouTubeUploadNeedsReview({ kind: 'video', item: video });

    assert.equal(needsReview().length, activeAdminIds().length);
  });

  it('重設後再次被隔離算新的失敗，會再通知', async () => {
    const video = addStaleVideo();
    await youtubeUploadService.recoverPendingYouTubeUploads({ now: NOW });
    video.youtubeUpload = {
      status: 'uploading',
      attemptCount: 1,
      lastAttemptAt: new Date(NOW.getTime() - 20 * MINUTE_MS),
    };

    await youtubeUploadService.recoverPendingYouTubeUploads({ now: new Date(NOW.getTime() + 10 * MINUTE_MS) });

    assert.equal(needsReview().length, activeAdminIds().length * 2);
  });

  it('送出 bytes 後才失敗的上傳通知管理員，可安全重試的失敗不通知', async () => {
    const filePath = path.join(tempDir, 'lecture.mp4');
    fs.writeFileSync(filePath, Buffer.from('video bytes'));
    store.videos.push({
      _id: '6f0000000000000000000002',
      courseId: ids.teacherCourse,
      title: 'Ambiguous upload',
      filePath,
      processing: { status: 'completed' },
    });
    store.videos.push({
      _id: '6f0000000000000000000003',
      courseId: ids.teacherCourse,
      title: 'Session failure',
      filePath,
      processing: { status: 'completed' },
    });
    const ambiguousFetch = async (url) => {
      if (String(url).includes('uploadType=resumable')) {
        return { ok: true, status: 200, headers: { get: () => 'https://upload.youtube.test/s' } };
      }
      throw new Error('connection reset after bytes were sent');
    };
    const sessionFailureFetch = async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } });

    await youtubeUploadService.autoUploadVideoToYouTube('6f0000000000000000000002', { fetchImpl: ambiguousFetch });
    await youtubeUploadService.autoUploadVideoToYouTube('6f0000000000000000000003', { fetchImpl: sessionFailureFetch });

    assert.deepEqual([...new Set(needsReview().map((item) => String(item.videoId)))], ['6f0000000000000000000002']);
  });

  it('短片被隔離時通知管理員並帶來源腳本', async () => {
    const filePath = path.join(tempDir, 'short.mp4');
    fs.writeFileSync(filePath, Buffer.from('short bytes'));
    store.shortAssets.push({
      _id: '6f0000000000000000000004',
      courseId: ids.teacherCourse,
      sourceScriptId: '6f00000000000000000000b1',
      title: 'Stale short',
      filePath,
      status: 'draft',
      disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
      youtubeUpload: { status: 'uploading', attemptCount: 1, lastAttemptAt: new Date(NOW.getTime() - 30 * MINUTE_MS) },
    });

    await recoverShortAssetUploads({ now: NOW });

    const notifications = needsReview();
    assert.equal(notifications.length, activeAdminIds().length);
    assert.equal(notifications[0].videoId, null);
    assert.equal(notifications[0].scriptId, '6f00000000000000000000b1');
  });

  it('短片上傳失敗且不可重試時通知管理員', async () => {
    store.shortAssets.push({
      _id: '6f0000000000000000000005',
      courseId: ids.teacherCourse,
      title: 'Missing file short',
      filePath: path.join(tempDir, 'missing.mp4'),
      status: 'draft',
      disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
      youtubeUpload: { status: null, attemptCount: 0 },
    });

    await assert.rejects(shortAssetPublishService.runTrackedShortAssetUpload({ assetId: '6f0000000000000000000005' }));

    assert.equal(needsReview().length, activeAdminIds().length);
  });

  // decisions.md #34：可安全重試的失敗用完次數時，同樣通知管理員（同一次失敗只通知一次）。
  it('影片最後一次可安全重試的失敗達上限時通知管理員一次', async () => {
    const filePath = path.join(tempDir, 'lecture.mp4');
    fs.writeFileSync(filePath, Buffer.from('video bytes'));
    const video = {
      _id: '6f0000000000000000000007',
      courseId: ids.teacherCourse,
      title: 'Limit lecture',
      uploadedBy: ids.teacher,
      filePath,
      processing: { status: 'completed' },
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 2, nextRetryAt: null },
    };
    store.videos.push(video);
    const sessionFailureFetch = async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } });

    await youtubeUploadService.autoUploadVideoToYouTube(video._id, { fetchImpl: sessionFailureFetch });
    const { notifyYouTubeUploadNeedsReview } = require('../src/services/notification.service');
    await notifyYouTubeUploadNeedsReview({ kind: 'video', item: video, reason: 'retry_limit' });

    assert.equal(video.youtubeUpload.attemptCount, 3);
    assert.equal(video.youtubeUpload.retrySafe, true);
    const notifications = needsReview();
    assert.deepEqual(notifications.map((item) => String(item.recipientId)).sort(), activeAdminIds());
    assert.match(notifications[0].title, /已達重試上限：Limit lecture/);
    assert.equal(notifications[0].videoId, video._id);
    assert.ok(notifications[0].dedupeKey.includes(':retry_limit:'));
  });

  it('短片最後一次可安全重試的失敗達上限時通知管理員', async () => {
    const filePath = path.join(tempDir, 'short.mp4');
    fs.writeFileSync(filePath, Buffer.from('short bytes'));
    store.shortAssets.push({
      _id: '6f0000000000000000000008',
      courseId: ids.teacherCourse,
      title: 'Limit short',
      filePath,
      status: 'draft',
      disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 2 },
    });
    const sessionFailureFetch = async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } });

    await assert.rejects(shortAssetPublishService.runTrackedShortAssetUpload({
      assetId: '6f0000000000000000000008',
      fetchImpl: sessionFailureFetch,
    }));

    const asset = store.shortAssets.find((item) => item._id === '6f0000000000000000000008');
    assert.equal(asset.youtubeUpload.attemptCount, 3);
    assert.equal(asset.youtubeUpload.retrySafe, true);
    assert.equal(asset.youtubeUpload.nextRetryAt, null);
    assert.equal(needsReview().length, activeAdminIds().length);
    assert.match(needsReview()[0].title, /已達重試上限/);
  });

  it('未達上限的可安全重試失敗不通知', async () => {
    const filePath = path.join(tempDir, 'short.mp4');
    fs.writeFileSync(filePath, Buffer.from('short bytes'));
    store.shortAssets.push({
      _id: '6f0000000000000000000009',
      courseId: ids.teacherCourse,
      title: 'First failure short',
      filePath,
      status: 'draft',
      disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
      youtubeUpload: { status: null, attemptCount: 0 },
    });
    const sessionFailureFetch = async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } });

    await assert.rejects(shortAssetPublishService.runTrackedShortAssetUpload({
      assetId: '6f0000000000000000000009',
      fetchImpl: sessionFailureFetch,
    }));

    assert.equal(needsReview().length, 0);
  });

  it('管理員重設已達上限的影片後通知教師「已重新排入上傳」', async () => {
    const video = addStaleVideo({
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 3, failedAt: NOW },
    });

    await quarantineService.resetQuarantinedItem({ kind: 'video', id: video._id, now: NOW });

    const notifications = resolved();
    assert.equal(notifications.length, 1);
    assert.equal(String(notifications[0].recipientId), ids.teacher);
    assert.match(notifications[0].title, /已重新排入/);
  });

  it('套用後通知上傳影片的教師「已上傳完成」', async () => {
    const video = addStaleVideo({
      youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1, failedAt: NOW },
    });
    const fetchImpl = async (url) => {
      const text = String(url);
      const reply = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => '' });
      if (text.includes('/channels')) return reply({ items: [{ id: 'UCown', contentDetails: { relatedPlaylists: { uploads: 'UU' } } }] });
      if (text.includes('/videos')) return reply({ items: [{ snippet: { channelId: 'UCown' }, status: { privacyStatus: 'unlisted' } }] });
      throw new Error(text);
    };

    await quarantineService.applyQuarantinedItem({ kind: 'video', id: video._id, youtubeVideoId: 'abcdefghijk', fetchImpl });
    await quarantineService.applyQuarantinedItem({ kind: 'video', id: video._id, youtubeVideoId: 'abcdefghijk', fetchImpl })
      .catch(() => null);

    const notifications = resolved();
    assert.equal(notifications.length, 1);
    assert.equal(String(notifications[0].recipientId), ids.teacher);
    assert.match(notifications[0].title, /已上傳完成/);
    assert.equal(notifications[0].videoId, video._id);
  });

  it('沒有上傳者時，重設後通知課程教師「已重新排入上傳」', async () => {
    const course = store.courses.find((item) => item._id === ids.teacherCourse);
    store.shortAssets.push({
      _id: '6f0000000000000000000006',
      courseId: ids.teacherCourse,
      title: 'Short without uploader',
      filePath: 'uploads/short.mp4',
      status: 'draft',
      disclosure: {},
      youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 2, failedAt: NOW },
    });

    await quarantineService.resetQuarantinedItem({ kind: 'short_asset', id: '6f0000000000000000000006' });

    const notifications = resolved();
    assert.equal(notifications.length, 1);
    assert.equal(String(notifications[0].recipientId), String(course.teacherId));
    assert.match(notifications[0].title, /已重新排入/);
  });
});
