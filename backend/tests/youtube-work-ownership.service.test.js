const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const shortUpload = require('../src/services/shortAssetPublish.service');
const { recoverShortAssetUploads } = require('../src/services/shortAssetRecovery.service');
const { restoreVideoSource, retryExistingVideoProcessing } = require('../src/services/video.service');
const { archiveForCourseDeletion, recordShortAssetRegeneration, reviewShortAsset, rollbackCourseDeletionArchive } = require('../src/services/shortAsset.service');
const quarantine = require('../src/services/youtubeQuarantine.service');
const { useYouTubeTestEnvironment } = require('./helpers/youtubeTestEnvironment');
const { sourceWorkKey } = require('../src/services/youtubeWorkOwnership.service');

const teacher = { id: ids.teacher, role: 'teacher' };
const NOW = new Date('2026-10-26T00:00:00Z');
const MP4 = Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => { const box = Buffer.alloc(8); box.writeUInt32BE(8); box.write(type, 4); return box; }));
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function json(payload, headers = {}) { return { ok: true, status: 200, headers: { get: (key) => headers[key] }, json: async () => payload, text: async () => JSON.stringify(payload) }; }

describe('YouTube 工作所有權 F2', () => {
  let root; let saved; let restoreEnv; let originals;
  const keys = ['uploadDir', 'shortScriptAutomationEnabled', 'youtubeUploadRecoveryEnabled', 'youtubeUploadRecoveryBatchSize',
    'youtubeUploadCleanupEnabled', 'youtubeUploadCleanupMaxAgeDays', 'youtubeUploadCleanupMinAgeDays', 'youtubeUploadCleanupMinFreeGb', 'youtubeUploadRetryBaseMs'];
  beforeEach(() => {
    resetStore(); upload.resetYouTubeUploadState(); lifecycle.resetYouTubeLifecycleStateForTests();
    saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    restoreEnv = useYouTubeTestEnvironment(env, upload.resetYouTubeUploadState);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-work-owner-'));
    Object.assign(env, { uploadDir: root, shortScriptAutomationEnabled: false, youtubeUploadRecoveryEnabled: true,
      youtubeUploadRecoveryBatchSize: 20, youtubeUploadCleanupEnabled: true, youtubeUploadCleanupMaxAgeDays: 180,
      youtubeUploadCleanupMinAgeDays: 14, youtubeUploadCleanupMinFreeGb: 0, youtubeUploadRetryBaseMs: 0 });
    store.videos = []; store.shortAssets = [];
    store.runtimeSettings.push({ key: 'youtubeLifecycle.cleanup', value: true });
    global.fetch = fetchUploads().fetchImpl;
    originals = { settings: RuntimeSetting.findOne, videoCAS: Video.findOneAndUpdate, assetCAS: ShortAsset.findOneAndUpdate };
  });
  afterEach(() => {
    RuntimeSetting.findOne = originals.settings; Video.findOneAndUpdate = originals.videoCAS; ShortAsset.findOneAndUpdate = originals.assetCAS;
    store.beforeVideoCompareAndSwap = null; store.beforeShortAssetCompareAndSwap = null;
    restoreEnv(); Object.assign(env, saved); fs.rmSync(root, { recursive: true, force: true });
  });
  function file(name = `${newObjectId()}.mp4`) { const target = path.join(root, name); fs.writeFileSync(target, MP4); return { path: target, originalname: name }; }
  function add(kind, state = 'retry', title = newObjectId()) {
    const item = { _id: newObjectId(), courseId: ids.teacherCourse, uploadedBy: ids.teacher, sourceType: 'upload', title,
      filePath: file().path, status: kind === 'video' ? undefined : 'draft', generationVersion: kind === 'video' ? undefined : 1,
      processing: { status: 'completed' }, disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true },
      youtubeUpload: { status: 'failed', retrySafe: state === 'retry', attemptCount: 1, failedAt: new Date('2026-10-01'), nextRetryAt: null } };
    if (state === 'uploaded') {
      item.youtubeVideoId = `yt-${item._id}`; item.youtubeUpload = { status: 'uploaded', remoteState: 'ready', readyAt: new Date('2025-01-01'), uploadedAt: new Date('2025-01-01') }; item.videoSource = 'youtube';
      if (kind !== 'video') item.status = 'published';
    }
    store[kind === 'video' ? 'videos' : 'shortAssets'].push(item); return item;
  }
  function fetchUploads({ onPut } = {}) {
    const sessions = []; const puts = [];
    const fetchImpl = async (url, options = {}) => {
      if (url === upload.YOUTUBE_TOKEN_URL) return json({ access_token: 'fake-token', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
      if (url === upload.YOUTUBE_UPLOAD_URL) { const title = JSON.parse(options.body).snippet.title; sessions.push(title); return json({}, { location: `https://upload.test/${title}` }); }
      if (String(url).startsWith(upload.YOUTUBE_VIDEOS_URL)) { const id = new URL(url).searchParams.get('id'); return json({ items: [{ id, snippet: { channelId: 'own-channel' }, status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } }] }); }
      if (String(url).startsWith('https://upload.test/')) {
        const title = String(url).split('/').at(-1); puts.push(title);
        for await (const chunk of options.body) assert.ok(chunk.length);
        await onPut?.(title);
        return json({ id: `yt-${title}`, status: { privacyStatus: 'unlisted' } });
      }
      throw new Error('Unexpected URL in upload mock');
    };
    return { fetchImpl, sessions, puts };
  }
  function ownYouTube({ gate, entered } = {}) {
    return async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) return json({ access_token: 'fake-token', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
      if (String(url).startsWith(quarantine.YOUTUBE_CHANNELS_URL)) return json({ items: [{ id: 'own-channel', contentDetails: { relatedPlaylists: { uploads: 'own-uploads' } } }] });
      if (String(url).startsWith(quarantine.YOUTUBE_VIDEOS_URL)) { entered?.resolve(); if (gate) await gate.promise; return json({ items: [{ id: new URL(url).searchParams.get('id'), snippet: { channelId: 'own-channel' }, status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } }] }); }
      throw new Error('Unexpected URL in quarantine mock');
    };
  }

  it('F2-T1 第一個設定 await 前即佔用清理輪次，停用／錯誤後可再執行', async () => {
    assert.equal(sourceWorkKey('video', ids.teacherVideo), sourceWorkKey('video', ids.teacherVideo.toUpperCase()));
    add('video', 'uploaded'); const entered = deferred(); const gate = deferred(); let first = true;
    RuntimeSetting.findOne = (...args) => {
      const query = originals.settings(...args);
      if (!first) return query; first = false;
      query.lean = () => ({ then: (resolve, reject) => { entered.resolve(); return gate.promise.then(() => query).then(resolve, reject); } });
      return query;
    };
    const run = lifecycle.runYouTubeCleanup({ now: NOW });
    await entered.promise;
    assert.equal((await lifecycle.runYouTubeCleanup({ now: NOW })).reason, 'already_running');
    gate.resolve(); assert.equal((await run).cleaned, 1);
    assert.equal((await lifecycle.runYouTubeCleanup({ now: NOW })).skipped, false);
  });

  it('F2-T1 清理完成、真正補回後，舊候選不能刪掉新來源', async () => {
    const item = add('video', 'uploaded');
    const [candidate] = await lifecycle.listYouTubeCleanupCandidates({ now: NOW });
    assert.equal((await upload.cleanupUploadedLocalVideo(item._id, { candidate })).cleaned, true);
    const restored = file('restored.mp4');
    await restoreVideoSource({ videoId: item._id, file: restored, user: teacher });
    assert.equal((await upload.cleanupUploadedLocalVideo(item._id, { candidate })).reason, 'source_changed');
    assert.ok(fs.existsSync(restored.path)); assert.ok(item.youtubeUpload.localSourceRestoredAt);
    assert.equal((await lifecycle.listYouTubeCleanupCandidates({ now: new Date() })).length, 0);
  });

  for (const field of ['filePath', 'restoredAt', 'processing', 'generation']) {
    it(`F2-T2 候選後 ${field} 改變不刪新來源`, async () => {
      const kind = field === 'generation' ? 'short_asset' : 'video'; const item = add(kind, 'uploaded');
      const [candidate] = await lifecycle.listYouTubeCleanupCandidates({ now: NOW });
      if (field === 'filePath') item.filePath = file('new-path.mp4').path;
      if (field === 'restoredAt') item.youtubeUpload.localSourceRestoredAt = NOW;
      if (field === 'processing') item.processing.status = 'processing';
      if (field === 'generation') item.generationVersion += 1;
      const result = await lifecycle.CLEANUP_SOURCES[kind].cleanup(item._id, { candidate });
      assert.equal(result.cleaned, false); assert.ok(fs.existsSync(item.filePath));
    });
  }

  for (const kind of ['video', 'short_asset']) {
    it(`F2-T3 ${kind} A 等待期間教師把 B 重試為 unsafe，恢復不再傳 B`, { timeout: 15000 }, async () => {
      const a = add(kind, 'retry', 'A'); const b = add(kind, 'retry', 'B');
      const ready = deferred(); const gate = deferred(); const failed = deferred();
      const fake = fetchUploads({ onPut: async (title) => { if (title === 'A') { ready.resolve(); await gate.promise; } else throw new Error('bytes sent then failed'); } });
      const model = kind === 'video' ? Video : ShortAsset; const original = model.findOneAndUpdate;
      model.findOneAndUpdate = async (...args) => { const result = await original(...args); if (String(args[0]._id) === b._id && args[1].$set?.['youtubeUpload.status'] === 'failed') failed.resolve(); return result; };
      env.shortScriptAutomationEnabled = kind === 'short_asset';
      const run = kind === 'video' ? upload.recoverPendingYouTubeUploads({ fetchImpl: fake.fetchImpl }) : recoverShortAssetUploads({ fetchImpl: fake.fetchImpl });
      try {
        await ready.promise;
        if (kind === 'video') { await upload.scheduleYouTubeUploadRetry(b._id, teacher, { fetchImpl: fake.fetchImpl }); await failed.promise; }
        else await assert.rejects(shortUpload.retryShortAssetUpload({ assetId: b._id, user: teacher, fetchImpl: fake.fetchImpl }), /remote outcome is unknown/);
        assert.equal(b.youtubeUpload.retrySafe, false);
      } finally { gate.resolve(); }
      await run;
      assert.deepEqual(fake.puts, ['A', 'B']); assert.equal(b.youtubeUpload.attemptCount, 2); assert.equal(b.youtubeUpload.retrySafe, false);
      assert.ok(a.youtubeVideoId);
    });
  }

  for (const kind of ['video', 'short_asset']) {
    it(`F2-T4 ${kind} unsafe／退避未到／達上限／已上傳均不建立 session`, async () => {
      for (const state of ['unsafe', 'future', 'limit', 'uploaded']) {
        const item = add(kind); if (state === 'unsafe') item.youtubeUpload.retrySafe = false;
        if (state === 'future') item.youtubeUpload.nextRetryAt = new Date(Date.now() + 60000);
        if (state === 'limit') item.youtubeUpload.attemptCount = env.youtubeUploadMaxAttempts;
        if (state === 'uploaded') item.youtubeVideoId = 'already-owned';
        const fake = fetchUploads();
        if (kind === 'video') await upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fake.fetchImpl });
        else await shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl }).catch((error) => assert.ok(error.code));
        assert.equal(fake.sessions.length, 0, state);
      }
    });
  }

  it('F2-T5 短片直接入口／教師雙重試／換代交錯只有一個 PUT', async () => {
    const item = add('short_asset'); const ready = deferred(); const gate = deferred();
    const fake = fetchUploads({ onPut: async () => { ready.resolve(); await gate.promise; } });
    const first = shortUpload.retryShortAssetUpload({ assetId: item._id, user: teacher, fetchImpl: fake.fetchImpl });
    await ready.promise;
    try {
      const others = await Promise.allSettled([
        shortUpload.retryShortAssetUpload({ assetId: item._id, user: teacher, fetchImpl: fake.fetchImpl }),
        shortUpload.uploadShortAssetToYouTube({ assetId: item._id, fetchImpl: fake.fetchImpl }),
        recordShortAssetRegeneration(item._id, { filePath: file('replacement.mp4').path }),
      ]);
      assert.equal(others.filter((result) => result.status === 'rejected').length, 3);
      env.youtubeUploadEnabled = false; // 已開始的工作仍傳完。
    } finally { gate.resolve(); }
    await first; assert.equal(fake.sessions.length, 1); assert.equal(fake.puts.length, 1);
    assert.equal(item.youtubeUpload.status, 'uploaded'); assert.equal(item.generationVersion, 1);
  });

  for (const kind of ['video', 'short_asset']) {
    it(`F2-T5 ${kind} 遲到結果不能覆寫新 attempt 或新來源`, async () => {
      const item = add(kind); const ready = deferred(); const gate = deferred();
      const fake = fetchUploads({ onPut: async () => { ready.resolve(); await gate.promise; } });
      const run = kind === 'video' ? upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fake.fetchImpl }) : shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl });
      await ready.promise;
      item.youtubeUpload.attemptId = 'new-attempt'; item.youtubeUpload.attemptCount = 3;
      item.filePath = file('new-source.mp4').path;
      gate.resolve(); await run;
      assert.equal(item.youtubeVideoId, undefined); assert.equal(item.youtubeUpload.attemptId, 'new-attempt'); assert.equal(item.youtubeUpload.attemptCount, 3);
      assert.ok(fs.existsSync(item.filePath));
    });
  }

  for (const secondKind of ['video', 'short_asset']) {
    it(`F2-T6 Video 與 ${secondKind} 同時套同一 YouTube ID 至多一筆成功`, async () => {
      const a = add('video', 'unsafe'); const b = add(secondKind, 'unsafe');
      const ready = deferred(); const gate = deferred(); const fetchImpl = ownYouTube({ entered: ready, gate });
      const winner = quarantine.applyQuarantinedItem({ kind: 'video', id: a._id, youtubeVideoId: 'sameVideo01', fetchImpl });
      await ready.promise;
      try { await assert.rejects(quarantine.applyQuarantinedItem({ kind: secondKind, id: b._id, youtubeVideoId: 'sameVideo01', fetchImpl }), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' }); }
      finally { gate.resolve(); }
      await winner;
      assert.equal(a.youtubeVideoId, 'sameVideo01'); assert.equal(b.youtubeVideoId, undefined); assert.ok(fs.existsSync(b.filePath));
      await assert.rejects(quarantine.applyQuarantinedItem({ kind: secondKind, id: b._id, youtubeVideoId: 'sameVideo01', fetchImpl }), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' });
    });
  }

  it('F2-T7 外部驗證及 DB 套用失敗均釋放鎖，不清理輸家來源', async () => {
    const item = add('video', 'unsafe');
    await assert.rejects(quarantine.applyQuarantinedItem({ kind: 'video', id: item._id, youtubeVideoId: 'sameVideo01', fetchImpl: async () => { throw new Error('verification unavailable'); } }));
    let fail = true;
    Video.findOneAndUpdate = (...args) => { if (fail && args[1].$set?.youtubeVideoId) { fail = false; throw new Error('state write failed'); } return originals.videoCAS(...args); };
    await assert.rejects(quarantine.applyQuarantinedItem({ kind: 'video', id: item._id, youtubeVideoId: 'sameVideo01', fetchImpl: ownYouTube() }), /state write failed/);
    assert.ok(fs.existsSync(item.filePath));
    await quarantine.applyQuarantinedItem({ kind: 'video', id: item._id, youtubeVideoId: 'sameVideo01', fetchImpl: ownYouTube() });
    assert.equal(item.youtubeVideoId, 'sameVideo01');
  });

  it('F2-T2 既有 failed 重處理佔用後，舊清理候選不能讀刪來源', async () => {
    const item = add('video', 'uploaded'); const [candidate] = await lifecycle.listYouTubeCleanupCandidates({ now: NOW });
    item.processing.status = 'failed';
    await retryExistingVideoProcessing(item._id, teacher);
    assert.equal(item.processing.status, 'queued');
    assert.equal((await upload.cleanupUploadedLocalVideo(item._id, { candidate })).cleaned, false);
    assert.ok(fs.existsSync(item.filePath));
  });

  for (const kind of ['video', 'short_asset']) {
    it(`F2-T7 ${kind} DB 無法確認佔用時不送 bytes，失敗後鎖可重用`, async () => {
      const item = add(kind); const fake = fetchUploads();
      const model = kind === 'video' ? Video : ShortAsset; const original = model.findOneAndUpdate;
      model.findOneAndUpdate = () => { throw new Error('claim unavailable'); };
      const run = () => kind === 'video' ? upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fake.fetchImpl }) : shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl });
      try { await run().catch((error) => assert.match(error.message, /claim unavailable/)); }
      finally { model.findOneAndUpdate = original; }
      assert.equal(fake.sessions.length, 0); assert.equal(fake.puts.length, 0);
      await run(); assert.equal(fake.puts.length, 1);
    });
    it(`F2-T7 ${kind} bytes 傳完但 DB 回寫失敗，後續不能再傳一次`, async () => {
      const item = add(kind); const fake = fetchUploads();
      const model = kind === 'video' ? Video : ShortAsset; const original = model.findOneAndUpdate; let fail = true;
      model.findOneAndUpdate = (...args) => { if (fail && args[1].$set?.youtubeVideoId) { fail = false; throw new Error('finalization failed'); } return original(...args); };
      const run = () => kind === 'video' ? upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fake.fetchImpl }) : shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl });
      try { await run().catch((error) => assert.match(error.message, /finalization failed/)); }
      finally { model.findOneAndUpdate = original; }
      assert.equal(item.youtubeUpload.retrySafe, false); assert.equal(item.youtubeUpload.status, 'failed');
      await run(); assert.equal(fake.puts.length, 1);
    });
  }

  it('F2-T7 清理佔用 DB 失敗不 unlink，重試不留下永久鎖', async () => {
    const item = add('video', 'uploaded'); const source = item.filePath;
    Video.findOneAndUpdate = () => { throw new Error('claim unavailable'); };
    await assert.rejects(upload.cleanupUploadedLocalVideo(item._id), /claim unavailable/);
    assert.ok(fs.existsSync(source)); Video.findOneAndUpdate = originals.videoCAS;
    assert.equal((await upload.cleanupUploadedLocalVideo(item._id)).cleaned, true);
  });

  it('F2-T2 引用在第一輪查詢後加入仍由刪檔前查詢保護', async () => {
    const item = add('video', 'uploaded'); const source = item.filePath; let inserted = false;
    store.beforeVideoCompareAndSwap = async (_query, update) => {
      if (!inserted && update.$set?.['youtubeUpload.localSourceVersion']) {
        inserted = true;
        store.shortAssets.push({ _id: newObjectId(), filePath: source, status: 'draft' });
      }
    };
    assert.equal((await upload.cleanupUploadedLocalVideo(item._id)).cleaned, false);
    assert.ok(fs.existsSync(source));
  });

  it('F2-T6 舊資料已重複佔用同一備份時不清理任一原片', async () => {
    const a = add('video', 'uploaded'); const b = add('short_asset', 'uploaded');
    b.youtubeVideoId = a.youtubeVideoId;
    assert.equal((await lifecycle.buildYouTubeCleanupPreview({ now: NOW })).count, 0);
    assert.equal((await upload.cleanupUploadedLocalVideo(a._id)).reason, 'backup_in_use');
    assert.ok(fs.existsSync(a.filePath)); assert.ok(fs.existsSync(b.filePath));
  });

  it('F2-T7 短片 unlink 成功但 DB 收尾失敗有診斷，補寫不重複計數', async () => {
    const item = add('short_asset', 'uploaded'); let fail = true;
    ShortAsset.findOneAndUpdate = (...args) => {
      if (fail && args[1].$set?.['youtubeUpload.localCleanupAt']) { fail = false; throw new Error('finalization unavailable'); }
      return originals.assetCAS(...args);
    };
    const run = await lifecycle.runYouTubeCleanup({ now: NOW });
    assert.equal(run.cleaned, 1); assert.equal(run.results[0].skipReason, 'state_write_failed');
    assert.match(lifecycle.getYouTubeCleanupSchedulerState().lastError, /finalization must be retried/);
    assert.ok(!fs.existsSync(item.filePath));
    const retry = await lifecycle.runYouTubeCleanup({ now: NOW });
    assert.equal(retry.cleaned, 0); assert.equal(retry.freedBytes, 0); assert.ok(item.youtubeUpload.localCleanupAt);
  });

  it('F2-T2 短片最後讀開關期間，審核與封存回復不能將來源改成草稿', async () => {
    const item = add('short_asset', 'uploaded'); item.status = 'archived'; item.reviewStatus = 'pending';
    const ready = deferred(); const gate = deferred(); let reads = 0;
    RuntimeSetting.findOne = (...args) => {
      const query = originals.settings(...args);
      if (++reads !== 2) return query;
      const lean = query.lean;
      query.lean = function () {
        const snapshot = Promise.resolve(lean.call(this));
        return { then: (resolve, reject) => snapshot.then(async (value) => { ready.resolve(); await gate.promise; return value; }).then(resolve, reject) };
      };
      return query;
    };
    const run = lifecycle.CLEANUP_SOURCES.short_asset.cleanup(item._id);
    await ready.promise;
    try {
      await assert.rejects(reviewShortAsset({ assetId: item._id, user: teacher, status: 'rejected', expectedGenerationVersion: 1, reasons: [] }), { code: 'SHORT_ASSET_REVIEW_CONFLICT' });
      await assert.rejects(rollbackCourseDeletionArchive([{ assetId: item._id, status: 'draft', archivedAt: new Date() }]), { code: 'SHORT_ASSET_REVIEW_CONFLICT' });
      assert.equal(item.status, 'archived'); assert.ok(fs.existsSync(item.filePath));
    } finally { gate.resolve(); }
    assert.equal((await run).cleaned, true);
  });

  it('F2-T5 上傳 bytes 期間仍可核准審核，完成後上架', async () => {
    const item = add('short_asset'); item.reviewStatus = 'pending';
    const ready = deferred(); const gate = deferred();
    const fake = fetchUploads({ onPut: async () => { ready.resolve(); await gate.promise; } });
    const run = shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl });
    await ready.promise;
    try { await reviewShortAsset({ assetId: item._id, user: teacher, status: 'approved', expectedGenerationVersion: 1, reasons: [] }); }
    finally { gate.resolve(); }
    await run; assert.equal(item.status, 'published'); assert.equal(fake.puts.length, 1);
  });

  it('F2-T5 上傳期間課程封存，遲到完成不得重新上架', async () => {
    const item = add('short_asset'); item.reviewStatus = 'approved'; item.reviewedGenerationVersion = 1;
    const ready = deferred(); const gate = deferred();
    const fake = fetchUploads({ onPut: async () => { ready.resolve(); await gate.promise; } });
    const run = shortUpload.runTrackedShortAssetUpload({ assetId: item._id, fetchImpl: fake.fetchImpl });
    await ready.promise;
    try { await archiveForCourseDeletion(store.courses.find((course) => course._id === ids.teacherCourse)); }
    finally { gate.resolve(); }
    await run; assert.equal(item.status, 'archived'); assert.equal(item.youtubeUpload.status, 'uploaded');
  });
});
