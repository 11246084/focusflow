const assert = require('node:assert/strict');
const { beforeEach, afterEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const upload = require('../src/services/youtubeUpload.service');
const remote = require('../src/services/youtubeRemoteState.service');
const settings = require('../src/services/youtubeLifecycleSettings.service');
const { useYouTubeTestEnvironment } = require('./helpers/youtubeTestEnvironment');
const NOW = new Date('2026-10-28T04:00:00Z');
const response = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function add(overrides = {}, kind = 'video') {
  const item = { _id: newObjectId(), title: '教材', courseId: ids.teacherCourse, deletedAt: null,
    videoSource: 'upload', youtubeVideoId: `yt${newObjectId()}`, generationVersion: 1,
    youtubeUpload: { status: 'uploaded', remoteState: 'processing', uploadedAt: NOW, privacyStatus: 'unlisted', attemptId: 'attempt' }, ...overrides };
  store[kind === 'video' ? 'videos' : 'shortAssets'].push(item);
  return item;
}

function fake({ privacy = 'unlisted', uploadStatus = 'processed', embeddable = true, channel = 'own', failure = false, readback = true, updateFailure = false } = {}) {
  const calls = []; let current = privacy;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'fake', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
    if (String(url).includes('/channels')) return response({ items: [{ id: 'own' }] });
    if (options.method === 'PUT') {
      if (updateFailure) return response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
      if (readback) current = JSON.parse(options.body).status.privacyStatus;
      return response({});
    }
    if (failure) throw new Error('fake query failure');
    const requested = new URL(url).searchParams.get('id').split(',');
    return response({ items: requested.map((id) => ({ id, snippet: { channelId: channel }, status: { privacyStatus: current, uploadStatus, embeddable } })) });
  };
  return { fetchImpl, calls };
}

describe('Q-B 遠端就緒與隱私', () => {
  let restore; let saved; let root;
  beforeEach(() => {
    resetStore(); store.videos = []; store.shortAssets = [];
    restore = useYouTubeTestEnvironment(env, upload.resetYouTubeUploadState);
    saved = { uploadDir: env.uploadDir, youtubePrivacyGuardEnabled: env.youtubePrivacyGuardEnabled };
    env.youtubePrivacyGuardEnabled = true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-qb-')); env.uploadDir = root;
  });
  afterEach(() => { remote.stopYouTubeRemoteStateScheduler(); restore(); Object.assign(env, saved); fs.rmSync(root, { recursive: true, force: true }); });

  for (const privacy of ['public', 'private', null]) it(`processed 但 ${privacy} 不切換`, async () => {
    const item = add(); const { fetchImpl } = fake({ privacy });
    const checked = await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl, now: NOW });
    assert.equal(checked.youtubeUpload.remoteState, 'blocked');
    assert.equal(item.videoSource, 'upload');
  });
  it('uploaded 不切換；processed 才記 readyAt 與切換', async () => {
    const item = add();
    await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: fake({ uploadStatus: 'uploaded' }).fetchImpl, now: NOW });
    assert.equal(item.youtubeUpload.remoteState, 'processing'); assert.equal(item.videoSource, 'upload');
    await remote.checkItemRemoteState({ kind: 'video', id: item._id, fetchImpl: fake().fetchImpl, now: NOW });
    assert.equal(item.youtubeUpload.remoteState, 'ready'); assert.equal(item.videoSource, 'youtube');
    assert.deepEqual(item.youtubeUpload.readyAt, NOW);
  });
  it('不允許嵌入時 blocked', () => {
    assert.equal(remote.evaluateRemoteState('video', add(), { status: { uploadStatus: 'processed', privacyStatus: 'unlisted', embeddable: false } }, NOW).blockedReason, 'embedding_disabled');
  });
  it('處理失敗保留 rejectionReason 並通知去重', async () => {
    const item = add(); const raw = { status: { uploadStatus: 'rejected', rejectionReason: 'length', privacyStatus: 'unlisted' } };
    await remote.applyRemoteObservation({ kind: 'video', item, remote: raw, now: NOW });
    await remote.applyRemoteObservation({ kind: 'video', item: structuredClone(item), remote: raw, now: NOW });
    assert.equal(item.youtubeUpload.blockedReason, 'rejected:length');
    const notifications = store.notifications.filter((entry) => entry.dedupeKey?.includes('remote_blocked'));
    assert.equal(notifications.length, 1);
  });
  it('查詢失敗保持 processing，連續一小時才發告警', async () => {
    const item = add(); const fetchImpl = fake({ failure: true }).fetchImpl;
    await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl, now: NOW });
    assert.equal(item.youtubeUpload.remoteState, 'processing');
    assert.equal(store.notifications.length, 0);
    await remote.checkItemRemoteState({ kind: 'video', id: item._id, fetchImpl, now: new Date(NOW.getTime() + 3600000) });
    assert.equal(store.notifications.length, 1);
  });
  it('24 小時仍 uploaded 才 processing_timeout', () => {
    const item = add(); item.youtubeUpload.uploadedAt = new Date(NOW.getTime() - 86400000);
    assert.equal(remote.evaluateRemoteState('video', item, { status: { uploadStatus: 'uploaded', privacyStatus: 'unlisted' } }, NOW).blockedReason, 'processing_timeout');
  });
  it('每批最多 50 支，所有系統影片與封存短片每日檢查', async () => {
    for (let index = 0; index < 51; index += 1) add();
    add({ status: 'archived', youtubePrivacyStatus: 'private' }, 'short_asset');
    const { fetchImpl, calls } = fake();
    const result = await remote.checkYouTubeRemoteStates({ fetchImpl, now: NOW });
    assert.equal(result.checked, 52);
    const lists = calls.filter((call) => call.url.includes('/videos?'));
    assert.deepEqual(lists.map((call) => new URL(call.url).searchParams.get('id').split(',').length), [50, 2]);
  });
  it('舊資料不查之前維持 YouTube；首次查不合格切回現存原片', async () => {
    const filePath = path.join(root, '原片.mp4'); fs.writeFileSync(filePath, 'fixture');
    const item = add({ videoSource: 'youtube', filePath, youtubeUpload: { status: 'uploaded', uploadedAt: NOW } });
    assert.equal(item.videoSource, 'youtube');
    await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: fake({ privacy: 'private' }).fetchImpl, now: NOW });
    assert.equal(item.videoSource, 'upload'); assert.equal(item.youtubeUpload.remoteState, 'blocked');
  });
  it('退回短片 private、封存短片 unlisted/private 合格', () => {
    for (const [item, privacy] of [[{ reviewStatus: 'rejected' }, 'private'], [{ status: 'archived' }, 'private'], [{ status: 'archived' }, 'unlisted']]) {
      assert.equal(remote.evaluateRemoteState('short_asset', item, { status: { privacyStatus: privacy, uploadStatus: 'processed' } }, NOW).remoteState, 'ready');
    }
  });
  it('insert 隱私讀實值，缺省補查仍失敗存 null', async () => {
    for (const privacyStatus of ['unlisted', 'private']) {
      assert.equal(await remote.readUploadPrivacy({ response: { status: { privacyStatus } }, fetchImpl: () => { throw new Error('must not fetch'); } }), privacyStatus);
    }
    assert.equal(await remote.readUploadPrivacy({ youtubeVideoId: 'abcdefghijk', fetchImpl: fake({ privacy: 'private' }).fetchImpl }), 'private');
    assert.equal(await remote.readUploadPrivacy({ youtubeVideoId: 'abcdefghijk', fetchImpl: fake({ failure: true }).fetchImpl }), null);
  });
  it('public 開關關閉只通知；開啟後 own channel 轉私人並讀回', async () => {
    const item = add(); const api = fake({ privacy: 'public' });
    await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 0);
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true, user: { id: ids.admin } });
    await remote.checkItemRemoteState({ kind: 'video', id: item._id, fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 1);
    assert.equal(item.youtubeUpload.privacyStatus, 'private');
    assert.equal(item.youtubeUpload.privacyIncidents.at(-1).result, 'confirmed');
    assert.equal(item.youtubeUpload.remoteState, 'blocked');
  });
  it('非自家頻道絕不修改隱私', async () => {
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
    const api = fake({ privacy: 'public', channel: 'someoneElse' });
    await remote.checkItemRemoteState({ kind: 'video', item: add(), fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 0);
  });
  it('不把修改成功當確認，readback public 保留公開與退避紀錄', async () => {
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
    const item = add(); const api = fake({ privacy: 'public', readback: false });
    await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(item.youtubeUpload.privacyStatus, 'public');
    assert.equal(item.youtubeUpload.privacyIncidents.at(-1).result, 'readback:public');
    assert.equal(remote.retryDue(item, new Date(NOW.getTime() + 299999)), false);
    assert.equal(remote.retryDue(item, new Date(NOW.getTime() + 300000)), true);
  });
  it('每小時第 11 次不呼叫 videos.update，管理員切換保留計數', async () => {
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
    const api = fake({ privacy: 'public', readback: false });
    for (let index = 0; index < 11; index += 1) await remote.checkItemRemoteState({ kind: 'video', item: add(), fetchImpl: api.fetchImpl, now: NOW });
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 10);
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: false });
    assert.equal(store.runtimeSettings.find((item) => item.key === 'privacy_guard').value.guard.updates.length, 10);
    assert.equal(store.runtimeSettings.find((item) => item.key === 'privacy_guard').history.length, 2);
  });
  it('一般 quotaExceeded 暫停到 LA 午夜，DST 夏冬皆正確', async () => {
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
    const api = fake({ privacy: 'public', updateFailure: true });
    await remote.checkItemRemoteState({ kind: 'video', item: add(), fetchImpl: api.fetchImpl, now: NOW });
    assert.deepEqual(new Date(store.runtimeSettings.find((item) => item.key === 'privacy_guard').value.guard.quotaUntil), new Date('2026-10-28T07:00:00Z'));
    assert.deepEqual(remote.nextPacificMidnight(new Date('2026-12-01T08:30:00Z')), new Date('2026-12-02T08:00:00Z'));
  });
  it('管理員改回 unlisted 記 actor 並重跑 ready', async () => {
    const item = add({ youtubeUpload: { status: 'uploaded', remoteState: 'blocked', privacyStatus: 'private', uploadedAt: NOW } });
    const result = await remote.restoreUnlisted({ kind: 'video', id: item._id, actor: ids.admin, fetchImpl: fake({ privacy: 'private' }).fetchImpl, now: NOW });
    assert.equal(result.remoteState, 'ready'); assert.equal(result.privacyStatus, 'unlisted');
    assert.equal(item.youtubeUpload.privacyIncidents.at(-1).actor, ids.admin);
  });
  it('清理前查詢故障或不合格拒絕，即使已有 ready', async () => {
    const item = add(); item.youtubeUpload.remoteState = 'ready'; item.youtubeUpload.readyAt = NOW; item.videoSource = 'youtube';
    assert.equal(await remote.verifyRemoteReadyForCleanup({ kind: 'video', id: item._id, fetchImpl: fake({ failure: true }).fetchImpl, now: NOW }), 'remote_check_failed');
    assert.equal(await remote.verifyRemoteReadyForCleanup({ kind: 'video', id: item._id, fetchImpl: fake({ privacy: 'private' }).fetchImpl, now: NOW }), 'remote_not_ready');
  });
  it('投影或 hydration 補入 null 的 legacy callback 用完整 lean 判定並補上架', async () => {
    const item = add({ status: 'draft', reviewStatus: 'approved', reviewedGenerationVersion: 1,
      youtubeUpload: { status: 'uploaded', uploadedAt: NOW } }, 'short_asset');
    const supplied = { _id: item._id, youtubeVideoId: item.youtubeVideoId, generationVersion: 1,
      youtubeUpload: { status: 'uploaded', attemptId: null, readyAt: null } };
    await remote.checkItemRemoteState({ kind: 'short_asset', item: supplied, fetchImpl: fake().fetchImpl, now: NOW });
    assert.equal(item.youtubeUpload.remoteState, 'ready'); assert.equal(item.status, 'published');
  });
  it('隱私失敗逐次退避 5 分、15 分、1 小時、之後每 6 小時', () => {
    const item = add(); item.youtubeUpload.privacyStatus = 'public';
    item.youtubeUpload.privacyIncidents = [{ action: 'detected_public', detectedAt: NOW }];
    for (let index = 0; index < 6; index += 1) {
      item.youtubeUpload.privacyIncidents.push({ action: 'auto_private', detectedAt: NOW, result: 'failed' });
      const delay = [300000, 900000, 3600000, 21600000][Math.min(index, 3)];
      assert.equal(remote.retryDue(item, new Date(NOW.getTime() + delay - 1)), false);
      assert.equal(remote.retryDue(item, new Date(NOW.getTime() + delay)), true);
    }
  });
  it('匯入影片與刪除影片不參與自動隱私修改', async () => {
    await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
    const imported = add({ youtubeUpload: null });
    const deleted = add({ deletedAt: NOW });
    const api = fake({ privacy: 'public' });
    assert.equal(await remote.checkItemRemoteState({ kind: 'video', item: imported, fetchImpl: api.fetchImpl, now: NOW }), null);
    assert.equal(await remote.checkItemRemoteState({ kind: 'video', item: deleted, fetchImpl: api.fetchImpl, now: NOW }), null);
    assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 0);
  });
  for (const intervalMs of [0, 1234]) it(`上傳與恢復開關皆關閉仍開機及每日查詢，interval=${intervalMs}`, async () => {
    const originalRecovery = env.youtubeUploadRecoveryEnabled;
    env.youtubeUploadEnabled = false; env.youtubeUploadRecoveryEnabled = false;
    store.runtimeSettings.push({ key: 'youtubeLifecycle.upload', value: false }, { key: 'youtubeLifecycle.recovery', value: false });
    const item = add(); const api = fake({ privacy: 'public' });
    let current = NOW; let tick; let delay; let cleared = null; let unref = 0;
    const timer = { unref: () => { unref += 1; } };
    try {
      await remote.startYouTubeRemoteStateScheduler({ intervalMs, fetchImpl: api.fetchImpl, now: () => current,
        setIntervalImpl: (callback, ms) => { tick = callback; delay = ms; return timer; }, clearIntervalImpl: (handle) => { cleared = handle; } });
      assert.equal(delay, intervalMs || 300000); assert.equal(unref, 1);
      assert.equal(item.youtubeUpload.privacyStatus, 'public');
      assert.equal(item.youtubeUpload.remoteState, 'blocked');
      const initialLists = api.calls.filter((call) => call.url.includes('/videos?')).length;
      assert.equal(initialLists, 1);
      current = new Date(NOW.getTime() + 86400000);
      await tick();
      assert.equal(api.calls.filter((call) => call.url.includes('/videos?')).length, initialLists + 1);
      assert.deepEqual(item.youtubeUpload.lastCheckAt, current);
      assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 0);
      remote.stopYouTubeRemoteStateScheduler();
      assert.equal(cleared, timer);
      await tick();
      assert.equal(api.calls.filter((call) => call.url.includes('/videos?')).length, initialLists + 1);
    } finally { remote.stopYouTubeRemoteStateScheduler(); env.youtubeUploadRecoveryEnabled = originalRecovery; }
  });
});
