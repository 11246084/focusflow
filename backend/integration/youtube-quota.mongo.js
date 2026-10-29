const { env } = require('./helpers/youtubeReviewFixture');
const assert = require('node:assert/strict');
const { before, beforeEach, after, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const mongoose = require('mongoose');
const { openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const Setting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const gate = require('../src/services/youtubeUploadGate.service');
const { attemptOwnerQuery } = require('../src/services/youtubeWorkOwnership.service');
const uri = process.env.YOUTUBE_TEST_MONGODB_URI;
let isolated; let root; let db;
const courseId = new mongoose.Types.ObjectId(); const teacherId = new mongoose.Types.ObjectId();
const collections = ['videos', 'shortassets', 'runtimesettings', 'users', 'notifications', 'youtubebackups'];
const response = (payload, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: (name) => headers[name.toLowerCase()] || null }, json: async () => payload, text: async () => JSON.stringify(payload) });
function fakeUpload({ afterPut } = {}) {
  return async (url, options = {}) => {
    if (String(url).includes('uploadType=resumable')) return response({}, 200, { location: 'https://quota-test.invalid/secret-session' });
    if (options.body?.resume) { for await (const chunk of options.body) { void chunk; } await afterPut?.(); return response({ id: 'qaMongo0001', status: { privacyStatus: 'unlisted' } }, 201); }
    return response({ items: [{ id: 'qaMongo0001', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded', embeddable: true } }] });
  };
}
async function add(state = {}, kind = 'video') {
  const id = new mongoose.Types.ObjectId(); const filePath = path.join(root, `${id}.mp4`);
  fs.writeFileSync(filePath, 'owned quota fixture');
  const item = { _id: id, courseId, uploadedBy: teacherId, title: 'Quota Mongo fixture', filePath,
    processing: { status: 'completed' }, videoSource: 'upload', youtubeVideoId: null,
    ...(kind === 'short_asset' ? { status: 'draft', generationVersion: 1, disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true } } : {}),
    youtubeUpload: { attemptCount: 0, ...state } };
  await db.collection(kind === 'video' ? 'videos' : 'shortassets').insertOne(item); return item;
}
before(async () => {
  isolated = await openIsolatedYouTubeMongo(uri);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-qa-mongo-owned-')); env.uploadDir = root;
  Object.assign(env, { youtubeUploadAccessToken: 'fake-token', shortScriptAutomationEnabled: true });
  await mongoose.connect(uri, { dbName: isolated.databaseName, directConnection: true, autoIndex: false, autoCreate: false });
  db = mongoose.connection.db;
  for (const collection of collections) await db.createCollection(collection);
  await Setting.collection.createIndex({ key: 1 }, { unique: true });
});
beforeEach(async () => {
  for (const collection of collections) await db.collection(collection).deleteMany({});
  await db.collection('users').insertOne({ _id: teacherId, role: 'admin', isActive: true });
  upload.resetYouTubeUploadState();
});
after(async () => {
  await mongoose.disconnect(); await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-qa-mongo-owned-')) fs.rmSync(root, { recursive: true, force: true });
});
it('QA-T5 Mongoose 8 pipeline $$NOW gate has only one concurrent winner', async () => {
  const leases = await Promise.all(Array.from({ length: 12 }, () => gate.acquireUploadGate()));
  assert.equal(leases.filter(Boolean).length, 1);
  const held = await Setting.findOne({ key: gate.GATE_KEY }).lean();
  assert.ok(held.value.leaseUntil instanceof Date); assert.ok(held.value.leaseUntil > new Date());
  await leases.find(Boolean).renew(); await leases.find(Boolean).release();
});
it('QA-T6 expired gate holder cannot release or renew its successor', async () => {
  const first = await gate.acquireUploadGate();
  await Setting.collection.updateOne({ key: gate.GATE_KEY }, { $set: { 'value.leaseUntil': new Date(0) } });
  const second = await gate.acquireUploadGate(); assert.ok(second);
  await first.release(); await assert.rejects(first.renew());
  assert.equal((await Setting.findOne({ key: gate.GATE_KEY }).lean()).value.ownerToken, second.ownerToken);
});
for (const stage of ['read', 'gate', 'session']) it(`QA-T7 Mongo ${stage} fault never sends content`, async () => {
  const item = await add(); let sent = 0; const originalRead = Setting.findOne; const originalGate = Setting.findOneAndUpdate; const originalCAS = Video.findOneAndUpdate;
  if (stage === 'read') Setting.findOne = () => { throw new Error('Injected Mongo read failure'); };
  if (stage === 'gate') Setting.findOneAndUpdate = () => { throw new Error('Injected Mongo gate failure'); };
  if (stage === 'session') Video.findOneAndUpdate = function (query, update, options) {
    if (update.$set?.['youtubeUpload.phase'] === 'session_saved') throw new Error('Injected Mongo session failure');
    return originalCAS.call(this, query, update, options);
  };
  try {
    const fake = fakeUpload();
    await upload.autoUploadVideoToYouTube(item._id, { fetchImpl: async (url, options) => { if (options.body?.resume) sent += 1; return fake(url, options); } });
    assert.equal(sent, 0);
  } finally { Setting.findOne = originalRead; Setting.findOneAndUpdate = originalGate; Video.findOneAndUpdate = originalCAS; }
});
for (const kind of ['video', 'short_asset']) it(`QA-T11 ${kind} stale takeover and old sending CAS are mutually exclusive`, async () => {
  const model = kind === 'video' ? Video : ShortAsset;
  for (let round = 0; round < 8; round += 1) {
    const item = await add({ status: 'uploading', phase: 'session_saved', attemptId: 'old', heartbeatAt: new Date(0), lastAttemptAt: new Date(0) }, kind);
    const owner = attemptOwnerQuery(item, 'old');
    const outcomes = await Promise.allSettled([
      upload.recoverStaleUpload({ model, kind, item, fetchImpl: () => assert.fail('pre-send takeover must not call YouTube') }),
      upload.uploadPhaseCallbacks(model, owner).onBeforeSend(),
    ]);
    const takeover = outcomes[0].status === 'fulfilled' && outcomes[0].value;
    const sending = outcomes[1].status === 'fulfilled';
    assert.equal(Number(Boolean(takeover)) + Number(sending), 1);
    const current = await model.findById(item._id).lean();
    if (takeover) { assert.equal(current.youtubeUpload.retrySafe, true); assert.notEqual(current.youtubeUpload.attemptId, 'old'); }
    else assert.equal(current.youtubeUpload.phase, 'sending');
  }
});
it('QA-T13 late remote success only appends orphan and never reserves new ownership', async () => {
  const item = await add();
  const result = await upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fakeUpload({ afterPut: async () => {
    await Video.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.attemptId': 'successor' } });
  } }) });
  assert.equal(result, null);
  const current = await Video.findById(item._id).lean();
  assert.equal(current.youtubeUpload.attemptId, 'successor'); assert.equal(current.youtubeVideoId, null);
  assert.equal(current.youtubeUpload.orphanUploads.length, 1); assert.equal(await db.collection('youtubebackups').countDocuments(), 0);
});
it('QA-T15 session URL is excluded by real schema select:false but explicitly readable for recovery', async () => {
  const item = await add({ status: 'uploading', session: { url: 'https://quota-test.invalid/secret-session', fileSize: 20, createdAt: new Date() } });
  const normal = await Video.findById(item._id).lean();
  assert.equal(normal.youtubeUpload.session.url, undefined);
  const recovery = await Video.findById(item._id).select('+youtubeUpload.session.url').lean();
  assert.equal(recovery.youtubeUpload.session.url, 'https://quota-test.invalid/secret-session');
});
it('Q-A null youtubeUpload parent claim preserves server heartbeat and phase boundary', async () => {
  const item = await add(); await Video.collection.updateOne({ _id: item._id }, { $set: { youtubeUpload: null } });
  assert.equal(await upload.autoUploadVideoToYouTube(item._id, { fetchImpl: fakeUpload() }), 'qaMongo0001');
  const current = await Video.findById(item._id).lean();
  assert.equal(current.youtubeUpload.status, 'uploaded'); assert.equal(current.youtubeUpload.phase, 'sending');
  assert.ok(current.youtubeUpload.heartbeatAt instanceof Date); assert.equal(current.videoSource, 'upload');
});
