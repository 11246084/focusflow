const { env } = require('./helpers/youtubeReviewFixture');
const { before, after, beforeEach, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const mongoose = require('mongoose');
const { openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const Video = require('../src/models/video.model');
const Setting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const gate = require('../src/services/youtubeUploadGate.service');
const remote = require('../src/services/youtubeRemoteState.service');
const playback = require('../src/services/localPlayback.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const admin = require('../src/services/youtubeUploadAdmin.service');
let isolated; let db; let root; let failQuota; let counters; let statuses;
const teacher = new mongoose.Types.ObjectId(); const course = new mongoose.Types.ObjectId();
const tables = ['videos', 'shortassets', 'runtimesettings', 'youtubebackups', 'notifications', 'users', 'courses'];
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (key) => headers[key.toLowerCase()] || null }, json: async () => body, text: async () => JSON.stringify(body) });
async function fake(url, options = {}) {
  const target = String(url);
  if (target.includes('oauth2.googleapis.com/token')) return response({ access_token: 'qf-fake' });
  if (target.includes('/channels?')) return response({ items: [{ id: 'qf-own-channel' }] });
  if (target.includes('uploadType=resumable')) {
    counters.sessions++;
    if (failQuota) { failQuota = false; return response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403); }
    return response({}, 200, { location: 'https://qf.invalid/session' });
  }
  if (target === 'https://qf.invalid/session') {
    counters.puts++; for await (const bytes of options.body) assert.ok(bytes.length);
    statuses.set('qfUploaded1', { privacyStatus: 'unlisted', uploadStatus: 'uploaded', embeddable: true });
    return response({ id: 'qfUploaded1', status: statuses.get('qfUploaded1') }, 201);
  }
  if (target.includes('/videos?')) {
    if (options.method === 'PUT') {
      counters.privacyUpdates++; const body = JSON.parse(options.body); statuses.set(body.id, { ...statuses.get(body.id), ...body.status });
      return response({ id: body.id, status: statuses.get(body.id) });
    }
    const ids = new URL(target).searchParams.get('id').split(',');
    return response({ items: ids.filter(id => statuses.has(id)).map(id => ({ id, snippet: { channelId: 'qf-own-channel' }, status: statuses.get(id) })) });
  }
  throw new Error('Unexpected Q-F fake request.');
}
async function add(extra = {}) {
  const _id = new mongoose.Types.ObjectId(); const filePath = path.join(root, `${_id}.mp4`);
  fs.writeFileSync(filePath, 'owned Q-F source');
  const item = { _id, courseId: course, uploadedBy: teacher, title: 'Q-F fixture', deletedAt: null,
    filePath, sourceType: 'upload', videoSource: 'upload', sourceUrl: '/uploads/original.mp4', videoUrl: '/uploads/original.mp4',
    processing: { status: 'completed' }, localPlayback: { compatible: true }, youtubeUpload: null, ...extra };
  await db.collection('videos').insertOne(item); return item;
}
before(async () => {
  isolated = await openIsolatedYouTubeMongo(process.env.YOUTUBE_TEST_MONGODB_URI);
  await mongoose.connect(process.env.YOUTUBE_TEST_MONGODB_URI, { dbName: isolated.databaseName, directConnection: true, autoIndex: false, autoCreate: false });
  db = mongoose.connection.db; for (const name of tables) await db.createCollection(name);
  await Setting.collection.createIndex({ key: 1 }, { unique: true });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-qf-local-'));
  Object.assign(env, { uploadDir: root, localPlaybackEnabled: true, youtubeUploadAccessToken: 'qf-test-only', youtubeUploadCleanupEnabled: true, youtubeUploadCleanupMaxAgeDays: 180, youtubeUploadCleanupMinFreeGb: 0, youtubePrivacyGuardEnabled: true });
  global.fetch = fake;
});
beforeEach(async () => {
  for (const name of tables) await db.collection(name).deleteMany({});
  await Setting.create({ key: 'youtubeLifecycle.cleanup', value: true });
  await Setting.create({ key: 'privacy_guard', value: { enabled: true } });
  await db.collection('users').insertMany([{ _id: teacher, role: 'teacher', isActive: true }, { _id: new mongoose.Types.ObjectId(), role: 'admin', isActive: true }]);
  await db.collection('courses').insertOne({ _id: course, teacherId: teacher, title: 'Q-F course', status: 'published' });
  failQuota = true; counters = { sessions: 0, puts: 0, privacyUpdates: 0 }; statuses = new Map();
});
after(async () => { await mongoose.disconnect(); await isolated?.close(); if (root && path.basename(root).startsWith('ff-qf-local-')) fs.rmSync(root, { recursive: true, force: true }); });
it('Q-F 原片播放→額度等待→中斷安全接手→單支試傳→ready切換→同輪重查後清理', async () => {
  const item = await add();
  assert.equal(playback.resolvePlaybackSource(item).type, 'local');
  assert.equal(playback.authorizeSource({ video: item }, { role: 'student' }), fs.realpathSync(item.filePath));
  await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl: fake });
  let current = await Video.findById(item._id).lean();
  assert.equal(current.youtubeUpload.status, 'waiting'); assert.equal(current.youtubeUpload.attemptCount, 0); assert.equal(counters.puts, 0);
  assert.equal((await gate.getUploadPauseSnapshot()).paused, true);
  assert.equal((await admin.getUploadOverview()).waitingCount, 1);
  // Simulate a process loss after session persistence, before the media boundary.
  // Expired heartbeat and the observed attempt/phase still fence the real Mongo takeover.
  await Video.collection.updateOne({ _id: item._id }, { $set: {
    'youtubeUpload.status': 'uploading', 'youtubeUpload.phase': 'session_saved',
    'youtubeUpload.attemptId': 'qf-interrupted', 'youtubeUpload.attemptCount': 1,
    'youtubeUpload.lastAttemptAt': new Date(Date.now() - 20 * 60000),
    'youtubeUpload.heartbeatAt': new Date(Date.now() - 5 * 60000),
    'youtubeUpload.session': { url: 'https://qf.invalid/session', fileSize: fs.statSync(item.filePath).size, createdAt: new Date() },
  } });
  const interrupted = await Video.findById(item._id).select('+youtubeUpload.session.url').lean();
  const recovered = await upload.recoverStaleUpload({ model: Video, kind: 'video', item: interrupted, fetchImpl: fake });
  assert.equal(recovered.youtubeUpload.retrySafe, true); assert.equal(recovered.youtubeUpload.attemptCount, 0);
  assert.notEqual(recovered.youtubeUpload.attemptId, 'qf-interrupted'); assert.equal(counters.puts, 0);
  await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl: fake });
  assert.equal((await Video.findById(item._id).lean()).youtubeUpload.status, 'waiting');
  const probe = await gate.runUploadProbe({ actor: String(teacher), fetchImpl: fake }); assert.equal(probe.succeeded, true);
  current = await Video.findById(item._id).lean(); assert.equal(current.youtubeUpload.remoteState, 'processing');
  assert.equal(current.videoSource, 'upload'); assert.equal(playback.resolvePlaybackSource(current).type, 'local');
  assert.equal((await gate.getUploadPauseSnapshot()).paused, false);
  statuses.get('qfUploaded1').uploadStatus = 'processed';
  await remote.checkItemRemoteState({ kind: 'video', item: current, fetchImpl: fake });
  current = await Video.findById(item._id).lean(); assert.equal(current.youtubeUpload.remoteState, 'ready');
  assert.equal(playback.resolvePlaybackSource(current).type, 'youtube');
  assert.throws(() => playback.authorizeSource({ video: current }, { role: 'student' }), { statusCode: 409 });
  const later = new Date(Date.now() + 181 * 86400000);
  const preview = await lifecycle.buildYouTubeCleanupPreview({ scope: 'enable', now: later }); assert.equal(preview.count, 1);
  const cleaned = await lifecycle.runYouTubeCleanup({ now: later }); assert.equal(cleaned.cleaned, 1);
  assert.equal(fs.existsSync(item.filePath), false); assert.equal(counters.puts, 1);
});
it('Q-F public異常自動轉私人、讀回、留稽核，管理員改回unlisted才重新ready', async () => {
  const item = await add({ youtubeVideoId: 'qfPublic001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date(), remoteState: 'processing', attemptId: 'public-attempt' } });
  statuses.set(item.youtubeVideoId, { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true });
  await remote.checkItemRemoteState({ kind: 'video', item, fetchImpl: fake });
  let current = await Video.findById(item._id).lean();
  assert.equal(statuses.get(item.youtubeVideoId).privacyStatus, 'private'); assert.equal(counters.privacyUpdates, 1);
  assert.equal(current.youtubeUpload.remoteState, 'blocked'); assert.ok(current.youtubeUpload.privacyIncidents.some(entry => entry.action === 'auto_private' && entry.result === 'confirmed'));
  const restored = await admin.restorePrivacy({ kind: 'video', id: String(item._id), user: { id: teacher }, fetchImpl: fake });
  assert.equal(restored.remoteState, 'ready'); assert.equal(restored.privacyStatus, 'unlisted');
  current = await Video.findById(item._id).lean(); assert.ok(current.youtubeUpload.privacyIncidents.some(entry => entry.action === 'restore_unlisted' && entry.actor === String(teacher)));
});
