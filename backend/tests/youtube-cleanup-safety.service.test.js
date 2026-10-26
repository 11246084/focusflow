const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resetStore, store, newObjectId } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const { cleanupUploadedLocalVideo } = require('../src/services/youtubeUpload.service');
const { cleanupShortAssetLocalFile } = require('../src/services/shortAssetCleanup.service');
const { isLocalVideoSourceAvailable } = require('../src/utils/localVideoSource');

const NOW = new Date('2026-10-26T00:00:00Z');
const GB = 1024 ** 3;
const keys = ['uploadDir', 'youtubeUploadCleanupEnabled', 'youtubeUploadCleanupMinAgeDays', 'youtubeUploadCleanupMaxAgeDays', 'youtubeUploadCleanupMinFreeGb'];
const cleanup = { video: cleanupUploadedLocalVideo, short_asset: cleanupShortAssetLocalFile };
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

describe('YouTube 清理的檔案身份與刪除控制 F1', () => {
  let root; let saved; let originals;
  beforeEach(() => {
    resetStore(); lifecycle.resetYouTubeLifecycleStateForTests();
    saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-cleanup-safety-'));
    Object.assign(env, { uploadDir: root, youtubeUploadCleanupEnabled: true, youtubeUploadCleanupMinAgeDays: 14, youtubeUploadCleanupMaxAgeDays: 180, youtubeUploadCleanupMinFreeGb: 1 });
    store.videos = []; store.shortAssets = [];
    store.runtimeSettings.push({ key: 'youtubeLifecycle.cleanup', value: true });
    originals = { videoFind: Video.find, assetFind: ShortAsset.find, settingsFind: RuntimeSetting.findOne, update: Video.findByIdAndUpdate, unlink: fs.unlinkSync, cleanup: lifecycle.CLEANUP_SOURCES.video.cleanup };
  });
  afterEach(() => {
    Video.find = originals.videoFind; ShortAsset.find = originals.assetFind; RuntimeSetting.findOne = originals.settingsFind;
    Video.findByIdAndUpdate = originals.update; fs.unlinkSync = originals.unlink;
    lifecycle.CLEANUP_SOURCES.video.cleanup = originals.cleanup;
    Object.assign(env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  });
  function add(kind, days = 200, filePath) {
    const item = { _id: newObjectId(), filePath: filePath || path.join(root, `${newObjectId()}.mp4`),
      youtubeVideoId: newObjectId(), status: 'published', generationVersion: 1,
      processing: { status: 'completed' }, youtubeUpload: { status: 'uploaded', uploadedAt: new Date(NOW.getTime() - days * 86400000) } };
    fs.writeFileSync(item.filePath, 'fixture');
    store[kind === 'video' ? 'videos' : 'shortAssets'].push(item);
    return item;
  }

  for (const kind of ['video', 'short_asset']) {
    it(`${kind} 與另一集合未完成來源共用時預告不列且實刪拒絕`, async () => {
      const item = add(kind);
      const other = { _id: newObjectId(), filePath: item.filePath, status: 'draft', processing: { status: 'processing' } };
      store[kind === 'video' ? 'shortAssets' : 'videos'].push(other);
      assert.equal((await lifecycle.buildYouTubeCleanupPreview({ now: NOW, getFreeBytes: async () => 10 * GB })).count, 0);
      assert.equal((await cleanup[kind](item._id)).reason, 'shared_reference');
      assert.ok(fs.existsSync(item.filePath));
    });
    for (const readFailure of [false, true]) {
      it(`${kind} 引用查詢等待中${readFailure ? '設定讀取失敗' : '停用'}後不 unlink`, async () => {
        const item = add(kind); const ready = deferred(); const release = deferred();
        ShortAsset.find = (...args) => {
          const query = originals.assetFind(...args); const lean = query.lean;
          query.lean = function () {
            const snapshot = Promise.resolve(lean.call(this));
            return { then: (resolve, reject) => snapshot.then(async (value) => { ready.resolve(); await release.promise; return value; }).then(resolve, reject) };
          };
          return query;
        };
        const run = cleanup[kind](item._id);
        await ready.promise;
        if (readFailure) RuntimeSetting.findOne = () => { throw new Error('setting unavailable'); };
        else store.runtimeSettings.find((item) => item.key === 'youtubeLifecycle.cleanup').value = false;
        release.resolve();
        assert.equal((await run).reason, 'disabled');
        assert.ok(fs.existsSync(item.filePath));
      });
    }
  }

  it('絕對、相對、正規化路徑與 hard link 皆保護 processing 引用', async () => {
    for (const variant of ['relative', 'normalized', 'hardlink']) {
      store.videos = [];
      const item = add('video');
      let alias = variant === 'relative' ? path.relative(env.projectRoot, item.filePath) : path.join(root, 'unused', '..', path.basename(item.filePath));
      if (variant === 'hardlink') { alias = path.join(root, `${newObjectId()}.mp4`); fs.linkSync(item.filePath, alias); }
      store.videos.push({ _id: newObjectId(), filePath: alias, processing: { status: 'processing' } });
      assert.equal((await cleanup.video(item._id)).reason, 'shared_reference');
      assert.ok(fs.existsSync(item.filePath));
    }
  });

  it('根目錄與根外來源拒絕', async () => {
    const item = add('video');
    const originalPath = item.filePath;
    item.filePath = root;
    assert.equal((await cleanup.video(item._id)).reason, 'unsafe_path');
    env.uploadDir = path.join(root, 'empty-root'); fs.mkdirSync(env.uploadDir);
    item.filePath = originalPath;
    assert.equal((await cleanup.video(item._id)).reason, 'unsafe_path');
    assert.ok(fs.existsSync(originalPath));
  });

  it(`${process.platform === 'win32' ? 'Windows junction' : 'Linux symlink'} 指向外部暫存來源時不刪除`, async () => {
    const outside = path.join(root, 'outside'); const uploads = path.join(root, 'uploads');
    fs.mkdirSync(outside); fs.mkdirSync(uploads); env.uploadDir = uploads;
    const file = path.join(outside, 'source.mp4'); fs.writeFileSync(file, 'external fixture');
    fs.symlinkSync(outside, path.join(uploads, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const item = add('video', 200, path.join(uploads, 'link', 'source.mp4'));
    assert.equal((await cleanup.video(item._id)).reason, 'unsafe_path');
    assert.equal(isLocalVideoSourceAvailable(item.filePath), false);
    assert.ok(fs.existsSync(file));
  });

  it('引用讀取失敗不猜測為無共用', async () => {
    const item = add('video'); ShortAsset.find = () => { throw new Error('DB unavailable'); };
    assert.equal((await cleanup.video(item._id)).reason, 'reference_check_failed');
    assert.ok(fs.existsSync(item.filePath));
    await assert.rejects(lifecycle.buildYouTubeCleanupPreview({ now: NOW }), /DB unavailable/);
  });

  it('空間恢復後停止其餘 low_space；max_age 獨立處理', async () => {
    const oldest = add('video', 30); const next = add('video', 20); const max = add('video', 200);
    const oldestPath = oldest.filePath; const nextPath = next.filePath; const maxPath = max.filePath;
    const result = await lifecycle.runYouTubeCleanup({ now: NOW, getFreeBytes: async () => fs.existsSync(oldestPath) ? 0 : 2 * GB });
    assert.equal(result.cleaned, 2);
    assert.ok(!fs.existsSync(oldestPath)); assert.ok(fs.existsSync(nextPath)); assert.ok(!fs.existsSync(maxPath));
  });

  it('第一次刪除失敗不虛增釋放量且會補選下一支；空間未知不按 low_space 刪除', async () => {
    const first = add('video', 30); const second = add('video', 20);
    const firstPath = first.filePath;
    fs.unlinkSync = (file) => { if (file === firstPath) throw new Error('injected unlink failure'); return originals.unlink(file); };
    const result = await lifecycle.runYouTubeCleanup({ now: NOW, getFreeBytes: async () => 0 });
    assert.equal(result.cleaned, 1); assert.equal(result.freedBytes, 7);
    assert.ok(fs.existsSync(firstPath)); assert.equal(second.filePath, null);
    assert.equal(first.videoSource, 'youtube');
    const unknown = await lifecycle.runYouTubeCleanup({ now: NOW, getFreeBytes: async () => { throw new Error('statfs failed'); } });
    assert.equal(unknown.cleaned, 0); assert.ok(fs.existsSync(firstPath));
  });

  it('unlink 成功但 DB 收尾失敗可於下一輪補寫，釋放量只計算一次', async () => {
    const item = add('video'); const originalPath = item.filePath;
    let fail = true;
    Video.findByIdAndUpdate = (...args) => {
      if (fail && args[1].$set?.filePath === null) { fail = false; throw new Error('injected finalization failure'); }
      return originals.update(...args);
    };
    const first = await lifecycle.runYouTubeCleanup({ now: NOW, getFreeBytes: async () => 10 * GB });
    assert.equal(first.cleaned, 1); assert.equal(first.freedBytes, 7);
    assert.ok(!fs.existsSync(originalPath)); assert.equal(item.filePath, originalPath);
    const retry = await lifecycle.runYouTubeCleanup({ now: NOW, getFreeBytes: async () => 10 * GB });
    assert.equal(retry.cleaned, 0); assert.equal(retry.freedBytes, 0);
    assert.equal(item.filePath, null); assert.ok(item.youtubeUpload.localCleanupAt);
  });
});
