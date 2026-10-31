const { env, deferred } = require('./helpers/youtubeReviewFixture');
const assert = require('node:assert/strict');
const { before, beforeEach, after, it } = require('node:test');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const Video = require('../src/models/video.model');
const Setting = require('../src/models/runtimeSetting.model');
const remote = require('../src/services/youtubeRemoteState.service');
const upload = require('../src/services/youtubeUpload.service');
const settings = require('../src/services/youtubeLifecycleSettings.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const uri = process.env.YOUTUBE_TEST_MONGODB_URI;
const NOW = new Date('2026-10-29T04:00:00Z');
let isolated; let db; let root;
const collections = ['videos', 'shortassets', 'runtimesettings', 'users', 'notifications', 'youtubebackups'];
const adminId = new mongoose.Types.ObjectId();

async function add(fields = {}) {
  const _id = new mongoose.Types.ObjectId();
  const filePath = path.join(root, `${_id}.mp4`); fs.writeFileSync(filePath, 'owned QB fixture');
  const item = { _id, title: 'QB fixture', filePath, deletedAt: null, videoSource: 'upload',
    youtubeVideoId: String(_id).slice(0, 11), processing: { status: 'completed' },
    youtubeUpload: { status: 'uploaded', uploadedAt: NOW, remoteState: 'processing' }, ...fields };
  await db.collection('videos').insertOne(item); return item;
}

function fake({ privacy = 'unlisted', readback = true, waitPut, failed = false, onRead } = {}) {
  const calls = []; let actual = privacy;
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).includes('oauth2.googleapis.com')) return response({ access_token: 'fake-token' });
    if (String(url).includes('/channels')) return response({ items: [{ id: 'own' }] });
    if (options.method === 'PUT') {
      await waitPut?.(); if (readback) actual = JSON.parse(options.body).status.privacyStatus;
      return response({});
    }
    if (failed) throw new Error('Injected query failure');
    await onRead?.();
    return response({ items: new URL(url).searchParams.get('id').split(',').map((id) => ({ id,
      snippet: { channelId: 'own' }, status: { privacyStatus: actual, uploadStatus: 'processed', embeddable: true } })) });
  };
  return { fetchImpl, calls };
}

before(async () => {
  isolated = await openIsolatedYouTubeMongo(uri);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-qb-mongo-owned-'));
  Object.assign(env, { uploadDir: root, youtubePrivacyGuardEnabled: true, youtubeUploadAccessToken: 'fake-token' });
  await mongoose.connect(uri, { dbName: isolated.databaseName, directConnection: true, autoIndex: false, autoCreate: false });
  db = mongoose.connection.db;
  for (const name of collections) await db.createCollection(name);
  await Setting.collection.createIndex({ key: 1 }, { unique: true });
  await db.collection('notifications').createIndex({ recipientId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
});
beforeEach(async () => {
  for (const name of collections) await db.collection(name).deleteMany({});
  await db.collection('users').insertOne({ _id: adminId, role: 'admin', isActive: true });
  upload.resetYouTubeUploadState();
});
after(async () => {
  await mongoose.disconnect(); await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-qb-mongo-owned-')) fs.rmSync(root, { recursive: true, force: true });
});

it('QB-M1 legacy missing fields preserve CAS and record actual private readback', async () => {
  await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
  const item = await add();
  await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: fake({ privacy: 'public' }).fetchImpl, now: NOW });
  const saved = await Video.findById(item._id).lean();
  assert.equal(saved.youtubeUpload.privacyStatus, 'private');
  assert.equal(saved.youtubeUpload.remoteState, 'blocked');
  assert.equal(saved.youtubeUpload.privacyIncidents.at(-1).result, 'confirmed');
  assert.equal(saved.youtubeUpload.attemptId, undefined);
});

it('QB-M2 query failure neither authorizes cleanup nor changes ready, bad readback retains source', async () => {
  await db.collection('runtimesettings').insertOne({ key: 'youtubeLifecycle.cleanup', value: true });
  const item = await add({ videoSource: 'youtube', youtubeUpload: { status: 'uploaded', remoteState: 'ready', readyAt: new Date('2025-01-01'), uploadedAt: new Date('2025-01-01') } });
  const failed = await upload.cleanupUploadedLocalVideo(item._id, { fetchImpl: fake({ failed: true }).fetchImpl });
  assert.equal(failed.reason, 'remote_check_failed'); assert.ok(fs.existsSync(item.filePath));
  assert.equal((await Video.findById(item._id).lean()).youtubeUpload.remoteState, 'ready');
  const blocked = await upload.cleanupUploadedLocalVideo(item._id, { fetchImpl: fake({ privacy: 'private' }).fetchImpl });
  assert.equal(blocked.reason, 'remote_not_ready'); assert.ok(fs.existsSync(item.filePath));
  assert.equal((await Video.findById(item._id).lean()).videoSource, 'upload');
});

it('QB-M3 retention starts at the later readyAt and restoredAt, preview and scheduler agree', async () => {
  const item = await add({ videoSource: 'youtube', youtubeUpload: { status: 'uploaded', remoteState: 'ready',
    uploadedAt: new Date('2025-01-01'), readyAt: new Date(NOW.getTime() - 86400000), localSourceRestoredAt: NOW } });
  assert.equal(lifecycle.resolveRetentionStartTime(item.youtubeUpload), NOW.getTime());
  const preview = await lifecycle.buildYouTubeCleanupPreview({ now: NOW, getFreeBytes: async () => 0 });
  assert.equal(preview.count, 0);
});

it('QB-M4 four backend processes share the rolling 10 writes limit', async () => {
  await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
  const items = [];
  for (let index = 0; index < 16; index += 1) items.push(await add({ youtubeVideoId: `qbMulti${String(index).padStart(4, '0')}` }));
  let writes = 0;
  const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'helpers/youtubePrivacyWorker.js'), [uri, isolated.databaseName, JSON.stringify(items.slice(index * 4, index * 4 + 4).map((item) => String(item._id)))], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('message', (message) => { if (message.type === 'privacy_update') writes += 1; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(code) : reject(new Error(stderr || `Worker exit ${code}`)));
  })));
  assert.equal(outcomes.length, 4); assert.equal(writes, 10);
  const document = await Setting.findOne({ key: 'privacy_guard' }).lean();
  assert.equal(document.value.guard.updates.length, 10); assert.equal(document.history.length, 1);
});

it('QB-M5 admin toggles while update waits preserve global owner/count and audit', async () => {
  await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: true });
  const item = await add(); const entered = deferred(); const release = deferred();
  const api = fake({ privacy: 'public', waitPut: async () => { entered.resolve(); await release.promise; } });
  const work = remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: api.fetchImpl, now: NOW });
  await entered.promise;
  const before = await Setting.findOne({ key: 'privacy_guard' }).lean();
  await settings.setYouTubeLifecycleSwitch({ key: 'privacy_guard', enabled: false });
  const after = await Setting.findOne({ key: 'privacy_guard' }).lean();
  assert.equal(after.value.guard.ownerToken, before.value.guard.ownerToken);
  assert.equal(after.value.guard.updates.length, 1); assert.equal(after.history.length, 2);
  release.resolve(); await work;
  assert.equal((await Setting.findOne({ key: 'privacy_guard' }).lean()).value.enabled, false);
});

it('QB-M6 stale remote response cannot change replacement source or privacy', async () => {
  const item = await add();
  await Video.collection.updateOne({ _id: item._id }, { $set: { youtubeVideoId: 'replacement', 'youtubeUpload.attemptId': 'new' } });
  const result = await remote.applyRemoteObservation({ kind: 'video', item, remote: { status: { privacyStatus: 'unlisted', uploadStatus: 'processed' } }, now: NOW });
  assert.equal(result, null);
  assert.equal((await Video.findById(item._id).lean()).videoSource, 'upload');
});

it('QB-M7 manual restore with public readback records actor and refuses ready', async () => {
  const item = await add();
  await assert.rejects(remote.restoreUnlisted({ kind: 'video', id: item._id, actor: String(adminId), fetchImpl: fake({ privacy: 'public', readback: false }).fetchImpl, now: NOW }), (error) => error.code === 'YOUTUBE_PRIVACY_NOT_CONFIRMED');
  const saved = await Video.findById(item._id).lean();
  assert.equal(saved.youtubeUpload.privacyIncidents.at(-1).actor, String(adminId));
  assert.equal(saved.youtubeUpload.privacyIncidents.at(-1).result, 'readback:public');
  assert.equal(saved.videoSource, 'upload');
});
