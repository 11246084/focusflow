// Explicit invocation only. No memory harness, app/server or .env-derived URI.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const { after, before, beforeEach, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { assertLoopbackMongoUri, openIsolatedYouTubeMongo, withIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const uri = assertLoopbackMongoUri(process.env.YOUTUBE_TEST_MONGODB_URI);
// Set every credential input before loading env; none is read from a real .env.
for (const key of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'YOUTUBE_OAUTH_REFRESH_TOKEN', 'YOUTUBE_UPLOAD_ACCESS_TOKEN']) process.env[key] = '';
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const shortUpload = require('../src/services/shortAssetPublish.service');
const quarantine = require('../src/services/youtubeQuarantine.service');
const { restoreVideoSource } = require('../src/services/video.service');
const { claimCleanupSource, inspectCleanupSource } = require('../src/services/localSourceCleanup.service');
const { uploadClaimQuery, randomWorkId } = require('../src/services/youtubeWorkOwnership.service');

let isolated; let root; let saved; let savedFetch;
const courseId = new mongoose.Types.ObjectId();
function response(payload, headers = {}) { return { ok: true, status: 200, headers: { get: (key) => headers[key] }, json: async () => payload }; }
function file() { const target = path.join(root, `${new mongoose.Types.ObjectId()}.mp4`); fs.writeFileSync(target, 'isolated fixture'); return target; }
async function insert(kind, overrides = {}) {
  const item = { _id: new mongoose.Types.ObjectId(), courseId, sourceType: 'upload', uploadedBy: new mongoose.Types.ObjectId(), title: 'Isolated fixture', filePath: file(),
    processing: { status: 'completed' }, status: kind === 'video' ? undefined : 'draft', generationVersion: kind === 'video' ? undefined : 1,
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true }, youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: null }, ...overrides };
  // Native insert preserves genuinely absent legacy fields; no hydration defaults.
  if (kind === 'video') { delete item.status; delete item.generationVersion; }
  await mongoose.connection.db.collection('users').insertOne({ _id: item.uploadedBy, name: 'Isolated teacher', email: `${item.uploadedBy}@example.invalid`, role: 'teacher', isActive: true });
  // Mongoose 使用的 driver 與頂層 mongodb 可有不同 BSON major；不混用其 ObjectId。
  await mongoose.connection.db.collection(kind === 'video' ? 'videos' : 'shortassets').insertOne(item);
  return item;
}
function fakeYouTube(counters = {}) {
  return async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com/token')) return response({ access_token: 'isolated-fake', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
    if (String(url).startsWith(quarantine.YOUTUBE_CHANNELS_URL)) return response({ items: [{ id: 'own-channel', contentDetails: { relatedPlaylists: { uploads: 'own-uploads' } } }] });
    if (String(url).startsWith(quarantine.YOUTUBE_VIDEOS_URL)) return response({ items: [{ snippet: { channelId: 'own-channel' }, status: { privacyStatus: 'unlisted' } }] });
    if (url === upload.YOUTUBE_UPLOAD_URL) { counters.sessions = (counters.sessions || 0) + 1; return response({}, { location: 'https://isolated-upload.test/session' }); }
    if (url === 'https://isolated-upload.test/session') { counters.puts = (counters.puts || 0) + 1; for await (const chunk of options.body) assert.ok(chunk.length); return response({ id: `isolated${counters.puts}` }); }
    throw new Error('Unexpected network URL in isolated Mongo test');
  };
}
before(async () => {
  saved = { ...env }; savedFetch = global.fetch;
  global.fetch = async () => { throw new Error('No external network allowed.'); };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-youtube-mongo-'));
  Object.assign(env, { uploadDir: root, youtubeUploadEnabled: true, youtubeClientId: 'fake', youtubeClientSecret: 'fake', youtubeRefreshToken: 'fake',
    youtubeOAuthClientId: '', youtubeOAuthClientSecret: '', youtubeOAuthRefreshToken: '', youtubeUploadAccessToken: '',
    youtubeUploadMaxAttempts: 3, youtubeUploadRetryBaseMs: 0, youtubeUploadRecoveryEnabled: true,
    youtubeUploadCleanupEnabled: true, youtubeUploadCleanupMaxAgeDays: 180, youtubeUploadCleanupMinFreeGb: 0 });
  isolated = await openIsolatedYouTubeMongo(uri);
  await mongoose.connect(uri, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false });
  for (const name of ['videos', 'shortassets', 'runtimesettings', 'users', 'courses', 'notifications']) await isolated.db.createCollection(name);
  await mongoose.connection.db.collection('courses').insertOne({ _id: courseId, title: 'Isolated course', teacherId: new mongoose.Types.ObjectId(), status: 'draft', videoIds: [] });
  // Only the existing ShortAsset index is explicitly created in this random DB.
  await isolated.db.collection('shortassets').createIndex({ youtubeVideoId: 1 }, { unique: true, sparse: true });
});
beforeEach(async () => {
  upload.resetYouTubeUploadState(); lifecycle.resetYouTubeLifecycleStateForTests();
  for (const name of ['videos', 'shortassets', 'runtimesettings', 'notifications']) await isolated.db.collection(name).deleteMany({});
  await RuntimeSetting.create({ key: 'youtubeLifecycle.cleanup', value: true });
});
after(async () => {
  try { await mongoose.disconnect(); } finally {
    try { await isolated?.close(); } finally {
      if (root) fs.rmSync(root, { recursive: true, force: true });
      if (saved) Object.assign(env, saved);
      global.fetch = savedFetch;
    }
  }
});

it('URI 守門拒絕 Atlas、外部主機、既有 DB、缺 port 與認證參數', () => {
  for (const invalid of ['mongodb+srv://cluster.example', 'mongodb://192.168.1.1:27017', 'mongodb://127.0.0.1:27126/existing', 'mongodb://localhost', 'mongodb://user:pass@localhost:27126', 'mongodb://localhost:27126/?x=1']) assert.throws(() => assertLoopbackMongoUri(invalid));
});
it('並行隨機 DB 不共用；成功與失敗 finally 均移除資料庫', async () => {
  const names = [];
  await Promise.all([withIsolatedYouTubeMongo(uri, async ({ databaseName }) => { names.push(databaseName); }),
    assert.rejects(withIsolatedYouTubeMongo(uri, async ({ databaseName }) => { names.push(databaseName); throw new Error('injected failure'); }), /injected failure/)]);
  assert.notEqual(names[0], names[1]);
  const client = new MongoClient(uri);
  try { await client.connect(); const result = await client.db('admin').admin().listDatabases({ nameOnly: true }); assert.ok(names.every((name) => !result.databases.some((db) => db.name === name))); }
  finally { await client.close(); }
});
it('F2-T1 真實 Mongo 下同時清理只有一輪取得所有權', async () => {
  const item = await insert('video', { youtubeVideoId: 'existingBackup', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const results = await Promise.all([lifecycle.runYouTubeCleanup(), lifecycle.runYouTubeCleanup()]);
  assert.equal(results.filter((result) => !result.skipped).length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.cleaned, 0), 1);
  assert.equal((await Video.findById(item._id).lean()).filePath, null);
});
it('F2-T1 來源 CAS 對同一快照至多一個 claim，舊候選無法取得新版本', async () => {
  const item = await insert('video', { youtubeVideoId: 'existingBackup', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const snapshot = await Video.findById(item._id).lean(); const source = await inspectCleanupSource('video', snapshot);
  const claims = await Promise.all([claimCleanupSource('video', snapshot, source, {}), claimCleanupSource('video', snapshot, source, {})]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimCleanupSource('video', snapshot, source, {}), null);
});
it('F2-T1 真實 Mongo：清理後補回，再執行舊候選仍保留新檔與新保留期', async () => {
  const item = await insert('video', { youtubeVideoId: 'existingBackup', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const [candidate] = await lifecycle.listYouTubeCleanupCandidates();
  assert.equal((await upload.cleanupUploadedLocalVideo(String(item._id), { candidate })).cleaned, true);
  const replacement = file();
  fs.writeFileSync(replacement, Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => { const box = Buffer.alloc(8); box.writeUInt32BE(8); box.write(type, 4); return box; })));
  const restored = await restoreVideoSource({ videoId: String(item._id), file: { path: replacement, originalname: 'restored.mp4' }, user: { id: String(item.uploadedBy), role: 'admin' } });
  assert.equal((await upload.cleanupUploadedLocalVideo(String(item._id), { candidate })).reason, 'source_changed');
  assert.ok(fs.existsSync(replacement));
  assert.ok((await Video.findById(item._id).lean()).youtubeUpload.localSourceRestoredAt);
  assert.equal(restored.youtubeUpload.localSourceVersion, undefined);
  assert.equal(restored.youtubeUpload.attemptId, undefined);
  assert.equal((await lifecycle.listYouTubeCleanupCandidates()).length, 0);
});
it('F2-T5 真實 Mongo 12 次同版本短片條件佔用僅一筆成功，過期 attempt 不能回寫', async () => {
  const item = await insert('short_asset'); const snapshot = await ShortAsset.findById(item._id).lean();
  const tokens = Array.from({ length: 12 }, randomWorkId);
  const claims = await Promise.all(tokens.map((token) => ShortAsset.findOneAndUpdate(uploadClaimQuery(snapshot, { shortAsset: true }), { $set: { 'youtubeUpload.status': 'uploading', 'youtubeUpload.attemptId': token } }, { new: true })));
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims.find(Boolean).youtubeUpload.attemptId;
  const loser = tokens.find((token) => token !== winner);
  const stale = await ShortAsset.findOneAndUpdate({ _id: item._id, 'youtubeUpload.attemptId': loser }, { $set: { youtubeVideoId: 'stale' } });
  assert.equal(stale, null);
});
it('F2-T5 真實短片上傳入口同時執行只建立一個 session／PUT', async () => {
  const item = await insert('short_asset'); const counters = {}; const fetchImpl = fakeYouTube(counters);
  const results = await Promise.allSettled([shortUpload.runTrackedShortAssetUpload({ assetId: String(item._id).toUpperCase(), fetchImpl }), shortUpload.uploadShortAssetToYouTube({ assetId: String(item._id), fetchImpl })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled' && result.value).length, 1);
  assert.deepEqual(counters, { sessions: 1, puts: 1 });
});
for (const kind of ['video', 'short_asset']) {
  it(`F2 初次佔用 ${kind} 的 null 與缺欄位狀態都能原子建立，不能依賴 harness 建子欄位`, async () => {
    const counters = {}; const fetchImpl = fakeYouTube(counters);
    for (const empty of ['null', 'missing']) {
      const item = await insert(kind, { youtubeUpload: null });
      const model = kind === 'video' ? Video : ShortAsset;
      if (empty === 'missing') await model.collection.updateOne({ _id: item._id }, { $unset: { youtubeUpload: '' } });
      if (kind === 'video') await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl, allowRetry: false });
      else await shortUpload.runTrackedShortAssetUpload({ assetId: String(item._id), fetchImpl });
      const completed = await model.findById(item._id).lean();
      assert.equal(completed.youtubeUpload.status, 'uploaded', empty);
      assert.equal(completed.youtubeUpload.attemptCount, 1, empty);
      assert.ok(completed.youtubeUpload.attemptId);
    }
    assert.deepEqual(counters, { sessions: 2, puts: 2 });
  });
}
it('略過上傳的舊短片 null 狀態也能記錄，之後只重試一次', async () => {
  const item = await insert('short_asset', { youtubeUpload: null });
  const previous = env.shortScriptAutomationEnabled;
  env.shortScriptAutomationEnabled = false;
  try { await shortUpload.scheduleUploadOnCreate(await ShortAsset.findById(item._id).lean()); }
  finally { env.shortScriptAutomationEnabled = previous; }
  const skipped = await ShortAsset.findById(item._id).lean();
  assert.equal(skipped.youtubeUpload.retrySafe, true); assert.equal(skipped.youtubeUpload.attemptCount, 0);
  const counters = {};
  await shortUpload.runTrackedShortAssetUpload({ assetId: String(item._id), fetchImpl: fakeYouTube(counters) });
  assert.deepEqual(counters, { sessions: 1, puts: 1 });
});
for (const secondKind of ['video', 'short_asset']) {
  it(`F2-T6 單行程互斥搭配真實 Mongo：Video 與 ${secondKind} 同 ID 套用僅一筆成功`, async () => {
    const a = await insert('video', { youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1 } });
    const b = await insert(secondKind, { youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1 } });
    const results = await Promise.allSettled([
      quarantine.applyQuarantinedItem({ kind: 'video', id: String(a._id), youtubeVideoId: 'sameVideo01', fetchImpl: fakeYouTube() }),
      quarantine.applyQuarantinedItem({ kind: secondKind, id: String(b._id), youtubeVideoId: 'sameVideo01', fetchImpl: fakeYouTube() }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await Video.countDocuments({ youtubeVideoId: 'sameVideo01' }) + await ShortAsset.countDocuments({ youtubeVideoId: 'sameVideo01' }), 1);
    assert.ok(fs.existsSync(b.filePath));
  });
}
it('F2-T7 上傳後 DB 回寫失敗會隔離；重新讀取後不再傳送 bytes', async () => {
  const item = await insert('video'); const counters = {}; const fetchImpl = fakeYouTube(counters); const original = Video.findOneAndUpdate;
  let fail = true;
  Video.findOneAndUpdate = function (query, update, options) {
    if (fail && update.$set?.youtubeVideoId) { fail = false; throw new Error('injected finalization failure'); }
    return original.call(this, query, update, options);
  };
  try { await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl }); }
  finally { Video.findOneAndUpdate = original; }
  const failed = await Video.findById(item._id).lean();
  assert.equal(failed.youtubeUpload.retrySafe, false); assert.equal(failed.youtubeUpload.status, 'failed');
  await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl });
  assert.deepEqual(counters, { sessions: 1, puts: 1 });
});
it('F2-T7 重啟前遺留的 attempt token 不能當作可重傳憑據，兩種來源均隔離', async () => {
  const metadata = { status: 'uploading', retrySafe: false, attemptCount: 1, attemptId: 'before-restart', lastAttemptAt: new Date('2025-01-01') };
  const video = await insert('video', { youtubeUpload: metadata });
  const short = await insert('short_asset', { youtubeUpload: metadata });
  const previous = env.shortScriptAutomationEnabled; env.shortScriptAutomationEnabled = true;
  const counters = {};
  try { const result = await upload.recoverPendingYouTubeUploads({ fetchImpl: fakeYouTube(counters) }); assert.equal(result.quarantined, 2); }
  finally { env.shortScriptAutomationEnabled = previous; }
  for (const [model, item] of [[Video, video], [ShortAsset, short]]) {
    const failed = await model.findById(item._id).lean();
    assert.equal(failed.youtubeUpload.status, 'failed'); assert.equal(failed.youtubeUpload.retrySafe, false);
    assert.equal(failed.youtubeUpload.attemptId, 'before-restart');
  }
  assert.deepEqual(counters, {});
});
